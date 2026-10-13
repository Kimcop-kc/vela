/**
 * CanonRepository —— 叙事一致性 Canon Store
 *
 * 5 张新表：
 *   canon_timeline_events —— 结构化时间线事件（chapterNumber, sequence, ...）
 *   canon_character_state  —— 角色当前状态（每角色 1 行，upsert）
 *   canon_plot_lines       —— 长期未结剧情线
 *   canon_facts            —— 客观事实条目
 *   canon_chapter_summaries—— 章节摘要（结构化）
 *
 * 全部表在 database.ts 用 CREATE TABLE IF NOT EXISTS 创建，老库零迁移成本。
 */
import { getProjectDb } from '../database'
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
  Fact,
  ChapterSummary,
  FactImpactCandidate,
  ItemEvent,
  Realm,
  Location,
  Arc,
  CharacterStateHistoryEntry,
  MemorySearchParams,
  MemorySearchResult,
  MemorySearchHit,
  MemoryHitType,
} from '../../src/services/narrative-consistency/types'
import { detectFactConflict } from '../../src/services/narrative-consistency/fact-conflict'
import { extractSearchTerms, countTermHits } from '../../src/shared/search-terms'

interface TimelineRow {
  id: number
  chapter_number: number
  sequence: number
  characters: string
  location: string
  time_flow: string
  summary: string
  impact: string
  created_at: string
}

interface CharacterStateRow {
  character: string
  location: string
  power_level: string
  physical_state: string
  mental_state: string
  key_items: string
  current_goal: string
  knowledge_json: string
  relationships_json: string
  recent_events: string
  updated_at_chapter: number
  updated_at: string
}

interface PlotLineRow {
  id: number
  name: string
  status: string
  started_at: number
  last_advanced_at: number
  resolved_at: number | null
  characters: string
  current_state: string
  description: string
  kind?: string | null
  planned_resolve_at?: string | null
  created_at: string
}

interface FactRow {
  id: number
  category: string
  statement: string
  introduced_at: number
  characters: string
  evidence: string
  status: string | null
  confirmed_at?: string | null
  updated_at?: string | null
  created_at: string
  source_paragraph_index?: number | null
  arc_id?: number | null
}

/** 事实变更历史行 */
export interface FactHistoryRow {
  id: number
  fact_id: number
  action: string
  before_json: string
  after_json: string
  at: string
}

interface ChapterSummaryRow {
  chapter_number: number
  title: string
  summary: string
  created_at: string
}

function safeParse<T>(json: string, fallback: T, field: string, entity: string): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T }
  catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    throw new Error(
      `[CanonRepository] 数据已损坏：${entity} 的 ${field} 字段不是合法 JSON ` +
      `(长度=${json.length}, 前 80 字="${json.slice(0, 80)}...")。` +
      `请从备份恢复或重新导入项目。底层错误: ${err}`
    )
  }
}

function rowToTimeline(row: TimelineRow): TimelineEvent {
  return {
    id: row.id,
    chapterNumber: row.chapter_number,
    sequence: row.sequence,
    characters: safeParse<string[]>(row.characters, [], 'characters', `timeline_event#${row.id}`),
    location: row.location,
    timeFlow: row.time_flow === 'flashback' ? 'flashback' : 'sequential',
    summary: row.summary,
    impact: row.impact,
    createdAt: row.created_at,
  }
}

function rowToCharacterState(row: CharacterStateRow): CharacterStateSnapshot {
  return {
    character: row.character,
    location: row.location,
    powerLevel: row.power_level,
    physicalState: row.physical_state,
    mentalState: row.mental_state,
    keyItems: row.key_items,
    currentGoal: row.current_goal,
    knowledge: safeParse<string[]>(row.knowledge_json, [], 'knowledge_json', `character_state#${row.character}`),
    relationships: safeParse<Record<string, string>>(row.relationships_json, {}, 'relationships_json', `character_state#${row.character}`),
    recentEvents: row.recent_events,
    updatedAtChapter: row.updated_at_chapter,
    updatedAt: row.updated_at,
  }
}

function rowToPlotLine(row: PlotLineRow): PlotLine {
  return {
    id: row.id,
    name: row.name,
    status: (row.status as PlotLine['status']) || 'active',
    startedAt: row.started_at,
    lastAdvancedAt: row.last_advanced_at,
    resolvedAt: row.resolved_at ?? undefined,
    characters: safeParse<string[]>(row.characters, [], 'characters', `plot_line#${row.id}`),
    currentState: row.current_state,
    description: row.description,
    kind: row.kind === 'foreshadow' ? 'foreshadow' : 'plot',
    plannedResolveAt: row.planned_resolve_at || '',
  }
}

function rowToFact(row: FactRow): Fact {
  return {
    id: row.id,
    category: row.category as Fact['category'],
    statement: row.statement,
    introducedAt: row.introduced_at,
    characters: safeParse<string[]>(row.characters, [], 'characters', `fact#${row.id}`),
    evidence: row.evidence || undefined,
    status: (row.status as Fact['status']) || 'active',
    confirmedAt: row.confirmed_at ?? null,
    updatedAt: row.updated_at ?? null,
    sourceParagraphIndex: row.source_paragraph_index ?? -1,
    arcId: row.arc_id ?? undefined,
  }
}

function rowToSummary(row: ChapterSummaryRow): ChapterSummary {
  return {
    chapterNumber: row.chapter_number,
    title: row.title,
    summary: row.summary,
    createdAt: row.created_at,
  }
}

export class CanonRepository {
  // ============================================================
  // 时间线事件
  // ============================================================

  /** 获取某章及之前的所有事件（按章号+sequence 升序） */
  static getTimelineUpTo(maxChapter: number, includeFlashback = true): TimelineEvent[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_timeline_events
       WHERE chapter_number <= ?
       ${includeFlashback ? '' : "AND time_flow = 'sequential'"}
       ORDER BY chapter_number ASC, sequence ASC`
    ).all(maxChapter) as TimelineRow[]
    return rows.map(rowToTimeline)
  }

  /** 获取某章的所有事件 */
  static getTimelineByChapter(chapterNumber: number): TimelineEvent[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_timeline_events
       WHERE chapter_number = ?
       ORDER BY sequence ASC`
    ).all(chapterNumber) as TimelineRow[]
    return rows.map(rowToTimeline)
  }

  /** 追加一个事件；如果 (chapter, sequence) 已存在则覆盖其内容。返回行的 id。 */
  static appendTimelineEvent(event: Omit<TimelineEvent, 'id' | 'createdAt'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    db.prepare(`
      INSERT INTO canon_timeline_events
        (chapter_number, sequence, characters, location, time_flow, summary, impact)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chapter_number, sequence) DO UPDATE SET
        characters = excluded.characters,
        location = excluded.location,
        time_flow = excluded.time_flow,
        summary = excluded.summary,
        impact = excluded.impact
    `).run(
      event.chapterNumber,
      event.sequence,
      JSON.stringify(event.characters || []),
      event.location || '',
      event.timeFlow || 'sequential',
      event.summary || '',
      event.impact || '',
    )
    const row = db.prepare(
      `SELECT id FROM canon_timeline_events WHERE chapter_number = ? AND sequence = ?`
    ).get(event.chapterNumber, event.sequence) as { id: number }
    return row.id
  }

  /** 删除某章的全部事件（用于重写某章时清理旧事件） */
  static clearChapterTimeline(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`DELETE FROM canon_timeline_events WHERE chapter_number = ?`).run(chapterNumber)
  }

  // ============================================================
  // 角色状态
  // ============================================================

  /** 读取所有角色当前状态 */
  static getAllCharacterStates(): CharacterStateSnapshot[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_character_state ORDER BY updated_at_chapter DESC, character ASC`
    ).all() as CharacterStateRow[]
    return rows.map(rowToCharacterState)
  }

  /** 读取单个角色当前状态 */
  static getCharacterState(character: string): CharacterStateSnapshot | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_character_state WHERE character = ?`
    ).get(character) as CharacterStateRow | undefined
    return row ? rowToCharacterState(row) : null
  }

  /**
   * Upsert 角色状态（merge 语义）。
   * 标量字段：snapshot 非空时覆盖。
   * knowledge 列表：累加 + dedup（Set union）。
   * relationships：浅合并（snapshot 中的同名 key 覆盖旧的）。
   */
  static upsertCharacterState(snapshot: CharacterStateSnapshot): void {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')

    const existing = this.getCharacterState(snapshot.character)
    const merged: CharacterStateSnapshot = existing
      ? {
          ...existing,
          // 标量字段：用 snapshot 覆盖（如果非空），否则保留旧值
          location: snapshot.location || existing.location,
          powerLevel: snapshot.powerLevel || existing.powerLevel,
          physicalState: snapshot.physicalState || existing.physicalState,
          mentalState: snapshot.mentalState || existing.mentalState,
          keyItems: snapshot.keyItems || existing.keyItems,
          currentGoal: snapshot.currentGoal || existing.currentGoal,
          recentEvents: snapshot.recentEvents || existing.recentEvents,
          // 列表字段：union + dedup
          knowledge: Array.from(new Set([
            ...(existing.knowledge || []),
            ...(snapshot.knowledge || []),
          ])),
          relationships: {
            ...(existing.relationships || {}),
            ...(snapshot.relationships || {}),
          },
          updatedAtChapter: snapshot.updatedAtChapter || existing.updatedAtChapter,
          updatedAt: snapshot.updatedAt || new Date().toISOString(),
        }
      : {
          ...snapshot,
          updatedAt: snapshot.updatedAt || new Date().toISOString(),
        }

    db.prepare(`
      INSERT INTO canon_character_state
        (character, location, power_level, physical_state, mental_state, key_items,
         current_goal, knowledge_json, relationships_json, recent_events,
         updated_at_chapter, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(character) DO UPDATE SET
        location = excluded.location,
        power_level = excluded.power_level,
        physical_state = excluded.physical_state,
        mental_state = excluded.mental_state,
        key_items = excluded.key_items,
        current_goal = excluded.current_goal,
        knowledge_json = excluded.knowledge_json,
        relationships_json = excluded.relationships_json,
        recent_events = excluded.recent_events,
        updated_at_chapter = excluded.updated_at_chapter,
        updated_at = excluded.updated_at
    `).run(
      merged.character,
      merged.location || '',
      merged.powerLevel || '',
      merged.physicalState || '',
      merged.mentalState || '',
      merged.keyItems || '',
      merged.currentGoal || '',
      JSON.stringify(merged.knowledge || []),
      JSON.stringify(merged.relationships || {}),
      merged.recentEvents || '',
      merged.updatedAtChapter || 0,
      merged.updatedAt,
    )
  }

  // ============================================================
  // 剧情线
  // ============================================================

  static getPlotLines(filter?: { status?: PlotLine['status'] }): PlotLine[] {
    const db = getProjectDb()
    if (!db) return []
    let sql = `SELECT * FROM canon_plot_lines`
    const args: unknown[] = []
    if (filter?.status) {
      sql += ` WHERE status = ?`
      args.push(filter.status)
    }
    sql += ` ORDER BY last_advanced_at DESC, id ASC`
    const rows = db.prepare(sql).all(...args) as PlotLineRow[]
    return rows.map(rowToPlotLine)
  }

  /** 按名字查找（用于去重） */
  static findPlotLineByName(name: string): PlotLine | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_plot_lines WHERE name = ? COLLATE NOCASE LIMIT 1`
    ).get(name) as PlotLineRow | undefined
    return row ? rowToPlotLine(row) : null
  }

  /** 规范化字符串用于去重：trim + 折叠空白 + NFKC */
  private static normalizeForDedup(s: string): string {
    return (s || '').trim().replace(/\s+/g, ' ').normalize('NFKC')
  }

  static addPlotLine(line: Omit<PlotLine, 'id'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const normalizedName = this.normalizeForDedup(line.name)
    if (!normalizedName) throw new Error('[CanonRepository] addPlotLine: name 不能为空')
    const existing = this.findPlotLineByName(normalizedName)
    if (existing) return existing.id || 0
    const r = db.prepare(`
      INSERT INTO canon_plot_lines
        (name, status, started_at, last_advanced_at, resolved_at, characters, current_state, description, kind, planned_resolve_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalizedName,
      line.status || 'active',
      line.startedAt || 0,
      line.lastAdvancedAt || line.startedAt || 0,
      line.resolvedAt ?? null,
      JSON.stringify(line.characters || []),
      line.currentState || '',
      line.description || '',
      line.kind === 'foreshadow' ? 'foreshadow' : 'plot',
      (line.plannedResolveAt || '').slice(0, 60),
    )
    return Number(r.lastInsertRowid)
  }

  /**
   * 更新剧情线/伏笔的台账信息（类型与预计回收阶段）。
   * 只动这两列，不碰状态与进度，避免误改写作流程写回的内容。
   */
  static updatePlotLineMeta(id: number, patch: { kind?: 'plot' | 'foreshadow'; plannedResolveAt?: string }): void {
    const db = getProjectDb()
    if (!db) return
    if (patch.kind !== undefined) {
      db.prepare(`UPDATE canon_plot_lines SET kind = ? WHERE id = ?`)
        .run(patch.kind === 'foreshadow' ? 'foreshadow' : 'plot', id)
    }
    if (patch.plannedResolveAt !== undefined) {
      db.prepare(`UPDATE canon_plot_lines SET planned_resolve_at = ? WHERE id = ?`)
        .run((patch.plannedResolveAt || '').slice(0, 60), id)
    }
  }

  static advancePlotLine(id: number, currentState: string, lastAdvancedAt: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      UPDATE canon_plot_lines
      SET current_state = ?, last_advanced_at = ?
      WHERE id = ?
    `).run(currentState, lastAdvancedAt, id)
  }

  static resolvePlotLine(id: number, chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      UPDATE canon_plot_lines
      SET status = 'resolved', resolved_at = ?, last_advanced_at = ?
      WHERE id = ?
    `).run(chapterNumber, chapterNumber, id)
  }

  // ============================================================
  // 事实
  // ============================================================

  // ============================================================
  // 物品流转台账
  // ============================================================

  /** 登记一条物品流转（作者或助手显式操作） */
  static addItemEvent(event: ItemEvent): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const item = this.normalizeForDedup(event.item)
    if (!item) throw new Error('[CanonRepository] addItemEvent: item 不能为空')
    const r = db.prepare(`
      INSERT INTO canon_item_events (item, action, chapter_number, actor, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      item,
      event.action || 'obtained',
      Number.isSafeInteger(event.chapterNumber) ? event.chapterNumber : 0,
      (event.actor || '').slice(0, 200),
      (event.note || '').slice(0, 500),
    )
    return Number(r.lastInsertRowid)
  }

  /** 全部物品流转记录（按物品、章节排序） */
  static getItemEvents(item?: string): ItemEvent[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = (item
      ? db.prepare(`SELECT * FROM canon_item_events WHERE item = ? COLLATE NOCASE ORDER BY chapter_number ASC, id ASC`).all(item)
      : db.prepare(`SELECT * FROM canon_item_events ORDER BY item COLLATE NOCASE ASC, chapter_number ASC, id ASC`).all()) as Array<{
        id: number; item: string; action: string; chapter_number: number; actor: string; note: string; created_at: string
      }>
    return rows.map(row => ({
      id: row.id,
      item: row.item,
      action: (row.action as ItemEvent['action']) || 'obtained',
      chapterNumber: row.chapter_number,
      actor: row.actor,
      note: row.note,
      createdAt: row.created_at,
    }))
  }

  /** 删除一条物品流转记录（登记错了可以撤） */
  static removeItemEvent(id: number): boolean {
    const db = getProjectDb()
    if (!db) return false
    return db.prepare(`DELETE FROM canon_item_events WHERE id = ?`).run(id).changes > 0
  }

  // ============================================================
  // 境界阶梯
  // ============================================================

  /** 保存一阶境界（带 id 按 id 更新；否则同名视为更新；都没有则新建） */
  static upsertRealm(realm: Realm): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const name = this.normalizeForDedup(realm.name)
    if (!name) throw new Error('[CanonRepository] upsertRealm: name 不能为空')
    const rankOrder = Number.isSafeInteger(realm.rankOrder) ? realm.rankOrder : 0
    const existing = (realm.id != null
      ? db.prepare(`SELECT id FROM canon_realms WHERE id = ?`).get(realm.id)
      : db.prepare(`SELECT id FROM canon_realms WHERE name = ? COLLATE NOCASE`).get(name)) as { id: number } | undefined
    if (existing) {
      db.prepare(`
        UPDATE canon_realms SET name = ?, rank_order = ?, abilities = ?, limits = ?, breakthrough = ?, notes = ?
        WHERE id = ?
      `).run(
        name, rankOrder,
        (realm.abilities || '').slice(0, 500),
        (realm.limits || '').slice(0, 500),
        (realm.breakthrough || '').slice(0, 500),
        (realm.notes || '').slice(0, 500),
        existing.id,
      )
      return existing.id
    }
    const r = db.prepare(`
      INSERT INTO canon_realms (name, rank_order, abilities, limits, breakthrough, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      name, rankOrder,
      (realm.abilities || '').slice(0, 500),
      (realm.limits || '').slice(0, 500),
      (realm.breakthrough || '').slice(0, 500),
      (realm.notes || '').slice(0, 500),
    )
    return Number(r.lastInsertRowid)
  }

  /** 境界阶梯（按阶数从低到高） */
  static getRealms(): Realm[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(`SELECT * FROM canon_realms ORDER BY rank_order ASC, id ASC`).all() as Array<{
      id: number; name: string; rank_order: number; abilities: string; limits: string; breakthrough: string; notes: string; created_at: string
    }>
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      rankOrder: row.rank_order,
      abilities: row.abilities,
      limits: row.limits,
      breakthrough: row.breakthrough,
      notes: row.notes,
      createdAt: row.created_at,
    }))
  }

  /** 删除一阶（登记错了可以撤） */
  static removeRealm(id: number): boolean {
    const db = getProjectDb()
    if (!db) return false
    return db.prepare(`DELETE FROM canon_realms WHERE id = ?`).run(id).changes > 0
  }

  // ============================================================
  // 地点与空间关系
  // ============================================================

  /** 保存一个地点（带 id 按 id 更新；否则同名视为更新；都没有则新建） */
  static upsertLocation(location: Location): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const name = this.normalizeForDedup(location.name)
    if (!name) throw new Error('[CanonRepository] upsertLocation: name 不能为空')
    const existing = (location.id != null
      ? db.prepare(`SELECT id FROM canon_locations WHERE id = ?`).get(location.id)
      : db.prepare(`SELECT id FROM canon_locations WHERE name = ? COLLATE NOCASE`).get(name)) as { id: number } | undefined
    const args = [
      name,
      (location.region || '').slice(0, 200),
      (location.faction || '').slice(0, 200),
      (location.distanceNote || '').slice(0, 500),
      (location.travelNote || '').slice(0, 500),
      (location.notes || '').slice(0, 500),
    ]
    if (existing) {
      db.prepare(`
        UPDATE canon_locations SET name = ?, region = ?, faction = ?, distance_note = ?, travel_note = ?, notes = ?
        WHERE id = ?
      `).run(...args, existing.id)
      return existing.id
    }
    const r = db.prepare(`
      INSERT INTO canon_locations (name, region, faction, distance_note, travel_note, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(...args)
    return Number(r.lastInsertRowid)
  }

  /** 全部地点（按区域、名称排序） */
  static getLocations(): Location[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(`SELECT * FROM canon_locations ORDER BY region COLLATE NOCASE ASC, name COLLATE NOCASE ASC, id ASC`).all() as Array<{
      id: number; name: string; region: string; faction: string; distance_note: string; travel_note: string; notes: string; created_at: string
    }>
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      region: row.region,
      faction: row.faction,
      distanceNote: row.distance_note,
      travelNote: row.travel_note,
      notes: row.notes,
      createdAt: row.created_at,
    }))
  }

  /** 删除一个地点 */
  static removeLocation(id: number): boolean {
    const db = getProjectDb()
    if (!db) return false
    return db.prepare(`DELETE FROM canon_locations WHERE id = ?`).run(id).changes > 0
  }

  /** 判断某表是否存在某列（用于兼容未完成 v10 迁移的旧库） */
  private static columnCache = new Map<string, boolean>()
  private static hasColumn(table: string, column: string): boolean {
    const key = `${table}.${column}`
    const cached = CanonRepository.columnCache.get(key)
    if (cached != null) return cached
    const db = getProjectDb()
    if (!db) return false
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      const exists = cols.some(c => c.name === column)
      CanonRepository.columnCache.set(key, exists)
      return exists
    } catch {
      return false
    }
  }

  static getFacts(): Fact[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_facts ORDER BY introduced_at ASC, id ASC`
    ).all() as FactRow[]
    return rows.map(rowToFact)
  }

  static addFact(fact: Omit<Fact, 'id'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const normalizedStatement = this.normalizeForDedup(fact.statement)
    if (!normalizedStatement) throw new Error('[CanonRepository] addFact: statement 不能为空')
    // 用 UNIQUE 索引 + INSERT OR IGNORE 处理重复（依赖 migration 添加的 idx_canon_facts_unique）
    // [v10] 额外持久化 source_paragraph_index（原文段落定位）与 arc_id（所属分卷）。
    //       旧库若迁移失败缺列，退回不含这两列的写入，保证不阻塞定稿。
    const hasParagraphCol = this.hasColumn('canon_facts', 'source_paragraph_index')
    const hasArcCol = this.hasColumn('canon_facts', 'arc_id')
    const columns = ['category', 'statement', 'introduced_at', 'characters', 'evidence', 'status', 'confirmed_at', 'updated_at']
    const values = ['?', '?', '?', '?', '?', '?', '?', "datetime('now')"]
    const args: unknown[] = [
      fact.category,
      normalizedStatement,
      fact.introducedAt || 0,
      JSON.stringify(fact.characters || []),
      (fact.evidence || '').slice(0, 500),  // 截断 evidence
      fact.status || 'active',
      // confirmed_at 为 NULL 表示「AI 提取、尚未经作者确认」
      fact.confirmedAt ?? null,
    ]
    if (hasParagraphCol) { columns.push('source_paragraph_index'); values.push('?'); args.push(fact.sourceParagraphIndex ?? -1) }
    if (hasArcCol) { columns.push('arc_id'); values.push('?'); args.push(fact.arcId ?? null) }
    const r = db.prepare(`
      INSERT OR IGNORE INTO canon_facts
        (${columns.join(', ')})
      VALUES (${values.join(', ')})
    `).run(...args)
    if (r.changes > 0) return Number(r.lastInsertRowid)
    // 重复：返回已存在行的 id
    const row = db.prepare(
      `SELECT id FROM canon_facts WHERE statement = ? COLLATE NOCASE`
    ).get(normalizedStatement) as { id: number } | undefined
    if (!row) throw new Error('[CanonRepository] addFact: INSERT OR IGNORE 失败')
    return row.id
  }

  /** 删除某章引入的全部事实（用于重写） */
  static clearChapterFacts(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`DELETE FROM canon_facts WHERE introduced_at = ?`).run(chapterNumber)
  }

  /** 更新事实的记忆状态（active / outdated / contradicted / tentative）。 */
  static markFactStatus(id: number, status: Fact['status']): void {
    const db = getProjectDb()
    if (!db) return
    const next = status || 'active'
    const before = this.getFactById(id)
    db.prepare(`UPDATE canon_facts SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(next, id)
    this.appendFactHistory(id, 'status', before ? { status: before.status ?? 'active' } : null, { status: next })
  }

  static getFactById(id: number): Fact | undefined {
    const db = getProjectDb()
    if (!db) return undefined
    const row = db.prepare(`SELECT * FROM canon_facts WHERE id = ?`).get(id) as FactRow | undefined
    return row ? rowToFact(row) : undefined
  }

  /**
   * 作者确认 / 取消确认。
   *
   * confirmed_at 只表示「作者过目过」，不参与注入措辞；确认一条 tentative 事实时
   * 顺带把它提升为 active（对应需求里的「由作者确认后，再更新正式事实库」）。
   */
  static setFactConfirmed(id: number, confirmed: boolean): void {
    const db = getProjectDb()
    if (!db) return
    const before = this.getFactById(id)
    if (!before) return
    const promote = confirmed && (before.status ?? 'active') === 'tentative'
    if (confirmed) {
      db.prepare(`UPDATE canon_facts SET confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id)
      if (promote) db.prepare(`UPDATE canon_facts SET status = 'active' WHERE id = ?`).run(id)
    } else {
      db.prepare(`UPDATE canon_facts SET confirmed_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(id)
    }
    this.appendFactHistory(
      id,
      confirmed ? 'confirm' : 'unconfirm',
      { confirmedAt: before.confirmedAt ?? null, status: before.status ?? 'active' },
      { confirmedAt: confirmed ? new Date().toISOString() : null, status: promote ? 'active' : (before.status ?? 'active') },
    )
  }

  /** 批量确认 / 取消确认（事实页的「全部确认」） */
  static setFactsConfirmed(ids: number[], confirmed: boolean): number {
    const db = getProjectDb()
    if (!db) return 0
    const valid = (ids || []).filter(id => Number.isSafeInteger(id))
    if (valid.length === 0) return 0
    const tx = db.transaction(() => {
      let count = 0
      for (const id of valid) {
        if (!this.getFactById(id)) continue
        this.setFactConfirmed(id, confirmed)
        count++
      }
      return count
    })
    return tx()
  }

  /** 记录一条事实变更历史 */
  /**
   * 记录「本章沿用了哪些既有事实」。
   *
   * [P0-4 修复] 改进匹配策略：
   *   - 原：仅用 evidence/statement 精确子串匹配 → 中文改写几乎全部漏记
   *   - 新：1. 精确子串匹配（evidence ≥ 2 字 或 statement ≥ 4 字）
   *         2. 关键词重叠匹配：从 statement 中提取 2-4 字关键词，若 ≥ 2 个命中则算引用
   *         3. 角色名匹配：若事实涉及的角色在本章出现，也算弱引用（仅对 identity/relationship 类）
   */
  static recordFactUsage(chapterNumber: number, chapterContent: string, excludeFactIds?: Set<number>): number {
    const db = getProjectDb()
    if (!db) return 0
    const text = chapterContent || ''
    if (!text.trim()) return 0
    const candidates = this.getFacts().filter(fact =>
      fact.id != null &&
      !excludeFactIds?.has(fact.id) &&
      (fact.status ?? 'active') !== 'outdated' &&
      fact.introducedAt < chapterNumber)
    const insert = db.prepare(`INSERT INTO canon_fact_usage (fact_id, chapter_number, evidence) VALUES (?, ?, ?)`)
    let count = 0
    for (const fact of candidates) {
      // 策略1：精确子串匹配（原策略，保守可靠）
      const evidence = (fact.evidence || '').trim()
      const matched = evidence.length >= 2 && text.includes(evidence)
        ? evidence
        : (fact.statement.length >= 4 && text.includes(fact.statement) ? fact.statement : '')
      if (matched) {
        insert.run(fact.id, chapterNumber, matched.slice(0, 120))
        count++
        continue
      }
      // 策略2：关键词重叠匹配
      // 从 statement 中提取 2-4 字中文片段作为关键词
      const keywords = [...new Set(
        [...fact.statement.matchAll(/[\u4e00-\u9fa5]{2,4}/g)].map(m => m[0])
      )].filter(kw => kw.length >= 2 && !['一个', '一种', '什么', '怎么', '可以', '已经', '这是', '那是'].includes(kw))
      if (keywords.length >= 2) {
        const hits = keywords.filter(kw => text.includes(kw))
        if (hits.length >= Math.ceil(keywords.length * 0.4)) {
          insert.run(fact.id, chapterNumber, `关键词匹配: ${hits.slice(0, 3).join('、')}`.slice(0, 120))
          count++
          continue
        }
      }
      // 策略3：角色名匹配（仅对 identity/relationship 类）
      if ((fact.category === 'identity' || fact.category === 'relationship') && fact.characters.length > 0) {
        const charHits = fact.characters.filter(name => name.length >= 2 && text.includes(name))
        if (charHits.length === fact.characters.length && charHits.length > 0) {
          // 弱引用：角色名命中但无具体证据，仍记录但不标记为"精确引用"
          insert.run(fact.id, chapterNumber, `角色名匹配: ${charHits.join('、')}`.slice(0, 120))
          count++
          continue
        }
      }
    }
    return count
  }

  /** 某条事实被哪些章节引用过（按章节升序） */
  static getFactUsageByFact(factId: number): Array<{ chapterNumber: number; evidence: string }> {
    const db = getProjectDb()
    if (!db) return []
    return (db.prepare(`SELECT chapter_number, evidence FROM canon_fact_usage WHERE fact_id = ? ORDER BY chapter_number ASC`)
      .all(factId) as Array<{ chapter_number: number; evidence: string }>)
      .map(row => ({ chapterNumber: row.chapter_number, evidence: row.evidence || '' }))
  }

  /** 某一章引用了哪些事实 */
  static getFactUsageByChapter(chapterNumber: number): Array<{ factId: number; evidence: string }> {
    const db = getProjectDb()
    if (!db) return []
    return (db.prepare(`SELECT fact_id, evidence FROM canon_fact_usage WHERE chapter_number = ? ORDER BY fact_id ASC`)
      .all(chapterNumber) as Array<{ fact_id: number; evidence: string }>)
      .map(row => ({ factId: row.fact_id, evidence: row.evidence || '' }))
  }

  static appendFactHistory(
    factId: number,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): void {
    const db = getProjectDb()
    if (!db) return
    try {
      db.prepare(`
        INSERT INTO canon_fact_history (fact_id, action, before_json, after_json)
        VALUES (?, ?, ?, ?)
      `).run(factId, action, before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '')
    } catch (e) {
      console.warn('[CanonRepository] 写入事实历史失败:', e)
    }
  }

  /** 某条事实的变更历史（最近的在前） */
  static getFactHistory(factId: number, limit = 50): FactHistoryRow[] {
    const db = getProjectDb()
    if (!db) return []
    return db.prepare(
      `SELECT * FROM canon_fact_history WHERE fact_id = ? ORDER BY id DESC LIMIT ?`
    ).all(factId, Math.max(1, limit)) as FactHistoryRow[]
  }

  /** 找出与候选事实可能冲突的 active 事实（保守判定，见 detectFactConflict）。 */
  static findConflictingFacts(candidate: Pick<Fact, 'category' | 'statement' | 'characters'>): Fact[] {
    if (!candidate?.statement) return []
    return this.getFacts().filter(fact =>
      (fact.status ?? 'active') === 'active' &&
      fact.statement !== candidate.statement &&
      detectFactConflict(fact, candidate) !== null,
    )
  }

  // ============================================================
  // 章节摘要
  // ============================================================

  static getRecentSummaries(limit = 5): ChapterSummary[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_chapter_summaries
       ORDER BY chapter_number DESC LIMIT ?`
    ).all(limit) as ChapterSummaryRow[]
    return rows.map(rowToSummary).reverse()
  }

  /** 获取某章及之前的所有章节摘要（升序），用于拼装审稿摘要的时间线浓缩。 */
  static getSummariesUpTo(maxChapter: number): ChapterSummary[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_chapter_summaries
       WHERE chapter_number <= ?
       ORDER BY chapter_number ASC`
    ).all(maxChapter) as ChapterSummaryRow[]
    return rows.map(rowToSummary)
  }

  static getSummary(chapterNumber: number): ChapterSummary | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_chapter_summaries WHERE chapter_number = ?`
    ).get(chapterNumber) as ChapterSummaryRow | undefined
    return row ? rowToSummary(row) : null
  }

  /** 删除某章摘要（用于将章节回滚到未生成状态）。 */
  static clearChapterSummary(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`DELETE FROM canon_chapter_summaries WHERE chapter_number = ?`).run(chapterNumber)
  }

  static upsertSummary(summary: ChapterSummary): void {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    db.prepare(`
      INSERT INTO canon_chapter_summaries (chapter_number, title, summary, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chapter_number) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        created_at = excluded.created_at
    `).run(
      summary.chapterNumber,
      summary.title || '',
      summary.summary || '',
      summary.createdAt || new Date().toISOString(),
    )
  }

  // ============================================================
  // 原子写回（章节定稿主路径）
  // ============================================================

  /**
   * 整段章节定稿的写回打包成单次 SQLite 事务。
   * 步骤：(1) 清本章 timeline (2) 清本章 facts (3) 追加 timeline 事件
   *      (4) 合并/写入角色状态 (5) 追加剧情线 (6) 追加事实
   * 任何步骤失败 → 整个事务回滚。
   *
   * 这是 `canon-store.writeback` 调用的主路径。
   */
  static writebackAtomically(payload: {
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
  }): {
    timelineIds: number[]
    characterStatesWritten: number
    plotIds: number[]
    factIds: number[]
    conflicts: Array<{ aId: number; bId: number; reason: string }>
    impactCandidates: FactImpactCandidate[]
  } {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')

    const tx = db.transaction(() => {
      // 1) 清本章 timeline
      db.prepare(`DELETE FROM canon_timeline_events WHERE chapter_number = ?`)
        .run(payload.chapterNumber)
      // 2) 清本章 facts（连同它们的历史一起清掉，避免留下指向已删除事实的孤儿记录）
      //    先把旧事实留一份：重写后若某些事实消失、而后续章节引用过它们，
      //    就要在影响报告里指出来（只报告，不自动改后续章节）。
      const previousFacts = (db.prepare(`SELECT * FROM canon_facts WHERE introduced_at = ?`)
        .all(payload.chapterNumber) as FactRow[]).map(rowToFact)
      const removedFactIds = previousFacts.map(fact => fact.id!).filter(id => id != null)
      if (removedFactIds.length > 0) {
        const placeholders = removedFactIds.map(() => '?').join(', ')
        db.prepare(`DELETE FROM canon_fact_history WHERE fact_id IN (${placeholders})`).run(...removedFactIds)
      }
      db.prepare(`DELETE FROM canon_facts WHERE introduced_at = ?`)
        .run(payload.chapterNumber)
      // 本章作为「使用者」的引用记录重新计算；指向其它事实的旧记录保留（那是历史依赖证据）
      db.prepare(`DELETE FROM canon_fact_usage WHERE chapter_number = ?`).run(payload.chapterNumber)

      // [v10] 清本章的角色状态历史（重写幂等：同章重新定稿不产生重复快照）
      if (this.hasColumn('canon_character_state_history', 'chapter_number')) {
        try { db.prepare(`DELETE FROM canon_character_state_history WHERE chapter_number = ?`).run(payload.chapterNumber) } catch { /* 老库无此表 */ }
      }

      // [v10] 预切分本章正文段落，用于给新事实定位原文出处（摘要不能替代原文）
      const paragraphs = (payload.chapterContent || '')
        .split(/\n+/).map(p => p.trim()).filter(p => p.length > 0)
      const locateParagraph = (fact: { statement: string; evidence?: string }): number => {
        if (paragraphs.length === 0) return -1
        const ev = (fact.evidence || '').trim()
        if (ev.length >= 2) { const i = paragraphs.findIndex(p => p.includes(ev)); if (i >= 0) return i }
        const st = (fact.statement || '').trim()
        if (st.length >= 4) { const i = paragraphs.findIndex(p => p.includes(st)); if (i >= 0) return i }
        const terms = extractSearchTerms(fact.statement)
        if (terms.length > 0) {
          let best = -1, bestHits = 0
          paragraphs.forEach((p, i) => {
            const h = countTermHits(p, terms)
            if (h > bestHits) { bestHits = h; best = i }
          })
          if (bestHits >= Math.max(1, Math.ceil(terms.length * 0.5))) return best
        }
        return -1
      }

      const timelineIds: number[] = []
      for (const ev of payload.newEvents || []) {
        db.prepare(`
          INSERT INTO canon_timeline_events
            (chapter_number, sequence, characters, location, time_flow, summary, impact)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(chapter_number, sequence) DO UPDATE SET
            characters = excluded.characters,
            location = excluded.location,
            time_flow = excluded.time_flow,
            summary = excluded.summary,
            impact = excluded.impact
        `).run(
          ev.chapterNumber, ev.sequence,
          JSON.stringify(ev.characters || []), ev.location || '',
          ev.timeFlow || 'sequential', ev.summary || '', ev.impact || '',
        )
        const idRow = db.prepare(
          `SELECT id FROM canon_timeline_events WHERE chapter_number = ? AND sequence = ?`
        ).get(ev.chapterNumber, ev.sequence) as { id: number }
        timelineIds.push(idRow.id)
      }

      let characterStatesWritten = 0
      for (const delta of payload.characterDeltas || []) {
        // merge by upsertCharacterState (which now does knowledge union)
        this.upsertCharacterState({
          character: delta.character,
          location: delta.after.location || '',
          powerLevel: delta.after.powerLevel || '',
          physicalState: delta.after.physicalState || '',
          mentalState: delta.after.mentalState || '',
          keyItems: delta.after.keyItems || '',
          currentGoal: delta.after.currentGoal || '',
          knowledge: delta.after.knowledge || [],
          relationships: delta.after.relationships || {},
          recentEvents: delta.after.recentEvents || '',
          updatedAtChapter: delta.chapterNumber,
          updatedAt: new Date().toISOString(),
        })
        characterStatesWritten++
        // [v10] 留痕：把本章合并后的完整状态写入历史链（不覆盖旧快照），
        //        使「第 50 章受伤、第 80 章痊愈」这类多阶段状态可回溯。
        if (this.hasColumn('canon_character_state_history', 'snapshot_json')) {
          try {
            const merged = this.getCharacterState(delta.character)
            if (merged) {
              this.appendCharacterStateHistory({
                character: delta.character,
                chapterNumber: delta.chapterNumber,
                snapshot: merged,
              })
            }
          } catch { /* 老库无此表：忽略，不影响写回 */ }
        }
      }

      const plotIds: number[] = []
      for (const line of payload.plotLineChanges?.added || []) {
        const id = this.addPlotLine(line)
        plotIds.push(id)
      }
      for (const adv of payload.plotLineChanges?.advanced || []) {
        this.advancePlotLine(adv.id, adv.currentState, adv.lastAdvancedAt)
      }
      for (const id of payload.plotLineChanges?.resolved || []) {
        this.resolvePlotLine(id, payload.chapterNumber)
      }

      const factIds: number[] = []
      // [v10] 给本章新事实关联所属分卷，并定位其在原文中的段落
      const currentArc = this.getArcForChapter(payload.chapterNumber)
      for (const fact of payload.newFacts || []) {
        const id = this.addFact({
          ...fact,
          sourceParagraphIndex: locateParagraph(fact),
          arcId: currentArc?.id ?? undefined,
        })
        factIds.push(id)
      }

      // 记忆状态：新写入的事实若与既有 active 事实可能矛盾，两边都标记 contradicted。
      // 内容不删除、也不改写，只加标记并返回冲突说明，交给作者确认。
      const conflicts: Array<{ aId: number; bId: number; reason: string }> = []
      const newFactIdSet = new Set(factIds)
      // 既有对照集合：只拿 active 的旧事实（新写入的这批单独作为 candidate，无论其 status）
      const existingActiveFacts = this.getFacts().filter(fact =>
        (fact.status ?? 'active') === 'active' && fact.id != null && !newFactIdSet.has(fact.id))
      for (const factId of newFactIdSet) {
        const candidate = this.getFactById(factId)
        if (!candidate) continue
        for (const other of existingActiveFacts) {
          if (other.id === factId || other.id == null) continue
          const conflict = detectFactConflict(candidate, other)
          if (!conflict) continue
          this.markFactStatus(factId, 'contradicted')
          this.markFactStatus(other.id, 'contradicted')
          conflicts.push({ aId: factId, bId: other.id, reason: conflict.reason })
        }
      }

      // 3.5) 记录「本章沿用了哪些既有事实」——修改影响分析的数据基础。
      //      用本章正文与既有事实的证据短语/原句做精确匹配：宁可漏记，也不误记依赖关系。
      this.recordFactUsage(payload.chapterNumber, payload.chapterContent || '', newFactIdSet)

      // 4) 影响候选：本次重写后消失、但被后续章节引用过的事实
      //    注意：重写会删掉本章事实再重建（id 会变），所以「是否还在」按事实原文判断，
      //    否则每次重新定稿都会把全部事实误报成「已消失」。
      for (const fact of previousFacts) {
        if (fact.id == null) continue
        const fresh = db.prepare(`SELECT id FROM canon_facts WHERE statement = ? COLLATE NOCASE`).get(fact.statement) as { id: number } | undefined
        // 原文没变的：把后续章节的引用记录指向新的 id，保住依赖关系
        if (fresh && fresh.id !== fact.id) {
          db.prepare(`UPDATE canon_fact_usage SET fact_id = ? WHERE fact_id = ?`).run(fresh.id, fact.id)
        }
      }
      const impactCandidates: FactImpactCandidate[] = []
      for (const fact of previousFacts) {
        if (fact.id == null) continue
        const stillExists = (db.prepare(`SELECT 1 FROM canon_facts WHERE statement = ? COLLATE NOCASE`).get(fact.statement) as unknown) != null
        if (stillExists) continue
        const usedBy = (db.prepare(`
          SELECT chapter_number, evidence FROM canon_fact_usage
          WHERE fact_id = ? AND chapter_number > ?
          ORDER BY chapter_number ASC
        `).all(fact.id, payload.chapterNumber) as Array<{ chapter_number: number; evidence: string }>)
          .map(row => ({ chapterNumber: row.chapter_number, evidence: row.evidence || '' }))
        if (usedBy.length > 0) impactCandidates.push({ fact, usedBy })
      }

      return { timelineIds, characterStatesWritten, plotIds, factIds, conflicts, impactCandidates }
    })

    return tx()
  }

  // ============================================================
  // 第二阶段：分层记忆 — 分卷（Arc）
  // ============================================================

  static getArcs(): Arc[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_arcs ORDER BY sort_order ASC, start_chapter ASC`
    ).all() as ArcRow[]
    return rows.map(rowToArc)
  }

  static getArcForChapter(chapterNumber: number): Arc | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_arcs
       WHERE start_chapter <= ? AND (end_chapter = 0 OR end_chapter >= ?)
       ORDER BY sort_order ASC LIMIT 1`
    ).get(chapterNumber, chapterNumber) as ArcRow | undefined
    return row ? rowToArc(row) : null
  }

  static upsertArc(arc: Omit<Arc, 'createdAt' | 'updatedAt'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    if (arc.id != null) {
      db.prepare(`UPDATE canon_arcs SET title=?, start_chapter=?, end_chapter=?, main_conflict=?, character_development=?, key_events=?, stage_goal=?, sort_order=?, updated_at=datetime('now') WHERE id=?`)
        .run(arc.title, arc.startChapter, arc.endChapter, arc.mainConflict, arc.characterDevelopment, arc.keyEvents, arc.stageGoal, arc.sortOrder, arc.id)
      return arc.id
    }
    const r = db.prepare(`INSERT INTO canon_arcs (title, start_chapter, end_chapter, main_conflict, character_development, key_events, stage_goal, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(arc.title, arc.startChapter, arc.endChapter, arc.mainConflict, arc.characterDevelopment, arc.keyEvents, arc.stageGoal, arc.sortOrder)
    return Number(r.lastInsertRowid)
  }

  static removeArc(id: number): boolean {
    const db = getProjectDb()
    if (!db) return false
    return db.prepare(`DELETE FROM canon_arcs WHERE id = ?`).run(id).changes > 0
  }

  // ============================================================
  // 第二阶段：角色状态历史链
  // ============================================================

  static getCharacterStateHistory(character: string, upToChapter?: number): CharacterStateHistoryEntry[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_character_state_history
       WHERE character = ? ${upToChapter != null ? 'AND chapter_number <= ?' : ''}
       ORDER BY chapter_number ASC, id ASC`
    ).all(character, ...(upToChapter != null ? [upToChapter] : [])) as CSHRow[]
    return rows.map(rowToCSH)
  }

  static getCharacterStateAtChapter(character: string, chapterNumber: number): CharacterStateSnapshot | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_character_state_history
       WHERE character = ? AND chapter_number <= ?
       ORDER BY chapter_number DESC, id DESC LIMIT 1`
    ).get(character, chapterNumber) as CSHRow | undefined
    if (!row) return null
    try {
      return JSON.parse(row.snapshot_json) as CharacterStateSnapshot
    } catch {
      return null
    }
  }

  static appendCharacterStateHistory(entry: { character: string; chapterNumber: number; snapshot: CharacterStateSnapshot }): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const r = db.prepare(
      `INSERT INTO canon_character_state_history (character, chapter_number, snapshot_json) VALUES (?, ?, ?)`
    ).run(entry.character, entry.chapterNumber, JSON.stringify(entry.snapshot))
    return Number(r.lastInsertRowid)
  }

  // ============================================================
  // 第二阶段：人物别名/称谓
  // ============================================================

  static getCharacterAliases(): Map<string, string[]> {
    const db = getProjectDb()
    const map = new Map<string, string[]>()
    if (!db) return map
    // 1) characters 表：主名 → 别名数组（含无别名的角色，值可能为 []）
    try {
      const rows = db.prepare(`SELECT name, aliases_json FROM characters`).all() as Array<{ name: string; aliases_json?: string | null }>
      for (const row of rows) {
        if (!row.name) continue
        let aliases: string[] = []
        if (row.aliases_json) {
          try {
            const parsed = JSON.parse(row.aliases_json) as unknown
            if (Array.isArray(parsed)) aliases = parsed.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
          } catch { /* 损坏的 JSON：忽略别名，保留主名 */ }
        }
        map.set(row.name, aliases)
      }
    } catch { /* characters 表可能不存在 */ }
    // 2) canon_character_state 表：即使没有角色卡，也能解析 canon 中出现过的角色主名
    try {
      const rows = db.prepare(`SELECT character FROM canon_character_state`).all() as Array<{ character: string }>
      for (const row of rows) {
        if (row.character && !map.has(row.character)) map.set(row.character, [])
      }
    } catch { /* 忽略 */ }
    return map
  }

  /** 判断一个查询名是否匹配某个角色（含别名） */
  static resolveCharacterName(query: string): string | null {
    const aliases = CanonRepository.getCharacterAliases()
    // 先精确匹配主名
    for (const [name] of aliases) {
      if (name === query) return name
    }
    // 再匹配别名
    for (const [name, aliasList] of aliases) {
      if (aliasList.includes(query)) return name
    }
    // 最后模糊匹配（包含关系）
    for (const [name, aliasList] of aliases) {
      if (name.includes(query) || query.includes(name) || aliasList.some(a => a.includes(query) || query.includes(a))) {
        return name
      }
    }
    return null
  }

  // ============================================================
  // 第二阶段：统一精准检索入口
  // ============================================================

  /**
   * 统一检索入口：跨表交叉检索人物/事件/物品/伏笔/章节/事实。
   *
   * 检索策略（不依赖向量，纯 SQLite + 关键词）：
   *   1. 把查询文本拆成关键词（extractSearchTerms）
   *   2. 在各 canon 表中按关键词命中数打分
   *   3. 角色名/别名匹配额外加分
   *   4. confirmed 事实额外加分
   *   5. outdated/历史记忆按 includeHistorical 控制
   *   6. 合并排序，返回带命中原因的结果
   */
  static searchCanon(params: MemorySearchParams): MemorySearchResult {
    const start = Date.now()
    const db = getProjectDb()
    if (!db) return { hits: [], total: 0, degraded: false, elapsedMs: 0 }
    const limit = Math.min(params.limit ?? 50, 200)
    const terms = extractSearchTerms(params.query)
    const types = params.types
    const includeHistorical = params.includeHistorical ?? false

    // 空查询且无任何过滤条件时，不返回任何命中——
    // 避免"搜索空字符串"变成"导出全部 canon"（也符合"证据不足时明确未找到"）。
    const hasFilter = !!params.character || !!params.item || !!params.chapterRange
    if (terms.length === 0 && !hasFilter) {
      return { hits: [], total: 0, degraded: false, elapsedMs: Date.now() - start }
    }

    // 角色名解析（含别名）
    let resolvedChar: string | null = null
    if (params.character) {
      resolvedChar = CanonRepository.resolveCharacterName(params.character)
    } else if (terms.length > 0) {
      // 尝试从查询词中解析角色名
      for (const t of terms) {
        const r = CanonRepository.resolveCharacterName(t)
        if (r) { resolvedChar = r; break }
      }
    }

    const allHits: MemorySearchHit[] = []
    const shouldSearch = (t: MemoryHitType) => !types || types.includes(t)

    // --- 事实 ---
    if (shouldSearch('fact')) {
      const facts = CanonRepository.getFacts()
      // [v10] 预计算冲突对（一次性两两检测，O(n²)），供每条事实标注「与谁冲突」。
      //        规模过大时跳过，避免拖慢检索。
      const conflictPeers = new Map<number, string[]>()
      if (facts.length <= 2000) {
        for (let i = 0; i < facts.length; i++) {
          for (let j = i + 1; j < facts.length; j++) {
            const a = facts[i], b = facts[j]
            if (a.id == null || b.id == null) continue
            // 不要求任一方已经是 contradicted：Vela 默认 AI 提取的事实是 tentative，
            // 若在这里要求 contradicted，则「两条待确认事实互相矛盾」这一最常见情形永远标注不出来。
            // 交给 detectFactConflict 自己做保守判定（同类 + 共享角色 + 一方否定 + 高相似）。
            if (detectFactConflict(a, b)) {
              if (!conflictPeers.has(a.id)) conflictPeers.set(a.id, [])
              if (!conflictPeers.has(b.id)) conflictPeers.set(b.id, [])
              conflictPeers.get(a.id)!.push(b.statement)
              conflictPeers.get(b.id)!.push(a.statement)
            }
          }
        }
      }
      for (const f of facts) {
        if (!includeHistorical && (f.status ?? 'active') === 'outdated') continue
        const reasons: string[] = []
        let score = 0
        const haystack = `${f.statement} ${f.evidence ?? ''} ${(f.characters ?? []).join(' ')}`
        const hits = countTermHits(haystack, terms)
        if (hits > 0) { score += 0.3 * (hits / terms.length); reasons.push(`关键词命中 ${hits}/${terms.length}`) }
        if (resolvedChar && (f.characters ?? []).some(c => c === resolvedChar)) {
          score += 0.25; reasons.push(`角色"${resolvedChar}"关联`)
        }
        if (params.item && f.category === 'item' && f.statement.includes(params.item)) {
          score += 0.3; reasons.push(`物品"${params.item}"匹配`)
        }
        if (params.chapterRange) {
          const inRange = (params.chapterRange.from == null || f.introducedAt >= params.chapterRange.from) &&
                          (params.chapterRange.to == null || f.introducedAt <= params.chapterRange.to)
          if (!inRange) continue
        }
        if (score === 0 && terms.length > 0) continue
        // 置信度加分
        if (f.confirmedAt) { score += 0.1; reasons.push('作者确认') }
        if ((f.status ?? 'active') === 'active') { score += 0.05 }
        if ((f.status ?? 'active') === 'contradicted') { score *= 0.5; reasons.push('⚠️存在冲突') }
        if ((f.status ?? 'active') === 'tentative') { score *= 0.7; reasons.push('暂定（AI提取）') }
        // 较新不等于正确：不因 introducedAt 高加分
        allHits.push({
          type: 'fact', id: f.id, title: f.statement, snippet: f.evidence || '',
          chapterNumber: f.introducedAt, characters: f.characters,
          status: f.status, confirmed: !!f.confirmedAt,
          score, matchReasons: reasons,
          isCurrent: (f.status ?? 'active') !== 'outdated',
          conflictsWith: f.id != null ? conflictPeers.get(f.id)?.slice(0, 3) : undefined,
          sourceLocation: f.sourceParagraphIndex != null && f.sourceParagraphIndex >= 0
            ? { chapterNumber: f.introducedAt, paragraphIndex: f.sourceParagraphIndex } : undefined,
        })
      }
    }

    // --- 时间线事件 ---
    if (shouldSearch('timeline')) {
      const rows = db.prepare(
        `SELECT * FROM canon_timeline_events
         ${params.chapterRange ? 'WHERE chapter_number >= ? AND chapter_number <= ?' : ''}
         ORDER BY chapter_number ASC, sequence ASC`
      ).all(...(params.chapterRange ? [params.chapterRange.from ?? 0, params.chapterRange.to ?? 999999] : [])) as TimelineRow[]
      for (const row of rows) {
        const haystack = `${row.summary} ${row.impact} ${row.location} ${row.characters}`
        const hits = countTermHits(haystack, terms)
        const reasons: string[] = []
        let score = 0
        if (hits > 0) { score += 0.3 * (hits / terms.length); reasons.push(`关键词命中 ${hits}/${terms.length}`) }
        if (resolvedChar) {
          try {
            const chars = JSON.parse(row.characters || '[]') as string[]
            if (chars.includes(resolvedChar)) { score += 0.25; reasons.push(`角色"${resolvedChar}"出场`) }
          } catch { /* skip */ }
        }
        if (score === 0 && terms.length > 0) continue
        allHits.push({
          type: 'timeline', id: row.id,
          title: `第${row.chapter_number}章 事件#${row.sequence}`,
          snippet: row.summary, chapterNumber: row.chapter_number,
          score, matchReasons: reasons, isCurrent: true,
        })
      }
    }

    // --- 角色状态（当前） ---
    if (shouldSearch('character_state')) {
      const states = CanonRepository.getAllCharacterStates()
      for (const s of states) {
        const haystack = `${s.character} ${s.location} ${s.powerLevel} ${s.physicalState} ${s.mentalState} ${s.currentGoal} ${s.recentEvents} ${s.keyItems}`
        const hits = countTermHits(haystack, terms)
        const reasons: string[] = []
        let score = 0
        if (hits > 0) { score += 0.3 * (hits / terms.length); reasons.push(`关键词命中 ${hits}/${terms.length}`) }
        if (resolvedChar && s.character === resolvedChar) { score += 0.35; reasons.push(`角色"${s.character}"精确匹配`) }
        if (score === 0 && terms.length > 0) continue
        allHits.push({
          type: 'character_state', title: s.character,
          snippet: `境界:${s.powerLevel} | 状态:${s.physicalState} | 目标:${s.currentGoal}`,
          characters: [s.character], chapterNumber: s.updatedAtChapter,
          score, matchReasons: reasons, isCurrent: true,
        })
      }
    }

    // --- 角色状态历史 ---
    if (shouldSearch('character_history') && includeHistorical && resolvedChar) {
      const history = CanonRepository.getCharacterStateHistory(resolvedChar)
      for (const h of history) {
        const haystack = JSON.stringify(h.snapshot)
        const hits = countTermHits(haystack, terms)
        if (hits === 0 && terms.length > 0) continue
        const score = 0.15 * (hits / Math.max(terms.length, 1))
        allHits.push({
          type: 'character_history', id: h.id,
          title: `${h.character} @ 第${h.chapterNumber}章`,
          snippet: `境界:${h.snapshot.powerLevel} | 状态:${h.snapshot.physicalState}`,
          characters: [h.character], chapterNumber: h.chapterNumber,
          score, matchReasons: ['历史快照'], isCurrent: false,
        })
      }
    }

    // --- 剧情线/伏笔 ---
    if (shouldSearch('plot_line')) {
      const lines = CanonRepository.getPlotLines()
      for (const p of lines) {
        if (!includeHistorical && p.status === 'resolved') continue
        const haystack = `${p.name} ${p.description} ${p.currentState} ${(p.characters ?? []).join(' ')}`
        const hits = countTermHits(haystack, terms)
        const reasons: string[] = []
        let score = 0
        if (hits > 0) { score += 0.3 * (hits / terms.length); reasons.push(`关键词命中 ${hits}/${terms.length}`) }
        if (resolvedChar && (p.characters ?? []).includes(resolvedChar)) { score += 0.25; reasons.push(`角色"${resolvedChar}"关联`) }
        if (p.kind === 'foreshadow') { score += 0.1; reasons.push('伏笔') }
        // 章节范围过滤：剧情线按 [startedAt, lastAdvancedAt] 与请求范围求交。
        // 范围外直接跳过，与事实/时间线/章节摘要的过滤口径保持一致，
        // 避免用户限定 1-5 章却混进第 7 章的剧情线。
        if (params.chapterRange) {
          const from = params.chapterRange.from ?? 0
          const to = params.chapterRange.to ?? 999999
          const start = p.startedAt ?? 0
          const end = p.lastAdvancedAt ?? start
          const overlaps = start <= to && end >= from
          if (!overlaps) continue
        }
        if (score === 0 && terms.length > 0) continue
        allHits.push({
          type: 'plot_line', id: p.id, title: p.name,
          snippet: p.currentState || p.description,
          chapterNumber: p.lastAdvancedAt, characters: p.characters,
          status: p.status, score, matchReasons: reasons,
          isCurrent: p.status === 'active',
        })
      }
    }

    // --- 物品流转 ---
    if (shouldSearch('item_event')) {
      const items = CanonRepository.getItemEvents(params.item)
      for (const ie of items) {
        const haystack = `${ie.item} ${ie.actor} ${ie.note}`
        const hits = countTermHits(haystack, terms)
        const reasons: string[] = []
        let score = 0
        if (hits > 0) { score += 0.3 * (hits / terms.length); reasons.push(`关键词命中 ${hits}/${terms.length}`) }
        if (params.item && ie.item.toLowerCase() === params.item.toLowerCase()) { score += 0.4; reasons.push('物品名精确匹配') }
        if (score === 0 && terms.length > 0 && !params.item) continue
        allHits.push({
          type: 'item_event', id: ie.id, title: `${ie.item} · ${ie.action}`,
          snippet: ie.note || '', chapterNumber: ie.chapterNumber,
          item: ie.item, characters: ie.actor ? [ie.actor] : undefined,
          score, matchReasons: reasons,
          isCurrent: !['destroyed', 'consumed', 'lost'].includes(ie.action),
        })
      }
    }

    // --- 章节摘要 ---
    if (shouldSearch('chapter_summary')) {
      const rows = db.prepare(
        `SELECT * FROM canon_chapter_summaries
         ${params.chapterRange ? 'WHERE chapter_number >= ? AND chapter_number <= ?' : ''}
         ORDER BY chapter_number ASC`
      ).all(...(params.chapterRange ? [params.chapterRange.from ?? 0, params.chapterRange.to ?? 999999] : [])) as ChapterSummaryRow[]
      for (const row of rows) {
        const haystack = `${row.title} ${row.summary}`
        const hits = countTermHits(haystack, terms)
        if (hits === 0 && terms.length > 0) continue
        const score = 0.25 * (hits / terms.length)
        allHits.push({
          type: 'chapter_summary', title: `第${row.chapter_number}章 ${row.title || ''}`,
          snippet: (row.summary || '').slice(0, 120), chapterNumber: row.chapter_number,
          score, matchReasons: [`关键词命中 ${hits}/${terms.length}`], isCurrent: true,
        })
      }
    }

    // --- 分卷/阶段记忆 ---
    if (shouldSearch('arc')) {
      const arcs = CanonRepository.getArcs()
      for (const a of arcs) {
        const haystack = `${a.title} ${a.mainConflict} ${a.characterDevelopment} ${a.keyEvents} ${a.stageGoal}`
        const hits = countTermHits(haystack, terms)
        const reasons: string[] = []
        let score = 0
        if (hits > 0) { score += 0.3 * (hits / Math.max(terms.length, 1)); reasons.push(`关键词命中 ${hits}/${terms.length}`) }
        if (params.chapterRange) {
          const from = params.chapterRange.from ?? 0
          const to = params.chapterRange.to ?? 999999
          const overlaps = a.startChapter <= to && (a.endChapter === 0 || a.endChapter >= from)
          if (overlaps) { score += 0.2; reasons.push('章节范围覆盖') }
        }
        if (score === 0 && terms.length > 0) continue
        allHits.push({
          type: 'arc', id: a.id, title: a.title,
          snippet: a.mainConflict || a.stageGoal || a.characterDevelopment || '',
          chapterNumber: a.startChapter,
          score, matchReasons: reasons,
          isCurrent: a.endChapter === 0,
        })
      }
    }

    // 排序：分数降序，同分按章节号升序
    allHits.sort((a, b) => b.score - a.score || (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0))
    const top = allHits.slice(0, limit)
    return { hits: top, total: allHits.length, degraded: false, elapsedMs: Date.now() - start }
  }

  // ============================================================
  // 第二阶段：原文证据定位
  // ============================================================

  /** 获取某章已定稿正文的段落列表（按换行分段） */
  static getChapterParagraphs(chapterNumber: number): string[] {
    const db = getProjectDb()
    if (!db) return []
    const draft = db.prepare(
      `SELECT d.content_id FROM drafts d
       WHERE d.chapter_number = ? AND d.status = 'finalized'
       ORDER BY d.version DESC LIMIT 1`
    ).get(chapterNumber) as { content_id: number } | undefined
    if (!draft) return []
    const content = db.prepare(`SELECT body FROM contents WHERE id = ?`).get(draft.content_id) as { body: string } | undefined
    if (!content?.body) return []
    return content.body.split(/\n+/).filter((p: string) => p.trim().length > 0)
  }
}

// ============================================================
// 行映射辅助函数（v10 新增类型）
// ============================================================

interface ArcRow {
  id: number
  title: string
  start_chapter: number
  end_chapter: number
  main_conflict: string
  character_development: string
  key_events: string
  stage_goal: string
  sort_order: number
  created_at: string
  updated_at: string
}

function rowToArc(row: ArcRow): Arc {
  return {
    id: row.id,
    title: row.title,
    startChapter: row.start_chapter,
    endChapter: row.end_chapter,
    mainConflict: row.main_conflict,
    characterDevelopment: row.character_development,
    keyEvents: row.key_events,
    stageGoal: row.stage_goal,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface CSHRow {
  id: number
  character: string
  chapter_number: number
  snapshot_json: string
  created_at: string
}

function rowToCSH(row: CSHRow): CharacterStateHistoryEntry {
  try {
    return {
      id: row.id,
      character: row.character,
      chapterNumber: row.chapter_number,
      snapshot: JSON.parse(row.snapshot_json) as CharacterStateSnapshot,
      createdAt: row.created_at,
    }
  } catch {
    return {
      id: row.id,
      character: row.character,
      chapterNumber: row.chapter_number,
      snapshot: { character: row.character, location: '', powerLevel: '', physicalState: '', mentalState: '', keyItems: '', currentGoal: '', knowledge: [], relationships: {}, recentEvents: '', updatedAtChapter: row.chapter_number, updatedAt: row.created_at },
      createdAt: row.created_at,
    }
  }
}
