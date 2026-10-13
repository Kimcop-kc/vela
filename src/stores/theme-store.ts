import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ipc } from '../services/ipc-client'
import i18n from '../i18n'

export type Theme = 'light' | 'galaxy' | 'paper' | 'dark' | 'ocean'

/**
 * 编辑画布外观。
 * - `follow`：跟随工作台主题（沿用当前主题的 --color-editor-* / --color-text 等）
 * - `paper`：浅色纸稿，无论工作台是深是浅，编辑画布都是一张暖白纸
 * - `dark`：深色编辑器，编辑画布固定为深色
 *
 * 只作用于「编辑画布」容器（EditorArea 主体），不改变工作台其余部分 ——
 * `--color-editor-bg` 同时被欢迎页、知识库等 16 处非编辑器页面引用，
 * 因此绝不能在 html / body 上整体覆盖它。
 */
export type EditorAppearance = 'follow' | 'paper' | 'dark'

// ─── 共享字体库 ─────────────────────────────────────────────────────────────

/** 内置字体 ID（界面字体和写作字体共享同一张清单） */
export type FontId = 'segoe' | 'inter' | 'noto-sans-sc' | 'lxgw-wenkai' | 'noto-serif-sc' | 'system'

export interface FontOption {
  id: FontId
  label: string
  labelEn: string
  desc: string
  /** 实际 CSS font-family 字符串 */
  family: string
  /** 预览文字（用该字体渲染，展示中英文效果） */
  preview: string
}

const tFont = (key: string) => i18n.t(key, { ns: 'settings' })

/** 所有内置字体（界面 + 写作共用） */
export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'segoe',
    label: 'Segoe UI',
    labelEn: 'Segoe UI Variable',
    desc: tFont('fonts.segoe.desc'),
    family: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
    preview: 'Aa Bb 文字 123',
  },
  {
    id: 'inter',
    label: 'Inter',
    labelEn: 'Inter',
    desc: tFont('fonts.inter.desc'),
    family: "'Inter', system-ui, sans-serif",
    preview: 'Aa Bb 文字 123',
  },
  {
    id: 'noto-sans-sc',
    label: tFont('fonts.noto-sans-sc.label'),
    labelEn: 'Noto Sans SC',
    desc: tFont('fonts.noto-sans-sc.desc'),
    family: "'Noto Sans SC', sans-serif",
    preview: '思源黑体 Sans',
  },
  {
    id: 'lxgw-wenkai',
    label: tFont('fonts.lxgw-wenkai.label'),
    labelEn: 'LXGW WenKai',
    desc: tFont('fonts.lxgw-wenkai.desc'),
    family: "'LXGW WenKai', serif",
    preview: '春花秋月何时了',
  },
  {
    id: 'noto-serif-sc',
    label: tFont('fonts.noto-serif-sc.label'),
    labelEn: 'Noto Serif SC',
    desc: tFont('fonts.noto-serif-sc.desc'),
    family: "'Noto Serif SC', serif",
    preview: '往事如云烟，归零',
  },
  {
    id: 'system',
    label: tFont('fonts.system.label'),
    labelEn: 'System UI',
    desc: tFont('fonts.system.desc'),
    family: 'system-ui, -apple-system, sans-serif',
    preview: 'Aa Bb 苹方 123',
  },
]

// ─── 向后兼容：旧版 WRITING_FONT_OPTIONS 别名 ──────────────────────────────
/** @deprecated 请使用 FONT_OPTIONS */
export const WRITING_FONT_OPTIONS = FONT_OPTIONS
/** @deprecated 请使用 FontId */
export type WritingFont = FontId

// ─── 缩放常量 ─────────────────────────────────────────────────────────────

const ZOOM_STEP = 0.05
const ZOOM_MIN = 0.7
const ZOOM_MAX = 1.5
/** 基准 font-size（未缩放时 html 的字号，px） */
const BASE_FONT_SIZE = 14 as const

// ─── 正文字号常量 ─────────────────────────────────────────────────────────

export const EDITOR_FONT_SIZE_MIN = 14
export const EDITOR_FONT_SIZE_MAX = 24
/** 与 CodeMirrorEditor 里 `var(--editor-font-size, 16px)` 的兜底值保持一致 */
export const EDITOR_FONT_SIZE_DEFAULT = 16

// ─── 阅读设置常量 ─────────────────────────────────────────────────────────
// 每个默认值都刻意等于改造前 CodeMirrorEditor 里的硬编码值，
// 这样「装上即与旧版渲染一致」，用户不动设置就不会看到任何视觉变化。

export const EDITOR_LINE_HEIGHT_MIN = 1.4
export const EDITOR_LINE_HEIGHT_MAX = 2.4
export const EDITOR_LINE_HEIGHT_DEFAULT = 1.8

/** 纸面宽度（正文栏最大宽度，px） */
export const EDITOR_MAX_WIDTH_MIN = 560
export const EDITOR_MAX_WIDTH_MAX = 1200
export const EDITOR_MAX_WIDTH_DEFAULT = 800

/** 段落间距（em，作用于每个段落底部） */
export const EDITOR_PARAGRAPH_SPACING_MIN = 0
export const EDITOR_PARAGRAPH_SPACING_MAX = 1.5
export const EDITOR_PARAGRAPH_SPACING_DEFAULT = 0

/** 把数值钳制到 [min, max] 并保留 `digits` 位小数；非有限值返回 null 表示「忽略本次输入」 */
function clampNumber(value: number, min: number, max: number, digits: number): number | null {
  // 这些值会被拼进 CSS 变量并写入持久化存储，非有限值一律忽略，
  // 否则 NaN 会一路传播成 `--editor-line-height: NaN` 并永久污染 localStorage。
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(Math.max(min, Math.min(max, value)) * factor) / factor
}

// ─── Store 类型 ──────────────────────────────────────────────────────────

interface ThemeState {
  /** 用户选择的主题 */
  theme: Theme
  /** 实际应用的主题（解析 system 后） */
  resolvedTheme: 'light' | 'galaxy' | 'paper' | 'dark' | 'ocean'
  /** 当前缩放级别（1.0 = 100%） */
  zoom: number
  /** 当前写作字体（正文编辑区 → --font-writing） */
  writingFont: FontId
  /** 当前界面字体（UI 全局 → --font-sans） */
  uiFont: FontId
  /** 编辑画布外观（跟随工作台 / 浅色纸稿 / 深色编辑器） */
  editorAppearance: EditorAppearance
  /** 正文字号（px），仅作用于 prose 模式的编辑画布 */
  editorFontSize: number
  /** 正文行高（倍数） */
  editorLineHeight: number
  /** 纸面宽度（正文栏最大宽度，px） */
  editorMaxWidth: number
  /** 段落间距（em） */
  editorParagraphSpacing: number
  /** 设置主题 */
  setTheme: (theme: Theme) => void
  /** 初始化主题监听 */
  initTheme: () => void
  /** 放大 */
  zoomIn: () => void
  /** 缩小 */
  zoomOut: () => void
  /** 重置缩放到 100% */
  zoomReset: () => void
  /** 直接设置缩放级别 */
  setZoom: (zoom: number) => void
  /** 设置写作字体 */
  setWritingFont: (font: FontId) => void
  /** 设置界面字体 */
  setUiFont: (font: FontId) => void
  /** 设置编辑画布外观 */
  setEditorAppearance: (appearance: EditorAppearance) => void
  /** 设置正文字号（自动钳制到 [EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX]） */
  setEditorFontSize: (size: number) => void
  /** 设置正文行高（自动钳制到 [EDITOR_LINE_HEIGHT_MIN, EDITOR_LINE_HEIGHT_MAX]） */
  setEditorLineHeight: (value: number) => void
  /** 设置纸面宽度（自动钳制到 [EDITOR_MAX_WIDTH_MIN, EDITOR_MAX_WIDTH_MAX]） */
  setEditorMaxWidth: (value: number) => void
  /** 设置段落间距（自动钳制到 [EDITOR_PARAGRAPH_SPACING_MIN, EDITOR_PARAGRAPH_SPACING_MAX]） */
  setEditorParagraphSpacing: (value: number) => void
}

// ─── Store ───────────────────────────────────────────────────────────────

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'ocean',
      resolvedTheme: 'ocean',
      zoom: 1.0,
      writingFont: 'lxgw-wenkai',
      uiFont: 'segoe',
      editorAppearance: 'follow',
      editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
      editorLineHeight: EDITOR_LINE_HEIGHT_DEFAULT,
      editorMaxWidth: EDITOR_MAX_WIDTH_DEFAULT,
      editorParagraphSpacing: EDITOR_PARAGRAPH_SPACING_DEFAULT,

      setTheme: (theme: Theme) => {
        const resolved = resolveTheme(theme)
        set({ theme, resolvedTheme: resolved })
        applyTheme(resolved)
      },

      initTheme: () => {
        const { zoom, writingFont, uiFont } = get()
        let { theme } = get()

        // --- 迁移并兼容历史数据版本 ---
        // 兼容旧版系统设定的 localStorage
        if ((theme as string) === 'system') {
          theme = resolveTheme(theme)
          set({ theme })
        }
        // 如果读到旧版的 'night'，迁移为真的 'dark'
        if ((theme as string) === 'night') {
          theme = 'dark'
          set({ theme })
        }
        // 由于这里我们需要将以前的暗色变为 galaxy，如果用户之前就在用旧版 dark（此时不具备 night 属性），我们在上一个版本已经加过了 night。
        // 为了安全起见这里不再强转 dark -> galaxy，如果是直接跳版的用户，就把旧版的 dark 继承成新的黑夜 dark 也合情合理。
        // 但根据需求：“原本的深蓝色改叫 galaxy”，如果用户之前存的是旧版 'dark' (深蓝)，最好迁移。
        // 如何判断？如果 localStorage 中没有存到某处特征，我们可以直接迁移：
        if ((theme as string) === 'dark' && localStorage.getItem('vela-theme-migrated') !== '1') {
          theme = 'galaxy'
          set({ theme })
          localStorage.setItem('vela-theme-migrated', '1')
        }

        const resolved = resolveTheme(theme)
        set({ resolvedTheme: resolved })
        applyTheme(resolved)
        applyZoom(zoom)
        applyWritingFont(writingFont)
        applyUiFont(uiFont)
      },

      zoomIn: () => {
        const next = Math.min(ZOOM_MAX, +(get().zoom + ZOOM_STEP).toFixed(2))
        set({ zoom: next })
        applyZoom(next)
      },

      zoomOut: () => {
        const next = Math.max(ZOOM_MIN, +(get().zoom - ZOOM_STEP).toFixed(2))
        set({ zoom: next })
        applyZoom(next)
      },

      zoomReset: () => {
        set({ zoom: 1.0 })
        applyZoom(1.0)
      },

      setZoom: (zoom: number) => {
        const clamped = +Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom)).toFixed(2)
        set({ zoom: clamped })
        applyZoom(clamped)
      },

      setWritingFont: (font: FontId) => {
        set({ writingFont: font })
        applyWritingFont(font)
      },

      setUiFont: (font: FontId) => {
        set({ uiFont: font })
        applyUiFont(font)
      },

      setEditorAppearance: (appearance: EditorAppearance) => {
        set({ editorAppearance: appearance })
      },

      setEditorFontSize: (size: number) => {
        const next = clampNumber(size, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX, 0)
        if (next === null) return
        set({ editorFontSize: next })
      },

      setEditorLineHeight: (value: number) => {
        const next = clampNumber(value, EDITOR_LINE_HEIGHT_MIN, EDITOR_LINE_HEIGHT_MAX, 1)
        if (next === null) return
        set({ editorLineHeight: next })
      },

      setEditorMaxWidth: (value: number) => {
        const next = clampNumber(value, EDITOR_MAX_WIDTH_MIN, EDITOR_MAX_WIDTH_MAX, 0)
        if (next === null) return
        set({ editorMaxWidth: next })
      },

      setEditorParagraphSpacing: (value: number) => {
        const next = clampNumber(value, EDITOR_PARAGRAPH_SPACING_MIN, EDITOR_PARAGRAPH_SPACING_MAX, 1)
        if (next === null) return
        set({ editorParagraphSpacing: next })
      },
    }),
    {
      name: 'vela-theme',
      partialize: (state) => ({
        theme: state.theme,
        zoom: state.zoom,
        writingFont: state.writingFont,
        uiFont: state.uiFont,
        editorAppearance: state.editorAppearance,
        editorFontSize: state.editorFontSize,
        editorLineHeight: state.editorLineHeight,
        editorMaxWidth: state.editorMaxWidth,
        editorParagraphSpacing: state.editorParagraphSpacing,
      }),
    }
  )
)

// ─── 内部工具函数 ─────────────────────────────────────────────────────────

/** 解析主题：直接返回实际值，保留对 localStorage 旧版 system 设定的向下兼容 */
function resolveTheme(theme: Theme): 'light' | 'galaxy' | 'paper' | 'dark' | 'ocean' {
  if ((theme as string) === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

/** 应用主题到 DOM — 支持互斥的主题 */
function applyTheme(theme: 'light' | 'galaxy' | 'paper' | 'dark' | 'ocean') {
  const root = document.documentElement
  root.classList.remove('galaxy', 'paper', 'dark', 'ocean')
  if (theme === 'ocean') {
    root.classList.add('ocean')
  } else if (theme === 'galaxy') {
    root.classList.add('galaxy')
  } else if (theme === 'paper') {
    root.classList.add('paper')
  } else if (theme === 'dark') {
    root.classList.add('dark')
  }
}

/**
 * 将缩放比例应用到整个窗口。
 * Electron 环境使用 native zoomFactor；否则降级到 html root font-size。
 */
function applyZoom(zoom: number) {
  if (ipc.isElectron) {
    ipc.setZoomFactor(zoom)
  } else {
    document.documentElement.style.fontSize = `${(BASE_FONT_SIZE * zoom).toFixed(2)}px`
  }
}

/** 将写作字体应用到 --font-writing，正文编辑器通过 CSS 变量引用 */
function applyWritingFont(font: FontId) {
  const opt = FONT_OPTIONS.find((o) => o.id === font)
  if (opt) {
    document.documentElement.style.setProperty('--font-writing', opt.family)
  }
}

/** 将界面字体应用到 --font-sans，body/html 通过 font-family: var(--font-sans) 引用 */
function applyUiFont(font: FontId) {
  const opt = FONT_OPTIONS.find((o) => o.id === font)
  if (opt) {
    document.documentElement.style.setProperty('--font-sans', opt.family)
  }
}
