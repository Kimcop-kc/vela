/**
 * 修稿 / 审稿 / 审稿摘要 / 后处理跑批
 *
 * 这四块围绕同一条「定稿前的加工链」：草稿 → 修稿版本 → 审稿意见 → 定性摘要 → 后处理步骤记录。
 * 它们彼此有引用关系（修稿可挂审稿来源、审稿摘要按 Canon 指纹失效），所以放在一个模块里。
 */
import { ipcMain } from 'electron'
import { RevisionRepository } from '../../repositories/revision-repository'
import { ReviewRepository } from '../../repositories/review-repository'
import { ReviewDigestRepository } from '../../repositories/review-digest-repository'
import { PostProcessRepository } from '../../repositories/post-process-repository'

export function registerRevisionController(): void {
  // ============================================================
  // 5. revisions — 修稿
  // ============================================================
  ipcMain.handle('db:revision-create', async (_event, params: {
    baseDraftId: number
    revisionIndex: number
    revisionType: 'refine' | 'review-fix' | 'deai'
    userPrompt?: string
    reviewSourceId?: number
    content: string
    wordCount: number
  }) => {
    try {
      const id = RevisionRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:revision-list', async (_event, baseDraftId: number) => {
    return RevisionRepository.listByDraft(baseDraftId)
  })

  ipcMain.handle('db:revision-get-pending', async (_event, baseDraftId: number) => {
    return RevisionRepository.getPending(baseDraftId)
  })

  ipcMain.handle('db:revision-get-full', async (_event, id: number) => {
    return RevisionRepository.getFull(id)
  })

  ipcMain.handle('db:revision-next-index', async (_event, baseDraftId: number) => {
    return RevisionRepository.getNextIndex(baseDraftId)
  })

  ipcMain.handle('db:revision-mark-merged', async (_event, id: number, mergedToDraftId: number) => {
    try {
      RevisionRepository.markMerged(id, mergedToDraftId)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:revision-mark-discarded', async (_event, id: number) => {
    try {
      RevisionRepository.markDiscarded(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 6. reviews — 审稿
  // ============================================================
  ipcMain.handle('db:review-create', async (_event, params: {
    baseDraftId: number
    reviewIndex: number
    content: string
  }) => {
    try {
      const id = ReviewRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:review-list', async (_event, baseDraftId: number) => {
    return ReviewRepository.listByDraft(baseDraftId)
  })

  ipcMain.handle('db:review-get-latest', async (_event, baseDraftId: number) => {
    return ReviewRepository.getLatestByDraft(baseDraftId)
  })

  ipcMain.handle('db:review-get-full', async (_event, id: number) => {
    return ReviewRepository.getFull(id)
  })

  ipcMain.handle('db:review-next-index', async (_event, baseDraftId: number) => {
    return ReviewRepository.getNextIndex(baseDraftId)
  })

  // ============================================================
  // 6.1 review_digests — 定性审稿摘要
  // ============================================================
  ipcMain.handle('db:review-digest-get-latest-before', async (_event, chapterNumber: number) => {
    return ReviewDigestRepository.getLatestBefore(chapterNumber)
  })

  ipcMain.handle('db:review-digest-get', async (_event, chapterNumber: number) => {
    return ReviewDigestRepository.getByChapter(chapterNumber)
  })

  ipcMain.handle('db:review-digest-put', async (_event, params: {
    chapterNumber: number
    chapterTitle: string
    content: string
    canonFingerprint: string
  }) => {
    try {
      const id = ReviewDigestRepository.upsert(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:review-digest-invalidate-from', async (_event, chapterNumber: number) => {
    const deleted = ReviewDigestRepository.deleteFromChapter(chapterNumber)
    return { success: true, deleted }
  })

  // ============================================================
  // 7. post_process — 后处理跑批
  // ============================================================
  ipcMain.handle('db:post-process-create-run', async (_event, params: {
    triggerSourceType: string
    triggerSourceId: string
    sourceLabel: string
    steps: Array<{ key: string; label: string; critical: boolean }>
  }) => {
    try {
      const id = PostProcessRepository.createRun(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:post-process-get-latest-run', async (_event, sourceType: string, sourceId: string) => {
    return PostProcessRepository.getLatestRun(sourceType, sourceId)
  })

  ipcMain.handle('db:post-process-get-steps', async (_event, runId: string) => {
    return PostProcessRepository.getSteps(runId)
  })

  ipcMain.handle('db:post-process-mark-step-ok', async (_event, runId: string, stepKey: string) => {
    try {
      PostProcessRepository.markStepOk(runId, stepKey)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:post-process-mark-step-failed', async (_event, runId: string, stepKey: string, errorMsg: string) => {
    try {
      PostProcessRepository.markStepFailed(runId, stepKey, errorMsg)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:post-process-is-all-passed', async (_event, sourceType: string, sourceId: string) => {
    return PostProcessRepository.isAllCriticalPassed(sourceType, sourceId)
  })
}
