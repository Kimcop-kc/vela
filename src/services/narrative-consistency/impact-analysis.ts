/**
 * 修改影响分析
 *
 * 只做一件事：把「本次重写让哪些事实消失、这些事实被后面哪些章节引用过」整理成可读报告。
 * 数据来自写回时落库的引用关系（canon_fact_usage），因此是精确的反向查询，不需要再检索或调用模型。
 *
 * 设计底线（与需求文档一致）：**只报告，不自动改后续章节。**
 */
import type { FactImpactCandidate } from './types'

export interface ImpactReportItem {
  factId?: number
  category: string
  statement: string
  introducedAt: number
  /** 引用过这条事实的后续章节（升序去重） */
  affectedChapters: number[]
  /** 命中时用到的原文证据（最多几条） */
  evidence: string[]
  /** 影响等级：high = 有 3 章以上引用；medium = 1-2 章 */
  severity: 'high' | 'medium'
}

export interface ImpactReport {
  chapterNumber: number
  items: ImpactReportItem[]
  /** 涉及到的后续章节总数（去重） */
  affectedChapterCount: number
}

/** 影响等级的阈值：被 3 个及以上后续章节引用算「高」 */
const HIGH_SEVERITY_CHAPTERS = 3

export function buildImpactReport(params: {
  chapterNumber: number
  candidates: FactImpactCandidate[]
}): ImpactReport {
  const items: ImpactReportItem[] = []
  const allChapters = new Set<number>()

  for (const candidate of params.candidates || []) {
    const chapters = [...new Set((candidate.usedBy || [])
      .map(entry => entry.chapterNumber)
      .filter(chapter => Number.isSafeInteger(chapter) && chapter > params.chapterNumber))]
      .sort((a, b) => a - b)
    // 没有后续章节引用 → 没有实际影响，不进报告（避免噪音）
    if (chapters.length === 0) continue
    for (const chapter of chapters) allChapters.add(chapter)
    items.push({
      factId: candidate.fact.id,
      category: candidate.fact.category,
      statement: candidate.fact.statement,
      introducedAt: candidate.fact.introducedAt,
      affectedChapters: chapters,
      evidence: [...new Set((candidate.usedBy || []).map(entry => entry.evidence).filter(Boolean))].slice(0, 3),
      severity: chapters.length >= HIGH_SEVERITY_CHAPTERS ? 'high' : 'medium',
    })
  }

  // 影响面大的排前面；同级按最早受影响的章节排序
  items.sort((a, b) => {
    if (a.affectedChapters.length !== b.affectedChapters.length) {
      return b.affectedChapters.length - a.affectedChapters.length
    }
    return (a.affectedChapters[0] ?? 0) - (b.affectedChapters[0] ?? 0)
  })

  return {
    chapterNumber: params.chapterNumber,
    items,
    affectedChapterCount: allChapters.size,
  }
}
