/**
 * 修改影响分析的数据基础：事实引用关系
 *
 * 写回时按正文里出现的「证据短语」记录「本章沿用了哪些既有事实」；
 * 之后重写前文、让某条事实消失时，就能精确列出引用过它的后续章节。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeProjectDatabase, initProjectDatabase } from '../database'
import { CanonRepository } from '../repositories/canon-repository'
import { buildImpactReport } from '../../src/services/narrative-consistency/impact-analysis'

let folder = ''

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-canon-impact-'))
  initProjectDatabase(folder)
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-canon-impact-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

const writeback = (chapterNumber: number, options: { statements: string[]; content: string; evidence?: string }) =>
  CanonRepository.writebackAtomically({
    chapterNumber,
    chapterContent: options.content,
    newEvents: [],
    characterDeltas: [],
    newFacts: options.statements.map(statement => ({
      category: 'item' as const,
      statement,
      introducedAt: chapterNumber,
      characters: ['顾野'],
      evidence: options.evidence ?? '',
    })),
  })

describe('事实引用关系（canon_fact_usage）', () => {
  it('按正文里的证据短语记录引用，指向其它章节的事实', () => {
    const first = writeback(3, { statements: ['顾野得到一截炭笔'], content: '顾野把炭笔收进暗袋。', evidence: '炭笔' })

    writeback(20, { statements: ['顾野用炭笔在石板画引火纹'], content: '他摸出炭笔，在石板上画了一道引火纹。' })

    const usage = CanonRepository.getFactUsageByFact(first.factIds[0])
    expect(usage).toEqual([{ chapterNumber: 20, evidence: '炭笔' }])
    expect(CanonRepository.getFactUsageByChapter(20)).toEqual([{ factId: first.factIds[0], evidence: '炭笔' }])
  })

  it('正文里没出现的证据短语不会被记成引用（宁漏不误）', () => {
    const first = writeback(3, { statements: ['顾野得到一截炭笔'], content: '顾野把炭笔收进暗袋。', evidence: '炭笔' })

    writeback(20, { statements: ['顾野换了住处'], content: '他搬到了城西的一间小院。' })

    expect(CanonRepository.getFactUsageByFact(first.factIds[0])).toEqual([])
  })

  it('重写前文让事实消失时，能找出引用它的后续章节', () => {
    const first = writeback(3, { statements: ['顾野得到一截炭笔'], content: '顾野把炭笔收进暗袋。', evidence: '炭笔' })
    writeback(20, { statements: ['顾野用炭笔画引火纹'], content: '他摸出炭笔，在石板上画了引火纹。' })
    writeback(31, { statements: ['引火纹生效'], content: '炭笔画的纹路亮了一下。' })

    // 重写第 3 章：这条事实没了
    const rewrite = writeback(3, { statements: ['顾野两手空空'], content: '他什么也没有带。' })

    expect(rewrite.impactCandidates).toHaveLength(1)
    const candidates = rewrite.impactCandidates
    expect(candidates[0].fact.statement).toBe('顾野得到一截炭笔')
    expect(candidates[0].usedBy.map(item => item.chapterNumber)).toEqual([20, 31])
    void first

    const report = buildImpactReport({ chapterNumber: 3, candidates })
    expect(report.items).toHaveLength(1)
    expect(report.items[0].severity).toBe('medium')
    expect(report.affectedChapterCount).toBe(2)
  })

  it('原文没变时不算影响，且引用关系跟着新 id 走', () => {
    const first = writeback(3, { statements: ['顾野得到一截炭笔'], content: '顾野把炭笔收进暗袋。', evidence: '炭笔' })
    writeback(20, { statements: ['顾野用炭笔画引火纹'], content: '他摸出炭笔，画了引火纹。' })

    // 同样的一章再定稿一次（事实原文不变）：不应报成影响
    const rewrite = writeback(3, { statements: ['顾野得到一截炭笔'], content: '顾野把炭笔收进暗袋。', evidence: '炭笔' })
    expect(rewrite.impactCandidates).toEqual([])

    // 引用关系应当指向新的 id，而不是指向已被删除的旧 id
    const usage = CanonRepository.getFactUsageByFact(rewrite.factIds[0])
    expect(usage).toEqual([{ chapterNumber: 20, evidence: '炭笔' }])
    void first
  })
})
