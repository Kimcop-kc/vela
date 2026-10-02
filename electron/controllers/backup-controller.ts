import { ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import {
  createProjectSnapshot,
  deleteProjectSnapshot,
  listProjectSnapshots,
  restoreProjectSnapshot,
} from '../utils/project-backup'

function requireProjectPath(projectPath: string): string {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) throw new Error('无效的项目路径')
  if (!fs.existsSync(projectPath)) throw new Error('项目目录不存在')
  return projectPath
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerBackupController() {
  ipcMain.handle('backup:list', async (_event, projectPath: string) => {
    try {
      return { success: true, snapshots: await listProjectSnapshots(requireProjectPath(projectPath)) }
    } catch (error) {
      return { success: false, snapshots: [], error: errorMessage(error) }
    }
  })

  ipcMain.handle('backup:create', async (_event, projectPath: string, note = '') => {
    try {
      return { success: true, snapshot: await createProjectSnapshot(requireProjectPath(projectPath), 'manual', String(note).slice(0, 500)) }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('backup:restore', async (_event, projectPath: string, id: string) => {
    try {
      return { success: true, snapshot: await restoreProjectSnapshot(requireProjectPath(projectPath), id) }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('backup:delete', async (_event, projectPath: string, id: string) => {
    try {
      await deleteProjectSnapshot(requireProjectPath(projectPath), id)
      return { success: true }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('backup:open-folder', async (_event, projectPath: string) => {
    try {
      const backupPath = path.join(requireProjectPath(projectPath), '.vela', 'backups')
      await fs.promises.mkdir(backupPath, { recursive: true })
      const error = await shell.openPath(backupPath)
      return error ? { success: false, path: backupPath, error } : { success: true, path: backupPath }
    } catch (error) {
      return { success: false, path: '', error: errorMessage(error) }
    }
  })
}
