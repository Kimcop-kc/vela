/**
 * 写前校验单测
 *
 * 确定性契约：占位符必须被识别（用于阻断写稿）；缺失/过短只做提示。
 */
import { describe, expect, it } from 'vitest'
import { validateChapterPrewrite } from '../workflows/prewrite-validator'

describe('validateChapterPrewrite', () => {
  it('识别花括号占位符并保留命中片段', () => {
    const issues = validateChapterPrewrite({
      title: '第6章 章纲',
      keyEvents: '主角按 {章纲目标} 行动。',
    })
    const placeholder = issues.find(issue => issue.kind === 'placeholder')
    expect(placeholder).toBeDefined()
    expect(placeholder!.detail).toContain('{章纲目标}')
  })

  it('识别「第N章」这类未替换写法', () => {
    const issues = validateChapterPrewrite({ title: '第N章 待定', keyEvents: '主角出发。' })
    expect(issues.some(issue => issue.kind === 'placeholder')).toBe(true)
  })

  it('缺失关键字段给出 missing 提示', () => {
    const issues = validateChapterPrewrite({ title: '第六章', keyEvents: '' })
    expect(issues.some(issue => issue.kind === 'missing' && issue.field === 'keyEvents')).toBe(true)
  })

  it('过短的关键事件给出 too-short 提示', () => {
    const issues = validateChapterPrewrite({ title: '第六章', keyEvents: '出发。' })
    expect(issues.some(issue => issue.kind === 'too-short')).toBe(true)
  })

  it('干净的章纲不报任何问题', () => {
    const issues = validateChapterPrewrite({
      title: '湿纹显字',
      purpose: '发展',
      characters: ['云玉辞', '周德'],
      keyEvents: '云玉辞在井台发现逆旋纹，用水浸湿后显字。',
    })
    expect(issues).toEqual([])
  })

  it('角色列表里的占位符也会被识别', () => {
    const issues = validateChapterPrewrite({ title: '第六章', keyEvents: '主角出发。', characters: ['{待定}'] })
    expect(issues.some(issue => issue.kind === 'placeholder' && issue.field.startsWith('characters'))).toBe(true)
  })
})
