/**
 * Canon 结构化台账：时间线 / 角色状态 / 剧情线 / 事实 / 物品流转 / 境界 / 地点
 *
 * 这一组是「写回端」最核心的表，特点是：写入前统一走 `safeValidate` 校验，
 * 读取失败一律降级为空数组（列表类）而不是抛错 —— 因为长篇生成过程中一次检索失败
 * 不应该让整章失败。
 *
 * 章节摘要 / 原子写回 / 统一检索 / 分卷 / 状态历史在 canon-memory-controller.ts。
 */
import { ipcMain } from 'electron'
import { CanonRepository } from '../../repositories/canon-repository'
import {
  safeValidate,
  validateCanonTimelineEventInput,
  validateCanonFactInput,
  validateCanonPlotLineInput,
  validateCanonCharacterStateSnapshot,
} from '../../ipc-validation'
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
  Fact,
} from '../../../src/services/narrative-consistency/types'

export function registerCanonController(): void {
  // ============================================================
  // Canon Store —— 叙事一致性持久化
  // ============================================================

  // 时间线
  ipcMain.handle('db:canon-timeline-get', async (_event, maxChapter: number, includeFlashback?: boolean) => {
    return CanonRepository.getTimelineUpTo(maxChapter, includeFlashback !== false)
  })
  ipcMain.handle('db:canon-timeline-get-chapter', async (_event, chapterNumber: number) => {
    return CanonRepository.getTimelineByChapter(chapterNumber)
  })
  ipcMain.handle('db:canon-timeline-append', async (_event, event: Omit<TimelineEvent, 'id' | 'createdAt'>) => {
    const v = safeValidate(validateCanonTimelineEventInput, event)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const id = CanonRepository.appendTimelineEvent(v.data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-timeline-clear-chapter', async (_event, chapterNumber: number) => {
    CanonRepository.clearChapterTimeline(chapterNumber)
    return { success: true }
  })

  // 角色状态
  ipcMain.handle('db:canon-character-state-get-all', async () => {
    return CanonRepository.getAllCharacterStates()
  })
  ipcMain.handle('db:canon-character-state-get', async (_event, character: string) => {
    return CanonRepository.getCharacterState(character)
  })
  ipcMain.handle('db:canon-character-state-upsert', async (_event, snapshot: CharacterStateSnapshot) => {
    const v = safeValidate(validateCanonCharacterStateSnapshot, snapshot)
    if (!v.ok) return { success: false, error: v.error }
    try {
      CanonRepository.upsertCharacterState(v.data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 剧情线
  ipcMain.handle('db:canon-plot-list', async (_event, status?: PlotLine['status']) => {
    return CanonRepository.getPlotLines(status ? { status } : undefined)
  })
  ipcMain.handle('db:canon-plot-add', async (_event, line: Omit<PlotLine, 'id'>) => {
    const v = safeValidate(validateCanonPlotLineInput, line)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const id = CanonRepository.addPlotLine(v.data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-plot-advance', async (_event, id: number, currentState: string, lastAdvancedAt: number) => {
    CanonRepository.advancePlotLine(id, currentState, lastAdvancedAt)
    return { success: true }
  })
  ipcMain.handle('db:canon-plot-resolve', async (_event, id: number, chapterNumber: number) => {
    CanonRepository.resolvePlotLine(id, chapterNumber)
    return { success: true }
  })
  ipcMain.handle('db:canon-plot-update-meta', async (_event, id: number, patch: { kind?: 'plot' | 'foreshadow'; plannedResolveAt?: string }) => {
    try {
      if (!Number.isSafeInteger(id)) return { success: false, error: '无效的剧情线 id' }
      CanonRepository.updatePlotLineMeta(id, patch ?? {})
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 事实
  ipcMain.handle('db:canon-fact-list', async () => {
    return CanonRepository.getFacts()
  })
  ipcMain.handle('db:canon-fact-add', async (_event, fact: Omit<Fact, 'id'>) => {
    const v = safeValidate(validateCanonFactInput, fact)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const id = CanonRepository.addFact(v.data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-fact-clear-chapter', async (_event, chapterNumber: number) => {
    CanonRepository.clearChapterFacts(chapterNumber)
    return { success: true }
  })
  ipcMain.handle('db:canon-fact-mark-status', async (_event, id: number, status: 'active' | 'outdated' | 'contradicted' | 'tentative') => {
    try {
      CanonRepository.markFactStatus(id, status)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-fact-confirm', async (_event, ids: number[], confirmed: boolean) => {
    try {
      if (!Array.isArray(ids) || ids.length === 0) return { success: false, error: '未指定事实' }
      if (ids.length > 5000) return { success: false, error: '一次最多确认 5000 条' }
      const count = CanonRepository.setFactsConfirmed(ids, confirmed === true)
      return { success: true, count }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-fact-history', async (_event, factId: number) => {
    try {
      return CanonRepository.getFactHistory(factId).map(row => ({
        id: row.id,
        factId: row.fact_id,
        action: row.action,
        before: row.before_json,
        after: row.after_json,
        at: row.at,
      }))
    } catch (err) {
      console.warn('[db:canon-fact-history] failed:', err)
      return []
    }
  })
  // 物品流转台账
  ipcMain.handle('db:canon-item-events-list', async (_event, item?: string) => {
    try {
      return CanonRepository.getItemEvents(item)
    } catch (err) {
      console.warn('[db:canon-item-events-list] failed:', err)
      return []
    }
  })
  ipcMain.handle('db:canon-item-event-add', async (_event, event: { item: string; action: string; chapterNumber: number; actor?: string; note?: string }) => {
    try {
      if (!event || typeof event.item !== 'string' || !event.item.trim()) {
        return { success: false, error: '请填写物品名' }
      }
      if (!['obtained', 'transferred', 'lost', 'destroyed', 'consumed'].includes(event.action)) {
        return { success: false, error: '无效的流转类型' }
      }
      const id = CanonRepository.addItemEvent(event as Parameters<typeof CanonRepository.addItemEvent>[0])
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-item-event-remove', async (_event, id: number) => {
    try {
      if (!Number.isSafeInteger(id)) return { success: false, error: '无效的 id' }
      return { success: CanonRepository.removeItemEvent(id) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  // 境界阶梯
  ipcMain.handle('db:canon-realms-list', async () => {
    try {
      return CanonRepository.getRealms()
    } catch (err) {
      console.warn('[db:canon-realms-list] failed:', err)
      return []
    }
  })
  ipcMain.handle('db:canon-realm-upsert', async (_event, realm: { name: string; rankOrder: number; abilities?: string; limits?: string; breakthrough?: string; notes?: string }) => {
    try {
      if (!realm || typeof realm.name !== 'string' || !realm.name.trim()) {
        return { success: false, error: '请填写境界名' }
      }
      const id = CanonRepository.upsertRealm(realm as Parameters<typeof CanonRepository.upsertRealm>[0])
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-realm-remove', async (_event, id: number) => {
    try {
      if (!Number.isSafeInteger(id)) return { success: false, error: '无效的 id' }
      return { success: CanonRepository.removeRealm(id) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  // 地点与空间关系
  ipcMain.handle('db:canon-locations-list', async () => {
    try {
      return CanonRepository.getLocations()
    } catch (err) {
      console.warn('[db:canon-locations-list] failed:', err)
      return []
    }
  })
  ipcMain.handle('db:canon-location-upsert', async (_event, location: { id?: number; name: string; region?: string; faction?: string; distanceNote?: string; travelNote?: string; notes?: string }) => {
    try {
      if (!location || typeof location.name !== 'string' || !location.name.trim()) {
        return { success: false, error: '请填写地点名' }
      }
      const id = CanonRepository.upsertLocation(location as Parameters<typeof CanonRepository.upsertLocation>[0])
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-location-remove', async (_event, id: number) => {
    try {
      if (!Number.isSafeInteger(id)) return { success: false, error: '无效的 id' }
      return { success: CanonRepository.removeLocation(id) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
