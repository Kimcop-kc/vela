/**
 * CanonStore 的 IPC 转发契约与失败语义
 *
 * 这个文件是 `canon-store.ts` 那轮重构的回归护栏。重构把 30+ 份复制粘贴的
 * 「try → invoke → 兜底 / catch → warn → 兜底」收敛成了几个私有包装方法，
 * 于是有两类风险需要锁住：
 *
 *   1. **搬错**：重构时把通道名或参数顺序写错，静态类型看不出来（都是 string/unknown）。
 *      下面用一张表逐个方法断言「调了哪个通道、传了什么参数」。
 *   2. **失败语义变了**：读取失败必须返回安全默认值且不抛错（长篇生成不能因为一次
 *      检索失败就整体失败），写入失败必须返回 false/null/0。以前 30 份 catch 一份都测不到，
 *      现在收敛到一处，可以整体覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { CanonStore } from '../narrative-consistency/canon-store'
import type {
  Arc,
  ChapterSummary,
  CharacterStateSnapshot,
  Fact,
  ItemEvent,
  Location,
  MemorySearchParams,
  PlotLine,
  Realm,
  TimelineEvent,
} from '../narrative-consistency/types'

/** 记录每次调用的假 IPC 客户端 */
class FakeClient {
  readonly calls: Array<{ channel: string; args: unknown[] }> = []
  constructor(private readonly reply: unknown | (() => never) = undefined) {}
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({ channel, args })
    if (typeof this.reply === 'function') return (this.reply as () => never)()
    return this.reply
  }
  get last(): { channel: string; args: unknown[] } {
    return this.calls[this.calls.length - 1]
  }
}

/** 每次都抛错的假客户端（模拟 IPC 通道不存在 / 主进程异常） */
function throwingClient(): FakeClient {
  return new FakeClient(() => { throw new Error('IPC 不可用') })
}

const timelineEvent: Omit<TimelineEvent, 'id' | 'createdAt'> = {
  chapterNumber: 3, sequence: 1, characters: ['顾野'], location: '茶棚',
  timeFlow: 'sequential', summary: '顾野拿回炭笔', impact: '欠老邵一次',
}

const characterState: CharacterStateSnapshot = {
  character: '顾野', location: '茶棚', powerLevel: '练气三层', physicalState: '轻伤',
  mentalState: '警惕', keyItems: '半截炭笔', currentGoal: '出城', knowledge: ['炭笔来历'],
  relationships: { 老邵: '交易对象' }, recentEvents: '换笔', updatedAtChapter: 3,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const plotLine: Omit<PlotLine, 'id'> = {
  name: '炭笔来历', status: 'active', startedAt: 1, lastAdvancedAt: 3,
  characters: ['顾野'], currentState: '只知道指向城外', description: '炭笔指向城外某处',
}

const fact: Omit<Fact, 'id'> = {
  category: 'item', statement: '炭笔是老邵给的', introducedAt: 3,
  characters: ['顾野'], evidence: '换笔',
}

const itemEvent: ItemEvent = { item: '炭笔', action: 'obtained', chapterNumber: 3, actor: '顾野' }
const realm: Realm = { name: '练气三层', rankOrder: 3 }
const location: Location = { name: '茶棚', region: '云州西部' }
const summary: ChapterSummary = { chapterNumber: 3, title: '换笔', summary: '顾野换回炭笔', createdAt: '2026-01-01T00:00:00.000Z' }
const arc: Omit<Arc, 'id' | 'createdAt' | 'updatedAt'> & { id?: number } = {
  title: '第一卷·风起', startChapter: 1, endChapter: 20, mainConflict: '找炭笔',
  characterDevelopment: '学会交换', keyEvents: '换笔', stageGoal: '出城', sortOrder: 1,
}
const searchParams: MemorySearchParams = { query: '炭笔', limit: 10 }

describe('CanonStore：IPC 通道与参数', () => {
  let client: FakeClient
  let store: CanonStore

  beforeEach(() => {
    client = new FakeClient(undefined)
    store = new CanonStore(client)
  })

  const cases: Array<{
    name: string
    run: (s: CanonStore) => Promise<unknown>
    channel: string
    args: unknown[]
  }> = [
    { name: 'getTimeline', run: s => s.getTimeline(12), channel: 'db:canon-timeline-get', args: [12, true] },
    { name: 'getTimeline(不含闪回)', run: s => s.getTimeline(12, false), channel: 'db:canon-timeline-get', args: [12, false] },
    { name: 'getChapterTimeline', run: s => s.getChapterTimeline(3), channel: 'db:canon-timeline-get-chapter', args: [3] },
    { name: 'appendTimelineEvent', run: s => s.appendTimelineEvent(timelineEvent), channel: 'db:canon-timeline-append', args: [timelineEvent] },
    { name: 'clearChapterTimeline', run: s => s.clearChapterTimeline(3), channel: 'db:canon-timeline-clear-chapter', args: [3] },
    { name: 'getAllCharacterStates', run: s => s.getAllCharacterStates(), channel: 'db:canon-character-state-get-all', args: [] },
    { name: 'getCharacterState', run: s => s.getCharacterState('顾野'), channel: 'db:canon-character-state-get', args: ['顾野'] },
    { name: 'upsertCharacterState', run: s => s.upsertCharacterState(characterState), channel: 'db:canon-character-state-upsert', args: [characterState] },
    { name: 'getPlotLines(无过滤)', run: s => s.getPlotLines(), channel: 'db:canon-plot-list', args: [undefined] },
    { name: 'getActivePlotLines', run: s => s.getActivePlotLines(), channel: 'db:canon-plot-list', args: ['active'] },
    { name: 'addPlotLine', run: s => s.addPlotLine(plotLine), channel: 'db:canon-plot-add', args: [plotLine] },
    { name: 'advancePlotLine', run: s => s.advancePlotLine(7, '已推进', 9), channel: 'db:canon-plot-advance', args: [7, '已推进', 9] },
    { name: 'resolvePlotLine', run: s => s.resolvePlotLine(7, 9), channel: 'db:canon-plot-resolve', args: [7, 9] },
    { name: 'updatePlotLineMeta', run: s => s.updatePlotLineMeta(7, { kind: 'foreshadow' }), channel: 'db:canon-plot-update-meta', args: [7, { kind: 'foreshadow' }] },
    { name: 'getFacts', run: s => s.getFacts(), channel: 'db:canon-fact-list', args: [] },
    { name: 'addFact', run: s => s.addFact(fact), channel: 'db:canon-fact-add', args: [fact] },
    { name: 'clearChapterFacts', run: s => s.clearChapterFacts(3), channel: 'db:canon-fact-clear-chapter', args: [3] },
    { name: 'confirmFacts', run: s => s.confirmFacts([1, 2], true), channel: 'db:canon-fact-confirm', args: [[1, 2], true] },
    { name: 'getFactHistory', run: s => s.getFactHistory(4), channel: 'db:canon-fact-history', args: [4] },
    { name: 'getItemEvents(无过滤)', run: s => s.getItemEvents(), channel: 'db:canon-item-events-list', args: [undefined] },
    { name: 'getItemEvents(按物品)', run: s => s.getItemEvents('炭笔'), channel: 'db:canon-item-events-list', args: ['炭笔'] },
    {
      name: 'addItemEvent', run: s => s.addItemEvent(itemEvent), channel: 'db:canon-item-event-add',
      args: [{ item: '炭笔', action: 'obtained', chapterNumber: 3, actor: '顾野', note: '' }],
    },
    { name: 'removeItemEvent', run: s => s.removeItemEvent(4), channel: 'db:canon-item-event-remove', args: [4] },
    { name: 'getRealms', run: s => s.getRealms(), channel: 'db:canon-realms-list', args: [] },
    {
      name: 'upsertRealm', run: s => s.upsertRealm(realm), channel: 'db:canon-realm-upsert',
      args: [{ id: undefined, name: '练气三层', rankOrder: 3, abilities: '', limits: '', breakthrough: '', notes: '' }],
    },
    { name: 'removeRealm', run: s => s.removeRealm(4), channel: 'db:canon-realm-remove', args: [4] },
    { name: 'getLocations', run: s => s.getLocations(), channel: 'db:canon-locations-list', args: [] },
    {
      name: 'upsertLocation', run: s => s.upsertLocation(location), channel: 'db:canon-location-upsert',
      args: [{ id: undefined, name: '茶棚', region: '云州西部', faction: '', distanceNote: '', travelNote: '', notes: '' }],
    },
    { name: 'removeLocation', run: s => s.removeLocation(4), channel: 'db:canon-location-remove', args: [4] },
    { name: 'markFactStatus', run: s => s.markFactStatus(4, 'outdated'), channel: 'db:canon-fact-mark-status', args: [4, 'outdated'] },
    { name: 'getRecentSummaries(默认 5)', run: s => s.getRecentSummaries(), channel: 'db:canon-summary-list-recent', args: [5] },
    { name: 'getRecentSummaries(20)', run: s => s.getRecentSummaries(20), channel: 'db:canon-summary-list-recent', args: [20] },
    { name: 'getSummariesUpTo', run: s => s.getSummariesUpTo(9), channel: 'db:canon-summary-list-up-to', args: [9] },
    { name: 'getSummary', run: s => s.getSummary(3), channel: 'db:canon-summary-get', args: [3] },
    { name: 'upsertSummary', run: s => s.upsertSummary(summary), channel: 'db:canon-summary-upsert', args: [summary] },
    { name: 'searchCanon', run: s => s.searchCanon(searchParams), channel: 'db:canon-search', args: [searchParams] },
    { name: 'getArcs', run: s => s.getArcs(), channel: 'db:canon-arcs-list', args: [] },
    { name: 'getArcForChapter', run: s => s.getArcForChapter(3), channel: 'db:canon-arc-get-for-chapter', args: [3] },
    { name: 'upsertArc', run: s => s.upsertArc(arc), channel: 'db:canon-arc-upsert', args: [arc] },
    { name: 'removeArc', run: s => s.removeArc(4), channel: 'db:canon-arc-remove', args: [4] },
    { name: 'getCharacterStateHistory(只到某章)', run: s => s.getCharacterStateHistory('顾野', 3), channel: 'db:canon-character-state-history', args: ['顾野', 3] },
    { name: 'getCharacterStateHistory(不限章)', run: s => s.getCharacterStateHistory('顾野'), channel: 'db:canon-character-state-history', args: ['顾野', undefined] },
    { name: 'getCharacterStateAtChapter', run: s => s.getCharacterStateAtChapter('顾野', 3), channel: 'db:canon-character-state-at-chapter', args: ['顾野', 3] },
    { name: 'getChapterParagraphs', run: s => s.getChapterParagraphs(3), channel: 'db:canon-chapter-paragraphs', args: [3] },
  ]

  for (const item of cases) {
    it(`${item.name} → ${item.channel}`, async () => {
      await item.run(store)
      expect(client.calls).toHaveLength(1)
      expect(client.last.channel).toBe(item.channel)
      expect(client.last.args).toEqual(item.args)
    })
  }

  it('confirmFacts 过滤掉非法 id，全非法时不发 IPC', async () => {
    const result = await store.confirmFacts([Number.NaN, 1.5, 2], true)
    expect(result).toBe(0)
    expect(client.last.channel).toBe('db:canon-fact-confirm')
    expect(client.last.args[0]).toEqual([2])
  })

  it('confirmFacts 全部非法时不调用 IPC', async () => {
    expect(await store.confirmFacts([], true)).toBe(0)
    expect(await store.confirmFacts([Number.NaN, 0.5], false)).toBe(0)
    expect(client.calls).toHaveLength(0)
  })

  it('writeback 只发一次原子 IPC，并把摘要单独写入', async () => {
    await store.writeback({
      chapterNumber: 3,
      chapterTitle: '换笔',
      chapterSummary: '顾野换回炭笔',
      chapterContent: '正文',
      newEvents: [],
      characterDeltas: [],
      plotLineChanges: {},
      newFacts: [],
    })
    expect(client.calls.map(c => c.channel)).toEqual(['db:canon-summary-upsert', 'db:canon-writeback-atomic'])
  })
})

describe('CanonStore：失败语义（读取给兜底值、写入给失败值、都不抛）', () => {
  let store: CanonStore
  let warn: MockInstance

  beforeEach(() => {
    store = new CanonStore(throwingClient())
    // 非 Electron 环境下 appLogger 会落到 console.warn
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  const readCases: Array<{ name: string; run: (s: CanonStore) => Promise<unknown>; fallback: unknown }> = [
    { name: 'getTimeline', run: s => s.getTimeline(3), fallback: [] },
    { name: 'getChapterTimeline', run: s => s.getChapterTimeline(3), fallback: [] },
    { name: 'getAllCharacterStates', run: s => s.getAllCharacterStates(), fallback: [] },
    { name: 'getCharacterState', run: s => s.getCharacterState('顾野'), fallback: null },
    { name: 'getPlotLines', run: s => s.getPlotLines(), fallback: [] },
    { name: 'getFacts', run: s => s.getFacts(), fallback: [] },
    { name: 'getFactHistory', run: s => s.getFactHistory(1), fallback: [] },
    { name: 'getItemEvents', run: s => s.getItemEvents(), fallback: [] },
    { name: 'getRealms', run: s => s.getRealms(), fallback: [] },
    { name: 'getLocations', run: s => s.getLocations(), fallback: [] },
    { name: 'getRecentSummaries', run: s => s.getRecentSummaries(), fallback: [] },
    { name: 'getSummariesUpTo', run: s => s.getSummariesUpTo(9), fallback: [] },
    { name: 'getSummary', run: s => s.getSummary(3), fallback: null },
    { name: 'getArcs', run: s => s.getArcs(), fallback: [] },
    { name: 'getArcForChapter', run: s => s.getArcForChapter(3), fallback: null },
    { name: 'getCharacterStateHistory', run: s => s.getCharacterStateHistory('顾野'), fallback: [] },
    { name: 'getCharacterStateAtChapter', run: s => s.getCharacterStateAtChapter('顾野', 3), fallback: null },
    { name: 'getChapterParagraphs', run: s => s.getChapterParagraphs(3), fallback: [] },
  ]

  for (const item of readCases) {
    it(`${item.name} 失败时返回兜底值且不抛`, async () => {
      await expect(item.run(store)).resolves.toEqual(item.fallback)
      expect(warn).toHaveBeenCalled()
    })
  }

  const writeCases: Array<{ name: string; run: (s: CanonStore) => Promise<unknown>; fallback: unknown }> = [
    { name: 'appendTimelineEvent', run: s => s.appendTimelineEvent(timelineEvent), fallback: null },
    { name: 'upsertCharacterState', run: s => s.upsertCharacterState(characterState), fallback: false },
    { name: 'addPlotLine', run: s => s.addPlotLine(plotLine), fallback: null },
    { name: 'updatePlotLineMeta', run: s => s.updatePlotLineMeta(1, {}), fallback: false },
    { name: 'addFact', run: s => s.addFact(fact), fallback: null },
    { name: 'confirmFacts', run: s => s.confirmFacts([1], true), fallback: 0 },
    { name: 'addItemEvent', run: s => s.addItemEvent(itemEvent), fallback: null },
    { name: 'removeItemEvent', run: s => s.removeItemEvent(1), fallback: false },
    { name: 'upsertRealm', run: s => s.upsertRealm(realm), fallback: null },
    { name: 'removeRealm', run: s => s.removeRealm(1), fallback: false },
    { name: 'upsertLocation', run: s => s.upsertLocation(location), fallback: null },
    { name: 'removeLocation', run: s => s.removeLocation(1), fallback: false },
    { name: 'markFactStatus', run: s => s.markFactStatus(1, 'outdated'), fallback: false },
    { name: 'upsertArc', run: s => s.upsertArc(arc), fallback: null },
    { name: 'removeArc', run: s => s.removeArc(1), fallback: false },
  ]

  for (const item of writeCases) {
    it(`${item.name} 失败时返回失败值且不抛`, async () => {
      await expect(item.run(store)).resolves.toEqual(item.fallback)
    })
  }

  it('尽力而为的写失败时也不抛（清空/推进/摘要）', async () => {
    await expect(store.clearChapterTimeline(3)).resolves.toBeUndefined()
    await expect(store.clearChapterFacts(3)).resolves.toBeUndefined()
    await expect(store.advancePlotLine(1, 'x', 2)).resolves.toBeUndefined()
    await expect(store.resolvePlotLine(1, 2)).resolves.toBeUndefined()
    await expect(store.upsertSummary(summary)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('searchCanon 失败时降级，并把失败原因写进 degradeReason', async () => {
    const result = await store.searchCanon(searchParams)
    expect(result.degraded).toBe(true)
    expect(result.hits).toEqual([])
    expect(result.total).toBe(0)
    expect(result.degradeReason).toContain('IPC 不可用')
  })

  it('searchCanon 主进程无返回时也标记降级，不假装成功', async () => {
    const empty = new CanonStore(new FakeClient(undefined))
    const result = await empty.searchCanon(searchParams)
    expect(result.degraded).toBe(true)
    expect(result.degradeReason).toBe('IPC 无返回')
  })

  it('writeback 失败时把原因放进 errors，ok 为 false', async () => {
    const result = await store.writeback({
      chapterNumber: 3, chapterTitle: '换笔', chapterSummary: '顾野换回炭笔', chapterContent: '',
      newEvents: [], characterDeltas: [], plotLineChanges: {}, newFacts: [],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('IPC 不可用')
    expect(result.conflicts).toEqual([])
    expect(result.impactCandidates).toEqual([])
  })

  it('writeback 主进程回执 success=false 时把 error 文本带出来', async () => {
    const failing = new CanonStore(new FakeClient({ success: false, error: '事务回滚' }))
    const result = await failing.writeback({
      chapterNumber: 3, chapterTitle: '换笔', chapterSummary: '顾野换回炭笔', chapterContent: '',
      newEvents: [], characterDeltas: [], plotLineChanges: {}, newFacts: [],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('事务回滚')
  })

  it('writeback 成功时带出冲突与影响候选', async () => {
    const ok = new CanonStore(new FakeClient({
      success: true,
      conflicts: [{ reason: '与第 2 章设定矛盾' }],
      impactCandidates: [{ fact, usedBy: [{ chapterNumber: 5, evidence: '引用了炭笔' }] }],
    }))
    const result = await ok.writeback({
      chapterNumber: 3, chapterTitle: '换笔', chapterSummary: '顾野换回炭笔', chapterContent: '',
      newEvents: [], characterDeltas: [], plotLineChanges: {}, newFacts: [],
    })
    expect(result.ok).toBe(true)
    expect(result.conflicts).toEqual(['与第 2 章设定矛盾'])
    expect(result.impactCandidates).toHaveLength(1)
  })
})
