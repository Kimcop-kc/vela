/**
 * 定性审稿命令
 *
 * 产出「可追溯的创作观察」与「AI 痕迹标记」，两者都只是反馈：
 *   - 不做通过/失败判定，不阻断流程；
 *   - 不自动改稿；是否修订由用户或 Agent 显式发起（见 buildRevisionBrief）。
 *
 * 长章节按 token 预算分段观察后合并，避免一次请求超出上下文导致观察缺失。
 */
import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { BasePromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import { buildCanonContext, renderCanonContext, HARD_CONSTRAINTS } from '../../narrative-consistency'
import {
  buildSegmentDirective,
  clampToTokenBudget,
  estimateTokens,
  resolveGenerationBudgets,
  splitTextByTokenBudget,
} from '../segmented-generation'
import { observeChapter, type ReviewObservation, type QualitativeReview } from '../../review'
import i18n from '../../../i18n'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'commands', ...opts })

const REVIEW_CACHE_LIMIT = 12
const REVIEW_SEGMENT_CONCURRENCY = 2
const reviewCache = new Map<string, QualitativeReview>()

export interface QualitativeReviewParams {
  chapterNumber: number
  chapterTitle: string
  draftPath: string
  draftContent: string
  /** 本次审稿的侧重点（可选） */
  reviewFocus?: string
}

export class QualitativeReviewCommand extends BaseWorkflowCommand<QualitativeReview> {
  constructor(private params: QualitativeReviewParams) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<QualitativeReview> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('common.noProject'))

    const draft = this.params.draftContent
    if (!draft || !draft.trim()) throw new Error(t('common.noDraftContent'))

    const llmStore = (await import('../../../stores/llm-store')).useLLMStore.getState()
    const defaultModel = llmStore.modelForPurpose('qualitative_review')
    const budgets = resolveGenerationBudgets(defaultModel?.maxTokens)

    // ── 既有事实基线：观察必须对照 Canon，才能发现「角色记忆 / 物资」类问题 ──
    let canonContext = ''
    let canonSize = { timelineEvents: 0, characterStates: 0, openPlotLines: 0, knownFacts: 0 }
    let knownCharacterNames: string[] = []
    try {
      const [core, allCharacters] = await Promise.all([
        ipc.invoke('db:project-core-get').catch(() => null as null | { premise?: string; charactersArch?: string; worldbuilding?: string; synopsis?: string }),
        ipc.invoke('db:character-get-all').catch(() => [] as Array<Record<string, unknown>>),
      ])
      knownCharacterNames = (allCharacters || [])
        .map(item => String(item.name ?? ''))
        .filter(Boolean)
      const mentionedNames = knownCharacterNames.filter(name => draft.includes(name))
      const mentionedSet = new Set(mentionedNames)
      const relevantCharacters = (allCharacters || [])
        .filter(item => {
          const name = String(item.name ?? '')
          const role = String(item.role ?? '')
          return mentionedSet.has(name) || role === 'protagonist' || role === 'antagonist'
        })
        .sort((a, b) => rolePriority(String(a.role ?? '')) - rolePriority(String(b.role ?? '')))
        .slice(0, 24)
      const canon = await buildCanonContext({
        chapterNumber: this.params.chapterNumber,
        architecture: {
          premise: core?.premise || '',
          charactersArch: core?.charactersArch || '',
          worldbuilding: core?.worldbuilding || '',
          synopsis: core?.synopsis || '',
        },
        characters: relevantCharacters.map(item => ({
          name: String(item.name ?? ''),
          role: String(item.role ?? ''),
          currentState: item.currentState as { location?: string; powerLevel?: string; physicalState?: string; mentalState?: string; keyItems?: string; recentEvents?: string; updatedAtChapter?: number } | undefined,
        })),
        chapterGoal: t('qualitativeReview.chapterGoal', { chapter: this.params.chapterNumber }),
        previousEnding: '',
        ragContext: '',
        writingStyle: project.novelConfig.writingStyle || '',
        globalGuidance: project.novelConfig.globalGuidance || '',
        // Qualitative review only needs the recent continuity window, not all
        // historical events since chapter one.
        timelineWindow: Math.max(1, this.params.chapterNumber - 8),
        recentSummaryCount: 4,
      })
      canon.timeline = canon.timeline.slice(-60)
      canon.characterStates = canon.characterStates
        .filter(state => mentionedSet.has(state.character) || relevantCharacters.some(card => String(card.name ?? '') === state.character))
        .slice(0, 24)
      canon.openPlotLines = canon.openPlotLines
        .filter(line => line.characters.some(name => mentionedSet.has(name)) || line.characters.length === 0)
        .slice(0, 12)
      canon.knownFacts = canon.knownFacts
        .filter(fact => fact.introducedAt >= this.params.chapterNumber - 8 || fact.characters.some(name => mentionedSet.has(name)))
        .slice(-24)

      const reviewCanonBudget = Math.max(2200, Math.floor(budgets.inputTokens * 0.42))
      const renderedCanon = renderCanonContext({ ...canon, hardConstraints: '' })
      canonContext = [
        clampToTokenBudget(renderedCanon, reviewCanonBudget),
        '【硬性约束（必须严格遵守）】',
        HARD_CONSTRAINTS,
      ].filter(Boolean).join('\n\n---\n\n')
      canonSize = {
        timelineEvents: canon.timeline.length,
        characterStates: canon.characterStates.length,
        openPlotLines: canon.openPlotLines.length,
        knownFacts: canon.knownFacts.length,
      }
      callbacks.log(t('qualitativeReview.canonInjected', {
        timeline: canon.timeline.length,
        characters: canon.characterStates.length,
        plots: canon.openPlotLines.length,
      }))
    } catch (e) {
      callbacks.log(t('qualitativeReview.canonFailed', { error: String(e) }))
    }

    const cacheKey = hashString([
      this.params.chapterNumber,
      this.params.chapterTitle,
      this.params.reviewFocus || '',
      canonContext,
      draft,
    ].join('\n---REVIEW-CACHE---\n'))
    const cached = reviewCache.get(cacheKey)
    if (cached) {
      callbacks.log(t('qualitativeReview.cacheHit'))
      return cached
    }

    const template = getPromptTemplate('qualitative_review')
    if (!template) throw new Error(t('qualitativeReview.templateMissing'))

    // ── 分段观察：预算必须扣除固定的 Canon 上下文，否则章节越多、实际请求越大 ──
    const canonTokens = estimateTokens(canonContext)
    const segmentBudget = Math.max(
      1500,
      Math.min(
        budgets.inputTokens - canonTokens - 1800,
        Math.floor(budgets.inputTokens * 0.58),
      ),
    )
    const chunks = splitTextByTokenBudget(draft, segmentBudget)
    const effectiveChunks = chunks.length > 0 ? chunks : [draft]
    const llmObservations: ReviewObservation[] = []
    let llmFailed = false

    const segmentResults = await mapWithConcurrency(
      effectiveChunks,
      REVIEW_SEGMENT_CONCURRENCY,
      async (chunk, index) => {
        if (effectiveChunks.length > 1) {
          callbacks.log(t('segmented.chunkLog', { index: index + 1, total: effectiveChunks.length }))
        }
        const builder = new BasePromptBuilder(template).withVariables({
          chapter_info: t('qualitativeReview.chapterInfo', {
            chapter: this.params.chapterNumber,
            title: this.params.chapterTitle,
          }),
          canon_context: canonContext || t('qualitativeReview.noCanon'),
          chapter_content: chunk,
          review_focus: this.params.reviewFocus || '',
        })
        let prompt = builder.build()
        if (effectiveChunks.length > 1) {
          prompt += buildSegmentDirective(index + 1, effectiveChunks.length, t('qualitativeReview.segmentHint'))
        }

        callbacks.log(t('qualitativeReview.callingModel', { index: index + 1, total: effectiveChunks.length }))
        try {
          const text = await this.callLLM(
            prompt,
            builder.getSystemRole(),
            index === 0
              ? callbacks
              : {
                  ...callbacks,
                  appendText: () => {},
                  setProgress: () => {},
                },
            { responseFormat: { type: 'json_object' }, maxTokens: budgets.outputTokens },
          )
          const raw = this.parseJSON<Record<string, unknown>>(text)
          const parsed = observeChapter({
            chapterNumber: this.params.chapterNumber,
            chapterTitle: this.params.chapterTitle,
            chapterContent: chunk,
            knownCharacterNames,
            rawLlmResult: raw,
          })
          return parsed.observations.filter(item => item.origin === 'llm')
        } catch (e) {
          // 审稿失败不应该变成「判定失败」：记录日志，继续用本地确定性检测保住大部分反馈
          llmFailed = true
          callbacks.log(t('qualitativeReview.segmentFailed', {
            index: index + 1,
            error: e instanceof Error ? e.message : String(e),
          }))
          return []
        }
      },
    )
    for (const observations of segmentResults) llmObservations.push(...observations)

    if (effectiveChunks.length > 1) {
      callbacks.log(t('segmented.chunkDoneLog', { total: effectiveChunks.length }))
    }

    // ── 合并：模型观察 + 本地规则观察 + AI 痕迹检测（确定性，始终可用）──
    const review = observeChapter({
      chapterNumber: this.params.chapterNumber,
      chapterTitle: this.params.chapterTitle,
      chapterContent: draft,
      knownCharacterNames,
      rawLlmResult: { observations: [] },
      contextSize: canonSize,
    })
    const merged: QualitativeReview = {
      ...review,
      observations: dedupeObservations([...llmObservations, ...review.observations]),
    }
    reviewCache.set(cacheKey, merged)
    if (reviewCache.size > REVIEW_CACHE_LIMIT) {
      const oldest = reviewCache.keys().next().value
      if (oldest) reviewCache.delete(oldest)
    }

    if (llmFailed) {
      callbacks.log(t('qualitativeReview.localOnly'))
    }

    callbacks.log(t('qualitativeReview.found', {
      observations: merged.observations.length,
      traces: merged.aiTraces.length,
    }))

    // ── 存档：审稿产物写进 reviews 表，保持可追溯 ──
    try {
      const { parseDraftMeta } = await import('../chapter-workflow')
      const baseDraft = await parseDraftMeta(this.params.draftPath)
      if (baseDraft) {
        const reviewIndex = await ipc.invoke('db:review-next-index', baseDraft.id)
        await ipc.invoke('db:review-create', {
          baseDraftId: baseDraft.id,
          reviewIndex,
          // 存结构化 JSON：观察与痕迹都可被后续工具读取与追踪，
          // markdown 只是渲染结果，不承担数据职责
          content: JSON.stringify(merged),
        })
        callbacks.log(t('qualitativeReview.saved', { index: reviewIndex }))
      }
    } catch (e) {
      callbacks.log(t('qualitativeReview.saveFailed', { error: String(e) }))
    }

    return merged
  }
}

/** 合并观察列表：同 id 保留信息更完整的一条（避免分段重叠导致的重复） */
function dedupeObservations(observations: ReviewObservation[]): ReviewObservation[] {
  const byId = new Map<string, ReviewObservation>()
  for (const observation of observations) {
    const existing = byId.get(observation.id)
    if (!existing || observation.evidence.length > existing.evidence.length) {
      byId.set(observation.id, observation)
    }
  }
  return Array.from(byId.values())
}

function rolePriority(role: string): number {
  switch (role) {
    case 'protagonist': return 0
    case 'antagonist': return 1
    case 'supporting': return 2
    default: return 3
  }
}

function hashString(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await mapper(items[index], index)
      }
    },
  )
  await Promise.all(workers)
  return results
}
