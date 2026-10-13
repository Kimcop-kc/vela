/**
 * 写作流水线（第四阶段）—— 端到端验收测试
 *
 * 对应需求「七、验收测试」7 项，逐条落成可执行用例：
 *   1. 中途关闭程序后恢复生成
 *   2. 单独重写一个场景
 *   3. 润色后剧情事实不变
 *   4. 分段生成不会重复大段前文
 *   5. 章节目标、场景目标和结尾目标能够检查
 *   6. 生成失败不会覆盖原文
 *   7. 修改大纲后可以重新规划尚未确认的部分
 *
 * 模型通道用替身：真实 `llm:generate` 只在 Electron 里可用，
 * 这里只验证「提示词怎么发、结果怎么落、失败怎么办」这套编排逻辑，
 * 不验证模型本身的写作水平。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 模型用途解析：默认返回一个可用模型，测「没有可用模型」时再置空
const llm = vi.hoisted(() => ({ modelId: 'mock-model' as string | null }))

vi.mock('../ipc-client', () => ({ ipc: { invoke: vi.fn(), on: vi.fn() } }))
vi.mock('../../stores/llm-store', () => ({
  useLLMStore: { getState: () => ({ resolveModelId: () => llm.modelId }) },
}))

import { ipc } from '../ipc-client'
import {
  assertFactsUnchanged,
  buildChapterPlan,
  buildScenes,
  composeConfirmedText,
  confirmSegment,
  createSegment,
  generateScene,
  needsReplan,
  outlineFingerprint,
  recoverInterrupted,
  replanUnconfirmed,
  runChapterSelfCheck,
  transitionSegment,
  unfinishedSegments,
  type ChapterPlan,
  type PipelineSegment,
  type PipelineState,
  type ScenePlan,
  type WritingMode,
} from '../reconstruct/writing-pipeline'
import type { PlotBeat, PlotOutlineRecord } from '../../shared/reconstruct'

// ============================================================
// 夹具
// ============================================================

/** 描述性事件（不是「事件1」这种模板串，避免覆盖度检查假通过） */
const BEATS: PlotBeat[] = [
  {
    sequence: 1,
    title: '醒来',
    event: '顾野在废土暗袋里醒来，发现身上只剩半截炭笔',
    protagonistAction: '摸索暗袋确认丢了多少东西',
    conflict: '被人搜过身却毫无印象',
    consequence: '意识到昏迷期间被人动过手脚',
    characterChange: '从昏迷的迟钝转为警惕',
    hook: '到底是谁搜了他的身',
  },
  {
    sequence: 2,
    title: '茶棚对质',
    event: '顾野在茶棚堵住老邵对质',
    protagonistAction: '把空暗袋拍在桌上',
    conflict: '老邵咬死不认，还说顾野自己弄丢了',
    consequence: '两人谈崩，茶棚里的人开始围观',
    characterChange: '从警惕转为决意摊牌',
    hook: '老邵袖口露出半截炭笔的黑痕',
  },
  {
    sequence: 3,
    title: '用消息换笔',
    event: '老邵提出用一条消息换回炭笔',
    protagonistAction: '权衡之后答应交换',
    conflict: '消息真假难辨，欠下人情',
    consequence: '顾野拿回炭笔，但欠老邵一次',
    characterChange: '从决意转为迟疑',
    hook: '消息指向城外那处塌方',
  },
]

const OUTLINE: PlotOutlineRecord = {
  id: 1,
  title: '炭笔',
  premise: '顾野在废土上找回一支被扣下的炭笔',
  protagonistGoal: '拿回炭笔',
  centralConflict: '炭笔被老邵扣下，顾野没有可以交换的筹码',
  characterChanges: '顾野从硬抢改为学会交换',
  foreshadowing: '炭笔的来历',
  continuityNotes: '',
  originalityNotes: '',
  techniques: [],
  beats: BEATS,
  sources: [],
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const PLAN: ChapterPlan = buildChapterPlan({ outline: OUTLINE, beats: BEATS })

function scenes(): ScenePlan[] {
  return buildScenes({ beats: BEATS, totalWords: 2400 })
}

/** 造一个「已生成」的段落 */
function generated(scene: ScenePlan, text: string): PipelineSegment {
  return transitionSegment(
    transitionSegment(createSegment(scene), 'generating'),
    'generated',
    { text },
  )
}

/** 造一个「已确认」的段落（作者过目过的正文） */
function confirmed(scene: ScenePlan, text: string): PipelineSegment {
  return confirmSegment(generated(scene, text))
}

/** 让 `llm:generate` 按顺序返回给定内容；`success: false` 模拟调用失败 */
function mockLLM(replies: Array<{ success?: boolean; content?: string; error?: string }> | ((index: number) => { success?: boolean; content?: string; error?: string })) {
  let index = 0
  vi.mocked(ipc.invoke).mockImplementation(async (channel, ...args) => {
    if (channel !== 'llm:generate') return { success: true } as never
    const reply = typeof replies === 'function' ? replies(index) : (replies[Math.min(index, replies.length - 1)] ?? {})
    index += 1
    void args
    return reply as never
  })
}

/** 取最近一次 `llm:generate` 的请求参数 */
function lastRequest(): { modelId: string; messages: Array<{ role: string; content: string }>; purpose?: string } {
  const call = vi.mocked(ipc.invoke).mock.calls.filter(item => item[0] === 'llm:generate').at(-1)
  if (!call) throw new Error('没有调用过 llm:generate')
  return call[1] as never
}

/** 复刻界面里「按场景生成」的编排：已确认的段落一律跳过 */
async function resumePipeline(
  sceneList: ScenePlan[],
  segments: PipelineSegment[],
  mode: WritingMode = 'outline-expand',
): Promise<PipelineSegment[]> {
  let current = segments
  for (const scene of sceneList) {
    const existing = current.find(segment => segment.sequence === scene.sequence)
    if (existing?.status === 'confirmed') continue
    const started = current.map(segment =>
      segment.sequence === scene.sequence ? transitionSegment(segment, 'generating') : segment,
    )
    const result = await generateScene({
      mode,
      plan: PLAN,
      scene,
      segments: started,
      scenes: sceneList,
      canonRendered: '',
      ownNovel: '',
    })
    current = started.map(segment => (segment.sequence === scene.sequence ? result.segment : segment))
  }
  return current
}

beforeEach(() => {
  llm.modelId = 'mock-model'
  vi.mocked(ipc.invoke).mockReset()
  mockLLM([{ success: true, content: '（占位正文）' }])
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================

describe('验收 1：中途关闭程序后恢复生成', () => {
  it('重开后「生成中」归位为「失败，可重试」，继续生成时已确认正文一字不动', async () => {
    const sceneList = scenes()
    const firstText = '顾野在暗袋里醒来，手指摸到的只有半截炭笔。他躺了很久才把眼睛睁开。'
    // 关闭前：第 1 段已确认，第 2 段正在生成（进程被杀），第 3 段还没开始
    const before = [confirmed(sceneList[0], firstText), transitionSegment(createSegment(sceneList[1]), 'generating'), createSegment(sceneList[2])]
    expect(unfinishedSegments(before)).toHaveLength(2)

    // 重开程序：读回来的状态里「生成中」不能永远卡住
    const restored = recoverInterrupted(before)
    expect(restored[1].status).toBe('failed')
    expect(restored[1].error).toContain('中断')

    mockLLM(index => ({ success: true, content: `第 ${index + 2} 段新生成的正文，承接前文继续往下写。` }))
    const after = await resumePipeline(sceneList, restored)

    // 已确认的第 1 段原样保留（连对象都没换）
    expect(after[0]).toBe(restored[0])
    expect(after[0].confirmedText).toBe(firstText)
    expect(after[1].status).toBe('generated')
    expect(after[2].status).toBe('generated')
    expect(unfinishedSegments(after)).toHaveLength(0)
    // 恢复后合成正文里，第 1 段还是原来那段
    expect(composeConfirmedText(after)).toBe(firstText)
  })

  it('恢复时用的是完整前文，而不是上一段末尾 600 字', async () => {
    const sceneList = scenes()
    // 第 1 段很长，独特标记只出现在开头——旧实现（只取末尾 600 字）会把它丢掉
    const marker = '开头标记：暗袋里只剩半截炭笔。'
    const longText = marker + '他沿着废土的沟壑往前走，风把沙粒吹进领口。'.repeat(40)
    expect(longText.length).toBeGreaterThan(700)

    const restored = [confirmed(sceneList[0], longText), createSegment(sceneList[1])]
    mockLLM(() => ({ success: true, content: '第二段正文。' }))
    await resumePipeline(sceneList, restored)

    const request = lastRequest()
    const user = request.messages.find(message => message.role === 'user')!.content
    expect(user).toContain(marker)
    expect(request.purpose).toBe('reconstruct_draft')
  })
})

describe('验收 2：单独重写一个场景', () => {
  it('只动被重写的那一段，其它已确认段落一个字都不变', async () => {
    const sceneList = scenes()
    const one = confirmed(sceneList[0], '第一段正文。')
    const two = confirmed(sceneList[1], '第二段正文。')
    const three = confirmed(sceneList[2], '第三段正文。')

    mockLLM(() => ({ success: true, content: '第二段重写后的正文。' }))
    // 已确认段落必须先退回编辑态，避免误点直接顶掉正文
    const prepared = transitionSegment(two, 'editing')
    const running = [one, prepared, three].map(segment =>
      segment.sequence === 2 ? transitionSegment(segment, 'generating') : segment,
    )
    const result = await generateScene({
      mode: 'rewrite',
      plan: PLAN,
      scene: sceneList[1],
      segments: running,
      scenes: sceneList,
      canonRendered: '',
      ownNovel: '',
      instruction: '把老邵的抵赖写得更硬',
    })
    const after = running.map(segment => (segment.sequence === 2 ? result.segment : segment))

    expect(after[1].text).toBe('第二段重写后的正文。')
    expect(after[0]).toBe(one)
    expect(after[2]).toBe(three)
    expect(after[0].confirmedText).toBe('第一段正文。')
    expect(after[2].confirmedText).toBe('第三段正文。')
    // 重写后第 2 段还没被确认，正文里仍是旧的确认稿
    expect(composeConfirmedText(after)).toBe('第一段正文。\n\n第二段正文。\n\n第三段正文。')
  })
})

describe('验收 3：润色后剧情事实不变', () => {
  const source = '顾野把炭笔收进暗袋，转身走向茶棚。老邵坐在长凳上，始终没有抬头看他一眼。'
  const polished = '顾野将炭笔塞进暗袋，抬脚朝茶棚走去。老邵倚着长凳，自始至终没抬眼看他。'

  it('只改表达、事件与人物认知都没变时判定为通过', () => {
    const drift = assertFactsUnchanged(source, polished, ['顾野', '老邵'])
    expect(drift.ok).toBe(true)
    expect(drift.addedEvents).toHaveLength(0)
    expect(drift.removedEvents).toHaveLength(0)
    expect(drift.knowledgeAdded).toHaveLength(0)
  })

  it('章节自检里对润色模式额外给出事实比对结论', async () => {
    const sceneList = scenes()
    const segments = [transitionSegment(
      transitionSegment(createSegment(sceneList[0]), 'generating'), 'generated', { text: polished },
    )]
    const check = await runChapterSelfCheck({
      chapterNumber: 1,
      plan: PLAN,
      scenes: sceneList,
      segments,
      targetWords: 800,
      canon: null,
      mode: 'polish',
      polishSource: source,
      characters: ['顾野', '老邵'],
    })
    expect(check.polishDrift).not.toBeNull()
    expect(check.polishDrift!.ok).toBe(true)
    expect(check.summary).toContain('润色事实比对')
  })

  it('非润色模式不做事实比对（不会拿扩写去跟原文对账）', async () => {
    const sceneList = scenes()
    const check = await runChapterSelfCheck({
      chapterNumber: 1,
      plan: PLAN,
      scenes: sceneList,
      segments: [generated(sceneList[0], polished)],
      targetWords: 800,
      canon: null,
      mode: 'outline-expand',
    })
    expect(check.polishDrift).toBeNull()
  })
})

describe('验收 4：分段生成不会重复大段前文', () => {
  it('模型把前文整段复述出来时会被检出', async () => {
    const sceneList = scenes()
    const firstText = '顾野在暗袋里醒来，手指摸到的只有半截炭笔。他躺了很久才把眼睛睁开，风从破口灌进来。'
    const restored = [generated(sceneList[0], firstText), createSegment(sceneList[1])]

    // 模型偷懒：把前文整段抄回来当新的一段
    mockLLM(() => ({ success: true, content: `他躺了很久才把眼睛睁开，风从破口灌进来。${firstText}` }))
    const result = await generateScene({
      mode: 'continue',
      plan: PLAN,
      scene: sceneList[1],
      segments: restored,
      scenes: sceneList,
      canonRendered: '',
      ownNovel: '',
    })

    expect(result.segment.status).toBe('generated')
    expect(result.repetition).not.toBeNull()
    expect(result.repetition!.length).toBeGreaterThanOrEqual(12)
    // 检出后仍然落库，交给作者决定是否重写（不自动改稿）
    expect(result.segment.text.length).toBeGreaterThan(0)
  })

  it('正常接续（只是自然衔接）不会被误报', async () => {
    const sceneList = scenes()
    const restored = [generated(sceneList[0], '顾野在暗袋里醒来，手指摸到的只有半截炭笔。'), createSegment(sceneList[1])]
    mockLLM(() => ({ success: true, content: '他撑着墙站起来，把空暗袋翻了个底朝天，还是什么都没有。' }))
    const result = await generateScene({
      mode: 'continue',
      plan: PLAN,
      scene: sceneList[1],
      segments: restored,
      scenes: sceneList,
      canonRendered: '',
      ownNovel: '',
    })
    expect(result.repetition).toBeNull()
    expect(result.segment.status).toBe('generated')
  })

  it('提示词里明确列出「已交代过的信息」，避免不同场景重复交代', async () => {
    const sceneList = scenes()
    const restored = [generated(sceneList[0], '第一段正文。'), createSegment(sceneList[1])]
    mockLLM(() => ({ success: true, content: '第二段正文。' }))
    await generateScene({
      mode: 'outline-expand',
      plan: PLAN,
      scene: sceneList[1],
      segments: restored,
      scenes: sceneList,
      canonRendered: '',
      ownNovel: '',
    })
    const user = lastRequest().messages.find(message => message.role === 'user')!.content
    expect(user).toContain(sceneList[0].reveal)
  })
})

describe('验收 5：章节目标、场景目标和结尾目标能够检查', () => {
  it('自检同时给出章节目标 / 场景目标 / 结尾目标 / 必要事件等检查项', async () => {
    const sceneList = scenes()
    const segments = sceneList.map(scene => generated(scene, `${scene.purpose}。${scene.openQuestion}。`))
    const check = await runChapterSelfCheck({
      chapterNumber: 1,
      plan: PLAN,
      scenes: sceneList,
      segments,
      targetWords: 2400,
      canon: null,
    })
    const keys = check.goals.map(goal => goal.key)
    expect(keys).toContain('goal')
    expect(keys).toContain('scene')
    expect(keys).toContain('ending')
    expect(keys).toContain('must-event')
    expect(check.goals.every(goal => goal.detail.length > 0)).toBe(true)
    expect(check.summary.length).toBeGreaterThan(0)
  })

  it('缺事件时明确指出缺了什么，不谎报通过', async () => {
    const sceneList = scenes()
    const segments = [generated(sceneList[0], '顾野醒来，什么也没发生。')]
    const check = await runChapterSelfCheck({
      chapterNumber: 1,
      plan: PLAN,
      scenes: sceneList,
      segments,
      targetWords: 2400,
      canon: null,
    })
    expect(check.needsAttention).toBe(true)
    const mustEvent = check.goals.find(goal => goal.key === 'must-event')!
    expect(mustEvent.ok).toBe(false)
  })
})

describe('验收 6：生成失败不会覆盖原文', () => {
  it('模型调用失败时只写 error，text 与 confirmedText 原样保留', async () => {
    const sceneList = scenes()
    const original = '作者认可的正文，不能被失败的生成顶掉。'
    const target = confirmed(sceneList[0], original)
    const reopened = transitionSegment(target, 'editing')

    mockLLM(() => ({ success: false, error: '模型超时' }))
    const result = await generateScene({
      mode: 'rewrite',
      plan: PLAN,
      scene: sceneList[0],
      segments: [reopened],
      scenes: sceneList,
      canonRendered: '',
      ownNovel: '',
    })

    expect(result.segment.status).toBe('failed')
    expect(result.segment.error).toContain('模型超时')
    expect(result.segment.text).toBe(original)
    expect(result.segment.confirmedText).toBe(original)
    expect(result.error).toContain('模型超时')
  })

  it('没有可用模型时同样不碰原文，并且说清原因', async () => {
    const sceneList = scenes()
    const original = '作者认可的正文。'
    const target = confirmed(sceneList[0], original)

    llm.modelId = null
    const result = await generateScene({
      mode: 'rewrite',
      plan: PLAN,
      scene: sceneList[0],
      segments: [target],
      scenes: sceneList,
      canonRendered: '',
      ownNovel: '',
    })

    expect(result.segment.status).toBe('failed')
    expect(result.segment.text).toBe(original)
    expect(result.segment.confirmedText).toBe(original)
    expect(result.error).toContain('没有可用模型')
  })
})

describe('验收 7：修改大纲后可以重新规划尚未确认的部分', () => {
  function stateWith(segments: PipelineSegment[], sceneList: ScenePlan[]): PipelineState {
    return {
      chapterNumber: 1,
      outlineId: OUTLINE.id,
      outlineFingerprint: outlineFingerprint(OUTLINE),
      plan: PLAN,
      scenes: sceneList,
      segments,
      targetWords: 2400,
      mode: 'outline-expand',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  }

  it('大纲内容变化会被识别为「策划过期」', () => {
    const sceneList = scenes()
    const state = stateWith([confirmed(sceneList[0], '第一段正文。')], sceneList)
    expect(needsReplan(state, OUTLINE)).toBe(false)

    const changed: PlotOutlineRecord = { ...OUTLINE, centralConflict: '改成老邵主动交还炭笔' }
    expect(needsReplan(state, changed)).toBe(true)
  })

  it('重规划保留已确认段落，只把未确认的重置为待生成', () => {
    const sceneList = scenes()
    const one = confirmed(sceneList[0], '第一段正文。')
    const state = stateWith([one, generated(sceneList[1], '第二段草稿。'), createSegment(sceneList[2])], sceneList)

    const changed: PlotOutlineRecord = {
      ...OUTLINE,
      beats: [...BEATS, {
        sequence: 4,
        title: '夜路',
        event: '顾野连夜出城',
        protagonistAction: '收拾行装',
        conflict: '城门已关',
        consequence: '只能翻墙',
        characterChange: '从迟疑转为行动',
        hook: '墙外有人等他',
      }],
    }
    const result = replanUnconfirmed(state, changed, changed.beats)

    expect(result.kept.map(segment => segment.sequence)).toEqual([1])
    expect(result.kept[0].confirmedText).toBe('第一段正文。')
    expect(result.resetSequences).toEqual([2, 3])
    // 新大纲多了一个 beat，场景也跟着多出来
    expect(result.scenes).toHaveLength(4)
    expect(result.outlineFingerprint).toBe(outlineFingerprint(changed))
  })
})
