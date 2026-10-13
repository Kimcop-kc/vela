/**
 * 应用日志 Store 护栏
 *
 * 这里的约定都是「界面上看不出来、但改坏了会出问题」的：
 *   · append 必须按 id 去重 —— 主进程推送（logs:appended）与首次全量拉取（logs:list）
 *     会重叠，不去重则面板里每条日志出现两遍；
 *   · entries 上限 1000 条且保留最新 —— 长跑会话不能把渲染进程内存吃光；
 *   · load 无论成功失败都必须把 loading 复位 —— 否则加载失败后日志面板永远转圈；
 *   · init 幂等（重复调用只订阅一次），disposeLogStore 之后允许重新 init。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppLogEntry } from '../../shared/ipc-channels'
import { disposeLogStore, useLogStore } from '../log-store'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
}))

vi.mock('../../services/ipc-client', () => ({
  ipc: {
    invoke: (...args: unknown[]) => mocks.invoke(...args),
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      const set = mocks.listeners.get(channel) ?? new Set<(...args: unknown[]) => void>()
      set.add(callback)
      mocks.listeners.set(channel, set)
      return () => { set.delete(callback) }
    },
    once: () => {},
    send: () => {},
    isElectron: false,
    setZoomLevel: () => {},
    setZoomFactor: () => {},
    getZoomLevel: () => 0,
  },
}))

// 必须在 vi.mock 之后导入，才能拿到被替换过的 ipc-client
const entry = (id: string, patch: Partial<AppLogEntry> = {}): AppLogEntry => ({
  id,
  timestamp: '2026-01-01T00:00:00.000Z',
  level: 'info',
  scope: 'test',
  message: `msg-${id}`,
  process: 'renderer',
  sessionId: 's1',
  ...patch,
})

const entryIds = () => useLogStore.getState().entries.map(e => e.id)

/** 取出 logs:appended 的订阅回调（用于模拟主进程推送） */
const pushAppended = (e: AppLogEntry) => {
  const set = mocks.listeners.get('logs:appended')
  if (!set || set.size === 0) throw new Error('尚未订阅 logs:appended')
  for (const cb of set) cb(e)
}

describe('日志 Store', () => {
  beforeEach(() => {
    disposeLogStore()
    mocks.listeners.clear()
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    useLogStore.setState({ entries: [], loading: false })
  })

  it('append 按 id 去重，重复 id 不产生新条目也不重建数组', () => {
    const store = useLogStore.getState()
    store.append(entry('a'))
    store.append(entry('b'))
    const afterTwo = useLogStore.getState().entries

    store.append(entry('a'))

    expect(entryIds()).toEqual(['a', 'b'])
    // 去重命中时直接返回原 state，引用不变 —— 避免无意义的重渲染
    expect(useLogStore.getState().entries).toBe(afterTwo)
  })

  it('append 超过 1000 条时保留最新的 1000 条', () => {
    const store = useLogStore.getState()
    for (let i = 0; i < 1005; i++) store.append(entry(String(i)))

    const ids = entryIds()
    expect(ids).toHaveLength(1000)
    expect(ids[0]).toBe('5')
    expect(ids[ids.length - 1]).toBe('1004')
  })

  it('load 期间 loading 为 true，完成后复位，并按 limit=1000 拉取', async () => {
    let resolveList: (value: AppLogEntry[]) => void = () => {}
    mocks.invoke.mockImplementationOnce(() => new Promise<AppLogEntry[]>(resolve => { resolveList = resolve }))

    const pending = useLogStore.getState().load()
    expect(useLogStore.getState().loading).toBe(true)

    resolveList([entry('x')])
    await pending

    expect(useLogStore.getState().loading).toBe(false)
    expect(entryIds()).toEqual(['x'])
    expect(mocks.invoke).toHaveBeenCalledWith('logs:list', { limit: 1000 })
  })

  it('load 失败时 loading 仍然复位（否则面板永远转圈）', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('IPC 挂了'))

    await expect(useLogStore.getState().load()).rejects.toThrow('IPC 挂了')
    expect(useLogStore.getState().loading).toBe(false)
  })

  it('clear 只有主进程返回 success 时才清空本地列表', async () => {
    useLogStore.getState().append(entry('a'))

    mocks.invoke.mockResolvedValueOnce({ success: false })
    await useLogStore.getState().clear()
    expect(entryIds()).toEqual(['a'])

    mocks.invoke.mockResolvedValueOnce({ success: true })
    await useLogStore.getState().clear()
    expect(entryIds()).toEqual([])
  })

  it('init 幂等：重复调用只订阅一次，推送的日志会进入列表', async () => {
    mocks.invoke.mockResolvedValue([])
    useLogStore.getState().init()
    useLogStore.getState().init()

    expect(mocks.listeners.get('logs:appended')?.size).toBe(1)

    pushAppended(entry('p1'))
    expect(entryIds()).toEqual(['p1'])
  })

  it('disposeLogStore 取消订阅并允许重新 init', () => {
    mocks.invoke.mockResolvedValue([])
    useLogStore.getState().init()
    expect(mocks.listeners.get('logs:appended')?.size).toBe(1)

    disposeLogStore()
    expect(mocks.listeners.get('logs:appended')?.size).toBe(0)

    useLogStore.getState().init()
    expect(mocks.listeners.get('logs:appended')?.size).toBe(1)
  })

  it('exportLogs / openFolder 直接透传主进程返回值', async () => {
    mocks.invoke.mockResolvedValueOnce({ success: true, path: 'C:/logs/app.jsonl' })
    await expect(useLogStore.getState().exportLogs()).resolves.toEqual({ success: true, path: 'C:/logs/app.jsonl' })

    mocks.invoke.mockResolvedValueOnce({ success: false, error: '打不开' })
    await expect(useLogStore.getState().openFolder()).resolves.toEqual({ success: false, error: '打不开' })

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'logs:export')
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'logs:open-folder')
  })
})
