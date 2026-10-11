/**
 * 相似度检查与剧情重构（纯函数）
 *
 * 这一层不调用模型，所以必须靠测试锁住行为：
 *   - 相似度是「提示」不是判定：依据不足时给 undetermined，不硬凑分数；
 *   - 通用表达不误报，真正的连续重复与近重复句必须报出来；
 *   - 送进模型的参考材料里不许出现参考作品的人名。
 */
import { describe, expect, it } from 'vitest'
import {
  buildPlotFindings, buildSimilarityReport, buildTextFindings, deriveOverallRisk,
  findCommonRuns, findNearDuplicateSentences, normalizeForCompare, textSimilarity,
} from '../reconstruct/similarity'
import { buildBeatDraftPrompt, beatCoverage, composeChapterText } from '../reconstruct/draft-service'
import { buildSourceDigest, normalizePlotOutline } from '../reconstruct/outline-service'
import type { BookAnalysisRecord, ChapterAnalysis, PlotBeat, PlotOutlineRecord } from '../../shared/reconstruct'

const referenceText = [
  '夜色像一块湿透的布，压在青石镇的屋脊上。云玉辞把斗笠压得更低，沿着河堤往南走了半个时辰。',
  '他在渡口停下，从怀里摸出那半截炭笔，在木板背面画了一道顺旋的引火纹。火焰贴着木纹窜起来的时候，他听见背后有人咳了一声。',
].join('\n')

const beat: PlotBeat = {
  sequence: 1, title: '夜渡',
  event: '主角连夜渡河投奔北境', protagonistAction: '沿河堤南行，在渡口点火',
  conflict: '被巡夜的旧识撞见', consequence: '行踪泄露', characterChange: '开始学会隐瞒', hook: '对岸有人等他',
}

describe('相似度：本地算法', () => {
  it('归一化去掉标点与空白后比对', () => {
    expect(normalizeForCompare('夜色，像一块湿透的布。')).toBe('夜色像一块湿透的布')
    expect(textSimilarity('他在渡口停下，摸出半截炭笔', '他在渡口停下 摸出半截炭笔')).toBe(1)
  })

  it('连续重复能定位到具体片段', () => {
    const generated = `开场是一段完全不同的描写。${referenceText}后面又接回自己的内容。`
    const runs = findCommonRuns(generated, referenceText)

    expect(runs.length).toBeGreaterThan(0)
    expect(runs[0].length).toBeGreaterThanOrEqual(12)
    expect(runs[0].referenceStart).toBeGreaterThanOrEqual(0)
    expect(referenceText.slice(runs[0].referenceStart, runs[0].referenceStart + runs[0].length)).toBe(runs[0].text)
  })

  it('自己的原创表达不会被当成重复', () => {
    const mine = '雨丝斜着扎进领口，他把斗笠往上推了推，问船家几时开船。'
    expect(findCommonRuns(mine, referenceText)).toHaveLength(0)
    expect(findNearDuplicateSentences(mine, referenceText)).toHaveLength(0)
  })

  it('近重复句按相似度报出并分级', () => {
    const generated = '夜色像一块湿透的布，压在青石镇的屋顶上。云玉辞压低斗笠，沿着河堤往南走了半个时辰。'
    const pairs = findNearDuplicateSentences(generated, referenceText)

    expect(pairs.length).toBeGreaterThan(0)
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(0.68)
    expect(buildTextFindings(generated, [{ chapterNumber: 3, bookId: 'b', bookName: '参考书', text: referenceText }]).findings.some(f => f.category === 'sentence')).toBe(true)
  })

  it('文本太短时返回 null 而不是瞎猜', () => {
    expect(textSimilarity('短', '短')).toBeNull()
    expect(textSimilarity('', '')).toBeNull()
  })
})

describe('相似度：风险等级', () => {
  it('没有参考材料时是 undetermined，不是 low', () => {
    const report = buildSimilarityReport({ generated: '一段新写的正文。', references: [] })
    expect(report.overallRisk).toBe('undetermined')
    expect(report.findings).toEqual([])
    expect(report.summary).toContain('无法给出风险判断')
  })

  it('比过且没命中就是 low；有 high 就是 high', () => {
    const clean = buildSimilarityReport({
      generated: '这是一段全新写的文字，讲的是另一个镇子里的另一件事，人物与情节都与参考不同。',
      references: [{ chapterNumber: 1, bookId: 'b', bookName: '参考书', text: referenceText }],
    })
    expect(clean.overallRisk).toBe('low')

    const copied = buildSimilarityReport({
      generated: referenceText,
      references: [{ chapterNumber: 1, bookId: 'b', bookName: '参考书', text: referenceText }],
    })
    expect(copied.overallRisk).toBe('high')
    expect(copied.stats.longestCommonRun).toBeGreaterThan(40)
  })

  it('等级由发现推导：warning→medium，high→high，空→low', () => {
    expect(deriveOverallRisk([], 3)).toBe('low')
    expect(deriveOverallRisk([{ category: 'text', severity: 'warning', description: '', sourceReference: '', generatedReference: '', recommendation: '', similarity: null }], 3)).toBe('medium')
    expect(deriveOverallRisk([{ category: 'text', severity: 'high', description: '', sourceReference: '', generatedReference: '', recommendation: '', similarity: null }], 3)).toBe('high')
  })
})

describe('相似度：情节层', () => {
  const analysis: BookAnalysisRecord = {
    id: 1, bookId: 'b', bookName: '参考书', chapterNumber: 5, chapterTitle: '第五章', docId: 'd',
    analysisType: 'chapter', status: 'done', modelId: '', error: '', sourceHash: '',
    result: {
      chapterNumber: 5, chapterTitle: '第五章', summary: '', protagonist: '',
      characters: [{ name: '云玉辞', identity: '', goal: '', motive: '', personality: '', relationships: '', change: '', interestConflict: '' }],
      locations: [], items: [], keyEvents: ['主角连夜渡河投奔北境'],
      plotStructure: { coreEvent: '', goal: '', protagonistAction: '', obstacle: '', escalation: '', resolution: '', twist: '', outcome: '', impactOnLater: '' },
      conflicts: [{ parties: [], cause: '被巡夜旧识撞见', escalation: '', resolution: '谎称迷路' }],
      techniques: {} as ChapterAnalysis['techniques'],
      hooks: [], evidence: [], warnings: [],
    },
    createdAt: '', updatedAt: '',
  }

  it('事件高度对应会被点名（情节类）', () => {
    const findings = buildPlotFindings([beat], [analysis])
    expect(findings.some(finding => finding.category === 'plot')).toBe(true)
  })

  it('参考作品的人名出现在大纲里会被提示', () => {
    const findings = buildPlotFindings([{ ...beat, event: '云玉辞连夜渡河投奔北境' }], [analysis])
    expect(findings.some(finding => finding.category === 'character')).toBe(true)
  })

  it('完全不同的节点不报情节相似', () => {
    const mine: PlotBeat = { ...beat, title: '集市', event: '主角在集市上讨价还价买了一把旧伞', conflict: '摊主识破他在撒谎', protagonistAction: '砍价', consequence: '被记住', characterChange: '', hook: '' }
    const findings = buildPlotFindings([mine], [analysis])
    expect(findings.filter(finding => finding.category === 'plot')).toHaveLength(0)
  })
})

describe('剧情重构：参考材料脱敏与归一化', () => {
  const analysis: BookAnalysisRecord = {
    id: 9, bookId: 'b', bookName: '参考书', chapterNumber: 7, chapterTitle: '第七章', docId: 'd',
    analysisType: 'chapter', status: 'done', modelId: '', error: '', sourceHash: '',
    result: {
      chapterNumber: 7, chapterTitle: '第七章', summary: '云玉辞试探封印。', protagonist: '云玉辞',
      characters: [{ name: '云玉辞', identity: '', goal: '', motive: '', personality: '', relationships: '', change: '', interestConflict: '' }],
      locations: [], items: [], keyEvents: ['云玉辞夜里潜入封印地'],
      plotStructure: { coreEvent: '试探封印', goal: '', protagonistAction: '', obstacle: '', escalation: '被师兄喝止', resolution: '', twist: '', outcome: '确认封印被动过', impactOnLater: '' },
      conflicts: [{ parties: ['云玉辞'], cause: '夜探', escalation: '对峙', resolution: '谎称迷路' }],
      techniques: {
        opening: '用动作开场，云玉辞先动再说话', conflictSetup: '让师兄突然出现', infoRelease: '先给现象后给结论',
        characterDrive: '被期限逼着走', expectation: '反复提三日之限', cliffhanger: '结尾停在井口',
        chapterLink: '承接上章末尾的脚步声', pacing: '短段推进',
      } as ChapterAnalysis['techniques'],
      hooks: [{ content: '井里的逆旋纹', position: '末段', purpose: '指向师父', status: 'planted', basis: 'text', confidence: 'high' }],
      evidence: [], warnings: [],
    },
    createdAt: '', updatedAt: '',
  }

  it('送进模型的材料里不留参考作品人名', () => {
    const digest = buildSourceDigest([analysis], ['opening'], false)
    expect(digest).not.toContain('云玉辞')
    expect(digest).toContain('角色甲')
  })

  it('「只借鉴技巧」时不带具体事件序列', () => {
    const withPlot = buildSourceDigest([analysis], ['conflictSetup'], false)
    const techniquesOnly = buildSourceDigest([analysis], ['conflictSetup'], true)

    expect(withPlot).toContain('事件序列')
    expect(techniquesOnly).not.toContain('事件序列')
    expect(techniquesOnly).toContain('让师兄突然出现')
  })

  it('归一化：节点补齐序号、丢弃空节点、缺字段记提醒', () => {
    const { outline, warnings } = normalizePlotOutline({
      title: '北境',
      premise: 'p',
      beats: [
        { sequence: 'x', event: '事件一', hook: '钩子一' },
        { title: '空节点' },
        { sequence: 2, event: '事件二', protagonistAction: '行动二' },
      ],
    }, { techniques: ['pacing'], sources: [], fallbackTitle: '兜底标题' })

    expect(outline.title).toBe('北境')
    expect(outline.beats).toHaveLength(2)
    expect(outline.beats.map(item => item.sequence)).toEqual([1, 2])
    expect(outline.beats[0].title).toBe('节点 1')
    expect(warnings.some(w => w.includes('缺少'))).toBe(true)
  })

  it('一个节点都没有时给出空大纲与明确的提醒', () => {
    const { outline, warnings } = normalizePlotOutline({}, { techniques: [], sources: [], fallbackTitle: '兜底' })
    expect(outline.title).toBe('兜底')
    expect(outline.beats).toEqual([])
    expect(warnings[0]).toContain('没有给出可用的剧情节点')
  })
})

describe('正文生成：提示词与拼装', () => {
  const outline = { title: '北境', premise: 'p' } as PlotOutlineRecord

  it('提示词带上本段大纲、前文结尾与硬性要求', () => {
    const messages = buildBeatDraftPrompt({
      outline, beat, previousText: '上一段结尾。', canonRendered: '【正史设定】…', ownNovel: '世界观：灵潮',
      targetWords: 800, guidance: '第三人称，克制', instruction: '对话多一点',
    })
    const all = messages.map(message => message.content).join('\n')

    expect(all).toContain('夜渡')
    expect(all).toContain('上一段结尾')
    expect(all).toContain('正史设定')
    expect(all).toContain('对话多一点')
    expect(all).toContain('800 字')
    expect(all).not.toContain('undefined')
  })

  it('段落拼接跳过空段，段间留空行', () => {
    const text = composeChapterText([
      { sequence: 1, title: 'a', text: '第一段。', wordCount: 4 },
      { sequence: 2, title: 'b', text: '   ', wordCount: 0 },
      { sequence: 3, title: 'c', text: '第二段。', wordCount: 4 },
    ])
    expect(text).toBe('第一段。\n\n第二段。')
  })

  it('节点覆盖度能看出「这段没写到要求」', () => {
    const good = '他沿河堤南行，在渡口点火，却被巡夜的旧识撞见。'
    expect(beatCoverage(good, beat)).toBeGreaterThan(0.5)
    expect(beatCoverage('他在屋里喝茶，聊了很久天气。', beat)).toBeLessThan(0.3)
  })
})
