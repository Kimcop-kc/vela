/**
 * PipelineRepository — 写作流水线任务状态持久化
 *
 * 为什么落库：需求要求「中途关闭程序后恢复生成」「重试单个场景不能导致其他已确认正文被覆盖」。
 * 只放在内存里，进程一关任务就没了；放在多个草稿行里又会出现「谁覆盖谁」的歧义。
 * 所以按章节号存一行，策划 / 场景 / 分段状态全部序列化为 JSON，
 * 主进程只负责按章节号存取与删除，**不解析内容语义**（解析在渲染进程的 writing-pipeline）。
 *
 * 注意：这里存的是**任务状态**，不是正文。正文仍然只走 drafts 表，
 * 由作者显式保存；本表里的 text / confirmedText 是流水线的工作副本。
 */
import { getProjectDb } from '../database'

export interface PipelineRecord {
  chapterNumber: number
  outlineId: number
  outlineFingerprint: string
  mode: string
  targetWords: number
  plan: unknown
  scenes: unknown
  segments: unknown
  createdAt: string
  updatedAt: string
}

function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || !text.trim()) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    // 数据坏了不要让整条流水线读不出来：退回默认值，由界面提示重新规划
    return fallback
  }
}

function rowToRecord(row: Record<string, unknown>): PipelineRecord {
  return {
    chapterNumber: row.chapter_number as number,
    outlineId: (row.outline_id as number) ?? 0,
    outlineFingerprint: (row.outline_fingerprint as string) ?? '',
    mode: (row.mode as string) ?? 'outline-expand',
    targetWords: (row.target_words as number) ?? 0,
    plan: parseJson(row.plan_json, {}),
    scenes: parseJson(row.scenes_json, []),
    segments: parseJson(row.segments_json, []),
    createdAt: (row.created_at as string) ?? '',
    updatedAt: (row.updated_at as string) ?? '',
  }
}

export class PipelineRepository {
  /** 取某章的流水线任务（没有则 null，表示没有未完成任务） */
  static get(chapterNumber: number): PipelineRecord | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      'SELECT * FROM writing_pipeline WHERE chapter_number = ?',
    ).get(chapterNumber) as Record<string, unknown> | undefined
    return row ? rowToRecord(row) : null
  }

  /** 列出全部未完成的流水线任务（用于「恢复任务」入口） */
  static list(): PipelineRecord[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      'SELECT * FROM writing_pipeline ORDER BY updated_at DESC',
    ).all() as Array<Record<string, unknown>>
    return rows.map(rowToRecord)
  }

  /** 写入或覆盖某章的任务状态 */
  static upsert(params: {
    chapterNumber: number
    outlineId?: number
    outlineFingerprint?: string
    mode?: string
    targetWords?: number
    plan: unknown
    scenes: unknown
    segments: unknown
  }): { success: boolean; error?: string } {
    const db = getProjectDb()
    if (!db) return { success: false, error: '数据库未连接' }
    try {
      db.prepare(`
        INSERT INTO writing_pipeline
          (chapter_number, outline_id, outline_fingerprint, mode, target_words, plan_json, scenes_json, segments_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chapter_number) DO UPDATE SET
          outline_id = excluded.outline_id,
          outline_fingerprint = excluded.outline_fingerprint,
          mode = excluded.mode,
          target_words = excluded.target_words,
          plan_json = excluded.plan_json,
          scenes_json = excluded.scenes_json,
          segments_json = excluded.segments_json,
          updated_at = datetime('now')
      `).run(
        params.chapterNumber,
        params.outlineId ?? 0,
        params.outlineFingerprint ?? '',
        params.mode ?? 'outline-expand',
        params.targetWords ?? 0,
        JSON.stringify(params.plan ?? {}),
        JSON.stringify(params.scenes ?? []),
        JSON.stringify(params.segments ?? []),
      )
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /** 删除某章的任务状态（任务完成或作者主动放弃） */
  static remove(chapterNumber: number): boolean {
    const db = getProjectDb()
    if (!db) return false
    return db.prepare('DELETE FROM writing_pipeline WHERE chapter_number = ?').run(chapterNumber).changes > 0
  }
}
