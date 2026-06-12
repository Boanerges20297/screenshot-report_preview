const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash']

function getApiKeys(): string[] {
  const env = process.env
  const combined = env.GEMINI_API_KEYS

  if (combined) {
    return [...new Set(combined.split(',').map((key) => key.trim()).filter(Boolean))]
  }

  return [
    env.GEMINI_API_KEY_1,
    env.GEMINI_API_KEY_2,
    env.GEMINI_API_KEY_3,
    env.GEMINI_API_KEY,
  ].filter((key): key is string => Boolean(key))
}

function sendJson(res: any, status: number, payload: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8')
  res.send(JSON.stringify(payload))
}

function normalizeBody(body: any) {
  if (!body) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return {}
    }
  }

  return body
}

async function callGemini(prompt: string, keys: string[]) {
  let lastError: { status: number; message: string } = {
    status: 500,
    message: 'Nenhuma chave Gemini configurada no servidor.',
  }

  for (const model of MODELS) {
    for (const key of keys) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 1000 },
          }),
        }
      )

      if (response.ok) {
        const data = await response.json()
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        if (text) return text

        lastError = { status: 502, message: 'Resposta vazia do Gemini.' }
        continue
      }

      let message = `HTTP ${response.status}`
      try {
        const data = await response.json()
        const apiMessage = data?.error?.message
        if (typeof apiMessage === 'string' && apiMessage.trim()) {
          message = apiMessage.trim()
        }
      } catch {
        // Keep the HTTP fallback when the API response is not JSON.
      }

      lastError = { status: response.status, message }

      if (response.status === 429) {
        continue
      }
    }
  }

  throw lastError
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  const body = normalizeBody(req.body)
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''

  if (!prompt) {
    return sendJson(res, 400, { error: 'Prompt is required' })
  }

  const keys = getApiKeys()
  if (keys.length === 0) {
    return sendJson(res, 500, { error: 'Nenhuma chave Gemini configurada no servidor.' })
  }

  try {
    const text = await callGemini(prompt, keys)
    return sendJson(res, 200, { text })
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500
    const message =
      typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Falha ao consultar o Gemini.'

    return sendJson(res, status, { error: message })
  }
}
