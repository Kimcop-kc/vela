/**
 * 评审复核回归测试（review-fixes）
 *
 * 固化三处曾被外部评审指出、且已实测复现并修复的问题，防止回归：
 *
 *   1. 「章节要点」路径产出的 CharacterStateDelta 缺少 knowledge，
 *      导致知识越权校验在要点路径下永远拿不到数据（P0-1 只完成了一半）。
 *   2. conflictsWith 要求任一方已是 contradicted 才标注，
 *      而 AI 提取的事实默认是 tentative → 两条待确认事实互相矛盾时标注不出来。
 *   3. chapterRange 对剧情线命中不生效，限定 1-5 章仍会混进第 7 章的剧情线。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../../../electron/database'
import { CanonRepository } from '../../../electron/repositories/canon-repository'
import { extractCanonWriteback } from '../narrative-consistency'

function withTempDb(fn: () => void) {
  const dir = mkdtempSync(join(tmpdir(), 'vela-review-fixes-'))
  try {
    initProjectDatabase(dir)
    fn()
  } finally {
    closeProjectDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('修复 1：要点路径补齐 knowledge', () => {
  const CONTENT = '林轩在西墙边停下脚步。'
  const characters = [{ name: '林轩', role: 'protagonist' as const, currentState: {} }]

  it('要点表格含知识线索时，knowledge 应被填上', () => {
    const payload = extractCanonWriteback({
      chapterNumber: 1,
      chapterTitle: '第一章',
      chapterContent: CONTENT,
      characters,
      existingNotes: `# 角色动态
| 角色 | 状态 |
| --- | --- |
| 林轩 | 得知西墙刻痕的来历；在西墙边停下 |`,
    })
    const knowledge = payload.characterDeltas[0]?.after.knowledge ?? []
    expect(knowledge.length).toBeGreaterThan(0)
    expect(knowledge.join('')).toContain('西墙刻痕')
  })

  it('无知识线索时不硬造 knowledge', () => {
    const payload = extractCanonWriteback({
      chapterNumber: 1,
      chapterTitle: '第一章',
      chapterContent: CONTENT,
      characters,
      existingNotes: `# 角色动态
| 角色 | 状态 |
| --- | --- |
| 林轩 | 在西墙边停下脚步 |`,
    })
    expect(payload.characterDeltas[0]?.after.knowledge ?? undefined).toBeUndefined()
  })

  it('正文有知识而有效要点只有位置时，正文知识不会丢失', () => {
    const payload = extractCanonWriteback({
      chapterNumber: 1,
      chapterTitle: '第一章',
      chapterContent: '林轩知道了西墙刻痕的来历是一段被抹去的血脉。林轩在西墙边停下。',
      characters,
      existingNotes: `# 角色动态
| 角色 | 状态 |
| --- | --- |
| 林轩 | 在西墙边停下脚步 |`,
    })
    expect(payload.characterDeltas).toHaveLength(1)
    expect(payload.characterDeltas[0].after.knowledge?.join('')).toContain('西墙刻痕的来历')
    expect(payload.characterDeltas[0].after.recentEvents).toBe('在西墙边停下脚步')
    expect(payload.characterDeltas[0].after.location).toBe('西墙边停下')
  })

  it('无要点时（启发式路径）knowledge 仍然可用，未被改动破坏', () => {
    const payload = extractCanonWriteback({
      chapterNumber: 1,
      chapterTitle: '第一章',
      chapterContent: '林轩在西墙边停下。林轩知道了西墙刻痕的来历是一段被抹去的血脉。',
      characters,
    })
    expect((payload.characterDeltas[0]?.after.knowledge ?? []).length).toBeGreaterThan(0)
  })

  it('原始复现场景：要点只写位置、正文写了获知 → 两边合并后知识不丢', () => {
    // 这正是外部评审复现的缺陷：主路径（有要点）下知识恒为空。
    // 要点表格只记了「在西墙边停下」，没写「得知」；知识只能从正文拿到，
    // 合并逻辑必须让正文的 knowledge 与要点的位置信息同时保留。
    const payload = extractCanonWriteback({
      chapterNumber: 1,
      chapterTitle: '第一章',
      chapterContent: '林轩在西墙边停下。林轩知道了西墙刻痕的来历是一段被抹去的血脉。',
      characters,
      existingNotes: `# 角色动态
| 角色 | 状态 |
| --- | --- |
| 林轩 | 在西墙边停下脚步 |`,
    })
    const delta = payload.characterDeltas[0]
    const knowledge = delta?.after.knowledge ?? []

    // 知识来自正文，不能被「有要点」这条路径吞掉
    expect(knowledge.length).toBeGreaterThan(0)
    expect(knowledge.join('')).toContain('西墙刻痕')
    // 同时要点里的状态信息也要保留
    expect(delta?.after.recentEvents ?? '').toContain('西墙')
  })

  it('正文与要点都给了知识时取并集，不互相覆盖', () => {
    const payload = extractCanonWriteback({
      chapterNumber: 1,
      chapterTitle: '第一章',
      chapterContent: '林轩在西墙边停下。林轩知道了西墙刻痕的来历是一段被抹去的血脉。',
      characters,
      existingNotes: `# 角色动态
| 角色 | 状态 |
| --- | --- |
| 林轩 | 得知周家的布防图已到手 |`,
    })
    const knowledge = (payload.characterDeltas[0]?.after.knowledge ?? []).join('；')

    expect(knowledge).toContain('西墙刻痕')
    expect(knowledge).toContain('布防图')
  })

  it('已知局限：正文只用代词（“他知道了…”）时，启发式提取不到 knowledge', () => {
    // 记录当前限制，避免以后误以为「正文知识一定会被提取」。
    // knowledge 启发式要求角色名紧跟知识动词；正文用代词时提取不到，
    // 这类信息需要作者在章节要点里写明（要点路径会正常提取）。
    const payload = extractCanonWriteback({
      chapterNumber: 1,
      chapterTitle: '第一章',
      chapterContent: '林轩在西墙边停下。他知道了西墙刻痕的来历是一段被抹去的血脉。',
      characters,
    })
    expect(payload.characterDeltas[0]?.after.knowledge ?? undefined).toBeUndefined()
  })
})

describe('修复 2：两条 tentative 事实互相矛盾时标注 conflictsWith', () => {
  it('默认状态下（双方均为 tentative）也应互相标注', () => {
    withTempDb(() => {
      CanonRepository.addFact({
        category: 'item', statement: '青虹剑在林轩手中',
        introducedAt: 1, characters: ['林轩'], status: 'tentative',
      } as never)
      CanonRepository.addFact({
        category: 'item', statement: '青虹剑不在林轩手中',
        introducedAt: 5, characters: ['林轩'], status: 'tentative',
      } as never)

      const result = CanonRepository.searchCanon({
        query: '青虹剑', includeHistorical: true,
      } as never)
      const facts = result.hits.filter(h => h.type === 'fact')
      expect(facts.length).toBeGreaterThanOrEqual(2)
      expect(facts.some(f => (f.conflictsWith ?? []).length > 0)).toBe(true)
    })
  })
})

describe('修复 3：chapterRange 对剧情线生效', () => {
  it('限定 1-5 章时不应命中第 7 章才开始的剧情线', () => {
    withTempDb(() => {
      CanonRepository.addPlotLine({
        name: '第7章才出现的剧情线', description: '涉及青虹剑',
        status: 'active', startedAt: 7, lastAdvancedAt: 7,
        currentState: '进行中', characters: [],
      } as never)

      const result = CanonRepository.searchCanon({
        query: '青虹剑', chapterRange: { from: 1, to: 5 }, includeHistorical: true,
      } as never)
      const lines = result.hits.filter(h => h.type === 'plot_line')
      expect(lines).toHaveLength(0)
    })
  })

  it('范围与剧情线区间重叠时应正常命中', () => {
    withTempDb(() => {
      CanonRepository.addPlotLine({
        name: '横跨前后的主线', description: '涉及青虹剑',
        status: 'active', startedAt: 1, lastAdvancedAt: 20,
        currentState: '进行中', characters: [],
      } as never)

      const result = CanonRepository.searchCanon({
        query: '青虹剑', chapterRange: { from: 1, to: 5 }, includeHistorical: true,
      } as never)
      expect(result.hits.filter(h => h.type === 'plot_line')).toHaveLength(1)
    })
  })
})
