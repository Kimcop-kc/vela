import { create } from 'zustand'

export const ONBOARDING_STORAGE_KEY = 'vela-feature-tour-v1'

export function hasSeenFeatureTour(): boolean {
  try { return localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'seen' } catch { return false }
}

/**
 * 首次启动的「一键配置模型」向导。
 *
 * 与功能巡览分开记录：巡览「看过」不等于「配过模型」——用户跳过配置后重开应用，
 * 仍然应该被再问一次，否则会停在一个什么都不能做的界面上。
 */
export const SETUP_STORAGE_KEY = 'vela-model-setup-v1'

/** 只要模型池里还没有模型，就应该继续主动引导配置 */
export function hasCompletedModelSetup(): boolean {
  try { return localStorage.getItem(SETUP_STORAGE_KEY) === 'done' } catch { return false }
}

export function markModelSetupDone(): void {
  try { localStorage.setItem(SETUP_STORAGE_KEY, 'done') } catch { /* 无存储时每次启动都提示，可以接受 */ }
}

export const useOnboardingStore = create<{
  open: boolean
  dismissedThisSession: boolean
  setupOpen: boolean
  start: () => void
  dismiss: () => void
  openSetup: () => void
  closeSetup: (completed?: boolean) => void
}>()((set) => ({
  open: false,
  dismissedThisSession: false,
  setupOpen: false,
  start: () => set({ open: true }),
  dismiss: () => {
    try { localStorage.setItem(ONBOARDING_STORAGE_KEY, 'seen') } catch { /* Still allow dismissal without storage. */ }
    set({ open: false, dismissedThisSession: true })
  },
  openSetup: () => set({ setupOpen: true }),
  closeSetup: (completed = false) => {
    if (completed) markModelSetupDone()
    set({ setupOpen: false })
  },
}))
