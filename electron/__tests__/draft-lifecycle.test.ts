import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { DraftRepository } from '../repositories/draft-repository'
import { RevisionRepository } from '../repositories/revision-repository'
import { ReviewRepository } from '../repositories/review-repository'

let folder: string

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-draft-lifecycle-'))
  initProjectDatabase(folder)
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-draft-lifecycle-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true })
})

function createDraft(chapterNumber: number, version: number, status = 'draft', content = `第${chapterNumber}章正文`) {
  const id = DraftRepository.create({
    chapterNumber,
    version,
    source: version > 1 ? 'rewrite' : 'write',
    content,
    wordCount: content.length,
  })
  if (status !== 'draft') DraftRepository.updateStatus(id, status)
  return id
}

describe('draft lifecycle', () => {
  it('only unfinalizes from the latest finalized chapter in reverse order', () => {
    const chapterOne = createDraft(1, 1, 'finalized')
    const chapterTwo = createDraft(2, 1, 'finalized')

    expect(() => DraftRepository.unfinalize(chapterOne)).toThrow('第 2 章仍有后续定稿')
    expect(DraftRepository.getMeta(chapterOne)?.status).toBe('finalized')

    DraftRepository.unfinalize(chapterTwo)
    expect(DraftRepository.getMeta(chapterTwo)?.status).toBe('draft')

    DraftRepository.unfinalize(chapterOne)
    expect(DraftRepository.getMeta(chapterOne)?.status).toBe('draft')
  })

  it('blocks unfinalizing an older finalized version when a newer version is finalized', () => {
    const older = createDraft(1, 1, 'finalized')
    createDraft(1, 2, 'finalized')

    expect(() => DraftRepository.unfinalize(older)).toThrow('第 1 章仍有后续定稿')
  })

  it('refuses to delete finalized drafts and deletes related data for unfinalized drafts', () => {
    const finalized = createDraft(1, 1, 'finalized')
    expect(() => DraftRepository.delete(finalized)).toThrow('不能直接删除')
    expect(DraftRepository.getMeta(finalized)).not.toBeNull()

    const draftId = createDraft(2, 1, 'revised', '待删除正文')
    const revisionId = RevisionRepository.create({
      baseDraftId: draftId,
      revisionIndex: 1,
      revisionType: 'refine',
      content: '修稿正文',
      wordCount: 4,
    })
    const reviewId = ReviewRepository.create({
      baseDraftId: draftId,
      reviewIndex: 1,
      content: '审稿报告',
    })
    const revisionContentId = RevisionRepository.getFull(revisionId)!.contentId
    const reviewContentId = ReviewRepository.getFull(reviewId)!.contentId
    const draftContentId = DraftRepository.getMeta(draftId)!.contentId

    DraftRepository.delete(draftId)

    expect(DraftRepository.getMeta(draftId)).toBeNull()
    expect(RevisionRepository.getFull(revisionId)).toBeNull()
    expect(ReviewRepository.getFull(reviewId)).toBeNull()
    const remaining = getProjectDb()!.prepare(
      'SELECT COUNT(*) AS count FROM contents WHERE id IN (?, ?, ?)'
    ).get(draftContentId, revisionContentId, reviewContentId) as { count: number }
    expect(remaining.count).toBe(0)
  })

  it('resets an entire chapter only from the latest generated chapter', () => {
    const chapterOne = createDraft(1, 1, 'reviewed')
    const chapterTwo = createDraft(2, 1, 'revised')
    const revisionId = RevisionRepository.create({
      baseDraftId: chapterTwo,
      revisionIndex: 1,
      revisionType: 'refine',
      content: '第二章修稿',
      wordCount: 5,
    })
    ReviewRepository.create({ baseDraftId: chapterTwo, reviewIndex: 1, content: '第二章审稿' })
    const revisionContentId = RevisionRepository.getFull(revisionId)!.contentId

    expect(() => DraftRepository.resetChapter(1)).toThrow('第 2 章已有草稿')

    const reset = DraftRepository.resetChapter(2)
    expect(reset).toEqual({ deletedDrafts: 1, deletedRevisions: 1, deletedReviews: 1 })
    expect(DraftRepository.getMeta(chapterTwo)).toBeNull()
    expect(getProjectDb()!.prepare('SELECT id FROM contents WHERE id = ?').get(revisionContentId)).toBeUndefined()

    DraftRepository.resetChapter(1)
    expect(DraftRepository.getMeta(chapterOne)).toBeNull()
  })
})
