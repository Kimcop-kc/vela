/**
 * CanonStore —— 渲染进程侧的 Canon Store 门面
 *
 * 包装所有 db:canon-* IPC 调用，提供：
 *   - 强类型 API
 *   - 统一的失败处理（记一条带 scope 的日志 + 返回安全默认值，不阻塞主流程）
 *   - 批量读写便利方法（用于写回时一次性写入事件/状态/事实）
 *
 * 设计原则：
 *   - 只做 IPC 转发；所有持久化逻辑都在主进程的 CanonRepository
 *   - 读取失败时返回安全默认值（空数组/null），让生成流程不被打断
 *   - 失败路径只有一处（下面那组 `read*` / `write*` 私有方法）。以前 30+ 个方法各自
 *     复制一份 try/catch，行为一致但一份都测不到；收敛之后失败语义可被单测覆盖。
 */
import { ipc } from '../ipc-client'
import { appLogger } from '../app-logger'
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
  Arc,
  CharacterStateHistoryEntry,
  MemorySearchParams,
  MemorySearchResult,
} from './types'

interface CanonIpcClient {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

/** 主进程写操作的统一信封（各通道按需带 id / count / 冲突 / 影响候选） */
interface WriteEnvelope {
  success?: boolean
  id?: number
  count?: number
  error?: string
  /** 写回时被标为冲突的事实原因 */
  conflicts?: Array<{ reason: string }>
  /** 写回时受影响、需要作者过目的事实候选 */
  impactCandidates?: FactImpactCandidate[]
}

/** 日志 scope：日志面板里可以只筛这一个子系统 */
const SCOPE = 'canon-store'

/**
 * 读取失败时的兜底值：给一个值，或按错误生成一个值。
 *
 * `searchCanon` 要把失败原因写进返回值（`degraded` / `degradeReason`），
 * 所以兜底不能只是静态值。
 */
type Fallback<T> = T | ((error: unknown) => T)

export class CanonStore {
  constructor(private readonly ipcClient: CanonIpcClient = ipc as unknown as CanonIpcClient) {}

  // ============================================================
  // 统一的 IPC 包装（所有方法都走这里）
  // ============================================================

  /**
   * 发一次 IPC，失败返回 undefined 并记日志。
   *
   * `errorSink` 给「调用方要把失败原因展示给作者」的场景用（定稿日志），
   * 避免为了拿到异常文本再复制一份 try/catch。
   */
  private async send(
    method: string,
    channel: string,
    args: unknown[],
    errorSink?: string[],
  ): Promise<WriteEnvelope | undefined> {
    try {
      return (await this.ipcClient.invoke(channel, ...args)) as WriteEnvelope | undefined
    } catch (error) {
      appLogger.warn(SCOPE, `${method} 调用失败`, { channel, error: String(error) })
      errorSink?.push(`${method}: ${String(error)}`)
      return undefined
    }
  }

  /** 读：失败（或返回空）时给兜底值 */
  private async read<T>(method: string, channel: string, args: unknown[], fallback: Fallback<T>): Promise<T> {
    const resolved = (error: unknown): T =>
      typeof fallback === 'function' ? (fallback as (e: unknown) => T)(error) : fallback
    try {
      const result = (await this.ipcClient.invoke(channel, ...args)) as T | null | undefined
      return result ?? resolved(new Error('IPC 无返回'))
    } catch (error) {
      appLogger.warn(SCOPE, `${method} 读取失败，返回兜底值`, { channel, error: String(error) })
      return resolved(error)
    }
  }

  /** 写：只关心成功与否 */
  private async writeOk(method: string, channel: string, args: unknown[]): Promise<boolean> {
    return (await this.send(method, channel, args))?.success === true
  }

  /** 写：主进程返回新建/更新的行 id */
  private async writeId(method: string, channel: string, args: unknown[]): Promise<number | null> {
    const r = await this.send(method, channel, args)
    return r?.success ? (r.id ?? null) : null
  }

  /** 写：主进程返回受影响条数 */
  private async writeCount(method: string, channel: string, args: unknown[]): Promise<number> {
    const r = await this.send(method, channel, args)
    return r?.success ? (r.count ?? 0) : 0
  }

  /**
   * 尽力而为的写：调用方不关心结果（清空某章数据、推进剧情线等）。
   *
   * 以前这些是 `catch { /* 忽略 *\/ }`，失败完全无声。仍然不抛错（不能打断定稿），
   * 但至少留一条日志，否则「数据没清干净」这类问题永远查不到。
   */
  private async writeBestEffort(method: string, channel: string, args: unknown[]): Promise<void> {
    try {
      await this.ipcClient.invoke(channel, ...args)
    } catch (error) {
      appLogger.warn(SCOPE, `${method} 失败（不影响主流程）`, { channel, error: String(error) })
    }
  }

  // ============================================================
  // Timeline
  // ============================================================

  async getTimeline(maxChapter: number, includeFlashback = true): Promise<TimelineEvent[]> {
    return this.read('getTimeline', 'db:canon-timeline-get', [maxChapter, includeFlashback], [])
  }

  async getChapterTimeline(chapterNumber: number): Promise<TimelineEvent[]> {
    return this.read('getChapterTimeline', 'db:canon-timeline-get-chapter', [chapterNumber], [])
  }

  async appendTimelineEvent(event: Omit<TimelineEvent, 'id' | 'createdAt'>): Promise<number | null> {
    return this.writeId('appendTimelineEvent', 'db:canon-timeline-append', [event])
  }

  async clearChapterTimeline(chapterNumber: number): Promise<void> {
    return this.writeBestEffort('clearChapterTimeline', 'db:canon-timeline-clear-chapter', [chapterNumber])
  }

  // ============================================================
  // Character State
  // ============================================================

  async getAllCharacterStates(): Promise<CharacterStateSnapshot[]> {
    return this.read('getAllCharacterStates', 'db:canon-character-state-get-all', [], [])
  }

  async getCharacterState(character: string): Promise<CharacterStateSnapshot | null> {
    return this.read<CharacterStateSnapshot | null>(
      'getCharacterState', 'db:canon-character-state-get', [character], null,
    )
  }

  async upsertCharacterState(snapshot: CharacterStateSnapshot): Promise<boolean> {
    return this.writeOk('upsertCharacterState', 'db:canon-character-state-upsert', [snapshot])
  }

  // ============================================================
  // Plot Lines
  // ============================================================

  async getPlotLines(status?: PlotLine['status']): Promise<PlotLine[]> {
    return this.read('getPlotLines', 'db:canon-plot-list', [status], [])
  }

  async getActivePlotLines(): Promise<PlotLine[]> {
    return this.getPlotLines('active')
  }

  async addPlotLine(line: Omit<PlotLine, 'id'>): Promise<number | null> {
    return this.writeId('addPlotLine', 'db:canon-plot-add', [line])
  }

  async advancePlotLine(id: number, currentState: string, lastAdvancedAt: number): Promise<void> {
    return this.writeBestEffort('advancePlotLine', 'db:canon-plot-advance', [id, currentState, lastAdvancedAt])
  }

  async resolvePlotLine(id: number, chapterNumber: number): Promise<void> {
    return this.writeBestEffort('resolvePlotLine', 'db:canon-plot-resolve', [id, chapterNumber])
  }

  /** 更新剧情线/伏笔的台账信息（类型、预计回收阶段） */
  async updatePlotLineMeta(id: number, patch: { kind?: 'plot' | 'foreshadow'; plannedResolveAt?: string }): Promise<boolean> {
    return this.writeOk('updatePlotLineMeta', 'db:canon-plot-update-meta', [id, patch])
  }

  // ============================================================
  // Facts
  // ============================================================

  async getFacts(): Promise<Fact[]> {
    return this.read('getFacts', 'db:canon-fact-list', [], [])
  }

  async addFact(fact: Omit<Fact, 'id'>): Promise<number | null> {
    return this.writeId('addFact', 'db:canon-fact-add', [fact])
  }

  async clearChapterFacts(chapterNumber: number): Promise<void> {
    return this.writeBestEffort('clearChapterFacts', 'db:canon-fact-clear-chapter', [chapterNumber])
  }

  /**
   * 作者确认 / 取消确认事实（可批量）。
   * 确认一条 tentative 事实时，主进程会顺带把它提升为 active。
   */
  async confirmFacts(ids: number[], confirmed: boolean): Promise<number> {
    const valid = (ids || []).filter(id => Number.isSafeInteger(id))
    if (valid.length === 0) return 0
    return this.writeCount('confirmFacts', 'db:canon-fact-confirm', [valid, confirmed])
  }

  /** 某条事实的变更历史（最近的在前） */
  async getFactHistory(factId: number): Promise<Array<{ id: number; action: string; at: string }>> {
    return this.read('getFactHistory', 'db:canon-fact-history', [factId], [])
  }

  /** 物品流转台账（可按物品过滤） */
  async getItemEvents(item?: string): Promise<ItemEvent[]> {
    return this.read('getItemEvents', 'db:canon-item-events-list', [item], [])
  }

  /** 登记一条物品流转 */
  async addItemEvent(event: ItemEvent): Promise<number | null> {
    return this.writeId('addItemEvent', 'db:canon-item-event-add', [{
      item: event.item,
      action: event.action,
      chapterNumber: event.chapterNumber,
      actor: event.actor || '',
      note: event.note || '',
    }])
  }

  /** 删除一条物品流转记录 */
  async removeItemEvent(id: number): Promise<boolean> {
    return this.writeOk('removeItemEvent', 'db:canon-item-event-remove', [id])
  }

  /** 境界阶梯（按阶数从低到高） */
  async getRealms(): Promise<Realm[]> {
    return this.read('getRealms', 'db:canon-realms-list', [], [])
  }

  /** 保存一阶境界（同名视为更新） */
  async upsertRealm(realm: Realm): Promise<number | null> {
    return this.writeId('upsertRealm', 'db:canon-realm-upsert', [{
      id: realm.id,
      name: realm.name,
      rankOrder: realm.rankOrder,
      abilities: realm.abilities || '',
      limits: realm.limits || '',
      breakthrough: realm.breakthrough || '',
      notes: realm.notes || '',
    }])
  }

  /** 删除一阶境界 */
  async removeRealm(id: number): Promise<boolean> {
    return this.writeOk('removeRealm', 'db:canon-realm-remove', [id])
  }

  /** 地点与空间关系 */
  async getLocations(): Promise<Location[]> {
    return this.read('getLocations', 'db:canon-locations-list', [], [])
  }

  /** 保存一个地点（同名或带 id 视为更新） */
  async upsertLocation(location: Location): Promise<number | null> {
    return this.writeId('upsertLocation', 'db:canon-location-upsert', [{
      id: location.id,
      name: location.name,
      region: location.region || '',
      faction: location.faction || '',
      distanceNote: location.distanceNote || '',
      travelNote: location.travelNote || '',
      notes: location.notes || '',
    }])
  }

  /** 删除一个地点 */
  async removeLocation(id: number): Promise<boolean> {
    return this.writeOk('removeLocation', 'db:canon-location-remove', [id])
  }

  /** 更新事实的记忆状态（active / outdated / contradicted / tentative）。 */
  async markFactStatus(id: number, status: Fact['status']): Promise<boolean> {
    return this.writeOk('markFactStatus', 'db:canon-fact-mark-status', [id, status])
  }

  // ============================================================
  // Summaries
  // ============================================================

  async getRecentSummaries(limit = 5): Promise<ChapterSummary[]> {
    return this.read('getRecentSummaries', 'db:canon-summary-list-recent', [limit], [])
  }

  async getSummariesUpTo(maxChapter: number): Promise<ChapterSummary[]> {
    return this.read('getSummariesUpTo', 'db:canon-summary-list-up-to', [maxChapter], [])
  }

  async getSummary(chapterNumber: number): Promise<ChapterSummary | null> {
    return this.read<ChapterSummary | null>('getSummary', 'db:canon-summary-get', [chapterNumber], null)
  }

  async upsertSummary(summary: ChapterSummary): Promise<void> {
    return this.writeBestEffort('upsertSummary', 'db:canon-summary-upsert', [summary])
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
      await this.upsertSummary({
        chapterNumber: payload.chapterNumber,
        title: payload.chapterTitle,
        summary: payload.chapterSummary,
        createdAt: new Date().toISOString(),
      })
    }

    // 2) 主路径：单次原子 IPC
    //    `errors` 作为 errorSink 传进去：调用失败时 send() 会把原因写进来，
    //    定稿日志照旧能显示具体错误，不必再复制一份 try/catch。
    const r = await this.send('writeback-atomic', 'db:canon-writeback-atomic', [{
      chapterNumber: payload.chapterNumber,
      chapterContent: payload.chapterContent || '',
      newEvents: payload.newEvents,
      characterDeltas: payload.characterDeltas,
      plotLineChanges: payload.plotLineChanges,
      newFacts: payload.newFacts,
    }], errors)
    if (r && !r.success) {
      errors.push(`writeback-atomic: ${r.error || 'unknown'}`)
    } else if (r?.conflicts?.length) {
      for (const conflict of r.conflicts) conflicts.push(conflict.reason)
    }
    impactCandidates = r?.impactCandidates ?? []

    return { ok: errors.length === 0, errors, conflicts, impactCandidates }
  }

  // ============================================================
  // [v10] 第二阶段：统一检索 / 分卷 / 状态历史 / 原文定位
  // ============================================================

  /** 统一精准检索入口（跨事实/时间线/人物/伏笔/物品/章节/分卷） */
  async searchCanon(params: MemorySearchParams): Promise<MemorySearchResult> {
    try {
      const r = await this.ipcClient.invoke('db:canon-search', params) as MemorySearchResult | undefined
      return r ?? { hits: [], total: 0, degraded: true, degradeReason: 'IPC 无返回', elapsedMs: 0 }
    } catch (error) {
      appLogger.warn(SCOPE, 'searchCanon 失败，降级为空结果', { error: String(error) })
      return { hits: [], total: 0, degraded: true, degradeReason: String(error), elapsedMs: 0 }
    }
  }

  // --- 分卷/阶段记忆 ---
  async getArcs(): Promise<Arc[]> {
    return this.read('getArcs', 'db:canon-arcs-list', [], [])
  }

  async getArcForChapter(chapterNumber: number): Promise<Arc | null> {
    return this.read<Arc | null>('getArcForChapter', 'db:canon-arc-get-for-chapter', [chapterNumber], null)
  }

  async upsertArc(arc: Omit<Arc, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }): Promise<number | null> {
    return this.writeId('upsertArc', 'db:canon-arc-upsert', [arc])
  }

  async removeArc(id: number): Promise<boolean> {
    return this.writeOk('removeArc', 'db:canon-arc-remove', [id])
  }

  // --- 角色状态历史链 ---
  async getCharacterStateHistory(character: string, upToChapter?: number): Promise<CharacterStateHistoryEntry[]> {
    return this.read('getCharacterStateHistory', 'db:canon-character-state-history', [character, upToChapter], [])
  }

  async getCharacterStateAtChapter(character: string, chapterNumber: number): Promise<CharacterStateSnapshot | null> {
    return this.read<CharacterStateSnapshot | null>(
      'getCharacterStateAtChapter', 'db:canon-character-state-at-chapter', [character, chapterNumber], null,
    )
  }

  // --- 原文证据定位 ---
  async getChapterParagraphs(chapterNumber: number): Promise<string[]> {
    return this.read('getChapterParagraphs', 'db:canon-chapter-paragraphs', [chapterNumber], [])
  }
}

/** 全局单例 */
export const canonStore = new CanonStore()
