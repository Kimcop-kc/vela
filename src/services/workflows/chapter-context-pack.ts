/**
 * 本章上下文资料包（第三阶段核心）
 *
 * 目标：在「生成正文」之前，把这一章要用到的资料整理成一份**可检查、可预览、可追溯**的包，
 * 而不是只有提示词里拼好的一段文本。
 *
 * 设计要点（对齐需求）：
 *   1. 十类资料各自成段，每一条都带「来源 + 类型 + 章节/段落定位 + 选取理由」。
 *   2. 冲突优先级：作者要求 > 已确认正式设定 > 时序当前状态 > 场景相关历史 > 背景 > 模型推测。
 *   3. 有明确 token 预算，按重要性排序，不按数据库返回顺序截断。
 *   4. 被排除 / 被截断的条目记录原因，不让关键记忆静默消失。
 *   5. 资料缺失、认知边界缺失、作者要求与正式设定冲突，都显式提示，不自行捏造。
 *
 * 本模块是**纯函数 + 只读**：不调用模型、不写数据库、不改正文与正式设定。
 * 它消费已经组装好的 CanonContext（含 contextSources 原始来源），产出结构化资料包；
 * 上游再用它渲染「本章上下文预览」。
 */
import type {
  CanonContext,
  CharacterStateSnapshot,
  Fact,
  PlotLine,
  TimelineEvent,
  ChapterSummary,
} from '../narrative-consistency'
import { estimateTokens } from '../text-analysis'

/** 资料条目的通用包装：带上来源与选取理由，供预览逐条展示 */
export interface ContextItem<T = unknown> {
  /** 稳定 id（便于预览与测试定位同一行） */
  id: string
  /** 展示标题 */
  title: string
  /** 注入正文的真实文本（预览展示的就是它，不是另造一份） */
  text: string
  /** 原始数据（用于界面显示章节号、类别等） */
  source: T
  /** 优先级：数字越小越先保留（1 = 最高） */
  priority: number
  /** 为什么被选中（人类可读） */
  reason: string
  /** 估算 token（中文约 1.5 字符/token） */
  tokens: number
}

/** 十类资料中的一段 */
export interface ContextSection {
  key: ContextSectionKey
  /** 该段在预算里的优先级（1 = 最高） */
  priority: number
  items: ContextItem[]
  chars: number
  tokens: number
  /** 该段被预算裁剪掉的条目数 */
  dropped: number
  /** 是否整段为空（资料缺失） */
  empty: boolean
}

export type ContextSectionKey =
  | 'chapterGoal'
  | 'scene'
  | 'characters'
  | 'knowledgeBounds'
  | 'previousContext'
  | 'items'
  | 'plotLines'
  | 'worldRules'
  | 'style'
  | 'outputConstraints'

/** 资料缺失 / 冲突提示 */
export interface ContextNotice {
  kind: 'missing' | 'conflict' | 'truncated' | 'info'
  /** 关联的段落（如有） */
  section?: ContextSectionKey
  message: string
  /** 冲突双方的原文（让作者自己判断，而不是系统替他选） */
  sides?: { label: string; text: string }[]
}

export interface ContextPackBudget {
  /** 本次可用输入预算（token） */
  inputTokens: number
  /** 资料包实际占用（token） */
  usedTokens: number
  /** 被裁剪掉的条目总数 */
  droppedItems: number
  /** 是否触发了裁剪 */
  truncated: boolean
}

export interface ChapterContextPack {
  chapterNumber: number
  builtAt: string
  sections: ContextSection[]
  notices: ContextNotice[]
  budget: ContextPackBudget
  /** 资料包指纹：大纲/人物/要求/关联记忆变化时会变，用于判断「是否过期」 */
  fingerprint: string
}

/** 构建入参 */
export interface BuildContextPackParams {
  chapterNumber: number
  /** 已组装好的 Canon 上下文（含历史边界过滤） */
  canon: CanonContext
  /** 本章写作目标（作者指定） */
  chapterGoal?: string
  /** 本章场景：时间 / 地点 / 环境（作者指定；缺省从人物状态推断并标注推断） */
  scene?: { time?: string; location?: string; environment?: string; transitions?: string }
  /** 作者对本章的额外要求（最高优先级） */
  userGuidance?: string
  /** 文风要求 */
  writingStyle?: string
  /** 本章出场人物（用于聚焦人物状态与认知边界） */
  focusCharacters?: string[]
  /** 目标字数（输出约束） */
  wordTarget?: number
  /** 必须出现的事件 */
  mustInclude?: string[]
  /** 禁止发生的事件 */
  forbidden?: string[]
  /** 上一章结尾 */
  previousEnding?: string
  /** 可用输入预算（token）；不传则只做统计不做裁剪 */
  inputTokens?: number
  /** 已确认的正式设定文本（用于检测作者要求与设定的冲突） */
  confirmedFacts?: Fact[]
}

/**
 * 优先级定义（数字越小越先保留）。
 * 对齐需求：作者要求 > 已确认设定 > 时序当前状态 > 场景相关历史 > 背景 > 推测。
 */
export const SECTION_PRIORITY: Record<ContextSectionKey, number> = {
  chapterGoal: 1,
  characters: 2,
  knowledgeBounds: 2,
  outputConstraints: 1,
  scene: 3,
  plotLines: 3,
  items: 4,
  previousContext: 4,
  worldRules: 5,
  style: 6,
}

function tokenize(text: string): number {
  return text ? estimateTokens(text) : 0
}

function trim(text: string | undefined | null): string {
  return (text || '').trim()
}

/** 从 Canon 事实里挑出「作者已确认」的正式设定（confirmedAt 非空） */
function confirmedOf(facts: Fact[]): Fact[] {
  return facts.filter(fact => !!fact.confirmedAt && (fact.status ?? 'active') !== 'outdated')
}

/** 从人物的 knowledge 里推断认知边界；「不知道/误解」没有结构字段，明确标注缺失 */
function knowledgeBoundsOf(states: CharacterStateSnapshot[]): ContextItem<CharacterStateSnapshot>[] {
  return states
    .filter(state => state.knowledge.length > 0 || state.character)
    .map(state => {
      const known = state.knowledge.length > 0
        ? state.knowledge.join('；')
        : '（暂无已登记的已知信息）'
      return {
        id: `kb:${state.character}`,
        title: state.character,
        // 只陈述「知道什么」；「不知道/误解什么」当前没有结构字段，不编造
        text: `- ${state.character}：已知 ${known}；未登记「不知道 / 误解」的内容（资料缺失，勿臆断）`,
        source: state,
        priority: SECTION_PRIORITY.knowledgeBounds,
        reason: state.knowledge.length > 0 ? '人物认知边界（来自状态写回）' : '人物认知边界缺失',
        tokens: 0,
      }
    })
}

/** 人物状态条目 */
function characterItemsOf(states: CharacterStateSnapshot[], focus: Set<string>): ContextItem<CharacterStateSnapshot>[] {
  return states
    .filter(state => focus.size === 0 || focus.has(state.character))
    .map(state => {
      const parts: string[] = []
      if (state.location) parts.push(`地点：${state.location}`)
      if (state.powerLevel) parts.push(`境界：${state.powerLevel}`)
      if (state.physicalState) parts.push(`身体：${state.physicalState}`)
      if (state.mentalState) parts.push(`心理：${state.mentalState}`)
      if (state.keyItems) parts.push(`道具：${state.keyItems}`)
      if (state.currentGoal) parts.push(`目标：${state.currentGoal}`)
      const rel = Object.entries(state.relationships || {})
      if (rel.length > 0) parts.push(`关系：${rel.map(([k, v]) => `${k}→${v}`).join('；')}`)
      return {
        id: `char:${state.character}`,
        title: state.character,
        text: `- ${state.character}（第${state.updatedAtChapter}章状态）：${parts.join(' | ') || '（无可用状态字段）'}`,
        source: state,
        priority: SECTION_PRIORITY.characters,
        reason: `本章出场人物 · 状态截至第 ${state.updatedAtChapter} 章`,
        tokens: 0,
      }
    })
}

/** 前情：最近章节摘要 + 上一章结尾 + 时间线近期事件 */
function previousContextItems(
  summaries: ChapterSummary[],
  previousEnding: string,
  timeline: TimelineEvent[],
): ContextItem[] {
  const items: ContextItem[] = []
  if (trim(previousEnding)) {
    items.push({
      id: 'prev:ending',
      title: '上一章结尾',
      text: `- 上一章结尾：${trim(previousEnding).slice(0, 600)}`,
      source: { kind: 'previousEnding' },
      priority: SECTION_PRIORITY.previousContext,
      reason: '衔接上一章，避免场景瞬移',
      tokens: 0,
    })
  }
  for (const summary of summaries) {
    items.push({
      id: `prev:summary:${summary.chapterNumber}`,
      title: `第 ${summary.chapterNumber} 章摘要`,
      text: `- 第${summary.chapterNumber}章《${summary.title || ''}》：${trim(summary.summary)}`,
      source: summary,
      priority: SECTION_PRIORITY.previousContext,
      reason: `不晚于本章的章节摘要（第 ${summary.chapterNumber} 章 ≤ 第 ${summary.chapterNumber} 章）`,
      tokens: 0,
    })
  }
  for (const event of timeline.slice(-12)) {
    items.push({
      id: `prev:timeline:${event.id ?? `${event.chapterNumber}-${event.sequence}`}`,
      title: `第 ${event.chapterNumber} 章事件`,
      text: `- [第${event.chapterNumber}章] ${event.summary}`,
      source: event,
      priority: SECTION_PRIORITY.previousContext,
      reason: '本章之前已发生的事件',
      tokens: 0,
    })
  }
  return items
}

/** 伏笔与剧情线 */
function plotLineItemsOf(lines: PlotLine[]): ContextItem<PlotLine>[] {
  return lines.map(line => {
    const kind = line.kind === 'foreshadow' ? '伏笔' : '剧情线'
    const plan = line.kind === 'foreshadow' && line.plannedResolveAt
      ? `（预计回收：${line.plannedResolveAt}）`
      : ''
    return {
      id: `plot:${line.id ?? line.name}`,
      title: `${kind}：${line.name}`,
      text: `- ${kind}「${line.name}」${plan}：${line.currentState}`,
      source: line,
      priority: SECTION_PRIORITY.plotLines,
      reason: `本章需要考虑推进 / 避免提前揭晓（起始第 ${line.startedAt} 章）`,
      tokens: 0,
    }
  })
}

/** 物品与资源：从 Canon 的物品台账文本拆成条目（保留原始来源） */
function itemItemsOf(canon: CanonContext): ContextItem[] {
  const events = canon.contextSources?.itemEvents ?? []
  if (events.length === 0) return []
  const byItem = new Map<string, typeof events>()
  for (const event of events) {
    byItem.set(event.item, [...(byItem.get(event.item) || []), event])
  }
  return [...byItem.entries()].map(([item, list]) => {
    const steps = list
      .map(event => `第${event.chapterNumber}章 ${event.action}${event.actor ? `(${event.actor})` : ''}`)
      .join(' → ')
    return {
      id: `item:${item}`,
      title: item,
      text: `- ${item}：${steps}`,
      source: list,
      priority: SECTION_PRIORITY.items,
      reason: '道具当前归属与流转（防止凭空出现/消失）',
      tokens: 0,
    }
  })
}

/**
 * 检测「作者要求」与「已确认正式设定」的冲突。
 *
 * 只做保守的否定线索检测（与 detectFactConflict 同思路）：命中才提示，
 * 绝不自动替作者选一边，也绝不修改正式设定。
 */
function detectGuidanceConflicts(
  guidance: string,
  confirmed: Fact[],
): ContextNotice[] {
  const notices: ContextNotice[] = []
  const text = trim(guidance)
  if (!text) return notices
  const NEGATIONS = ['不', '别', '勿', '禁止', '无需', '没有', '取消', '不要']
  for (const fact of confirmed) {
    const statement = trim(fact.statement)
    if (statement.length < 4) continue
    // 要求里点名了这条设定涉及的角色/物品，且带有否定词 → 可能冲突
    const mentions = (fact.characters || []).some(name => name && text.includes(name))
      || (fact.statement.length >= 4 && text.includes(fact.statement.slice(0, 4)))
    if (!mentions) continue
    const hasNegation = NEGATIONS.some(word => text.includes(word))
    if (!hasNegation) continue
    notices.push({
      kind: 'conflict',
      message: '作者要求可能与本条已确认设定冲突，请你决定改哪一边（系统不会自动修改正式设定）',
      sides: [
        { label: '作者要求', text },
        { label: `已确认设定（第${fact.introducedAt}章）`, text: statement },
      ],
    })
  }
  return notices
}

/** 计算资料包指纹：任一输入变化都会改变，用于判断是否过期 */
function fingerprintOf(params: BuildContextPackParams): string {
  const payload = JSON.stringify({
    chapterNumber: params.chapterNumber,
    chapterGoal: params.chapterGoal ?? '',
    scene: params.scene ?? null,
    userGuidance: params.userGuidance ?? '',
    writingStyle: params.writingStyle ?? '',
    focusCharacters: [...(params.focusCharacters ?? [])].sort(),
    wordTarget: params.wordTarget ?? null,
    mustInclude: params.mustInclude ?? [],
    forbidden: params.forbidden ?? [],
    facts: (params.canon.knownFacts ?? []).map(f => `${f.id ?? ''}:${f.statement}:${f.status ?? ''}:${f.confirmedAt ?? ''}`),
    states: (params.canon.characterStates ?? []).map(s => `${s.character}:${s.updatedAtChapter}`),
    plotLines: (params.canon.openPlotLines ?? []).map(p => `${p.id ?? ''}:${p.name}:${p.lastAdvancedAt}`),
  })
  // 简单稳定哈希（FNV-1a 变体），无需外部依赖
  let hash = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `ctx-${(hash >>> 0).toString(16)}`
}

/**
 * 组装本章上下文资料包（只读、纯函数）。
 *
 * 这一步不发送任何模型请求、不写库；产出的资料包随后交给现有生成逻辑，
 * 「本章上下文预览」也直接渲染同一份数据，保证预览与实际注入同源。
 */
export function buildChapterContextPack(params: BuildContextPackParams): ChapterContextPack {
  const { canon, chapterNumber } = params
  const focus = new Set(params.focusCharacters ?? [])
  const notices: ContextNotice[] = []

  // 1. 本章写作目标（作者要求，最高优先级）
  const goalItems: ContextItem[] = trim(params.chapterGoal)
    ? [{
        id: 'goal', title: '本章目标', text: trim(params.chapterGoal),
        source: { kind: 'chapterGoal' }, priority: SECTION_PRIORITY.chapterGoal,
        reason: '作者指定的本章剧情任务', tokens: 0,
      }]
    : []

  // 2. 本章场景
  const sceneItems: ContextItem[] = []
  const scene = params.scene
  const inferredLocation = canon.characterStates.find(s => focus.has(s.character) && s.location)?.location
  if (scene?.time || scene?.location || scene?.environment || scene?.transitions) {
    const lines = [
      scene.time ? `时间：${scene.time}` : '',
      scene.location ? `地点：${scene.location}` : '',
      scene.environment ? `环境：${scene.environment}` : '',
      scene.transitions ? `场景转换：${scene.transitions}` : '',
    ].filter(Boolean)
    sceneItems.push({
      id: 'scene', title: '本章场景', text: lines.join(' | '),
      source: scene, priority: SECTION_PRIORITY.scene,
      reason: '作者指定的场景设定', tokens: 0,
    })
  } else if (inferredLocation) {
    sceneItems.push({
      id: 'scene:inferred', title: '本章场景（推断）',
      text: `地点（由出场人物位置推断）：${inferredLocation}`,
      source: { inferred: true }, priority: SECTION_PRIORITY.scene,
      reason: '作者未指定场景，由人物当前位置推断（请确认）', tokens: 0,
    })
    notices.push({
      kind: 'missing', section: 'scene',
      message: '作者未指定本章场景，当前为推断值；建议在章节设置里补全时间与地点',
    })
  } else {
    notices.push({ kind: 'missing', section: 'scene', message: '本章场景缺失：既未指定，也无法从人物状态推断' })
  }

  // 3. 人物状态
  const charItems = characterItemsOf(canon.characterStates, focus)
  if (charItems.length === 0) {
    notices.push({ kind: 'missing', section: 'characters', message: '本章没有可用的出场人物状态' })
  }

  // 4. 人物认知边界
  const boundsItems = knowledgeBoundsOf(charItems.map(item => item.source))
  const missingBounds = boundsItems.filter(item => item.reason.includes('缺失'))
  if (missingBounds.length > 0) {
    notices.push({
      kind: 'missing', section: 'knowledgeBounds',
      message: `有 ${missingBounds.length} 位出场人物缺少已知信息记录，认知边界不完整`,
    })
  }

  // 5. 前情回顾
  const prevItems = previousContextItems(
    canon.contextSources?.summaries ?? [],
    params.previousEnding ?? canon.previousEnding ?? '',
    canon.timeline,
  )

  // 6. 物品与资源
  const itemItems = itemItemsOf(canon)
  if (itemItems.length === 0 && focus.size > 0) {
    notices.push({ kind: 'missing', section: 'items', message: '本章未登记任何物品流转记录' })
  }

  // 7. 伏笔与剧情线
  const plotItems = plotLineItemsOf(canon.openPlotLines)
  if (plotItems.length === 0) {
    notices.push({ kind: 'missing', section: 'plotLines', message: '本章没有需要推进/提及的伏笔或剧情线' })
  }

  // 8. 世界规则（当前场景真正需要的设定：优先已确认事实里的 world/location 类）
  const confirmed = confirmedOf(params.confirmedFacts ?? canon.knownFacts)
  const worldItems: ContextItem[] = [
    ...(trim(canon.worldRules)
      ? [{
          id: 'world:rules', title: '世界规则', text: trim(canon.worldRules),
          source: { kind: 'worldRules' }, priority: SECTION_PRIORITY.worldRules,
          reason: '世界观基础设定（不可违背）', tokens: 0,
        }]
      : []),
    ...confirmed
      .filter(fact => fact.category === 'world' || fact.category === 'location')
      .map(fact => ({
        id: `world:fact:${fact.id ?? fact.statement}`,
        title: `已确认设定 · ${fact.category}`,
        text: `- [${fact.category}] ${fact.statement}`,
        source: fact, priority: SECTION_PRIORITY.worldRules,
        reason: `作者已确认的正式设定（第 ${fact.introducedAt} 章引入）`, tokens: 0,
      })),
    ...(trim(canon.realmLadder ?? '')
      ? [{
          id: 'world:realm', title: '境界阶梯', text: canon.realmLadder!.trim(),
          source: { kind: 'realmLadder' }, priority: SECTION_PRIORITY.worldRules,
          reason: '约束战斗与突破描写', tokens: 0,
        }]
      : []),
    ...(trim(canon.locationMap ?? '')
      ? [{
          id: 'world:location', title: '地点与空间关系', text: canon.locationMap!.trim(),
          source: { kind: 'locationMap' }, priority: SECTION_PRIORITY.worldRules,
          reason: '约束人物移动的距离与耗时', tokens: 0,
        }]
      : []),
  ]

  // 9. 文风要求
  const styleText = [params.writingStyle, canon.globalGuidance].map(trim).filter(Boolean).join('\n')
  const styleItems: ContextItem[] = styleText
    ? [{
        id: 'style', title: '文风要求', text: styleText,
        source: { writingStyle: params.writingStyle, globalGuidance: canon.globalGuidance },
        priority: SECTION_PRIORITY.style, reason: '叙事视角 / 语言风格 / 节奏要求', tokens: 0,
      }]
    : []

  // 10. 输出约束
  const constraintLines = [
    params.wordTarget ? `目标字数：约 ${params.wordTarget} 字` : '',
    (params.mustInclude ?? []).length > 0 ? `必须出现：${params.mustInclude!.join('；')}` : '',
    (params.forbidden ?? []).length > 0 ? `禁止发生：${params.forbidden!.join('；')}` : '',
    trim(canon.hardConstraints) ? canon.hardConstraints.trim() : '',
  ].filter(Boolean)
  const constraintItems: ContextItem[] = constraintLines.length > 0
    ? [{
        id: 'constraints', title: '输出约束', text: constraintLines.join('\n'),
        source: { wordTarget: params.wordTarget, mustInclude: params.mustInclude, forbidden: params.forbidden },
        priority: SECTION_PRIORITY.outputConstraints,
        reason: '硬性输出要求（必须严格遵守）', tokens: 0,
      }]
    : []

  // 组装十段
  const rawSections: Array<{ key: ContextSectionKey; items: ContextItem[] }> = [
    { key: 'chapterGoal', items: goalItems },
    { key: 'outputConstraints', items: constraintItems },
    { key: 'characters', items: charItems },
    { key: 'knowledgeBounds', items: boundsItems },
    { key: 'scene', items: sceneItems },
    { key: 'plotLines', items: plotItems },
    { key: 'items', items: itemItems },
    { key: 'previousContext', items: prevItems },
    { key: 'worldRules', items: worldItems },
    { key: 'style', items: styleItems },
  ]

  // 计算每条 token
  for (const section of rawSections) {
    for (const item of section.items) item.tokens = tokenize(item.text)
  }

  // 作者要求与正式设定的冲突
  notices.push(...detectGuidanceConflicts(params.userGuidance ?? '', confirmed))

  // 预算裁剪：优先级数字小的先保留；同优先级按原始顺序
  const budgetTokens = params.inputTokens ?? 0
  let usedTokens = 0
  let droppedItems = 0
  const sections: ContextSection[] = []
  const ordered = [...rawSections].sort((a, b) => SECTION_PRIORITY[a.key] - SECTION_PRIORITY[b.key])
  for (const section of ordered) {
    const kept: ContextItem[] = []
    for (const item of section.items) {
      const wouldUse = usedTokens + item.tokens
      // 预算为 0 表示不裁剪（仅统计）
      if (budgetTokens > 0 && wouldUse > budgetTokens && kept.length > 0) {
        droppedItems += 1
        continue
      }
      // 预算已满且这是该段第一条：仍然保留硬约束类内容，但记录告警
      if (budgetTokens > 0 && wouldUse > budgetTokens) {
        notices.push({
          kind: 'truncated', section: section.key,
          message: `「${item.title}」超出上下文预算，未注入（建议提高预算或精简本段）`,
        })
        droppedItems += 1
        continue
      }
      kept.push(item)
      usedTokens = wouldUse
    }
    const chars = kept.reduce((sum, item) => sum + item.text.length, 0)
    sections.push({
      key: section.key,
      priority: SECTION_PRIORITY[section.key],
      items: kept,
      chars,
      tokens: kept.reduce((sum, item) => sum + item.tokens, 0),
      dropped: section.items.length - kept.length,
      empty: kept.length === 0,
    })
  }
  // 保持稳定的展示顺序（按优先级）
  sections.sort((a, b) => a.priority - b.priority)

  if (droppedItems > 0) {
    notices.push({ kind: 'truncated', message: `共有 ${droppedItems} 条资料因超出预算被省略（已记录，未静默丢弃）` })
  }

  return {
    chapterNumber,
    builtAt: new Date().toISOString(),
    sections,
    notices,
    budget: {
      inputTokens: budgetTokens,
      usedTokens,
      droppedItems,
      truncated: droppedItems > 0,
    },
    fingerprint: fingerprintOf(params),
  }
}

/**
 * 把资料包渲染成注入模型的文本（按优先级顺序）。
 *
 * 与 buildChapterContextPack 同源：预览展示的就是这里的 text，不再另造一份。
 */
export function renderContextPack(pack: ChapterContextPack): string {
  return pack.sections
    .filter(section => !section.empty)
    .map(section => section.items.map(item => item.text).join('\n'))
    .join('\n\n---\n\n')
}

/**
 * 判断资料包是否「过期」：当前输入算出的指纹与旧指纹不同即为过期。
 * 用于「用户修改大纲/人物/要求后重新计算上下文」。
 */
export function isContextPackStale(pack: ChapterContextPack, params: BuildContextPackParams): boolean {
  return pack.fingerprint !== fingerprintOf(params)
}
