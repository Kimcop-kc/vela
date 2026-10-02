import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type { AppLogEntry } from '../shared/ipc-channels'

interface LogState {
  entries: AppLogEntry[]
  loading: boolean
  load: () => Promise<void>
  init: () => void
  append: (entry: AppLogEntry) => void
  clear: () => Promise<void>
  exportLogs: () => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>
  openFolder: () => Promise<{ success: boolean; error?: string }>
}

let unsubscribe: (() => void) | null = null
let initialized = false

export const useLogStore = create<LogState>()((set, get) => ({
  entries: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      set({ entries: await ipc.invoke('logs:list', { limit: 1000 }) })
    } finally {
      set({ loading: false })
    }
  },

  init: () => {
    if (initialized) return
    initialized = true
    unsubscribe = ipc.on('logs:appended', entry => get().append(entry))
    void get().load()
  },

  append: (entry) => {
    set(state => {
      if (state.entries.some(existing => existing.id === entry.id)) return state
      return { entries: [...state.entries, entry].slice(-1000) }
    })
  },

  clear: async () => {
    const result = await ipc.invoke('logs:clear')
    if (result.success) set({ entries: [] })
  },

  exportLogs: async () => {
    return ipc.invoke('logs:export')
  },

  openFolder: async () => {
    return ipc.invoke('logs:open-folder')
  },
}))

export function disposeLogStore(): void {
  unsubscribe?.()
  unsubscribe = null
  initialized = false
}
