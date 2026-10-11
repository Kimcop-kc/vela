/**
 * 生成前上下文预览（纯统计，不调用模型）
 *
 * 这份数据是「这次到底喂了什么」的唯一来源，界面按 key 渲染成多语言文案，
 * 所以这里锁住：段落只统计真正注入的内容、列表段带计数、异常情况有告警。
 */
import { describe, expect, it } from 'vitest'
import { buildContextPreview, type ContextPreviewInput } from '../workflows/context-preview'

const base: ContextPreviewInput = {
  chapterNumber: 12,
  firstChapter: false,
  prompt: '提示词正文'.repeat(100),
  tokenBudget: 28000,
  architecture: '架构'.repeat(500),
  globalGuidance: '全局要求',
  writingStyle: '冷峻',
  renderedCanon: 'Canon 内容'.repeat(200),
  canonCounts: { timeline: 24, characterStates: 7, plotLines: 3, facts: 41, summaries: 3 },
  chapterInfo: '{"title":"井台问路"}',
  futureBlueprints: '第 13 章预告',
  previousEnding: '上一章结尾'.repeat(50),
  knowledgeContext: '[1] (第8章.txt, 相关度 78%)\n炭笔…',
  knowledgeCount: 3,
  userGuidance: '本章克制',
}

describe('buildContextPreview', () => {
  it('逐段统计字数与条目数', () => {
    const preview = buildContextPreview(base)
    const byKey = new Map(preview.sections.map(section => [section.key, section]))

    expect(byKey.get('architecture')?.chars).toBe(base.architecture.length)
    expect(byKey.get('canon')?.items).toBe(24 + 7 + 3 + 41)
    expect(byKey.get('knowledge')?.items).toBe(3)
    expect(byKey.get('chapterInfo')?.chars).toBe(base.chapterInfo.length)
    expect(preview.promptChars).toBe(base.prompt.length)
    expect(preview.promptTokens).toBeGreaterThan(0)
  })

  it('列表段给出可读的计数明细', () => {
    const preview = buildContextPreview(base)
    const canon = preview.sections.find(section => section.key === 'canon')

    expect(canon?.breakdown?.map(item => item.key)).toEqual(['timeline', 'characterStates', 'plotLines', 'facts'])
    expect(canon?.breakdown?.find(item => item.key === 'facts')?.count).toBe(41)
  })

  it('第 1 章不注入 Canon 与上一章结尾，并给出说明', () => {
    const preview = buildContextPreview({
      ...base, firstChapter: true, renderedCanon: null, previousEnding: '', knowledgeCount: 0, knowledgeContext: '',
    })
    const keys = preview.sections.map(section => section.key)

    expect(keys).not.toContain('canon')
    expect(keys).not.toContain('previousEnding')
    expect(preview.notes).toContain('first-chapter')
  })

  it('知识库没检索到内容时保留该段并给出告警', () => {
    const preview = buildContextPreview({ ...base, knowledgeCount: 0, knowledgeContext: '（知识库中无相关内容）' })
    const knowledge = preview.sections.find(section => section.key === 'knowledge')

    expect(knowledge?.empty).toBe(true)
    expect(preview.warnings).toContain('no-knowledge')
  })

  it('超出预算时告警，超长架构标记截断', () => {
    const preview = buildContextPreview({
      ...base,
      prompt: '很长'.repeat(30000),
      architecture: '架构'.repeat(4000),
    })

    expect(preview.warnings).toContain('over-budget')
    expect(preview.sections.find(section => section.key === 'architecture')?.truncated).toBe(true)
    expect(preview.notes).toContain('truncated')
  })
})
