/** 拆书创作系统的数据访问（渲染进程侧）。界面只从这里读写，不直接拼 IPC 参数；失败一律降级为空值并留日志。 */
import { ipc } from '../ipc-client'
import type {
  BookAnalysisInput, BookAnalysisRecord,
  PlotOutlineInput, PlotOutlineRecord,
  SimilarityReportInput, SimilarityReportRecord,
} from '../../shared/reconstruct'

export const reconstructStore = {
  async listAnalyses(bookId: string): Promise<BookAnalysisRecord[]> {
    try {
      return (await ipc.invoke('db:book-analysis-list', bookId)) ?? []
    } catch (error) {
      console.warn('[reconstructStore] listAnalyses 失败:', error)
      return []
    }
  },

  async getAnalysis(id: number): Promise<BookAnalysisRecord | null> {
    try {
      return await ipc.invoke('db:book-analysis-get', id)
    } catch {
      return null
    }
  },

  async getAnalyses(ids: number[]): Promise<BookAnalysisRecord[]> {
    if (!ids.length) return []
    try {
      return (await ipc.invoke('db:book-analysis-get-many', ids)) ?? []
    } catch {
      return []
    }
  },

  async putAnalysis(input: BookAnalysisInput): Promise<number | null> {
    try {
      const result = await ipc.invoke('db:book-analysis-put', input)
      return result?.success ? result.id ?? null : null
    } catch (error) {
      console.warn('[reconstructStore] putAnalysis 失败:', error)
      return null
    }
  },

  async removeAnalysis(id: number): Promise<boolean> {
    try {
      return (await ipc.invoke('db:book-analysis-remove', id))?.success ?? false
    } catch {
      return false
    }
  },

  async removeAnalysesByBook(bookId: string): Promise<number> {
    try {
      return (await ipc.invoke('db:book-analysis-remove-book', bookId))?.removed ?? 0
    } catch {
      return 0
    }
  },

  async listOutlines(): Promise<PlotOutlineRecord[]> {
    try {
      return (await ipc.invoke('db:plot-outline-list')) ?? []
    } catch (error) {
      console.warn('[reconstructStore] listOutlines 失败:', error)
      return []
    }
  },

  async getOutline(id: number): Promise<PlotOutlineRecord | null> {
    try {
      return await ipc.invoke('db:plot-outline-get', id)
    } catch {
      return null
    }
  },

  async saveOutline(input: PlotOutlineInput): Promise<number | null> {
    try {
      const result = await ipc.invoke('db:plot-outline-save', input)
      return result?.success ? result.id ?? null : null
    } catch (error) {
      console.warn('[reconstructStore] saveOutline 失败:', error)
      return null
    }
  },

  async removeOutline(id: number): Promise<boolean> {
    try {
      return (await ipc.invoke('db:plot-outline-remove', id))?.success ?? false
    } catch {
      return false
    }
  },

  async listSimilarityReports(limit = 20): Promise<SimilarityReportRecord[]> {
    try {
      return (await ipc.invoke('db:similarity-report-list', limit)) ?? []
    } catch {
      return []
    }
  },

  async getSimilarityReport(id: number): Promise<SimilarityReportRecord | null> {
    try {
      return await ipc.invoke('db:similarity-report-get', id)
    } catch {
      return null
    }
  },

  async saveSimilarityReport(input: SimilarityReportInput): Promise<number | null> {
    try {
      const result = await ipc.invoke('db:similarity-report-save', input)
      return result?.success ? result.id ?? null : null
    } catch (error) {
      console.warn('[reconstructStore] saveSimilarityReport 失败:', error)
      return null
    }
  },

  async removeSimilarityReport(id: number): Promise<boolean> {
    try {
      return (await ipc.invoke('db:similarity-report-remove', id))?.success ?? false
    } catch {
      return false
    }
  },
}
