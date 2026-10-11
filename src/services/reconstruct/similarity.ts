/**
 * 原创性与相似度辅助检查 —— 本地算法优先
 *
 * 定位（对齐任务文档八）：
 *   - 这是**提示**，不是判定：报告只指出「值得再看一眼的地方」，
 *     不宣称作品必然原创、也不宣称必然侵权；
 *   - 能本地算的全部本地算（连续重复、近重复句、情节结构对应），不为了算相似度去调模型；
 *   - 依据不足时给 undetermined，不硬凑一个分数。
 *
 * 通用题材、常见设定、普遍叙事结构本身不是问题，所以这里只报「具体的重合」：
 * 连续重复的文本、逐句近似、以及大纲节点与参考章节的事件/冲突/人物对应。
 */
import { splitSentenceSpans } from '../text-analysis'
import type {
  BookAnalysisRecord, PlotBeat, SimilarityFinding, SimilarityReportPayload, SimilarityRisk, SimilarityStats,
} from '../../shared/reconstruct'

/** 判定为「连续重复」的最短长度（字符，先去掉空白与标点再比） */
export const MIN_COMMON_RUN = 12
/** 超过这个长度就不再是巧合，直接按高风险提示 */
export const HIGH_RISK_RUN = 40
/** 近重复句的相似度阈值（2-gram Dice 系数） */
export const NEAR_DUPLICATE_THRESHOLD = 0.68
/** 情节层的对应阈值 */
export const PLOT_MATCH_THRESHOLD = 0.62
export const PLOT_HIGH_THRESHOLD = 0.8

/** 只保留用于比对的内容：去掉空白、标点与常见装饰符号 */
export function normalizeForCompare(text: string): string {
  return (text ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。！？；：、“”‘’（）《》〈〉【】…—～·,.!?;:"'()<>[\]{}-]/g, '')
}

/** 字符 n-gram 集合（n=2） */
function bigrams(text: string): Set<string> {
  const set = new Set<string>()
  for (let index = 0; index + 1 < text.length; index++) set.add(text.slice(index, index + 2))
  if (text.length === 1) set.add(text)
  return set
}

/** 两段文本的相似度（2-gram Dice），[0,1]；过短或空文本返回 null（无法判断） */
export function textSimilarity(a: string, b: string): number | null {
  const left = normalizeForCompare(a)
  const right = normalizeForCompare(b)
  if (left.length < 4 || right.length < 4) return null
  const leftSet = bigrams(left)
  const rightSet = bigrams(right)
  let shared = 0
  for (const gram of leftSet) if (rightSet.has(gram)) shared += 1
  const total = leftSet.size + rightSet.size
  return total === 0 ? null : Math.round((2 * shared / total) * 1000) / 1000
}

export interface CommonRun {
  length: number
  generatedStart: number
  referenceStart: number
  text: string
}

/**
 * 包含度：短的那一边有多少被长的那一边覆盖。
 *
 * 情节比对不能直接用 Dice：大纲节点往往比参考事件长得多，
 * 同样的重合在 Dice 下会被长度差摊薄（11 字的事件对上 30 字的节点只剩 0.5）。
 * 这里用「较短一侧被覆盖的比例」，才能反映「这个节点就是照着那条事件写的」。
 */
export function containmentSimilarity(a: string, b: string): number | null {
  const left = normalizeForCompare(a)
  const right = normalizeForCompare(b)
  if (left.length < 4 || right.length < 4) return null
  const leftSet = bigrams(left)
  const rightSet = bigrams(right)
  let shared = 0
  for (const gram of leftSet) if (rightSet.has(gram)) shared += 1
  const smaller = Math.min(leftSet.size, rightSet.size)
  return smaller === 0 ? null : Math.round((shared / smaller) * 1000) / 1000
}

/**
 * 找连续重复片段。
 *
 * 做法：用参考文本的 k-gram 建索引（k = minRun），扫描新稿；命中处向两边扩展，
 * 得到真实重复长度后跳过，避免同一段重复报很多次。复杂度与文本长度近似线性。
 */
export function findCommonRuns(
  generated: string,
  reference: string,
  minRun = MIN_COMMON_RUN,
  maxRuns = 20,
): CommonRun[] {
  if (!generated || !reference || minRun < 2) return []
  const index = new Map<string, number[]>()
  for (let i = 0; i + minRun <= reference.length; i++) {
    const gram = reference.slice(i, i + minRun)
    const bucket = index.get(gram)
    if (bucket) bucket.push(i)
    else index.set(gram, [i])
  }

  const runs: CommonRun[] = []
  let cursor = 0
  while (cursor + minRun <= generated.length) {
    const bucket = index.get(generated.slice(cursor, cursor + minRun))
    if (!bucket) { cursor += 1; continue }
    let best: CommonRun | null = null
    for (const start of bucket) {
      let length = minRun
      while (
        cursor + length < generated.length
        && start + length < reference.length
        && generated[cursor + length] === reference[start + length]
      ) length += 1
      if (!best || length > best.length) {
        best = { length, generatedStart: cursor, referenceStart: start, text: generated.slice(cursor, cursor + length) }
      }
    }
    if (best) {
      runs.push(best)
      cursor += Math.max(minRun, Math.floor(best.length / 2))
    } else {
      cursor += 1
    }
  }
  return runs.sort((a, b) => b.length - a.length).slice(0, maxRuns)
}

export interface SentencePair {
  generated: string
  reference: string
  similarity: number
}

/** 近重复句：逐句比对，相似度超过阈值就报出来 */
export function findNearDuplicateSentences(
  generated: string,
  reference: string,
  threshold = NEAR_DUPLICATE_THRESHOLD,
  maxPairs = 20,
): SentencePair[] {
  const generatedSentences = splitSentenceSpans(generated).map(span => span.text.trim()).filter(text => normalizeForCompare(text).length >= 8)
  const referenceSentences = splitSentenceSpans(reference).map(span => span.text.trim()).filter(text => normalizeForCompare(text).length >= 8)
  const pairs: SentencePair[] = []
  for (const left of generatedSentences) {
    let best: SentencePair | null = null
    for (const right of referenceSentences) {
      const score = textSimilarity(left, right)
      if (score == null || score < threshold) continue
      if (!best || score > best.similarity) best = { generated: left, reference: right, similarity: score }
    }
    if (best) pairs.push(best)
  }
  return pairs.sort((a, b) => b.similarity - a.similarity).slice(0, maxPairs)
}

/** 参考材料的正文（一章一份） */
export interface ReferenceChapter {
  chapterNumber: number
  bookId: string
  bookName: string
  text: string
}

/** 文本层：连续重复 + 近重复句 */
export function buildTextFindings(generated: string, references: ReferenceChapter[]): { findings: SimilarityFinding[]; longestRun: number; nearDuplicates: number } {
  const findings: SimilarityFinding[] = []
  let longestRun = 0
  let nearDuplicates = 0

  for (const reference of references) {
    for (const run of findCommonRuns(generated, reference.text)) {
      longestRun = Math.max(longestRun, run.length)
      findings.push({
        category: run.length >= 40 ? 'paragraph' : 'text',
        severity: run.length >= HIGH_RISK_RUN ? 'high' : run.length >= 20 ? 'warning' : 'info',
        description: `与参考文本有 ${run.length} 字连续重合：${run.text.slice(0, 60)}${run.text.length > 60 ? '…' : ''}`,
        sourceReference: `${reference.bookName} 第 ${reference.chapterNumber} 章`,
        generatedReference: `新稿第 ${Math.floor(run.generatedStart / 1000) + 1} 个千字区间（约第 ${run.generatedStart} 字起）`,
        recommendation: '这段如果是照搬，请改写表达与叙述角度；如果是必要引用，请标注出处或删减到最短。',
        similarity: null,
      })
    }
    const pairs = findNearDuplicateSentences(generated, reference.text)
    nearDuplicates += pairs.length
    for (const pair of pairs) {
      findings.push({
        category: 'sentence',
        severity: pair.similarity >= 0.85 ? 'high' : 'warning',
        description: `存在高度接近的句子（相似度 ${(pair.similarity * 100).toFixed(0)}%）：${pair.generated.slice(0, 40)}…`,
        sourceReference: `${reference.bookName} 第 ${reference.chapterNumber} 章：${pair.reference.slice(0, 40)}…`,
        generatedReference: pair.generated.slice(0, 40),
        recommendation: '换掉句式与意象，或把信息拆到动作与对话里；单句改写不够时整段重写。',
        similarity: pair.similarity,
      })
    }
  }

  // 只报最严重的一批，避免报告被相似句子淹没
  const ranked = findings
    .sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0) || (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 30)
  return { findings: ranked, longestRun, nearDuplicates }
}

/**
 * 情节层：大纲节点 vs 参考章节的分析结论。
 *
 * 只看三件具体的事：事件是否对照得过近、冲突与解决方式是否雷同、人物是否高度对应。
 * 通用题材与结构不报（那属于「可以借鉴」的范围）。
 */
export function buildPlotFindings(beats: PlotBeat[], analyses: BookAnalysisRecord[]): SimilarityFinding[] {
  const findings: SimilarityFinding[] = []
  const usable = analyses.filter(record => record.result)

  for (const analysis of usable) {
    const result = analysis.result!
    const where = `${analysis.bookName || '参考作品'} 第 ${analysis.chapterNumber} 章`
    for (const beat of beats) {
      const beatText = `${beat.title} ${beat.event} ${beat.protagonistAction} ${beat.conflict}`
      for (const referenceEvent of result.keyEvents) {
        // 用包含度而不是 Dice：节点比参考事件长，Dice 会把同样的重合摊薄
        const score = containmentSimilarity(beatText, referenceEvent)
        if (score == null || score < PLOT_MATCH_THRESHOLD) continue
        findings.push({
          category: 'plot',
          severity: score >= PLOT_HIGH_THRESHOLD ? 'high' : 'warning',
          description: `第 ${beat.sequence} 个节点的情节与参考章节高度对应（${(score * 100).toFixed(0)}%）：${referenceEvent.slice(0, 50)}`,
          sourceReference: `${where}：${referenceEvent.slice(0, 50)}`,
          generatedReference: `节点 ${beat.sequence}《${beat.title}》`,
          recommendation: '换掉事件因果或冲突来源（谁因为什么被逼到什么地步），只保留要借鉴的结构。',
          similarity: score,
        })
      }
      for (const conflict of result.conflicts) {
        const score = containmentSimilarity(`${beat.conflict} ${beat.consequence}`, `${conflict.cause} ${conflict.resolution}`)
        if (score == null || score < PLOT_HIGH_THRESHOLD) continue
        findings.push({
          category: 'structure',
          severity: 'warning',
          description: `第 ${beat.sequence} 个节点的冲突与解决方式与参考章节接近（${(score * 100).toFixed(0)}%）`,
          sourceReference: `${where}：${conflict.cause} → ${conflict.resolution}`,
          generatedReference: `节点 ${beat.sequence}：${beat.conflict} → ${beat.consequence}`,
          recommendation: '让冲突的起因与解法来自你自己的人物动机与世界观规则，而不是参考作品的解法。',
          similarity: score,
        })
      }
    }

    // 人物高度对应：参考章节的主要人物原样出现在自己的大纲里
    const outlineText = beats.map(beat => `${beat.event} ${beat.conflict} ${beat.characterChange}`).join(' ')
    const matched = result.characters
      .map(character => character.name)
      .filter(name => name && name.length >= 2 && outlineText.includes(name))
    // 出现一个参考作品的人名就已经是「该换成自己的角色」的信号，不必等到两个
    if (matched.length >= 1) {
      findings.push({
        category: 'character',
        severity: matched.length >= 2 ? 'warning' : 'info',
        description: `大纲里出现了参考作品的人物名：${matched.slice(0, 6).join('、')}`,
        sourceReference: `${where}：${matched.slice(0, 6).join('、')}`,
        generatedReference: '本次大纲节点',
        recommendation: '把人物换成你自己的角色；人物关系（谁欠谁、谁怕谁）也要重新设计，别只改名。',
        similarity: null,
      })
    }
  }
  return findings.slice(0, 30)
}

/** 由发现推导总体风险等级；没有可比对的材料时返回 undetermined（不硬凑分数） */
export function deriveOverallRisk(findings: SimilarityFinding[], referencesCompared: number): SimilarityRisk {
  if (referencesCompared === 0) return 'undetermined'
  if (findings.some(finding => finding.severity === 'high')) return 'high'
  if (findings.some(finding => finding.severity === 'warning')) return 'medium'
  return 'low'
}

export interface SimilarityInput {
  generated: string
  references: ReferenceChapter[]
  /** 情节层比对用的原创大纲节点（可选） */
  beats?: PlotBeat[]
  /** 情节层比对用的参考章节分析（可选） */
  analyses?: BookAnalysisRecord[]
}

/**
 * 组装完整报告。
 *
 * 没有参考材料时不报 low（那会让人误以为「查过没问题」），而是 undetermined + 说明。
 */
export function buildSimilarityReport(input: SimilarityInput): SimilarityReportPayload {
  const references = input.references.filter(reference => reference.text?.trim())
  const textFindings = references.length > 0
    ? buildTextFindings(input.generated, references)
    : { findings: [] as SimilarityFinding[], longestRun: 0, nearDuplicates: 0 }
  const plotFindings = input.beats?.length && input.analyses?.length
    ? buildPlotFindings(input.beats, input.analyses)
    : []

  const findings = [...textFindings.findings, ...plotFindings]
  const stats: SimilarityStats = {
    referenceChapters: references.length,
    generatedChars: normalizeForCompare(input.generated).length,
    longestCommonRun: textFindings.longestRun,
    nearDuplicateSentences: textFindings.nearDuplicates,
  }
  const overallRisk = deriveOverallRisk(findings, references.length)

  const summary = (() => {
    if (references.length === 0) return '没有可比对的参考材料，本次无法给出风险判断（不是「没问题」）。'
    if (findings.length === 0) return `已与 ${references.length} 章参考材料比对，没有发现具体的重合点。通用题材与结构的相似不计入风险。`
    const high = findings.filter(finding => finding.severity === 'high').length
    const warning = findings.filter(finding => finding.severity === 'warning').length
    return `与 ${references.length} 章参考材料比对：${high} 处需要重点处理，${warning} 处值得再读一遍。风险等级只是提示，不是法律结论；通用设定与常见结构的相似不构成抄袭。`
  })()

  return { overallRisk, findings, summary, stats, generatedAt: new Date().toISOString() }
}
