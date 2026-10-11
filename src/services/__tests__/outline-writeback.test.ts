/**
 * 大纲写回（纯函数）
 *
 * 仓储层只接受「oldText 在字段里唯一出现」的替换，所以追加式写入必须挑一个唯一的锚点。
 * 这里锁住三件事：哪些观察能写回、锚点是否真的唯一、写回后原文是否只增不改。
 */
import { describe, expect, it } from 'vitest'
import { buildAppendEdit, canWriteBackToOutline } from '../review/outline-writeback'
import type { ReviewObservation } from '../review/types'

const observation = (patch: Partial<ReviewObservation>): ReviewObservation => ({
  id: 'o1',
  dimension: 'outline-deviation',
  severity: 'watch',
  title: '本章走向与蓝图不符',
  detail: '蓝图要求主角留在山门，正文里他直接去了北境。',
  evidence: [],
  relatedChapters: [],
  origin: 'llm',
  ...patch,
})

describe('canWriteBackToOutline', () => {
  it('偏差与合理创新可以写回', () => {
    expect(canWriteBackToOutline(observation({ outlineClass: 'deviated' }))).toBe(true)
    expect(canWriteBackToOutline(observation({ outlineClass: 'creative' }))).toBe(true)
  })

  it('冲突、遗漏、已完成、未完成都不走这条路', () => {
    for (const outlineClass of ['conflict', 'missing', 'done', 'pending'] as const) {
      expect(canWriteBackToOutline(observation({ outlineClass }))).toBe(false)
    }
  })

  it('没给分类、或不是大纲维度的观察不出现按钮', () => {
    expect(canWriteBackToOutline(observation({}))).toBe(false)
    expect(canWriteBackToOutline(observation({ dimension: 'character-memory', outlineClass: 'deviated' }))).toBe(false)
  })
})

describe('buildAppendEdit', () => {
  it('空字段用空 oldText 填入（仓储层允许的用法）', () => {
    expect(buildAppendEdit('', ' 要追加的话 ')).toEqual({ oldText: '', newText: '要追加的话' })
    expect(buildAppendEdit('   \n ', '要追加的话')).toEqual({ oldText: '', newText: '要追加的话' })
  })

  it('没有新内容时不产生编辑', () => {
    expect(buildAppendEdit('原有内容', '   ')).toBeNull()
    expect(buildAppendEdit('', '')).toBeNull()
  })

  it('追加到末尾：原文一字不改，新内容接在后面', () => {
    const current = '本章按蓝图推进：主角留在山门，反复试探封印。'
    const edit = buildAppendEdit(current, '【作者确认】本章实际去了北境。')!

    expect(edit.oldText.length).toBeGreaterThan(0)
    const replaced = current.slice(0, current.indexOf(edit.oldText)) + edit.newText
    expect(replaced.startsWith(current)).toBe(true)
    expect(replaced.endsWith('【作者确认】本章实际去了北境。')).toBe(true)
  })

  it('锚点在字段里只出现一次（仓储层要求，否则整次不写）', () => {
    const current = '第一段。第二段。第一段。'
    const edit = buildAppendEdit(current, '新内容')!

    const at = current.indexOf(edit.oldText)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(current.indexOf(edit.oldText, at + 1)).toBe(-1)
  })

  it('锚点会延长到唯一为止；实在找不到就用整段兜底', () => {
    // 结尾的「反复试探」在前文出现过，短锚点不唯一 → 自动取更长的后缀
    const repeated = '反复试探封印的边界。中段内容很长，足够撑开一个更长的后缀。反复试探'
    const edit = buildAppendEdit(repeated, '补充')!
    const at = repeated.indexOf(edit.oldText)
    expect(repeated.indexOf(edit.oldText, at + 1)).toBe(-1)
    expect(edit.oldText.length).toBeGreaterThan(4)

    // 整段就是同一句话重复时，最长后缀也唯一不了 → 退化为整段锚点
    const pathological = '甲乙'.repeat(300)
    const fallback = buildAppendEdit(pathological, '补充')!
    expect(fallback.oldText).toBe(pathological)
  })

  it('字段末尾有空白时不把空白算进锚点', () => {
    const edit = buildAppendEdit('原文结尾。   \n', '补充')!
    expect(edit.oldText).not.toMatch(/\s$/)
    expect(edit.newText.endsWith('\n\n补充')).toBe(true)
  })
})
