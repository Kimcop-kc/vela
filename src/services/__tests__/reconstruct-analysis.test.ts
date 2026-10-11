/**
 * 拆书分析（纯函数）
 *
 * 这些是「不该花模型额度也能验证」的部分：
 *   - 超长章节按预算截断并标注；
 *   - 目标章节挑选（补缺 / 重试失败 / 指定章节 / 不重复分析）；
 *   - 模型返回的脏 JSON 归一化：推测标 inference、缺字段记 warning、不许静默丢内容；
 *   - 正文指纹：正文没变就算「已分析」。
 */
import { describe, expect, it } from 'vitest'
import { normalizeChapterAnalysis, stripJsonFence, TECHNIQUE_LABELS } from '../reconstruct/analysis-prompt'
import { clampChapterText, hashChapterText, indexAnalyses, parseAnalysisJson, pickAnalysisTargets } from '../reconstruct/analysis-service'
import { TECHNIQUE_KEYS, type BookAnalysisRecord } from '../../shared/reconstruct'
import type { BookChapterEntry } from '../../shared/ipc-channels'

const chapters: BookChapterEntry[] = [1, 2, 3, 4].map(number => ({
  number, title: `第 ${number} 章`, wordCount: 3000, docId: `doc-${number}`, fileName: `书 · 第 ${number} 章`,
}))

const record = (chapterNumber: number, status: 'done' | 'failed', sourceHash = `h${chapterNumber}`): BookAnalysisRecord => ({
  id: chapterNumber, bookId: 'b', bookName: '参考书', chapterNumber, chapterTitle: '', docId: `doc-${chapterNumber}`,
  analysisType: 'chapter', status, modelId: 'm', error: '', sourceHash, result: null,
  createdAt: '', updatedAt: '',
})

describe('章节目标挑选', () => {
  const existing = indexAnalyses([record(1, 'done'), record(2, 'failed')])

  it('默认只补没分析过的章节，重复点击不会重复烧额度', () => {
    const { targets, skipped } = pickAnalysisTargets(chapters, existing, { mode: 'all' })
    expect(targets.map(c => c.number)).toEqual([3, 4])
    expect(skipped).toBe(2)
  })

  it('显式要求覆盖时，已有结果的章节也会重跑', () => {
    const { targets } = pickAnalysisTargets(chapters, existing, { mode: 'all', skipExisting: false })
    expect(targets.map(c => c.number)).toEqual([1, 2, 3, 4])
  })

  it('只重试失败章节 / 只分析没做过的章节', () => {
    expect(pickAnalysisTargets(chapters, existing, { mode: 'failed' }).targets.map(c => c.number)).toEqual([2])
    expect(pickAnalysisTargets(chapters, existing, { mode: 'missing' }).targets.map(c => c.number)).toEqual([3, 4])
  })

  it('指定章节时按给定集合取（忽略已有结果）', () => {
    expect(pickAnalysisTargets(chapters, existing, { mode: 'selected', selected: [1, 4] }).targets.map(c => c.number)).toEqual([1, 4])
  })

  it('越界或未知的选中编号不会凭空造出章节', () => {
    expect(pickAnalysisTargets(chapters, existing, { mode: 'selected', selected: [99] }).targets).toEqual([])
  })
})

describe('超长章节截断', () => {
  it('短章节原样返回，不标注截断', () => {
    const text = '短正文。'
    expect(clampChapterText(text, 100)).toEqual({ text, truncated: false })
  })

  it('长章节在段落边界收尾，并明确标注截断', () => {
    const paragraph = '这是一段用来占位的正文，用来把预算撑满。'.repeat(6)
    const text = Array.from({ length: 40 }, () => paragraph).join('\n\n')
    const clamped = clampChapterText(text, 200)

    expect(clamped.truncated).toBe(true)
    expect(clamped.text.length).toBeLessThan(text.length)
    expect(clamped.text.endsWith('。')).toBe(true)
  })

  it('整章只有一大段时退化为按字符粗切，仍会返回内容', () => {
    const text = '长'.repeat(50000)
    const clamped = clampChapterText(text, 100)
    expect(clamped.truncated).toBe(true)
    expect(clamped.text.length).toBeGreaterThan(0)
  })
})

describe('正文指纹', () => {
  it('同样正文指纹一致，正文变化指纹变化', () => {
    expect(hashChapterText('第一章正文')).toBe(hashChapterText('第一章正文'))
    expect(hashChapterText('第一章正文')).not.toBe(hashChapterText('第一章正文。'))
  })

  it('超长正文只抽样首尾，仍然稳定且能反映变化', () => {
    const head = 'A'.repeat(30000)
    expect(hashChapterText(head)).toBe(hashChapterText(head))
    expect(hashChapterText(head + '结尾')).not.toBe(hashChapterText(head + '另一结尾'))
  })
})

describe('模型返回的归一化', () => {
  it('剥掉代码块围栏', () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripJsonFence('{"a":1}')).toBe('{"a":1}')
  })

  it('结构完整时字段一一映射，不产生 warning', () => {
    const techniques = Object.fromEntries(TECHNIQUE_KEYS.map(key => [key, `${TECHNIQUE_LABELS[key]}的具体做法`]))
    const result = normalizeChapterAnalysis({
      summary: '主角在山门试探封印。',
      protagonist: '云玉辞',
      characters: [{ name: '云玉辞', identity: '外门弟子', goal: '入内门', motive: '复仇', personality: '克制', relationships: '与师兄弟疏离', change: '开始主动', interestConflict: '与同门争名额' }],
      locations: ['山门'],
      items: ['残简'],
      keyEvents: ['试探封印', '被师兄发现'],
      plotStructure: {
        coreEvent: '试探封印', goal: '确认封印虚实', protagonistAction: '夜里潜入', obstacle: '巡夜师兄',
        escalation: '被喝止', resolution: '谎称迷路', twist: '封印上有逆旋纹', outcome: '确认有人动过封印', impactOnLater: '引出师父',
      },
      conflicts: [{ parties: ['云玉辞', '师兄'], cause: '夜探', escalation: '对峙', resolution: '暂时收场' }],
      techniques,
      hooks: [{ content: '逆旋纹', position: '第 3 段', purpose: '指向师父', status: 'planted', basis: 'text', confidence: 'high' }],
      evidence: [{ claim: '封印被改动过', quote: '逆旋纹烫出来的痕迹', basis: 'inference', confidence: 'medium' }],
    }, { chapterNumber: 7, chapterTitle: '第七章' })

    expect(result.chapterNumber).toBe(7)
    expect(result.characters[0].interestConflict).toContain('名额')
    expect(result.techniques.cliffhanger).toContain('结尾悬念')
    expect(result.hooks[0].status).toBe('planted')
    expect(result.evidence[0].basis).toBe('inference')
    expect(result.warnings).toEqual([])
  })

  it('缺字段只记 warning，不抛错、不编内容', () => {
    const result = normalizeChapterAnalysis({ summary: '只有概要。' }, { chapterNumber: 3, chapterTitle: '第三章' })

    expect(result.summary).toBe('只有概要。')
    expect(result.characters).toEqual([])
    expect(result.keyEvents).toEqual([])
    expect(result.warnings.some(w => w.includes('关键事件'))).toBe(true)
    expect(result.warnings.some(w => w.includes('叙事技巧'))).toBe(true)
    expect(result.warnings.some(w => w.includes('剧情结构'))).toBe(true)
  })

  it('模型把推测写成事实时按 basis 字段归类，中文别名也认', () => {
    const result = normalizeChapterAnalysis({
      summary: 's', keyEvents: ['e'],
      hooks: [{ content: 'a', basis: '推测', confidence: '低' }, { content: 'b', basis: '原文', confidence: '高' }],
    }, { chapterNumber: 1, chapterTitle: '第一章' })

    expect(result.hooks[0].basis).toBe('inference')
    expect(result.hooks[0].confidence).toBe('low')
    expect(result.hooks[1].basis).toBe('text')
    expect(result.hooks[1].confidence).toBe('high')
  })

  it('数组里混进字符串、对象、null 都不会崩，也不会丢信息', () => {
    const result = normalizeChapterAnalysis({
      summary: 's',
      keyEvents: ['事件一', { title: '事件二' }, null],
      characters: ['只有名字'],
      locations: '山门、渡口',
      items: null,
    }, { chapterNumber: 2, chapterTitle: '第二章' })

    expect(result.keyEvents).toEqual(['事件一', '事件二'])
    expect(result.characters[0].name).toBe('只有名字')
    // 中英顿号/分号连接的字符串会拆成多项，不当成一个地点
    expect(result.locations).toEqual(['山门', '渡口'])
    expect(result.items).toEqual([])
  })

  it('完全解析不出来时给出空骨架并说明原因', () => {
    const result = normalizeChapterAnalysis(null, { chapterNumber: 5, chapterTitle: '第五章' })
    expect(result.summary).toBe('')
    expect(result.warnings[0]).toContain('没有返回可解析的 JSON')
  })
})

describe('模型 JSON 解析', () => {
  it('解析标准 JSON 与代码块', () => {
    expect(parseAnalysisJson('{"summary":"a"}')).toMatchObject({ summary: 'a' })
    expect(parseAnalysisJson('```json\n{"summary":"b"}\n```')).toMatchObject({ summary: 'b' })
  })

  it('输出被截断时保留已经写完的字段（不丢 summary）', () => {
    const cases = [
      '{"summary":"a","keyEvents":["一","二"],"characters":[{"name":"甲"}',
      '{"summary":"a","characters":[{"name":"甲"',
      '{"summary":"a","characters":[{"name":"甲","identity":"外门弟子"}],',
    ]
    for (const truncated of cases) {
      const parsed = parseAnalysisJson(truncated) as Record<string, unknown> | null
      expect(parsed).toBeTruthy()
      expect(parsed?.summary).toBe('a')
    }
  })

  it('完全不是 JSON 时返回 null，交给上层记失败', () => {
    expect(parseAnalysisJson('模型今天不想输出结构化内容')).toBeNull()
    expect(parseAnalysisJson('')).toBeNull()
  })

  it('截断的 JSON 归一化后仍能产出可用结论', () => {
    const truncated = '{"summary":"主角试探封印。","keyEvents":["潜入","被喝止"],"characters":[{"name":"云玉辞","identity":"外门弟子"}'
    const normalized = normalizeChapterAnalysis(parseAnalysisJson(truncated), { chapterNumber: 9, chapterTitle: '第九章' })

    expect(normalized.summary).toBe('主角试探封印。')
    expect(normalized.keyEvents).toEqual(['潜入', '被喝止'])
    expect(normalized.characters[0].identity).toBe('外门弟子')
  })
})
