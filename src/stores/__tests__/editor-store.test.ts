/**
 * 编辑器 Tab 状态护栏
 *
 * 这些约定是「界面上看得见但代码里没有类型约束」的部分，最容易在重构时被改坏：
 *   · diff / 审稿报告每次内容都不同，重开必须刷新内容；其它类型重开只更新标题；
 *   · 固定 Tab（pinned）关不掉；
 *   · 关掉当前激活 Tab 后要回退到最后一个 Tab，关掉非激活 Tab 不能改变当前 Tab；
 *   · updateTabContent 会亮起未保存指示灯，syncTabContent（AI 生成后刷新 / 打开文件同步）
 *     不能碰 dirty 标记 —— 否则 AI 一刷新界面就误报「有未保存修改」。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore, type EditorTab } from '../editor-store'

const initialState = useEditorStore.getState()

const tab = (patch: Partial<EditorTab> & { id: string }): EditorTab => ({ name: patch.id, type: 'chapter', ...patch })

describe('编辑器 Tab 状态', () => {
  beforeEach(() => {
    useEditorStore.setState(initialState, true)
  })

  it('打开新文件会追加 Tab 并激活', () => {
    useEditorStore.getState().openFile(tab({ id: 'a' }))
    useEditorStore.getState().openFile(tab({ id: 'b' }))
    expect(useEditorStore.getState().tabs.map(t => t.id)).toEqual(['a', 'b'])
    expect(useEditorStore.getState().activeTabId).toBe('b')
  })

  it('同 filePath + type 再次打开只更新标题并激活，不重复开 Tab', () => {
    useEditorStore.getState().openFile(tab({ id: 'a', filePath: '/p/1.md', name: '旧标题' }))
    useEditorStore.getState().openFile(tab({ id: 'b', filePath: '/p/1.md', name: '新标题' }))
    const state = useEditorStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].name).toBe('新标题')
    expect(state.activeTabId).toBe('a')
  })

  it('diff 只按 id 去重：同一个 filePath 的不同 diff 各自成 Tab', () => {
    useEditorStore.getState().openFile(tab({ id: 'd1', type: 'diff', filePath: '/p/1.md' }))
    useEditorStore.getState().openFile(tab({ id: 'd2', type: 'diff', filePath: '/p/1.md' }))
    expect(useEditorStore.getState().tabs.map(t => t.id)).toEqual(['d1', 'd2'])
  })

  it('重开 diff / 审稿报告会刷新内容（每次内容不同），普通 Tab 只更新标题', () => {
    useEditorStore.getState().openFile(tab({ id: 'd1', type: 'diff', content: '旧差异' }))
    useEditorStore.getState().openFile(tab({ id: 'd1', type: 'diff', content: '新差异' }))
    expect(useEditorStore.getState().tabs[0].content).toBe('新差异')

    useEditorStore.getState().openFile(tab({ id: 'r1', type: 'review-report', content: '旧报告' }))
    useEditorStore.getState().openFile(tab({ id: 'r1', type: 'review-report', content: '新报告' }))
    expect(useEditorStore.getState().tabs.find(t => t.id === 'r1')?.content).toBe('新报告')

    useEditorStore.getState().openFile(tab({ id: 'c1', filePath: '/p/2.md', content: '旧正文' }))
    useEditorStore.getState().openFile(tab({ id: 'c2', filePath: '/p/2.md', name: '改名', content: '新正文' }))
    const chapter = useEditorStore.getState().tabs.find(t => t.id === 'c1')
    expect(chapter?.content).toBe('旧正文')
    expect(chapter?.name).toBe('改名')
  })

  it('pinned Tab 关不掉', () => {
    useEditorStore.getState().openFile(tab({ id: 'p', pinned: true }))
    useEditorStore.getState().closeTab('p')
    expect(useEditorStore.getState().tabs.map(t => t.id)).toEqual(['p'])
    expect(useEditorStore.getState().activeTabId).toBe('p')
  })

  it('关掉当前激活 Tab 回退到最后一个 Tab；关掉非激活 Tab 不动当前 Tab', () => {
    for (const id of ['a', 'b', 'c']) useEditorStore.getState().openFile(tab({ id }))

    useEditorStore.getState().closeTab('b')
    expect(useEditorStore.getState().activeTabId).toBe('c')

    useEditorStore.getState().setActiveTab('a')
    useEditorStore.getState().closeTab('c')
    expect(useEditorStore.getState().activeTabId).toBe('a')

    useEditorStore.getState().closeTab('a')
    expect(useEditorStore.getState().tabs).toHaveLength(0)
    expect(useEditorStore.getState().activeTabId).toBeNull()
  })

  it('updateTabContent 会标记 dirty，syncTabContent 不碰 dirty（两个方向都不能串）', () => {
    useEditorStore.getState().openFile(tab({ id: 'a', content: 'v1' }))

    useEditorStore.getState().updateTabContent('a', 'v2')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'v2', dirty: true })

    // 静默同步：内容更新，但仍处于「有未保存修改」状态
    useEditorStore.getState().syncTabContent('a', 'v3')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'v3', dirty: true })

    useEditorStore.getState().markTabSaved('a')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'v3', dirty: false })

    // 已保存后静默同步不应重新亮起未保存指示灯
    useEditorStore.getState().syncTabContent('a', 'v4')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'v4', dirty: false })
  })

  it('对不存在的 Tab 操作不会抛错也不会凭空造 Tab', () => {
    expect(() => {
      useEditorStore.getState().updateTabContent('nope', 'x')
      useEditorStore.getState().syncTabContent('nope', 'x')
      useEditorStore.getState().markTabSaved('nope')
      useEditorStore.getState().closeTab('nope')
    }).not.toThrow()
    expect(useEditorStore.getState().tabs).toHaveLength(0)
  })

  it('clearTabs 清空列表并复位激活项', () => {
    useEditorStore.getState().openFile(tab({ id: 'a' }))
    useEditorStore.getState().clearTabs()
    expect(useEditorStore.getState().tabs).toEqual([])
    expect(useEditorStore.getState().activeTabId).toBeNull()
  })
})
