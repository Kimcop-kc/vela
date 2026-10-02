/**
 * Vela application logger.
 *
 * Persists newline-delimited JSON under ~/.vela/logs and keeps a small
 * in-memory tail for the renderer. Details are sanitized and truncated before
 * they touch disk, so API keys and full model prompts do not leak into logs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureVelaHome, VELA_HOME } from './utils/config-utils'

export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type AppLogProcess = 'main' | 'renderer'

export interface AppLogEntry {
  id: string
  timestamp: string
  level: AppLogLevel
  scope: string
  message: string
  process: AppLogProcess
  sessionId: string
  details?: unknown
}

export interface AppLogQuery {
  level?: AppLogLevel
  search?: string
  limit?: number
}

export interface AppLogInput {
  level: AppLogLevel
  scope?: string
  message: string
  details?: unknown
}

const MAX_BUFFER = 1000
const MAX_MESSAGE_LENGTH = 8000
const MAX_DETAIL_LENGTH = 4000
const MAX_READ_BYTES = 2 * 1024 * 1024
const MAX_LOG_FILES = 30
const REDACTED = '[redacted]'
const SECRET_KEY = /(api[-_]?key|authorization|bearer|token|secret|password|cookie)/i

function logDirectory(): string {
  ensureVelaHome()
  return path.join(VELA_HOME, 'logs')
}

function logFilePath(date = new Date()): string {
  const day = date.toISOString().slice(0, 10)
  return path.join(logDirectory(), `vela-${day}.log`)
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}…[truncated ${value.length - maxLength} chars]`
}

function redactText(value: string): string {
  return value
    .replace(/(authorization\s*:\s*(?:bearer\s+)?)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/((?:api[-_]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[max-depth]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactText(truncate(value, MAX_DETAIL_LENGTH))
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message, MAX_DETAIL_LENGTH),
      stack: value.stack ? truncate(value.stack, MAX_DETAIL_LENGTH) : undefined,
    }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item => sanitize(item, depth + 1))
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      result[key] = SECRET_KEY.test(key) ? REDACTED : sanitize(item, depth + 1)
    }
    return result
  }
  return String(value)
}

function formatConsoleArguments(args: unknown[]): string {
  return args
    .map(arg => typeof arg === 'string' ? arg : JSON.stringify(sanitize(arg)))
    .join(' ')
}

function readTail(filePath: string): string {
  const stat = fs.statSync(filePath)
  const start = Math.max(0, stat.size - MAX_READ_BYTES)
  const size = stat.size - start
  if (size <= 0) return ''
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(size)
    fs.readSync(fd, buffer, 0, size, start)
    const text = buffer.toString('utf8')
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    fs.closeSync(fd)
  }
}

class ApplicationLogger {
  private readonly sessionId = randomUUID()
  private buffer: AppLogEntry[] = []
  private hydrated = false
  private writesSincePrune = 0
  private readonly listeners = new Set<(entry: AppLogEntry) => void>()

  log(level: AppLogLevel, scope: string, message: string, details?: unknown, origin: AppLogProcess = 'main'): AppLogEntry {
    const entry: AppLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      scope: scope || 'app',
      message: redactText(truncate(String(message || ''), MAX_MESSAGE_LENGTH)),
      process: origin,
      sessionId: this.sessionId,
      details: details === undefined ? undefined : sanitize(details),
    }

    if (!this.hydrated) {
      this.hydrated = true
      this.buffer = this.readPersisted()
    }
    this.buffer = [...this.buffer, entry].slice(-MAX_BUFFER)

    try {
      const filePath = logFilePath()
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8')
      this.writesSincePrune++
      if (this.writesSincePrune >= 100) {
        this.writesSincePrune = 0
        this.pruneFiles()
      }
    } catch (error) {
      // Logging must never break the application path that produced the log.
      process.stderr.write(`[Vela Logger] write failed: ${String(error)}\n`)
    }

    for (const listener of this.listeners) {
      try { listener(entry) } catch { /* listener isolation */ }
    }
    return entry
  }

  debug(scope: string, message: string, details?: unknown): AppLogEntry {
    return this.log('debug', scope, message, details)
  }

  info(scope: string, message: string, details?: unknown): AppLogEntry {
    return this.log('info', scope, message, details)
  }

  warn(scope: string, message: string, details?: unknown): AppLogEntry {
    return this.log('warn', scope, message, details)
  }

  error(scope: string, message: string, details?: unknown): AppLogEntry {
    return this.log('error', scope, message, details)
  }

  list(query: AppLogQuery = {}): AppLogEntry[] {
    if (!this.hydrated) {
      this.hydrated = true
      this.buffer = this.readPersisted()
    }
    const search = query.search?.trim().toLowerCase()
    const limit = Math.max(1, Math.min(5000, query.limit ?? 1000))
    return this.buffer
      .filter(entry => !query.level || entry.level === query.level)
      .filter(entry => !search || `${entry.scope} ${entry.message}`.toLowerCase().includes(search))
      .slice(-limit)
  }

  clear(): void {
    const dir = logDirectory()
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (/^vela-.*\.log(?:\.\d+)?$/.test(file)) fs.rmSync(path.join(dir, file), { force: true })
      }
    }
    this.buffer = []
    this.hydrated = true
  }

  getDirectory(): string {
    return logDirectory()
  }

  subscribe(listener: (entry: AppLogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private readPersisted(): AppLogEntry[] {
    const dir = logDirectory()
    if (!fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir)
      .filter(file => /^vela-.*\.log(?:\.\d+)?$/.test(file))
      .sort()
      .slice(-3)
    const entries: AppLogEntry[] = []
    for (const file of files) {
      try {
        const lines = readTail(path.join(dir, file)).split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try { entries.push(JSON.parse(line) as AppLogEntry) } catch { /* ignore partial line */ }
        }
      } catch { /* ignore unreadable log file */ }
    }
    return entries.slice(-MAX_BUFFER)
  }

  private pruneFiles(): void {
    const dir = logDirectory()
    const files = fs.readdirSync(dir)
      .filter(file => /^vela-.*\.log(?:\.\d+)?$/.test(file))
      .sort()
    for (const file of files.slice(0, Math.max(0, files.length - MAX_LOG_FILES))) {
      fs.rmSync(path.join(dir, file), { force: true })
    }
  }
}

export const appLogger = new ApplicationLogger()

/** Capture main-process console output while preserving normal terminal output. */
export function installMainConsoleCapture(): void {
  const methods: Array<[AppLogLevel, (...args: unknown[]) => void]> = [
    ['debug', console.debug.bind(console)],
    ['info', console.log.bind(console)],
    ['warn', console.warn.bind(console)],
    ['error', console.error.bind(console)],
  ]
  let capturing = false

  const capture = (level: AppLogLevel, original: (...args: unknown[]) => void, args: unknown[]) => {
    original(...args)
    if (capturing) return
    capturing = true
    try {
      appLogger.log(level, 'console', formatConsoleArguments(args), { args }, 'main')
    } finally {
      capturing = false
    }
  }

  console.debug = (...args: unknown[]) => capture('debug', methods[0][1], args)
  console.log = (...args: unknown[]) => capture('info', methods[1][1], args)
  console.warn = (...args: unknown[]) => capture('warn', methods[2][1], args)
  console.error = (...args: unknown[]) => capture('error', methods[3][1], args)
}
