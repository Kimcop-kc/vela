const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
])

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

/**
 * 命中这些关键词说明是「账号额度/模型用量上限」类错误，重试不会恢复：
 * 例如智谱的 SetLimitExceeded（安全体验模式）、OpenAI 的 insufficient_quota、余额不足等。
 */
const PERMANENT_LIMIT_PATTERN = /余额不足|无可用资源包|欠费|insufficient|quota|SetLimitExceeded|usage limit|安全体验|Safe Experience Mode/i

export interface FetchRetryOptions {
  maxAttempts?: number
  signal?: AbortSignal
  onRetry?: (attempt: number, error: unknown) => void
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const maybe = error as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } }
  const code = maybe.code || maybe.cause?.code || ''
  if (RETRYABLE_CODES.has(code)) return true
  const text = `${maybe.message || ''} ${maybe.cause?.message || ''}`.toLowerCase()
  return text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('socket hang up') ||
    text.includes('connection reset') ||
    text.includes('network socket disconnected')
}

export function formatFetchError(error: unknown): string {
  const maybe = error as { message?: string; cause?: { message?: string; code?: string } }
  const cause = maybe?.cause
  const causeText = cause && (cause.message || cause.code) ? `（底层原因: ${cause.message || cause.code}）` : ''
  return `${String(error)}${causeText}`
}

/**
 * 面向用户的网络错误文案：把 DNS/连接/超时等技术错误翻译成可执行的提示，
 * 避免界面上直接抛 `getaddrinfo ENOTFOUND ...` 这种看不懂的报错。
 */
export function formatNetworkError(error: unknown): string {
  const maybe = error as { message?: string; cause?: { message?: string; code?: string } }
  const raw = `${maybe?.message || ''} ${maybe?.cause?.message || ''} ${maybe?.cause?.code || ''} ${String(error)}`
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return '无法解析服务商域名，请检查网络、DNS 或代理设置后重试。'
  }
  if (/ECONNREFUSED/i.test(raw)) {
    return '无法连接服务商（连接被拒绝），请检查代理设置或服务商状态。'
  }
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout/i.test(raw)) {
    return '连接服务商超时，请检查网络后重试。'
  }
  if (/ECONNRESET|socket hang up|connection reset/i.test(raw)) {
    return '连接被服务商重置，请稍后重试。'
  }
  return formatFetchError(error)
}

/**
 * 面向用户的服务商 HTTP 错误文案：识别余额不足、鉴权失败、模型不存在、
 * max_tokens 越界等常见情况，给出可以直接照做的提示。
 */
export function formatApiError(status: number, body: string): string {
  const text = (body || '').trim()
  const clipped = text.slice(0, 300)
  // 模型用量上限 / 「安全体验模式」暂停：给出可执行的操作指引。
  if (/SetLimitExceeded|usage limit|model service has been paused|安全体验|Safe Experience Mode/i.test(text)) {
    const hint = /安全体验|Safe Experience Mode/i.test(text)
      ? '请到服务商的模型激活页调整或关闭「安全体验模式」'
      : '请到服务商后台调整该模型的用量上限'
    return `该模型已触发账号用量上限，服务被暂停。${hint}，或改用其他模型后重试。`
  }
  if (/余额不足|无可用资源包|欠费|insufficient|quota/i.test(text)) {
    return '服务商账户余额或额度不足，请充值或更换模型后再试。'
  }
  if (status === 401) return '服务商鉴权失败（401），请检查 API Key 是否正确或已过期。'
  if (status === 403) return '服务商拒绝访问（403），请检查 API Key 权限或模型是否已开通。'
  if (status === 404) {
    return `服务商找不到该模型或接口（404），请检查模型名与 Base URL。${clipped ? ` 详情：${clipped}` : ''}`
  }
  if (status === 429) {
    return `请求过于频繁或额度受限（429）。${clipped ? ` 详情：${clipped}` : ''}`
  }
  if (/max_tokens/i.test(text)) {
    return `服务商拒绝了 max_tokens 参数，请检查该模型的输出上限设置。${clipped ? ` 详情：${clipped}` : ''}`
  }
  return `API 调用失败 (${status}): ${clipped}`
}

export async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Retry only connection-level failures and provider 5xx/rate-limit responses.
 * Model/configuration errors such as 400/401/404 are returned immediately.
 */
export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const response = await fetch(input, { ...init, signal: options.signal ?? init.signal })
      const retryableStatus = RETRYABLE_STATUS.has(response.status)
      if (!retryableStatus || attempt >= maxAttempts) return response
      // 余额不足这类 429 不是「过一会儿再试」能恢复的，直接交给上层给出提示。
      const bodyText = await response.clone().text().catch(() => '')
      if (PERMANENT_LIMIT_PATTERN.test(bodyText)) return response
      await response.body?.cancel().catch(() => undefined)
      options.onRetry?.(attempt, new Error(`HTTP ${response.status}`))
    } catch (error) {
      lastError = error
      if (!isRetryableNetworkError(error) || attempt >= maxAttempts) throw error
      options.onRetry?.(attempt, error)
    }
    await sleepWithSignal(700 * (2 ** (attempt - 1)), options.signal)
  }

  throw lastError ?? new Error('网络请求失败')
}
