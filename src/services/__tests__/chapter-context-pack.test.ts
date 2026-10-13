/**
 * 第三阶段：本章上下文资料包 + 真实请求预览
 *
 * 覆盖需求里的验证点：
 *   - 十类资料包在不同章节 / 不同出场人物 / 不同剧情目标下的组装
 *   - 相关记忆被注入、无关记忆不大量占用
 *   - 人物认知边界不遗漏（缺失时明确标注，不捏造）
 *   - 预算按优先级裁剪，且截断有明确记录
 *   - 作者要求与已确认设定冲突时双方并列，不自动选边、不改设定
 *   - 输入变化后指纹变化（过期判断）
 *   - 预览来自真正发送的最终请求（含续写轮的 assistant 尾文与续写指令）
 */
import { describe, it, expect } from 'vitest'
import {
  buildChapterContextPack,
  renderContextPack,
  isContextPackStale,
  SECTION_PRIORITY,
  type BuildContextPackParams,
} from '../workflows/chapter-context-pack'
import {
  buildChapterContextPreview,
  buildSectionReport,
  renderPreviewText,
} from '../workflows/chapter-context-preview'
import type { CanonContext, Fact, CharacterStateSnapshot } from '../narrative-consistency'
import {
  recordLLMRequestSnapshot,
  clearLLMRequestSnapshots,
} from '../workflows/commands/base-command'

function state(
  character: string,
  chapter: number,
  extra: Partial<CharacterStateSnapshot> = {},
): CharacterStateSnapshot {
  return {
    character,
    location: '',
    powerLevel: '',
    physicalState: '',
    mentalState: '',
    keyItems: '',
    currentGoal: '',
    recentEvents: '',
    knowledge: [],
    relationships: {},
    updatedAtChapter: chapter,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  }
}

function fact(statement: string, chapter: number, extra: Partial<Fact> = {}): Fact {
  return {
    statement,
    category: 'world',
    introducedAt: chapter,
    characters: [],
    status: 'active',
    confirmedAt: null,
    ...extra,
  }
}

function canon(overrides: Partial<CanonContext> = {}): CanonContext {
  return {
    worldRules: '灵气复苏，强者为尊。',
    characterArch: '',
    characterStates: [],
    timeline: [],
    recentChapterSummaries: '',
    openPlotLines: [],
    chapterGoal: '',
    knownFacts: [],
    previousEnding: '',
    ragContext: '',
    writingStyle: '',
    globalGuidance: '',
    hardConstraints: '',
    meta: { chapterNumber: 3, builtAt: '2026-01-01T00:00:00.000Z', ragSources: 0 },
    ...overrides,
  }
}

function params(overrides: Partial<BuildContextPackParams> = {}): BuildContextPackParams {
  return {
    chapterNumber: 3,
    canon: canon(),
    ...overrides,
  }
}

describe('本章资料包：十类资料组装', () => {
  it('十段齐全，且每段带优先级', () => {
    const pack = buildChapterContextPack(params({
      chapterGoal: '夺回祖传玉简',
      scene: { time: '入夜', location: '后山禁地', environment: '阴雨' },
      focusCharacters: ['林轩'],
      writingStyle: '第三人称限知',
      wordTarget: 3000,
      mustInclude: ['林轩与守墓人对峙'],
      forbidden: ['揭露玉佩真正来历'],
      canon: canon({
        characterStates: [state('林轩', 2, { powerLevel: '凝气三层', knowledge: ['西墙刻痕的来历'] })],
        openPlotLines: [{
          id: 1, name: '玉佩之谜', kind: 'foreshadow', status: 'active',
          description: '玉佩来自何处', currentState: '尚不知玉佩与血脉的关系',
          characters: ['林轩'],
          startedAt: 1, lastAdvancedAt: 2, plannedResolveAt: '第 20 章',
        }],
        worldRules: '灵气复苏',
      }),
    }))

    const keys = pack.sections.map(s => s.key)
    expect(keys).toHaveLength(10)
    expect(keys).toContain('chapterGoal')
    expect(keys).toContain('outputConstraints')
    expect(keys).toContain('characters')
    expect(keys).toContain('knowledgeBounds')
    expect(keys).toContain('scene')
    expect(keys).toContain('plotLines')
    expect(keys).toContain('items')
    expect(keys).toContain('previousContext')
    expect(keys).toContain('worldRules')
    expect(keys).toContain('style')
    // 展示顺序按优先级升序：最高优先级在前
    const priorities = pack.sections.map(s => s.priority)
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities)
    expect(SECTION_PRIORITY.chapterGoal).toBeLessThan(SECTION_PRIORITY.style)
  })

  it('出场人物聚焦：只注入本章人物的状态，无关人物不占上下文', () => {
    const pack = buildChapterContextPack(params({
      focusCharacters: ['林轩'],
      canon: canon({
        characterStates: [
          state('林轩', 2, { powerLevel: '凝气三层' }),
          state('路人甲', 2, { powerLevel: '凡人' }),
          state('大反派', 1, { powerLevel: '化神期' }),
        ],
      }),
    }))
    const charSection = pack.sections.find(s => s.key === 'characters')!
    expect(charSection.items).toHaveLength(1)
    expect(charSection.items[0].title).toBe('林轩')
  })

  it('不同章节 / 不同剧情目标产生不同资料包指纹', () => {
    const a = buildChapterContextPack(params({ chapterNumber: 3, chapterGoal: '夺回玉简' }))
    const b = buildChapterContextPack(params({ chapterNumber: 3, chapterGoal: '与师姐决裂' }))
    const c = buildChapterContextPack(params({ chapterNumber: 4, chapterGoal: '夺回玉简' }))
    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(a.fingerprint).not.toBe(c.fingerprint)
  })

  it('场景缺失时明确提示，而不是编造一个场景', () => {
    const pack = buildChapterContextPack(params({ scene: undefined }))
    const notice = pack.notices.find(n => n.section === 'scene')
    expect(notice).toBeDefined()
    expect(notice!.kind).toBe('missing')
    expect(notice!.message).toContain('缺失')
  })

  it('场景未指定但人物有位置时，标注为推断值并提示确认', () => {
    const pack = buildChapterContextPack(params({
      focusCharacters: ['林轩'],
      canon: canon({ characterStates: [state('林轩', 2, { location: '后山' })] }),
    }))
    const scene = pack.sections.find(s => s.key === 'scene')!
    expect(scene.items[0].title).toContain('推断')
    expect(pack.notices.some(n => n.kind === 'missing' && n.section === 'scene')).toBe(true)
  })
})

describe('人物认知边界', () => {
  it('已知信息被注入，且明确标注「不知道 / 误解」缺失（不捏造）', () => {
    const pack = buildChapterContextPack(params({
      focusCharacters: ['林轩'],
      canon: canon({
        characterStates: [state('林轩', 2, { knowledge: ['西墙刻痕的来历', '玉佩会发光'] })],
      }),
    }))
    const bounds = pack.sections.find(s => s.key === 'knowledgeBounds')!
    expect(bounds.items).toHaveLength(1)
    expect(bounds.items[0].text).toContain('西墙刻痕的来历')
    expect(bounds.items[0].text).toContain('玉佩会发光')
    expect(bounds.items[0].text).toContain('未登记')
    expect(bounds.items[0].text).toContain('勿臆断')
  })

  it('没有已知信息时标注缺失并产生提示，不遗漏这一项', () => {
    const pack = buildChapterContextPack(params({
      focusCharacters: ['林轩'],
      canon: canon({ characterStates: [state('林轩', 2)] }),
    }))
    const bounds = pack.sections.find(s => s.key === 'knowledgeBounds')!
    expect(bounds.items[0].text).toContain('暂无已登记的已知信息')
    expect(pack.notices.some(n => n.section === 'knowledgeBounds' && n.kind === 'missing')).toBe(true)
  })
})

describe('上下文预算与截断记录', () => {
  it('预算充足时不裁剪', () => {
    const pack = buildChapterContextPack(params({
      inputTokens: 100000,
      chapterGoal: '目标',
      canon: canon({ characterStates: [state('林轩', 2, { powerLevel: 'A' })] }),
    }))
    expect(pack.budget.truncated).toBe(false)
    expect(pack.budget.droppedItems).toBe(0)
  })

  it('预算不足时按优先级保留高优先内容，并记录被省略的条目', () => {
    const manyStates = Array.from({ length: 40 }, (_, i) =>
      state(`角色${i}`, 2, { powerLevel: '凝气期'.repeat(30) }))
    const pack = buildChapterContextPack(params({
      inputTokens: 200,
      chapterGoal: '本章必须夺回玉简',
      wordTarget: 3000,
      canon: canon({
        characterStates: manyStates,
        globalGuidance: '文风要求'.repeat(200),
      }),
    }))

    expect(pack.budget.truncated).toBe(true)
    expect(pack.budget.droppedItems).toBeGreaterThan(0)
    expect(pack.notices.some(n => n.kind === 'truncated')).toBe(true)

    // 目标段优先级最高：预算再紧也不能被丢掉
    const goal = pack.sections.find(s => s.key === 'chapterGoal')!
    expect(goal.items.length).toBeGreaterThan(0)

    // 低优先级的文风段应首先被牺牲
    const style = pack.sections.find(s => s.key === 'style')!
    const chars = pack.sections.find(s => s.key === 'characters')!
    expect(style.items.length).toBeLessThanOrEqual(chars.items.length)
  })

  it('预算为 0 表示只统计不裁剪（不静默丢内容）', () => {
    const pack = buildChapterContextPack(params({
      inputTokens: 0,
      canon: canon({ characterStates: [state('林轩', 2, { powerLevel: '凝气三层' })] }),
    }))
    expect(pack.budget.truncated).toBe(false)
    expect(pack.budget.usedTokens).toBeGreaterThan(0)
  })
})

describe('作者要求与已确认设定冲突', () => {
  it('冲突时双方并列展示，不自动选边、不修改设定', () => {
    const pack = buildChapterContextPack(params({
      userGuidance: '本章不要让林轩使用玉佩',
      confirmedFacts: [fact('林轩使用玉佩击退了守墓人', 2, { confirmedAt: '2026-01-01' })],
    }))
    const conflict = pack.notices.find(n => n.kind === 'conflict')
    expect(conflict).toBeDefined()
    expect(conflict!.sides).toHaveLength(2)
    expect(conflict!.sides![0].label).toContain('作者要求')
    expect(conflict!.sides![1].text).toContain('林轩使用玉佩')
    expect(conflict!.message).toContain('决定')
  })

  it('未确认的 AI 事实不触发冲突提示（避免噪音）', () => {
    const pack = buildChapterContextPack(params({
      userGuidance: '本章不要让林轩使用玉佩',
      confirmedFacts: [fact('林轩使用玉佩击退了守墓人', 2, { confirmedAt: null })],
    }))
    expect(pack.notices.some(n => n.kind === 'conflict')).toBe(false)
  })

  it('没有否定线索时不误报冲突', () => {
    const pack = buildChapterContextPack(params({
      userGuidance: '本章重点描写林轩和玉佩的互动',
      confirmedFacts: [fact('林轩使用玉佩击退了守墓人', 2, { confirmedAt: '2026-01-01' })],
    }))
    expect(pack.notices.some(n => n.kind === 'conflict')).toBe(false)
  })
})

describe('过期判断：修改大纲/人物/要求后重新计算', () => {
  it('输入未变时不过期', () => {
    const p = params({ chapterGoal: '夺回玉简', focusCharacters: ['林轩'] })
    const pack = buildChapterContextPack(p)
    expect(isContextPackStale(pack, p)).toBe(false)
  })

  it('章节目标变化后判定为过期', () => {
    const pack = buildChapterContextPack(params({ chapterGoal: '夺回玉简' }))
    expect(isContextPackStale(pack, params({ chapterGoal: '与师姐决裂' }))).toBe(true)
  })

  it('人物状态推进后判定为过期', () => {
    const before = params({
      focusCharacters: ['林轩'],
      canon: canon({ characterStates: [state('林轩', 2)] }),
    })
    const pack = buildChapterContextPack(before)
    const after = params({
      focusCharacters: ['林轩'],
      canon: canon({ characterStates: [state('林轩', 3)] }),
    })
    expect(isContextPackStale(pack, after)).toBe(true)
  })

  it('作者要求变化后判定为过期', () => {
    const pack = buildChapterContextPack(params({ userGuidance: '节奏放慢' }))
    expect(isContextPackStale(pack, params({ userGuidance: '节奏加快' }))).toBe(true)
  })
})

describe('渲染与预览同源', () => {
  it('renderContextPack 输出的就是资料包本身的条目文本', () => {
    const pack = buildChapterContextPack(params({
      chapterGoal: '夺回玉简',
      focusCharacters: ['林轩'],
      canon: canon({ characterStates: [state('林轩', 2, { powerLevel: '凝气三层' })] }),
    }))
    const rendered = renderContextPack(pack)
    expect(rendered).toContain('夺回玉简')
    expect(rendered).toContain('凝气三层')
  })

  it('明细报告逐条给出选取理由与来源定位', () => {
    const pack = buildChapterContextPack(params({
      focusCharacters: ['林轩'],
      canon: canon({
        characterStates: [state('林轩', 2, { powerLevel: '凝气三层' })],
        timeline: [{
          chapterNumber: 2, sequence: 1, characters: ['林轩'], location: '后山',
          timeFlow: 'sequential', summary: '林轩得到玉简', impact: '获得关键道具',
        }],
      }),
    }))
    const report = buildSectionReport(pack)
    const charSection = report.find(s => s.key === 'characters')!
    expect(charSection.kept[0].reason).toContain('出场人物')
    expect(charSection.kept[0].origin).toContain('第 2 章')
    const prevSection = report.find(s => s.key === 'previousContext')!
    expect(prevSection.kept.some(i => i.origin.includes('第 2 章'))).toBe(true)
  })
})

describe('预览来自真正发送的最终请求', () => {
  it('未捕获请求时明确说明，而不是伪造一份展示文本', () => {
    const pack = buildChapterContextPack(params())
    const preview = buildChapterContextPreview(pack, undefined, 3)
    expect(preview.captured).toBe(false)
    expect(preview.messages).toHaveLength(0)
    expect(renderPreviewText(preview)).toContain('尚未捕获')
  })

  it('捕获到的首轮请求与发送内容逐字一致', () => {
    const context = {} as never
    clearLLMRequestSnapshots(context)
    const systemPrompt = '你是小说家'
    const userPrompt = '请写第 3 章：夺回玉简'
    recordLLMRequestSnapshot(context, {
      round: 0,
      purpose: 'generate_draft',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      thinking: false,
      maxTokens: 8000,
    })

    const pack = buildChapterContextPack(params({ chapterGoal: '夺回玉简' }))
    const preview = buildChapterContextPreview(pack, context, 3)

    expect(preview.captured).toBe(true)
    expect(preview.messages).toHaveLength(2)
    expect(preview.messages[0].role).toBe('system')
    expect(preview.messages[0].content).toBe(systemPrompt)
    expect(preview.messages[1].content).toBe(userPrompt)
    expect(preview.rounds).toHaveLength(1)
    expect(preview.rounds[0].purpose).toBe('generate_draft')
    expect(preview.requestTokens).toBeGreaterThan(0)
  })

  it('续写轮的真实请求（含 assistant 尾文与续写指令）也被完整捕获', () => {
    const context = {} as never
    clearLLMRequestSnapshots(context)
    recordLLMRequestSnapshot(context, {
      round: 0,
      purpose: 'generate_draft',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'prompt' },
      ],
      thinking: false,
    })
    recordLLMRequestSnapshot(context, {
      round: 1,
      purpose: 'generate_draft',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'prompt' },
        { role: 'assistant', content: '林轩推开石门，' },
        { role: 'user', content: '继续输出剩余内容。' },
      ],
      thinking: false,
    })

    const pack = buildChapterContextPack(params({ chapterGoal: '夺回玉简' }))
    const preview = buildChapterContextPreview(pack, context, 3)

    expect(preview.rounds).toHaveLength(2)
    expect(preview.messages).toHaveLength(6)
    const round1 = preview.messages.filter(m => m.round === 1)
    expect(round1.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(round1[2].content).toContain('林轩推开石门')
    expect(round1[3].content).toContain('继续输出剩余内容')

    const text = renderPreviewText(preview)
    expect(text).toContain('第 2 轮')
    expect(text).toContain('林轩推开石门')
  })

  it('预览统计的字数与 token 与消息内容一致', () => {
    const context = {} as never
    clearLLMRequestSnapshots(context)
    const content = '这是一段用于测试的正文内容。'
    recordLLMRequestSnapshot(context, {
      round: 0,
      purpose: 'generate_draft',
      messages: [{ role: 'user', content }],
      thinking: false,
    })
    const pack = buildChapterContextPack(params())
    const preview = buildChapterContextPreview(pack, context, 3)
    expect(preview.messages[0].chars).toBe(content.length)
    expect(preview.rounds[0].chars).toBe(content.length)
    expect(preview.requestTokens).toBe(preview.messages[0].tokens)
  })
})
