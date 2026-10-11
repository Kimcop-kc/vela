/**
 * 补写圣经数据 —— 把「已经定稿但没有写回」的章节重新抽一遍。
 *
 * 为什么需要：写回逻辑上线前定稿的章节、或者写回时抽不出东西的章节（旧的启发式对正常正文几乎无效），
 * 会让故事圣经一直是空的。这个服务用现成的材料（草稿正文 + 已生成的章节要点 + 角色卡 + 蓝图）
 * 重跑一遍写回，不需要重新调用模型、也不改动正文。
 */
import { ipc } from '../ipc-client'
import { extractCanonWriteback } from './fact-extractor'
import { canonStore } from './canon-store'

export interface BackfillChapterResult {
  chapterNumber: number
  ok: boolean
  events: number
  characterStates: number
  facts: number
  foreshadows: number
  /** 章节要点缺失（写回只能靠启发式，通常抽不出什么） */
  usedNotes: boolean
  skipped?: string
  error?: string
}

export interface BackfillResult {
  total: number
  chapters: BackfillChapterResult[]
}

/**
 * 对指定章节范围补写。
 *
 * @param chapters 要处理的章节号（界面传入：缺写回的章节或全部已定稿章节）
 * @param onProgress 每章完成后的回调，界面用来显示进度
 */
export async function backfillCanonWriteback(params: {
  chapters: number[]
  onProgress?: (result: BackfillChapterResult, done: number, total: number) => void
}): Promise<BackfillResult> {
  const { chapters, onProgress } = params
  const characters = await ipc.invoke('db:character-get-all').catch(() => [] as Array<{ name: string; role: string; currentState?: Record<string, unknown> }>)
  const results: BackfillChapterResult[] = []

  for (const chapterNumber of chapters) {
    let result: BackfillChapterResult = {
      chapterNumber, ok: false, events: 0, characterStates: 0, facts: 0, foreshadows: 0, usedNotes: false,
    }
    try {
      const draft = await ipc.invoke('db:draft-get-finalized', chapterNumber).catch(() => null)
      const full = draft?.id ? await ipc.invoke('db:draft-get-full', draft.id).catch(() => null) : null
      // 没有已定稿正文就跳过（补写不该改动、也不该凭空造）
      if (!full?.content) {
        result = { ...result, skipped: 'no-finalized-draft' }
        results.push(result)
        onProgress?.(result, results.length, chapters.length)
        continue
      }

      const [blueprint, notes] = await Promise.all([
        ipc.invoke('db:blueprint-get', chapterNumber).catch(() => null),
        ipc.invoke('db:canon-summary-get', chapterNumber).catch(() => null),
      ])
      const existingNotes = notes?.summary ?? ''
      const payload = extractCanonWriteback({
        chapterNumber,
        chapterTitle: blueprint?.title || `第 ${chapterNumber} 章`,
        chapterContent: full.content,
        characters: (characters ?? []).map(character => ({
          name: character.name,
          role: character.role,
          currentState: character.currentState as { location?: string; powerLevel?: string; physicalState?: string; mentalState?: string; keyItems?: string; recentEvents?: string; updatedAtChapter?: number } | undefined,
        })),
        chapterBlueprint: blueprint ? {
          keyEvents: blueprint.keyEvents,
          characters: blueprint.characters,
          suspenseHook: blueprint.suspenseHook,
        } : undefined,
        existingNotes,
      })

      const writeback = await canonStore.writeback(payload)
      result = {
        ...result,
        ok: writeback.ok,
        events: payload.newEvents.length,
        characterStates: payload.characterDeltas.length,
        facts: payload.newFacts.length,
        foreshadows: payload.plotLineChanges.added?.length ?? 0,
        usedNotes: !!existingNotes.trim(),
        error: writeback.ok ? undefined : writeback.errors.slice(0, 2).join('；'),
      }
    } catch (error) {
      result = { ...result, error: String(error) }
    }
    results.push(result)
    onProgress?.(result, results.length, chapters.length)
  }

  return { total: chapters.length, chapters: results }
}

/**
 * 找出「已定稿但圣经里没有写回痕迹」的章节，供界面一键补写。
 *
 * 判定依据：定稿草稿存在，但该章既没有时间线事件、也没有章节摘要之外的任何写回产物。
 */
export async function findChaptersMissingWriteback(): Promise<number[]> {
  const blueprints = await ipc.invoke('db:blueprint-get-all').catch(() => [] as Array<{ chapterNumber: number }>)
  const [timeline, states, facts] = await Promise.all([
    canonStore.getTimeline(Number.MAX_SAFE_INTEGER).catch(() => []),
    canonStore.getAllCharacterStates().catch(() => []),
    canonStore.getFacts().catch(() => []),
  ])
  const hasEvents = new Set(timeline.map(event => event.chapterNumber))
  const hasStates = new Set(states.map(state => state.updatedAtChapter).filter(Boolean) as number[])
  const hasFacts = new Set(facts.map(fact => fact.introducedAt))

  const missing: number[] = []
  for (const blueprint of blueprints) {
    const chapterNumber = blueprint.chapterNumber
    const finalized = await ipc.invoke('db:draft-get-finalized', chapterNumber).catch(() => null)
    if (!finalized?.id) continue
    if (!hasEvents.has(chapterNumber) && !hasStates.has(chapterNumber) && !hasFacts.has(chapterNumber)) {
      missing.push(chapterNumber)
    }
  }
  return missing.sort((a, b) => a - b)
}
