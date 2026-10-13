/**
 * 长篇记忆系统质量测试（Long-form Memory Quality Tests）
 *
 * 覆盖 8 大场景：
 *   1. 跨章检索：相隔数百章的事件仍能在相关章节中被正确检索
 *   2. 角色知识边界：角色不会知道自己尚未获知的秘密
 *   3. 已死亡角色不会无故复活
 *   4. 重要物品不会凭空出现、消失或转移所有者
 *   5. 已确认的世界规则不会被普通新稿覆盖
 *   6. 长期伏笔不会因为最近章节没有提到而被遗忘
 *   7. 修改历史章节后，能够识别可能受到影响的后续剧情
 *   8. 记忆提取失败时，不能静默把空结果当成成功
 *
 * 同时覆盖 P0-1 ~ P0-9 的修复验证。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../../../../electron/database'
import { CanonRepository } from '../../../../electron/repositories/canon-repository'
import {
  extractCanonWriteback,
  renderCanonContext,
  buildContextInjectionManifest,
  checkKnowledgeAuthorization,
  checkRewriteFactSafety,
  checkItemOwnership,
  validateChapter,
} from '../index'
import { makeState, makeCanon, makeTimeline, makePlotLines } from './fixtures'
import type { Fact, PlotLine } from '../types'

// ============================================================
// 辅助：创建临时数据库
// ============================================================
function withTempDb(fn: () => void) {
  const dir = mkdtempSync(join(tmpdir(), 'vela-memory-quality-'))
  try {
    initProjectDatabase(dir)
    fn()
  } finally {
    closeProjectDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// 1. 跨章检索：相隔数百章的事件仍能被正确检索
// ============================================================
describe('1. 跨章检索：早期事件在数百章后仍可检索', () => {
  it('第 5 章引入的事实，在第 300 章生成时仍出现在 canon facts 中', () => {
    withTempDb(() => {
      // 第 5 章定稿：引入一个关键事实
      const factId = CanonRepository.addFact({
        category: 'item',
        statement: '林轩获得天命剑',
        introducedAt: 5,
        characters: ['林轩'],
        evidence: '师父递给他一柄天命剑',
      })
      expect(factId).toBeGreaterThan(0)

      // 模拟之后多章定稿（用少量代表即可，验证 getFacts 不按章节截断）
      for (let ch = 6; ch <= 310; ch += 10) {
        CanonRepository.addFact({
          category: 'event',
          statement: `第${ch}章事件记录`,
          introducedAt: ch,
          characters: ['林轩'],
          evidence: `第${ch}章证据`,
        })
      }

      // 在第 300 章生成时，应能取到第 5 章的事实
      const allFacts = CanonRepository.getFacts()
      const earlyFact = allFacts.find(f => f.statement === '林轩获得天命剑')
      expect(earlyFact).toBeDefined()
      expect(earlyFact?.introducedAt).toBe(5)
    })
  })

  it('第 1 章的 timeline 事件在第 200 章生成时仍可通过 getTimelineUpTo 取到', () => {
    withTempDb(() => {
      CanonRepository.appendTimelineEvent({
        chapterNumber: 1,
        sequence: 1,
        characters: ['林轩'],
        location: '青云山',
        timeFlow: 'sequential',
        summary: '林轩拜入青云门',
        impact: '开启主线',
      })
      // 填充中间章节
      for (let ch = 2; ch <= 199; ch += 5) {
        CanonRepository.appendTimelineEvent({
          chapterNumber: ch,
          sequence: 1,
          characters: ['林轩'],
          location: `地点${ch}`,
          timeFlow: 'sequential' as const,
          summary: `第${ch}章事件`,
          impact: '',
        })
      }
      // 第 200 章获取时间线
      const timeline = CanonRepository.getTimelineUpTo(200)
      const firstEvent = timeline.find(e => e.chapterNumber === 1)
      expect(firstEvent).toBeDefined()
      expect(firstEvent?.summary).toBe('林轩拜入青云门')
    })
  })

  it('[P0-5] 早期关键事实不会被后期大量事实挤掉注入窗口', () => {
    // 验证 formatFacts 优先级排序：confirmed > active(近期) > contradicted > tentative
    // 即使有 40+ 条事实，confirmed 的早期事实也应出现在注入文本中
    const facts: Fact[] = [
      // 第 1 章确认过的关键事实
      { id: 1, category: 'world', statement: '天道轮回不可逆', introducedAt: 1, characters: [], evidence: '设定', status: 'active', confirmedAt: '2025-01-01T00:00:00Z' },
      // 第 2-50 章的普通事实（40+ 条，足以撑满注入窗口）
      ...Array.from({ length: 45 }, (_, i) => ({
        id: i + 2,
        category: 'event' as const,
        statement: `第${i + 2}章普通事件${i}`,
        introducedAt: i + 2,
        characters: ['林轩'],
        evidence: `证据${i}`,
        status: 'active' as const,
      })),
    ]

    const canon = makeCanon({ knownFacts: facts })
    const rendered = renderCanonContext(canon)

    // 已确认的早期事实应出现在注入文本中
    expect(rendered).toContain('天道轮回不可逆')
    expect(rendered).toContain('✅已确认')
  })
})

// ============================================================
// 2. 角色知识边界：角色不会知道自己尚未获知的秘密
// ============================================================
describe('2. 角色知识边界', () => {
  it('canon knowledge 列表中未记录的秘密信息应被检测为越权', () => {
    const state = makeState({
      character: '林轩',
      knowledge: ['师父被害'], // 林轩不知道"赵无极是幕后黑手"
    })
    const text = `林轩知道了赵无极是幕后黑手，怒不可遏。`
    const issues = checkKnowledgeAuthorization(text, [state])
    const knowledgeIssue = issues.find(i => i.category === 'knowledge')
    expect(knowledgeIssue).toBeDefined()
    expect(knowledgeIssue?.characters).toContain('林轩')
    expect(knowledgeIssue?.message).toContain('赵无极')
  })

  it('canon knowledge 列表中已有的信息不应被警告', () => {
    const state = makeState({
      character: '林轩',
      knowledge: ['师父被害', '赵无极是幕后黑手'],
    })
    const text = `林轩知道了赵无极是幕后黑手，心中愤恨。`
    const issues = checkKnowledgeAuthorization(text, [state])
    expect(issues.filter(i => i.category === 'knowledge')).toHaveLength(0)
  })

  it('[P0-1] extractCharacterDeltas 应提取角色获知的知识', () => {
    const chapterContent = `林轩在青云山与师父告别。

林轩离开青云山前往烈火宗。

林轩得知赵无极是幕后黑手，怒不可遏。

林轩意识到九转还魂丹是唯一能救师父的灵药。`

    const payload = extractCanonWriteback({
      chapterNumber: 5,
      chapterTitle: '第五章 真相',
      chapterContent,
      characters: [
        { name: '林轩', role: 'protagonist', currentState: { location: '青云山' } },
        { name: '师父', role: 'supporting', currentState: {} },
      ],
    })

    const linXuanDelta = payload.characterDeltas.find(d => d.character === '林轩')
    expect(linXuanDelta).toBeDefined()
    expect(linXuanDelta?.after.knowledge).toBeDefined()
    // 应至少提取到"赵无极是幕后黑手"或"九转还魂丹"相关知识
    expect(linXuanDelta?.after.knowledge!.length).toBeGreaterThan(0)
    const allKnowledge = linXuanDelta!.after.knowledge!.join(' ')
    expect(allKnowledge).toContain('赵无极')
    expect(allKnowledge).toContain('九转还魂丹')
  })

  it('[P0-1] extractCharacterDeltas 应提取角色目标和', () => {
    const chapterContent = `林轩决定前往烈火宗寻找师父的下落。

林轩在烈火宗门口等待。`

    const payload = extractCanonWriteback({
      chapterNumber: 3,
      chapterTitle: '第三章',
      chapterContent,
      characters: [
        { name: '林轩', role: 'protagonist', currentState: { location: '青云山' } },
      ],
    })

    const linXuanDelta = payload.characterDeltas.find(d => d.character === '林轩')
    expect(linXuanDelta).toBeDefined()
    expect(linXuanDelta?.after.currentGoal).toContain('烈火宗')
  })

  it('[P0-1] extractCharacterDeltas 应提取角色关系变化', () => {
    const chapterContent = `林轩与李四结为兄弟，共同对抗赵无极。

林轩在烈火宗与李四会合。`

    const payload = extractCanonWriteback({
      chapterNumber: 7,
      chapterTitle: '第七章',
      chapterContent,
      characters: [
        { name: '林轩', role: 'protagonist', currentState: {} },
        { name: '李四', role: 'supporting', currentState: {} },
      ],
    })

    const linXuanDelta = payload.characterDeltas.find(d => d.character === '林轩')
    expect(linXuanDelta).toBeDefined()
    expect(linXuanDelta?.after.relationships).toBeDefined()
    expect(linXuanDelta?.after.relationships?.['李四']).toBeTruthy()
  })
})

// ============================================================
// 3. 已死亡角色不会无故复活
// ============================================================
describe('3. 已死亡角色复活防护', () => {
  it('已死亡角色在 rewrite 中出现活跃行为应被检测为 error', () => {
    const canon = makeCanon({
      timeline: makeTimeline([{
        chapterNumber: 10,
        sequence: 1,
        summary: '师父在烈火宗之战中死亡',
        impact: '师父死亡',
        characters: ['师父'],
      }]),
    })
    const rewriteText = `师父笑着走进大殿，挥剑斩向敌人，说孩子们我回来了。`
    const issues = checkRewriteFactSafety(rewriteText, canon.timeline, canon.knownFacts)
    const issue = issues.find(i => i.severity === 'error')
    expect(issue).toBeDefined()
    expect(issue?.characters).toContain('师父')
  })

  it('闪回中的死亡角色不应被误报', () => {
    const canon = makeCanon({
      timeline: makeTimeline([{
        chapterNumber: 10,
        sequence: 1,
        summary: '师父死亡',
        characters: ['师父'],
      }]),
    })
    const text = `林轩回忆起师父教他剑法的那些日子，那时候师父挥剑斩向妖魔，英姿勃发。`
    const issues = checkRewriteFactSafety(text, canon.timeline, canon.knownFacts)
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('[P0-1] extractCharacterDeltas 使用多字死亡短语检测死亡状态', () => {
    // 测试各种死亡表达方式
    const deathPhrases = ['死亡', '牺牲', '身亡', '殒命', '毙命']
    for (const phrase of deathPhrases) {
      const content = `林轩在烈火宗与赵无极激战。

赵无极${phrase}，倒在地上。`

      const payload = extractCanonWriteback({
        chapterNumber: 15,
        chapterTitle: '第十五章',
        chapterContent: content,
        characters: [
          { name: '林轩', role: 'protagonist', currentState: {} },
          { name: '赵无极', role: 'antagonist', currentState: {} },
        ],
      })

      const zhaoDelta = payload.characterDeltas.find(d => d.character === '赵无极')
      expect(zhaoDelta).toBeDefined()
      expect(zhaoDelta?.after.physicalState).toContain('死亡')
    }
  })

  it('validateChapter 在 isRewrite 模式下应标记复活为 error', () => {
    const canon = makeCanon({
      timeline: makeTimeline([{
        chapterNumber: 1,
        sequence: 1,
        summary: '赵无极被林轩击杀',
        impact: '赵无极死亡',
        characters: ['赵无极'],
      }]),
    })
    const text = `赵无极从地下爬起来，冷笑道："你以为这样就能杀我？"`

    const issues = validateChapter({
      chapterNumber: 5,
      chapterContent: text,
      canon,
      isRewrite: true,
    })
    const errorIssue = issues.find(i => i.severity === 'error')
    expect(errorIssue).toBeDefined()
  })
})

// ============================================================
// 4. 重要物品不会凭空出现、消失或转移所有者
// ============================================================
describe('4. 物品归属与流转追踪', () => {
  it('canon 归属人正常使用物品不应触发警告', () => {
    const state = makeState({ character: '林轩', keyItems: '青虹剑' })
    const text = `林轩拿起青虹剑，朝敌人挥去。`
    const issues = checkItemOwnership(text, [state])
    expect(issues.filter(i => i.category === 'item' && i.severity === 'error')).toHaveLength(0)
  })

  it('他人使用 canon 归属物品应触发提示', () => {
    const state = makeState({ character: '林轩', keyItems: '青虹剑' })
    const text = `李四拿起青虹剑，朝敌人挥去。`
    const issues = checkItemOwnership(text, [state])
    const itemIssue = issues.find(i => i.category === 'item')
    expect(itemIssue).toBeDefined()
    expect(itemIssue?.characters).toContain('李四')
    expect(itemIssue?.characters).toContain('林轩')
  })

  it('[P0-9] extractFacts 应提取物品获得事实', () => {
    const content = `师父递给林轩一柄青虹剑。

林轩拿到青虹剑后大喜。`

    const payload = extractCanonWriteback({
      chapterNumber: 3,
      chapterTitle: '第三章',
      chapterContent: content,
      characters: [
        { name: '林轩', role: 'protagonist', currentState: {} },
        { name: '师父', role: 'supporting', currentState: {} },
      ],
    })

    const itemFacts = payload.newFacts.filter(f => f.category === 'item')
    expect(itemFacts.length).toBeGreaterThan(0)
    const allStatements = itemFacts.map(f => f.statement).join(' ')
    expect(allStatements).toContain('青虹剑')
  })

  it('SQLite 中 item events 能正确记录并查询物品流转', () => {
    withTempDb(() => {
      const id1 = CanonRepository.addItemEvent({
        item: '青虹剑',
        action: 'obtained',
        chapterNumber: 3,
        actor: '林轩',
        note: '师父赠予',
      })
      expect(id1).toBeGreaterThan(0)

      const id2 = CanonRepository.addItemEvent({
        item: '青虹剑',
        action: 'transferred',
        chapterNumber: 10,
        actor: '李四',
        note: '林轩交给李四使用',
      })
      expect(id2).toBeGreaterThan(0)

      const events = CanonRepository.getItemEvents()
      expect(events.length).toBeGreaterThanOrEqual(2)

      const swordEvents = events.filter(e => e.item === '青虹剑')
      expect(swordEvents.length).toBe(2)
      expect(swordEvents[0].action).toBe('obtained')
      expect(swordEvents[1].action).toBe('transferred')
    })
  })
})

// ============================================================
// 5. 已确认的世界规则不会被普通新稿覆盖
// ============================================================
describe('5. 世界规则保护', () => {
  it('[P0-9] extractFacts 应提取世界规则类事实', () => {
    const content = `只有持天命剑的人才能打开封印之门。

林轩在青云山修炼。

禁止凡人进入天机阁。

天机阁被魔族摧毁。`

    const payload = extractCanonWriteback({
      chapterNumber: 5,
      chapterTitle: '第五章',
      chapterContent: content,
      characters: [
        { name: '林轩', role: 'protagonist', currentState: {} },
      ],
    })

    const worldFacts = payload.newFacts.filter(f => f.category === 'world')
    expect(worldFacts.length).toBeGreaterThan(0)

    const allStatements = worldFacts.map(f => f.statement).join(' ')
    // 应至少匹配到"只有…才能"或"禁止"规则
    expect(allStatements.includes('只有') || allStatements.includes('禁止')).toBe(true)
  })

  it('[P0-5] confirmed 事实优先级高于 active 事实', () => {
    const facts: Fact[] = [
      // 第 1 章确认过的世界规则
      { id: 1, category: 'world', statement: '只有天命剑才能破开封印', introducedAt: 1, characters: [], evidence: '设定', status: 'active', confirmedAt: '2025-01-01T00:00:00Z' },
      // 第 50 章的未确认事实
      { id: 2, category: 'event', statement: '林轩击败赵无极', introducedAt: 50, characters: ['林轩'], evidence: '', status: 'active' },
    ]

    const canon = makeCanon({ knownFacts: facts })
    const rendered = renderCanonContext(canon)

    // 已确认的世界规则应在注入文本中出现
    expect(rendered).toContain('只有天命剑才能破开封印')
    expect(rendered).toContain('✅已确认')
  })

  it('[P0-5] contradicted 事实带标记注入，outdated 事实不注入', () => {
    const facts: Fact[] = [
      { id: 1, category: 'world', statement: '旧的错误规则', introducedAt: 1, characters: [], status: 'outdated' },
      { id: 2, category: 'world', statement: '有矛盾的世界规则', introducedAt: 5, characters: [], status: 'contradicted' },
      { id: 3, category: 'world', statement: '正常世界规则', introducedAt: 3, characters: [], status: 'active' },
    ]

    const canon = makeCanon({ knownFacts: facts })
    const rendered = renderCanonContext(canon)

    // outdated 不应出现
    expect(rendered).not.toContain('旧的错误规则')
    // contradicted 应出现但带标记
    expect(rendered).toContain('有矛盾的世界规则')
    expect(rendered).toContain('⚠️矛盾待确认')
    // active 正常出现
    expect(rendered).toContain('正常世界规则')
  })

  it('[P0-9] extractFacts 应提取事件结果类事实', () => {
    const content = `青云门被魔族摧毁，弟子四散奔逃。

林轩在青云山修炼。`

    const payload = extractCanonWriteback({
      chapterNumber: 20,
      chapterTitle: '第二十章',
      chapterContent: content,
      characters: [
        { name: '林轩', role: 'protagonist', currentState: {} },
      ],
    })

    const eventFacts = payload.newFacts.filter(f => f.category === 'event')
    expect(eventFacts.length).toBeGreaterThan(0)
    expect(eventFacts.some(f => f.statement.includes('摧毁'))).toBe(true)
  })
})

// ============================================================
// 6. 长期伏笔不会因近期未提及而被遗忘
// ============================================================
describe('6. 长期伏笔持久性', () => {
  it('getActivePlotLines 应返回所有 active 状态的伏笔（不论起始章节）', () => {
    withTempDb(() => {
      // 第 5 章埋下伏笔
      const foreshadowId = CanonRepository.addPlotLine({
        name: '神秘黑塔的秘密',
        status: 'active',
        startedAt: 5,
        lastAdvancedAt: 5,
        characters: ['林轩'],
        currentState: '林轩发现黑塔，但未探明',
        description: '黑塔内藏有上古秘密',
      })
      expect(foreshadowId).toBeGreaterThan(0)

      // 中间推进一些普通剧情线
      for (let ch = 10; ch <= 100; ch += 10) {
        CanonRepository.addPlotLine({
          name: `剧情线${ch}`,
          status: 'active',
          startedAt: ch,
          lastAdvancedAt: ch,
          characters: ['林轩'],
          currentState: `状态${ch}`,
          description: `描述${ch}`,
        })
      }

      // 第 100 章获取未结剧情线
      const activeLines = CanonRepository.getPlotLines({ status: 'active' })
      const earlyForeshadow = activeLines.find(l => l.name === '神秘黑塔的秘密')
      expect(earlyForeshadow).toBeDefined()
      expect(earlyForeshadow?.startedAt).toBe(5)
    })
  })

  it('formatOpenPlotLines 应标注伏笔类型和预计回收信息', () => {
    const plotLines: PlotLine[] = [
      {
        id: 1,
        name: '神秘黑塔的秘密',
        status: 'active',
        startedAt: 5,
        lastAdvancedAt: 5,
        characters: ['林轩'],
        currentState: '未探明',
        description: '黑塔内藏有上古秘密',
        kind: 'foreshadow',
        plannedResolveAt: '第三卷末',
      },
      {
        id: 2,
        name: '对抗赵无极',
        status: 'active',
        startedAt: 10,
        lastAdvancedAt: 15,
        characters: ['林轩'],
        currentState: '正在调查',
        description: '主线',
      },
    ]

    const canon = makeCanon({ openPlotLines: plotLines })
    const rendered = renderCanonContext(canon)

    // 伏笔应被标注
    expect(rendered).toContain('伏笔')
    expect(rendered).toContain('神秘黑塔的秘密')
    expect(rendered).toContain('预计回收：第三卷末')
    // 普通剧情线也应在
    expect(rendered).toContain('对抗赵无极')
  })

  it('renderCanonContext 注入伏笔不因其 introducedAt 过久而省略', () => {
    // 伏笔在第 1 章埋下，当前在第 200 章
    const plotLines: PlotLine[] = [
      {
        id: 1,
        name: '上古预言',
        status: 'active',
        startedAt: 1,
        lastAdvancedAt: 1,
        characters: ['林轩'],
        currentState: '尚未揭示',
        description: '一个上古预言',
        kind: 'foreshadow',
        plannedResolveAt: '最终章',
      },
    ]
    const canon = makeCanon({ openPlotLines: plotLines })
    canon.meta.chapterNumber = 200

    const rendered = renderCanonContext(canon)
    expect(rendered).toContain('上古预言')
    expect(rendered).toContain('伏笔')
  })
})

// ============================================================
// 7. 修改历史章节后，能够识别可能受到影响的后续剧情
// ============================================================
describe('7. 修改历史章节的影响分析', () => {
  it('[P0-4] recordFactUsage 用关键词匹配检测后续章节对早期事实的引用', () => {
    withTempDb(() => {
      // 第 5 章引入事实
      const factId = CanonRepository.addFact({
        category: 'item',
        statement: '林轩获得天命剑',
        introducedAt: 5,
        characters: ['林轩'],
        evidence: '师父递给他一柄天命剑',
      })

      // 第 30 章引用了这个事实（用同义表达，不是精确子串）
      const ch30Content = `林轩握着天命剑，朝魔族冲去。天命剑发出耀眼光芒。`
      const usageCount = CanonRepository.recordFactUsage(30, ch30Content)
      expect(usageCount).toBeGreaterThan(0)

      // 验证 usage 记录
      const usage = CanonRepository.getFactUsageByFact(factId)
      expect(usage.length).toBeGreaterThan(0)
      expect(usage.some(u => u.chapterNumber === 30)).toBe(true)
    })
  })

  it('[P0-4] recordFactUsage 角色名匹配策略对 identity 类事实生效', () => {
    withTempDb(() => {
      const factId = CanonRepository.addFact({
        category: 'identity',
        statement: '林轩是天命之子',
        introducedAt: 3,
        characters: ['林轩'],
        evidence: '天命之子',
      })

      // 后续章节提到林轩（但未精确引用"天命之子"）
      const content = `林轩站在山顶，俯瞰苍茫大地。`
      const count = CanonRepository.recordFactUsage(10, content)
      expect(count).toBeGreaterThan(0)

      const usage = CanonRepository.getFactUsageByFact(factId)
      expect(usage.some(u => u.chapterNumber === 10 && u.evidence.includes('角色名匹配'))).toBe(true)
    })
  })

  it('buildImpactReport 正确报告消失事实及其影响的后续章节', async () => {
    // 模拟：第 20 章重写后某事实消失，该事实之前被第 31、33 章引用
    const { buildImpactReport } = await import('../impact-analysis')
    const report = buildImpactReport({
      chapterNumber: 20,
      candidates: [{
        fact: { id: 1, category: 'item', statement: '林轩获得天命剑', introducedAt: 5, characters: ['林轩'] },
        usedBy: [
          { chapterNumber: 31, evidence: '天命剑' },
          { chapterNumber: 33, evidence: '天命剑' },
          { chapterNumber: 40, evidence: '天命剑' },
        ],
      }],
    })

    expect(report.items).toHaveLength(1)
    expect(report.items[0].statement).toBe('林轩获得天命剑')
    expect(report.items[0].affectedChapters).toEqual([31, 33, 40])
    expect(report.items[0].severity).toBe('high') // 3 章以上 = high
  })

  it('未被后续引用的事实不进入影响报告', async () => {
    const { buildImpactReport } = await import('../impact-analysis')
    const report = buildImpactReport({
      chapterNumber: 20,
      candidates: [{
        fact: { id: 1, category: 'item', statement: '只在本章出现的临时事件', introducedAt: 20, characters: [] },
        usedBy: [],
      }],
    })
    expect(report.items).toEqual([])
    expect(report.affectedChapterCount).toBe(0)
  })
})

// ============================================================
// 8. 记忆提取失败时，不能静默把空结果当成功
// ============================================================
describe('8. 记忆提取失败检测', () => {
  it('[P0-3] extractAndWriteback 提取结果全空时 ok=false', async () => {
    // 空内容 → 提取结果全空
    const fakeIpc = {
      async invoke(channel: string, ...args: unknown[]) {
        if (channel === 'db:canon-character-state-get') {
          return { character: args[0] as string, location: '', powerLevel: '', physicalState: '', mentalState: '', keyItems: '', currentGoal: '', knowledge: [], relationships: {}, recentEvents: '', updatedAtChapter: 0, updatedAt: '' }
        }
        if (channel === 'db:canon-summary-upsert') return { success: true }
        if (channel === 'db:canon-writeback-atomic') return { success: true }
        return { success: true }
      },
    }

    // 模块级单例无法直接注入 IPC，改为临时替换实例方法：
    // fact-extractor 内部调用 canonStore.writeback/getCharacterState，
    // 这里用 fake IPC 构造独立 CanonStore 并桥接其方法
    const canonStoreModule = await import('../canon-store')
    const { CanonStore } = canonStoreModule
    const store = new CanonStore(fakeIpc as never)
    const originalWriteback = canonStoreModule.canonStore.writeback
    const originalGetState = canonStoreModule.canonStore.getCharacterState
    canonStoreModule.canonStore.writeback = store.writeback.bind(store)
    canonStoreModule.canonStore.getCharacterState = store.getCharacterState.bind(store)

    // fact-extractor 的 extractAndWriteback 动态导入，避免顶层未使用告警
    const factExtractorModule = await import('../fact-extractor')

    try {
      // 直接测试 extractCanonWriteback 的空结果检测
      const payload = extractCanonWriteback({
        chapterNumber: 1,
        chapterTitle: '第一章',
        chapterContent: '',
        characters: [],
      })

      expect(payload.newEvents).toHaveLength(0)
      expect(payload.characterDeltas).toHaveLength(0)
      expect(payload.newFacts).toHaveLength(0)

      // extractAndWriteback 应把全空结果标记为 ok=false
      // 由于 canonStore 是模块级单例，我们检查返回结果中的 errors
      const result = await factExtractorModule.extractAndWriteback({
        chapterNumber: 1,
        chapterTitle: '第一章',
        chapterContent: '',
        characters: [],
      })

      // 即便底层 IPC 返回 success，空提取仍应被检测到
      expect(result.errors.some(e => e.includes('提取结果为空'))).toBe(true)
    } finally {
      canonStoreModule.canonStore.writeback = originalWriteback
      canonStoreModule.canonStore.getCharacterState = originalGetState
    }
  })

  it('[P0-3] 正常有内容的章节不应触发空提取警告', async () => {
    const chapterContent = `林轩在青云山与师父告别。师父递给他一柄青虹剑。

林轩离开青云山前往烈火宗。`

    const payload = extractCanonWriteback({
      chapterNumber: 5,
      chapterTitle: '第五章 告别',
      chapterContent,
      characters: [
        { name: '林轩', role: 'protagonist', currentState: { location: '青云山' } },
        { name: '师父', role: 'supporting', currentState: {} },
      ],
    })

    // 有内容的章节不应全空
    const isEmpty = payload.newEvents.length === 0
      && payload.characterDeltas.length === 0
      && payload.newFacts.length === 0
      && !payload.chapterSummary?.trim()

    expect(isEmpty).toBe(false)
    expect(payload.characterDeltas.length).toBeGreaterThan(0)
  })

  it('[P0-7] extractSummary 用关键词评分提取关键句', () => {
    const content = `林轩在青云山修炼剑法，日复一日。

师父给林轩讲解了剑道的奥义。

林轩突破了筑基期，进入金丹境。

林轩决定下山历练。`

    const payload = extractCanonWriteback({
      chapterNumber: 5,
      chapterTitle: '突破',
      chapterContent: content,
      characters: [
        { name: '林轩', role: 'protagonist', currentState: {} },
      ],
    })

    // 摘要应包含关键句（突破），而不是随机首末句
    expect(payload.chapterSummary).toContain('突破')
    // 摘要长度应在合理范围
    expect(payload.chapterSummary.length).toBeGreaterThan(10)
    expect(payload.chapterSummary.length).toBeLessThanOrEqual(500)
  })
})

// ============================================================
// 附加：P0-8 上下文注入清单测试
// ============================================================
describe('[P0-8] 上下文注入清单（ContextInjectionManifest）', () => {
  it('buildContextInjectionManifest 返回完整清单结构', () => {
    const facts: Fact[] = [
      { id: 1, category: 'world', statement: '规则A', introducedAt: 1, characters: [], status: 'active', confirmedAt: '2025-01-01' },
      { id: 2, category: 'event', statement: '事件B', introducedAt: 5, characters: ['林轩'], status: 'tentative' },
      { id: 3, category: 'item', statement: '物品C', introducedAt: 10, characters: ['林轩'], status: 'outdated' },
    ]

    const canon = makeCanon({
      knownFacts: facts,
      characterStates: [makeState({ character: '林轩' })],
      timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '事件A' }]),
      openPlotLines: makePlotLines([{ name: '主线' }]),
    })

    const manifest = buildContextInjectionManifest(canon)

    expect(manifest).toBeDefined()
    expect(manifest.chapterNumber).toBe(canon.meta.chapterNumber)
    expect(manifest.timelineInjected).toBe(1)
    expect(manifest.characterStatesInjected).toBe(1)
    expect(manifest.plotLinesInjected).toBe(1)
    // outdated 被排除，只注入 2 条
    expect(manifest.factsInjected).toBe(2)
    expect(manifest.factsExcluded).toBe(0) // 3 条可见，2 条注入，排除 0 条（未超 40 上限）
    // manifest 中应包含 confirmed 和 tentative 标记
    expect(manifest.factsManifest.some(f => f.confirmed)).toBe(true)
    expect(manifest.factsManifest.some(f => f.status === 'tentative')).toBe(true)
    // outdated 不应在 manifest 中
    expect(manifest.factsManifest.some(f => f.statement === '物品C')).toBe(false)
  })

  it('清单中 truncations 在事实超过 40 条上限时记录截断信息', () => {
    const facts: Fact[] = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      category: 'event' as const,
      statement: `事实${i}`,
      introducedAt: i + 1,
      characters: ['林轩'],
      status: 'active' as const,
    }))

    const canon = makeCanon({ knownFacts: facts })
    const manifest = buildContextInjectionManifest(canon)

    expect(manifest.factsInjected).toBe(40)
    expect(manifest.factsExcluded).toBe(10)
    expect(manifest.truncations.length).toBeGreaterThan(0)
    expect(manifest.truncations[0]).toContain('40')
  })

  it('renderCanonContext 注入文本与 manifest 一致', () => {
    const facts: Fact[] = [
      { id: 1, category: 'world', statement: '世界规则X', introducedAt: 1, characters: [], status: 'active' },
    ]

    const canon = makeCanon({ knownFacts: facts })
    const rendered = renderCanonContext(canon)
    const manifest = buildContextInjectionManifest(canon)

    // 注入文本中应包含 manifest 中记录的事实
    expect(rendered).toContain('世界规则X')
    expect(manifest.factsManifest.some(f => f.statement === '世界规则X')).toBe(true)
  })
})

// ============================================================
// 附加：闭环验证 — finalize → persist → retrieve → inject → update
// ============================================================
describe('闭环验证：定稿 → 持久化 → 检索 → 注入 → 更新', () => {
  it('完整闭环：第 N 章定稿数据在第 N+1 章生成时可检索并注入', () => {
    withTempDb(() => {
      // === Step 1: 模拟定稿 ===
      // 第 3 章定稿写回
      CanonRepository.upsertSummary({
        chapterNumber: 3,
        title: '烈火宗',
        summary: '林轩抵达烈火宗并发现赵无极线索。',
        createdAt: '2025-03-01T00:00:00Z',
      })

      CanonRepository.appendTimelineEvent({
        chapterNumber: 3,
        sequence: 1,
        characters: ['林轩'],
        location: '烈火宗',
        timeFlow: 'sequential',
        summary: '林轩抵达烈火宗',
        impact: '位置更新',
      })

      CanonRepository.upsertCharacterState({
        character: '林轩',
        location: '烈火宗',
        powerLevel: '筑基期',
        physicalState: '正常',
        mentalState: '警惕',
        keyItems: '青虹剑',
        currentGoal: '调查赵无极',
        knowledge: ['师父被害', '赵无极在烈火宗'],
        relationships: { 赵无极: '敌人' },
        recentEvents: '抵达烈火宗',
        updatedAtChapter: 3,
        updatedAt: '2025-03-01T00:00:00Z',
      })

      const factId = CanonRepository.addFact({
        category: 'item',
        statement: '林轩获得青虹剑',
        introducedAt: 3,
        characters: ['林轩'],
        evidence: '师父递给他一柄青虹剑',
      })
      expect(factId).toBeGreaterThan(0)

      // === Step 2: 验证持久化 ===
      const storedState = CanonRepository.getCharacterState('林轩')
      expect(storedState?.location).toBe('烈火宗')
      expect(storedState?.knowledge).toContain('赵无极在烈火宗')

      const storedFacts = CanonRepository.getFacts()
      expect(storedFacts.some(f => f.statement === '林轩获得青虹剑')).toBe(true)

      const storedTimeline = CanonRepository.getTimelineUpTo(3)
      expect(storedTimeline.some(e => e.summary === '林轩抵达烈火宗')).toBe(true)

      const storedSummary = CanonRepository.getRecentSummaries(1)
      expect(storedSummary.some(s => s.chapterNumber === 3)).toBe(true)

      // === Step 3: 验证检索结果可正确注入到第 4 章上下文 ===
      const canon = makeCanon({
        characterStates: [storedState!],
        timeline: storedTimeline,
        knownFacts: storedFacts,
        recentChapterSummaries: '上一章摘要：林轩抵达烈火宗并发现赵无极线索。',
      })

      const rendered = renderCanonContext(canon)
      // 注入文本应包含所有关键信息
      expect(rendered).toContain('烈火宗')
      expect(rendered).toContain('青虹剑')
      expect(rendered).toContain('赵无极在烈火宗')
      expect(rendered).toContain('林轩抵达烈火宗')

      // === Step 4: 验证 manifest 可正确记录注入信息 ===
      const manifest = buildContextInjectionManifest(canon)
      expect(manifest.factsInjected).toBeGreaterThan(0)
      expect(manifest.characterStatesInjected).toBe(1)
      expect(manifest.timelineInjected).toBeGreaterThan(0)
    })
  })

  it('[P0-4] 闭环中的事实引用记录：第 3 章的事实在第 5 章正文引用时被正确记录', () => {
    withTempDb(() => {
      // 第 3 章引入事实
      const factId = CanonRepository.addFact({
        category: 'item',
        statement: '林轩获得青虹剑',
        introducedAt: 3,
        characters: ['林轩'],
        evidence: '青虹剑',
      })

      // 第 5 章正文引用了青虹剑（但用不同表述）
      const ch5Content = `林轩拔出青虹剑，剑光如虹。

赵无极看到青虹剑，脸色骤变。`

      const usageCount = CanonRepository.recordFactUsage(5, ch5Content)
      expect(usageCount).toBeGreaterThan(0)

      // 后续如果重写第 3 章，可以通过 getFactUsageByFact 找到第 5 章受影响
      const usage = CanonRepository.getFactUsageByFact(factId)
      expect(usage.some(u => u.chapterNumber === 5)).toBe(true)
    })
  })
})
