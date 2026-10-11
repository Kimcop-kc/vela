/**
 * 地点与空间关系在 Canon 段的呈现
 *
 * 这段的意义在于事前约束人物移动：提示词里写清「A 离 B 多远、怎么去、要多久」，
 * 模型才不会在没有车马或传送手段的情况下把人挪到千里之外。
 */
import { describe, expect, it } from 'vitest'
import { renderCanonContext } from '../narrative-consistency'
import type { CanonContext } from '../narrative-consistency'

const canonWith = (locationMap: string | undefined): CanonContext => ({
  worldRules: '', characterArch: '', characterStates: [], timeline: [],
  recentChapterSummaries: '', openPlotLines: [], chapterGoal: '', knownFacts: [],
  previousEnding: '', ragContext: '', writingStyle: '', globalGuidance: '', hardConstraints: '',
  locationMap,
  meta: { chapterNumber: 21, builtAt: new Date(0).toISOString(), ragSources: 0 },
})

describe('地点与空间关系在 Canon 段的呈现', () => {
  it('有地点时带出距离与通行方式', () => {
    const rendered = renderCanonContext(canonWith('- 黑水渡口（云州西部 · 势力：周家）：距青石镇一日脚程；渡船，逢雨停摆'))

    expect(rendered).toContain('地点与空间关系')
    expect(rendered).toContain('黑水渡口')
    expect(rendered).toContain('一日脚程')
    expect(rendered).toContain('渡船')
  })

  it('没有地点时该段不占位（不会留一段空标题）', () => {
    expect(renderCanonContext(canonWith(''))).not.toContain('地点与空间关系')
  })

  it('未提供该字段时同样不出现', () => {
    expect(renderCanonContext(canonWith(undefined))).not.toContain('地点与空间关系')
  })
})
