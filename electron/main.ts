import { app, BrowserWindow } from 'electron'
import { registerIPCHandlers } from './ipc-handlers'
import { registerMCPHandlers } from './mcp/mcp-ipc-bridge'

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { appLogger, installMainConsoleCapture } from './app-logger'

installMainConsoleCapture()

process.on('uncaughtException', error => {
  appLogger.error('process', '未捕获异常', error)
  if (app.isReady()) app.exit(1)
})

process.on('unhandledRejection', reason => {
  appLogger.warn('process', '未处理的 Promise 拒绝', reason)
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 构建产物目录结构
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Vela — AI 小说创作 IDE',
    icon: path.join(process.env.APP_ROOT!, 'build', 'icon.png'),
    // macOS 使用自定义标题栏
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    backgroundColor: '#141B24',
    // Win11 Fluent 材质：Windows 11 使用 Mica，macOS 使用 under-window 毛玻璃
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
    ...(process.platform === 'darwin' ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // 安全性设置
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.platform === 'darwin') {
    app.dock?.setIcon(path.join(process.env.APP_ROOT!, 'build', 'icon.png'))
  }

  // 隐藏默认菜单栏（Windows/Linux）
  win.setMenuBarVisibility(false)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// macOS: 关闭所有窗口不退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

// macOS: 点击 dock 图标重新创建窗口
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('render-process-gone', (_event, _webContents, details) => {
  appLogger.error('electron', '渲染进程异常退出', details)
})

app.on('child-process-gone', (_event, details) => {
  appLogger.error('electron', '子进程异常退出', details)
})

app.whenReady().then(() => {
  appLogger.info('app', 'Vela 启动', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  })
  registerIPCHandlers()
  registerMCPHandlers()
  createWindow()
})
