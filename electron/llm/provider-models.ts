/**
 * 拉取服务商可用模型列表
 *
 * 「一键配置」里最省事的一步：只要用户给了 Key，就去问服务商「你有哪些模型」，
 * 用户不必再去文档里抄模型标识（这一步是弃用率最高的环节）。
 *
 * 只支持两类端点，且都只做只读 GET：
 *   - OpenAI 兼容：{base}/v1/models（base 已带版本号时直接用 {base}/models）
 *   - Gemini 原生：{base}/v1beta/models?key=...
 * 任何失败都只返回错误码，由调用方决定回退到本地目录。
 */

const REQUEST_TIMEOUT_MS = 15000

function modelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  if (/\/models$/i.test(base)) return base
  if (/\/v\d+[a-z]*$/i.test(base)) return `${base}/models`
  return `${base}/v1/models`
}

function pickNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>

  // OpenAI / OpenRouter / Groq / 硅基流动：{ data: [{ id }] }
  if (Array.isArray(record.data)) {
    return record.data
      .map((item) => (typeof item === 'string' ? item : (item as { id?: string; name?: string })?.id ?? (item as { name?: string })?.name ?? ''))
      .filter(Boolean)
  }

  // Gemini：{ models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: [...] }] }
  if (Array.isArray(record.models)) {
    return record.models
      .map((item) => {
        if (typeof item === 'string') return item
        const model = item as { name?: string; supportedGenerationMethods?: string[] }
        const methods = model.supportedGenerationMethods
        // Gemini 会把向量模型也列出来，只保留能对话的
        if (Array.isArray(methods) && !methods.includes('generateContent')) return ''
        return (model.name ?? '').replace(/^models\//, '')
      })
      .filter(Boolean)
  }

  if (Array.isArray(record.result)) return (record.result as unknown[]).map(String)
  return []
}

/** 读取服务商当前可用的模型标识；失败抛错（错误信息是稳定的错误码） */
export async function listProviderModels(baseUrl: string, apiKey: string, protocol: string): Promise<string[]> {
  if (!baseUrl) throw new Error('NO_BASE_URL')

  const isGemini = protocol === 'gemini'
  const url = isGemini
    ? `${baseUrl.replace(/\/+$/, '').replace(/\/v1beta$/i, '')}/v1beta/models?key=${encodeURIComponent(apiKey)}`
    : modelsUrl(baseUrl)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: isGemini
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as Error)?.name
    throw new Error(name === 'TimeoutError' ? 'TIMEOUT' : 'CONNECTION_FAILED')
  }

  if (!res.ok) throw new Error(`HTTP_${res.status}`)

  const payload = await res.json().catch(() => null)
  const names = pickNames(payload)
  // 去重 + 稳定排序，避免同一份列表每次顺序不同
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
}