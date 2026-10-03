/**
 * 定性审稿摘要（ChapterReviewDigest）
 *
 * 完整审稿结束时，把「已经审过章节」的连续性记忆沉淀成一份紧凑摘要：
 *   - timelineDigest：按章节浓缩的既有时间线（用定稿摘要回填，缺失时退回事件摘要）
 *   - foreshadowing：需要跨章持续追踪的伏笔观察
 *   - unresolved：仍在观察、尚未处理的 watch/concern 观察
 *
 * 下一章审稿时只注入「摘要 + 摘要之后的增量 Canon + 当前章全文」，从而不必
 * 每次重读全书时间线。摘要通过 canonFingerprint 绑定当时的 Canon 状态；底层
 * Canon 一旦回滚/改写，指纹不匹配即判定失效，回退到完整重建。
 */
import type {
  ChapterSummary,
  Fact,
  TimelineEvent,
} from '../narrative-consistency/types'
import type {
  ObservationDimension,
  ObservationSeverity,
  ReviewObservation,
} from './types'

export const REVIEW_DIGEST_VERSION = 1

/** 摘要中保留的观察上限，避免跨章记忆无限增长。 */
const DIGEST_OBSERVATION_LIMIT = 80
/** 每个章节在时间线浓缩里最多拼接的事件条数（仅用于缺失定稿摘要时的兜底）。 */
const DIGEST_TIMELINE_EVENTS_PER_CHAPTER = 3

export interface ReviewDigestObservation {
  id: string
  dimension: ObservationDimension
  severity: ObservationSeverity
  title: string
  detail: string
  relatedChapters: number[]
}

export interface ChapterReviewDigest {
  version: number
  /** 本摘要覆盖到第几章（即本次审稿的章节号）。 */
  upToChapter: number
  upToTitle: string
  /** 既有章节的时间线浓缩文本（覆盖 1..upToChapter-1）。 */
  timelineDigest: string
  foreshadowing: ReviewDigestObservation[]
  unresolved: ReviewDigestObservation[]
}

export function emptyReviewDigest(upToChapter: number, upToTitle: string): ChapterReviewDigest {
  return {
    version: REVIEW_DIGEST_VERSION,
    upToChapter,
    upToTitle,
    timelineDigest: '',
    foreshadowing: [],
    unresolved: [],
  }
}

function observationToDigest(observation: ReviewObservation): ReviewDigestObservation {
  return {
    id: observation.id,
    dimension: observation.dimension,
    severity: observation.severity,
    title: observation.title,
    detail: observation.detail,
    relatedChapters: [...observation.relatedChapters],
  }
}

function dedupeObservations(observations: ReviewDigestObservation[]): ReviewDigestObservation[] {
  const byId = new Map<string, ReviewDigestObservation>()
  for (const observation of observations) {
    const existing = byId.get(observation.id)
    if (!existing || observation.detail.length > existing.detail.length) {
      byId.set(observation.id, observation)
    }
  }
  return Array.from(byId.values())
}

/**
 * 把本次审稿的模型观察合并进摘要记忆。
 * 只保留 llm 来源的 watch/concern（note 太轻，不跨章追踪），
 * 伏笔单独归入 foreshadowing，避免与普通连续性观察混在一起。
 */
export function foldObservationsIntoDigest(
  digest: ChapterReviewDigest,
  observations: ReviewObservation[],
): ChapterReviewDigest {
  const foreshadowing = dedupeObservations([
    ...digest.foreshadowing,
    ...observations
      .filter(item => item.origin === 'llm' && item.dimension === 'foreshadowing')
      .map(observationToDigest),
  ]).slice(-DIGEST_OBSERVATION_LIMIT)

  const unresolved = dedupeObservations([
    ...digest.unresolved,
    ...observations
      .filter(
        item =>
          item.origin === 'llm' &&
          item.dimension !== 'foreshadowing' &&
          item.severity !== 'note',
      )
      .map(observationToDigest),
  ]).slice(-DIGEST_OBSERVATION_LIMIT)

  return { ...digest, foreshadowing, unresolved }
}

/**
 * 生成 1..upToChapter 的时间线浓缩文本。
 * 优先使用定稿摘要（LLM 已写好的章节摘要），缺失时退回该章事件摘要拼接。
 */
export function buildTimelineDigest(
  upToChapter: number,
  summaries: ChapterSummary[],
  timeline: TimelineEvent[],
): string {
  const summaryByChapter = new Map<number, ChapterSummary>()
  for (const summary of summaries) summaryByChapter.set(summary.chapterNumber, summary)

  const lines: string[] = []
  for (let chapter = 1; chapter <= upToChapter; chapter++) {
    const summary = summaryByChapter.get(chapter)
    if (summary && summary.summary.trim()) {
      const title = summary.title ? `《${summary.title}》` : ''
      lines.push(`第${chapter}章${title}：${summary.summary.trim()}`)
      continue
    }

    const events = timeline
      .filter(event => event.chapterNumber === chapter)
      .slice(0, DIGEST_TIMELINE_EVENTS_PER_CHAPTER)
      .map(event => event.summary.trim())
      .filter(Boolean)
    if (events.length > 0) lines.push(`第${chapter}章：${events.join('；')}`)
  }

  return lines.join('\n')
}

/**
 * 计算审稿摘要所依赖的 Canon 指纹。
 * 覆盖指定时间线事件、事实与章节摘要；任何一条变化都会让摘要失效。
 */
export function computeCanonFingerprint(
  timeline: TimelineEvent[],
  facts: Fact[],
  summaries: ChapterSummary[],
): string {
  const parts: string[] = []
  for (const event of timeline) {
    parts.push(`t:${event.id ?? 0}:${event.chapterNumber}:${event.sequence}:${event.summary}`)
  }
  for (const fact of facts) {
    parts.push(`f:${fact.id ?? 0}:${fact.category}:${fact.statement}:${fact.introducedAt}`)
  }
  for (const summary of summaries) {
    parts.push(`s:${summary.chapterNumber}:${summary.summary}`)
  }
  return hashString(parts.join('|'))
}

/** 把摘要渲染为注入 prompt 的文本块。 */
export function renderReviewDigest(digest: ChapterReviewDigest): string {
  const blocks: string[] = []

  if (digest.timelineDigest.trim()) {
    blocks.push(`【既有章节摘要（已审阅，可作事实基线）】\n${digest.timelineDigest}`)
  }
  if (digest.foreshadowing.length > 0) {
    blocks.push(
      `【需持续追踪的伏笔】\n${digest.foreshadowing
        .map(item => `- ${item.title}：${item.detail}`)
        .join('\n')}`,
    )
  }
  if (digest.unresolved.length > 0) {
    blocks.push(
      `【仍在观察的未解决事项】\n${digest.unresolved
        .map(item => `- ${item.title}：${item.detail}`)
        .join('\n')}`,
    )
  }

  return blocks.join('\n\n---\n\n')
}

function hashString(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}
