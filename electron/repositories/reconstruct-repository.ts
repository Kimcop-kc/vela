/**
 * ReconstructRepository —— 拆书创作系统的持久化（三张表）
 *
 * 设计要点：
 *  - 分析结果按「书 + 章 + 类型」唯一：重跑即覆盖，不会堆半成品；
 *  - 复杂结构（分析结论 / 剧情节点 / 来源引用）以 JSON 列保存，读写都在这里收口，
 *    调用方拿到的始终是解析后的对象，不用自己 JSON.parse；
 *  - 所有写入都做长度截断，避免模型返回超长文本把库撑坏。
 */
import { getProjectDb } from '../database'
import type {
  BookAnalysisInput, BookAnalysisRecord, ChapterAnalysis,
  PlotOutlineInput, PlotOutlineRecord, PlotBeat, PlotOutlineSource, TechniqueKey,
  SimilarityReportInput, SimilarityReportRecord, SimilarityFinding, SimilarityRisk, SimilarityStats,
} from '../../src/shared/reconstruct'

const MAX_JSON_CHARS = 400_000

/** 解析 JSON 列；坏了就当空值，不让一条脏数据毁掉整个列表 */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

function stringify(value: unknown): string {
  try {
    const text = JSON.stringify(value ?? null)
    return text.length > MAX_JSON_CHARS ? 'null' : text
  } catch {
    return 'null'
  }
}

function clampText(value: unknown, max = 20_000): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export class ReconstructRepository {
  // ============================================================
  // 一、拆书分析
  // ============================================================

  /** 新增或覆盖一条分析结果（按 书 + 章 + 类型 唯一） */
  static upsertAnalysis(input: BookAnalysisInput): number {
    const db = getProjectDb()
    if (!db) throw new Error('[ReconstructRepository] 数据库未连接')
    const bookId = clampText(input.bookId, 200)
    if (!bookId) throw new Error('[ReconstructRepository] upsertAnalysis: bookId 不能为空')
    const chapterNumber = Number.isSafeInteger(input.chapterNumber) ? input.chapterNumber : 0
    if (chapterNumber <= 0) throw new Error('[ReconstructRepository] upsertAnalysis: chapterNumber 必须是正整数')
    const analysisType = input.analysisType ?? 'chapter'
    if (analysisType !== 'chapter' && analysisType !== 'book') throw new Error('[ReconstructRepository] upsertAnalysis: analysisType 不正确')
    if (input.status !== 'done' && input.status !== 'failed') throw new Error('[ReconstructRepository] upsertAnalysis: status 不正确')

    const result = db.prepare(`
      INSERT INTO book_analyses
        (book_id, book_name, chapter_number, chapter_title, doc_id, analysis_type, status, result_json, model_id, error, source_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, chapter_number, analysis_type) DO UPDATE SET
        book_name = excluded.book_name,
        chapter_title = excluded.chapter_title,
        doc_id = excluded.doc_id,
        status = excluded.status,
        result_json = excluded.result_json,
        model_id = excluded.model_id,
        error = excluded.error,
        source_hash = excluded.source_hash,
        updated_at = datetime('now')
      RETURNING id
    `).get(
      bookId,
      clampText(input.bookName, 500),
      chapterNumber,
      clampText(input.chapterTitle, 500),
      clampText(input.docId, 200),
      analysisType,
      input.status,
      stringify(input.result ?? null),
      clampText(input.modelId, 200),
      clampText(input.error, 2000),
      clampText(input.sourceHash, 100),
    ) as { id: number } | undefined
    return result?.id ?? 0
  }

  /** 某本书的全部分析（按章节升序） */
  static listAnalyses(bookId: string, analysisType = 'chapter'): BookAnalysisRecord[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(`
      SELECT * FROM book_analyses WHERE book_id = ? AND analysis_type = ? ORDER BY chapter_number ASC, id ASC
    `).all(clampText(bookId, 200), analysisType) as Array<Record<string, unknown>>
    return rows.map(toAnalysisRecord)
  }

  /** 按主键取一条 */
  static getAnalysis(id: number): BookAnalysisRecord | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare('SELECT * FROM book_analyses WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? toAnalysisRecord(row) : null
  }

  /** 按主键批量取（重构大纲时按 id 回捞来源章节） */
  static getAnalyses(ids: number[]): BookAnalysisRecord[] {
    const db = getProjectDb()
    if (!db) return []
    const safe = ids.filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 200)
    if (safe.length === 0) return []
    const placeholders = safe.map(() => '?').join(',')
    const rows = db.prepare(`SELECT * FROM book_analyses WHERE id IN (${placeholders})`).all(...safe) as Array<Record<string, unknown>>
    return rows.map(toAnalysisRecord)
  }

  /** 删除一条分析 */
  static removeAnalysis(id: number): boolean {
    const db = getProjectDb()
    if (!db) return false
    return db.prepare('DELETE FROM book_analyses WHERE id = ?').run(id).changes > 0
  }

  /** 删除某本书的全部分析（移除拆书时一并清理） */
  static removeAnalysesByBook(bookId: string): number {
    const db = getProjectDb()
    if (!db) return 0
    return db.prepare('DELETE FROM book_analyses WHERE book_id = ?').run(clampText(bookId, 200)).changes
  }

  // ============================================================
  // 二、原创剧情大纲
  // ============================================================

  static saveOutline(input: PlotOutlineInput): number {
    const db = getProjectDb()
    if (!db) throw new Error('[ReconstructRepository] 数据库未连接')
    const title = clampText(input.title, 500).trim()
    if (!title) throw new Error('[ReconstructRepository] saveOutline: title 不能为空')
    const values = [
      title,
      clampText(input.premise),
      clampText(input.protagonistGoal),
      clampText(input.centralConflict),
      clampText(input.characterChanges),
      clampText(input.foreshadowing),
      clampText(input.continuityNotes),
      clampText(input.originalityNotes),
      stringify(input.techniques ?? []),
      stringify(input.beats ?? []),
      stringify(input.sources ?? []),
      input.status === 'confirmed' ? 'confirmed' : 'draft',
    ]
    if (input.id) {
      const result = db.prepare(`
        UPDATE plot_outlines SET
          title = ?, premise = ?, protagonist_goal = ?, central_conflict = ?, character_changes = ?,
          foreshadowing = ?, continuity_notes = ?, originality_notes = ?,
          techniques_json = ?, beats_json = ?, sources_json = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(...values, input.id)
      if (result.changes !== 1) throw new Error('[ReconstructRepository] saveOutline: 大纲不存在或已被删除')
      return input.id
    }
    const inserted = db.prepare(`
      INSERT INTO plot_outlines
        (title, premise, protagonist_goal, central_conflict, character_changes, foreshadowing,
         continuity_notes, originality_notes, techniques_json, beats_json, sources_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...values)
    return Number(inserted.lastInsertRowid)
  }

  static listOutlines(): PlotOutlineRecord[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare('SELECT * FROM plot_outlines ORDER BY id DESC').all() as Array<Record<string, unknown>>
    return rows.map(toOutlineRecord)
  }

  static getOutline(id: number): PlotOutlineRecord | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare('SELECT * FROM plot_outlines WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? toOutlineRecord(row) : null
  }

  static removeOutline(id: number): boolean {
    const db = getProjectDb()
    if (!db) return false
    return db.prepare('DELETE FROM plot_outlines WHERE id = ?').run(id).changes > 0
  }

  // ============================================================
  // 三、相似度报告
  // ============================================================

  static saveSimilarityReport(input: SimilarityReportInput): number {
    const db = getProjectDb()
    if (!db) throw new Error('[ReconstructRepository] 数据库未连接')
    const report = input.report
    if (!report || typeof report !== 'object') throw new Error('[ReconstructRepository] saveSimilarityReport: 报告内容缺失')
    const risk: SimilarityRisk = (['low', 'medium', 'high', 'undetermined'] as const).includes(report.overallRisk)
      ? report.overallRisk
      : 'undetermined'
    const inserted = db.prepare(`
      INSERT INTO similarity_reports (chapter_number, draft_id, outline_id, book_ids, overall_risk, report_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      Number.isSafeInteger(input.chapterNumber) ? (input.chapterNumber as number) : null,
      Number.isSafeInteger(input.draftId) ? (input.draftId as number) : null,
      Number.isSafeInteger(input.outlineId) ? (input.outlineId as number) : null,
      (input.bookIds ?? []).map(id => clampText(id, 200)).join(','),
      risk,
      stringify(report),
    )
    return Number(inserted.lastInsertRowid)
  }

  /** 最近若干份报告（默认 20 条） */
  static listSimilarityReports(limit = 20): SimilarityReportRecord[] {
    const db = getProjectDb()
    if (!db) return []
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 20, 1), 200)
    const rows = db.prepare('SELECT * FROM similarity_reports ORDER BY id DESC LIMIT ?').all(safeLimit) as Array<Record<string, unknown>>
    return rows.map(toSimilarityRecord)
  }

  static getSimilarityReport(id: number): SimilarityReportRecord | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare('SELECT * FROM similarity_reports WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? toSimilarityRecord(row) : null
  }

  static removeSimilarityReport(id: number): boolean {
    const db = getProjectDb()
    if (!db) return false
    return db.prepare('DELETE FROM similarity_reports WHERE id = ?').run(id).changes > 0
  }
}

function toAnalysisRecord(row: Record<string, unknown>): BookAnalysisRecord {
  const raw = parseJson<ChapterAnalysis | null>(row.result_json, null)
  return {
    id: row.id as number,
    bookId: String(row.book_id ?? ''),
    bookName: String(row.book_name ?? ''),
    chapterNumber: Number(row.chapter_number ?? 0),
    chapterTitle: String(row.chapter_title ?? ''),
    docId: String(row.doc_id ?? ''),
    analysisType: (row.analysis_type === 'book' ? 'book' : 'chapter'),
    status: (row.status === 'failed' ? 'failed' : 'done'),
    modelId: String(row.model_id ?? ''),
    error: String(row.error ?? ''),
    sourceHash: String(row.source_hash ?? ''),
    // 「失败」记录不该带出上一次的结论，否则界面会显示过期的分析
    result: row.status === 'failed' ? null : raw,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function toOutlineRecord(row: Record<string, unknown>): PlotOutlineRecord {
  return {
    id: row.id as number,
    title: String(row.title ?? ''),
    premise: String(row.premise ?? ''),
    protagonistGoal: String(row.protagonist_goal ?? ''),
    centralConflict: String(row.central_conflict ?? ''),
    characterChanges: String(row.character_changes ?? ''),
    foreshadowing: String(row.foreshadowing ?? ''),
    continuityNotes: String(row.continuity_notes ?? ''),
    originalityNotes: String(row.originality_notes ?? ''),
    techniques: parseJson<TechniqueKey[]>(row.techniques_json, []),
    beats: parseJson<PlotBeat[]>(row.beats_json, []),
    sources: parseJson<PlotOutlineSource[]>(row.sources_json, []),
    status: row.status === 'confirmed' ? 'confirmed' : 'draft',
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function toSimilarityRecord(row: Record<string, unknown>): SimilarityReportRecord {
  const payload = parseJson<{ findings?: SimilarityFinding[]; summary?: string; stats?: SimilarityStats; generatedAt?: string }>(row.report_json, {})
  return {
    id: row.id as number,
    chapterNumber: row.chapter_number == null ? null : Number(row.chapter_number),
    draftId: row.draft_id == null ? null : Number(row.draft_id),
    outlineId: row.outline_id == null ? null : Number(row.outline_id),
    bookIds: String(row.book_ids ?? ''),
    overallRisk: (['low', 'medium', 'high'].includes(String(row.overall_risk)) ? String(row.overall_risk) : 'undetermined') as SimilarityRisk,
    findings: payload.findings ?? [],
    summary: payload.summary ?? '',
    stats: payload.stats ?? { referenceChapters: 0, generatedChars: 0, longestCommonRun: 0, nearDuplicateSentences: 0 },
    generatedAt: payload.generatedAt ?? String(row.created_at ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}
