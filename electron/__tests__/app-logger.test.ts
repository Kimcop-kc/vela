import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const loggerTestState = vi.hoisted(() => ({ velaHome: '' }))

vi.mock('../utils/config-utils', async () => {
  const fsModule = await import('node:fs')
  return {
    get VELA_HOME() { return loggerTestState.velaHome },
    ensureVelaHome: () => fsModule.mkdirSync(loggerTestState.velaHome, { recursive: true }),
  }
})

beforeEach(() => {
  loggerTestState.velaHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-app-logger-'))
})

afterEach(() => {
  const resolved = path.resolve(loggerTestState.velaHome)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-app-logger-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true })
})

describe('application logger', () => {
  it('persists entries and redacts secret fields', async () => {
    vi.resetModules()
    const { appLogger } = await import('../app-logger')
    appLogger.info('test', '测试日志', {
      apiKey: 'secret-key',
      nested: { authorization: 'Bearer secret', normal: 'value', note: 'token=plain-secret' },
    })

    const entry = appLogger.list({ limit: 10 }).at(-1)
    expect(entry?.message).toBe('测试日志')
    expect(entry?.details).toMatchObject({
      apiKey: '[redacted]',
      nested: { authorization: '[redacted]', normal: 'value', note: 'token=[redacted]' },
    })

    appLogger.warn('test', 'Authorization: Bearer header-secret')
    expect(appLogger.list({ level: 'warn' }).at(-1)?.message).toBe('Authorization: Bearer [redacted]')

    vi.resetModules()
    const reloaded = await import('../app-logger')
    expect(reloaded.appLogger.list({ limit: 10 }).some(item => item.message === '测试日志')).toBe(true)
  })
})
