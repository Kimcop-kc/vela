/**
 * 工作流 Store 护栏
 *
 * 这是写稿/修稿/审稿整条链路的状态机，改坏了表现为「界面上卡住」而不是报错，
 * 所以把几条关键约定钉住：
 *   · 跑完的运行必须从 activeRuns 移出并进入 history（否则状态栏胶囊永远显示「进行中」）；
 *   · 某一步抛错要中断后续步骤，并保留 error 文案；
 *   · 取消后不得再执行后续步骤；
 *   · 同名工作流已在运行时不得并发启动第二份 —— 双击按钮会各自算出版本号 1 落下重复草稿；
 *   · 步进模式下每步结束要挂起等待确认，confirmContinue 之后才继续；
 *   · history / globalLogs 都有上限，长跑会话不能无限增长。
 *
 * 说明：仓库的 vitest 环境是 node（没有 jsdom），因此这里把 ipc 换成了假实现，
 * 让 prompt 预加载等副作用短路，只测状态机本身。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowDefinition, WorkflowRun } from '../workflow-store'
import { useWorkflowStore } from '../workflow-store'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../services/ipc-client', () => ({
  ipc: {
    invoke: (...args: unknown[]) => mocks.invoke(...args),
    on: () => () => {},
    once: () => {},
    send: () => {},
    // 让 appLogger 走 console 分支，也让 prompt 预加载直接短路
    isElectron: false,
    setZoomLevel: () => {},
    setZoomFactor: () => {},
    getZoomLevel: () => 0,
  },
}))

vi.mock('../../services/app-logger', () => ({
  // 工作流的每次状态变化都会写一条日志，测试里静音，避免刷屏（appLogger 本身另有 electron 侧用例覆盖）
  appLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

const def = (
  title: string,
  executors: Array<() => Promise<string | void>>,
  patch: Partial<WorkflowDefinition> = {},
): WorkflowDefinition => ({
  type: 'directory',
  title,
  steps: executors.map((executor, i) => ({
    name: `步骤${i + 1}`,
    description: `第 ${i + 1} 步`,
    executor,
  })),
  ...patch,
})

const makeRun = (id: string, title = id): WorkflowRun => ({
  id,
  type: 'directory',
  title,
  status: 'completed',
  steps: [],
  currentStepIndex: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
})

describe('工作流 Store', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    useWorkflowStore.setState({
      activeRuns: [],
      history: [],
      globalLogs: [],
      waitingRuns: {},
      currentRun: null,
      waitingForConfirm: false,
      waitingAfterStepIndex: -1,
    })
  })

  it('跑完后移入历史，步骤全部 completed，兼容字段复位', async () => {
    const calls: string[] = []
    const runId = await useWorkflowStore.getState().startWorkflow(def('目录生成', [
      async () => { calls.push('s1'); return '第一步结果' },
      async () => { calls.push('s2') },
    ]))

    const state = useWorkflowStore.getState()
    expect(calls).toEqual(['s1', 's2'])
    expect(state.activeRuns).toHaveLength(0)
    expect(state.history).toHaveLength(1)

    const run = state.history[0]
    expect(run.id).toBe(runId)
    expect(run.status).toBe('completed')
    expect(run.steps.map(s => s.status)).toEqual(['completed', 'completed'])
    expect(run.steps[0].result).toBe('第一步结果')
    expect(run.steps[0].progress).toBe(100)
    expect(run.completedAt).toBeTruthy()

    expect(state.currentRun).toBeNull()
    expect(state.waitingForConfirm).toBe(false)
    expect(state.waitingAfterStepIndex).toBe(-1)
  })

  it('某一步抛错时标记 failed 并中断后续步骤，error 文案保留', async () => {
    const calls: string[] = []
    await useWorkflowStore.getState().startWorkflow(def('失败流程', [
      async () => { calls.push('s1') },
      async () => { calls.push('s2'); throw new Error('模型返回空') },
      async () => { calls.push('s3') },
    ]))

    const run = useWorkflowStore.getState().history[0]
    expect(calls).toEqual(['s1', 's2'])
    expect(run.status).toBe('failed')
    expect(run.steps.map(s => s.status)).toEqual(['completed', 'failed', 'pending'])
    expect(run.steps[1].error).toBe('模型返回空')
    expect(useWorkflowStore.getState().activeRuns).toHaveLength(0)
  })

  it('取消后不再执行后续步骤，运行以 failed 收尾并进入历史', async () => {
    const calls: string[] = []
    await useWorkflowStore.getState().startWorkflow(def('可取消流程', [
      async () => { calls.push('s1'); useWorkflowStore.getState().cancelWorkflow() },
      async () => { calls.push('s2') },
    ]))

    const state = useWorkflowStore.getState()
    expect(calls).toEqual(['s1'])
    expect(state.activeRuns).toHaveLength(0)
    expect(state.history).toHaveLength(1)
    expect(state.history[0].status).toBe('failed')
    // 第二步从未启动
    expect(state.history[0].steps[1].status).toBe('pending')
    expect(state.globalLogs.some(entry => entry.level === 'warn')).toBe(true)
  })

  it('同名工作流已在运行时不再启动第二份，直接复用其 runId', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const definition = def('重复流程', [async () => { await gate }])

    const first = useWorkflowStore.getState().startWorkflow(definition)
    await vi.waitFor(() => expect(useWorkflowStore.getState().activeRuns).toHaveLength(1))
    const firstId = useWorkflowStore.getState().activeRuns[0].id

    const secondId = await useWorkflowStore.getState().startWorkflow(definition)

    expect(secondId).toBe(firstId)
    expect(useWorkflowStore.getState().activeRuns).toHaveLength(1)
    expect(useWorkflowStore.getState().globalLogs.some(entry => entry.level === 'warn')).toBe(true)

    release()
    await first
  })

  it('步进模式：每步结束后挂起等待确认，confirmContinue 之后才继续', async () => {
    const calls: string[] = []
    const pending = useWorkflowStore.getState().startWorkflow(def('步进流程', [
      async () => { calls.push('s1') },
      async () => { calls.push('s2') },
    ]), true)

    await vi.waitFor(() => expect(useWorkflowStore.getState().waitingForConfirm).toBe(true))
    expect(calls).toEqual(['s1'])
    expect(useWorkflowStore.getState().currentRun?.status).toBe('waiting')
    expect(useWorkflowStore.getState().waitingAfterStepIndex).toBe(0)

    useWorkflowStore.getState().confirmContinue()
    await pending

    expect(calls).toEqual(['s1', 's2'])
    expect(useWorkflowStore.getState().waitingForConfirm).toBe(false)
    expect(useWorkflowStore.getState().history[0].status).toBe('completed')
  })

  it('历史记录只保留最近 50 条', async () => {
    useWorkflowStore.setState({ history: Array.from({ length: 50 }, (_, i) => makeRun(`old-${i}`)) })

    await useWorkflowStore.getState().startWorkflow(def('新流程', [async () => {}]))

    const history = useWorkflowStore.getState().history
    expect(history).toHaveLength(50)
    expect(history[0].title).toBe('新流程')
    expect(history[history.length - 1].id).toBe('old-48')
  })

  it('全局日志只保留最近 500 条', () => {
    useWorkflowStore.setState({
      globalLogs: Array.from({ length: 500 }, (_, i) => ({ time: '00:00:00', level: 'info' as const, message: `旧日志 ${i}` })),
    })

    useWorkflowStore.getState().addLog('warn', '新日志')

    const logs = useWorkflowStore.getState().globalLogs
    expect(logs).toHaveLength(500)
    expect(logs[0].message).toBe('旧日志 1')
    expect(logs[logs.length - 1]).toMatchObject({ level: 'warn', message: '新日志' })

    useWorkflowStore.getState().clearLogs()
    expect(useWorkflowStore.getState().globalLogs).toEqual([])
  })

  it('便捷查询反映当前活跃任务与步骤进度', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })

    expect(useWorkflowStore.getState().hasActiveRun()).toBe(false)
    expect(useWorkflowStore.getState().activeCount()).toBe(0)
    expect(useWorkflowStore.getState().getActiveStepInfo()).toBeNull()
    expect(useWorkflowStore.getState().getActiveStreamingRun()).toBeNull()

    const pending = useWorkflowStore.getState().startWorkflow({
      type: 'chapter_creation',
      title: '章节创作',
      steps: [
        { name: '写稿', description: '写', executor: async (_step, _ctx, cb) => { cb.setProgress(40); await gate } },
        { name: '修稿', description: '修', executor: async () => {} },
      ],
    })

    await vi.waitFor(() => expect(useWorkflowStore.getState().getActiveStepInfo()?.progress).toBe(40))

    const info = useWorkflowStore.getState().getActiveStepInfo()
    expect(info).toMatchObject({ title: '章节创作', stepName: '写稿', progress: 40, total: 2, completed: 0 })
    expect(useWorkflowStore.getState().isTypeRunning('chapter_creation')).toBe(true)
    expect(useWorkflowStore.getState().isTypeRunning('directory')).toBe(false)
    expect(useWorkflowStore.getState().activeCount()).toBe(1)
    expect(useWorkflowStore.getState().currentRun?.title).toBe('章节创作')
    expect(useWorkflowStore.getState().getActiveStreamingRun()?.title).toBe('章节创作')

    release()
    await pending

    expect(useWorkflowStore.getState().hasActiveRun()).toBe(false)
    expect(useWorkflowStore.getState().getActiveStreamingRun()).toBeNull()
  })
})
