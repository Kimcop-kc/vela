/**
 * 草稿生命周期与章节回滚快照
 *
 * 这一组 handler 是「有副作用的写操作」最密集的地方：撤销定稿、删除草稿、重置章节
 * 都会牵动 Canon / 摘要 / 知识库 / 审稿摘要等派生数据，因此它们统一走
 * ./chapter-derived-state 里的补偿流程，并把失败降级成 warning 回传界面。
 */
import { ipcMain } from 'electron'
import { BlueprintRepository } from '../../repositories/blueprint-repository'
import { DraftRepository } from '../../repositories/draft-repository'
import { ChapterRollbackRepository } from '../../repositories/chapter-rollback-repository'
import { restoreChapterDerivedState } from './chapter-derived-state'

export function registerDraftController(): void {
  ipcMain.handle('db:draft-create', async (_event, params: {
    chapterNumber: number
    version: number
    source: 'write' | 'rewrite'
    content: string
    wordCount: number
  }) => {
    try {
      const id = DraftRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-list', async (_event, chapterNumber: number) => {
    return DraftRepository.listByChapter(chapterNumber)
  })

  ipcMain.handle('db:draft-get-meta', async (_event, id: number) => {
    return DraftRepository.getMeta(id)
  })

  ipcMain.handle('db:draft-get-full', async (_event, id: number) => {
    return DraftRepository.getFull(id)
  })

  ipcMain.handle('db:draft-get-latest', async (_event, chapterNumber: number) => {
    return DraftRepository.getLatestByChapter(chapterNumber)
  })

  ipcMain.handle('db:draft-get-finalized', async (_event, chapterNumber: number) => {
    return DraftRepository.getFinalizedByChapter(chapterNumber)
  })

  ipcMain.handle('db:draft-get-max-finalized-chapter', async () => {
    return DraftRepository.getMaxFinalizedChapter()
  })
  ipcMain.handle('db:draft-next-version', async (_event, chapterNumber: number) => {
    return DraftRepository.getNextVersion(chapterNumber)
  })

  ipcMain.handle('db:draft-update-status', async (_event, id: number, status: string, wordCount?: number) => {
    try {
      DraftRepository.updateStatus(id, status, wordCount)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-update-content', async (_event, id: number, content: string, wordCount: number) => {
    try {
      DraftRepository.updateContent(id, content, wordCount)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-unfinalize', async (_event, id: number) => {
    try {
      const target = DraftRepository.assertCanUnfinalize(id)
      const blueprint = BlueprintRepository.getByChapter(target.chapterNumber)
      const warning = await restoreChapterDerivedState(target.chapterNumber, blueprint?.title)
      const draft = DraftRepository.unfinalize(id)
      return {
        success: true,
        draft,
        warning,
      }
    } catch (err) {
      console.error('[db:draft-unfinalize] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-delete', async (_event, id: number) => {
    try {
      const meta = DraftRepository.getMeta(id)
      DraftRepository.delete(id)
      if (meta && DraftRepository.listByChapter(meta.chapterNumber).length === 0) {
        ChapterRollbackRepository.clear(meta.chapterNumber)
      }
      return { success: true }
    } catch (err) {
      console.error('[db:draft-delete] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-reset-chapter', async (_event, chapterNumber: number) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      return { success: false, error: '章节号无效。' }
    }

    try {
      DraftRepository.assertCanResetChapter(chapterNumber)
      const blueprint = BlueprintRepository.getByChapter(chapterNumber)
      const warning = await restoreChapterDerivedState(chapterNumber, blueprint?.title)
      const result = DraftRepository.resetChapter(chapterNumber)
      ChapterRollbackRepository.clear(chapterNumber)

      return { success: true, ...result, warning }
    } catch (err) {
      console.error('[db:draft-reset-chapter] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:chapter-rollback-capture', async (_event, chapterNumber: number) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      return { success: false, error: '章节号无效。' }
    }
    try {
      const result = ChapterRollbackRepository.capture(chapterNumber)
      return { success: true, size: result.size }
    } catch (err) {
      console.error('[db:chapter-rollback-capture] 失败:', err)
      return { success: false, error: String(err) }
    }
  })
}
