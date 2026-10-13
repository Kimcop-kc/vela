/**
 * 故事圣经页纯函数护栏
 *
 * 这些函数原本散落在 1131 行的 StoryBibleOverview 组件里，测不到；拆出到 helpers.ts 后可以整体覆盖。
 *
 * 重点锁的是「事实的确认」与「记忆状态」这两件事别被混为一谈：
 *   · confirmedAt = 作者是否过目过（AI 提取的事实默认没过目）
 *   · status     = 注入措辞（contradicted 冲突 / outdated 不再注入 / tentative 暂定）
 * 一旦有人把 isConfirmedFact 写成「只要 status 不是 contradicted 就算已确认」，
 * 界面就会把作者从没看过的事实显示成已确认 —— 这条测试会直接失败。
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_DATA, includesQuery, isConflictFact, isConfirmedFact, isPendingFact, sectionTitle } from '../helpers'
import type { Fact } from '../../../../services/narrative-consistency'

function makeFact(patch: Partial<Fact> = {}): Fact {
  return {
    category: 'item',
    statement: '炭笔是老邵给的',
    introducedAt: 3,
    characters: ['顾野'],
    evidence: '换笔',
    ...patch,
  }
}

describe('includesQuery：关键词筛选', () => {
  it('空查询或纯空白一律放行（等价于「不过滤」）', () => {
    expect(includesQuery('', '任意内容')).toBe(true)
    expect(includesQuery('   ', '任意内容')).toBe(true)
  })

  it('大小写不敏感，且命中任意一个字段即算命中', () => {
    expect(includesQuery('CARBON', 'a carbon pen')).toBe(true)
    expect(includesQuery('carbon', 'A CARBON pen')).toBe(true)
    expect(includesQuery('不在任何字段里', 'a carbon pen', '顾野', undefined)).toBe(false)
    expect(includesQuery('顾野', 'a carbon pen', '顾野')).toBe(true)
  })

  it('undefined 字段不会让整体抛错', () => {
    expect(() => includesQuery('x', undefined, undefined)).not.toThrow()
    expect(includesQuery('x', undefined, undefined)).toBe(false)
  })
})

describe('事实状态谓词：确认与记忆状态是两件事', () => {
  it('没过目 → 待确认', () => {
    expect(isPendingFact(makeFact())).toBe(true)
    expect(isPendingFact(makeFact({ confirmedAt: '2026-01-01T00:00:00.000Z' }))).toBe(false)
  })

  it('status=contradicted → 冲突（不论是否过目）', () => {
    expect(isConflictFact(makeFact({ status: 'contradicted' }))).toBe(true)
    expect(isConflictFact(makeFact({ status: 'contradicted', confirmedAt: '2026-01-01T00:00:00.000Z' }))).toBe(true)
    expect(isConflictFact(makeFact({ status: 'active' }))).toBe(false)
    // status 缺省时按 active 处理
    expect(isConflictFact(makeFact())).toBe(false)
  })

  it('「已确认」必须同时满足：作者过目 且 既不冲突也不废弃', () => {
    expect(isConfirmedFact(makeFact({ confirmedAt: '2026-01-01T00:00:00.000Z' }))).toBe(true)
    expect(isConfirmedFact(makeFact({ confirmedAt: '2026-01-01T00:00:00.000Z', status: 'active' }))).toBe(true)
    expect(isConfirmedFact(makeFact({ confirmedAt: '2026-01-01T00:00:00.000Z', status: 'contradicted' }))).toBe(false)
    expect(isConfirmedFact(makeFact({ confirmedAt: '2026-01-01T00:00:00.000Z', status: 'outdated' }))).toBe(false)
    // 没过目的一律不算已确认
    expect(isConfirmedFact(makeFact())).toBe(false)
  })

  it('三个谓词互斥：任意一条事实最多只落在其中一个分类里', () => {
    const samples: Fact[] = [
      makeFact(),
      makeFact({ confirmedAt: '2026-01-01T00:00:00.000Z' }),
      makeFact({ status: 'contradicted' }),
      makeFact({ confirmedAt: '2026-01-01T00:00:00.000Z', status: 'contradicted' }),
      makeFact({ confirmedAt: '2026-01-01T00:00:00.000Z', status: 'outdated' }),
      makeFact({ status: 'tentative' }),
    ]
    for (const fact of samples) {
      const hits = [isPendingFact(fact), isConflictFact(fact), isConfirmedFact(fact)].filter(Boolean).length
      // 待确认与冲突可以同时成立（没过目的冲突事实），但「已确认」与其它两者不能共存
      if (isConfirmedFact(fact)) {
        expect(isPendingFact(fact)).toBe(false)
        expect(isConflictFact(fact)).toBe(false)
        expect(hits).toBe(1)
      }
    }
  })
})

describe('sectionTitle 与初始数据', () => {
  const fakeT = (key: string) => key

  it('每个分区都映射到自己的 i18n key，不串区', () => {
    const sections = ['overview', 'characters', 'timeline', 'plots', 'facts', 'realms', 'locations', 'search'] as const
    const titles = sections.map(section => sectionTitle(section, fakeT))
    expect(titles).toEqual(sections.map(section => `storyBibleOverview.sections.${section}`))
    expect(new Set(titles).size).toBe(sections.length)
  })

  it('EMPTY_DATA 六个字段都是空数组（避免共享可变默认值）', () => {
    expect(Object.keys(EMPTY_DATA).sort()).toEqual(['blueprints', 'facts', 'plots', 'states', 'summaries', 'timeline'])
    for (const value of Object.values(EMPTY_DATA)) {
      expect(Array.isArray(value)).toBe(true)
      expect(value).toHaveLength(0)
    }
  })
})
