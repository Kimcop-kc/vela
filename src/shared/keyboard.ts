/**
 * 全局快捷键的公共判定 — 全站唯一起源
 *
 * 应用级快捷键（新建 / 打开项目、界面缩放）挂在 window 上，若不判断事件来源，
 * 在正文编辑器或任意输入框里按下就会先被全局处理器 preventDefault 并触发应用动作 ——
 * 正在写的字会被弹窗打断。下面的判断用来把这类按键让回给当前输入焦点。
 *
 * 使用方：src/App.tsx（Cmd+N / Cmd+O）、src/components/layout/TitleBar.tsx（Cmd+= / - / 0）。
 */

/** 不承载文本输入的 input 类型；焦点落在这些控件上时不应跳过全局快捷键 */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
])

/** 只声明本模块用到的成员，便于在 node 环境下用替身对象做单测（仓库没有 jsdom） */
type ClosestCapable = {
  closest(selector: string): Element | null
  tagName?: string
  getAttribute?(name: string): string | null
}

/**
 * 事件目标是否位于可编辑元素内（文本框 / 多行文本 / 下拉框 / contenteditable）。
 *
 * 取 composedPath()[0] 而不是 event.target：焦点元素若位于 shadow root 内，
 * target 会被重定向到宿主元素，路径首项才是真实目标。
 */
export function isEditableTarget(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  const target = (path[0] ?? event.target) as unknown as ClosestCapable | null | undefined
  if (!target || typeof target.closest !== 'function') return false

  const field = target.closest('input, textarea, select') as unknown as ClosestCapable | null
  if (field) {
    if (field.tagName === 'INPUT') {
      const type = (field.getAttribute ? field.getAttribute('type') : null) ?? 'text'
      return !NON_TEXT_INPUT_TYPES.has(type.toLowerCase())
    }
    return true
  }

  // CodeMirror 6 的编辑区就是 contenteditable="true" 的容器
  return target.closest('[contenteditable="true"]') !== null
}
