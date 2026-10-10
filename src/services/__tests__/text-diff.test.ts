/**
 * 选区 AI 操作的「逐词对比」测试
 *
 * 润色/改写要能看出改了哪些字，所以对比结果必须满足两条硬性质：
 * 只取「非删除」片段能拼回新文本，只取「非新增」片段能拼回原文（否则界面会显示错位）。
 */
import { describe, expect, it } from 'vitest'
import {
  applyInlineDiffSelection, computeBlockDiff, computeInlineDiff, extractParagraphs,
  splitInlineDiffIntoLines, stripFrontmatter, type InlineDiffResult,
} from '../text-diff'

/** 删除用 -x- 标、新增用 +x+ 标，便于断言标记位置 */
const render = (r: InlineDiffResult) =>
  r.segments.map(s => (s.kind === 'same' ? s.text : s.kind === 'add' ? `+${s.text}+` : `-${s.text}-`)).join('')

describe('computeInlineDiff', () => {
  it('中文润色的改动位置标得准', () => {
    const before = '他缓缓地走过去，看着那扇门，说道：“你来了。”'
    const after = '他走过去，盯着那扇门，说：“你来了。”'
    const result = computeInlineDiff(before, after)

    expect(render(result)).toBe('他-缓缓地-走过去，-看-+盯+着那扇门，说-道-：“你来了。”')
    expect(result.changeGroups).toBe(3)
    expect(result.addedChars).toBe(1)
    expect(result.removedChars).toBe(5)
  })

  it('片段拼回去分别等于新旧文本', () => {
    const before = '顾野把炭笔收进暗袋，抬头看了看天色。'
    const after = '顾野收起炭笔，抬眼看了看天。'
    const { segments } = computeInlineDiff(before, after)

    expect(segments.filter(s => s.kind !== 'remove').map(s => s.text).join('')).toBe(after)
    expect(segments.filter(s => s.kind !== 'add').map(s => s.text).join('')).toBe(before)
  })

  it('完全一致时标记为 identical', () => {
    const result = computeInlineDiff('完全一样的一段。', '完全一样的一段。')

    expect(result.identical).toBe(true)
    expect(result.changeGroups).toBe(0)
    expect(result.addedChars).toBe(0)
    expect(result.removedChars).toBe(0)
  })

  it('结尾追加只算新增', () => {
    const result = computeInlineDiff('他走进院子。', '他走进院子。\n\n院里有风。')

    expect(result.removedChars).toBe(0)
    expect(result.addedChars).toBeGreaterThan(0)
    expect(result.changeGroups).toBe(1)
  })

  it('原文为空时全部算新增', () => {
    const result = computeInlineDiff('', '新增的内容。')

    expect(result.addedChars).toBe(6)
    expect(result.removedChars).toBe(0)
  })

  it('整段重写也能给出可渲染的片段', () => {
    const result = computeInlineDiff('短句。', '换了一整句完全不同的内容。')

    expect(result.identical).toBe(false)
    expect(result.segments.length).toBeGreaterThan(0)
  })

  it('超长文本退化为粗粒度结果，不卡界面', () => {
    const result = computeInlineDiff('甲'.repeat(20001), '乙'.repeat(20001))

    expect(result.tooLong).toBe(true)
    expect(result.changeGroups).toBe(1)
  })

  it('每处改动的原文与改写片段都能取出来', () => {
    const result = computeInlineDiff('他缓缓地走过去，看着那扇门，说道：“你来了。”', '他走过去，盯着那扇门，说：“你来了。”')

    expect(result.changes).toEqual([
      { removed: '缓缓地', added: '' },
      { removed: '看', added: '盯' },
      { removed: '道', added: '' },
    ])
  })

  it('全部保留等于新文本，全部退回等于原文', () => {
    const before = '他缓缓地走过去，看着那扇门，说道：“你来了。”'
    const after = '他走过去，盯着那扇门，说：“你来了。”'
    const result = computeInlineDiff(before, after)

    expect(applyInlineDiffSelection(result, new Set())).toBe(after)
    expect(applyInlineDiffSelection(result, new Set([0, 1, 2]))).toBe(before)
  })

  it('只保留部分改动时其余位置退回原文', () => {
    const before = '他缓缓地走过去，看着那扇门，说道：“你来了。”'
    const after = '他走过去，盯着那扇门，说：“你来了。”'
    const result = computeInlineDiff(before, after)

    // 只采纳「看 → 盯」这一处
    expect(applyInlineDiffSelection(result, new Set([0, 2]))).toBe('他缓缓地走过去，盯着那扇门，说道：“你来了。”')
  })

  it('逐词片段按行切开后仍能分别拼回新旧文本', () => {
    const refined = computeInlineDiff('甲第一行\n甲第二行', '乙第一行\n乙第二行')
    const originalLines = splitInlineDiffIntoLines(refined.segments, 'original')
    const modifiedLines = splitInlineDiffIntoLines(refined.segments, 'modified')

    expect(originalLines.map(l => l.map(p => p.text).join('')).join('\n')).toBe('甲第一行\n甲第二行')
    expect(modifiedLines.map(l => l.map(p => p.text).join('')).join('\n')).toBe('乙第一行\n乙第二行')
    expect(originalLines[0].some(p => p.kind === 'remove')).toBe(true)
    expect(modifiedLines[0].some(p => p.kind === 'add')).toBe(true)
  })

  it('两侧行数不同（段落合并/拆分）时不会串行', () => {
    // 原文两行 → 修稿一行：按修稿侧切分必须只得到一行
    const refined = computeInlineDiff('甲第一行\n甲第二行', '甲第一行甲第二行')

    const originalLines = splitInlineDiffIntoLines(refined.segments, 'original')
    const modifiedLines = splitInlineDiffIntoLines(refined.segments, 'modified')

    expect(modifiedLines.map(l => l.map(p => p.text).join('')).join('\n')).toBe('甲第一行甲第二行')
    expect(originalLines.map(l => l.map(p => p.text).join('')).join('\n')).toBe('甲第一行\n甲第二行')
  })
})

// ============================================================
// 段落层：整章修稿的三栏合并按这一层对齐原文与修稿
// ============================================================
describe('computeBlockDiff 段落对齐', () => {
  const p1 = '顾野把炭笔收进暗袋，抬头看了看天色。'
  const p2 = '风从裂谷里灌上来，带着铁锈味。'
  const p3 = '他记得师父说过的话。'

  it('完全一致时没有任何变更块', () => {
    const { segments, hunks } = computeBlockDiff(`${p1}\n\n${p2}`, `${p1}\n\n${p2}`)

    expect(hunks).toHaveLength(0)
    expect(segments.every(s => s.type === 'same')).toBe(true)
  })

  it('润色一段：一处变更块，且相似度足够做逐词标注', () => {
    const { hunks } = computeBlockDiff(`${p1}\n\n${p2}`, `顾野收起炭笔，抬眼看了看天。\n\n${p2}`)

    expect(hunks).toHaveLength(1)
    expect(hunks[0].similarity).toBeGreaterThanOrEqual(0.5)
  })

  it('整段重写：相似度低，合并窗口不逐词标注', () => {
    const { hunks } = computeBlockDiff(`${p1}\n\n${p2}`, `他走进神殿，跪下祈祷。\n\n${p2}`)

    expect(hunks[0].similarity).toBeLessThan(0.5)
  })

  it('一段拆成两段时仍是一处变更块', () => {
    const { hunks } = computeBlockDiff(`${p1}\n\n${p2}`, `顾野把炭笔收进暗袋。\n\n他抬头看了看天色。\n\n${p2}`)

    expect(hunks).toHaveLength(1)
    // 改后侧是 2 段 + 段间空行 = 3 行
    expect(hunks[0].originalLines).toHaveLength(1)
    expect(hunks[0].modifiedLines).toHaveLength(3)
  })

  it('新增段落与删除段落各成一处变更块', () => {
    const added = computeBlockDiff(p1, `${p1}\n\n${p3}`)
    expect(added.hunks).toHaveLength(1)
    expect(added.hunks[0].originalLines).toHaveLength(0)
    expect(added.hunks[0].modifiedLines).toHaveLength(1)

    const deleted = computeBlockDiff(`${p1}\n\n${p3}`, p1)
    expect(deleted.hunks).toHaveLength(1)
    expect(deleted.hunks[0].originalLines).toHaveLength(1)
    expect(deleted.hunks[0].modifiedLines).toHaveLength(0)
  })

  it('frontmatter 不参与对齐', () => {
    const withFm = `---\ntitle: 第一章\n---\n${p1}`

    expect(computeBlockDiff(withFm, withFm).hunks).toHaveLength(0)
    expect(stripFrontmatter(withFm)).toBe(p1)
    expect(extractParagraphs('甲\n\n乙\n丙')).toHaveLength(2)
    expect(computeBlockDiff('', '').segments).toHaveLength(0)
  })
})
