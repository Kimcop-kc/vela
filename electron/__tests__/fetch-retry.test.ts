import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithRetry, formatApiError } from '../llm/fetch-retry'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchWithRetry', () => {
  it('retries transient connection resets and succeeds', async () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNRESET', message: 'read ECONNRESET' },
    })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchWithRetry('https://example.com', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a model 404 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"not found"}', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchWithRetry('https://example.com', { method: 'POST' })

    expect(response.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 429 that means the account is out of balance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: '1113', message: '余额不足或无可用资源包,请充值。' } }),
      { status: 429 },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchWithRetry('https://example.com', { method: 'POST' })

    expect(response.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a plain 429 up to the attempt limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchWithRetry('https://example.com', { method: 'POST' }, { maxAttempts: 2 })

    expect(response.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a model usage-limit 429 (SetLimitExceeded)', async () => {
    const body = JSON.stringify({
      error: {
        code: 'SetLimitExceeded',
        message: 'Your account has reached the set usage limit for the [glm-5-2] model, and the model service has been paused.',
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchWithRetry('https://example.com', { method: 'POST' }, { maxAttempts: 3 })

    expect(response.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('turns a model usage-limit error into an actionable message', () => {
    const message = formatApiError(429, JSON.stringify({
      error: {
        code: 'SetLimitExceeded',
        message: 'reached the set usage limit; close the "Safe Experience Mode"',
      },
    }))
    expect(message).toContain('用量上限')
    expect(message).toContain('安全体验模式')
  })
})
