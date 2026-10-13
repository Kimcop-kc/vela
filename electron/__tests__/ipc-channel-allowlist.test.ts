/**
 * IPC 通道白名单 —— 闸门行为 + 契约漂移防护
 *
 * 背景：preload 此前是「任意通道透传」，渲染进程可以调用全部 211 个通道。
 * 现在由 `electron/ipc-channel-guard.ts` 按白名单收口。这个测试锁住两件事：
 *
 *   1. 闸门本身的行为（放行已登记通道、拒绝未登记通道、拒绝非字符串）；
 *   2. **漂移**：主进程注册的 handler、主进程推送的事件、渲染进程实际发起的调用，
 *      三者都必须落在白名单里。任何一侧漏登记都会在这里失败，而不是等到运行时
 *      才表现成「功能莫名不生效」。
 *
 * 白名单与类型契约的一致性不在这里测——那由 `ipc-channels.ts` 末尾的编译期断言
 * 保证（`tsc --noEmit` 阶段就会失败并点名通道），比运行时测试更强。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EVENT_CHANNEL_ALLOWLIST,
  INVOKE_CHANNEL_ALLOWLIST,
} from '../../src/shared/ipc-channels'
import {
  allowlistSizes,
  isAllowedEventChannel,
  isAllowedInvokeChannel,
  rejectionMessage,
} from '../ipc-channel-guard'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      out.push(...listSourceFiles(full))
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** 扫出所有匹配的通道名（字面量调用） */
function collectChannels(files: string[], pattern: RegExp): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      const channel = match[1]
      const list = found.get(channel) ?? []
      list.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      found.set(channel, list)
    }
  }
  return found
}

const invokeAllowlist = new Set<string>(INVOKE_CHANNEL_ALLOWLIST)
const eventAllowlist = new Set<string>(EVENT_CHANNEL_ALLOWLIST)

describe('闸门行为', () => {
  it('放行已登记的通道', () => {
    expect(isAllowedInvokeChannel('config:get')).toBe(true)
    expect(isAllowedInvokeChannel('db:pipeline-save')).toBe(true)
    expect(isAllowedEventChannel('llm:stream-chunk')).toBe(true)
    expect(isAllowedEventChannel('logs:appended')).toBe(true)
  })

  it('拒绝未登记的通道', () => {
    expect(isAllowedInvokeChannel('fs:read-file')).toBe(true)
    expect(isAllowedInvokeChannel('fs:read-any-file')).toBe(false)
    expect(isAllowedInvokeChannel('db:pipeline-delete-everything')).toBe(false)
    expect(isAllowedEventChannel('llm:stream-secret')).toBe(false)
  })

  it('拒绝非字符串，不因为类型不对就放行', () => {
    expect(isAllowedInvokeChannel(undefined)).toBe(false)
    expect(isAllowedInvokeChannel(null)).toBe(false)
    expect(isAllowedInvokeChannel(42)).toBe(false)
    expect(isAllowedInvokeChannel({ toString: () => 'config:get' })).toBe(false)
    expect(isAllowedEventChannel(['llm:stream-done'])).toBe(false)
  })

  it('invoke 与 event 两个白名单互不通用', () => {
    // 事件通道不能被 invoke，反之亦然
    expect(isAllowedInvokeChannel('llm:stream-chunk')).toBe(false)
    expect(isAllowedEventChannel('config:get')).toBe(false)
  })

  it('拒绝原因里带上通道名和登记位置，避免靠猜', () => {
    const invoke = rejectionMessage('fs:read-any-file', 'invoke')
    expect(invoke).toContain('fs:read-any-file')
    expect(invoke).toContain('INVOKE_CHANNEL_ALLOWLIST')
    expect(invoke).toContain('src/shared/ipc-channels.ts')

    const event = rejectionMessage('llm:stream-secret', 'event')
    expect(event).toContain('llm:stream-secret')
    expect(event).toContain('EVENT_CHANNEL_ALLOWLIST')

    const send = rejectionMessage('some:channel', 'send')
    expect(send).toContain('some:channel')
    expect(send).toContain('ipcMain.on')
  })

  it('白名单非空，且规模与契约一致', () => {
    const sizes = allowlistSizes()
    expect(sizes.invoke).toBeGreaterThan(200)
    expect(sizes.event).toBeGreaterThan(0)
    // Set 去重后应与数组长度相同——有重复条目说明复制粘贴出了问题
    expect(sizes.invoke).toBe(INVOKE_CHANNEL_ALLOWLIST.length)
    expect(sizes.event).toBe(EVENT_CHANNEL_ALLOWLIST.length)
  })

  it('白名单内没有重复条目', () => {
    expect(new Set(INVOKE_CHANNEL_ALLOWLIST).size).toBe(INVOKE_CHANNEL_ALLOWLIST.length)
    expect(new Set(EVENT_CHANNEL_ALLOWLIST).size).toBe(EVENT_CHANNEL_ALLOWLIST.length)
  })
})

describe('契约漂移防护', () => {
  const electronFiles = listSourceFiles(path.join(ROOT, 'electron'))
  const rendererFiles = listSourceFiles(path.join(ROOT, 'src'))

  it('主进程注册的每个 handler 都在白名单里（否则渲染进程永远调不动）', () => {
    const handlers = collectChannels(electronFiles, /ipcMain\.handle\(\s*'([a-z0-9:-]+)'/g)
    expect(handlers.size).toBeGreaterThan(190)
    const notAllowed = [...handlers.keys()].filter(channel => !invokeAllowlist.has(channel))
    expect(notAllowed).toEqual([])
  })

  it('主进程推送的每个事件都在事件白名单里（否则渲染进程监听不到）', () => {
    const sent = collectChannels(electronFiles, /\.send\(\s*'([a-z0-9:-]+)'/g)
    expect(sent.size).toBeGreaterThan(0)
    const notAllowed = [...sent.keys()].filter(channel => !eventAllowlist.has(channel))
    expect(notAllowed).toEqual([])
  })

  it('渲染进程发起的每个调用都在白名单里（否则会被闸门挡下）', () => {
    const called = collectChannels(rendererFiles, /ipc\.invoke\(\s*'([a-z0-9:-]+)'/g)
    expect(called.size).toBeGreaterThan(50)
    const notAllowed = [...called.keys()].filter(channel => !invokeAllowlist.has(channel))
    expect(notAllowed).toEqual([])
  })

  it('渲染进程监听的每个事件都在事件白名单里', () => {
    const listened = collectChannels(rendererFiles, /ipc\.on\(\s*'([a-z0-9:-]+)'/g)
    expect(listened.size).toBeGreaterThan(0)
    const notAllowed = [...listened.keys()].filter(channel => !eventAllowlist.has(channel))
    expect(notAllowed).toEqual([])
  })

  /**
   * 契约里声明了、但主进程没有 handler 的通道 —— **已知孤儿**，冻结在这里。
   *
   * 这两个不是「白名单漏了」，而是功能本身没实现：
   *   - `db:canon-compressed-summary-upsert`：定稿流程第 2 步会调用它，调用处 `.catch()` 后
   *     静默跳过，所以「长篇摘要压缩」这一步实际上什么都没做（表也没建）。
   *   - `llm:provider-models`：全项目没有任何调用方，属于废弃契约。
   *
   * 冻结的目的：将来再多出孤儿会在这里失败，逼出一次明确决定（补实现 or 删契约），
   * 而不是继续悄悄堆积。
   */
  it('孤儿通道集合没有变大（新增孤儿会失败，要求明确处理）', () => {
    const handlers = collectChannels(electronFiles, /ipcMain\.handle\(\s*'([a-z0-9:-]+)'/g)
    const orphans = INVOKE_CHANNEL_ALLOWLIST
      .filter(channel => !handlers.has(channel))
      .sort()
    expect(orphans).toEqual([
      'db:canon-compressed-summary-upsert',
      'llm:provider-models',
    ])
  })
})
