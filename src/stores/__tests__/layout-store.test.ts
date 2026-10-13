/**
 * 布局状态护栏
 *
 * 锁三类「界面上有约定、类型上没约束」的行为：
 *   1. 点击当前已选中的视图/标签 = 收起面板；切换到别的视图 = 展开并切换；
 *   2. 拖拽宽度/高度一律钳位在合理区间（否则用户能把面板拖成 0 宽，或者拖出屏幕）；
 *   3. 「送到文风分析」的参考文本是一次性投递 —— takeStyleReference 取走即清空，
 *      否则下次打开文风弹框会重复带入上一次的文本。
 *
 * 另含专注模式（任务书 5.4）的护栏：快照语义、幂等进入、以及「用户主动开面板即作废快照」。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useLayoutStore } from '../layout-store'

const initialState = useLayoutStore.getState()

describe('布局状态', () => {
  beforeEach(() => {
    useLayoutStore.setState(initialState, true)
  })

  it('点击当前视图收起侧栏，切换到其它视图展开并切换', () => {
    const store = useLayoutStore.getState()
    expect(store.sidebarView).toBe('project')
    expect(store.sidebarOpen).toBe(true)

    useLayoutStore.getState().setSidebarView('project')
    expect(useLayoutStore.getState().sidebarOpen).toBe(false)

    useLayoutStore.getState().setSidebarView('story-bible')
    expect(useLayoutStore.getState()).toMatchObject({ sidebarView: 'story-bible', sidebarOpen: true })
  })

  it('侧栏宽度钳位在 200–500', () => {
    useLayoutStore.getState().setSidebarWidth(10)
    expect(useLayoutStore.getState().sidebarWidth).toBe(200)
    useLayoutStore.getState().setSidebarWidth(9999)
    expect(useLayoutStore.getState().sidebarWidth).toBe(500)
    useLayoutStore.getState().setSidebarWidth(300)
    expect(useLayoutStore.getState().sidebarWidth).toBe(300)
  })

  it('右侧面板宽度钳位在 260–600', () => {
    useLayoutStore.getState().setAIPanelWidth(1)
    expect(useLayoutStore.getState().aiPanelWidth).toBe(260)
    useLayoutStore.getState().setAIPanelWidth(100000)
    expect(useLayoutStore.getState().aiPanelWidth).toBe(600)
  })

  it('底部面板高度钳位在 100–500', () => {
    useLayoutStore.getState().setBottomPanelHeight(0)
    expect(useLayoutStore.getState().bottomPanelHeight).toBe(100)
    useLayoutStore.getState().setBottomPanelHeight(999)
    expect(useLayoutStore.getState().bottomPanelHeight).toBe(500)
  })

  it('点击当前底部标签收起面板，切换标签展开', () => {
    const store = useLayoutStore.getState()
    expect(store.bottomTab).toBe('tasks')
    expect(store.bottomPanelOpen).toBe(true)

    useLayoutStore.getState().setBottomTab('tasks')
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)

    useLayoutStore.getState().setBottomTab('log')
    expect(useLayoutStore.getState()).toMatchObject({ bottomTab: 'log', bottomPanelOpen: true })
  })

  it('openBottomTab / setBottomDock 都会强制展开面板', () => {
    useLayoutStore.getState().toggleBottomPanel()
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)

    useLayoutStore.getState().openBottomTab('models')
    expect(useLayoutStore.getState()).toMatchObject({ bottomPanelOpen: true, bottomTab: 'models' })

    useLayoutStore.getState().toggleBottomPanel()
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)
    useLayoutStore.getState().setBottomDock('full')
    expect(useLayoutStore.getState()).toMatchObject({ bottomPanelOpen: true, bottomDock: 'full' })
  })

  it('openRightPanel 同时展开面板并切换视图', () => {
    useLayoutStore.getState().setAIPanelOpen(false)
    useLayoutStore.getState().openRightPanel('ai-output')
    expect(useLayoutStore.getState()).toMatchObject({ aiPanelOpen: true, rightView: 'ai-output' })
  })

  it('送到文风分析的参考文本是一次性投递', () => {
    useLayoutStore.getState().sendToStyleAnalysis({ source: '拆书', text: '冷峻的叙述' })
    expect(useLayoutStore.getState()).toMatchObject({
      sidebarView: 'project',
      sidebarOpen: true,
      styleReferencePrefill: { source: '拆书', text: '冷峻的叙述' },
    })

    expect(useLayoutStore.getState().takeStyleReference()).toEqual({ source: '拆书', text: '冷峻的叙述' })
    expect(useLayoutStore.getState().styleReferencePrefill).toBeNull()
    // 再取一次应为空，不能重复投递
    expect(useLayoutStore.getState().takeStyleReference()).toBeNull()
  })

  it('章节创建对话框：默认无预填参数，关闭时清空预填', () => {
    useLayoutStore.getState().openChapterCreation()
    expect(useLayoutStore.getState()).toMatchObject({ chapterCreationOpen: true, chapterCreationPrefill: null })

    useLayoutStore.getState().openChapterCreation({ title: '换笔', number: 3 })
    expect(useLayoutStore.getState().chapterCreationPrefill).toEqual({ title: '换笔', number: 3 })

    useLayoutStore.getState().closeChapterCreation()
    expect(useLayoutStore.getState()).toMatchObject({ chapterCreationOpen: false, chapterCreationPrefill: null })
  })

  it('其它全局弹窗各自独立，开关互不影响', () => {
    useLayoutStore.getState().openSettings()
    useLayoutStore.getState().openExport()
    expect(useLayoutStore.getState()).toMatchObject({ settingsOpen: true, exportOpen: true, newProjectOpen: false, importNovelOpen: false })

    useLayoutStore.getState().closeSettings()
    expect(useLayoutStore.getState()).toMatchObject({ settingsOpen: false, exportOpen: true })
  })

  it('故事圣经分区切换与拆书选中档案各自独立', () => {
    useLayoutStore.getState().setStoryBibleSection('facts')
    useLayoutStore.getState().setSelectedBookId('book-1')
    expect(useLayoutStore.getState()).toMatchObject({ storyBibleSection: 'facts', selectedBookId: 'book-1' })

    useLayoutStore.getState().setSelectedBookId(null)
    expect(useLayoutStore.getState()).toMatchObject({ storyBibleSection: 'facts', selectedBookId: null })
  })

  it('setSidebarOpen 是显式赋值，不会像 toggleSidebar 那样翻转', () => {
    useLayoutStore.getState().setSidebarOpen(false)
    expect(useLayoutStore.getState().sidebarOpen).toBe(false)
    // 连续赋同一个值应保持稳定（toggle 语义会在这里翻回 true）
    useLayoutStore.getState().setSidebarOpen(false)
    expect(useLayoutStore.getState().sidebarOpen).toBe(false)
    useLayoutStore.getState().setSidebarOpen(true)
    expect(useLayoutStore.getState().sidebarOpen).toBe(true)
  })

  it('autoCollapsed 按字段合并，清除一个字段不会带上另一个', () => {
    expect(useLayoutStore.getState().autoCollapsed).toEqual({ sidebar: false, aiPanel: false })

    useLayoutStore.getState().setAutoCollapsed({ sidebar: true, aiPanel: true })
    expect(useLayoutStore.getState().autoCollapsed).toEqual({ sidebar: true, aiPanel: true })

    // 窗口变宽时可能只还原其中一个：清 sidebar 不应顺手清掉 aiPanel 的标记，
    // 否则另一个被自动收起的面板就再也还原不回来了
    useLayoutStore.getState().setAutoCollapsed({ sidebar: false })
    expect(useLayoutStore.getState().autoCollapsed).toEqual({ sidebar: false, aiPanel: true })
  })
})

/**
 * 专注模式护栏
 *
 * 任务书 5.4 的硬约束是「不改变文档内容、不清空编辑器状态、退出后尽量恢复进入前的布局」。
 * 前两条由「只记布局、不碰 editor-store」的设计保证；这里锁住第三条与几处容易写错的边界。
 */
describe('专注模式', () => {
  beforeEach(() => {
    useLayoutStore.setState(initialState, true)
  })

  it('进入时收起侧栏 / 右栏 / 底部面板，并记下进入前的布局', () => {
    useLayoutStore.getState().setBottomDock('full')
    useLayoutStore.getState().enterFocusMode()

    const after = useLayoutStore.getState()
    expect(after.focusSnapshot).toEqual({
      sidebarOpen: true,
      aiPanelOpen: true,
      bottomPanelOpen: true,
      bottomDock: 'full',
      autoCollapsed: { sidebar: false, aiPanel: false },
    })
    expect(after).toMatchObject({ sidebarOpen: false, aiPanelOpen: false, bottomPanelOpen: false })
  })

  it('退出后恢复进入前的布局', () => {
    // 先造一个「非默认」布局：收起右栏、把底部面板停靠到全宽
    useLayoutStore.getState().setAIPanelOpen(false)
    useLayoutStore.getState().setBottomDock('full')
    const before = useLayoutStore.getState()

    useLayoutStore.getState().enterFocusMode()
    expect(useLayoutStore.getState()).toMatchObject({
      sidebarOpen: false,
      aiPanelOpen: false,
      bottomPanelOpen: false,
    })

    useLayoutStore.getState().exitFocusMode()
    const after = useLayoutStore.getState()
    expect(after).toMatchObject({
      sidebarOpen: before.sidebarOpen,
      aiPanelOpen: before.aiPanelOpen,
      bottomPanelOpen: before.bottomPanelOpen,
      bottomDock: before.bottomDock,
    })
    expect(after.focusSnapshot).toBeNull()
  })

  it('重复进入是幂等的，不会把已折叠的空布局当成快照', () => {
    useLayoutStore.getState().enterFocusMode()
    useLayoutStore.getState().enterFocusMode()

    // 快照必须仍是「全部展开」的原始布局，而不是第二次进入时看到的全 false
    expect(useLayoutStore.getState().focusSnapshot).toMatchObject({
      sidebarOpen: true,
      aiPanelOpen: true,
      bottomPanelOpen: true,
    })

    useLayoutStore.getState().exitFocusMode()
    expect(useLayoutStore.getState()).toMatchObject({
      sidebarOpen: true,
      aiPanelOpen: true,
      bottomPanelOpen: true,
    })
  })

  it('不在专注模式时退出是空操作', () => {
    const before = useLayoutStore.getState()
    useLayoutStore.getState().exitFocusMode()

    expect(useLayoutStore.getState().focusSnapshot).toBeNull()
    expect(useLayoutStore.getState()).toMatchObject({
      sidebarOpen: before.sidebarOpen,
      aiPanelOpen: before.aiPanelOpen,
      bottomPanelOpen: before.bottomPanelOpen,
    })
  })

  it('进入时清掉窄窗口自动折叠标记，退出时按快照还原', () => {
    useLayoutStore.getState().setAutoCollapsed({ sidebar: true, aiPanel: true })
    useLayoutStore.getState().enterFocusMode()
    // 折叠改由专注模式接管，否则退出时两套恢复逻辑会互相覆盖
    expect(useLayoutStore.getState().autoCollapsed).toEqual({ sidebar: false, aiPanel: false })

    useLayoutStore.getState().exitFocusMode()
    expect(useLayoutStore.getState().autoCollapsed).toEqual({ sidebar: true, aiPanel: true })
  })

  it('专注模式下主动打开面板 = 手动接管：快照作废，退出不再还原', () => {
    useLayoutStore.getState().enterFocusMode()
    useLayoutStore.getState().setSidebarOpen(true)

    expect(useLayoutStore.getState().focusSnapshot).toBeNull()
    expect(useLayoutStore.getState().sidebarOpen).toBe(true)

    // 快照已作废：退出不应把用户刚打开的面板又关回去
    useLayoutStore.getState().exitFocusMode()
    expect(useLayoutStore.getState()).toMatchObject({ sidebarOpen: true, aiPanelOpen: false })
  })

  it('openRightPanel / openBottomTab 同样让快照作废', () => {
    useLayoutStore.getState().enterFocusMode()
    useLayoutStore.getState().openRightPanel('ai-output')
    expect(useLayoutStore.getState().focusSnapshot).toBeNull()
    expect(useLayoutStore.getState()).toMatchObject({ aiPanelOpen: true, rightView: 'ai-output' })

    useLayoutStore.getState().enterFocusMode()
    useLayoutStore.getState().openBottomTab('log')
    expect(useLayoutStore.getState().focusSnapshot).toBeNull()
    expect(useLayoutStore.getState()).toMatchObject({ bottomPanelOpen: true, bottomTab: 'log' })
  })

  it('toggleFocusMode 双向切换', () => {
    expect(useLayoutStore.getState().focusSnapshot).toBeNull()
    useLayoutStore.getState().toggleFocusMode()
    expect(useLayoutStore.getState().focusSnapshot).not.toBeNull()
    useLayoutStore.getState().toggleFocusMode()
    expect(useLayoutStore.getState().focusSnapshot).toBeNull()
  })

  it('快照只含布局字段 —— 一旦有人塞入内容相关字段这条会失败', () => {
    useLayoutStore.getState().enterFocusMode()
    expect(Object.keys(useLayoutStore.getState().focusSnapshot!).sort()).toEqual(
      ['aiPanelOpen', 'autoCollapsed', 'bottomDock', 'bottomPanelOpen', 'sidebarOpen'].sort(),
    )
  })
})
