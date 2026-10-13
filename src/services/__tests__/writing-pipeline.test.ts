/**
 * 写作流水线（第四阶段）—— 纯函数与状态机测试
 *
 * 对应需求「七、验收测试」中可在本地确定性验证的部分：
 *   3. 润色后剧情事实不变
 *   4. 分段生成不会重复大段前文
 *   5. 章节目标、场景目标和结尾目标能够检查
 *   6. 生成失败不会覆盖原文（结构保证）
 *   7. 修改大纲后可以重新规划尚未确认的部分
 * 另覆盖：字数口径、状态机合法性、前文接续、写作模式约束。
 */
import { describe, expect, it } from 'vitest'
import {
  MODE_POLICIES,
  allocateWordBudget,
  assertFactsUnchanged,
  buildChapterPlan,
  buildPrecedingText,
  buildSceneMessages,
  buildScenes,
  canTransition,
  chapterStats,
  checkGoals,
  composeConfirmedText,
  composeWorkingText,
  confirmSegment,
  countText,
  createSegment,
  detectPrecedingRepetition,
  needsReplan,
  outlineFingerprint,
  recoverInterrupted,
  replanUnconfirmed,
  revealedInfoOf,
  revertToConfirmed,
  stripLeadingTitle,
  suggestRevisionsLocal,
  transitionSegment,
  unfinishedSegments,
  type PipelineSegment,
  type PipelineState,
  type ScenePlan,
} from '../reconstruct/writing-pipeline'
import type { PlotBeat, PlotOutlineRecord } from '../../shared/reconstruct'
import type { ChapterContextPack } from '../workflows/chapter-context-pack'

// ============================================================
// 夹具
// ============================================================

function beat(sequence: number, overrides: Partial<PlotBeat> = {}): PlotBeat {
  return {
    sequence,
    title: `第 ${sequence} 段`,
    event: `事件${sequence}`,
    protagonistAction: `行动${sequence}`,
    conflict: `冲突${sequence}`,
    consequence: `后果${sequence}`,
    characterChange: `变化${sequence}`,
    hook: `钩子${sequence}`,
    ...overrides,
  }
}

function outline(overrides: Partial<PlotOutlineRecord> = {}): PlotOutlineRecord {
  return {
    id: 1,
    title: '炭笔',
    premise: '顾野在废土拿回炭笔',
    protagonistGoal: '拿回被老邵扣下的炭笔',
    centralConflict: '老邵不肯归还炭笔',
    characterChanges: '顾野从忍让转向强硬',
    foreshadowing: '炭笔的来历与血脉有关',
    continuityNotes: '上一章顾野刚在废土醒来',
    originalityNotes: '',
    techniques: [],
    beats: [beat(1), beat(2)],
    sources: [],
    status: 'confirmed',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

/** 造一个含 characters / previousContext 两段的资料包 */
function pack(overrides: { characters?: string[]; previousEnding?: string; sceneText?: string } = {}): ChapterContextPack {
  const characters = overrides.characters ?? ['顾野', '老邵']
  return {
    chapterNumber: 7,
    builtAt: '2026-01-01',
    fingerprint: 'pack-1',
    budget: { inputTokens: 0, usedTokens: 0, droppedItems: 0, truncated: false },
    notices: [],
    sections: [
      {
        key: 'characters', priority: 2, chars: 0, tokens: 0, dropped: 0, empty: false,
        items: characters.map((name, index) => ({
          id: `char:${name}`,
          title: name,
          text: `- ${name}（第6章状态）：地点：${index === 0 ? '废土暗袋' : '茶棚'} | 目标：${index === 0 ? '拿回炭笔' : '守住茶棚'}`,
          source: { character: name },
          priority: 2,
          reason: '本章出场人物',
          tokens: 0,
        })),
      },
      {
        key: 'previousContext', priority: 4, chars: 0, tokens: 0, dropped: 0, empty: false,
        items: [{
          id: 'prev:ending',
          title: '上一章结尾',
          text: `- 上一章结尾：${overrides.previousEnding ?? '顾野在废土醒来，手里攥着一支断掉的炭笔。'}`,
          source: { kind: 'previousEnding' },
          priority: 4,
          reason: '衔接上一章',
          tokens: 0,
        }],
      },
      ...(overrides.sceneText
        ? [{
            key: 'scene' as const, priority: 3, chars: 0, tokens: 0, dropped: 0, empty: false,
            items: [{ id: 'scene:1', title: '本章场景', text: overrides.sceneText, source: {}, priority: 3, reason: '作者指定', tokens: 0 }],
          }]
        : []),
    ],
  } as ChapterContextPack
}

function scenes(): ScenePlan[] {
  return buildScenes({ beats: [beat(1), beat(2)], contextPack: pack(), totalWords: 1600 })
}

/** 造一个分段（不依赖 scenes 夹具，便于构造任意序号的段落） */
function segmentWith(sequence: number, text: string, status: PipelineSegment['status'] = 'generated'): PipelineSegment {
  return {
    sequence,
    beatTitle: `第 ${sequence} 段`,
    status,
    text,
    confirmedText: '',
    stats: countText(text),
    updatedAt: '2026-01-01',
  }
}

// ============================================================
// 字数统计：口径必须明确
// ============================================================

describe('字数统计：总字符 / 汉字 / 含标点 / 去标题 分开算', () => {
  it('汉字数与总字符数分开统计，标点与空白不计入汉字', () => {
    const stats = countText('顾野，走了。')
    expect(stats.totalChars).toBe(6)          // 顾野，走了。 = 6 个字符
    expect(stats.chineseChars).toBe(4)        // 顾野走了
    expect(stats.withoutWhitespace).toBe(6)
  })

  it('空格与换行计入总字符但不计入汉字', () => {
    const stats = countText('顾野 走了\n了')
    expect(stats.chineseChars).toBe(5)
    expect(stats.totalChars).toBeGreaterThan(stats.chineseChars)
  })

  it('开头标题行单独算，去标题后字数不受标题影响', () => {
    const withTitle = '## 第七章 炭笔\n顾野走了。'
    const stats = countText(withTitle)
    expect(stripLeadingTitle(withTitle)).toBe('顾野走了。')
    expect(stats.chineseWithoutTitle).toBe(4)
    expect(stats.chineseChars).toBe(9)        // 含标题里的「第七章炭笔」
    expect(stats.withoutTitle).toBe(5)
  })

  it('「第 N 章」式标题同样被识别为标题行', () => {
    expect(stripLeadingTitle('第一章 开局\n正文开始')).toBe('正文开始')
  })
})

describe('字数分配：各场景之和等于目标，且不低于下限', () => {
  it('均分后总和与目标一致', () => {
    const budgets = allocateWordBudget(1600, 4)
    expect(budgets).toHaveLength(4)
    expect(budgets.reduce((a, b) => a + b, 0)).toBe(1600)
  })

  it('按权重分配，权重高的场景分到更多', () => {
    const budgets = allocateWordBudget(3000, 3, [1, 2, 3])
    expect(budgets[2]).toBeGreaterThan(budgets[0])
    expect(budgets.reduce((a, b) => a + b, 0)).toBe(3000)
  })

  it('目标过小时每个场景仍保底，不会分到 0 字', () => {
    const budgets = allocateWordBudget(100, 5, undefined, 200)
    expect(budgets.every(value => value >= 200)).toBe(true)
  })

  it('场景数为 0 时返回空数组', () => {
    expect(allocateWordBudget(1000, 0)).toEqual([])
  })
})

// ============================================================
// 第一步 / 第二步：理解任务与章节策划
// ============================================================

describe('章节策划：目标 / 开场 / 矛盾 / 人物驱动 / 事件顺序 / 结尾', () => {
  it('从大纲与资料包推导出完整策划', () => {
    const plan = buildChapterPlan({ outline: outline(), beats: outline().beats, contextPack: pack() })
    expect(plan.goal).toContain('炭笔')
    expect(plan.centralConflict).toBe('老邵不肯归还炭笔')
    expect(plan.openingState).toContain('废土')
    expect(plan.eventOrder).toHaveLength(2)
    expect(plan.eventOrder[0]).toContain('事件1')
    expect(plan.endingChange).toContain('忍让')
    expect(plan.endingRequirement).toBe('钩子2')
  })

  it('人物目标与阻碍从大纲和资料包汇总，主角用大纲的目标', () => {
    const plan = buildChapterPlan({ outline: outline(), beats: outline().beats, contextPack: pack() })
    const protagonist = plan.drives.find(drive => drive.character === '顾野')
    expect(protagonist?.goal).toContain('炭笔')
    const other = plan.drives.find(drive => drive.character === '老邵')
    expect(other?.goal).toContain('茶棚')
  })

  it('资料缺失时不编造，明确标注缺失', () => {
    const plan = buildChapterPlan({ outline: outline({ continuityNotes: '', foreshadowing: '' }), beats: [beat(1)] })
    expect(plan.openingState).toContain('未提供')
  })

  it('作者要求与大纲伏笔可能冲突时摆出双方，不自动选边', () => {
    const plan = buildChapterPlan({
      outline: outline(),
      beats: outline().beats,
      contextPack: pack(),
      userGuidance: '本章不要提炭笔的来历',
    })
    expect(plan.contradictions.length).toBeGreaterThan(0)
    expect(plan.contradictions[0]).toContain('请作者确认')
  })
})

// ============================================================
// 第三步：场景设计
// ============================================================

describe('场景设计：目的 / 时空 / 人物 / 冲突 / 揭示 / 转折 / 留问', () => {
  it('每个 beat 展开成一个场景，字段来自 beat 与资料包', () => {
    const list = buildScenes({ beats: [beat(1), beat(2)], contextPack: pack(), totalWords: 1600 })
    expect(list).toHaveLength(2)
    expect(list[0].purpose).toBe('事件1')
    expect(list[0].conflict).toBe('冲突1')
    expect(list[0].reveal).toBe('后果1')
    expect(list[0].turn).toBe('变化1')
    expect(list[0].openQuestion).toBe('钩子1')
    expect(list[0].characters).toContain('顾野')
  })

  it('作者指定了场景时空就用作者的，不标推断', () => {
    const list = buildScenes({
      beats: [beat(1)],
      contextPack: pack({ sceneText: '时间：深夜 | 地点：茶棚后院' }),
      totalWords: 800,
    })
    expect(list[0].time).toBe('深夜')
    expect(list[0].location).toBe('茶棚后院')
    expect(list[0].sceneInferred).toBe(false)
  })

  it('没有指定场景时从人物状态兜底，并明确标注为推断', () => {
    const list = buildScenes({ beats: [beat(1)], contextPack: pack(), totalWords: 800 })
    expect(list[0].location).toBe('废土暗袋')
    expect(list[0].sceneInferred).toBe(true)
  })

  it('场景字数由目标字数分配得出', () => {
    const list = buildScenes({ beats: [beat(1), beat(2)], contextPack: pack(), totalWords: 1600 })
    expect(list[0].targetWords + list[1].targetWords).toBe(1600)
  })
})

// ============================================================
// 第五步：分段状态机
// ============================================================

describe('分段状态机：待生成/生成中/已生成/待编辑/已确认/失败可重试', () => {
  it('合法迁移被接受', () => {
    expect(canTransition('pending', 'generating')).toBe(true)
    expect(canTransition('generating', 'generated')).toBe(true)
    expect(canTransition('generating', 'failed')).toBe(true)
    expect(canTransition('failed', 'generating')).toBe(true)
    expect(canTransition('generated', 'confirmed')).toBe(true)
    expect(canTransition('confirmed', 'editing')).toBe(true)
    expect(canTransition('editing', 'generating')).toBe(true)
  })

  it('非法迁移被拒绝，且不破坏原状态', () => {
    expect(canTransition('pending', 'confirmed')).toBe(false)
    expect(canTransition('confirmed', 'generating')).toBe(false)
    const segment = segmentWith(1, '正文')
    const attempted = transitionSegment({ ...segment, status: 'confirmed', confirmedText: '正文' }, 'pending')
    expect(attempted.status).toBe('confirmed')
  })

  it('已确认的正文必须先退回编辑态才能重新生成（防误点顶掉正文）', () => {
    const confirmed = { ...segmentWith(1, '作者确认的正文'), status: 'confirmed' as const, confirmedText: '作者确认的正文' }
    expect(transitionSegment(confirmed, 'generating').status).toBe('confirmed')
    const reopened = transitionSegment(confirmed, 'editing')
    expect(reopened.status).toBe('editing')
    expect(transitionSegment(reopened, 'generating').status).toBe('generating')
  })

  it('生成失败只写 error，text 与 confirmedText 一个字都不动（验收 6）', () => {
    const confirmed = confirmSegment(transitionSegment(
      transitionSegment(createSegment(scenes()[0]), 'generating'),
      'generated',
      { text: '作者确认的正文。' },
    ))
    const failed = transitionSegment(
      transitionSegment(transitionSegment(confirmed, 'editing'), 'generating'),
      'failed',
      { error: '模型超时' },
    )
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('模型超时')
    expect(failed.text).toBe('作者确认的正文。')
    expect(failed.confirmedText).toBe('作者确认的正文。')
  })

  it('确认采纳候选稿；放弃则退回已确认正文', () => {
    const confirmed = confirmSegment(transitionSegment(
      transitionSegment(createSegment(scenes()[0]), 'generating'),
      'generated',
      { text: '第一版。' },
    ))
    // 重新生成得到候选稿
    const candidate = transitionSegment(
      transitionSegment(transitionSegment(confirmed, 'editing'), 'generating'),
      'generated',
      { text: '第二版候选。' },
    )
    expect(candidate.text).toBe('第二版候选。')
    expect(candidate.confirmedText).toBe('第一版。')

    // 采纳
    expect(confirmSegment(candidate).confirmedText).toBe('第二版候选。')
    // 放弃
    const reverted = revertToConfirmed(candidate)
    expect(reverted.text).toBe('第一版。')
    expect(reverted.status).toBe('confirmed')
  })

  it('进程被杀留下的「生成中」重启后归位为「失败，可重试」', () => {
    const stuck = transitionSegment(createSegment(scenes()[0]), 'generating')
    const recovered = recoverInterrupted([stuck])
    expect(recovered[0].status).toBe('failed')
    expect(transitionSegment(recovered[0], 'generating').status).toBe('generating')
  })

  it('未完成段落 = 待生成 / 生成中 / 失败（用于恢复任务）', () => {
    const list: PipelineSegment[] = [
      segmentWith(1, 'a', 'confirmed'),
      segmentWith(2, 'b', 'generated'),
      segmentWith(3, '', 'pending'),
      segmentWith(4, '', 'failed'),
    ]
    expect(unfinishedSegments(list).map(item => item.sequence)).toEqual([3, 4])
  })
})

describe('临时文本与作者确认的正文严格区分', () => {
  it('只有确认过的文本进「正文」，临时稿不算', () => {
    const list: PipelineSegment[] = [
      { ...segmentWith(1, '第一段临时稿'), status: 'generated' },
      { ...segmentWith(2, '第二段已确认'), status: 'confirmed', confirmedText: '第二段已确认' },
    ]
    expect(composeConfirmedText(list)).toBe('第二段已确认')
    expect(composeWorkingText(list)).toContain('第一段临时稿')
    expect(composeWorkingText(list)).toContain('第二段已确认')
  })

  it('重写已确认段落时，旧确认稿仍留在正文里，不会凭空消失', () => {
    const confirmed = confirmSegment(transitionSegment(
      transitionSegment(createSegment(scenes()[0]), 'generating'),
      'generated',
      { text: '旧确认稿。' },
    ))
    const regenerated = transitionSegment(
      transitionSegment(transitionSegment(confirmed, 'editing'), 'generating'),
      'generated',
      { text: '新候选稿。' },
    )
    expect(composeConfirmedText([regenerated])).toBe('旧确认稿。')
  })

  it('全章字数按工作稿统计', () => {
    const list: PipelineSegment[] = [segmentWith(1, '顾野走了。'), segmentWith(2, '老邵点头。')]
    expect(chapterStats(list).chineseChars).toBe(8)
  })
})

// ============================================================
// 第四步：前文接续与重复检测
// ============================================================

describe('前文接续：用完整前文而不是上一段末尾', () => {
  it('取之前所有段落，而不是只取上一段', () => {
    const list: PipelineSegment[] = [
      segmentWith(1, '第一段的内容。'),
      segmentWith(2, '第二段的内容。'),
    ]
    const preceding = buildPrecedingText(list, 3)
    expect(preceding.text).toContain('第一段的内容。')
    expect(preceding.text).toContain('第二段的内容。')
    expect(preceding.truncated).toBe(false)
  })

  it('只取序号在前的段落，不把后面的段落当上下文', () => {
    const list: PipelineSegment[] = [segmentWith(1, '前文。'), segmentWith(3, '后面的内容。')]
    expect(buildPrecedingText(list, 2).text).toBe('前文。')
  })

  it('超预算时保留开头与最近部分，并明确标注省略了多少字（不静默丢）', () => {
    const long = '甲'.repeat(4000)
    const list: PipelineSegment[] = [segmentWith(1, long), segmentWith(2, long)]
    const preceding = buildPrecedingText(list, 3, 2000)
    expect(preceding.truncated).toBe(true)
    expect(preceding.omittedChars).toBeGreaterThan(0)
    expect(preceding.text).toContain('省略前文')
    expect(preceding.text.length).toBeLessThan(long.length * 2)
  })

  it('没有前文时返回空串，不抛错', () => {
    expect(buildPrecedingText([], 1).text).toBe('')
    expect(buildPrecedingText([segmentWith(1, '')], 2).text).toBe('')
  })
})

describe('重复检测：分段生成不会重复大段前文（验收 4）', () => {
  it('新段整段照抄前文时能检出', () => {
    const preceding = '顾野把炭笔收进暗袋，他记得师父说过纸骨认墨不认人，于是没有回头。'
    const generated = `顾野把炭笔收进暗袋，他记得师父说过纸骨认墨不认人，于是没有回头。`
    const found = detectPrecedingRepetition(generated, preceding)
    expect(found).not.toBeNull()
    expect(found!.length).toBeGreaterThanOrEqual(12)
  })

  it('正常接续（只是自然衔接）不会被误报', () => {
    const preceding = '顾野把炭笔收进暗袋，转身走进夜色。'
    const generated = '老邵没有拦他。茶棚的灯一盏盏灭了，风从门缝里灌进来。'
    expect(detectPrecedingRepetition(generated, preceding)).toBeNull()
  })

  it('没有前文时不报重复', () => {
    expect(detectPrecedingRepetition('随便写点什么内容在这里。', '')).toBeNull()
  })
})

describe('已交代信息：明确列出，避免不同场景重复交代', () => {
  it('只取本场景之前的场景所揭示的信息', () => {
    const list = scenes()
    const revealed = revealedInfoOf(list, 2)
    expect(revealed).toContain('后果1')
    expect(revealed).not.toContain('后果2')
  })
})

// ============================================================
// 写作模式
// ============================================================

describe('写作模式：七种模式各有约束', () => {
  const base = {
    plan: buildChapterPlan({ outline: outline(), beats: outline().beats, contextPack: pack() }),
    scene: scenes()[0],
    preceding: { text: '前文内容。', truncated: false, omittedChars: 0 },
    revealed: [],
    canonRendered: '【正史】顾野持有炭笔',
    ownNovel: '废土题材',
    targetWords: 800,
  }

  it('润色模式明确禁止增删事件与事实，且不得用同义词替换充数', () => {
    const messages = buildSceneMessages({ ...base, mode: 'polish', sourceText: '原文。' })
    const all = messages.map(message => message.content).join('\n')
    expect(all).toContain('不得增删任何事件')
    expect(all).toContain('同义词')
    expect(all).toContain('【待处理的原文】')
    expect(MODE_POLICIES.polish.keepFactsOnly).toBe(true)
    expect(MODE_POLICIES.polish.allowNewEvents).toBe(false)
  })

  it('续写模式要求严格承接、不复述', () => {
    const messages = buildSceneMessages({ ...base, mode: 'continue' })
    const all = messages.map(message => message.content).join('\n')
    expect(all).toContain('不复述')
    expect(MODE_POLICIES.continue.requiresPrecedingText).toBe(true)
  })

  it('扩写模式要求新增细节服务剧情、不得靠重复凑字数', () => {
    const messages = buildSceneMessages({ ...base, mode: 'expand', sourceText: '原文。' })
    const all = messages.map(message => message.content).join('\n')
    expect(all).toContain('不得靠重复内容凑字数')
    expect(all).toContain('不得新增事件')
  })

  it('提示词包含场景目的、完整前文、已交代信息、目标字数与文风', () => {
    const messages = buildSceneMessages({
      ...base,
      mode: 'outline-expand',
      revealed: ['后果1'],
      style: '冷峻克制',
      userGuidance: '本章要克制',
    })
    const all = messages.map(message => message.content).join('\n')
    expect(all).toContain('场景目的：事件1')
    expect(all).toContain('前文内容。')
    expect(all).toContain('不要重复交代')
    expect(all).toContain('约 800 字')
    expect(all).toContain('冷峻克制')
    expect(all).toContain('最高优先级')
  })

  it('七种模式都有对应策略，没有漏配', () => {
    for (const mode of ['outline-expand', 'auto-plan', 'continue', 'scene-only', 'rewrite', 'polish', 'expand'] as const) {
      expect(MODE_POLICIES[mode]).toBeDefined()
      expect(MODE_POLICIES[mode].rules.length).toBeGreaterThan(0)
    }
  })
})

// ============================================================
// 第五步：目标检查（验收 5）
// ============================================================

describe('章节目标 / 场景目标 / 结尾目标可检查（验收 5）', () => {
  // 用「描述性事件」而不是「事件1/事件2」：真实大纲里事件是具体句子，
  // 用同一批词（都含「事件」）会让覆盖度检查假通过，测不出问题。
  const RICH_BEATS: PlotBeat[] = [
    {
      sequence: 1, title: '废土醒来', event: '顾野在废土捡到一支炭笔',
      protagonistAction: '捡起炭笔', conflict: '老邵看见了', consequence: '老邵起了疑心',
      characterChange: '顾野决定藏起来', hook: '炭笔上有刻痕',
    },
    {
      sequence: 2, title: '茶棚争执', event: '老邵扣下炭笔不肯归还',
      protagonistAction: '要求归还', conflict: '老邵拒绝', consequence: '两人僵持',
      characterChange: '顾野变得强硬', hook: '老邵提到纸骨认墨不认人',
    },
  ]
  const richOutline = outline({ premise: '顾野在废土捡到一支炭笔', beats: RICH_BEATS })
  const richScenes = buildScenes({ beats: RICH_BEATS, contextPack: pack(), totalWords: 1600 })

  it('写到位时全部通过', () => {
    const segments: PipelineSegment[] = [
      segmentWith(1, '顾野在废土捡到一支炭笔。老邵看见了，老邵起了疑心。顾野决定藏起来，炭笔上有刻痕。'),
      segmentWith(2, '老邵扣下炭笔不肯归还。顾野要求归还，老邵拒绝，两人僵持。顾野变得强硬。老邵提到纸骨认墨不认人。'),
    ]
    const checks = checkGoals({
      plan: buildChapterPlan({ outline: richOutline, beats: RICH_BEATS, contextPack: pack() }),
      scenes: richScenes,
      segments,
      targetWords: 40,
    })
    const byKey = new Map(checks.map(check => [check.key, check]))
    expect(byKey.get('goal')!.ok).toBe(true)
    expect(byKey.get('scene')!.ok).toBe(true)
    expect(byKey.get('must-event')!.ok).toBe(true)
    expect(byKey.get('ending')!.ok).toBe(true)
    expect(byKey.get('repetition')!.ok).toBe(true)
    expect(byKey.get('word-budget')!.ok).toBe(true)
  })

  it('漏写场景目的与必要事件时能指出来', () => {
    const checks = checkGoals({
      plan: buildChapterPlan({ outline: richOutline, beats: RICH_BEATS, contextPack: pack() }),
      scenes: richScenes,
      segments: [
        segmentWith(1, '顾野在废土捡到一支炭笔。'),
        segmentWith(2, '毫不相干的风景描写，没有推进任何剧情。'),
      ],
      targetWords: 800,
    })
    const byKey = new Map(checks.map(check => [check.key, check]))
    expect(byKey.get('scene')!.ok).toBe(false)
    expect(byKey.get('scene')!.detail).toContain('第 2 段')
    expect(byKey.get('must-event')!.ok).toBe(false)
    expect(byKey.get('must-event')!.detail).toContain('老邵扣下炭笔不肯归还')
  })

  it('场景目标按该场景自己那一段判断，不被别段写过的词凑数', () => {
    // 第 1 段把两个场景的词都写了，第 2 段完全没写 → 第 2 段仍须判为未写到位
    const checks = checkGoals({
      plan: buildChapterPlan({ outline: richOutline, beats: RICH_BEATS, contextPack: pack() }),
      scenes: richScenes,
      segments: [
        segmentWith(1, '顾野在废土捡到一支炭笔，老邵扣下炭笔不肯归还。'),
        segmentWith(2, '与剧情无关的段落。'),
      ],
      targetWords: 800,
    })
    const scene = checks.find(check => check.key === 'scene')!
    expect(scene.ok).toBe(false)
    expect(scene.detail).toContain('第 2 段')
  })

  it('字数不足时给出实际汉字数与占比，不谎称满足', () => {
    const checks = checkGoals({
      plan: buildChapterPlan({ outline: outline(), beats: [beat(1)] }),
      scenes: [scenes()[0]],
      segments: [segmentWith(1, '很短。')],
      targetWords: 3000,
    })
    const wordCheck = checks.find(check => check.key === 'word-budget')!
    expect(wordCheck.ok).toBe(false)
    expect(wordCheck.detail).toContain('汉字 2 字')
    expect(wordCheck.detail).toContain('目标 3000 字')
  })

  it('大纲没给结尾要求时不算通过，明确说明无法检查', () => {
    const checks = checkGoals({
      plan: { ...buildChapterPlan({ outline: outline(), beats: [beat(1)] }), endingRequirement: '' },
      scenes: [scenes()[0]],
      segments: [segmentWith(1, '事件1')],
      targetWords: 10,
    })
    const ending = checks.find(check => check.key === 'ending')!
    expect(ending.detail).toContain('无法检查')
  })

  it('段间大段重复会被检查项捕获', () => {
    const repeated = '顾野把炭笔收进暗袋，他记得师父说过纸骨认墨不认人，于是没有回头。'
    const checks = checkGoals({
      plan: buildChapterPlan({ outline: outline(), beats: [beat(1), beat(2)] }),
      scenes: scenes(),
      segments: [segmentWith(1, repeated), segmentWith(2, repeated)],
      targetWords: 10,
    })
    const repetition = checks.find(check => check.key === 'repetition')!
    expect(repetition.ok).toBe(false)
    expect(repetition.detail).toContain('与前文重复')
  })
})

// ============================================================
// 第六步：编辑修订建议
// ============================================================

describe('编辑修订：定位薄弱段落并给出位置与理由', () => {
  const list = scenes()
  const plan = buildChapterPlan({ outline: outline(), beats: outline().beats, contextPack: pack() })

  it('整段没有对话且很长时给出建议', () => {
    const long = '事件1的发生过程被详细描述，'.repeat(40)
    const suggestions = suggestRevisionsLocal({ segments: [segmentWith(1, long)], scenes: list, plan })
    expect(suggestions.some(item => item.reason.includes('对话'))).toBe(true)
    expect(suggestions[0].suggestion).toBeTruthy()
  })

  it('套话与段尾总结能被定位到具体字符区间', () => {
    const text = '顾野走了很久，仿佛有什么东西在等着他。这一切都结束了。'
    const suggestions = suggestRevisionsLocal({ segments: [segmentWith(1, text)], scenes: list, plan })
    const cliche = suggestions.find(item => item.reason.includes('仿佛'))
    expect(cliche).toBeDefined()
    expect(cliche!.excerpt).toContain('仿佛')
    const summary = suggestions.find(item => item.reason.includes('总结式'))
    expect(summary).toBeDefined()
  })

  it('场景目的覆盖不足时提示检查这一段', () => {
    const suggestions = suggestRevisionsLocal({
      segments: [segmentWith(1, '毫不相干的内容，只是风景描写。')],
      scenes: list,
      plan,
    })
    expect(suggestions.some(item => item.reason.includes('场景目的'))).toBe(true)
  })

  it('只给建议，不返回任何改写后的正文（不自动改稿）', () => {
    const suggestions = suggestRevisionsLocal({ segments: [segmentWith(1, '仿佛一切都不一样了。')], scenes: list, plan })
    for (const item of suggestions) {
      expect(item).not.toHaveProperty('rewritten')
      expect(typeof item.suggestion).toBe('string')
    }
  })

  it('段落干净时不给无意义建议', () => {
    const clean = '「事件1，你拿不走。」老邵说。顾野没答话，伸手把炭笔推了回去。'
    const suggestions = suggestRevisionsLocal({ segments: [segmentWith(1, clean)], scenes: list, plan })
    expect(suggestions.filter(item => item.sequence === 1)).toEqual([])
  })
})

// ============================================================
// 润色：剧情事实不变（验收 3）
// ============================================================

describe('润色后剧情事实不变（验收 3）', () => {
  // 同一场戏的「润色前 / 润色后」：改了措辞（把→将、收进→塞进、了→（删）），事件本身没变
  const POLISH_BEFORE = `顾野把炭笔收进暗袋，转身走出茶棚。老邵在身后喊了一声，他没有回头。
夜风里全是铁锈味。顾野蹲在墙根，把炭笔拿出来看了看，笔杆上有一道浅浅的刻痕，像是被人用指甲划过。
老邵追了出来，一把抓住他的手腕，说这支笔不能带走。顾野没有挣开，只是把炭笔攥得更紧。
两人在巷口僵持了很久。最后老邵松了手，说了一句纸骨认墨不认人，转身回了茶棚。`
  const POLISH_AFTER = `顾野将炭笔塞进暗袋，转身走出茶棚。老邵在身后喊了一声，他没回头。
夜风里满是铁锈味。顾野蹲在墙根，取出炭笔端详，笔杆上有一道浅刻痕，像被人用指甲划过。
老邵追出来，抓住他的手腕，说这支笔不能带走。顾野没挣开，只把炭笔攥得更紧。
两人在巷口僵持许久。末了老邵松手，说了句纸骨认墨不认人，转身回了茶棚。`
  const CAST = ['顾野', '老邵']

  it('只改表达、事件与事实都没变时判定为通过', () => {
    const drift = assertFactsUnchanged(POLISH_BEFORE, POLISH_AFTER, CAST)
    expect(drift.verifiable).toBe(true)
    expect(drift.addedEvents).toEqual([])
    expect(drift.removedEvents).toEqual([])
    expect(drift.addedFacts).toEqual([])
    expect(drift.removedFacts).toEqual([])
    expect(drift.ok).toBe(true)
  })

  it('润色时偷偷加了新事件会被报出来', () => {
    const after = `${POLISH_AFTER}\n顾野抽出短刀，一刀斩断了茶棚的门闩，血溅在墙上。`
    const drift = assertFactsUnchanged(POLISH_BEFORE, after, CAST)
    expect(drift.ok).toBe(false)
    expect(drift.addedEvents.length).toBeGreaterThan(0)
    expect(drift.note).toContain('作者确认')
  })

  it('润色时删掉原有事件同样会被报出来', () => {
    const after = `顾野将炭笔塞进暗袋，转身走出茶棚。老邵在身后喊了一声，他没回头。`
    const drift = assertFactsUnchanged(POLISH_BEFORE, after, CAST)
    expect(drift.ok).toBe(false)
    expect(drift.removedEvents.length).toBeGreaterThan(0)
  })

  it('篇幅剧变会被提示（可能不是润色而是改写）', () => {
    const after = `${POLISH_AFTER}${'他又走了很久，很久，很久。'.repeat(20)}`
    const drift = assertFactsUnchanged(POLISH_BEFORE, after, CAST)
    expect(Math.abs(drift.lengthDeltaRatio)).toBeGreaterThan(0.4)
    expect(drift.note).toContain('篇幅变化')
  })

  it('提取不到事实时如实说明「无法确认」，不谎报通过', () => {
    const drift = assertFactsUnchanged('很短。', '也很短。', CAST)
    expect(drift.verifiable).toBe(false)
    expect(drift.note).toContain('无法确认')
  })
})

// ============================================================
// 大纲变更与重规划（验收 7）
// ============================================================

describe('修改大纲后可以重新规划尚未确认的部分（验收 7）', () => {
  it('大纲内容变化时指纹变化，触发重规划', () => {
    const state: PipelineState = {
      chapterNumber: 7,
      outlineId: 1,
      outlineFingerprint: outlineFingerprint(outline()),
      plan: buildChapterPlan({ outline: outline(), beats: outline().beats }),
      scenes: scenes(),
      segments: [],
      targetWords: 1600,
      mode: 'outline-expand',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    expect(needsReplan(state, outline())).toBe(false)
    expect(needsReplan(state, outline({ premise: '改成另一个故事' }))).toBe(true)
  })

  it('重规划保留已确认段落，只重置未确认的', () => {
    const state: PipelineState = {
      chapterNumber: 7,
      outlineId: 1,
      outlineFingerprint: 'old',
      plan: buildChapterPlan({ outline: outline(), beats: outline().beats }),
      scenes: scenes(),
      segments: [
        { ...segmentWith(1, '第一段已确认'), status: 'confirmed', confirmedText: '第一段已确认' },
        { ...segmentWith(2, '第二段临时稿'), status: 'generated' },
      ],
      targetWords: 1600,
      mode: 'outline-expand',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    const result = replanUnconfirmed(state, outline({ premise: '新前提' }), [beat(1), beat(2), beat(3)], pack())
    expect(result.kept.map(item => item.sequence)).toEqual([1])
    expect(result.resetSequences).toEqual([2])
    expect(result.scenes).toHaveLength(3)          // 按新大纲重新设计场景
    expect(result.outlineFingerprint).toBe(outlineFingerprint(outline({ premise: '新前提' })))
  })
})
