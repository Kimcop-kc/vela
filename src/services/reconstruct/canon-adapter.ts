/** 拆书创作系统与现有小说事实库之间的适配层：筛选事实、跑一致性检查、把新事实送进待审核。 */
import { ipc } from '../ipc-client'
import {
  buildCanonContext,
  renderCanonContext,
  runConsistencyGate,
  canonStore,
  extractCanonWriteback,
  type CanonContext,
} from '../narrative-consistency'
import type { Fact } from '../narrative-consistency'

/** 生成前的上下文：既有 Canon 段 + 相关事实清单 */
export interface ChapterCanonContext {
  canon: CanonContext | null
  rendered: string
  /** 与本章相关的事实（按人物 / 地点 / 事件关键词筛过） */
  relevantFacts: Fact[]
  counts: { timeline: number; characterStates: number; plotLines: number; facts: number }
}

/**
 * 组装正文生成要用的 Canon 上下文。
 *
 * 只把与本章有关的信息放进去（文档 6.1）：时间线取到本章之前、事实按关键词筛，
 * 不做「整本小说无差别塞入」。
 */
export async function loadChapterCanon(params: {
  chapterNumber: number
  chapterGoal: string
  keywords: string[]
}): Promise<ChapterCanonContext> {
  const { chapterNumber, chapterGoal, keywords } = params
  // 只需要架构与角色卡：时间线 / 状态 / 剧情线 / 事实 / 摘要全部交给 buildCanonContext，
  // 由它统一做「不晚于本章」的历史边界过滤与角色状态合并。
  // 之前这里用 getTimeline/getAllCharacterStates/getActivePlotLines 再覆盖一次，
  // 会把 buildCanonContext 已经排除掉的「未来状态」重新塞回去（重写早章时泄漏后续剧情）。
  const [core, characters] = await Promise.all([
    ipc.invoke('db:project-core-get').catch(() => null),
    ipc.invoke('db:character-get-all').catch(() => [] as Array<{ name: string; role: string; currentState?: Record<string, unknown> }>),
  ])

  const relevantFacts = filterRelevantFacts(await canonStore.getFacts().catch(() => []), keywords)
  let canon: CanonContext | null = null
  let rendered = ''
  try {
    canon = await buildCanonContext({
      chapterNumber,
      architecture: {
        premise: core?.premise ?? '',
        charactersArch: core?.charactersArch ?? '',
        worldbuilding: core?.worldbuilding ?? '',
        synopsis: core?.synopsis ?? '',
      },
      characters: (characters ?? []).map(character => ({
        name: character.name,
        role: character.role,
        currentState: character.currentState as {
          location?: string; powerLevel?: string; physicalState?: string
          mentalState?: string; keyItems?: string; recentEvents?: string; updatedAtChapter?: number
        } | undefined,
      })),
      chapterGoal,
      previousEnding: '',
      ragContext: '',
      writingStyle: '',
      globalGuidance: '',
    })
    // 只把「与本章关键词相关」的事实收窄，不覆盖时间线/状态/剧情线/摘要——
    // 那些字段由 buildCanonContext 做过历史边界处理，覆盖会让未来的状态泄漏进来。
    canon.knownFacts = relevantFacts
    rendered = renderCanonContext(canon)
  } catch (error) {
    console.warn('[canon-adapter] 组装 Canon 上下文失败:', error)
  }

  return {
    canon,
    rendered,
    relevantFacts,
    counts: {
      timeline: canon?.timeline.length ?? 0,
      characterStates: canon?.characterStates.length ?? 0,
      plotLines: canon?.openPlotLines.length ?? 0,
      facts: relevantFacts.length,
    },
  }
}

/**
 * 按关键词筛事实：命中陈述、角色名或证据即算相关；没有关键词时退化为「限量取用」。
 *
 * 返回前按「作者确认优先 → 引入章节降序」排序，避免直接按数据库返回顺序截断——
 * 否则早期的关键设定会被后续无关条目挤掉。
 */
export function filterRelevantFacts(facts: Fact[], keywords: string[], limit = 40): Fact[] {
  const usable = facts
    .filter(fact => (fact.status ?? 'active') !== 'outdated')
    .sort((a, b) => {
      const aConfirmed = a.confirmedAt ? 1 : 0
      const bConfirmed = b.confirmedAt ? 1 : 0
      if (aConfirmed !== bConfirmed) return bConfirmed - aConfirmed
      return (b.introducedAt || 0) - (a.introducedAt || 0)
    })
  const cleaned = keywords.map(keyword => keyword.trim()).filter(keyword => keyword.length >= 2)
  if (cleaned.length === 0) return usable.slice(0, limit)
  const matched = usable.filter(fact => {
    const haystack = `${fact.statement} ${fact.evidence ?? ''} ${(fact.characters ?? []).join(' ')}`
    return cleaned.some(keyword => haystack.includes(keyword))
  })
  return (matched.length > 0 ? matched : usable).slice(0, limit)
}

export type ConsistencyVerdict = 'clear' | 'needs-review' | 'conflict' | 'unknown'

export interface DraftConsistencyResult {
  verdict: ConsistencyVerdict
  summary: string
  issues: Array<{ severity: string; issue: string }>
  report: string
}

/**
 * 正文生成后的一致性检查（文档 7.2）。
 *
 * 复用现有闸门（不新造一套规则），把结论翻译成作者能用的三档：
 * 无明显冲突、需要作者确认、明确冲突。
 */
export async function checkDraftConsistency(params: {
  chapterNumber: number
  content: string
  canon: CanonContext | null
}): Promise<DraftConsistencyResult> {
  const { chapterNumber, content, canon } = params
  if (!canon) {
    return { verdict: 'unknown', summary: '没有可用的 Canon 上下文，本次无法比对（不是「没问题」）。', issues: [], report: '' }
  }
  try {
    const result = await runConsistencyGate({ chapterNumber, chapterContent: content, canon })
    const issues = result.issues.map(issue => ({ severity: String(issue.severity ?? 'info'), issue: String(issue.issue) }))
    const verdict: ConsistencyVerdict = result.verdict === 'PASS'
      ? 'clear'
      : result.verdict === 'BLOCK' ? 'conflict' : 'needs-review'
    const summary = verdict === 'clear'
      ? '无明显冲突：人物、时间线、物品与设定都对得上。'
      : verdict === 'conflict'
        ? `明确冲突 ${issues.length} 处，需要先改正文再定稿。`
        : `需要作者确认：${issues.length} 处待判断，可能是合理发挥，也可能是疏漏。`
    return { verdict, summary, issues, report: String(result.report ?? '') }
  } catch (error) {
    return { verdict: 'unknown', summary: `一致性检查未能完成：${String(error)}`, issues: [], report: '' }
  }
}

/**
 * 从新稿里提取候选事实，写入事实库的「待确认」状态（文档 7.3）。
 *
 * 用的是现有本地提取器（不额外调用模型），重复陈述会跳过；
 * 作者在「故事圣经 → 关键事实」里确认后才算正式事实。
 */
export async function extractPendingFacts(params: {
  chapterNumber: number
  chapterTitle: string
  content: string
  characterNames: string[]
}): Promise<{ proposed: number; added: number; skipped: number; error?: string }> {
  const { chapterNumber, chapterTitle, content, characterNames } = params
  try {
    const existing = await canonStore.getFacts()
    const existingStatements = new Set(existing.map(fact => fact.statement.trim()))
    const writeback = extractCanonWriteback({
      chapterNumber,
      chapterTitle,
      chapterContent: content,
      characters: characterNames.map(name => ({ name })),
    })
    const candidates = (writeback.newFacts ?? []).slice(0, 30)
    let added = 0
    let skipped = 0
    for (const fact of candidates) {
      const statement = String(fact.statement ?? '').trim()
      if (!statement || existingStatements.has(statement)) { skipped += 1; continue }
      const id = await canonStore.addFact({
        category: fact.category ?? 'event',
        statement,
        introducedAt: chapterNumber,
        characters: fact.characters ?? [],
        evidence: fact.evidence ?? '',
        // 明确标为待确认：没经过作者过目的东西不进正式事实库
        status: 'tentative',
      })
      if (id) { existingStatements.add(statement); added += 1 }
      else skipped += 1
    }
    return { proposed: candidates.length, added, skipped }
  } catch (error) {
    return { proposed: 0, added: 0, skipped: 0, error: String(error) }
  }
}
