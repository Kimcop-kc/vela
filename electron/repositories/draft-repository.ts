/**
 * DraftRepository — 草稿 (drafts 表 + contents 联动)
 *
 * 草稿是创作栈的主线。status='finalized' 代表定稿。
 * 正文统一存储在 contents 表中，drafts 只持有 content_id 外键。
 */
import { getProjectDb } from '../database'
import { ContentRepository } from './content-repository'

/** 草稿元数据（不含正文，适合列表查询） */
export interface DraftMeta {
    id: number
    chapterNumber: number
    version: number
    status: string
    source: string
    contentId: number
    wordCount: number
    createdAt: string
    updatedAt: string
}

/** 草稿完整数据（含正文） */
export interface DraftFull extends DraftMeta {
    content: string
}

/** DB 行 → DraftMeta */
function rowToMeta(row: Record<string, unknown>): DraftMeta {
    return {
        id: row.id as number,
        chapterNumber: row.chapter_number as number,
        version: row.version as number,
        status: row.status as string,
        source: row.source as string,
        contentId: row.content_id as number,
        wordCount: row.word_count as number,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
    }
}

export class DraftRepository {
    /**
     * 创建草稿（先写 contents 再建 draft 记录）
     * 返回新建的 draft ID
     */
    static create(params: {
        chapterNumber: number
        version: number
        source: 'write' | 'rewrite'
        content: string
        wordCount: number
    }): number {
        const db = getProjectDb()
        if (!db) throw new Error('[DraftRepository] 数据库未连接')

        // 事务：先入内容池，再建元数据
        const tx = db.transaction(() => {
            const contentId = ContentRepository.create(params.content)
            const result = db.prepare(`
        INSERT INTO drafts (chapter_number, version, source, content_id, word_count)
        VALUES (?, ?, ?, ?, ?)
      `).run(
                params.chapterNumber,
                params.version,
                params.source,
                contentId,
                params.wordCount,
            )
            return Number(result.lastInsertRowid)
        })

        return tx()
    }

    /** 列出章节的所有草稿（不含正文，按版本升序） */
    static listByChapter(chapterNumber: number): DraftMeta[] {
        const db = getProjectDb()
        if (!db) return []

        const rows = db.prepare(`
      SELECT * FROM drafts WHERE chapter_number = ? ORDER BY version ASC
    `).all(chapterNumber) as Record<string, unknown>[]

        return rows.map(rowToMeta)
    }

    /** 获取草稿元数据 */
    static getMeta(id: number): DraftMeta | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(
            'SELECT * FROM drafts WHERE id = ?'
        ).get(id) as Record<string, unknown> | undefined

        return row ? rowToMeta(row) : null
    }

    /** 获取草稿完整数据（含正文） */
    static getFull(id: number): DraftFull | null {
        const meta = DraftRepository.getMeta(id)
        if (!meta) return null

        const body = ContentRepository.getBody(meta.contentId)
        return { ...meta, content: body ?? '' }
    }

    /** 获取章节最新版本的草稿 */
    static getLatestByChapter(chapterNumber: number): DraftMeta | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(`
      SELECT * FROM drafts
      WHERE chapter_number = ?
      ORDER BY version DESC LIMIT 1
    `).get(chapterNumber) as Record<string, unknown> | undefined

        return row ? rowToMeta(row) : null
    }

    /** 获取章节已定稿的草稿 */
    static getFinalizedByChapter(chapterNumber: number): DraftMeta | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(`
      SELECT * FROM drafts
      WHERE chapter_number = ? AND status = 'finalized'
      ORDER BY version DESC LIMIT 1
    `).get(chapterNumber) as Record<string, unknown> | undefined

        return row ? rowToMeta(row) : null
    }

    /** 获取下一个可用版本号 */
    static getNextVersion(chapterNumber: number): number {
        const db = getProjectDb()
        if (!db) return 1

        const row = db.prepare(`
      SELECT MAX(version) as maxVer FROM drafts WHERE chapter_number = ?
    `).get(chapterNumber) as { maxVer: number | null }

        return (row.maxVer ?? 0) + 1
    }

    /** 获取最大的已定稿章节号，如果没有则返回 0 */
    static getMaxFinalizedChapter(): number {
        const db = getProjectDb()
        if (!db) return 0
        const row = db.prepare(`
            SELECT MAX(chapter_number) as maxChapter
            FROM drafts
            WHERE status = 'finalized'
        `).get() as { maxChapter: number | null }
        return row?.maxChapter ?? 0
    }

    /** 更新草稿状态 */
    static updateStatus(id: number, status: string, wordCount?: number): void {
        const db = getProjectDb()
        if (!db) return

        if (wordCount !== undefined) {
            db.prepare(`
        UPDATE drafts SET status = ?, word_count = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(status, wordCount, id)
        } else {
            db.prepare(`
        UPDATE drafts SET status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(status, id)
        }
    }

    /** 更新草稿正文（同时更新 contents 表） */
    static updateContent(id: number, content: string, wordCount: number): void {
        const meta = DraftRepository.getMeta(id)
        if (!meta) return

        ContentRepository.updateBody(meta.contentId, content)

        const db = getProjectDb()
        if (!db) return

        db.prepare(`
      UPDATE drafts SET word_count = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(wordCount, id)
    }

    /**
     * 解除定稿。
     *
     * 只允许从最后一章定稿开始倒序解除，避免较早正文恢复可编辑后，
     * 后续章节仍基于旧内容继续演进，造成剧情和上下文链不一致。
     */
    static assertCanUnfinalize(id: number): DraftMeta {
        const db = getProjectDb()
        if (!db) throw new Error('[DraftRepository] 数据库未连接')

        const meta = DraftRepository.getMeta(id)
        if (!meta) throw new Error('草稿不存在或已被删除。')
        if (meta.status !== 'finalized') throw new Error('只有已定稿草稿可以解除定稿。')

        const later = db.prepare(`
            SELECT chapter_number, version
            FROM drafts
            WHERE status = 'finalized'
              AND (
                chapter_number > ?
                OR (chapter_number = ? AND version > ?)
              )
            ORDER BY chapter_number ASC, version ASC
            LIMIT 1
        `).get(meta.chapterNumber, meta.chapterNumber, meta.version) as
            | { chapter_number: number; version: number }
            | undefined

        if (later) {
            throw new Error(
                `不能解除第 ${meta.chapterNumber} 章定稿：第 ${later.chapter_number} 章仍有后续定稿。` +
                '请从最后一章开始按倒序解除。'
            )
        }
        return meta
    }

    static unfinalize(id: number): DraftMeta {
        const db = getProjectDb()
        if (!db) throw new Error('[DraftRepository] 数据库未连接')

        const meta = DraftRepository.assertCanUnfinalize(id)
        db.prepare(`
            UPDATE drafts
            SET status = 'draft', updated_at = datetime('now')
            WHERE id = ?
        `).run(id)

        const updated = DraftRepository.getMeta(id)
        if (!updated) throw new Error('解除定稿失败：草稿状态未更新。')
        return { ...updated, chapterNumber: meta.chapterNumber }
    }

    /** 永久删除草稿（级联删除 revisions/reviews，并清理关联 contents） */
    static delete(id: number): void {
        const db = getProjectDb()
        if (!db) throw new Error('[DraftRepository] 数据库未连接')

        const tx = db.transaction(() => {
            const meta = DraftRepository.getMeta(id)
            if (!meta) throw new Error('草稿不存在或已被删除。')
            if (meta.status === 'finalized') {
                throw new Error('已定稿草稿不能直接删除，请先解除定稿。')
            }

            const revisionContentIds = db.prepare(`
                SELECT content_id FROM revisions WHERE base_draft_id = ?
            `).all(id) as Array<{ content_id: number }>
            const reviewContentIds = db.prepare(`
                SELECT content_id FROM reviews WHERE base_draft_id = ?
            `).all(id) as Array<{ content_id: number }>

            // drafts 删除会级联清理 revisions / reviews。
            db.prepare('DELETE FROM drafts WHERE id = ?').run(id)

            const contentIds = new Set<number>([
                meta.contentId,
                ...revisionContentIds.map(row => row.content_id),
                ...reviewContentIds.map(row => row.content_id),
            ])
            const deleteContent = db.prepare('DELETE FROM contents WHERE id = ?')
            for (const contentId of contentIds) deleteContent.run(contentId)
        })

        tx()
    }

    /**
     * 将一章整体回滚到“尚未生成草稿”的状态。
     *
     * 只允许重置最后一个已有草稿的章节；保留章节蓝图，但删除该章所有
     * 草稿、修稿、审稿及对应正文池记录，避免旧版本在后续生成时继续混入。
     */
    static assertCanResetChapter(chapterNumber: number): void {
        const db = getProjectDb()
        if (!db) throw new Error('[DraftRepository] 数据库未连接')

        const draft = db.prepare(
            'SELECT id FROM drafts WHERE chapter_number = ? LIMIT 1'
        ).get(chapterNumber)
        if (!draft) throw new Error('该章节还没有可重置的草稿。')

        const later = db.prepare(`
            SELECT chapter_number
            FROM drafts
            WHERE chapter_number > ?
            ORDER BY chapter_number ASC
            LIMIT 1
        `).get(chapterNumber) as { chapter_number: number } | undefined
        if (later) {
            throw new Error(
                `不能重置第 ${chapterNumber} 章：第 ${later.chapter_number} 章已有草稿。` +
                '请先处理后续章节，再从最后一章开始倒序重置。'
            )
        }
    }

    static resetChapter(chapterNumber: number): {
        deletedDrafts: number
        deletedRevisions: number
        deletedReviews: number
    } {
        const db = getProjectDb()
        if (!db) throw new Error('[DraftRepository] 数据库未连接')

        const tx = db.transaction(() => {
            DraftRepository.assertCanResetChapter(chapterNumber)
            const draftIds = db.prepare(`
                SELECT id FROM drafts WHERE chapter_number = ? ORDER BY version ASC
            `).all(chapterNumber) as Array<{ id: number }>

            const deletedRevisions = db.prepare(`
                SELECT COUNT(*) AS count
                FROM revisions
                WHERE base_draft_id IN (SELECT id FROM drafts WHERE chapter_number = ?)
            `).get(chapterNumber) as { count: number }
            const deletedReviews = db.prepare(`
                SELECT COUNT(*) AS count
                FROM reviews
                WHERE base_draft_id IN (SELECT id FROM drafts WHERE chapter_number = ?)
            `).get(chapterNumber) as { count: number }
            const contentIds = db.prepare(`
                SELECT content_id FROM drafts WHERE chapter_number = ?
                UNION
                SELECT content_id FROM revisions
                WHERE base_draft_id IN (SELECT id FROM drafts WHERE chapter_number = ?)
                UNION
                SELECT content_id FROM reviews
                WHERE base_draft_id IN (SELECT id FROM drafts WHERE chapter_number = ?)
            `).all(chapterNumber, chapterNumber, chapterNumber) as Array<{ content_id: number }>

            db.prepare('DELETE FROM drafts WHERE chapter_number = ?').run(chapterNumber)
            const deleteContent = db.prepare('DELETE FROM contents WHERE id = ?')
            for (const row of contentIds) deleteContent.run(row.content_id)

            return {
                deletedDrafts: draftIds.length,
                deletedRevisions: deletedRevisions.count,
                deletedReviews: deletedReviews.count,
            }
        })

        return tx()
    }
}
