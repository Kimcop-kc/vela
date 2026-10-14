/**
 * 长任务进度（拆书导入 / 向量重建）
 *
 * 为什么要有这个 store：进度以前是发起它的那个面板自己 setState、自己订阅事件，
 * 一离开拆书页组件就卸载了，于是「任务还在跑，但界面上什么都看不到」，
 * 作者会以为卡死了。
 *
 * 现在进度存在全局 store 里、由 App 启动时订阅一次，任何页面都能读到；
 * 标题栏上的指示器据此显示进度条，并提供「停止」。
 */
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type { KnowledgeTaskProgress } from '../shared/ipc-channels'

interface KnowledgeTaskState {
  task: KnowledgeTaskProgress | null
  /** 订阅进度事件（幂等，App 启动时调一次即可） */
  init: () => void
  /** 请求停止当前任务 */
  cancel: () => Promise<void>
  /** 手动收起已完成/已取消的提示 */
  dismiss: () => void
}

/** 任务结束后自动收起的延时：留一点时间让作者看到结果 */
const AUTO_DISMISS_MS = 8000

let dismissTimer: ReturnType<typeof setTimeout> | null = null

/** 订阅只做一次，避免热重载或重复调用叠出多个监听 */
let initDone = false

export const useKnowledgeTaskStore = create<KnowledgeTaskState>((set, get) => ({
  task: null,

  init: () => {
    if (!ipc.isElectron) return
    if (get().task !== null || initDone) return
    initDone = true
    ipc.on('kb:task-progress', (payload) => {
      set({ task: payload })
      if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null }
      if (payload.status !== 'running') {
        dismissTimer = setTimeout(() => {
          // 只在没有新任务接上来时收起
          if (get().task?.status !== 'running') set({ task: null })
        }, AUTO_DISMISS_MS)
      }
    })
  },

  cancel: async () => {
    try {
      await ipc.invoke('kb:cancel-task')
    } catch (error) {
      console.warn('[knowledgeTaskStore] 取消任务失败:', error)
    }
  },

  dismiss: () => {
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null }
    set({ task: null })
  },
}))

/** 任务进度百分比（0–100）；总数未知时返回 null，由界面显示不确定态 */
export function taskPercent(task: KnowledgeTaskProgress | null): number | null {
  if (!task || task.total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((task.current / task.total) * 100)))
}

/** 任务是否还在跑 */
export function isTaskRunning(task: KnowledgeTaskProgress | null): boolean {
  return task?.status === 'running'
}
