import { useEffect, useState } from 'react'
import type { RiskItem, TerritoryDetail } from '../lib/snapshot'

type AIRecommendationState = {
  text: string | null
  loading: boolean
  error: string | null
}

const cache = new Map<string, string>()

/** Collect all configured Gemini API keys from env vars.
 * NOTE: Vite requires STATIC references to import.meta.env — dynamic access returns undefined.
 */
function getApiKeys(): string[] {
  const candidates = [
    import.meta.env.VITE_GEMINI_API_KEY_1 as string | undefined,
    import.meta.env.VITE_GEMINI_API_KEY_2 as string | undefined,
    import.meta.env.VITE_GEMINI_API_KEY_3 as string | undefined,
  ]
  const keys = [...new Set(candidates.filter((k): k is string => Boolean(k)))]
  console.debug(`[AI] ${keys.length} chave(s) Gemini carregada(s)`)
  return keys
}

const MODELS = [
  'gemini-2.5-flash-lite',  // 15 RPM, 1000 RPD — highest free quota
  'gemini-2.5-flash',       // 10 RPM, 500 RPD
]

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callGemini(prompt: string, keys: string[], signal: AbortSignal): Promise<string> {
  let lastError: Error = new Error('No API keys configured')

  // Try each model, and for each model try each key, with retry delay on 429
  for (const model of MODELS) {
    for (let idx = 0; idx < keys.length; idx++) {
      const key = keys[idx]
      // Up to 2 attempts per key (wait + retry on 429)
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          console.debug(`[AI] Aguardando 3s antes de retry (chave ${idx + 1}, modelo ${model})...`)
          await wait(3000)
        }

        try {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          console.debug(`[AI] Tentando chave ${idx + 1}/${keys.length} com modelo ${model} (tentativa ${attempt + 1})...`)

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal,
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.4, maxOutputTokens: 200 },
              }),
            }
          )

          if (res.status === 429) {
            console.warn(`[AI] Chave ${idx + 1} / ${model} → 429, ${attempt === 0 ? 'vai esperar e retry...' : 'pulando pra próxima chave.'}`)
            lastError = new Error(`Todas as chaves com quota esgotada. Aguarde ~1 minuto.`)
            continue // inner retry loop
          }

          if (!res.ok) {
            const body = await res.text().catch(() => '')
            console.warn(`[AI] Chave ${idx + 1} / ${model} → HTTP ${res.status}:`, body.slice(0, 120))
            lastError = new Error(`HTTP ${res.status}`)
            break // skip retries for this key, try next key
          }

          const data = await res.json()
          const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          if (!text) throw new Error('Resposta vazia do modelo')
          console.debug(`[AI] ✅ Sucesso com chave ${idx + 1} / ${model}`)
          return text
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err
          lastError = err as Error
        }
      }
    }
  }

  throw lastError
}


export function useAIRecommendation(
  risk: RiskItem | null,
  detail: TerritoryDetail | null
): AIRecommendationState {
  const [state, setState] = useState<AIRecommendationState>({
    text: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    const keys = getApiKeys()
    if (!risk || keys.length === 0) return

    const cacheKey = `${risk.id}-${risk.score}-${detail?.recent_cvli ?? 0}-${detail?.recent_exogenous ?? 0}`
    if (cache.has(cacheKey)) {
      setState({ text: cache.get(cacheKey)!, loading: false, error: null })
      return
    }

    setState({ text: null, loading: true, error: null })

    const score = risk.score ?? 0
    const cvli = detail?.recent_cvli ?? risk.recent_cvli ?? 0
    const exog = detail?.recent_exogenous ?? risk.recent_exogenous ?? 0
    const momentum7d = detail?.momentum_7d ?? risk.momentum_7d ?? 0
    const momentum14d = detail?.momentum_14d ?? risk.momentum_14d ?? 0
    const faction = risk.faction || 'Não identificada'
    const territory = risk.name ?? 'Território'
    const streets = detail?.critical_streets
      ? Array.isArray(detail.critical_streets)
        ? detail.critical_streets.slice(0, 3).map((s) => s.loc).join(', ')
        : detail.critical_streets
      : 'Não informado'
    const summary = detail?.summary ?? risk.summary ?? ''

    const prompt = `Você é um analista operacional de segurança pública de alto nível do Estado do Ceará, Brasil.

Território: ${territory}
Score de risco preditivo: ${score.toFixed(1)}%
Facção dominante: ${faction}
CVLI recente (7 dias): ${cvli}
Eventos exógenos recentes: ${exog}
Momentum 7 dias: ${momentum7d > 0 ? `+${momentum7d}` : momentum7d}
Momentum 14 dias: ${momentum14d > 0 ? `+${momentum14d}` : momentum14d}
Logradouros críticos: ${streets}
Leitura analítica: ${summary}

Com base nesses dados do modelo preditivo de risco, gere uma RECOMENDAÇÃO OPERACIONAL CONCISA (máximo 3 frases).
- Use linguagem técnica e assertiva de segurança pública
- Indique o nível de prioridade (CRÍTICO / ALTO / MODERADO / ROTINA)
- Mencione especificamente a facção, os logradouros críticos se houver e os dados de CVLI/exógenos se relevantes
- Não use bullet points, escreva em texto corrido
- Não comece com "Claro" ou "Aqui está" - vá direto ao ponto`

    const controller = new AbortController()
    const webhookUrl = import.meta.env.VITE_GOOGLE_WEBHOOK_URL

    const fetchSmartRecommendation = async () => {
      try {
        // 1. Tentar ler do cache (Página 2 via Webhook)
        if (webhookUrl) {
          try {
            const cacheRes = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({ action: 'get_cache', area_id: cacheKey }),
              signal: controller.signal,
            })
            const cacheData = await cacheRes.json()
            if (cacheData.status === 'success' && cacheData.data?.text) {
              const text = cacheData.data.text
              cache.set(cacheKey, text)
              setState({ text, loading: false, error: null })
              return // Usa o cache, pula o Gemini
            }
          } catch (err) {
            console.warn('[AI] Falha ao verificar cache no Google Sheets:', err)
          }
        }

        // 2. Não há (ou está expirado), chama o modelo do Gemini
        if (controller.signal.aborted) return
        const text = await callGemini(prompt, keys, controller.signal)

        // 3. Salva no cache local (memória) e atualiza o estado
        cache.set(cacheKey, text)
        if (!controller.signal.aborted) {
          setState({ text, loading: false, error: null })
        }

        // 4. Salvar o novo resultado no cache do Google Sheets ("Página 2")
        if (webhookUrl && !controller.signal.aborted) {
          // Fire-and-forget, sem 'await' para não atrasar a UI
          fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'save_cache',
              area_id: cacheKey,
              area_name: territory,
              text: text,
            }),
          }).catch((err) => console.warn('[AI] Falha ao salvar cache no Google Sheets:', err))
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return
        setState({ text: null, loading: false, error: err.message })
      }
    }

    fetchSmartRecommendation()

    return () => controller.abort()
  }, [risk, detail])

  return state
}
