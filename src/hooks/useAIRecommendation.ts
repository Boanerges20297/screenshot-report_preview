import { useEffect, useState } from 'react'
import type { RiskItem, TerritoryDetail } from '../lib/snapshot'

type AIRecommendationState = {
  text: string | null
  loading: boolean
  error: string | null
}

const cache = new Map<string, string>()

function buildGeminiError(status: number, body: string): Error {
  try {
    const parsed = JSON.parse(body)
    const message = parsed?.error
    if (typeof message === 'string' && message.trim()) {
      return new Error(message.trim())
    }
  } catch {
    // Fall back to generic HTTP handling when the response is not JSON.
  }

  return new Error(`HTTP ${status}`)
}

async function callRecommendationApi(prompt: string, signal: AbortSignal): Promise<string> {
  const response = await fetch('/api/ai-recommendation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ prompt }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw buildGeminiError(response.status, body)
  }

  const data = await response.json()
  const text: string = data?.text ?? ''
  if (!text) {
    throw new Error('Resposta vazia da auditoria IA.')
  }

  return text
}

export function useAIRecommendation(
  risk: RiskItem | null,
  detail: TerritoryDetail | null,
  explainability: any | null = null,
  academics: any | null = null,
  regionalTop: string[] = []
): AIRecommendationState {
  const [state, setState] = useState<AIRecommendationState>({
    text: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!risk) return

    const cacheKey = `${risk.id}-${risk.score}-${detail?.recent_cvli ?? 0}-${detail?.recent_exogenous ?? 0}-${explainability?.confidence_pct ?? 0}-v2`
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
    const faction = risk.faction || 'Nao identificada'
    const territory = risk.name ?? 'Territorio'
    const municipality = risk.municipality || detail?.municipality || ''
    const tensionIndex = risk.tension_index ?? 0
    const trend = risk.trend || 'Estavel'
    const streets = detail?.critical_streets
      ? Array.isArray(detail.critical_streets)
        ? detail.critical_streets.slice(0, 5).map((street) => street.loc).join(', ')
        : detail.critical_streets
      : 'Nao informado'
    const summary = detail?.summary ?? risk.summary ?? ''

    const confidence = explainability?.confidence_pct ?? 'N/A'
    const confidenceLabel = explainability?.confidence_label ?? 'N/A'
    const components = explainability?.confidence_components
      ? explainability.confidence_components.map((component: any) => `- ${component.name}: ${component.text}`).join('\n')
      : 'N/A'
    const academicMetrics = academics?.ranking_metrics
      ? `Rank Global: ${academics.ranking_metrics.rank_global}/${academics.ranking_metrics.total_nodes}, Gap para Media: ${academics.score_distribution_metrics?.score_gap_pct}%`
      : 'N/A'

    const prompt = `Voce e um auditor senior de inteligencia profunda e assessor tecnico direto do Comandante.
Sua missao e interpretar o "humor" do motor E-GCN e entregar uma visao estrategica e perspicaz, identificando se o modelo esta detectando padroes invisiveis ou se precisa de correcao.

Ficha Tecnica do Territorio:
- Nome: ${territory} (${municipality})
- Faccao Predominante: ${faction}
- Predicao E-GCN: ${score.toFixed(1)}% (Tendencia: ${trend}) | Confianca: ${confidence}% (${confidenceLabel})
- Indice de Tensao Estrutural: ${tensionIndex.toFixed(2)}
- CVLI 7d: ${cvli} | Eventos Exogenos: ${exog}
- Momentum Temporal (7d/14d): ${momentum7d}/${momentum14d}
- Logradouros Criticos: ${streets}
- Contexto Regional (Top 5): ${regionalTop.join(', ')}
- Metricas Academicas: ${academicMetrics}
- Componentes de Inteligencia:
${components}
- Leitura Congelada: ${summary}

Escreva uma AUDITORIA ESTRATEGICA ASSERTIVA (maximo 15 linhas) no estilo narrativo e direto:
- Comece com "Comandante,".
- Use expressoes como "o motor de inteligencia profunda preve...", "percebi que...", "a convergencia aponta para...".
- Correlacione a dinamica regional com a discrepancia entre os dados frios (CVLI) e a tensao latente.
- Aponte se o crime esta convergindo para outro ponto ou se a pressao estrutural justifica a atencao.
- Inclua RECOMENDACOES ESTRATEGICAS e uma CRITICA TECNICA ao modelo (identificando possiveis pontos cegos ou vieses na predicao atual).
- Mantenha a densidade tecnica, mas seja extremamente direto e assertivo.`

    const controller = new AbortController()
    const webhookUrl = import.meta.env.VITE_GOOGLE_WEBHOOK_URL

    const fetchSmartRecommendation = async () => {
      try {
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
              return
            }
          } catch (err) {
            console.warn('[AI] Falha ao verificar cache no Google Sheets:', err)
          }
        }

        if (controller.signal.aborted) return
        const text = await callRecommendationApi(prompt, controller.signal)

        cache.set(cacheKey, text)
        if (!controller.signal.aborted) {
          setState({ text, loading: false, error: null })
        }

        if (webhookUrl && !controller.signal.aborted) {
          fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'save_cache',
              area_id: cacheKey,
              area_name: territory,
              text,
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
  }, [risk, detail, explainability, academics, regionalTop])

  return state
}
