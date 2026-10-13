/**
 * 历史边界回归测试（temporal-canon）
 *
 * 核心约束：为「第 N 章」组装上下文时，绝不能把第 N 章之后才发生的内容注入。
 * 旧实现有两处泄漏：
 *   - mergeCharacterStates 固定「canon 表优先」，canon 里存的是全书最新状态，
 *     重写第 3 章时会把第 40 章的状态当成第 3 章的人物现状。
 *   - getRecentSummaries / getFacts / getActivePlotLines 不带章节上限，
 *     后续章节的摘要、AI 提取的候选事实、未来才推进的剧情线都会混进来。
 *
 * 这里逐条锁死：新状态覆盖旧状态、未来状态不泄漏、资料缺失要留痕。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../../../electron/database'
import { CanonRepository } from '../../../electron/repositories/canon-repository'
import { buildCanonContext } from '../narrative-consistency/context-builder'
import { CanonStore } from '../narrative-consistency/canon-store'
import type { CharacterStateSnapshot } from '../narrative-consistency'

let dir = ''
let canonStoreModule: typeof import('../narrative-consistency/canon-store')
let restore: () => void

/**
 * 用真实数据库的仓储方法接管 canonStore 单例。
 *
 * canonStore 是渲染进程单例，内部走 window.ipc；在 Node 测试环境里拿不到窗口。
 * 这里用「直接路由到 CanonRepository 静态方法」的 fake IPC 顶掉单例方法，
 * 既跑在真实 SQLite 上，又不需要改业务代码去支持注入。
 */
function bridgeCanonStore() {
  const fakeIpc = {
    invoke: async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case 'db:canon-timeline-get': return CanonRepository.getTimelineUpTo(args[0] as number, args[1] as boolean)
        case 'db:canon-summary-list-up-to': return CanonRepository.getSummariesUpTo(args[0] as number)
        case 'db:canon-plot-list': return CanonRepository.getPlotLines(args[0] ? { status: args[0] as never } : undefined)
        case 'db:canon-fact-list': return CanonRepository.getFacts()
        case 'db:canon-character-state-get-all': return CanonRepository.getAllCharacterStates()
        case 'db:canon-arc-get-for-chapter': return CanonRepository.getArcForChapter(args[0] as number)
        case 'db:canon-item-events-list': return CanonRepository.getItemEvents(args[0] as string | undefined)
        case 'db:canon-realms-list': return CanonRepository.getRealms()
        case 'db:canon-locations-list': return CanonRepository.getLocations()
        case 'db:canon-character-state-history': return CanonRepository.getCharacterStateHistory(args[0] as string, args[1] as number | undefined)
        default: return { success: true }
      }
    },
  } as never

  const store = new CanonStore(fakeIpc)
  const originals = new Map<string, unknown>()
  const names = [
    'getTimeline', 'getSummariesUpTo', 'getPlotLines', 'getFacts',
    'getAllCharacterStates', 'getArcForChapter', 'getItemEvents',
    'getRealms', 'getLocations', 'getCharacterStateHistory',
  ] as const
  const target = canonStoreModule.canonStore as never as Record<string, unknown>
  const source = store as never as Record<string, unknown>
  for (const name of names) {
    const original = source[name] as (...args: unknown[]) => unknown
    originals.set(name, target[name])
    target[name] = original.bind(store)
  }
  restore = () => {
    for (const name of names) {
      target[name] = originals.get(name)
    }
  }
}

function snapshot(
  character: string,
  chapter: number,
  patch: Partial<CharacterStateSnapshot> = {},
): CharacterStateSnapshot {
  return {
    character,
    location: '', powerLevel: '', physicalState: '', mentalState: '',
    keyItems: '', currentGoal: '', knowledge: [], relationships: {},
    recentEvents: '', updatedAtChapter: chapter, updatedAt: new Date(0).toISOString(),
    ...patch,
  }
}

type TestCharacter = {
  name: string
  role: string
  currentState?: {
    location?: string
    powerLevel?: string
    physicalState?: string
    mentalState?: string
    keyItems?: string
    recentEvents?: string
    updatedAtChapter?: number
    knowledge?: string[]
    relationships?: Record<string, string>
    currentGoal?: string
  }
}

async function build(chapterNumber: number, characters: TestCharacter[] = []) {
  return buildCanonContext({
    chapterNumber,
    architecture: { premise: '', charactersArch: '', worldbuilding: '', synopsis: '' },
    characters, chapterGoal: '', previousEnding: '', ragContext: '',
    writingStyle: '', globalGuidance: '',
  })
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vela-temporal-canon-'))
  initProjectDatabase(dir)
  canonStoreModule = await import('../narrative-consistency/canon-store')
  bridgeCanonStore()
})

afterEach(() => {
  restore()
  closeProjectDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('角色状态：新状态覆盖旧状态，未来状态不泄漏', () => {
  it('重写早章时，canon 里的未来状态不会被当成该章现状', async () => {
    // canon 表存的是全书最新状态（第 40 章）
    await CanonRepository.upsertCharacterState(snapshot('林轩', 40, {
      location: '天枢城', powerLevel: '金丹期', physicalState: '重伤',
    }) as never)

    const canon = await build(3, [{ name: '林轩', role: 'protagonist' }])
    const state = canon.characterStates.find(s => s.character === '林轩')

    expect(state).toBeDefined()
    // 第 40 章的位置/境界/伤势都晚于第 3 章，绝不能出现在第 3 章的上下文里
    expect(state?.location).not.toBe('天枢城')
    expect(state?.powerLevel).not.toBe('金丹期')
    expect(state?.physicalState).not.toBe('重伤')
  })

  it('存在不晚于本章的历史快照时，取最近的那一条（而不是最新整体）', async () => {
    // 当前状态表只留最新一行（第 9 章），历史链里存着第 2 章的旧快照
    CanonRepository.appendCharacterStateHistory({
      character: '林轩', chapterNumber: 2,
      snapshot: snapshot('林轩', 2, { location: '青石镇' }),
    })
    await CanonRepository.upsertCharacterState(snapshot('林轩', 9, { location: '天枢城' }) as never)

    const canon = await build(5, [{ name: '林轩', role: 'protagonist' }])
    const state = canon.characterStates.find(s => s.character === '林轩')

    expect(state?.location).toBe('青石镇')
    expect(state?.updatedAtChapter).toBe(2)
  })

  it('角色卡比 canon 新且都不晚于本章时，角色卡的状态优先', async () => {
    await CanonRepository.upsertCharacterState(snapshot('林轩', 3, { mentalState: '平静' }) as never)

    const canon = await build(6, [{
      name: '林轩',
      role: 'protagonist',
      // 角色卡记录在第 5 章更新（比 canon 的第 3 章新）
      currentState: { mentalState: '焦躁', updatedAtChapter: 5 } as never,
    }])
    const state = canon.characterStates.find(s => s.character === '林轩')

    expect(state?.mentalState).toBe('焦躁')
    expect(state?.updatedAtChapter).toBe(5)
  })

  it('较新来源的空字段不会抹掉较旧来源的实值', async () => {
    await CanonRepository.upsertCharacterState(snapshot('林轩', 3, {
      location: '青石镇', powerLevel: '练气期',
    }) as never)

    // 第 5 章只更新了心理状态，位置留空
    const canon = await build(6, [{
      name: '林轩',
      role: 'protagonist',
      currentState: { mentalState: '紧张', updatedAtChapter: 5 } as never,
    }])
    const state = canon.characterStates.find(s => s.character === '林轩')

    // 第 5 章没给位置，应沿用第 3 章的「青石镇」，而不是被清空
    expect(state?.location).toBe('青石镇')
    expect(state?.mentalState).toBe('紧张')
  })

  it('knowledge / relationships 跨来源取并集，不从旧状态里丢失', async () => {
    await CanonRepository.upsertCharacterState(snapshot('林轩', 3, {
      knowledge: ['西墙刻痕的来历'],
      relationships: { 顾野: '同门' },
    }) as never)

    const canon = await build(6, [{
      name: '林轩',
      role: 'protagonist',
      currentState: {
        knowledge: ['周家的布防图'],
        relationships: { 周德: '对手' },
        updatedAtChapter: 5,
      } as never,
    }])
    const state = canon.characterStates.find(s => s.character === '林轩')

    expect(state?.knowledge).toContain('西墙刻痕的来历')
    expect(state?.knowledge).toContain('周家的布防图')
    expect(state?.relationships).toMatchObject({ 顾野: '同门', 周德: '对手' })
  })

  it('第 1 章没有历史状态时不会凭空捏造一个', async () => {
    const canon = await build(1, [{ name: '林轩', role: 'protagonist' }])
    const state = canon.characterStates.find(s => s.character === '林轩')

    expect(state).toBeDefined()
    expect(state?.location).toBe('')
    expect(state?.powerLevel).toBe('')
  })

  it('只有未来状态可用时，明确记录「未注入未来状态」而不是静默留空', async () => {
    await CanonRepository.upsertCharacterState(snapshot('林轩', 40, { location: '天枢城' }) as never)

    const canon = await build(3, [{ name: '林轩', role: 'protagonist' }])

    expect(canon.contextSources?.warnings.some(w => w.includes('林轩'))).toBe(true)
    expect(canon.contextSources?.warnings.some(w => w.includes('未注入'))).toBe(true)
  })
})

describe('摘要 / 事实 / 剧情线：同样遵守本章上限', () => {
  it('未来章节的摘要不会被注入早章', async () => {
    CanonRepository.upsertSummary({ chapterNumber: 2, title: '第二章', summary: '第二章摘要', createdAt: '' } as never)
    CanonRepository.upsertSummary({ chapterNumber: 30, title: '第三十章', summary: '第三十章摘要', createdAt: '' } as never)

    const canon = await build(5)

    expect(canon.recentChapterSummaries).toContain('第二章摘要')
    expect(canon.recentChapterSummaries).not.toContain('第三十章摘要')
  })

  it('晚于本章引入的候选事实不会注入', async () => {
    CanonRepository.addFact({
      category: 'item', statement: '早章事实', introducedAt: 2, characters: [], status: 'active',
    } as never)
    CanonRepository.addFact({
      category: 'item', statement: '未来事实', introducedAt: 30, characters: [], status: 'active',
    } as never)

    const canon = await build(5)
    const statements = canon.knownFacts.map(f => f.statement)

    expect(statements).toContain('早章事实')
    expect(statements).not.toContain('未来事实')
  })

  it('起始章节晚于本章的剧情线不注入，并留下提示', async () => {
    CanonRepository.addPlotLine({
      name: '第三章才开的线', description: '第三章开启',
      status: 'active', startedAt: 3, lastAdvancedAt: 3,
      currentState: '进行中', characters: [],
    } as never)
    CanonRepository.addPlotLine({
      name: '第十五章才开的线', description: '第十五章开启',
      status: 'active', startedAt: 15, lastAdvancedAt: 15,
      currentState: '进行中', characters: [],
    } as never)

    const canon = await build(5)
    const names = canon.openPlotLines.map(l => l.name)

    expect(names).toContain('第三章才开的线')
    expect(names).not.toContain('第十五章才开的线')
    expect(canon.contextSources?.warnings.some(w => w.includes('第十五章才开的线'))).toBe(true)
  })

  it('剧情线的最新进度晚于本章时，按「规划中」处理、不注入未来进度', async () => {
    CanonRepository.addPlotLine({
      name: '跨卷主线', description: '背景',
      status: 'active', startedAt: 3, lastAdvancedAt: 20,
      currentState: '第20章已经推进到天枢城',
      characters: [],
    } as never)

    const canon = await build(5)
    const line = canon.openPlotLines.find(l => l.name === '跨卷主线')

    expect(line).toBeDefined()
    expect(line?.currentState).not.toContain('第20章已经推进到天枢城')
    expect(canon.contextSources?.warnings.some(w => w.includes('跨卷主线'))).toBe(true)
  })
})

describe('原始来源可追溯', () => {
  it('contextSources 保留截至本章的原始行，供预览逐条追溯', async () => {
    CanonRepository.addItemEvent({ item: '炭笔', action: 'obtained', chapterNumber: 2, actor: '顾野' } as never)
    CanonRepository.addItemEvent({ item: '长刀', action: 'obtained', chapterNumber: 40, actor: '林轩' } as never)

    const canon = await build(5)

    expect(canon.contextSources?.itemEvents.map(e => e.item)).toContain('炭笔')
    expect(canon.contextSources?.itemEvents.map(e => e.item)).not.toContain('长刀')
    expect(canon.itemLedger).toContain('炭笔')
    expect(canon.itemLedger).not.toContain('长刀')
  })
})
