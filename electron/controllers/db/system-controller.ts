/**
 * 系统级通道：作者状态文件、故事文档修订、数据库开关、LLM 调用遥测
 *
 * 这些通道的共同点是「不落在项目数据库的某张业务表上」：
 *   - agent:state-*  读写 ~/.vela/author-agent-state.json（作者智能体的对话状态）
 *   - story:*        故事文档的索引 / 读取 / 修订 / 历史 / 撤销
 *   - db:close       关闭当前项目库
 *   - db:*-llm-*     调用遥测与旧版摘要快照
 */
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { VELA_HOME } from '../../utils/config-utils'
import { closeProjectDatabase } from '../../database'
import { readRehearsalContext } from '../../repositories/rehearsal-repository'
import { indexStory, readStoryDocument, applyStoryRevision, listStoryRevisions, undoStoryRevision } from '../../repositories/story-revision-repository'
import type { StoryReadRequest, StoryRevisionRequest } from '../../../src/shared/story-revision'
import { LLMHistoryRepository } from '../../repositories/llm-repository'
import { SummaryRepository } from '../../repositories/summary-repository'

export function registerSystemController(): void {
  const agentStatePath = path.join(VELA_HOME, 'author-agent-state.json')
  ipcMain.handle('agent:state-read', () => {
    if (!fs.existsSync(agentStatePath)) return null
    return fs.readFileSync(agentStatePath, 'utf8')
  })
  ipcMain.handle('agent:state-write', (_event, serialized: string) => {
    if (typeof serialized !== 'string' || serialized.length > 50_000_000 || !Array.isArray(JSON.parse(serialized)?.state?.conversations)) throw new Error('对话记录格式错误或过大。')
    fs.mkdirSync(VELA_HOME, { recursive: true })
    const temporary = `${agentStatePath}.tmp`
    fs.writeFileSync(temporary, serialized, 'utf8')
    fs.renameSync(temporary, agentStatePath)
  })
  ipcMain.handle('story:index', (_event, projectPath: string, query?: string, offset?: number) => indexStory(projectPath, query, offset))
  ipcMain.handle('story:read', (_event, projectPath: string, request: StoryReadRequest) => readStoryDocument(projectPath, request))
  ipcMain.handle('story:apply', (_event, projectPath: string, request: StoryRevisionRequest) => applyStoryRevision(projectPath, request))
  ipcMain.handle('story:history', (_event, projectPath: string) => listStoryRevisions(projectPath))
  ipcMain.handle('story:undo', (_event, projectPath: string, id: string) => undoStoryRevision(projectPath, id))
  ipcMain.handle('db:rehearsal-context', (_event, projectPath: string, chapterNumber: number) => {
    return readRehearsalContext(projectPath, chapterNumber)
  })
  ipcMain.handle('db:close', async () => {
    closeProjectDatabase()
    return { success: true }
  })

  // ============================================================
  // 沿用旧表：LLM 调用遥测与旧版摘要快照
  // ============================================================
  ipcMain.handle('db:log-llm-call', async (_event, call) => {
    try {
      LLMHistoryRepository.logCall(call)
      return { success: true }
    } catch (error) {
      console.error('[db:log-llm-call] Error:', error)
      return { success: false }
    }
  })

  ipcMain.handle('db:get-llm-stats', async () => {
    return LLMHistoryRepository.getStats()
  })

  ipcMain.handle('db:get-llm-history', async (_event, limit?: number) => {
    return LLMHistoryRepository.getHistory(limit ?? 50)
  })

  ipcMain.handle('db:save-summary-snapshot', async (_event, chapterNumber: number, characterStates: string) => {
    SummaryRepository.saveSnapshot(chapterNumber, characterStates)
    return { success: true }
  })

  ipcMain.handle('db:get-latest-summary', async () => {
    return SummaryRepository.getLatestSnapshot()
  })
}
