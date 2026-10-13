import { describe, expect, it } from 'vitest'
import { isEditableTarget } from '../keyboard'

/**
 * 仓库没有 jsdom（environment 固定为 node），拿不到真实 DOM。
 * isEditableTarget 只依赖 closest / tagName / getAttribute 三个成员，
 * 这里用最小替身把「焦点落在哪种元素上」表达出来，不引入 DOM 依赖。
 */

/** 文本框 / 多行文本 / 下拉框替身 */
function fieldNode(tag: 'INPUT' | 'TEXTAREA' | 'SELECT', type?: string): Element {
  const node: Record<string, unknown> = {
    tagName: tag,
    getAttribute: (name: string) => (name === 'type' ? (type ?? null) : null),
  }
  node.closest = (selector: string) => (selector.includes(tag.toLowerCase()) ? node : null)
  return node as unknown as Element
}

/** contenteditable 容器替身（CodeMirror 6 的编辑区就是这个） */
function editableNode(): Element {
  const node: Record<string, unknown> = {
    tagName: 'DIV',
    getAttribute: () => null,
  }
  node.closest = (selector: string) => (selector.includes('contenteditable') ? node : null)
  return node as unknown as Element
}

/** 普通元素替身：既不是表单控件，也不是 contenteditable */
const plainNode = {
  tagName: 'DIV',
  getAttribute: () => null,
  closest: () => null,
} as unknown as Element

function keyEvent(target: unknown, withComposedPath = true): KeyboardEvent {
  return {
    target,
    ...(withComposedPath ? { composedPath: () => [target] } : {}),
  } as unknown as KeyboardEvent
}

describe('isEditableTarget', () => {
  it('文本框 / 多行文本 / 下拉框内视为可编辑', () => {
    expect(isEditableTarget(keyEvent(fieldNode('INPUT', 'text')))).toBe(true)
    expect(isEditableTarget(keyEvent(fieldNode('TEXTAREA')))).toBe(true)
    expect(isEditableTarget(keyEvent(fieldNode('SELECT')))).toBe(true)
  })

  it('CodeMirror 的 contenteditable 容器视为可编辑', () => {
    expect(isEditableTarget(keyEvent(editableNode()))).toBe(true)
  })

  it('复选框等不承载文本输入的控件不视为可编辑（快捷键仍应生效）', () => {
    for (const type of ['checkbox', 'radio', 'button', 'range', 'file']) {
      expect(isEditableTarget(keyEvent(fieldNode('INPUT', type)))).toBe(false)
    }
  })

  it('input 未声明 type 时按 text 处理', () => {
    expect(isEditableTarget(keyEvent(fieldNode('INPUT')))).toBe(true)
  })

  it('input type 大小写不敏感', () => {
    expect(isEditableTarget(keyEvent(fieldNode('INPUT', 'CHECKBOX')))).toBe(false)
  })

  it('普通元素上不拦截全局快捷键', () => {
    expect(isEditableTarget(keyEvent(plainNode))).toBe(false)
  })

  it('target 为 null 时安全返回 false', () => {
    expect(isEditableTarget(keyEvent(null))).toBe(false)
  })

  it('目标缺少 closest 时安全返回 false', () => {
    expect(isEditableTarget(keyEvent({ tagName: 'DIV' }))).toBe(false)
  })

  it('没有 composedPath 时回退到 event.target', () => {
    expect(isEditableTarget(keyEvent(fieldNode('TEXTAREA'), false))).toBe(true)
  })

  it('焦点在 shadow root 内时按 composedPath 首项判断', () => {
    // 真实 target 被重定向到宿主（普通 div），但路径首项才是焦点所在的 textarea
    const inner = fieldNode('TEXTAREA')
    const event = {
      target: plainNode,
      composedPath: () => [inner, plainNode],
    } as unknown as KeyboardEvent
    expect(isEditableTarget(event)).toBe(true)
  })
})
