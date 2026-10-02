const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
])

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

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
