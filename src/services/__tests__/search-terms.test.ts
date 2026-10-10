/**
 * 知识库检索关键词处理测试
 *
 * 背景：旧实现把整段查询文本逐字拆成 `%顶%光%裂%墨%…` 去做 `text LIKE`，
 * 查询里只要有一个单引号就会截断 SQL 字面量，检索整体报错并静默返回空
 * （日志里的「纯文本检索失败: Error optimizing sql filter」）。
 * 这里锁住关键词侧的安全不变量：拼出来的谓词永远不含多余引号。
 */
import { describe, expect, it } from 'vitest'
import {
  buildLikePredicate,
  countTermHits,
  extractSearchTerms,
  scoreByTermHits,
} from '../../shared/search-terms'

/** 谓词里成对的引号只能来自 '%term%' 的包裹，多一个都说明又有注入风险 */
const quoteCount = (text: string) => (text.match(/'/g) ?? []).length

describe('extractSearchTerms 抽取关键词', () => {
  it('剔除引号与标点，只留可用词', () => {
    const terms = extractSearchTerms('第16章 废纸淘契，"顾野"说：\'纸骨认墨不认人\'')

    expect(terms).toContain('第16章')
    expect(terms).toContain('废纸淘契')
    expect(terms).toContain('顾野')
    expect(terms.every(t => !t.includes("'")))
      .toBe(true)
  })

  it('剔除 LIKE 通配符与反斜杠', () => {
    const terms = extractSearchTerms('100%纯_净\\ 茶棚')

    expect(terms.some(t => t.includes('%'))).toBe(false)
    expect(terms.some(t => t.includes('_'))).toBe(false)
    expect(terms.some(t => t.includes('\\'))).toBe(false)
    expect(terms).toContain('100')
  })

  it('长段落按长度切片，词数与词长都有上限', () => {
    const paragraph = '他看着那道裂缝想起师父说过的话于是把炭笔收进暗袋里继续往前走' // 无标点长串
    const terms = extractSearchTerms(paragraph)

    expect(terms.length).toBeLessThanOrEqual(8)
    expect(terms.every(t => t.length <= 6)).toBe(true)
    expect(terms.length).toBeGreaterThan(0)
  })

  it('去掉重复词', () => {
    expect(extractSearchTerms('顾野 顾野 顾野')).toEqual(['顾野'])
  })

  it('只有一个字时保留单字，避免完全检索不到', () => {
    expect(extractSearchTerms('剑')).toEqual(['剑'])
  })

  it('纯标点/空白查询不产生关键词', () => {
    expect(extractSearchTerms('  ，。！？ "" ')).toEqual([])
    expect(extractSearchTerms('')).toEqual([])
  })

  it('maxTerms 生效', () => {
    const terms = extractSearchTerms('甲乙 丙丁 戊己 庚辛', { maxTerms: 2 })

    expect(terms).toHaveLength(2)
  })
})

describe('buildLikePredicate 拼谓词', () => {
  it('单词不加括号', () => {
    expect(buildLikePredicate('text', ['顾野'])).toBe("text LIKE '%顾野%'")
  })

  it('多词用 OR 组合并加括号', () => {
    expect(buildLikePredicate('text', ['A', 'B'])).toBe("(text LIKE '%A%' OR text LIKE '%B%')")
  })

  it('没有关键词时返回空串', () => {
    expect(buildLikePredicate('text', [])).toBe('')
  })

  it('恶意查询拼出来的谓词不含多余引号', () => {
    const nasty = `他说："纸骨认墨不认人" 100% 纯_净 \\ ' OR 1=1 --`
    const terms = extractSearchTerms(nasty)
    const predicate = buildLikePredicate('text', terms)

    expect(terms.length).toBeGreaterThan(0)
    expect(quoteCount(predicate)).toBe(terms.length * 2)
    expect(predicate).not.toContain('OR 1=1')
    expect(predicate).not.toContain('--')
  })
})

describe('命中打分', () => {
  it('按命中比例给分', () => {
    expect(scoreByTermHits('顾野在茶棚里', ['顾野', '茶棚'])).toBe(1)
    expect(scoreByTermHits('顾野在茶棚里', ['顾野', '老邵'])).toBe(0.5)
    expect(scoreByTermHits('顾野在茶棚里', ['老邵'])).toBe(0)
  })

  it('没有关键词时不给分', () => {
    expect(scoreByTermHits('任意文本', [])).toBe(0)
  })

  it('命中数与比例一致', () => {
    const terms = ['顾野', '茶棚', '老邵']
    expect(countTermHits('顾野走进茶棚', terms)).toBe(2)
    expect(scoreByTermHits('顾野走进茶棚', terms)).toBeCloseTo(2 / 3)
  })
})
