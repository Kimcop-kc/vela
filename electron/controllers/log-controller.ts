import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  appLogger,
  type AppLogEntry,
  type AppLogInput,
  type AppLogQuery,
} from '../app-logger'

function broadcast(entry: AppLogEntry): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('logs:appended', entry)
  }
}

export function registerLogController(): void {
  appLogger.subscribe(broadcast)

  ipcMain.handle('logs:list', async (_event, query?: AppLogQuery) => {
    return appLogger.list(query)
  })

  ipcMain.handle('logs:write', async (_event, input: AppLogInput) => {
    if (!input || typeof input.message !== 'string' || !input.message) {
      return { success: false, error: '日志内容不能为空。' }
    }
    appLogger.log(input.level, input.scope ?? 'renderer', input.message, input.details, 'renderer')
    return { success: true }
  })

  ipcMain.handle('logs:clear', async () => {
    appLogger.clear()
    return { success: true }
  })

  ipcMain.handle('logs:open-folder', async () => {
    const error = await shell.openPath(appLogger.getDirectory())
    return error ? { success: false, error } : { success: true }
  })

  ipcMain.handle('logs:export', async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const result = await dialog.showSaveDialog({
      title: '导出 Vela 日志',
      defaultPath: path.join(app.getPath('documents'), `vela-logs-${stamp}.jsonl`),
      filters: [
        { name: 'JSON Lines', extensions: ['jsonl'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    try {
      const entries = appLogger.list({ limit: 5000 })
      fs.writeFileSync(result.filePath, entries.map(entry => JSON.stringify(entry)).join('\n'), 'utf8')
      return { success: true, path: result.filePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
