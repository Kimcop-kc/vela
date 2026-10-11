/**
 * 大纲分类解析（纯函数）
 *
 * 需求文档明确「偏离不等于错误」：作者可能在创作中调整方向，
 * 所以要能把「按大纲完成 / 还没写到 / 确实跑偏 / 可能漏了 / 大纲没写但合理 / 与设定冲突」区分开。
 * 这里锁住归一化规则，并确保分类不会跑到别的维度上。
 */
import { describe, expect, it } from 'vitest'
import { normalizeOutlineClass, parseObservations } from '../review/continuity-observer'

describe('normalizeOutlineClass', () => {
  it('识别枚举值', () => {
    expect(normalizeOutlineClass('done')).toBe('done')
    expect(normalizeOutlineClass('pending')).toBe('pending')
    expect(normalizeOutlineClass('deviated')).toBe('deviated')
    expect(normalizeOutlineClass('missing')).toBe('missing')
    expect(normalizeOutlineClass('creative')).toBe('creative')
    expect(normalizeOutlineClass('conflict')).toBe('conflict')
  })

  it('识别中文与整句写法', () => {
    expect(normalizeOutlineClass('已完成')).toBe('done')
    expect(normalizeOutlineClass('大纲要求的部分尚未写到')).toBe('pending')
    expect(normalizeOutlineClass('正文与蓝图明显不符')).toBe('deviated')
    expect(normalizeOutlineClass('可能漏掉了大纲里的线索')).toBe('missing')
    expect(normalizeOutlineClass('大纲未规定但属于合理发挥')).toBe('creative')
    expect(normalizeOutlineClass('与已确认设定冲突')).toBe('conflict')
  })

  it('识别不到就当没给（不猜）', () => {
    expect(normalizeOutlineClass('situation unclear')).toBeUndefined()
    expect(normalizeOutlineClass('')).toBeUndefined()
    expect(normalizeOutlineClass(undefined)).toBeUndefined()
    expect(normalizeOutlineClass(42)).toBeUndefined()
  })

  it('冲突优先于完成：「与设定冲突」不会被含有的「完成」误判', () => {
    expect(normalizeOutlineClass('大纲情节已完成，但与设定存在冲突')).toBe('conflict')
  })
})

describe('parseObservations 处理大纲分类', () => {
  const raw = (classification: string, dimension = 'outline-deviation') => ({
    observations: [{
      dimension,
      classification,
      severity: 'watch',
      title: '本章推进情况',
      detail: '细节',
      evidence: [{ quote: '原文', source: '第12章' }],
      relatedChapters: [12],
    }],
  })

  it('大纲维度的分类被保留', () => {
    const { observations } = parseObservations(raw('deviated'), 12, '原文')

    expect(observations).toHaveLength(1)
    expect(observations[0].outlineClass).toBe('deviated')
  })

  it('其它维度即使带了分类也会被忽略', () => {
    const { observations } = parseObservations(raw('deviated', 'pacing'), 12, '原文')

    expect(observations[0].outlineClass).toBeUndefined()
  })

  it('没有分类时不影响观察本身', () => {
    const { observations } = parseObservations({
      observations: [{
        dimension: 'outline-deviation',
        severity: 'note',
        title: '本章推进情况',
        detail: '细节',
        evidence: [{ quote: '原文', source: '第12章' }],
      }],
    }, 12, '原文')

    expect(observations).toHaveLength(1)
    expect(observations[0].outlineClass).toBeUndefined()
  })
})
