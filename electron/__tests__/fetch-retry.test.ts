import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithRetry } from '../llm/fetch-retry'

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
})
