/**
 * Agent Store 护栏（流式刷新窗口 + 会话基础操作）
 *
 * 重点是 `assistantFlushDelayMs`：流式正文每合并一次就要把「当前累计全文」整段
 * 重新渲染成 React 元素（实测约 0.76ms/KB，见 markdown-render-cost.perf.ts）。
 * 固定 40ms 窗口在长正文下单帧渲染会超过窗口本身，反而压满主线程，
 * 所以这里把「按文本量分档放宽」的约定钉住，避免有人把它改回常量。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assistantFlushDelayMs, useAgentStore } from '../agent-store'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../services/ipc-client', () => ({
  ipc: {
    invoke: (...args: unknown[]) => mocks.invoke(...args),
    on: () => () => {},
    once: () => {},
    send: () => {},
    isElectron: false,
    setZoomLevel: () => {},
    setZoomFactor: () => {},
    getZoomLevel: () => 0,
  },
}))

vi.mock('../../services/app-logger', () => ({
  appLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

describe('流式刷新窗口', () => {
  it('短正文保持 40ms（≈25fps）以保证流式手感', () => {
    expect(assistantFlushDelayMs(0)).toBe(40)
    expect(assistantFlushDelayMs(2_000)).toBe(40)
    expect(assistantFlushDelayMs(8_000)).toBe(40)
  })

  it('正文变长后窗口分档放宽，避免单帧渲染超过窗口', () => {
    expect(assistantFlushDelayMs(8_001)).toBe(80)
    expect(assistantFlushDelayMs(32_000)).toBe(80)
    expect(assistantFlushDelayMs(32_001)).toBe(160)
    expect(assistantFlushDelayMs(200_000)).toBe(160)
  })

  it('窗口随文本量单调不减（不会出现长文反而刷得更快）', () => {
    const sizes = [0, 1_000, 5_000, 8_000, 8_001, 20_000, 32_000, 32_001, 100_000]
    const delays = sizes.map(assistantFlushDelayMs)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    }
  })
})

describe('Agent Store 会话基础操作', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    useAgentStore.setState({
      conversations: [],
      activeConversationId: null,
      showHistory: false,
      generating: false,
    })
  })

  it('setShowHistory 只切开关，不动会话数据', () => {
    useAgentStore.getState().setShowHistory(true)
    expect(useAgentStore.getState().showHistory).toBe(true)
    expect(useAgentStore.getState().conversations).toEqual([])

    useAgentStore.getState().setShowHistory(false)
    expect(useAgentStore.getState().showHistory).toBe(false)
  })

  it('selectConversation 切换当前会话', () => {
    useAgentStore.setState({ activeConversationId: 'a' })

    useAgentStore.getState().selectConversation('b')

    expect(useAgentStore.getState().activeConversationId).toBe('b')
  })
})
