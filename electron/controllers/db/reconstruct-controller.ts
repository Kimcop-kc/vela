/**
 * 拆书创作系统：逐章分析 / 原创大纲 / 相似度报告
 *
 * 三块表都由 ReconstructRepository 统一管理，且读取失败一律降级为空数组/ null
 * （列表页拿不到数据比整页报错更可接受）。
 */
import { ipcMain } from 'electron'
import { ReconstructRepository } from '../../repositories/reconstruct-repository'

export function registerReconstructController(): void {
  ipcMain.handle('db:book-analysis-list', async (_event, bookId: string) => {
    try {
      return ReconstructRepository.listAnalyses(String(bookId ?? ''))
    } catch (err) {
      console.warn('[db:book-analysis-list] failed:', err)
      return []
    }
  })
  ipcMain.handle('db:book-analysis-get', async (_event, id: number) => {
    try {
      return Number.isSafeInteger(id) ? ReconstructRepository.getAnalysis(id) : null
    } catch (err) {
      console.warn('[db:book-analysis-get] failed:', err)
      return null
    }
  })
  ipcMain.handle('db:book-analysis-get-many', async (_event, ids: number[]) => {
    try {
      return ReconstructRepository.getAnalyses(Array.isArray(ids) ? ids : [])
    } catch (err) {
      console.warn('[db:book-analysis-get-many] failed:', err)
      return []
    }
  })
  ipcMain.handle('db:book-analysis-put', async (_event, input: Parameters<typeof ReconstructRepository.upsertAnalysis>[0]) => {
    try {
      return { success: true, id: ReconstructRepository.upsertAnalysis(input) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:book-analysis-remove', async (_event, id: number) => {
    try {
      if (!Number.isSafeInteger(id)) return { success: false, error: '无效的 id' }
      return { success: ReconstructRepository.removeAnalysis(id) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:book-analysis-remove-book', async (_event, bookId: string) => {
    try {
      return { success: true, removed: ReconstructRepository.removeAnalysesByBook(String(bookId ?? '')) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:plot-outline-list', async () => {
    try {
      return ReconstructRepository.listOutlines()
    } catch (err) {
      console.warn('[db:plot-outline-list] failed:', err)
      return []
    }
  })
  ipcMain.handle('db:plot-outline-get', async (_event, id: number) => {
    try {
      return Number.isSafeInteger(id) ? ReconstructRepository.getOutline(id) : null
    } catch (err) {
      console.warn('[db:plot-outline-get] failed:', err)
      return null
    }
  })
  ipcMain.handle('db:plot-outline-save', async (_event, input: Parameters<typeof ReconstructRepository.saveOutline>[0]) => {
    try {
      return { success: true, id: ReconstructRepository.saveOutline(input) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:plot-outline-remove', async (_event, id: number) => {
    try {
      if (!Number.isSafeInteger(id)) return { success: false, error: '无效的 id' }
      return { success: ReconstructRepository.removeOutline(id) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:similarity-report-list', async (_event, limit?: number) => {
    try {
      return ReconstructRepository.listSimilarityReports(limit ?? 20)
    } catch (err) {
      console.warn('[db:similarity-report-list] failed:', err)
      return []
    }
  })
  ipcMain.handle('db:similarity-report-get', async (_event, id: number) => {
    try {
      return Number.isSafeInteger(id) ? ReconstructRepository.getSimilarityReport(id) : null
    } catch (err) {
      console.warn('[db:similarity-report-get] failed:', err)
      return null
    }
  })
  ipcMain.handle('db:similarity-report-save', async (_event, input: Parameters<typeof ReconstructRepository.saveSimilarityReport>[0]) => {
    try {
      return { success: true, id: ReconstructRepository.saveSimilarityReport(input) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:similarity-report-remove', async (_event, id: number) => {
    try {
      if (!Number.isSafeInteger(id)) return { success: false, error: '无效的 id' }
      return { success: ReconstructRepository.removeSimilarityReport(id) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
