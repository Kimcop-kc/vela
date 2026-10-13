import { ipcRenderer, contextBridge, webFrame } from 'electron'
import {
  isAllowedEventChannel,
  isAllowedInvokeChannel,
  rejectionMessage,
} from './ipc-channel-guard'

/**
 * Vela Preload Script — 安全地暴露 IPC 通信能力到渲染进程
 *
 * 所有通道都要先过 `ipc-channel-guard` 的白名单。preload 是渲染进程唯一能碰到主进程的
 * 地方，这里是权限边界：放行范围必须显式登记，而不是「什么都能调」。
 *
 * 拒绝时一律给出可读原因（含通道名与登记位置），不静默失败——静默会把「通道名打错」
 * 变成很难查的玄学 bug。
 */
contextBridge.exposeInMainWorld('velaAPI', {
  // ===== 双向请求/响应（invoke/handle） =====
  /** 调用主进程并等待结果 */
  invoke: (channel: string, ...args: unknown[]) => {
    if (!isAllowedInvokeChannel(channel)) {
      return Promise.reject(new Error(rejectionMessage(channel, 'invoke')))
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  // ===== 主进程 → 渲染进程事件 =====
  /** 监听主进程推送的事件，返回取消订阅函数 */
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!isAllowedEventChannel(channel)) {
      // preload 阶段 app-logger 还没就绪，这里是唯一保留 console 的地方
      console.warn(rejectionMessage(channel, 'event'))
      return () => {}
    }
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },

  /** 一次性监听 */
  once: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!isAllowedEventChannel(channel)) {
      console.warn(rejectionMessage(channel, 'event'))
      return
    }
    ipcRenderer.once(channel, (_event, ...args) => callback(...args))
  },

  /**
   * 单向发送。
   *
   * 主进程当前没有注册任何 `ipcMain.on` 监听，发出去的消息没有接收方，
   * 所以直接拒绝而不是放行——避免有人以为它在工作。
   */
  send: (channel: string, ...args: unknown[]) => {
    const extra = args.length > 0 ? `（调用方还传了 ${args.length} 个参数）` : ''
    console.warn(rejectionMessage(channel, 'send') + extra)
  },

  // ===== UI 控制 =====
  /** 设置窗口缩放级别 (Electron WebFrame) */
  setZoomLevel: (level: number) => {
    webFrame.setZoomLevel(level)
  },
  /** 设置绝对缩放比例 */
  setZoomFactor: (factor: number) => {
    webFrame.setZoomFactor(factor)
  },
  /** 等级获取 */
  getZoomLevel: () => {
    return webFrame.getZoomLevel()
  }
})
