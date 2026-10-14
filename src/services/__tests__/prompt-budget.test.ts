/**
 * 提示词预算裁剪
 *
 * 锁住三件事：预算够就不动；超了从最不重要的开始削；保护段（Canon / 本章信息）只计数不裁剪，
 * 真的只剩它们还超预算时如实返回 stillOver，而不是假装削好了。
 */
import { describe, expect, it } from 'vitest'
import { applyPromptBudget } from '../workflows/prompt-budget'

const sections = (overrides: Partial<Record<string, string>> = {}) => [
  { key: 'canon' as const, text: overrides.canon ?? '甲'.repeat(2000) },
  { key: 'chapterInfo' as const, text: overrides.chapterInfo ?? '乙'.repeat(100) },
  { key: 'architecture' as const, text: overrides.architecture ?? '丙'.repeat(3000) },
  { key: 'futureBlueprints' as const, text: overrides.futureBlueprints ?? '丁'.repeat(1500) },
]

describe('applyPromptBudget', () => {
  it('预算足够时一字不动', () => {
    const result = applyPromptBudget(sections(), 10000)
    expect(result.trims).toEqual([])
    expect(result.values.architecture).toHaveLength(3000)
    expect(result.stillOver).toBe(false)
  })

  it('超预算时先整段丢掉最不重要的（后续预告）', () => {
    // 总计约 6600 tokens，预算 5000 → 削掉 1500 的预告后还差一点，
    // 于是架构也会被截断（这里只断言「预告最先被丢」与「最终落在预算内」）
    const result = applyPromptBudget(sections(), 5000)

    expect(result.values.futureBlueprints).toBe('')
    expect(result.trims[0].key).toBe('futureBlueprints')
    expect(result.tokensAfter).toBeLessThanOrEqual(5000)
    expect(result.stillOver).toBe(false)
  })

  it('丢一段不够时继续丢下一段，并记录每段削掉多少', () => {
    const result = applyPromptBudget(sections(), 3000)

    expect(result.values.futureBlueprints).toBe('')
    expect(result.trims.map(trim => trim.key)).toEqual(['futureBlueprints', 'architecture'])
    expect(result.trims[1].mode).toBe('truncated')
    expect(result.values.architecture.length).toBeLessThan(3000)
    expect(result.values.architecture).toContain('已按上下文预算省略')
  })

  it('保护段（Canon / 本章信息）不会被丢或截断', () => {
    const result = applyPromptBudget(sections(), 500)

    expect(result.values.canon).toHaveLength(2000)
    expect(result.values.chapterInfo).toHaveLength(100)
    // 只剩保护段仍然超预算 → 如实报告，不假装成功
    expect(result.stillOver).toBe(true)
  })

  it('截断停在句子边界，并写明省略了多少字', () => {
    const sentences = '第一句话结束。第二句话也有内容。第三句话同样如此。第四句收尾。'.repeat(20)
    const result = applyPromptBudget([
      { key: 'canon' as const, text: '甲'.repeat(60) },
      { key: 'architecture' as const, text: sentences },
    ], 200)

    expect(result.values.architecture.endsWith('）') || result.values.architecture.endsWith('。')).toBe(true)
    expect(result.values.architecture).toContain('已按上下文预算省略')
  })
})
