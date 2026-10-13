/**
 * 第二阶段：分层记忆与精准检索 — 质量测试
 *
 * 覆盖任务书第七节要求的 7 个场景：
 *   1. 检索很早以前出现、近期没有再次提及的人物
 *   2. 检索早期埋下、数百章后仍未回收的伏笔
 *   3. 同一物品在不同章节中的持有者变化
 *   4. 同一人物不同阶段的伤势、境界和身份
 *   5. 已被推翻的旧事实不会被当成当前事实
 *   6. 搜索结果可以回到正确原文
 *   7. 没有足够证据时明确提示未找到，不编造答案
 *
 * 同时验证第二阶段后端修复：
 *   - 事实段落定位（source_paragraph_index）确实落库
 *   - 角色状态历史链（canon_character_state_history）确实留痕
 *   - 检索结果填充 conflictsWith
 *   - 分卷（arc）纳入统一检索
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProjectDatabase, closeProjectDatabase, getProjectDb } from '../../../../electron/database'
import { CanonRepository } from '../../../../electron/repositories/canon-repository'
import type { CharacterStateSnapshot } from '../types'

function withTempDb(fn: () => void) {
  const dir = mkdtempSync(join(tmpdir(), 'vela-layered-memory-'))
  try {
    initProjectDatabase(dir)
    fn()
  } finally {
    closeProjectDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 构造一个角色状态快照 */
function state(character: string, patch: Partial<CharacterStateSnapshot>): CharacterStateSnapshot {
  return {
    character,
    location: '',
    powerLevel: '',
    physicalState: '',
    mentalState: '',
    keyItems: '',
    currentGoal: '',
    knowledge: [],
    relationships: {},
    recentEvents: '',
    updatedAtChapter: 0,
    updatedAt: new Date().toISOString(),
    ...patch,
  }
}

// ============================================================
// 1. 检索很早以前出现、近期没有再次提及的人物
// ============================================================
describe('1. 久远人物检索', () => {
  it('第 3 章出场、之后 300 章未再提及的人物仍可被检索到', () => {
    withTempDb(() => {
      // 第 3 章：苏婉出场
      CanonRepository.appendTimelineEvent({
        chapterNumber: 3, sequence: 1, characters: ['苏婉'], location: '青云山',
        timeFlow: 'sequential', summary: '苏婉将玉佩交给林轩', impact: '埋下伏笔',
      })
      CanonRepository.upsertCharacterState(state('苏婉', {
        location: '青云山', powerLevel: '练气三层', updatedAtChapter: 3,
      }))
      // 第 4~300 章：只有林轩，苏婉再未出现
      for (let ch = 4; ch <= 300; ch += 10) {
        CanonRepository.appendTimelineEvent({
          chapterNumber: ch, sequence: 1, characters: ['林轩'], location: `地点${ch}`,
          timeFlow: 'sequential', summary: `第${ch}章林轩的行动`, impact: '',
        })
      }

      const result = CanonRepository.searchCanon({ query: '苏婉' })

      expect(result.hits.length).toBeGreaterThan(0)
      // 命中应包含第 3 章的时间线事件（注意第 3 章可能同时有角色状态命中）
      const ch3 = result.hits.find(h => h.type === 'timeline' && h.chapterNumber === 3)
      expect(ch3).toBeDefined()
      // 命中原因应说明是角色关联
      expect(ch3?.matchReasons.some(r => r.includes('苏婉'))).toBe(true)
      // 角色状态也应命中
      expect(result.hits.some(h => h.type === 'character_state' && h.title === '苏婉')).toBe(true)
    })
  })
})

// ============================================================
// 2. 早期埋下、数百章后仍未回收的伏笔
// ============================================================
describe('2. 长期伏笔检索', () => {
  it('第 1 章埋下、第 200 章仍未回收的伏笔可被检索且标记为当前有效', () => {
    withTempDb(() => {
      CanonRepository.addPlotLine({
        name: '玉佩的来历', status: 'active', startedAt: 1, lastAdvancedAt: 1,
        characters: ['林轩'], currentState: '玉佩的来历仍是未解之谜',
        description: '第 1 章苏婉交给林轩的玉佩，来历不明', kind: 'foreshadow', plannedResolveAt: '',
      })
      // 填充后续章节摘要，制造"很久没提到"的假象
      for (let ch = 2; ch <= 200; ch += 20) {
        CanonRepository.upsertSummary({ chapterNumber: ch, title: `第${ch}章`, summary: `第${ch}章普通推进`, createdAt: new Date().toISOString() })
      }

      const result = CanonRepository.searchCanon({ query: '玉佩' })
      const hit = result.hits.find(h => h.type === 'plot_line')
      expect(hit).toBeDefined()
      expect(hit?.title).toBe('玉佩的来历')
      expect(hit?.isCurrent).toBe(true)
      expect(hit?.matchReasons).toContain('伏笔')
    })
  })
})

// ============================================================
// 3. 同一物品在不同章节中的持有者变化
// ============================================================
describe('3. 物品持有者变化', () => {
  it('同一物品的获得 / 转交 / 丢失按章节可追溯，丢失后不再视为当前持有', () => {
    withTempDb(() => {
      CanonRepository.addItemEvent({ item: '天命剑', action: 'obtained', chapterNumber: 5, actor: '林轩', note: '师父所赠' })
      CanonRepository.addItemEvent({ item: '天命剑', action: 'transferred', chapterNumber: 60, actor: '苏婉', note: '林轩托付给苏婉' })
      CanonRepository.addItemEvent({ item: '天命剑', action: 'lost', chapterNumber: 120, actor: '苏婉', note: '坠入深渊遗失' })

      // 直接读取：应按章节升序
      const events = CanonRepository.getItemEvents('天命剑')
      expect(events.map(e => e.chapterNumber)).toEqual([5, 60, 120])
      expect(events.map(e => e.actor)).toEqual(['林轩', '苏婉', '苏婉'])

      // 统一检索：应返回多条物品事件
      const result = CanonRepository.searchCanon({ query: '天命剑', item: '天命剑' })
      const itemHits = result.hits.filter(h => h.type === 'item_event')
      expect(itemHits.length).toBe(3)
      // 丢失事件不应被标记为"当前有效"
      const lost = itemHits.find(h => h.chapterNumber === 120)
      expect(lost?.isCurrent).toBe(false)
      const obtained = itemHits.find(h => h.chapterNumber === 5)
      expect(obtained?.isCurrent).toBe(true)
    })
  })
})

// ============================================================
// 4. 同一人物不同阶段的伤势、境界和身份
// ============================================================
describe('4. 人物多阶段状态', () => {
  it('写回留痕形成状态历史链，可按章节回溯任一阶段', () => {
    withTempDb(() => {
      // 第 10 章：重伤 · 练气
      CanonRepository.writebackAtomically({
        chapterNumber: 10, chapterContent: '林轩被击伤。',
        newEvents: [], plotLineChanges: { added: [] }, newFacts: [],
        characterDeltas: [{ character: '林轩', chapterNumber: 10, after: { physicalState: '重伤', powerLevel: '练气三层' } }],
      })
      // 第 50 章：痊愈 · 筑基
      CanonRepository.writebackAtomically({
        chapterNumber: 50, chapterContent: '林轩突破。',
        newEvents: [], plotLineChanges: { added: [] }, newFacts: [],
        characterDeltas: [{ character: '林轩', chapterNumber: 50, after: { physicalState: '痊愈', powerLevel: '筑基初期' } }],
      })
      // 第 90 章：化神
      CanonRepository.writebackAtomically({
        chapterNumber: 90, chapterContent: '林轩踏入化神。',
        newEvents: [], plotLineChanges: { added: [] }, newFacts: [],
        characterDeltas: [{ character: '林轩', chapterNumber: 90, after: { physicalState: '健康', powerLevel: '化神期' } }],
      })

      // 历史链留痕（不覆盖）
      const history = CanonRepository.getCharacterStateHistory('林轩')
      expect(history.map(h => h.chapterNumber)).toEqual([10, 50, 90])
      expect(history[0].snapshot.physicalState).toBe('重伤')
      expect(history[2].snapshot.powerLevel).toBe('化神期')

      // 按章节回溯历史状态
      expect(CanonRepository.getCharacterStateAtChapter('林轩', 30)?.physicalState).toBe('重伤')
      expect(CanonRepository.getCharacterStateAtChapter('林轩', 30)?.powerLevel).toBe('练气三层')
      expect(CanonRepository.getCharacterStateAtChapter('林轩', 200)?.powerLevel).toBe('化神期')

      // 统一检索（含历史）应能返回多个阶段
      const result = CanonRepository.searchCanon({
        query: '林轩', character: '林轩', includeHistorical: true, types: ['character_history'],
      })
      expect(result.hits.filter(h => h.type === 'character_history').length).toBe(3)
      // 当前状态只有最新一条
      const current = CanonRepository.searchCanon({ query: '林轩', character: '林轩', types: ['character_state'] })
      expect(current.hits.filter(h => h.type === 'character_state').length).toBe(1)
      expect(current.hits[0].snippet).toContain('化神期')
    })
  })

  it('重写同一章不会产生重复的状态历史（幂等）', () => {
    withTempDb(() => {
      for (let i = 0; i < 3; i++) {
        CanonRepository.writebackAtomically({
          chapterNumber: 20, chapterContent: '林轩受伤。',
          newEvents: [], plotLineChanges: { added: [] }, newFacts: [],
          characterDeltas: [{ character: '林轩', chapterNumber: 20, after: { physicalState: '重伤' } }],
        })
      }
      const history = CanonRepository.getCharacterStateHistory('林轩')
      expect(history.length).toBe(1)
    })
  })
})

// ============================================================
// 5. 已被推翻的旧事实不会被当成当前事实
// ============================================================
describe('5. 旧事实与冲突处理', () => {
  it('outdated 事实默认不返回；含历史时返回但标记为非当前', () => {
    withTempDb(() => {
      const oldId = CanonRepository.addFact({
        category: 'identity', statement: '林轩是青云门弟子', introducedAt: 5,
        characters: ['林轩'], evidence: '林轩拜入青云门', status: 'active',
      })
      CanonRepository.addFact({
        category: 'identity', statement: '林轩已脱离青云门', introducedAt: 90,
        characters: ['林轩'], evidence: '林轩离开青云门', status: 'active',
      })
      // 旧事实被推翻
      CanonRepository.markFactStatus(oldId, 'outdated')

      // 默认检索：不含 outdated
      const def = CanonRepository.searchCanon({ query: '青云门' })
      expect(def.hits.some(h => h.title === '林轩是青云门弟子')).toBe(false)

      // 含历史：返回，但 isCurrent=false
      const withHistory = CanonRepository.searchCanon({ query: '青云门', includeHistorical: true })
      const old = withHistory.hits.find(h => h.title === '林轩是青云门弟子')
      expect(old).toBeDefined()
      expect(old?.isCurrent).toBe(false)
    })
  })

  it('互相矛盾的两条事实会被标记为 conflicted 且检索结果填充 conflictsWith', () => {
    withTempDb(() => {
      const aId = CanonRepository.addFact({
        category: 'identity', statement: '林轩是青云门弟子', introducedAt: 5,
        characters: ['林轩'], evidence: '林轩拜入青云门', status: 'active',
      })
      const bId = CanonRepository.addFact({
        category: 'identity', statement: '林轩不是青云门弟子', introducedAt: 90,
        characters: ['林轩'], evidence: '林轩并非青云门人', status: 'active',
      })
      // 模拟写回时的冲突标记（两条都标 contradicted，不删除）
      CanonRepository.markFactStatus(aId, 'contradicted')
      CanonRepository.markFactStatus(bId, 'contradicted')

      const result = CanonRepository.searchCanon({ query: '青云门' })
      const a = result.hits.find(h => h.title === '林轩是青云门弟子')
      const b = result.hits.find(h => h.title === '林轩不是青云门弟子')
      expect(a).toBeDefined()
      expect(b).toBeDefined()
      // 冲突提示应互相指向
      expect(a?.conflictsWith?.some(s => s.includes('不是'))).toBe(true)
      expect(b?.conflictsWith?.some(s => s.includes('是青云门弟子'))).toBe(true)
      // 冲突事实被降权
      expect(a!.score).toBeLessThan(0.5)
    })
  })
})

// ============================================================
// 6. 搜索结果可以回到正确原文
// ============================================================
describe('6. 原文证据回溯', () => {
  it('事实写入时落库段落定位，检索结果可据此定位到原文章节段落', () => {
    withTempDb(() => {
      const paragraphs = [
        '夜色沉沉，青云山一片寂静。',
        '林轩独自站在山巅，回想师父的叮嘱。',
        '师父曾说：天命剑乃是青云门镇派之宝，绝不可落入外人之手。',
        '想到这里，林轩握紧了手中的天命剑。',
      ]
      const body = paragraphs.join('\n\n')

      // 造一份"已定稿"的正文
      const db = getProjectDb()!
      const contentId = Number(db.prepare(`INSERT INTO contents (body) VALUES (?)`).run(body).lastInsertRowid)
      db.prepare(`INSERT INTO drafts (chapter_number, version, status, source, content_id) VALUES (?, 1, 'finalized', 'write', ?)`).run(7, contentId)

      // 定稿写回：事实的 evidence 出现在第 3 段（index 2）
      CanonRepository.writebackAtomically({
        chapterNumber: 7,
        chapterContent: body,
        newEvents: [],
        plotLineChanges: { added: [] },
        characterDeltas: [],
        newFacts: [{
          category: 'world',
          statement: '天命剑是青云门镇派之宝',
          introducedAt: 7,
          characters: ['林轩'],
          evidence: '天命剑乃是青云门镇派之宝，绝不可落入外人之手',
          status: 'active',
        }],
      })

      // 事实应带上段落定位（第 3 段 → index 2）
      const fact = CanonRepository.getFacts().find(f => f.statement.includes('镇派之宝'))
      expect(fact).toBeDefined()
      expect(fact?.sourceParagraphIndex).toBe(2)

      // 检索结果应带 sourceLocation
      const result = CanonRepository.searchCanon({ query: '镇派之宝' })
      const hit = result.hits.find(h => h.type === 'fact' && h.title.includes('镇派之宝'))
      expect(hit?.sourceLocation).toEqual({ chapterNumber: 7, paragraphIndex: 2 })

      // 依据定位可取回正确原文段落
      const chapterParagraphs = CanonRepository.getChapterParagraphs(7)
      expect(chapterParagraphs[2]).toContain('天命剑乃是青云门镇派之宝')
    })
  })

  it('没有定稿正文时，原文查询返回空（不伪造原文）', () => {
    withTempDb(() => {
      expect(CanonRepository.getChapterParagraphs(999)).toEqual([])
    })
  })
})

// ============================================================
// 7. 没有足够证据时明确提示未找到，不编造答案
// ============================================================
describe('7. 证据不足', () => {
  it('查询完全不存在的关键词时返回空结果，不编造', () => {
    withTempDb(() => {
      CanonRepository.addFact({
        category: 'item', statement: '林轩获得天命剑', introducedAt: 5,
        characters: ['林轩'], evidence: '师父递给他一柄天命剑', status: 'active',
      })
      const result = CanonRepository.searchCanon({ query: '紫金葫芦与九转金丹' })
      expect(result.hits.length).toBe(0)
      expect(result.total).toBe(0)
      expect(result.degraded).toBe(false)
    })
  })

  it('空查询不返回任何命中', () => {
    withTempDb(() => {
      CanonRepository.addFact({
        category: 'item', statement: '林轩获得天命剑', introducedAt: 5,
        characters: ['林轩'], evidence: '师父递给他一柄天命剑', status: 'active',
      })
      const result = CanonRepository.searchCanon({ query: '   ' })
      // 空查询不产生关键词，所有分支都不命中
      expect(result.hits.length).toBe(0)
    })
  })
})

// ============================================================
// 附加：分卷（arc）纳入统一检索
// ============================================================
describe('8. 分卷检索', () => {
  it('分卷的主要矛盾可被检索到，并按章节范围命中', () => {
    withTempDb(() => {
      CanonRepository.upsertArc({
        title: '第一卷·风起青云', startChapter: 1, endChapter: 50,
        mainConflict: '林轩为师复仇', characterDevelopment: '林轩由懦弱走向坚韧',
        keyEvents: '拜入青云门、获得天命剑', stageGoal: '查明师父死因', sortOrder: 0,
      })

      const byKeyword = CanonRepository.searchCanon({ query: '复仇' })
      const arcHit = byKeyword.hits.find(h => h.type === 'arc')
      expect(arcHit).toBeDefined()
      expect(arcHit?.title).toBe('第一卷·风起青云')

      const byRange = CanonRepository.searchCanon({ query: '', chapterRange: { from: 10, to: 20 } })
      expect(byRange.hits.some(h => h.type === 'arc')).toBe(true)
    })
  })
})
