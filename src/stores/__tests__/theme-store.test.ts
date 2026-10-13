import { describe, it, expect, beforeEach } from 'vitest'

// theme-store 用 zustand/persist 持久化。zustand v5 的 persist 默认存储是
// `createJSONStorage(() => window.localStorage)` —— 注意读的是 window.localStorage，
// 而不是裸的 localStorage；node 环境两者都没有，会静默退化成「storage 不可用」并刷告警。
// 因此在模块加载期先把 window.localStorage 装上，再用顶层 await 动态导入 store。
const memory = new Map<string, string>()
const storageStub = {
  getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
}
;(globalThis as unknown as { window: unknown }).window = { localStorage: storageStub }
;(globalThis as unknown as { localStorage: unknown }).localStorage = storageStub

const {
  useThemeStore,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_LINE_HEIGHT_MIN,
  EDITOR_LINE_HEIGHT_MAX,
  EDITOR_LINE_HEIGHT_DEFAULT,
  EDITOR_MAX_WIDTH_MIN,
  EDITOR_MAX_WIDTH_MAX,
  EDITOR_MAX_WIDTH_DEFAULT,
  EDITOR_PARAGRAPH_SPACING_MIN,
  EDITOR_PARAGRAPH_SPACING_MAX,
  EDITOR_PARAGRAPH_SPACING_DEFAULT,
} = await import('../theme-store')

/** 把阅读设置复位到默认值，避免用例互相污染 */
const resetReadingSettings = () => {
  useThemeStore.setState({
    editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
    editorLineHeight: EDITOR_LINE_HEIGHT_DEFAULT,
    editorMaxWidth: EDITOR_MAX_WIDTH_DEFAULT,
    editorParagraphSpacing: EDITOR_PARAGRAPH_SPACING_DEFAULT,
  })
}

describe('theme-store · 编辑画布外观', () => {
  beforeEach(() => {
    // store 是单例，用例之间必须显式复位，避免相互污染
    useThemeStore.setState({ editorAppearance: 'follow' })
    resetReadingSettings()
  })

  it('默认跟随工作台，字号为 16px', () => {
    const s = useThemeStore.getState()
    expect(s.editorAppearance).toBe('follow')
    expect(s.editorFontSize).toBe(EDITOR_FONT_SIZE_DEFAULT)
    expect(EDITOR_FONT_SIZE_DEFAULT).toBe(16)
  })

  it('接受三种外观取值', () => {
    for (const value of ['follow', 'paper', 'dark'] as const) {
      useThemeStore.getState().setEditorAppearance(value)
      expect(useThemeStore.getState().editorAppearance).toBe(value)
    }
  })

  it('字号低于下限时钳制到下限', () => {
    useThemeStore.getState().setEditorFontSize(EDITOR_FONT_SIZE_MIN - 10)
    expect(useThemeStore.getState().editorFontSize).toBe(EDITOR_FONT_SIZE_MIN)
  })

  it('字号高于上限时钳制到上限', () => {
    useThemeStore.getState().setEditorFontSize(EDITOR_FONT_SIZE_MAX + 10)
    expect(useThemeStore.getState().editorFontSize).toBe(EDITOR_FONT_SIZE_MAX)
  })

  it('区间内的字号原样接受', () => {
    useThemeStore.getState().setEditorFontSize(20)
    expect(useThemeStore.getState().editorFontSize).toBe(20)
  })

  it('小数字号四舍五入为整数（CSS 变量拼接依赖整数值）', () => {
    useThemeStore.getState().setEditorFontSize(17.6)
    expect(useThemeStore.getState().editorFontSize).toBe(18)
    useThemeStore.getState().setEditorFontSize(17.4)
    expect(useThemeStore.getState().editorFontSize).toBe(17)
  })

  it('外观与字号会写入持久化存储（partialize 已包含新字段）', () => {
    useThemeStore.getState().setEditorAppearance('paper')
    useThemeStore.getState().setEditorFontSize(21)

    const raw = memory.get('vela-theme')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> }
    expect(parsed.state.editorAppearance).toBe('paper')
    expect(parsed.state.editorFontSize).toBe(21)
  })

  it('非有限值被忽略，不污染状态与持久化数据', () => {
    useThemeStore.getState().setEditorFontSize(20)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      useThemeStore.getState().setEditorFontSize(bad)
      expect(useThemeStore.getState().editorFontSize).toBe(20)
    }
  })
})

/**
 * 阅读设置护栏（任务书 6.4）
 *
 * 四项默认值刻意等于改造前 CodeMirrorEditor 里的硬编码值（16px / 1.8 / 800px / 0），
 * 因此「装上即与旧版渲染一致」这条断言必须锁住 —— 一旦有人改了默认值，
 * 所有老用户升级后正文排版都会静默变化。
 */
describe('theme-store · 阅读设置', () => {
  beforeEach(() => {
    resetReadingSettings()
  })

  it('默认值与改造前的硬编码值一致', () => {
    const s = useThemeStore.getState()
    expect(s.editorFontSize).toBe(16)
    expect(s.editorLineHeight).toBe(1.8)
    expect(s.editorMaxWidth).toBe(800)
    expect(s.editorParagraphSpacing).toBe(0)
  })

  it('行高钳制在 1.4–2.4 并保留一位小数', () => {
    useThemeStore.getState().setEditorLineHeight(0.2)
    expect(useThemeStore.getState().editorLineHeight).toBe(EDITOR_LINE_HEIGHT_MIN)
    useThemeStore.getState().setEditorLineHeight(99)
    expect(useThemeStore.getState().editorLineHeight).toBe(EDITOR_LINE_HEIGHT_MAX)
    useThemeStore.getState().setEditorLineHeight(2.06)
    expect(useThemeStore.getState().editorLineHeight).toBe(2.1)
  })

  it('纸面宽度钳制在 560–1200 并取整', () => {
    useThemeStore.getState().setEditorMaxWidth(10)
    expect(useThemeStore.getState().editorMaxWidth).toBe(EDITOR_MAX_WIDTH_MIN)
    useThemeStore.getState().setEditorMaxWidth(99999)
    expect(useThemeStore.getState().editorMaxWidth).toBe(EDITOR_MAX_WIDTH_MAX)
    useThemeStore.getState().setEditorMaxWidth(913.7)
    expect(useThemeStore.getState().editorMaxWidth).toBe(914)
  })

  it('段落间距钳制在 0–1.5 并保留一位小数', () => {
    useThemeStore.getState().setEditorParagraphSpacing(-3)
    expect(useThemeStore.getState().editorParagraphSpacing).toBe(EDITOR_PARAGRAPH_SPACING_MIN)
    useThemeStore.getState().setEditorParagraphSpacing(9)
    expect(useThemeStore.getState().editorParagraphSpacing).toBe(EDITOR_PARAGRAPH_SPACING_MAX)
    useThemeStore.getState().setEditorParagraphSpacing(0.45)
    expect(useThemeStore.getState().editorParagraphSpacing).toBe(0.5)
  })

  it('非有限值被忽略，不写坏状态', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      useThemeStore.getState().setEditorLineHeight(bad)
      useThemeStore.getState().setEditorMaxWidth(bad)
      useThemeStore.getState().setEditorParagraphSpacing(bad)
    }
    const s = useThemeStore.getState()
    expect(s.editorLineHeight).toBe(EDITOR_LINE_HEIGHT_DEFAULT)
    expect(s.editorMaxWidth).toBe(EDITOR_MAX_WIDTH_DEFAULT)
    expect(s.editorParagraphSpacing).toBe(EDITOR_PARAGRAPH_SPACING_DEFAULT)
  })

  it('四项阅读设置都会写入持久化存储（partialize 已包含新字段）', () => {
    useThemeStore.getState().setEditorFontSize(19)
    useThemeStore.getState().setEditorLineHeight(2.0)
    useThemeStore.getState().setEditorMaxWidth(720)
    useThemeStore.getState().setEditorParagraphSpacing(0.6)

    const raw = memory.get('vela-theme')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> }
    expect(parsed.state).toMatchObject({
      editorFontSize: 19,
      editorLineHeight: 2,
      editorMaxWidth: 720,
      editorParagraphSpacing: 0.6,
    })
  })
})
