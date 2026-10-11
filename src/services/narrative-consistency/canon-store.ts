/**
 * CanonStore —— 渲染进程侧的 Canon Store 门面
 *
 * 包装所有 db:canon-* IPC 调用，提供：
 *   - 强类型 API
 *   - 错误处理（失败时 console.warn，不阻塞主流程）
 *   - 批量读写便利方法（用于写回时一次性写入事件/状态/事实）
 *
 * 设计原则：
 *   - 只做 IPC 转发；所有持久化逻辑都在主进程的 CanonRepository
 *   - 读取失败时返回安全默认值（空数组/null），让生成流程不被打断
 */
import { ipc } from '../ipc-client'
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
  Fact,
  ChapterSummary,
  CanonWriteback,
  CanonWritebackResult,
  FactImpactCandidate,
  ItemEvent,
  Realm,
  Location,
} from './types'

interface CanonIpcClient {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

export class CanonStore {
  constructor(private readonly ipcClient: CanonIpcClient = ipc as unknown as CanonIpcClient) {}

  // ============================================================
  // Timeline
  // ============================================================

  async getTimeline(maxChapter: number, includeFlashback = true): Promise<TimelineEvent[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-timeline-get', maxChapter, includeFlashback) as TimelineEvent[]) || []
    } catch (err) {
      console.warn('[CanonStore] getTimeline 失败:', err)
      return []
    }
  }

  async getChapterTimeline(chapterNumber: number): Promise<TimelineEvent[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-timeline-get-chapter', chapterNumber) as TimelineEvent[]) || []
    } catch (err) {
      console.warn('[CanonStore] getChapterTimeline 失败:', err)
      return []
    }
  }

  async appendTimelineEvent(event: Omit<TimelineEvent, 'id' | 'createdAt'>): Promise<number | null> {
    try {
      const r = await this.ipcClient.invoke('db:canon-timeline-append', event) as { success?: boolean; id?: number } | undefined
      return r?.success ? r.id ?? null : null
    } catch (err) {
      console.warn('[CanonStore] appendTimelineEvent 失败:', err)
      return null
    }
  }

  async clearChapterTimeline(chapterNumber: number): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-timeline-clear-chapter', chapterNumber) } catch { /* 忽略 */ }
  }

  // ============================================================
  // Character State
  // ============================================================

  async getAllCharacterStates(): Promise<CharacterStateSnapshot[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-character-state-get-all') as CharacterStateSnapshot[]) || []
    } catch (err) {
      console.warn('[CanonStore] getAllCharacterStates 失败:', err)
      return []
    }
  }

  async getCharacterState(character: string): Promise<CharacterStateSnapshot | null> {
    try {
      return await this.ipcClient.invoke('db:canon-character-state-get', character) as CharacterStateSnapshot | null
    } catch (err) {
      console.warn('[CanonStore] getCharacterState 失败:', err)
      return null
    }
  }

  async upsertCharacterState(snapshot: CharacterStateSnapshot): Promise<boolean> {
    try {
      const r = await this.ipcClient.invoke('db:canon-character-state-upsert', snapshot) as { success?: boolean } | undefined
      return r?.success === true
    } catch (err) {
      console.warn('[CanonStore] upsertCharacterState 失败:', err)
      return false
    }
  }

  // ============================================================
  // Plot Lines
  // ============================================================

  async getPlotLines(status?: PlotLine['status']): Promise<PlotLine[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-plot-list', status) as PlotLine[]) || []
    } catch (err) {
      console.warn('[CanonStore] getPlotLines 失败:', err)
      return []
    }
  }

  async getActivePlotLines(): Promise<PlotLine[]> {
    return this.getPlotLines('active')
  }

  async addPlotLine(line: Omit<PlotLine, 'id'>): Promise<number | null> {
    try {
      const r = await this.ipcClient.invoke('db:canon-plot-add', line) as { success?: boolean; id?: number } | undefined
      return r?.success ? r.id ?? null : null
    } catch (err) {
      console.warn('[CanonStore] addPlotLine 失败:', err)
      return null
    }
  }

  async advancePlotLine(id: number, currentState: string, lastAdvancedAt: number): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-plot-advance', id, currentState, lastAdvancedAt) } catch { /* 忽略 */ }
  }

  async resolvePlotLine(id: number, chapterNumber: number): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-plot-resolve', id, chapterNumber) } catch { /* 忽略 */ }
  }

  /** 更新剧情线/伏笔的台账信息（类型、预计回收阶段） */
  async updatePlotLineMeta(id: number, patch: { kind?: 'plot' | 'foreshadow'; plannedResolveAt?: string }): Promise<boolean> {
    try {
      const r = await this.ipcClient.invoke('db:canon-plot-update-meta', id, patch) as { success?: boolean } | undefined
      return r?.success === true
    } catch (err) {
      console.warn('[CanonStore] updatePlotLineMeta 失败:', err)
      return false
    }
  }

  // ============================================================
  // Facts
  // ============================================================

  async getFacts(): Promise<Fact[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-fact-list') as Fact[]) || []
    } catch (err) {
      console.warn('[CanonStore] getFacts 失败:', err)
      return []
    }
  }

  async addFact(fact: Omit<Fact, 'id'>): Promise<number | null> {
    try {
      const r = await this.ipcClient.invoke('db:canon-fact-add', fact) as { success?: boolean; id?: number } | undefined
      return r?.success ? r.id ?? null : null
    } catch (err) {
      console.warn('[CanonStore] addFact 失败:', err)
      return null
    }
  }

  async clearChapterFacts(chapterNumber: number): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-fact-clear-chapter', chapterNumber) } catch { /* 忽略 */ }
  }

  /**
   * 作者确认 / 取消确认事实（可批量）。
   * 确认一条 tentative 事实时，主进程会顺带把它提升为 active。
   */
  async confirmFacts(ids: number[], confirmed: boolean): Promise<number> {
    const valid = (ids || []).filter(id => Number.isSafeInteger(id))
    if (valid.length === 0) return 0
    try {
      const r = await this.ipcClient.invoke('db:canon-fact-confirm', valid, confirmed) as { success?: boolean; count?: number } | undefined
      return r?.success ? (r.count ?? 0) : 0
    } catch (err) {
      console.warn('[CanonStore] confirmFacts 失败:', err)
      return 0
    }
  }

  /** 某条事实的变更历史（最近的在前） */
  async getFactHistory(factId: number): Promise<Array<{ id: number; action: string; at: string }>> {
    try {
      const rows = await this.ipcClient.invoke('db:canon-fact-history', factId) as
        Array<{ id: number; action: string; at: string }> | undefined
      return rows ?? []
    } catch (err) {
      console.warn('[CanonStore] getFactHistory 失败:', err)
      return []
    }
  }

  /** 物品流转台账（可按物品过滤） */
  async getItemEvents(item?: string): Promise<ItemEvent[]> {
    try {
      const rows = await this.ipcClient.invoke('db:canon-item-events-list', item) as ItemEvent[] | undefined
      return rows ?? []
    } catch (err) {
      console.warn('[CanonStore] getItemEvents 失败:', err)
      return []
    }
  }

  /** 登记一条物品流转 */
  async addItemEvent(event: ItemEvent): Promise<number | null> {
    try {
      const r = await this.ipcClient.invoke('db:canon-item-event-add', {
        item: event.item,
        action: event.action,
        chapterNumber: event.chapterNumber,
        actor: event.actor || '',
        note: event.note || '',
      }) as { success?: boolean; id?: number } | undefined
      return r?.success ? r.id ?? null : null
    } catch (err) {
      console.warn('[CanonStore] addItemEvent 失败:', err)
      return null
    }
  }

  /** 删除一条物品流转记录 */
  async removeItemEvent(id: number): Promise<boolean> {
    try {
      const r = await this.ipcClient.invoke('db:canon-item-event-remove', id) as { success?: boolean } | undefined
      return r?.success === true
    } catch (err) {
      console.warn('[CanonStore] removeItemEvent 失败:', err)
      return false
    }
  }

  /** 境界阶梯（按阶数从低到高） */
  async getRealms(): Promise<Realm[]> {
    try {
      const rows = await this.ipcClient.invoke('db:canon-realms-list') as Realm[] | undefined
      return rows ?? []
    } catch (err) {
      console.warn('[CanonStore] getRealms 失败:', err)
      return []
    }
  }

  /** 保存一阶境界（同名视为更新） */
  async upsertRealm(realm: Realm): Promise<number | null> {
    try {
      const r = await this.ipcClient.invoke('db:canon-realm-upsert', {
        id: realm.id,
        name: realm.name,
        rankOrder: realm.rankOrder,
        abilities: realm.abilities || '',
        limits: realm.limits || '',
        breakthrough: realm.breakthrough || '',
        notes: realm.notes || '',
      }) as { success?: boolean; id?: number } | undefined
      return r?.success ? r.id ?? null : null
    } catch (err) {
      console.warn('[CanonStore] upsertRealm 失败:', err)
      return null
    }
  }

  /** 删除一阶境界 */
  async removeRealm(id: number): Promise<boolean> {
    try {
      const r = await this.ipcClient.invoke('db:canon-realm-remove', id) as { success?: boolean } | undefined
      return r?.success === true
    } catch (err) {
      console.warn('[CanonStore] removeRealm 失败:', err)
      return false
    }
  }

  /** 地点与空间关系 */
  async getLocations(): Promise<Location[]> {
    try {
      const rows = await this.ipcClient.invoke('db:canon-locations-list') as Location[] | undefined
      return rows ?? []
    } catch (err) {
      console.warn('[CanonStore] getLocations 失败:', err)
      return []
    }
  }

  /** 保存一个地点（同名或带 id 视为更新） */
  async upsertLocation(location: Location): Promise<number | null> {
    try {
      const r = await this.ipcClient.invoke('db:canon-location-upsert', {
        id: location.id,
        name: location.name,
        region: location.region || '',
        faction: location.faction || '',
        distanceNote: location.distanceNote || '',
        travelNote: location.travelNote || '',
        notes: location.notes || '',
      }) as { success?: boolean; id?: number } | undefined
      return r?.success ? r.id ?? null : null
    } catch (err) {
      console.warn('[CanonStore] upsertLocation 失败:', err)
      return null
    }
  }

  /** 删除一个地点 */
  async removeLocation(id: number): Promise<boolean> {
    try {
      const r = await this.ipcClient.invoke('db:canon-location-remove', id) as { success?: boolean } | undefined
      return r?.success === true
    } catch (err) {
      console.warn('[CanonStore] removeLocation 失败:', err)
      return false
    }
  }

  /** 更新事实的记忆状态（active / outdated / contradicted / tentative）。 */
  async markFactStatus(id: number, status: Fact['status']): Promise<boolean> {
    try {
      const r = await this.ipcClient.invoke('db:canon-fact-mark-status', id, status) as { success?: boolean } | undefined
      return r?.success === true
    } catch (err) {
      console.warn('[CanonStore] markFactStatus 失败:', err)
      return false
    }
  }

  // ============================================================
  // Summaries
  // ============================================================

  async getRecentSummaries(limit = 5): Promise<ChapterSummary[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-summary-list-recent', limit) as ChapterSummary[]) || []
    } catch (err) {
      console.warn('[CanonStore] getRecentSummaries 失败:', err)
      return []
    }
  }

  async getSummariesUpTo(maxChapter: number): Promise<ChapterSummary[]> {
    try {
      return (await this.ipcClient.invoke('db:canon-summary-list-up-to', maxChapter) as ChapterSummary[]) || []
    } catch (err) {
      console.warn('[CanonStore] getSummariesUpTo 失败:', err)
      return []
    }
  }

  async getSummary(chapterNumber: number): Promise<ChapterSummary | null> {
    try {
      return await this.ipcClient.invoke('db:canon-summary-get', chapterNumber) as ChapterSummary | null
    } catch (err) {
      console.warn('[CanonStore] getSummary 失败:', err)
      return null
    }
  }

  async upsertSummary(summary: ChapterSummary): Promise<void> {
    try { await this.ipcClient.invoke('db:canon-summary-upsert', summary) } catch { /* 忽略 */ }
  }

  // ============================================================
  // 批量写回（章节定稿时一次性写入全部变更）
  // ============================================================

  /**
   * 执行章节写回（包含 timeline 事件、角色状态 delta、剧情线变更、事实、摘要）。
   *
   * 设计目标（v2，原子写回）：
   *   - 主进程用单次 SQLite 事务完成 timeline clear+insert / fact clear+insert /
   *     character state merge / plot line / fact 追加
   *   - 任何一步失败 → 整个事务回滚，绝不出现"清空但没写入"的丢失
   *   - 摘要在事务外单独写入（失败不阻塞）
   *   - 单次 IPC 调用 vs 旧的 10+ 次 roundtrip
   */
  async writeback(payload: CanonWriteback): Promise<CanonWritebackResult> {
    const errors: string[] = []
    const conflicts: string[] = []
    let impactCandidates: FactImpactCandidate[] = []

    // 1) 摘要（独立写入，失败不阻塞定稿）
    if (payload.chapterSummary) {
      try {
        await this.upsertSummary({
          chapterNumber: payload.chapterNumber,
          title: payload.chapterTitle,
          summary: payload.chapterSummary,
          createdAt: new Date().toISOString(),
        })
      } catch (e) { errors.push(`summary: ${String(e)}`) }
    }

    // 2) 主路径：单次原子 IPC
    try {
      const r = await this.ipcClient.invoke('db:canon-writeback-atomic', {
        chapterNumber: payload.chapterNumber,
        chapterContent: payload.chapterContent || '',
        newEvents: payload.newEvents,
        characterDeltas: payload.characterDeltas,
        plotLineChanges: payload.plotLineChanges,
        newFacts: payload.newFacts,
      }) as {
        success: boolean
        error?: string
        conflicts?: Array<{ reason: string }>
        impactCandidates?: FactImpactCandidate[]
      } | undefined
      if (!r?.success) {
        errors.push(`writeback-atomic: ${r?.error || 'unknown'}`)
      } else if (r.conflicts?.length) {
        for (const conflict of r.conflicts) conflicts.push(conflict.reason)
      }
      impactCandidates = r?.impactCandidates ?? []
    } catch (e) {
      errors.push(`writeback-atomic: ${String(e)}`)
    }

    return { ok: errors.length === 0, errors, conflicts, impactCandidates }
  }
}

/** 全局单例 */
export const canonStore = new CanonStore()
