/**
 * 伏笔在 Canon 上下文里的呈现
 *
 * 伏笔必须在提示词里被明确标出来（并带上预计回收阶段），否则模型只把它当普通支线，
 * 想推就推、想忘就忘。普通剧情线则不应被打上伏笔标记。
 */
import { describe, expect, it } from 'vitest'
import { renderCanonContext } from '../narrative-consistency'
import type { CanonContext, PlotLine } from '../narrative-consistency'

const plotLine = (patch: Partial<PlotLine>): PlotLine => ({
  id: 1, name: '井台封泥下的入口', status: 'active', startedAt: 9, lastAdvancedAt: 11,
  characters: ['顾野'], currentState: '顾野看到封泥', description: '', ...patch,
})

const canonWith = (lines: PlotLine[]): CanonContext => ({
  worldRules: '', characterArch: '', characterStates: [], timeline: [],
  recentChapterSummaries: '', openPlotLines: lines, chapterGoal: '',
  knownFacts: [], previousEnding: '', ragContext: '', writingStyle: '',
  globalGuidance: '', hardConstraints: '',
  meta: { chapterNumber: 12, builtAt: new Date(0).toISOString(), ragSources: 0 },
})

describe('伏笔在 Canon 段的呈现', () => {
  it('伏笔标出类型与预计回收阶段', () => {
    const rendered = renderCanonContext(canonWith([
      plotLine({ kind: 'foreshadow', plannedResolveAt: '中期' }),
    ]))

    expect(rendered).toContain('伏笔')
    expect(rendered).toContain('预计回收：中期')
    expect(rendered).toContain('井台封泥下的入口')
  })

  it('普通剧情线不带伏笔标记', () => {
    const rendered = renderCanonContext(canonWith([plotLine({ kind: 'plot' })]))

    expect(rendered).toContain('井台封泥下的入口')
    expect(rendered).not.toContain('伏笔')
    expect(rendered).not.toContain('预计回收')
  })

  it('伏笔没填预计回收阶段时只标类型', () => {
    const rendered = renderCanonContext(canonWith([plotLine({ kind: 'foreshadow' })]))

    expect(rendered).toContain('伏笔')
    expect(rendered).not.toContain('预计回收')
  })
})
