import { useEffect } from 'react'
import { useLayoutStore } from '../../stores/layout-store'

/** 低于此宽度时收起侧栏与右栏 —— 三栏布局在更窄的窗口里会被 minSize 顶到极限，中间编辑区几乎不可用 */
const NARROW_WIDTH = 1100

/**
 * 窄窗口自动折叠。
 *
 * 两条约束，都是为了不跟用户抢控制权：
 * 1. 只在「跨过阈值」这一次跃迁上动作，不会在阈值附近反复收起 / 展开；
 * 2. 只还原**被自动收起**的面板 —— 用户在窄窗口下自己收起来的面板，窗口变宽后不会被强行打开。
 *
 * 另：专注模式期间本 hook 完全不插手（见下方 apply 内注释）。
 */
export function useAutoCollapseOnNarrowWindow(): void {
  useEffect(() => {
    // 初始按「宽」处理，好让下面第一次 apply 一定真正执行：窄窗口直接以折叠态启动。
    let narrow = false

    const apply = (next: boolean) => {
      if (next === narrow) return
      narrow = next
      const s = useLayoutStore.getState()

      // 专注模式期间折叠已由专注模式接管，这里若照常「恢复」会把它顶掉。
      // 只更新 narrow 记账、不动布局：退出专注模式时 exitFocusMode 会还原进入前的布局，
      // 所以跳过不会留下坏状态；此后用户再改变窗口宽度，本 hook 会自然重新接管。
      if (s.focusSnapshot) return

      if (next) {
        const collapsed = { sidebar: false, aiPanel: false }
        if (s.sidebarOpen) {
          collapsed.sidebar = true
          s.setSidebarOpen(false)
        }
        if (s.aiPanelOpen) {
          collapsed.aiPanel = true
          s.setAIPanelOpen(false)
        }
        s.setAutoCollapsed(collapsed)
        return
      }

      const restored = s.autoCollapsed
      if (restored.sidebar) s.setSidebarOpen(true)
      if (restored.aiPanel) s.setAIPanelOpen(true)
      s.setAutoCollapsed({ sidebar: false, aiPanel: false })
    }

    apply(window.innerWidth < NARROW_WIDTH)
    const onResize = () => apply(window.innerWidth < NARROW_WIDTH)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
}
