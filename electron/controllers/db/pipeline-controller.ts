/**
 * [v11] 写作流水线的任务状态
 *
 * 每章一条记录，保存分段状态机的进度（plan / scenes / segments），
 * 用于长章生成中断后恢复与重试。
 */
import { ipcMain } from 'electron'
import { PipelineRepository } from '../../repositories/pipeline-repository'

export function registerPipelineController(): void {
  ipcMain.handle('db:pipeline-get', async (_event, chapterNumber: number) => {
    return PipelineRepository.get(chapterNumber)
  })
  ipcMain.handle('db:pipeline-list', async () => {
    return PipelineRepository.list()
  })
  ipcMain.handle('db:pipeline-save', async (_event, payload: {
    chapterNumber: number
    outlineId?: number
    outlineFingerprint?: string
    mode?: string
    targetWords?: number
    plan: unknown
    scenes: unknown
    segments: unknown
  }) => {
    if (!Number.isInteger(payload?.chapterNumber) || payload.chapterNumber <= 0) {
      return { success: false, error: '章节号非法' }
    }
    return PipelineRepository.upsert(payload)
  })
  ipcMain.handle('db:pipeline-remove', async (_event, chapterNumber: number) => {
    return { success: PipelineRepository.remove(chapterNumber) }
  })
}
