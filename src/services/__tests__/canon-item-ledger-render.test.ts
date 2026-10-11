/**
 * 物品流转在 Canon 上下文里的呈现
 *
 * 台账的价值不在于界面好看，而在于写作时提示词里明确写着「这件道具现在在谁手上」，
 * 模型才不会让道具凭空出现或消失。
 */
import { describe, expect, it } from 'vitest'
import { renderCanonContext } from '../narrative-consistency'
import type { CanonContext } from '../narrative-consistency'

const canonWith = (itemLedger: string | undefined): CanonContext => ({
  worldRules: '', characterArch: '', characterStates: [], timeline: [],
  recentChapterSummaries: '', openPlotLines: [], chapterGoal: '', knownFacts: [],
  previousEnding: '', ragContext: '', writingStyle: '', globalGuidance: '', hardConstraints: '',
  itemLedger,
  meta: { chapterNumber: 21, builtAt: new Date(0).toISOString(), ragSources: 0 },
})

describe('物品流转在 Canon 段的呈现', () => {
  it('有台账时带出「道具在谁手上」', () => {
    const rendered = renderCanonContext(canonWith('- 炭笔：第3章 获得（顾野） → 第20章 消耗：画引火纹烧掉了'))

    expect(rendered).toContain('物品流转')
    expect(rendered).toContain('炭笔')
    expect(rendered).toContain('第20章 消耗')
  })

  it('没有台账时该段不占位（不会留一段空标题）', () => {
    const rendered = renderCanonContext(canonWith(''))

    expect(rendered).not.toContain('物品流转')
  })

  it('未提供该字段时同样不出现', () => {
    const rendered = renderCanonContext(canonWith(undefined))

    expect(rendered).not.toContain('物品流转')
  })
})
