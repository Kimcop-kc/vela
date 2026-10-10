/**
 * 审稿驱动修稿输出解析单测
 *
 * 自定义提示词会要求「修复后正文 + 修复说明 + 待作者确认」三段输出；
 * 这里保证只有正文会写进修订稿，说明块不会被当成正文。
 */
import { describe, expect, it } from 'vitest'
import { splitRefineOutput } from '../workflows/commands/refine-output'

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

  it('整章修稿结尾追加的待作者确认不会进入正文', () => {
    // 用户自定义「大神级修稿」提示词要求在结尾用【待作者确认】列出与 Canon 冲突之处
    const raw = '第一段。\n\n第二段。\n\n【待作者确认】\n- 第 3 章：主角此刻不应该知道密信的存在（位置：第二段末）'
    const { body, notes } = splitRefineOutput(raw)
    expect(body).toBe('第一段。\n\n第二段。')
    expect(body).not.toContain('待作者确认')
    expect(notes).toContain('密信')
  })

  it('同时出现正文标记、修复说明与待作者确认时只保留正文', () => {
    const raw = '【正文】\n第一段。\n\n【修复说明】\n改了用词\n\n【待作者确认】\n- 伏笔位置待定'
    const { body, notes } = splitRefineOutput(raw)
    expect(body).toBe('第一段。')
    expect(notes).toContain('【修复说明】')
    expect(notes).toContain('【待作者确认】')
  })

  it('只有说明、没有正文时回退为完整文本，避免产出空稿', () => {
    const raw = '【修复说明】\n只有说明'
    const { body } = splitRefineOutput(raw)
    // 已知取舍：完全没有正文时回退成完整文本（宁可多写说明，也不要产出空修订稿）；
    // 整章修稿这条路径会额外拦下这种「只有说明」的输出。
    expect(body).toBe(raw)
  })
})
