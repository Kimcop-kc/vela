import { ipc } from './ipc-client'
import type { AppLogInput, AppLogLevel } from '../shared/ipc-channels'

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || value.message
  try { return JSON.stringify(value) } catch { return String(value) }
}

function write(level: AppLogLevel, scope: string, message: string, details?: unknown): void {
  const isElectron = typeof window !== 'undefined' && ipc.isElectron
  if (!isElectron) {
    const method = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error
    method(`[${scope}] ${message}`, details ?? '')
    return
  }
  const input: AppLogInput = { level, scope, message, details }
  void ipc.invoke('logs:write', input).catch(() => { /* logging must not surface IPC errors */ })
}

export const appLogger = {
  debug: (scope: string, message: string, details?: unknown) => write('debug', scope, message, details),
  info: (scope: string, message: string, details?: unknown) => write('info', scope, message, details),
  warn: (scope: string, message: string, details?: unknown) => write('warn', scope, message, details),
  error: (scope: string, message: string, details?: unknown) => write('error', scope, message, details),
}

/** Mirror renderer console output into the persistent application log. */
export function installRendererConsoleCapture(): void {
  const originals = {
    debug: console.debug.bind(console),
    info: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }
  let capturing = false

  const capture = (level: AppLogLevel, original: (...args: unknown[]) => void, args: unknown[]) => {
    original(...args)
    if (capturing) return
    capturing = true
    try {
      write(level, 'console', args.map(stringify).join(' '), { args })
    } finally {
      capturing = false
    }
  }

  console.debug = (...args: unknown[]) => capture('debug', originals.debug, args)
  console.log = (...args: unknown[]) => capture('info', originals.info, args)
  console.warn = (...args: unknown[]) => capture('warn', originals.warn, args)
  console.error = (...args: unknown[]) => capture('error', originals.error, args)
}
