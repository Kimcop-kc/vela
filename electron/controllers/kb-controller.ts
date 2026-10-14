import { ipcMain, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  importDocument, importFolder, importText, searchKnowledge, searchKnowledgeFTS,
  listDocuments, removeDocument, getKnowledgeStats,
  getVectorlessCount, backfillVectors,
  getDocumentText,
  getDocumentTextPage,
} from '../knowledge-base'
import { readJsonFile, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG, MODELS_CONFIG_PATH, RECENT_PROJECTS_PATH } from '../utils/config-utils'
import { deconstructBook, listBooks, removeBook } from '../book-deconstruct'
import { ReconstructRepository } from '../repositories/reconstruct-repository'
import { GlobalConfig, ModelProfile, type BookImportProgress, type KnowledgeTaskKind, type KnowledgeTaskProgress } from '../../src/shared/ipc-channels'
import { pickModelIdForCategory } from '../../src/shared/purpose-routing'

/**
 * 当前正在跑的长任务（拆书导入 / 向量重建）。
 *
 * 同一时刻只允许一个：这样窗口标题栏上的进度条与「停止」按钮永远指向明确的目标，
 * 也避免两个任务同时写知识库互相打架。
 */
let activeTask: { kind: KnowledgeTaskKind; cancel: () => void } | null = null

function makeTaskReporter(sender: Electron.WebContents, kind: KnowledgeTaskKind, label: string, shouldCancel: () => boolean) {
  let last: BookImportProgress['phase'] = 'reading'
  return {
    shouldCancel,
    report: (
      phase: BookImportProgress['phase'],
      current: number,
      total: number,
      status: KnowledgeTaskProgress['status'] = 'running',
      message?: string,
    ) => {
      last = phase
      if (sender.isDestroyed()) return
      sender.send('kb:task-progress', { kind, label, phase, current, total, status, message } satisfies KnowledgeTaskProgress)
    },
    finish: (status: KnowledgeTaskProgress['status'], message?: string) => {
      if (sender.isDestroyed()) return
      sender.send('kb:task-progress', { kind, label, phase: last, current: 0, total: 0, status, message } satisfies KnowledgeTaskProgress)
    },
  }
}

function getEmbeddingConfig(): {
  protocol: 'openai' | 'gemini'
  model: { baseUrl: string; apiKey: string; modelName: string; provider?: string; purposes?: string[] }
} | null {
  const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
  const models = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
  // 与渲染进程共用同一条回退链：用途绑定 → 默认向量模型 → 声明向量能力的模型 → 默认生成模型
  const targetModelId = pickModelIdForCategory('embedding', {
    models,
    bindings: config.purposeModels ?? {},
    defaultModelId: config.defaultModelId ?? null,
    defaultEmbeddingModelId: config.defaultEmbeddingModelId ?? null,
  })
  if (!targetModelId) return null

  const model = models.find((m) => m.id === targetModelId)
  if (!model) return null
  return {
    protocol: model.protocol as 'openai' | 'gemini',
    // provider / purposes 一并带上：本地推理（Ollama 等）没有 apiKey，靠它们判断能不能用向量
    model: { baseUrl: model.baseUrl, apiKey: model.apiKey, modelName: model.modelName, provider: model.provider, purposes: model.purposes },
  }
}

function getCurrentProjectPath(): string | null {
  try {
    const recent = JSON.parse(fs.readFileSync(RECENT_PROJECTS_PATH, 'utf-8')) as Array<{ path: string }>
    return recent[0]?.path ?? null
  } catch { return null }
}

export function registerKBController() {
  ipcMain.handle('kb:import-document', async (_event, filePath: string) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: '未打开项目' }
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    return importDocument(filePath, projectPath, protocol, model)
  })

  ipcMain.handle('kb:import-folder', async (_event, folderPath: string) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: '未打开项目' }
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    return importFolder(folderPath, projectPath, protocol, model)
  })

  ipcMain.handle('kb:import-text', async (_event, text: string, fileName: string, projectPath: string) => {
    const embConfig = getEmbeddingConfig()
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    return importText(text, fileName, projectPath, protocol, model)
  })

  ipcMain.handle('kb:search', async (_event, query: string, topK?: number) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []

    if (embConfig) {
      return searchKnowledge(query, projectPath, embConfig.protocol, embConfig.model, topK ?? 5)
    }
    return searchKnowledgeFTS(query, projectPath, topK ?? 5)
  })

  ipcMain.handle('kb:search-with-scope', async (_event, query: string, fromChapter: number, toChapter: number, topK?: number) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []

    const scope: [number, number] = [fromChapter, toChapter]
    if (embConfig) {
      return searchKnowledge(query, projectPath, embConfig.protocol, embConfig.model, topK ?? 5, scope)
    }
    return searchKnowledgeFTS(query, projectPath, topK ?? 5, scope)
  })

  ipcMain.handle('kb:list-documents', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []
    return listDocuments(projectPath)
  })

  ipcMain.handle('kb:remove-document', async (_event, docId: string) => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false }
    return { success: removeDocument(docId, projectPath) }
  })

  ipcMain.handle('kb:stats', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { documentCount: 0, totalChunks: 0, vectorDimension: 0 }
    return getKnowledgeStats(projectPath)
  })

  ipcMain.handle('kb:get-vectorless-count', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { count: 0 }
    return getVectorlessCount(projectPath)
  })

  ipcMain.handle('kb:backfill-vectors', async (event) => {
    const embConfig = getEmbeddingConfig()
    if (!embConfig) return { success: false, processed: 0, failed: 0, error: '未配置 Embedding 模型' }
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, processed: 0, failed: 0, error: '未打开项目' }
    // 已经有一个长任务在跑时不叠加：向量重建会重写 chunks 表，和拆书写入撞上会互相覆盖
    if (activeTask) return { success: false, processed: 0, failed: 0, error: '已有任务在运行，请先等它结束或点停止' }
    let cancelled = false
    const task = makeTaskReporter(event.sender, 'backfill', '知识库向量', () => cancelled)
    activeTask = { kind: 'backfill', cancel: () => { cancelled = true } }
    task.report('embedding', 0, 0)
    try {
      const result = await backfillVectors(projectPath, embConfig.protocol, embConfig.model, {
        onProgress: (phase, current, total) => task.report(phase, current, total),
        shouldCancel: task.shouldCancel,
      })
      task.finish(result.cancelled ? 'cancelled' : result.success ? 'done' : 'error', result.error)
      return result
    } catch (error) {
      task.finish('error', String(error))
      throw error
    } finally {
      activeTask = null
    }
  })

  /** 停止当前长任务（拆书 / 向量重建）；没有任务时也返回成功，界面不必区分 */
  ipcMain.handle('kb:cancel-task', async () => {
    activeTask?.cancel()
    return { success: true }
  })

  // ===== 拆书知识库 =====

  /** 拆书：把参考小说按章拆开并写入本地知识库，同时留一份拆书档案 */
  ipcMain.handle('kb:deconstruct-book', async (event, filePath: string) => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: '未打开项目' }
    if (activeTask) return { success: false, error: '已有任务在运行，请先等它结束或点停止' }
    const embConfig = getEmbeddingConfig()
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    let cancelled = false
    const task = makeTaskReporter(event.sender, 'deconstruct', path.basename(filePath), () => cancelled)
    activeTask = { kind: 'deconstruct', cancel: () => { cancelled = true } }
    task.report('reading', 0, 0)
    try {
      const result = await deconstructBook(filePath, projectPath, protocol, model, progress => {
        // 旧的进度通道保留（老界面还在用），新的统一通道给全局指示器
        if (!event.sender.isDestroyed()) event.sender.send('kb:deconstruct-progress', progress)
        task.report(progress.phase, progress.current, progress.total)
      }, { shouldCancel: task.shouldCancel })
      task.finish(result.cancelled ? 'cancelled' : result.success ? 'done' : 'error', result.error)
      return result
    } finally {
      activeTask = null
    }
  })

  /** 列出本项目已有的拆书档案 */
  ipcMain.handle('kb:list-books', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []
    return listBooks(projectPath)
  })

  /** 按文档 id 取回整篇正文（拆书章节回看 / 作为文风参考） */
  ipcMain.handle('kb:get-document-text', async (_event, docId: string) => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: '未打开项目' }
    return getDocumentText(docId, projectPath)
  })

  ipcMain.handle('kb:get-document-text-page', async (_event, docId: string, chunkStart?: number, maxChunks?: number) => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: '未打开项目' }
    return getDocumentTextPage(docId, projectPath, chunkStart, maxChunks)
  })

  /** 移除一本拆书（档案 + 知识库中的章节） */
  ipcMain.handle('kb:remove-book', async (_event, bookId: string) => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, removedChapters: 0, error: '未打开项目' }
    const result = await removeBook(bookId, projectPath)
    // 拆书档案被移除后，属于这本书的分析结果也一并清掉，避免界面留下「查不到来源」的孤儿记录
    if (result?.success) {
      try {
        ReconstructRepository.removeAnalysesByBook(bookId)
      } catch (error) {
        console.warn('[kb:remove-book] 清理拆书分析失败:', error)
      }
    }
    return result
  })

  ipcMain.handle('dialog:select-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: '选择要导入的文档',
      filters: [{ name: '文本文件', extensions: ['txt', 'md', 'markdown'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  ipcMain.handle('dialog:select-import-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择要批量导入的文件夹',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
