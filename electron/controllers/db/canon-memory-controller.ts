/**
 * Canon 记忆层：章节摘要 / 原子写回 / 统一检索 / 分卷 / 状态历史链 / 原文定位
 *
 * 与 canon-controller.ts 的分界：那边是「单条台账记录的增删改查」，
 * 这边是「面向长篇记忆的聚合能力」——写回是一次事务落多张表，检索要跨类型召回，
 * 分卷与状态历史链服务于上下文预算。
 */
import { ipcMain } from 'electron'
import { CanonRepository } from '../../repositories/canon-repository'
import { safeValidate, validateCanonChapterSummary, validateCanonWritebackPayload } from '../../ipc-validation'
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
  Fact,
  ChapterSummary,
  MemoryHitType,
} from '../../../src/services/narrative-consistency/types'

export function registerCanonMemoryController(): void {
  // 章节摘要
  ipcMain.handle('db:canon-summary-get', async (_event, chapterNumber: number) => {
    return CanonRepository.getSummary(chapterNumber)
  })
  ipcMain.handle('db:canon-summary-list-recent', async (_event, limit?: number) => {
    return CanonRepository.getRecentSummaries(limit ?? 5)
  })
  ipcMain.handle('db:canon-summary-list-up-to', async (_event, maxChapter: number) => {
    return CanonRepository.getSummariesUpTo(maxChapter)
  })
  ipcMain.handle('db:canon-summary-upsert', async (_event, summary: ChapterSummary) => {
    const v = safeValidate(validateCanonChapterSummary, summary)
    if (!v.ok) return { success: false, error: v.error }
    try {
      CanonRepository.upsertSummary(v.data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 原子写回（推荐路径：单次事务）
  ipcMain.handle('db:canon-writeback-atomic', async (_event, payload: {
    chapterNumber: number
    chapterContent?: string
    newEvents: Omit<TimelineEvent, 'id' | 'createdAt'>[]
    characterDeltas: Array<{ character: string; after: Partial<CharacterStateSnapshot>; chapterNumber: number }>
    plotLineChanges?: {
      added?: Omit<PlotLine, 'id'>[]
      advanced?: Array<{ id: number; currentState: string; lastAdvancedAt: number }>
      resolved?: number[]
    }
    newFacts: Omit<Fact, 'id'>[]
  }) => {
    const v = safeValidate(validateCanonWritebackPayload, payload)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const result = CanonRepository.writebackAtomically(v.data)
      return { success: true, ...result }
    } catch (err) {
      console.error('[db:canon-writeback-atomic] failed:', err)
      return { success: false, error: String(err) }
    }
  })

  // ===== [v10] 第二阶段：分层记忆与精准检索 =====

  // 统一检索入口
  ipcMain.handle('db:canon-search', async (_event, params: {
    query: string
    types?: string[]
    character?: string
    chapterRange?: { from?: number; to?: number }
    item?: string
    includeHistorical?: boolean
    limit?: number
  }) => {
    try {
      return CanonRepository.searchCanon({
        query: params.query || '',
        types: params.types as MemoryHitType[] | undefined,
        character: params.character,
        chapterRange: params.chapterRange,
        item: params.item,
        includeHistorical: params.includeHistorical ?? false,
        limit: params.limit,
      })
    } catch (err) {
      console.error('[db:canon-search] failed:', err)
      return { hits: [], total: 0, degraded: true, degradeReason: String(err), elapsedMs: 0 }
    }
  })

  // 分卷
  ipcMain.handle('db:canon-arcs-list', async () => {
    return CanonRepository.getArcs()
  })
  ipcMain.handle('db:canon-arc-get-for-chapter', async (_event, chapterNumber: number) => {
    return CanonRepository.getArcForChapter(chapterNumber)
  })
  ipcMain.handle('db:canon-arc-upsert', async (_event, arc: {
    id?: number; title: string; startChapter: number; endChapter: number
    mainConflict?: string; characterDevelopment?: string; keyEvents?: string; stageGoal?: string; sortOrder?: number
  }) => {
    try {
      const id = CanonRepository.upsertArc({
        title: arc.title,
        startChapter: arc.startChapter,
        endChapter: arc.endChapter,
        mainConflict: arc.mainConflict || '',
        characterDevelopment: arc.characterDevelopment || '',
        keyEvents: arc.keyEvents || '',
        stageGoal: arc.stageGoal || '',
        sortOrder: arc.sortOrder ?? 0,
        id: arc.id,
      })
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-arc-remove', async (_event, id: number) => {
    return { success: CanonRepository.removeArc(id) }
  })

  // 角色状态历史链
  ipcMain.handle('db:canon-character-state-history', async (_event, character: string, upToChapter?: number) => {
    return CanonRepository.getCharacterStateHistory(character, upToChapter)
  })
  ipcMain.handle('db:canon-character-state-at-chapter', async (_event, character: string, chapterNumber: number) => {
    return CanonRepository.getCharacterStateAtChapter(character, chapterNumber)
  })

  // 原文证据定位
  ipcMain.handle('db:canon-chapter-paragraphs', async (_event, chapterNumber: number) => {
    return CanonRepository.getChapterParagraphs(chapterNumber)
  })
}
