/**
 * 扩展 AI 痕迹检测单测
 *
 * 覆盖按「AI 写作癖好清单」新增的 5 类：清单式罗列、神态/内心套话、
 * 万能副词、对白标签、转折/递进模板。检测只标记，不改稿。
 */
import { describe, expect, it } from 'vitest'
import { detectAiTraces } from '../review/ai-trace-detector'

describe('扩展 AI 痕迹检测', () => {
  it('识别清单式罗列', () => {
    const text = ['第一条：先做准备。', '第二条：再行动。', '第三条：最后收尾。'].join('\n')
    expect(detectAiTraces(text).some(f => f.kind === 'list-enumeration')).toBe(true)
  })

  it('识别神态/内心套话', () => {
    const text = '他眸中闪过一道光。她嘴角勾起。他心中暗道不好。她瞳孔微缩。'
    expect(detectAiTraces(text).some(f => f.kind === 'cliche-expression')).toBe(true)
  })

  it('识别万能副词堆叠', () => {
    const text = '他缓缓抬头，淡淡开口，微微皱眉，轻轻叹气，静静看着，默默转身，悄悄离开，慢慢坐下。'
    expect(detectAiTraces(text).some(f => f.kind === 'universal-adverb')).toBe(true)
  })

  it('识别对白标签单调', () => {
    const text = [
      '“走。”他说道。',
      '“等等。”她说道。',
      '“不行。”他说道。',
      '“为什么？”她说道。',
      '“别问。”他说道。',
      '“我偏要。”她说道。',
      '“随你。”他说道。',
      '“好。”她说道。',
    ].join('\n')
    expect(detectAiTraces(text).some(f => f.kind === 'dialogue-tag')).toBe(true)
  })

  it('识别转折/递进模板', () => {
    const text = '然而就在这时，门开了。殊不知，外面站着的正是他。话虽如此，他还是退了半步。'
    expect(detectAiTraces(text).some(f => f.kind === 'transition-template')).toBe(true)
  })

  it('自然文本不会误报新类别', () => {
    const text = '雨停了。\n\n苏离把刀收回鞘里，抬头看了看天色，然后走进巷子。'
    const kinds = detectAiTraces(text).map(f => f.kind)
    expect(kinds).not.toContain('list-enumeration')
    expect(kinds).not.toContain('cliche-expression')
    expect(kinds).not.toContain('transition-template')
  })
})
