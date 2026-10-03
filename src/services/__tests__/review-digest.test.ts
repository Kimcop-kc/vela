/**
 * 定性审稿摘要单测
 *
 * 覆盖摘要记忆的纯函数契约：
 *   1. 时间线浓缩优先使用定稿摘要，缺失时退回事件摘要；
 *   2. 只跨章保留 llm 的 watch/concern 与伏笔，note 与规则观察不沉淀；
 *   3. Canon 指纹对任意事实/时间线/摘要变化敏感。
 */
import { describe, expect, it } from 'vitest'
import type { ReviewObservation } from '../review/types'
import {
  buildTimelineDigest,
  computeCanonFingerprint,
  emptyReviewDigest,
  foldObservationsIntoDigest,
} from '../review/review-digest'

function observation(partial: Partial<ReviewObservation> & { id: string }): ReviewObservation {
  return {
    dimension: 'character-memory',
    severity: 'watch',
    title: partial.id,
    detail: `${partial.id} 详情`,
    evidence: [],
    relatedChapters: [],
    origin: 'llm',
    ...partial,
  }
}

describe('审稿摘要', () => {
  it('时间线浓缩优先使用定稿摘要，缺失章节退回事件摘要', () => {
    const text = buildTimelineDigest(
      3,
      [
        { chapterNumber: 1, title: '开端', summary: '苏离入城。', createdAt: '' },
      ],
      [
        { chapterNumber: 2, sequence: 1, characters: ['苏离'], location: '巷口', timeFlow: 'sequential', summary: '苏离遇袭。', impact: '' },
        { chapterNumber: 3, sequence: 1, characters: ['苏离'], location: '医馆', timeFlow: 'sequential', summary: '苏离疗伤。', impact: '' },
      ],
    )

    expect(text).toContain('第1章《开端》：苏离入城。')
    expect(text).toContain('第2章：苏离遇袭。')
    expect(text).toContain('第3章：苏离疗伤。')
  })

  it('只跨章保留 llm 的 watch/concern 与伏笔，不沉淀 note 与规则观察', () => {
    const seed = emptyReviewDigest(2, '第二章')
    const folded = foldObservationsIntoDigest(seed, [
      observation({ id: 'watch-1', severity: 'watch' }),
      observation({ id: 'foreshadow-1', dimension: 'foreshadowing', severity: 'concern' }),
      observation({ id: 'note-1', severity: 'note' }),
      observation({ id: 'rule-1', origin: 'rule', severity: 'concern' }),
    ])

    expect(folded.unresolved.map(item => item.id)).toEqual(['watch-1'])
    expect(folded.foreshadowing.map(item => item.id)).toEqual(['foreshadow-1'])
  })

  it('Canon 指纹对事实变化敏感', () => {
    const base = computeCanonFingerprint([], [], [])
    const changed = computeCanonFingerprint([], [
      { id: 1, category: 'location', statement: '青石城有东门。', introducedAt: 1, characters: [] },
    ], [])
    expect(changed).not.toBe(base)
  })
})
