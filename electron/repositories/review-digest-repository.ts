/**
 * ReviewDigestRepository — 定性审稿摘要持久化
 *
 * 完整审稿把「已经审过章节的连续性记忆」单独存一份，下一章审稿时增量加载，
 * 而不是每次重读全书时间线与事实。摘要内容由渲染进程生成并序列化为 JSON，
 * 主进程只负责按章节号存取与失效清理。
 */
import { getProjectDb } from '../database'

/** 审稿摘要元数据 */
export interface ReviewDigestMeta {
    id: number
    chapterNumber: number
    chapterTitle: string
    content: string
    canonFingerprint: string
    createdAt: string
    updatedAt: string
}

function rowToMeta(row: Record<string, unknown>): ReviewDigestMeta {
    return {
        id: row.id as number,
        chapterNumber: row.chapter_number as number,
        chapterTitle: row.chapter_title as string,
        content: row.content as string,
        canonFingerprint: row.canon_fingerprint as string,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
    }
}

export class ReviewDigestRepository {
    /** 取「章节号严格小于 chapterNumber」的最新一份摘要 */
    static getLatestBefore(chapterNumber: number): ReviewDigestMeta | null {
        const db = getProjectDb()
        if (!db) return null
        const row = db.prepare(`
      SELECT * FROM chapter_review_digests
      WHERE chapter_number < ?
      ORDER BY chapter_number DESC
      LIMIT 1
    `).get(chapterNumber) as Record<string, unknown> | undefined
        return row ? rowToMeta(row) : null
    }

    /** 取某章对应的摘要 */
    static getByChapter(chapterNumber: number): ReviewDigestMeta | null {
        const db = getProjectDb()
        if (!db) return null
        const row = db.prepare(
            'SELECT * FROM chapter_review_digests WHERE chapter_number = ?'
        ).get(chapterNumber) as Record<string, unknown> | undefined
        return row ? rowToMeta(row) : null
    }

    /** 写入或覆盖某章摘要 */
    static upsert(params: {
        chapterNumber: number
        chapterTitle: string
        content: string
        canonFingerprint: string
    }): number {
        const db = getProjectDb()
        if (!db) throw new Error('[ReviewDigestRepository] 数据库未连接')

        db.prepare(`
      INSERT INTO chapter_review_digests
        (chapter_number, chapter_title, content, canon_fingerprint)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chapter_number) DO UPDATE SET
        chapter_title = excluded.chapter_title,
        content = excluded.content,
        canon_fingerprint = excluded.canon_fingerprint,
        updated_at = datetime('now')
    `).run(
            params.chapterNumber,
            params.chapterTitle || '',
            params.content,
            params.canonFingerprint,
        )

        const row = db.prepare(
            'SELECT id FROM chapter_review_digests WHERE chapter_number = ?'
        ).get(params.chapterNumber) as { id: number }
        return row.id
    }

    /** 删除从 chapterNumber 起的后续摘要（用于章节解除定稿/重置后失效） */
    static deleteFromChapter(chapterNumber: number): number {
        const db = getProjectDb()
        if (!db) return 0
        return db.prepare(
            'DELETE FROM chapter_review_digests WHERE chapter_number >= ?'
        ).run(chapterNumber).changes
    }
}
