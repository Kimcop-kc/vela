/**
 * 审稿驱动修稿输出解析单测
 *
 * 自定义提示词会要求「修复后正文 + 修复说明 + 待作者确认」三段输出；
 * 这里保证只有正文会写进修订稿，说明块不会被当成正文。
 */
import { describe, expect, it } from 'vitest'
import { splitRefineOutput } from '../workflows/commands/refine-from-review.command'

describe('splitRefineOutput', () => {
  it('剥离修复说明与待作者确认，只保留正文', () => {
    const raw = [
      '【修复后正文】',
      '第一段。',
      '',
      '第二段。',
      '',
      '【修复说明】',
      '- 报告条目：角色记忆',
      '  处理方式：改了某句',
      '',
      '【待作者确认】',
      '无',
    ].join('\n')
    const { body, notes } = splitRefineOutput(raw)
    expect(body).toBe('第一段。\n\n第二段。')
    expect(notes).toContain('【修复说明】')
    expect(notes).toContain('【待作者确认】')
    expect(body).not.toContain('修复说明')
  })

  it('内置模板只输出正文时保持原样', () => {
    const raw = '第一段。\n\n第二段。'
    const { body, notes } = splitRefineOutput(raw)
    expect(body).toBe(raw)
    expect(notes).toBe('')
  })

  it('缺少正文标记但有修复说明时，取说明之前的内容', () => {
    const raw = '第一段。\n\n第二段。\n\n【修复说明】\n改了某句'
    const { body, notes } = splitRefineOutput(raw)
    expect(body).toBe('第一段。\n\n第二段。')
    expect(notes).toContain('【修复说明】')
  })
})
