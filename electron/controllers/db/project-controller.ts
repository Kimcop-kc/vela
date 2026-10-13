/**
 * 项目主台账与章节蓝图
 *
 * 这两块是写作的「输入侧」：project_core 存项目级设定，blueprints 存每章的规划。
 * 它们都有「传入 projectPath 时先校验项目是否已打开」的守卫，因此放在一起，
 * 便于对照检查守卫是否一致。
 */
import { ipcMain } from 'electron'
import { getProjectDb } from '../../database'
import { requireProjectDatabase } from '../../repositories/rehearsal-repository'
import { ProjectCoreRepository, ProjectCoreData } from '../../repositories/project-core-repository'
import { BlueprintRepository, BlueprintData } from '../../repositories/blueprint-repository'

export function registerProjectController(): void {
  // ============================================================
  // 1. project_core — 项目主台账
  // ============================================================
  ipcMain.handle('db:project-core-get', async () => {
    return ProjectCoreRepository.get()
  })

  ipcMain.handle('db:project-core-update', async (_event, data: Partial<ProjectCoreData>) => {
    try {
      ProjectCoreRepository.update(data)
      return { success: true }
    } catch (err) {
      console.error('[db:project-core-update] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 2. blueprints — 章节蓝图
  // ============================================================
  ipcMain.handle('db:blueprint-get-all', async (_event, projectPath?: string) => {
    if (projectPath !== undefined) requireProjectDatabase(projectPath)
    return BlueprintRepository.getAll()
  })

  ipcMain.handle('db:blueprint-commit', (_event, items: BlueprintData[], deleted: number[], expected: BlueprintData[], projectPath: string) => {
    try {
      requireProjectDatabase(projectPath)
      BlueprintRepository.commit(items, deleted, expected)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:blueprint-get', async (_event, chapterNumber: number) => {
    return BlueprintRepository.getByChapter(chapterNumber)
  })

  ipcMain.handle('db:blueprint-upsert', async (_event, data: BlueprintData, projectPath?: string) => {
    try {
      if (!getProjectDb()) throw new Error('PROJECT_CLOSED')
      if (projectPath !== undefined) requireProjectDatabase(projectPath)
      BlueprintRepository.upsert(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:blueprint-upsert-many', async (_event, items: BlueprintData[], projectPath?: string) => {
    try {
      if (!getProjectDb()) throw new Error('PROJECT_CLOSED')
      if (projectPath !== undefined) requireProjectDatabase(projectPath)
      BlueprintRepository.upsertMany(items)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:blueprint-update-notes', async (_event, chapterNumber: number, notes: string) => {
    try {
      BlueprintRepository.updateNotes(chapterNumber, notes)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
