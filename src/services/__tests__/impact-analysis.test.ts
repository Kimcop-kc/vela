/**
 * 修改影响报告（纯函数）
 *
 * 只报告「被后续章节引用过、但本次重写后消失」的事实；
 * 没有被任何后续章节引用的不进报告，避免把噪音塞给作者。
 */
import { describe, expect, it } from 'vitest'
import { buildImpactReport } from '../narrative-consistency/impact-analysis'
import type { FactImpactCandidate } from '../narrative-consistency/types'

const candidate = (statement: string, chapters: number[], evidence = '炭笔'): FactImpactCandidate => ({
  fact: { category: 'item', statement, introducedAt: 20, characters: ['顾野'] },
  usedBy: chapters.map(chapterNumber => ({ chapterNumber, evidence })),
})

describe('buildImpactReport', () => {
  it('列出被后续章节引用的事实，并去重章节', () => {
    const report = buildImpactReport({
      chapterNumber: 20,
      candidates: [candidate('顾野得到一截炭笔', [31, 31, 33])],
    })

    expect(report.items).toHaveLength(1)
    expect(report.items[0].affectedChapters).toEqual([31, 33])
    expect(report.affectedChapterCount).toBe(2)
  })

  it('按引用章节数分档：3 章以上算高', () => {
    const high = buildImpactReport({ chapterNumber: 20, candidates: [candidate('事实甲', [31, 33, 40])] })
    const medium = buildImpactReport({ chapterNumber: 20, candidates: [candidate('事实乙', [31, 33])] })

    expect(high.items[0].severity).toBe('high')
    expect(medium.items[0].severity).toBe('medium')
  })

  it('忽略没有后续章节引用的候选（本次改动没有下游影响）', () => {
    const report = buildImpactReport({
      chapterNumber: 20,
      candidates: [candidate('只在本章出现的事实', [])],
    })

    expect(report.items).toEqual([])
    expect(report.affectedChapterCount).toBe(0)
  })

  it('忽略指向本章或更早章节的引用记录', () => {
    const report = buildImpactReport({
      chapterNumber: 20,
      candidates: [candidate('事实丙', [12, 20])],
    })

    expect(report.items).toEqual([])
  })

  it('影响面大的排前面，同级按最早受影响章节排序', () => {
    const report = buildImpactReport({
      chapterNumber: 20,
      candidates: [
        candidate('两章引用', [45, 50]),
        candidate('三章引用', [31, 33, 40]),
        candidate('两章但更早', [22, 23]),
      ],
    })

    expect(report.items.map(item => item.statement)).toEqual(['三章引用', '两章但更早', '两章引用'])
  })

  it('带上命中时的原文证据（最多三条）', () => {
    const report = buildImpactReport({
      chapterNumber: 20,
      candidates: [{
        fact: { category: 'item', statement: '顾野得到一截炭笔', introducedAt: 20, characters: [] },
        usedBy: [
          { chapterNumber: 31, evidence: '炭笔' },
          { chapterNumber: 33, evidence: '炭笔' },
          { chapterNumber: 40, evidence: '暗袋' },
          { chapterNumber: 41, evidence: '符纸' },
        ],
      }],
    })

    expect(report.items[0].evidence).toEqual(['炭笔', '暗袋', '符纸'])
  })
})
