/**
 * CanonContextBuilder —— 生成前构造 CanonContext
 *
 * 输入：项目状态（架构、角色卡、章节蓝图等）+ 目标章节信息
 * 输出：按固定优先级排序的 CanonContext（用于 prompt 注入）
 *
 * 注入顺序（强制）：
 *   1. 正史设定（不可违背）
 *   2. 当前人物状态（最高优先级）
 *   3. 时间线（严格排序）
 *   4. 最近章节摘要
 *   5. 未解决剧情
 *   6. 当前章节目标
 *   7. RAG 参考内容（最低优先级）
 *   8. 风格要求
 *   9. 硬性约束（禁止矛盾）
 */
import type { CanonContext, TimelineEvent, CharacterStateSnapshot, PlotLine, Fact, ChapterSummary, Arc, ItemEvent, Realm, Location } from './types'
import { canonStore } from './canon-store'

/** 构建入参 */
export interface BuildCanonContextParams {
  chapterNumber: number
  /** 全书架构（来自 db:project-core-get） */
  architecture: {
    premise: string
    charactersArch: string
    worldbuilding: string
    synopsis: string
  }
  /** 现有角色卡（来自 db:character-get-all） */
  characters: Array<{
    name: string
    role: string
    currentState?: {
      location?: string
      powerLevel?: string
      physicalState?: string
      mentalState?: string
      keyItems?: string
      recentEvents?: string
      updatedAtChapter?: number
      /** 角色卡上记录的已知信息（可选，用于与 canon 快照取并集） */
      knowledge?: string[]
      /** 角色卡上记录的人物关系（可选） */
      relationships?: Record<string, string>
      /** 角色卡上记录的当前目标（可选） */
      currentGoal?: string
    }
  }>
  /** 当前章节蓝图 */
  chapterGoal: string
  /** 上一章结尾（用于衔接） */
  previousEnding: string
  /** 知识库检索结果 */
  ragContext: string
  /** 写作风格 */
  writingStyle: string
  /** 全局行文指导 */
  globalGuidance: string
  /** 时间线窗口：返回到多少章之前的所有事件（默认 = chapterNumber - 1） */
  timelineWindow?: number
  /** 最近章节摘要数量（默认 3） */
  recentSummaryCount?: number
}

export const HARD_CONSTRAINTS = `【硬性叙事一致性约束（违反任何一条都会被视为错误）】

1. 不得改变已发生事实：上文明确写过的事件、状态、事实，本章不得推翻、改写或自相矛盾。
2. 不得让人物凭空知道未获得的信息：信息只能通过对话、书信、目击、推理等方式习得。若人物对某事做出反应，必须在文本中有先行的信息来源。
3. 不得无解释改变地点：人物在两个段落间不得瞬移到不同地点，必须有行动/转场。
4. 不得无解释改变人物关系：关系恶化或修复必须有明确触发事件。
5. 不得打乱时间线顺序：本章事件必须发生在上一章事件之后（除非显式标注闪回，并在文本中以"回忆"、"十年前"、"那天"等标记开始）。
6. 必须自然衔接上一章节：起笔必须从上一章结尾的场景/状态平滑过渡，禁止场景瞬移、视角跳跃。
7. 不得让人物持有未获得的物品：物品归属变更必须有拾取/购买/赠予/夺取等明确描写。
8. 不得让已死的角色出场（除非是闪回或鬼魂设定，并需显式标记）。
9. 设定一经确立不得违反：本章不能引入与世界观/力量体系/角色背景设定冲突的新元素。
10. 如确需闪回，必须显式以"回忆"、"十年前"、"脑海中浮现"等词语标记，并在结束时回到当前时间。`

/**
 * 架构字段的注入上限（字符数）。
 *
 * 为什么需要：全书梗概/世界观可能是数万字的长文（实测有项目 synopsis 达到 5.7 万字），
 * 直接整段注入会让单次提示词从数千 token 膨胀到十几万 token，导致生成极慢甚至卡死。
 * 这里按字段裁剪，只保留开头最关键的部分。
 */
export const ARCHITECTURE_FIELD_LIMITS = {
  premise: 1500,
  worldbuilding: 2500,
  charactersArch: 3500,
  synopsis: 4000,
} as const

/** 把长文本裁剪到字符上限，并在末尾标注已截断。 */
export function clampArchitectureField(value: string | undefined, limit: number): string {
  if (!value) return ''
  const text = value.trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n……（内容过长，已按上下文预算截断）`
}

/** 把「十二 / 一百零五 / 三百一十」这类中文数字转成整数；无法识别返回 NaN。 */
function chineseNumeralToInt(value: string): number {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0
  let current = 0
  for (const ch of value) {
    const digit = digits[ch]
    if (digit !== undefined) {
      current = digit
      continue
    }
    const unit = units[ch]
    if (unit !== undefined) {
      if (unit === 10000) {
        total = (total + current) * unit
      } else {
        total += (current || 1) * unit
      }
      current = 0
    }
  }
  total += current
  return total > 0 ? total : Number.NaN
}

/**
 * 全书梗概按「当前章节」取相关窗口。
 *
 * 梗概常常是整本大纲（实测 5.7 万字），只取开头会让写到中后期时完全看不到后续走向。
 * 如果梗概里有「第N章/卷」标记，就取离当前章最近的一段；没有标记则保留开头 + 结尾，
 * 至少同时覆盖开局设定与后续走向。
 */
export function clampSynopsisForChapter(
  value: string | undefined,
  chapterNumber: number,
  limit: number,
): string {
  if (!value) return ''
  const text = value.trim()
  if (text.length <= limit) return text

  const marker = /第\s*([0-9一二三四五六七八九十百千万零〇两]{1,8})\s*[章卷]/g
  let match: RegExpExecArray | null
  let bestPos = -1
  let bestDistance = Number.POSITIVE_INFINITY
  while ((match = marker.exec(text)) !== null) {
    const num = chineseNumeralToInt(match[1])
    if (!Number.isFinite(num)) continue
    const distance = Math.abs(num - chapterNumber)
    if (distance < bestDistance) {
      bestDistance = distance
      bestPos = match.index
    }
  }

  if (bestPos >= 0) {
    const half = Math.floor(limit / 2)
    const start = Math.max(0, bestPos - half)
    const end = Math.min(text.length, start + limit)
    const head = start > 0 ? '……' : ''
    const tail = end < text.length ? '……' : ''
    return `${head}${text.slice(start, end)}${tail}\n（已按当前章节截取梗概相关片段）`
  }

  const headLength = Math.floor(limit * 0.6)
  const tailLength = limit - headLength
  return `${text.slice(0, headLength)}\n……（中略）……\n${text.slice(-tailLength)}`
}

/**
 * 转义 LLM 写入字段中的模板变量（{{xxx}}），防止 prompt 注入。
 * 把 {{ 转义为 ⦃⦃，}} 转义为 ⦄⦄ — LLM 仍可读但 prompt-builder.replaceAll 不命中。
 * 同时截断到 500 字以防超长字段撑爆 prompt。
 */
function escapeTemplateVars(text: string): string {
  if (!text) return text
  return text
    .replace(/\{\{/g, '⦃⦃')
    .replace(/\}\}/g, '⦄⦄')
    .slice(0, 500)
}

/** 把时间线事件格式化为简洁文本 */
function formatTimeline(events: TimelineEvent[]): string {
  if (events.length === 0) return ''
  return events
    .map(e => `[第${e.chapterNumber}章·#${e.sequence}] ${e.timeFlow === 'flashback' ? '[闪回] ' : ''}` +
      `${(e.characters || []).join('、') || '（无角色）'} 在「${e.location || '未知地点'}」：` +
      `${escapeTemplateVars(e.summary)}${e.impact ? `（影响：${escapeTemplateVars(e.impact)}）` : ''}`)
    .join('\n')
}

/** 把角色当前状态格式化为文本 */
function formatCharacterStates(states: CharacterStateSnapshot[]): string {
  if (states.length === 0) return ''
  return states
    .map(s => {
      const knowledge = s.knowledge?.length ? ` | 已知：${escapeTemplateVars(s.knowledge.join('；'))}` : ''
      const relations = s.relationships && Object.keys(s.relationships).length
        ? ` | 关系：${Object.entries(s.relationships).map(([k, v]) => `${k}→${v}`).join('；')}`
        : ''
      const goal = s.currentGoal ? ` | 当前目标：${escapeTemplateVars(s.currentGoal)}` : ''
      return `- ${s.character} | 地点：${s.location || '未知'} | 境界：${s.powerLevel || '未知'} | ` +
        `身体：${s.physicalState || '正常'} | 心理：${s.mentalState || '正常'} | ` +
        `道具：${s.keyItems || '无'} | 最近：第${s.updatedAtChapter}章 ${escapeTemplateVars(s.recentEvents || '')}${goal}${knowledge}${relations}`
    })
    .join('\n')
}

/** 把未结剧情线格式化为文本 */
function formatOpenPlotLines(lines: PlotLine[]): string {
  if (lines.length === 0) return ''
  return lines
    .map(l => {
      // 伏笔单独标出并带上预计回收阶段：让模型知道这条是要回收的伏笔，而不是随便推进的支线
      const kindTag = l.kind === 'foreshadow' ? '伏笔 ' : ''
      const plan = l.kind === 'foreshadow' && l.plannedResolveAt
        ? `，预计回收：${escapeTemplateVars(l.plannedResolveAt)}`
        : ''
      return `- [${l.status}] ${kindTag}${escapeTemplateVars(l.name)}（起始第${l.startedAt}章，最近推进第${l.lastAdvancedAt}章${plan}）` +
        `：${escapeTemplateVars(l.currentState)} | 涉及：${(l.characters || []).join('、') || '—'}`
    })
    .join('\n')
}

/**
 * 境界阶梯：按阶数从低到高列出「能做到 / 做不到 / 怎么突破」。
 * 写战斗与突破时，模型据此判断越级是否成立、代价是否交够，避免随手越阶。
 * 纯函数，供已取数路径复用（数据在主流程一次性读出，避免重复查库）。
 */
function formatRealmLadder(realms: Realm[]): string {
  if (realms.length === 0) return ''
  return realms
    .slice()
    .sort((a, b) => (a.rankOrder || 0) - (b.rankOrder || 0))
    .map(realm => {
      const parts: string[] = []
      if (realm.abilities) parts.push(`能：${realm.abilities}`)
      if (realm.limits) parts.push(`限：${realm.limits}`)
      if (realm.breakthrough) parts.push(`突破：${realm.breakthrough}`)
      return `- ${escapeTemplateVars(realm.name)}${parts.length ? `（${parts.join('；')}）` : ''}`
    })
    .join('\n')
}

/**
 * 地点与空间关系：把「A 在哪、归谁、离 B 多远、怎么去要多久」压成几行。
 * 人物移动前先看这段，避免在没有交通或特殊能力时突然出现在远距离地点。
 * 纯函数，数据在主流程一次性读出。
 */
function formatLocationMap(locations: Location[]): string {
  if (locations.length === 0) return ''
  return locations
    .map(location => {
      const head = [location.region, location.faction && `势力：${location.faction}`].filter(Boolean).join(' · ')
      const parts = [location.distanceNote, location.travelNote].filter(Boolean)
      return `- ${escapeTemplateVars(location.name)}${head ? `（${head}）` : ''}${parts.length ? `：${parts.map(part => escapeTemplateVars(part as string)).join('；')}` : ''}`
    })
    .join('\n')
}

const ITEM_ACTION_LABEL: Record<string, string> = {
  obtained: '获得', transferred: '转交', lost: '丢失', destroyed: '损毁', consumed: '消耗',
}

/**
 * 物品流转台账：把「某件道具在第几章被谁获得 / 转交 / 丢失」压成几行，
 * 让模型在动用道具前先看它还在不在谁手上（防止凭空出现或消失）。
 * 只带去当前章节之前的记录。纯函数，数据在主流程一次性读出。
 */
function formatItemLedger(events: ItemEvent[], chapterNumber: number): string {
  const visible = events.filter(event =>
    event.chapterNumber > 0 && event.chapterNumber < chapterNumber)
  if (visible.length === 0) return ''
  const byItem = new Map<string, string[]>()
  for (const event of visible) {
    const label = ITEM_ACTION_LABEL[event.action] || event.action
    const actor = event.actor ? `（${event.actor}）` : ''
    const note = event.note ? `：${event.note}` : ''
    byItem.set(event.item, [...(byItem.get(event.item) || []), `第${event.chapterNumber}章 ${label}${actor}${note}`])
  }
  // 只带最近有动静的 20 件，避免长篇后期台账把上下文撑长
  return [...byItem.entries()]
    .slice(-20)
    .map(([item, steps]) => `- ${escapeTemplateVars(item)}：${steps.join(' → ')}`)
    .join('\n')
}

/**
 * 把事实条目格式化为短文本
 *
 * [P0-5 修复] 优先级排序：
 *   1. confirmed 事实（作者确认过）最高
 *   2. active 事实按 introducedAt 降序（近章优先）
 *   3. contradicted 带标记
 *   4. outdated 不注入
 *   5. tentative 带标记
 * 不再取 slice(-30)，改为按优先级取前 40 条，确保关键早期设定不被挤掉
 */
function formatFacts(facts: Fact[]): { text: string; manifest: FactInjectionManifest[] } {
  const visible = facts.filter(fact => (fact.status ?? 'active') !== 'outdated')
  if (visible.length === 0) return { text: '', manifest: [] }

  // 优先级排序
  const sorted = visible.sort((a, b) => {
    const aConfirmed = a.confirmedAt ? 1 : 0
    const bConfirmed = b.confirmedAt ? 1 : 0
    if (aConfirmed !== bConfirmed) return bConfirmed - aConfirmed
    // 同确认级别：近章优先
    return (b.introducedAt || 0) - (a.introducedAt || 0)
  })

  const selected = sorted.slice(0, 40)
  const manifest: FactInjectionManifest[] = selected.map(f => ({
    factId: f.id,
    statement: f.statement,
    category: f.category,
    introducedAt: f.introducedAt,
    status: (f.status ?? 'active') as string,
    confirmed: !!f.confirmedAt,
    reason: f.confirmedAt ? '作者确认' : (f.status === 'contradicted' ? '矛盾待确认' : (f.status === 'tentative' ? '暂定' : 'active')),
  }))

  const text = selected.map(f => {
    const statement = escapeTemplateVars(f.statement)
    const evidence = f.evidence ? `，证据："${escapeTemplateVars(f.evidence)}"` : ''
    const statusTag = f.status === 'contradicted' ? '⚠️矛盾待确认 ' : f.status === 'tentative' ? '暂定 ' : (f.confirmedAt ? '✅已确认 ' : '')
    return `- [${f.category}] ${statusTag}${statement}（引入第${f.introducedAt}章${evidence}）`
  }).join('\n')

  return { text, manifest }
}

/** 把章节摘要格式化为文本 */
function formatRecentSummaries(summaries: ChapterSummary[]): string {
  if (summaries.length === 0) return ''
  return summaries
    .map(s => `【第${s.chapterNumber}章${s.title ? ' ' + s.title : ''}】\n${escapeTemplateVars(s.summary)}`)
    .join('\n\n')
}

/**
 * 构造 CanonContext —— 按强制优先级顺序注入。
 *
 * 该函数是叙事一致性的"闸门"：所有生成/修稿/审稿驱动修稿命令都必须经过它。
 * 任何字段读取失败都必须用安全默认值（空字符串/空数组），确保主流程不被打断。
 */
export async function buildCanonContext(params: BuildCanonContextParams): Promise<CanonContext> {
  const timelineWindow = params.timelineWindow ?? Math.max(0, params.chapterNumber - 1)
  const recentSummaryCount = params.recentSummaryCount ?? 3
  // 历史边界：重写/早章生成时，数据库里的「当前状态」可能来自目标章节之后。
  // 只为「目标章节之前已发生」的内容作准，避免把未来的角色状态、剧情进度、事实与摘要注入本章。
  const cutoff = Math.max(0, params.chapterNumber - 1)
  const warnings: string[] = []

  // 并行读取所有 Canon Store 数据 + 角色卡（角色卡从参数传入，避免重复 IPC）
  const [timeline, summariesRaw, plotLinesRaw, factsRaw, canonCharStates, currentArc, itemEvents, realms, locations] = await Promise.all([
    canonStore.getTimeline(timelineWindow),
    canonStore.getSummariesUpTo(cutoff),
    canonStore.getPlotLines(),
    canonStore.getFacts(),
    canonStore.getAllCharacterStates(),
    // [v10] 分卷级记忆：当前章节所属的分卷（旧库无此表时返回 null，不影响生成）
    canonStore.getArcForChapter(params.chapterNumber),
    canonStore.getItemEvents(),
    canonStore.getRealms(),
    canonStore.getLocations(),
  ])

  const summaries = summariesRaw.slice(-recentSummaryCount)
  // 事实：只保留引入章节不晚于 cuttoff 的条目（AI 提取的候选事实可能来自后续章节）
  const facts = factsRaw.filter(fact => (fact.introducedAt || 0) <= cutoff)
  // 剧情线：保留「目标时间点尚未结束/暂停」的，但把 > 目标章节的推进会降级为规划，
  // 绝不把「第 20 章的进度」注入第 5 章的生成。
  const plotLines = plotLinesRaw
    .filter(line => {
      const start = line.startedAt || 0
      if (start > cutoff && start > 0) {
        warnings.push(`剧情线「${line.name}」起始于第 ${start} 章，晚于本章（第 ${params.chapterNumber} 章），未以其当前进度注入`)
        return false
      }
      return true
    })
    .map(line => {
      if ((line.lastAdvancedAt || 0) > cutoff) {
        warnings.push(`剧情线「${line.name}」最新进度在第 ${line.lastAdvancedAt} 章，晚于本章，已按「规划中」处理、不注入未来进度`)
        return {
          ...line,
          currentState: '（规划中：本章尚未推进，勿提前揭晓）',
          description: `${line.description}\n[规划] ${line.currentState}`,
        }
      }
      return line
    })

  // 角色当前状态：按「状态更新章节」取不晚于 cutoff 的最新快照，再合并角色卡
  const mergedStates = await mergeCharacterStates(canonCharStates, params.characters, cutoff, warnings)

  // 拼装 world rules = premise + worldbuilding + charactersArch + synopsis
  const worldRules = [
    clampArchitectureField(params.architecture.premise, ARCHITECTURE_FIELD_LIMITS.premise),
    clampArchitectureField(params.architecture.worldbuilding, ARCHITECTURE_FIELD_LIMITS.worldbuilding),
  ].filter(Boolean).join('\n\n---\n\n')

  const characterArch = [
    clampArchitectureField(params.architecture.charactersArch, ARCHITECTURE_FIELD_LIMITS.charactersArch),
    clampSynopsisForChapter(params.architecture.synopsis, params.chapterNumber, ARCHITECTURE_FIELD_LIMITS.synopsis),
  ].filter(Boolean).join('\n\n---\n\n')

  return {
    worldRules,
    characterArch,
    characterStates: mergedStates,
    timeline,
    recentChapterSummaries: formatRecentSummaries(summaries),
    openPlotLines: plotLines,
    chapterGoal: params.chapterGoal || '（无本章目标）',
    knownFacts: facts,
    currentArc: currentArc ?? undefined,
    itemLedger: formatItemLedger(itemEvents, params.chapterNumber),
    realmLadder: formatRealmLadder(realms),
    locationMap: formatLocationMap(locations),
    previousEnding: params.previousEnding || '（无上一章结尾）',
    ragContext: clampArchitectureField(params.ragContext, 4000) || '（无 RAG 检索结果）',
    writingStyle: params.writingStyle || '（无风格要求）',
    globalGuidance: clampArchitectureField(params.globalGuidance, 2500) || '（无全局行文指导）',
    hardConstraints: HARD_CONSTRAINTS,
    // 逐条追溯用的原始来源：上游「上下文资料包」据此渲染来源/选取理由，而不是重新猜一遍
    contextSources: {
      summaries,
      itemEvents: itemEvents.filter(event => event.chapterNumber > 0 && event.chapterNumber <= cutoff),
      realms,
      locations,
      warnings,
    },
    meta: {
      chapterNumber: params.chapterNumber,
      builtAt: new Date().toISOString(),
      ragSources: countRagSources(params.ragContext),
    },
  }
}

/**
 * 合并角色当前状态。
 *
 * 旧实现固定「canon 表优先」，只要 canon 有一行就整行压过角色卡；这在重写早章时
 * 会把目标章节之后的状态注入本章（未来泄漏）。现在改为按「状态更新章节」比较新旧：
 *
 *   - 不晚于 cutoff 的最新快照优先（同章时 canon 表优先，因为它来自正文写回）；
 *   - 较新的来源可以补上较旧来源为空的字段，但较新的空字段不会抹掉较旧的实值；
 *   - knowledge / relationships 做并集，不从旧来源里莫名丢失；
 *   - canon 表里的「未来状态」不参与，改为查询该角色不晚于 cutoff 的历史快照；
 *     历史也拿不到时，退回角色卡（若角色卡自身也不晚于 cutoff），再不行就留空并警告——
 *     宁可少给信息，也不把未来状态当既成事实喂给模型。
 */
async function mergeCharacterStates(
  canonStates: CharacterStateSnapshot[],
  cards: BuildCanonContextParams['characters'],
  cutoff: number,
  warnings: string[],
): Promise<CharacterStateSnapshot[]> {
  // 只取不晚于 cutoff 的 canon 快照
  const safeCanon = new Map<string, CharacterStateSnapshot>()
  // canon 表里存在、但更新章节晚于本章的角色：只有「未来状态」，需要显式提示作者
  const futureOnly = new Set<string>()
  for (const s of canonStates) {
    if ((s.updatedAtChapter || 0) > cutoff) {
      futureOnly.add(s.character)
      continue
    }
    const current = safeCanon.get(s.character)
    if (!current || (s.updatedAtChapter || 0) > (current.updatedAtChapter || 0)) {
      safeCanon.set(s.character, s)
    }
  }

  const map = new Map<string, CharacterStateSnapshot>()

  for (const c of cards) {
    if (!c.name) continue
    const canon = safeCanon.get(c.name)
    const cs = c.currentState
    const cardChapter = cs?.updatedAtChapter || 0
    const cardSafe = cardChapter <= cutoff
    // 较新来源优先：比较 canon 与角色卡的更新章节（角色卡不安全时不参与）
    const canonChapter = canon?.updatedAtChapter || 0
    const cardNewer = cardSafe && cardChapter > canonChapter
    const newer = cardNewer ? cardToSnapshot(c.name, cs) : canon
    const older = cardNewer ? canon : (cardSafe ? cardToSnapshot(c.name, cs) : undefined)

    if (newer) {
      map.set(c.name, mergeSnapshotPair(newer, older))
      // canon 里还有更晚的状态被排除掉时，也提示作者（有安全旧状态不等于没有未来泄漏）
      if (futureOnly.has(c.name)) {
        warnings.push(`角色「${c.name}」存在晚于本章（第 ${cutoff + 1} 章起）的状态更新，已排除、只采用截至本章的快照`)
      }
      continue
    }

    // 两条来源都晚于 cutoff：尝试查该角色的历史快照（不晚于 cutoff 的最近一条）
    const history = await canonStore
      .getCharacterStateHistory(c.name, cutoff)
      .catch(() => [])
    const latestHistory = history
      .filter(entry => (entry.chapterNumber || 0) <= cutoff)
      .sort((a, b) => (b.chapterNumber || 0) - (a.chapterNumber || 0))[0]

    if (latestHistory?.snapshot) {
      map.set(c.name, latestHistory.snapshot)
      if (futureOnly.has(c.name)) {
        warnings.push(`角色「${c.name}」存在晚于本章（第 ${cutoff + 1} 章起）的状态更新，已回退到第 ${latestHistory.chapterNumber} 章的历史快照`)
      }
      continue
    }

    // 拿不到任何安全状态：明确标记为空，而不是把未来状态当事实
    if (canon || cardChapter > cutoff || futureOnly.has(c.name)) {
      warnings.push(`角色「${c.name}」只有晚于本章（第 ${cutoff + 1} 章起）的状态记录，本章未注入其未来状态`)
    }
    map.set(c.name, emptySnapshot(c.name))
  }

  // canon 表里存在、但角色卡没有登记的角色（例如已离场人物）：只保留安全快照，
  // 但「只有未来状态」的同样要留痕，避免作者以为这个角色真的没有任何状态记录。
  for (const [name, snap] of safeCanon) {
    if (!map.has(name)) map.set(name, snap)
  }
  for (const name of futureOnly) {
    if (!map.has(name)) {
      warnings.push(`角色「${name}」只有晚于本章（第 ${cutoff + 1} 章起）的状态记录，本章未注入其未来状态`)
      map.set(name, emptySnapshot(name))
    }
  }

  return Array.from(map.values()).sort((a, b) => a.character.localeCompare(b.character))
}

/** 把角色卡 currentState 归一化成一个完整快照 */
function cardToSnapshot(
  name: string,
  cs: BuildCanonContextParams['characters'][number]['currentState'],
): CharacterStateSnapshot {
  return {
    character: name,
    location: cs?.location || '',
    powerLevel: cs?.powerLevel || '',
    physicalState: cs?.physicalState || '',
    mentalState: cs?.mentalState || '',
    keyItems: cs?.keyItems || '',
    currentGoal: cs?.currentGoal || '',
    knowledge: cs?.knowledge ?? [],
    relationships: cs?.relationships ?? {},
    recentEvents: cs?.recentEvents || '',
    updatedAtChapter: cs?.updatedAtChapter || 0,
    updatedAt: new Date().toISOString(),
  }
}

/** 一个「无可用状态」的空快照，明确留空而不是塞入未来值 */
function emptySnapshot(name: string): CharacterStateSnapshot {
  return {
    character: name,
    location: '',
    powerLevel: '',
    physicalState: '',
    mentalState: '',
    keyItems: '',
    currentGoal: '',
    knowledge: [],
    relationships: {},
    recentEvents: '',
    updatedAtChapter: 0,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 合并「较新 / 较旧」两个快照：较新优先，但较新为空的标量字段可由较旧补上，
 * knowledge / relationships 取并集，避免较新的空数组把较旧的信息抹掉。
 */
function mergeSnapshotPair(
  newer: CharacterStateSnapshot,
  older?: CharacterStateSnapshot,
): CharacterStateSnapshot {
  const pick = (n: string | undefined, o: string | undefined) => (n && n.trim() ? n : (o || ''))
  const knowledge = [...new Set([...(newer.knowledge ?? []), ...(older?.knowledge ?? [])])]
  const relationships = { ...(older?.relationships ?? {}), ...(newer.relationships ?? {}) }
  return {
    ...newer,
    location: pick(newer.location, older?.location),
    powerLevel: pick(newer.powerLevel, older?.powerLevel),
    physicalState: pick(newer.physicalState, older?.physicalState),
    mentalState: pick(newer.mentalState, older?.mentalState),
    keyItems: pick(newer.keyItems, older?.keyItems),
    currentGoal: pick(newer.currentGoal, older?.currentGoal),
    recentEvents: pick(newer.recentEvents, older?.recentEvents),
    knowledge,
    relationships,
    updatedAtChapter: newer.updatedAtChapter || older?.updatedAtChapter || 0,
  }
}

/** 把 RAG 上下文里的 [N] 标记数量作为来源数估算 */
function countRagSources(ragContext: string): number {
  if (!ragContext) return 0
  const matches = ragContext.match(/\[\d+\]/g)
  return matches ? matches.length : 0
}

/** [P0-8] 上下文注入清单：记录每条被注入的事实的来源和匹配理由 */
export interface FactInjectionManifest {
  factId?: number
  statement: string
  category: string
  introducedAt: number
  status: string
  confirmed: boolean
  reason: string
}

/** [P0-8] 完整的上下文注入清单：记录最终注入了什么、截断了什么、排除了什么 */
export interface ContextInjectionManifest {
  builtAt: string
  chapterNumber: number
  timelineInjected: number
  timelineTruncated: boolean
  characterStatesInjected: number
  plotLinesInjected: number
  factsInjected: number
  factsExcluded: number
  factsManifest: FactInjectionManifest[]
  summariesInjected: number
  itemLedgerInjected: boolean
  realmLadderInjected: boolean
  locationMapInjected: boolean
  /** [v10] 是否注入了分卷/阶段记忆 */
  arcInjected: boolean
  ragSources: number
  truncations: string[]
}

/**
 * [v10] 渲染分卷/阶段记忆：本卷主要矛盾、人物发展、关键事件、阶段性目标。
 */
function formatArc(arc?: Arc): string {
  if (!arc) return ''
  const lines: string[] = []
  lines.push(`【${arc.title}】（第 ${arc.startChapter} 章起${arc.endChapter > 0 ? ` · 至第 ${arc.endChapter} 章` : ' · 进行中'}）`)
  if (arc.mainConflict?.trim()) lines.push(`本卷主要矛盾：${arc.mainConflict.trim()}`)
  if (arc.stageGoal?.trim()) lines.push(`阶段性目标：${arc.stageGoal.trim()}`)
  if (arc.characterDevelopment?.trim()) lines.push(`人物发展：${arc.characterDevelopment.trim()}`)
  if (arc.keyEvents?.trim()) lines.push(`关键事件：${arc.keyEvents.trim()}`)
  return lines.join('\n')
}

/**
 * 把 CanonContext 渲染为单段 prompt 文本（按指定顺序）
 *
 * 顺序固定：正史设定 → 人物状态 → 时间线 → 章节摘要 → 未结剧情 → 本章目标 → RAG → 风格 → 全局指导 → 硬性约束
 */
export function renderCanonContext(ctx: CanonContext): string {
  // [P0-5/P0-8] formatFacts 现在返回 { text, manifest }，取 text 部分用于渲染
  const factsResult = formatFacts(ctx.knownFacts)
  const blocks: Array<{ title: string; content: string }> = [
    { title: '【正史设定（不可违背）】', content: ctx.worldRules },
    { title: '【本卷阶段记忆（本卷矛盾 · 人物发展 · 阶段性目标）】', content: formatArc(ctx.currentArc) },
    { title: '【人物群像（静态设定）】', content: ctx.characterArch },
    { title: '【当前人物状态（最高优先级 · 生成时不得推翻）】', content: formatCharacterStates(ctx.characterStates) },
    { title: '【已发生事件时间线（严格单向 · 按章节+顺序排列）】', content: formatTimeline(ctx.timeline) },
    { title: '【最近章节摘要】', content: ctx.recentChapterSummaries },
    { title: '【未结剧情线（必须在写作时考虑推进或避免冲突）】', content: formatOpenPlotLines(ctx.openPlotLines) },
    { title: '【关键事实条目（不可推翻）】', content: factsResult.text },
    { title: '【物品流转（道具当前在谁手上 · 不可凭空出现或消失）】', content: ctx.itemLedger || '' },
    { title: '【境界阶梯（越级需有条件 · 突破需交代价）】', content: ctx.realmLadder || '' },
    { title: '【地点与空间关系（人物移动需符合距离与通行方式）】', content: ctx.locationMap || '' },
    { title: '【上一章结尾（必须自然衔接）】', content: ctx.previousEnding },
    { title: '【本章写作目标】', content: ctx.chapterGoal },
    { title: '【知识库参考（最低优先级 · 仅当与上述 canon 冲突时以 canon 为准）】', content: ctx.ragContext },
    { title: '【文风要求】', content: ctx.writingStyle },
    { title: '【全局行文指导】', content: ctx.globalGuidance },
    { title: '【硬性约束（必须严格遵守）】', content: ctx.hardConstraints },
  ]

  return blocks
    .filter(b => b.content && b.content.trim().length > 0 && !/^（无/.test(b.content.trim()))
    .map(b => `${b.title}\n${b.content}`)
    .join('\n\n---\n\n')
}

/**
 * [P0-8] 构建上下文注入清单：记录实际注入了什么、截断了什么、排除了什么。
 * 供调用方（如生成命令）记录到日志或 UI，实现"生成前注入可审计"。
 */
export function buildContextInjectionManifest(ctx: CanonContext): ContextInjectionManifest {
  const factsResult = formatFacts(ctx.knownFacts)
  const allFacts = ctx.knownFacts.filter(f => (f.status ?? 'active') !== 'outdated')
  const truncations: string[] = []

  // 检查事实是否被截断
  if (allFacts.length > 40) {
    truncations.push(`事实: ${allFacts.length} 条中注入了 40 条，排除了 ${allFacts.length - 40} 条`)
  }

  // 检查时间线是否被截断（只在 buildPromptCanon 过滤后可能发生）
  // 此处只能从 meta 推断

  return {
    builtAt: ctx.meta.builtAt,
    chapterNumber: ctx.meta.chapterNumber,
    timelineInjected: ctx.timeline.length,
    timelineTruncated: false, // 由调用方（如 buildPromptCanon）在过滤后设置
    characterStatesInjected: ctx.characterStates.length,
    plotLinesInjected: ctx.openPlotLines.length,
    factsInjected: factsResult.manifest.length,
    factsExcluded: allFacts.length - factsResult.manifest.length,
    factsManifest: factsResult.manifest,
    summariesInjected: ctx.recentChapterSummaries ? 1 : 0,
    itemLedgerInjected: !!ctx.itemLedger?.trim(),
    realmLadderInjected: !!ctx.realmLadder?.trim(),
    locationMapInjected: !!ctx.locationMap?.trim(),
    arcInjected: !!formatArc(ctx.currentArc).trim(),
    ragSources: ctx.meta.ragSources,
    truncations,
  }
}
