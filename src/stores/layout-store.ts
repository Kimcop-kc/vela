import { create } from 'zustand'

/** 左侧活动栏的视图类型 */
export type SidebarView = 'home' | 'project' | 'knowledge' | 'books' | 'story-bible' | 'characters' | 'settings'

export type StoryBibleSection = 'overview' | 'characters' | 'timeline' | 'plots' | 'facts' | 'realms' | 'locations' | 'search'

/** 下方工具窗口 Tab */
export type BottomTab = 'tasks' | 'log' | 'models'

/** 底部工具窗口的停靠位置：项目结构侧栏下方 / Agent 面板下方 / 底部全宽 */
export type BottomDock = 'sidebar' | 'agent' | 'full'

/** 右侧面板视图类型 */
export type RightView = 'agent' | 'ai-output'

/** 章节创建对话框的预填参数 */
export type ChapterCreationPrefill = Record<string, unknown> | null

/**
 * 进入专注模式前的布局快照。
 * 只记「布局」——不含编辑器内容、不含标签页，因此专注模式不可能影响正文。
 */
export interface FocusSnapshot {
  sidebarOpen: boolean
  aiPanelOpen: boolean
  bottomPanelOpen: boolean
  bottomDock: BottomDock
  autoCollapsed: { sidebar: boolean; aiPanel: boolean }
}

interface LayoutState {
  // ===== 侧边栏 =====
  sidebarOpen: boolean
  sidebarView: SidebarView
  sidebarWidth: number

  // ===== AI 对话面板 =====
  aiPanelOpen: boolean
  aiPanelWidth: number
  /** 右侧面板当前视图：Agent 对话 / AI 输出 */
  rightView: RightView

  // ===== 底部面板 =====
  bottomPanelOpen: boolean
  bottomTab: BottomTab
  bottomPanelHeight: number
  /** 底部面板停靠位置（默认停靠在「项目结构」侧栏下方，避免遮挡中间的编辑区） */
  bottomDock: BottomDock

  // ===== 窄窗口自动折叠 =====
  /**
   * 因窗口过窄而被自动收起的面板。
   * 窗口恢复宽度后只还原这里标记过的，用户手动收起的面板不会被强行打开。
   */
  autoCollapsed: { sidebar: boolean; aiPanel: boolean }

  // ===== 专注模式 =====
  /**
   * 进入专注模式前的布局快照；`null` 表示当前不在专注模式。
   * 专注模式是**布局状态**而非独立页面：进入时收起侧栏 / 右栏 / 底部面板并隐藏左右工具栏，
   * 编辑区、标签栏、保存状态与字数信息原样保留，因此不可能清空编辑器上下文。
   */
  focusSnapshot: FocusSnapshot | null

  // ===== 全局弹窗状态（替代 window.dispatchEvent 事件总线）=====
  /** 设置弹窗是否打开 */
  settingsOpen: boolean
  /** 新建项目对话框是否打开 */
  newProjectOpen: boolean
  /** 导出对话框是否打开 */
  exportOpen: boolean
  /** 导入小说对话框是否打开 */
  importNovelOpen: boolean
  /** 章节创建对话框是否打开 */
  chapterCreationOpen: boolean
  /** 章节创建对话框的预填参数 */
  chapterCreationPrefill: ChapterCreationPrefill

  /** 拆书视图当前选中的拆书档案 id */
  selectedBookId: string | null
  /** 故事圣经当前分区 */
  storyBibleSection: StoryBibleSection

  /** 由拆书等来源送入文风分析的参考文本（待「小说配置」页消费后清空） */
  styleReferencePrefill: { source: string; text: string } | null

  // ===== Actions =====
  toggleSidebar: () => void
  /** 显式设置侧栏开关（窄窗口自动折叠用；不用 toggle 是为了避免误翻转用户的选择） */
  setSidebarOpen: (open: boolean) => void
  setSidebarView: (view: SidebarView) => void
  /** 切换拆书视图的当前书籍 */
  setSelectedBookId: (id: string | null) => void
  setStoryBibleSection: (section: StoryBibleSection) => void
  /** 把一段参考文本送到文风分析弹框（自动切到项目视图） */
  sendToStyleAnalysis: (payload: { source: string; text: string }) => void
  /** 取走并清空待处理的参考文本 */
  takeStyleReference: () => { source: string; text: string } | null
  setSidebarWidth: (width: number) => void
  toggleAIPanel: () => void
  setAIPanelOpen: (open: boolean) => void
  setAIPanelWidth: (width: number) => void
  setRightView: (view: RightView) => void
  /** 打开右侧面板并切换到指定视图 */
  openRightPanel: (view: RightView) => void
  toggleBottomPanel: () => void
  setBottomTab: (tab: BottomTab) => void
  setBottomPanelHeight: (height: number) => void
  openBottomTab: (tab: BottomTab) => void
  /** 设置底部面板停靠位置（同时确保面板展开） */
  setBottomDock: (dock: BottomDock) => void
  /** 记录 / 清除被窄窗口策略自动收起的面板 */
  setAutoCollapsed: (patch: Partial<{ sidebar: boolean; aiPanel: boolean }>) => void

  // ===== 专注模式 Actions =====
  /** 进入专注模式（已进入时为幂等空操作，不会覆盖原快照） */
  enterFocusMode: () => void
  /** 退出专注模式并恢复进入前的布局（不在专注模式时为空操作） */
  exitFocusMode: () => void
  /** 切换专注模式 */
  toggleFocusMode: () => void

  // ===== 全局弹窗 Actions =====
  openSettings: () => void
  closeSettings: () => void
  openNewProject: () => void
  closeNewProject: () => void
  openExport: () => void
  closeExport: () => void
  openImportNovel: () => void
  closeImportNovel: () => void
  openChapterCreation: (prefill?: ChapterCreationPrefill) => void
  closeChapterCreation: () => void
}

export const useLayoutStore = create<LayoutState>()((set, get) => {
  /**
   * 专注模式下用户主动打开任何面板 → 丢弃快照，视为手动接管布局。
   * 只丢快照、不改面板状态：这次打开是用户自己要的，退出专注模式时也不该被还原覆盖。
   */
  const abandonFocusSnapshot = () => {
    if (get().focusSnapshot) set({ focusSnapshot: null })
  }

  return {
  // 默认值
  sidebarOpen: true,
  sidebarView: 'project',
  sidebarWidth: 260,

  aiPanelOpen: true,
  aiPanelWidth: 320,
  rightView: 'agent',

  bottomPanelOpen: true,
  bottomTab: 'tasks',
  bottomPanelHeight: 200,
  bottomDock: 'sidebar',
  autoCollapsed: { sidebar: false, aiPanel: false },
  focusSnapshot: null,

  // 全局弹窗默认关闭
  settingsOpen: false,
  newProjectOpen: false,
  exportOpen: false,
  importNovelOpen: false,
  chapterCreationOpen: false,
  chapterCreationPrefill: null,
  selectedBookId: null,
  storyBibleSection: 'overview',
  styleReferencePrefill: null,

  // Actions
  // 说明：凡是「打开」面板的动作都先调 abandonFocusSnapshot()，这样专注模式不会
  // 与用户的手动操作打架 —— 用户主动开面板即等于退出专注模式（快照一并作废）。
  toggleSidebar: () => {
    const next = !get().sidebarOpen
    if (next) abandonFocusSnapshot()
    set({ sidebarOpen: next })
  },
  setSidebarOpen: (open) => {
    if (open) abandonFocusSnapshot()
    set({ sidebarOpen: open })
  },
  setSidebarView: (view) => {
    const s = get()
    const nextOpen = s.sidebarView === view ? !s.sidebarOpen : true
    if (nextOpen) abandonFocusSnapshot()
    set({ sidebarView: view, sidebarOpen: nextOpen })
  },
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(500, width)) }),
  setSelectedBookId: (id) => set({ selectedBookId: id }),
  setStoryBibleSection: (section) => set({ storyBibleSection: section }),
  sendToStyleAnalysis: (payload) => {
    abandonFocusSnapshot()
    set({
      styleReferencePrefill: payload,
      sidebarView: 'project',
      sidebarOpen: true,
    })
  },
  takeStyleReference: () => {
    const pending = get().styleReferencePrefill
    if (pending) set({ styleReferencePrefill: null })
    return pending
  },

  toggleAIPanel: () => {
    const next = !get().aiPanelOpen
    if (next) abandonFocusSnapshot()
    set({ aiPanelOpen: next })
  },
  setAIPanelOpen: (open) => {
    if (open) abandonFocusSnapshot()
    set({ aiPanelOpen: open })
  },
  setAIPanelWidth: (width) => set({ aiPanelWidth: Math.max(260, Math.min(600, width)) }),
  setRightView: (view) => set({ rightView: view }),
  openRightPanel: (view) => {
    abandonFocusSnapshot()
    set({ aiPanelOpen: true, rightView: view })
  },

  toggleBottomPanel: () => {
    const next = !get().bottomPanelOpen
    if (next) abandonFocusSnapshot()
    set({ bottomPanelOpen: next })
  },
  setBottomTab: (tab) => {
    const s = get()
    const nextOpen = s.bottomTab === tab ? !s.bottomPanelOpen : true
    if (nextOpen) abandonFocusSnapshot()
    set({ bottomTab: tab, bottomPanelOpen: nextOpen })
  },
  setBottomPanelHeight: (height) => set({ bottomPanelHeight: Math.max(100, Math.min(500, height)) }),
  openBottomTab: (tab) => {
    abandonFocusSnapshot()
    set({ bottomPanelOpen: true, bottomTab: tab })
  },
  setBottomDock: (dock) => {
    abandonFocusSnapshot()
    set({ bottomDock: dock, bottomPanelOpen: true })
  },
  setAutoCollapsed: (patch) => set((s) => ({ autoCollapsed: { ...s.autoCollapsed, ...patch } })),

  // ===== 专注模式 =====
  enterFocusMode: () => {
    const s = get()
    // 幂等：重复进入不能把「已经被收起的空布局」当成快照存下来
    if (s.focusSnapshot) return
    set({
      focusSnapshot: {
        sidebarOpen: s.sidebarOpen,
        aiPanelOpen: s.aiPanelOpen,
        bottomPanelOpen: s.bottomPanelOpen,
        bottomDock: s.bottomDock,
        autoCollapsed: { ...s.autoCollapsed },
      },
      sidebarOpen: false,
      aiPanelOpen: false,
      bottomPanelOpen: false,
      // 折叠改由专注模式接管，清掉窄窗口的自动折叠标记，
      // 否则退出时「恢复专注前布局」与「恢复窄窗口折叠」会互相覆盖
      autoCollapsed: { sidebar: false, aiPanel: false },
    })
  },
  exitFocusMode: () => {
    const snapshot = get().focusSnapshot
    if (!snapshot) return
    set({ ...snapshot, autoCollapsed: { ...snapshot.autoCollapsed }, focusSnapshot: null })
  },
  toggleFocusMode: () => {
    const s = get()
    if (s.focusSnapshot) s.exitFocusMode()
    else s.enterFocusMode()
  },

  // 全局弹窗 Actions
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  openExport: () => set({ exportOpen: true }),
  closeExport: () => set({ exportOpen: false }),
  openImportNovel: () => set({ importNovelOpen: true }),
  closeImportNovel: () => set({ importNovelOpen: false }),
  openChapterCreation: (prefill = null) => set({ chapterCreationOpen: true, chapterCreationPrefill: prefill }),
  closeChapterCreation: () => set({ chapterCreationOpen: false, chapterCreationPrefill: null }),
  }
})
