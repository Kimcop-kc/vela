/**
 * 写作流水线（第四阶段）—— 作家级写作引擎
 *
 * 六步流程：理解任务 → 章节策划 → 场景设计 → 正文生成 → 章节自检 → 编辑修订。
 *
 * 设计原则（按需求原文）：
 *   - **优先复用**：不新造模型调用通道（仍走 `ipc.invoke('llm:generate')`）、
 *     不新造上下文组装（复用第三阶段 `chapter-context-pack`）、
 *     不新造相似度算法（复用 `similarity.findCommonRuns`）、
 *     不新造一致性闸门（复用 `canon-adapter.checkDraftConsistency`）。
 *   - **本模块只做「编排 + 提示词 + 状态机 + 统计」**，纯函数占绝大多数，便于测试。
 *   - **不覆盖正文**：确认的正文单独存放（`confirmedText`），生成失败只写 `error`，
 *     绝不回写 `text` / `confirmedText`。
 */
import { ipc } from '../ipc-client'
import { findCommonRuns, MIN_COMMON_RUN } from './similarity'
import { checkDraftConsistency, type DraftConsistencyResult } from './canon-adapter'
import { extractCanonWriteback, type CanonContext } from '../narrative-consistency'
import type { PlotBeat, PlotOutlineRecord } from '../../shared/reconstruct'
import type { ChapterContextPack, ContextSectionKey } from '../workflows/chapter-context-pack'

// ============================================================
// 一、写作模式
// ============================================================

export type WritingMode =
  | 'outline-expand'
  | 'auto-plan'
  | 'continue'
  | 'scene-only'
  | 'rewrite'
  | 'polish'
  | 'expand'

export const WRITING_MODES: WritingMode[] = [
  'outline-expand',
  'auto-plan',
  'continue',
  'scene-only',
  'rewrite',
  'polish',
  'expand',
]

/**
 * 每种模式的「生成约束」。
 *
 * `keepFactsOnly` 为真的模式（润色）不允许引入新事件，是「润色后剧情事实不变」的提示词侧保证；
 * 结构侧保证由 `assertFactsUnchanged()` 与测试共同承担。
 */
export interface ModePolicy {
  /** 是否必须承接已有正文 */
  requiresPrecedingText: boolean
  /** 是否只允许调整表达、不得增删事件与事实 */
  keepFactsOnly: boolean
  /** 是否允许引入新的事件（扩写允许补细节但不许补新事件，故为 false） */
  allowNewEvents: boolean
  /** 系统提示中的硬性约束 */
  rules: string[]
}

export const MODE_POLICIES: Record<WritingMode, ModePolicy> = {
  'outline-expand': {
    requiresPrecedingText: false,
    keepFactsOnly: false,
    allowNewEvents: true,
    rules: ['按本场景大纲把事件写成正文，不提前推进后续场景。'],
  },
  'auto-plan': {
    requiresPrecedingText: false,
    keepFactsOnly: false,
    allowNewEvents: true,
    rules: ['按卷纲与当前进度推进本章，只完成本场景该完成的事，不越界写后面。'],
  },
  continue: {
    requiresPrecedingText: true,
    keepFactsOnly: false,
    allowNewEvents: true,
    rules: ['严格承接已有正文的最后一句话续写，不复述、不重写已经写过的内容。'],
  },
  'scene-only': {
    requiresPrecedingText: false,
    keepFactsOnly: false,
    allowNewEvents: true,
    rules: ['只写作者指定的这一个场景，开头可以直接进入该场景，不必承接前文。'],
  },
  rewrite: {
    requiresPrecedingText: false,
    keepFactsOnly: false,
    allowNewEvents: true,
    rules: ['按作者意见重写本场景，保留本场景应完成的事件，只改写法。'],
  },
  polish: {
    requiresPrecedingText: false,
    keepFactsOnly: true,
    allowNewEvents: false,
    rules: [
      '这是润色：只调整表达、节奏与用词，**不得增删任何事件、人物、物品、时间与地点**。',
      '不得改变人物已经知道 / 不知道的信息边界。',
      '不得以简单替换同义词充数；要改的是句式、语序、冗余与语感。',
    ],
  },
  expand: {
    requiresPrecedingText: false,
    keepFactsOnly: false,
    allowNewEvents: false,
    rules: [
      '这是扩写：增加**有作用**的动作、对话、环境与心理细节。',
      '新增内容必须服务于人物、冲突或场景氛围，不得靠重复内容凑字数。',
      '不得新增事件、不得改变剧情走向与结局。',
    ],
  },
}

// ============================================================
// 二、字数统计（明确区分口径）
// ============================================================

export interface TextStats {
  /** 总字符数（原样，含标点、空格、换行） */
  totalChars: number
  /** 汉字数量（仅 CJK 统一表意文字） */
  chineseChars: number
  /** 去掉所有空白后的字符数（含标点） */
  withoutWhitespace: number
  /** 去掉开头标题行后的总字符数 */
  withoutTitle: number
  /** 去掉标题与空白后的汉字数量 */
  chineseWithoutTitle: number
}

const HANZI = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/** 开头标题行：Markdown 标题或「第 N 章 …」这类章名 */
const TITLE_LINE = /^\s*(?:#{1,6}\s+.*|第\s*[0-9一二三四五六七八九十百千]+\s*章[^\n]*)\n?/

/** 去掉开头标题行（只去一行，不动正文内部的标题） */
export function stripLeadingTitle(text: string): string {
  return text.replace(TITLE_LINE, '')
}

export function countText(text: string): TextStats {
  const raw = text ?? ''
  const body = stripLeadingTitle(raw)
  let chineseChars = 0
  for (const char of raw) if (HANZI.test(char)) chineseChars += 1
  let chineseWithoutTitle = 0
  for (const char of body) if (HANZI.test(char)) chineseWithoutTitle += 1
  return {
    totalChars: raw.length,
    chineseChars,
    withoutWhitespace: raw.replace(/\s/g, '').length,
    withoutTitle: body.length,
    chineseWithoutTitle,
  }
}

/**
 * 把目标字数分配到各场景。
 *
 * 权重默认均分；调用方可按场景在剧情里的分量给权重。
 * 保证：各项之和 == 目标（余数补给靠前的场景），且每个场景至少 `minWords`。
 */
export function allocateWordBudget(
  totalWords: number,
  sceneCount: number,
  weights?: number[],
  minWords = 200,
): number[] {
  if (sceneCount <= 0) return []
  const total = Math.max(0, Math.round(totalWords))
  const raw = weights && weights.length === sceneCount ? weights.map(w => (w > 0 ? w : 0)) : new Array(sceneCount).fill(1)
  const sum = raw.reduce((acc, w) => acc + w, 0)
  const normalized = sum > 0 ? raw : new Array(sceneCount).fill(1)
  const normalizedSum = sum > 0 ? sum : sceneCount
  const out = normalized.map(w => Math.max(minWords, Math.round((total * w) / normalizedSum)))
  // 把与目标的差额还给最长的场景，避免出现「各段加起来不等于目标」的假承诺
  const drift = total - out.reduce((acc, n) => acc + n, 0)
  if (drift !== 0) {
    let target = 0
    for (let i = 1; i < out.length; i++) if (out[i] > out[target]) target = i
    out[target] = Math.max(minWords, out[target] + drift)
  }
  return out
}

// ============================================================
// 三、章节理解 + 章节策划（第一步 / 第二步）
// ============================================================

export interface CharacterDrive {
  character: string
  goal: string
  obstacle: string
}

export interface ChapterPlan {
  /** 本章必须完成的剧情任务 */
  goal: string
  /** 开场状态 */
  openingState: string
  /** 本章主要矛盾 */
  centralConflict: string
  /** 人物各自的目标与阻碍 */
  drives: CharacterDrive[]
  /** 事件发展顺序 */
  eventOrder: string[]
  /**
   * 必须出现的事件描述（只放事件本身，不带「第 N 段《标题》」这类前缀）。
   * 与 `eventOrder` 分开：前者给人看，后者用来做覆盖度检查——
   * 带上前缀会把「第 N 段」这种到处都有的词算成命中，检查就假通过了。
   */
  mustEvents: string[]
  /** 本章结束时发生了什么变化 */
  endingChange: string
  /** 结尾要求（钩子） */
  endingRequirement: string
  /** 与既有剧情的矛盾提示（本地推导，供作者判断，不自动改设定） */
  contradictions: string[]
}

/** 从资料包里取某一段的纯文本（供推导使用） */
function sectionTextOf(pack: ChapterContextPack | null | undefined, key: ContextSectionKey): string[] {
  const section = pack?.sections.find(item => item.key === key)
  return section ? section.items.map(item => item.text) : []
}

/** 出场人物名（资料包 characters 段的 source 是角色状态快照） */
export function focusCharactersOf(pack: ChapterContextPack | null | undefined): string[] {
  const section = pack?.sections.find(item => item.key === 'characters')
  if (!section) return []
  const names: string[] = []
  for (const item of section.items) {
    const source = item.source as { character?: string } | undefined
    const name = source?.character ?? item.title
    if (name) names.push(name)
  }
  return [...new Set(names)]
}

/**
 * 第一步 + 第二步：理解任务并生成章节策划。
 *
 * **本地推导，不调用模型**——这样策划结果可复现、可测试，
 * 也不会因为多一次模型调用而引入不确定性。模型只在正文生成时才介入。
 */
export function buildChapterPlan(params: {
  outline: PlotOutlineRecord
  beats: PlotBeat[]
  contextPack?: ChapterContextPack | null
  /** 作者对本章的额外要求（最高优先级） */
  userGuidance?: string
}): ChapterPlan {
  const { outline, beats, contextPack, userGuidance } = params
  const beatList = beats.length > 0 ? beats : outline.beats

  const goal = outline.premise || outline.title || '（大纲未填写本章目标）'
  const centralConflict = outline.centralConflict || beatList.find(b => b.conflict)?.conflict || ''

  // 开场状态：优先用资料包里的上一章结尾，其次用大纲的连续性说明
  const previousEnding = sectionTextOf(contextPack, 'previousContext')
    .find(text => text.includes('上一章结尾'))
  const openingState = previousEnding
    ? previousEnding.replace(/^-\s*上一章结尾：/, '')
    : (outline.continuityNotes || '（未提供上一章结尾与连续性说明，开场状态需作者补充）')

  // 人物目标与阻碍：主角取大纲的 protagonistGoal，其余人物取资料包里的状态目标
  const drives: CharacterDrive[] = []
  const protagonistName = focusCharactersOf(contextPack)[0] ?? ''
  if (outline.protagonistGoal) {
    drives.push({
      character: protagonistName || '主角',
      goal: outline.protagonistGoal,
      obstacle: centralConflict || '（未填写阻碍）',
    })
  }
  for (const text of sectionTextOf(contextPack, 'characters')) {
    const match = /^-\s*([^（(]+)[（(][^）)]*[）)]：(.*)$/.exec(text)
    if (!match) continue
    const name = match[1].trim()
    if (drives.some(drive => drive.character === name)) continue
    const goalMatch = /目标：([^|]+)/.exec(match[2])
    if (!goalMatch) continue
    drives.push({ character: name, goal: goalMatch[1].trim(), obstacle: '（未登记阻碍）' })
  }

  const eventOrder = beatList
    .map(beat => `第 ${beat.sequence} 段《${beat.title}》：${beat.event}`)
    .filter(Boolean)
  const mustEvents = beatList.map(beat => beat.event).filter(Boolean)

  const endingChange = outline.characterChanges
    || beatList[beatList.length - 1]?.characterChange
    || '（未填写本章结束时的人物变化）'
  const endingRequirement = beatList[beatList.length - 1]?.hook
    || outline.foreshadowing
    || ''

  // 矛盾提示：作者要求里出现否定线索、而大纲正相反时，明确摆出来让作者判断
  const contradictions: string[] = []
  if (userGuidance && outline.foreshadowing) {
    const negations = ['不要', '别', '禁止', '不写', '取消', '无需']
    const hits = negations.filter(word => userGuidance.includes(word))
    if (hits.length > 0 && userGuidance.includes(outline.foreshadowing.slice(0, 4))) {
      contradictions.push(
        `作者要求含否定表述（${hits.join('、')}），同时大纲的伏笔是「${outline.foreshadowing}」——两者可能冲突，请作者确认以哪个为准。`,
      )
    }
  }

  return {
    goal,
    openingState,
    centralConflict,
    drives,
    eventOrder,
    mustEvents,
    endingChange,
    endingRequirement,
    contradictions,
  }
}

// ============================================================
// 四、场景设计（第三步）
// ============================================================

export type SegmentStatus = 'pending' | 'generating' | 'generated' | 'editing' | 'confirmed' | 'failed'

export interface ScenePlan {
  sequence: number
  beatTitle: string
  /** 场景目的：这场戏必须完成什么 */
  purpose: string
  time: string
  location: string
  characters: string[]
  conflict: string
  /** 信息揭示：这一场要让读者/人物知道什么 */
  reveal: string
  /** 情绪变化 */
  emotionShift: string
  /** 场景转折 */
  turn: string
  /** 场景结束时留下的问题 */
  openQuestion: string
  /** 该场景的目标字数 */
  targetWords: number
  /** 时间/地点是否来自推断（推断值必须显式标注，不冒充作者设定） */
  sceneInferred: boolean
}

/** 从资料包的 scene 段里抠出时间 / 地点（若作者填过） */
function sceneFromPack(pack: ChapterContextPack | null | undefined): { time: string; location: string; inferred: boolean } {
  const texts = sectionTextOf(pack, 'scene')
  for (const text of texts) {
    const time = /时间：([^|｜]+)/.exec(text)?.[1]?.trim() ?? ''
    const location = /地点：([^|｜]+)/.exec(text)?.[1]?.trim() ?? ''
    if (time || location) {
      return { time, location, inferred: text.includes('推断') }
    }
  }
  return { time: '', location: '', inferred: true }
}

/**
 * 第三步：把 beat 展开成场景计划（最小可靠版本：1 个 beat = 1 个场景）。
 *
 * 时间 / 地点优先取作者在资料包里登记的；没有就取出场人物状态里的位置，
 * 并标 `sceneInferred = true` —— 明确「这是推断」，不替作者敲定场景。
 */
export function buildScenes(params: {
  beats: PlotBeat[]
  contextPack?: ChapterContextPack | null
  totalWords: number
  weights?: number[]
}): ScenePlan[] {
  const { beats, contextPack, totalWords, weights } = params
  const budgets = allocateWordBudget(totalWords, beats.length, weights)
  const fromPack = sceneFromPack(contextPack)
  const characterNames = focusCharactersOf(contextPack)

  // 人物状态里的位置，作为地点兜底
  const stateLocations = new Map<string, string>()
  for (const item of sectionTextOf(contextPack, 'characters')) {
    const match = /^-\s*([^（(]+)[（(]/.exec(item)
    const loc = /地点：([^|]+)/.exec(item)?.[1]?.trim()
    if (match && loc) stateLocations.set(match[1].trim(), loc)
  }

  return beats.map((beat, index) => {
    const location = fromPack.location
      || [...stateLocations.values()][0]
      || ''
    return {
      sequence: beat.sequence,
      beatTitle: beat.title,
      purpose: beat.event || beat.title,
      time: fromPack.time,
      location,
      characters: characterNames,
      conflict: beat.conflict,
      reveal: beat.consequence || beat.characterChange,
      emotionShift: beat.characterChange,
      turn: beat.characterChange,
      openQuestion: beat.hook,
      targetWords: budgets[index] ?? 0,
      sceneInferred: fromPack.inferred || !fromPack.location,
    }
  })
}

// ============================================================
// 五、分段状态机（第五步：可中断、可重试、不覆盖已确认）
// ============================================================

/**
 * 允许的状态迁移。
 *
 * 安全闸门：`confirmed` 只能先退回 `editing` 才能重新生成 ——
 * 已确认的正文不允许被一次误点的「重新生成」直接顶掉。
 */
const TRANSITIONS: Record<SegmentStatus, SegmentStatus[]> = {
  pending: ['generating'],
  generating: ['generated', 'failed'],
  generated: ['editing', 'confirmed', 'generating'],
  editing: ['generated', 'confirmed', 'generating'],
  confirmed: ['editing'],
  failed: ['generating'],
}

export function canTransition(from: SegmentStatus, to: SegmentStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export interface SegmentInputDigest {
  mode: WritingMode
  precedingChars: number
  precedingTruncated: boolean
  targetWords: number
  /** 已在前文交代过的信息条数（用于「避免重复交代」） */
  revealedCount: number
  instruction?: string
}

export interface PipelineSegment {
  sequence: number
  beatTitle: string
  status: SegmentStatus
  /** 临时生成文本（作者确认前**不是**正文） */
  text: string
  /** 作者确认的正文（只有它算数） */
  confirmedText: string
  stats: TextStats
  /** 本次生成的输入摘要（不含全文，避免日志里出现大段正文） */
  inputDigest?: SegmentInputDigest
  modelId?: string
  error?: string
  updatedAt: string
}

export function createSegment(scene: ScenePlan): PipelineSegment {
  return {
    sequence: scene.sequence,
    beatTitle: scene.beatTitle,
    status: 'pending',
    text: '',
    confirmedText: '',
    stats: countText(''),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 迁移一个段落的状态。
 *
 * 关键约束：**生成失败只写 `error`，绝不动 `text` / `confirmedText`** ——
 * 这是「生成失败不会覆盖原文」的结构保证。
 */
export function transitionSegment(
  segment: PipelineSegment,
  to: SegmentStatus,
  patch: Partial<Pick<PipelineSegment, 'text' | 'error' | 'modelId' | 'inputDigest'>> = {},
): PipelineSegment {
  if (!canTransition(segment.status, to)) {
    // 非法迁移不抛错、不改数据：流水线是长时间运行的任务，宁可停在原状态也不要崩
    return segment
  }
  const next: PipelineSegment = { ...segment, status: to, updatedAt: new Date().toISOString() }
  if (to === 'failed') {
    next.error = patch.error ?? segment.error ?? '生成失败'
    return next
  }
  if (patch.text !== undefined) {
    next.text = patch.text
    next.stats = countText(patch.text)
    next.error = undefined
  }
  if (patch.modelId !== undefined) next.modelId = patch.modelId
  if (patch.inputDigest !== undefined) next.inputDigest = patch.inputDigest
  if (to === 'generated' || to === 'editing') next.error = undefined
  return next
}

/** 作者确认：把临时文本提升为正文 */
export function confirmSegment(segment: PipelineSegment): PipelineSegment {
  const confirmed: PipelineSegment = {
    ...segment,
    status: 'confirmed',
    confirmedText: segment.text,
    updatedAt: new Date().toISOString(),
    error: undefined,
  }
  return confirmed
}

/**
 * 放弃本次生成，退回作者已确认的正文。
 *
 * 与 `confirmSegment` 配对：确认 = 采纳候选稿，放弃 = 丢弃候选稿。
 * 两者都只影响本段，不动其它段落。
 */
export function revertToConfirmed(segment: PipelineSegment): PipelineSegment {
  return {
    ...segment,
    status: segment.confirmedText.trim() ? 'confirmed' : 'pending',
    text: segment.confirmedText,
    stats: countText(segment.confirmedText),
    error: undefined,
    updatedAt: new Date().toISOString(),
  }
}

/** 待生成 / 生成中 / 失败 的段落（用于「中断后可恢复」） */
export function unfinishedSegments(segments: PipelineSegment[]): PipelineSegment[] {
  return segments.filter(segment => segment.status === 'pending' || segment.status === 'generating' || segment.status === 'failed')
}

/** 把「生成中」在重启后归位为「失败，可重试」——进程被杀时不会留下永远卡住的段落 */
export function recoverInterrupted(segments: PipelineSegment[]): PipelineSegment[] {
  return segments.map(segment =>
    segment.status === 'generating'
      ? { ...segment, status: 'failed' as SegmentStatus, error: segment.error ?? '任务被中断，可重试', updatedAt: new Date().toISOString() }
      : segment,
  )
}

// ============================================================
// 六、前文接续与重复检测（第四步 / 验收 4）
// ============================================================

export interface PrecedingText {
  text: string
  /** 是否因为预算被截断 */
  truncated: boolean
  /** 被省略的字符数 */
  omittedChars: number
}

/** 默认前文预算（字符）。中文约 1.5 字符/token，6000 字符 ≈ 4000 token。 */
export const DEFAULT_PRECEDING_BUDGET = 6000

/**
 * 组装「完整前文」。
 *
 * 与旧实现的区别：旧代码只把**上一段**的末尾 600 字喂进去，
 * 于是第 5 段看不到第 1–3 段写过什么，容易重复交代、人物状态漂移。
 * 这里取**之前所有段落**的完整文本；只有超过预算时才保留
 * 「开头一段 + 最近一段」，并显式标注省略了多少字（不静默丢）。
 */
export function buildPrecedingText(
  segments: PipelineSegment[],
  beforeSequence: number,
  budget = DEFAULT_PRECEDING_BUDGET,
): PrecedingText {
  const ordered = segments
    .filter(segment => segment.sequence < beforeSequence && segment.text.trim())
    .sort((a, b) => a.sequence - b.sequence)
  const full = ordered.map(segment => segment.text.trim()).join('\n\n')
  if (full.length <= budget) return { text: full, truncated: false, omittedChars: 0 }

  // 超预算：开头留 1/3（保住设定与人物出场），最近留 2/3（保住语感与情节连续性）
  const headBudget = Math.floor(budget / 3)
  const tailBudget = budget - headBudget
  const head = full.slice(0, headBudget)
  const tail = full.slice(-tailBudget)
  const omitted = full.length - head.length - tail.length
  return {
    text: `${head}\n\n……（此处省略前文约 ${omitted} 字，仅保留开头与最近部分）……\n\n${tail}`,
    truncated: true,
    omittedChars: omitted,
  }
}

export interface RepetitionFinding {
  length: number
  text: string
  referenceStart: number
}

/**
 * 检测新写的段落是否大段重复了前文（验收 4）。
 *
 * 复用既有 `findCommonRuns`（相似度报告同一套算法），
 * 只报告超过阈值的最长一段，避免刷屏。
 */
export function detectPrecedingRepetition(
  generated: string,
  preceding: string,
  minRun = MIN_COMMON_RUN,
): RepetitionFinding | null {
  if (!generated.trim() || !preceding.trim()) return null
  const runs = findCommonRuns(generated, preceding, minRun, 5)
  if (runs.length === 0) return null
  const longest = runs.reduce((best, run) => (run.length > best.length ? run : best), runs[0])
  return { length: longest.length, text: longest.text, referenceStart: longest.referenceStart }
}

/** 已在前文交代过的信息（供提示词明确「不要重复交代」） */
export function revealedInfoOf(scenes: ScenePlan[], beforeSequence: number): string[] {
  return scenes
    .filter(scene => scene.sequence < beforeSequence)
    .flatMap(scene => [scene.reveal, scene.turn])
    .map(text => text.trim())
    .filter(Boolean)
}

// ============================================================
// 七、提示词组装（第四步 / 三、写作模式）
// ============================================================

export interface BuildScenePromptParams {
  mode: WritingMode
  plan: ChapterPlan
  scene: ScenePlan
  /** 完整前文（含截断说明） */
  preceding: PrecedingText
  /** 已交代过的信息，避免重复 */
  revealed: string[]
  /** 正史设定与既有剧情（复用第三阶段 renderCanonContext / renderContextPack 的产物） */
  canonRendered: string
  /** 作者的小说设定 */
  ownNovel: string
  /** 文风要求 */
  style?: string
  /** 作者对本章的额外要求（最高优先级） */
  userGuidance?: string
  /** 作者的额外指令（重写 / 扩写 / 润色时的具体要求） */
  instruction?: string
  /** 待润色 / 待扩写的原文（polish / expand 模式用） */
  sourceText?: string
  targetWords: number
}

const BASE_SYSTEM_RULES = [
  '你是中文小说写手，只写指定的这一个场景，不替读者总结主题，不写作者按语。',
  '直接输出正文纯文本：不要标题、不要 Markdown 标记、不要解释。对话用中文双引号。',
  '长短句结合，避免每段句式高度一致；避免段尾总结、排比式设定倾泻。',
  '动作描写必须服务于人物、冲突或场景；环境描写参与氛围与剧情，不机械堆砌。',
  '对话要体现人物身份、关系、情绪与信息差，不要所有人一个腔调。',
  '减少套话、空泛心理描写、重复总结与刻意拔高。',
  '不要为了所谓文笔牺牲清晰度与阅读节奏。',
]

export function buildSceneMessages(params: BuildScenePromptParams): Array<{ role: 'system' | 'user'; content: string }> {
  const {
    mode, plan, scene, preceding, revealed, canonRendered, ownNovel,
    style, userGuidance, instruction, sourceText, targetWords,
  } = params
  const policy = MODE_POLICIES[mode]

  const system = [...BASE_SYSTEM_RULES, ...policy.rules].map(rule => `- ${rule}`).join('\n')

  const user = [
    ownNovel ? `【作者的小说设定】\n${ownNovel}` : '',
    canonRendered ? `【正史设定与既有剧情（不可违背）】\n${canonRendered}` : '',
    `【本章目标】${plan.goal}`,
    plan.centralConflict ? `【本章主要矛盾】${plan.centralConflict}` : '',
    plan.endingRequirement ? `【本章结尾要求】${plan.endingRequirement}` : '',
    [
      `【本场景（第 ${scene.sequence} 段《${scene.beatTitle}》）】`,
      `场景目的：${scene.purpose}`,
      scene.time ? `时间：${scene.time}` : '时间：（未指定）',
      scene.location ? `地点：${scene.location}${scene.sceneInferred ? '（推断值，如与设定冲突请以设定为准）' : ''}` : '地点：（未指定）',
      scene.characters.length > 0 ? `出场人物：${scene.characters.join('、')}` : '',
      scene.conflict ? `本场冲突：${scene.conflict}` : '',
      scene.reveal ? `需要揭示：${scene.reveal}` : '',
      scene.emotionShift ? `情绪变化：${scene.emotionShift}` : '',
      scene.turn ? `场景转折：${scene.turn}` : '',
      scene.openQuestion ? `结束时留下：${scene.openQuestion}` : '',
    ].filter(Boolean).join('\n'),
    sourceText ? `【待处理的原文】\n${sourceText}` : '',
    preceding.text ? `【前文（必须自然接续，不得重复叙述）】\n${preceding.text}` : '',
    revealed.length > 0
      ? `【前文已经交代过的信息（不要重复交代）】\n${revealed.map(item => `- ${item}`).join('\n')}`
      : '',
    style ? `【文风要求】\n${style}` : '',
    userGuidance ? `【作者对本章的要求（最高优先级）】\n${userGuidance}` : '',
    instruction ? `【作者的额外指令（最高优先级）】\n${instruction}` : '',
    `【篇幅】约 ${targetWords} 字（上下浮动两成以内即可，不要注水）。`,
  ].filter(Boolean).join('\n\n')

  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

// ============================================================
// 八、模型调用（复用现有 llm:generate 通道）
// ============================================================

export interface GenerateSceneParams {
  mode: WritingMode
  plan: ChapterPlan
  scene: ScenePlan
  segments: PipelineSegment[]
  scenes: ScenePlan[]
  canonRendered: string
  ownNovel: string
  style?: string
  userGuidance?: string
  instruction?: string
  /** polish / expand 模式的原文；缺省时取该段落已有文本 */
  sourceText?: string
  targetWords?: number
  precedingBudget?: number
  temperature?: number
}

export interface GenerateSceneResult {
  segment: PipelineSegment
  modelId?: string
  /** 生成内容与前文的大段重复（有则说明模型复述了前文） */
  repetition: RepetitionFinding | null
  error?: string
}

/**
 * 生成单个场景。
 *
 * 与旧 `generateDraftSegments` 的差异：
 *   1. 前文是**完整前文**（不是上一段末尾 600 字）；
 *   2. 走**状态机**（generating → generated / failed），失败不改文本；
 *   3. 支持 7 种写作模式；
 *   4. 生成后立刻做一次「是否重复前文」的本地检测并回报。
 */
export async function generateScene(params: GenerateSceneParams): Promise<GenerateSceneResult> {
  const {
    mode, plan, scene, segments, scenes, canonRendered, ownNovel, style,
    userGuidance, instruction, sourceText, targetWords,
    precedingBudget = DEFAULT_PRECEDING_BUDGET, temperature = 0.85,
  } = params

  const existing = segments.find(item => item.sequence === scene.sequence)
  const created = existing ?? createSegment(scene)
  // 已确认的段落先退回编辑态：`confirmed → generating` 是非法迁移，
  // 若调用方忘了预处理，状态机会把生成结果**静默丢弃**。这里做兜底。
  const base = created.status === 'confirmed' ? transitionSegment(created, 'editing') : created
  const goalWords = targetWords ?? scene.targetWords

  // 先统一进入「生成中」：之后无论成功还是失败，迁移都合法，
  // 不会出现「生成完了但状态机拒绝写入」的情况。
  const running = transitionSegment(base, 'generating')

  const { useLLMStore } = await import('../../stores/llm-store')
  const modelId = useLLMStore.getState().resolveModelId('reconstruct_draft')
  if (!modelId) {
    return {
      segment: transitionSegment(running, 'failed', { error: '没有可用模型：正文生成使用「正文生成」用途的模型，请先在设置里绑定。' }),
      repetition: null,
      error: '没有可用模型',
    }
  }

  const preceding = buildPrecedingText(segments, scene.sequence, precedingBudget)
  const revealed = revealedInfoOf(scenes, scene.sequence)

  try {
    const messages = buildSceneMessages({
      mode, plan, scene, preceding, revealed, canonRendered, ownNovel,
      style, userGuidance, instruction,
      sourceText: sourceText ?? (mode === 'polish' || mode === 'expand' ? base.text : undefined),
      targetWords: goalWords,
    })
    const response = await ipc.invoke('llm:generate', {
      modelId,
      messages,
      temperature,
      thinking: false,
      purpose: 'reconstruct_draft',
    })
    if (response.success === false) {
      return {
        segment: transitionSegment(running, 'failed', { error: response.error || '模型调用失败' }),
        modelId,
        repetition: null,
        error: response.error || '模型调用失败',
      }
    }
    const text = (response.content ?? '').trim()
    const repetition = detectPrecedingRepetition(text, preceding.text)
    const segment = transitionSegment(running, 'generated', {
      text,
      modelId,
      inputDigest: {
        mode,
        precedingChars: preceding.text.length,
        precedingTruncated: preceding.truncated,
        targetWords: goalWords,
        revealedCount: revealed.length,
        instruction: instruction?.slice(0, 200),
      },
    })
    return { segment, modelId, repetition }
  } catch (caught) {
    return {
      segment: transitionSegment(running, 'failed', { error: String(caught) }),
      modelId,
      repetition: null,
      error: String(caught),
    }
  }
}

// ============================================================
// 九、章节自检（第五步）
// ============================================================

export interface GoalCheck {
  key: 'goal' | 'scene' | 'ending' | 'must-event' | 'repetition' | 'word-budget'
  ok: boolean
  detail: string
}

/**
 * 章节目标 / 场景目标 / 结尾目标的本地检查。
 *
 * 用关键词覆盖度做粗筛（与既有 `beatCoverage` 同思路），
 * **不冒充「语义判断」**：没命中只说明「可能没写到」，交给作者判断。
 */
export function checkGoals(params: {
  plan: ChapterPlan
  scenes: ScenePlan[]
  segments: PipelineSegment[]
  targetWords: number
}): GoalCheck[] {
  const { plan, scenes, segments, targetWords } = params
  const fullText = segments.map(segment => segment.text || segment.confirmedText).join('\n')
  const checks: GoalCheck[] = []

  const coverageIn = (source: string, haystack: string): number => {
    const tokens = [...new Set([...source.matchAll(/[\u4e00-\u9fa5]{2,4}/g)].map(m => m[0]))].slice(0, 12)
    if (tokens.length === 0) return 1
    return tokens.filter(token => haystack.includes(token)).length / tokens.length
  }
  const coverage = (source: string): number => coverageIn(source, fullText)

  const goalCoverage = coverage(plan.goal)
  checks.push({
    key: 'goal',
    ok: goalCoverage >= 0.5,
    detail: `本章目标关键词覆盖 ${Math.round(goalCoverage * 100)}%${goalCoverage >= 0.5 ? '' : '，可能没有完成预定剧情任务'}`,
  })

  // 场景目标按「该场景自己那一段」判断，不能拿全章文本去凑 ——
  // 否则第 1 段写过的词会让第 2 段的检查假通过。
  const missedScenes = scenes.filter(scene => {
    const own = segments.find(segment => segment.sequence === scene.sequence)
    const haystack = own ? (own.text || own.confirmedText) : fullText
    return coverageIn(scene.purpose, haystack) < 0.5
  })
  checks.push({
    key: 'scene',
    ok: missedScenes.length === 0,
    detail: missedScenes.length === 0
      ? '每个场景的目的都写到了'
      : `第 ${missedScenes.map(s => s.sequence).join('、')} 段可能没写到位`,
  })

  const endingCoverage = plan.endingRequirement ? coverage(plan.endingRequirement) : 1
  checks.push({
    key: 'ending',
    ok: endingCoverage >= 0.4,
    detail: plan.endingRequirement
      ? (endingCoverage >= 0.4 ? '结尾要求已呼应' : `结尾要求「${plan.endingRequirement}」可能没有呼应`)
      : '大纲未给出结尾要求，无法检查（不算通过）',
  })

  const uncoveredEvents = plan.mustEvents.filter(item => coverage(item) < 0.4)
  checks.push({
    key: 'must-event',
    ok: uncoveredEvents.length === 0,
    detail: uncoveredEvents.length === 0 ? '必要事件都已出现' : `可能遗漏：${uncoveredEvents.join('；')}`,
  })

  // 段内重复：把每段与「它之前的所有段」比一遍
  let worstRepetition = 0
  for (const [index, segment] of segments.entries()) {
    const preceding = segments.slice(0, index).map(item => item.text).join('\n')
    const found = detectPrecedingRepetition(segment.text, preceding)
    if (found && found.length > worstRepetition) worstRepetition = found.length
  }
  checks.push({
    key: 'repetition',
    ok: worstRepetition === 0,
    detail: worstRepetition === 0 ? '未发现段间大段重复' : `发现 ${worstRepetition} 字与前文重复`,
  })

  const actual = countText(fullText)
  const ratio = targetWords > 0 ? actual.chineseChars / targetWords : 1
  checks.push({
    key: 'word-budget',
    ok: ratio >= 0.7,
    detail: `汉字 ${actual.chineseChars} 字 / 目标 ${targetWords} 字（${Math.round(ratio * 100)}%）`,
  })

  return checks
}

export interface ChapterSelfCheck {
  /** 本地目标检查（不依赖模型，永远有结果） */
  goals: GoalCheck[]
  /** 复用现有一致性闸门的结论（设定违反 / 信息越权等） */
  consistency: DraftConsistencyResult
  /** 编辑修订建议（薄弱段落 + 位置 + 理由） */
  revisions: RevisionSuggestion[]
  /** 润色模式下的事实漂移结论（非润色模式为 null） */
  polishDrift: FactDrift | null
  /** 汇总：是否还有需要作者处理的问题 */
  needsAttention: boolean
  summary: string
}

/**
 * 第五步 + 第六步：跑一次完整自检。
 *
 * 分工明确：
 *   - **设定违反 / 信息越权** 交给既有 `checkDraftConsistency`（复用一致性闸门，不新造规则）；
 *   - **情节目标 / 场景目标 / 结尾目标 / 必要事件 / 重复 / 字数** 由本地关键词检查负责；
 *   - **薄弱段落定位** 由本地启发式负责（不依赖模型可用性）。
 */
export async function runChapterSelfCheck(params: {
  chapterNumber: number
  plan: ChapterPlan
  scenes: ScenePlan[]
  segments: PipelineSegment[]
  targetWords: number
  canon: CanonContext | null
  /** 本次流水线使用的写作模式（润色时额外做事实漂移检查） */
  mode?: WritingMode
  /** 润色前的原文（mode = polish 时用于比对） */
  polishSource?: string
  /** 出场人物名（用于润色时比对人物认知边界） */
  characters?: string[]
}): Promise<ChapterSelfCheck> {
  const { chapterNumber, plan, scenes, segments, targetWords, canon, mode, polishSource, characters } = params
  const content = composeWorkingText(segments)
  const goals = checkGoals({ plan, scenes, segments, targetWords })
  const consistency = await checkDraftConsistency({ chapterNumber, content, canon })
  const revisions = suggestRevisionsLocal({ segments, scenes, plan })
  const polishDrift = mode === 'polish' && polishSource
    ? assertFactsUnchanged(polishSource, content, characters ?? [])
    : null

  const failed = goals.filter(check => !check.ok)
  const needsAttention =
    failed.length > 0
    || consistency.verdict === 'conflict'
    || consistency.verdict === 'needs-review'
    || revisions.length > 0
    || (polishDrift !== null && !polishDrift.ok)

  const summary = [
    failed.length === 0 ? '目标检查全部通过' : `目标检查有 ${failed.length} 项待处理：${failed.map(item => item.detail).join('；')}`,
    `设定一致性：${consistency.summary}`,
    revisions.length === 0 ? '未发现明显薄弱段落' : `发现 ${revisions.length} 处可改进段落`,
    polishDrift ? `润色事实比对：${polishDrift.note}` : '',
  ].filter(Boolean).join(' | ')

  return { goals, consistency, revisions, polishDrift, needsAttention, summary }
}

// ============================================================
// 十、编辑修订建议（第六步）
// ============================================================

export interface RevisionSuggestion {
  sequence: number
  /** 薄弱段落所在的位置（字符区间，便于界面定位） */
  start: number
  end: number
  excerpt: string
  reason: string
  suggestion: string
}

export interface SuggestRevisionsParams {
  segments: PipelineSegment[]
  scenes: ScenePlan[]
  plan: ChapterPlan
  instruction?: string
}

/**
 * 找出薄弱段落并给出理由。
 *
 * 最小可靠版本：**本地启发式 + 可选模型意见**。
 * 本地部分负责「一定能给出可定位的建议」（长段无对话、段尾总结、
 * 套话密度、场景目的覆盖不足），不依赖模型可用性。
 * 只给建议、**绝不自动改正文**——作者选择性接受后才落到具体段落。
 */
export function suggestRevisionsLocal(params: SuggestRevisionsParams): RevisionSuggestion[] {
  const { segments, scenes, plan } = params
  const out: RevisionSuggestion[] = []
  const CLICHES = ['仿佛', '不禁', '不由自主', '心中五味杂陈', '五味杂陈', '难以言喻', '说不出话']
  const SUMMARY_TAIL = ['总之', '从此', '就这样', '于是，一切', '这一切都']

  for (const segment of segments) {
    const text = segment.text || segment.confirmedText
    if (!text.trim()) continue
    const scene = scenes.find(item => item.sequence === segment.sequence)

    // 1) 长段无对话：整段超过 400 字却没有引号对话，读起来容易闷
    const quoted = (text.match(/[""「」"]/g) ?? []).length
    if (text.length > 400 && quoted === 0) {
      out.push({
        sequence: segment.sequence,
        start: 0,
        end: Math.min(80, text.length),
        excerpt: text.slice(0, 80),
        reason: `整段 ${text.length} 字没有任何对话，节奏偏闷`,
        suggestion: '加入一段体现人物关系或信息差的对话，或把长段拆开。',
      })
    }

    // 2) 套话密度
    for (const cliche of CLICHES) {
      const index = text.indexOf(cliche)
      if (index >= 0) {
        out.push({
          sequence: segment.sequence,
          start: index,
          end: index + cliche.length,
          excerpt: text.slice(Math.max(0, index - 20), index + cliche.length + 20),
          reason: `出现套话「${cliche}」`,
          suggestion: '改成具体的动作或身体反应，不要用抽象情绪词带过。',
        })
        break
      }
    }

    // 3) 段尾总结（刻意拔高）
    const tail = text.slice(-40)
    const hit = SUMMARY_TAIL.find(word => tail.includes(word))
    if (hit) {
      out.push({
        sequence: segment.sequence,
        start: text.length - 40,
        end: text.length,
        excerpt: tail,
        reason: `结尾出现总结式表达「${hit}」`,
        suggestion: '删掉总结句，用动作或留白收尾。',
      })
    }

    // 4) 场景目的覆盖不足
    if (scene && scene.purpose) {
      const tokens = [...new Set([...scene.purpose.matchAll(/[\u4e00-\u9fa5]{2,4}/g)].map(m => m[0]))].slice(0, 12)
      if (tokens.length > 0) {
        const hitCount = tokens.filter(token => text.includes(token)).length
        if (hitCount / tokens.length < 0.4) {
          out.push({
            sequence: segment.sequence,
            start: 0,
            end: Math.min(80, text.length),
            excerpt: text.slice(0, 80),
            reason: `本场景目的「${scene.purpose}」关键词覆盖不足（${hitCount}/${tokens.length}）`,
            suggestion: '检查这一段是否真的完成了本场景该完成的事，缺的补上。',
          })
        }
      }
    }
  }

  // 与本章目标对不上的段落也提示一次
  if (plan.goal) {
    const tokens = [...new Set([...plan.goal.matchAll(/[\u4e00-\u9fa5]{2,4}/g)].map(m => m[0]))].slice(0, 12)
    const full = segments.map(s => s.text).join('\n')
    const hit = tokens.filter(token => full.includes(token)).length
    if (tokens.length > 0 && hit / tokens.length < 0.5) {
      out.push({
        sequence: 0,
        start: 0,
        end: 0,
        excerpt: plan.goal,
        reason: `全章对本章目标「${plan.goal}」的覆盖不足（${hit}/${tokens.length}）`,
        suggestion: '先补关键情节，再谈润色。',
      })
    }
  }

  return out
}

// ============================================================
// 十一、润色的事实不变校验（验收 3）
// ============================================================

export interface FactDrift {
  ok: boolean
  /** 是否提取到了可用于比对的事实 / 事件；为 false 时 ok 不代表「确认没改」 */
  verifiable: boolean
  addedFacts: string[]
  removedFacts: string[]
  knowledgeAdded: string[]
  knowledgeRemoved: string[]
  /** 疑似新增 / 消失的事件（按相似度判断，不是逐字比对） */
  addedEvents: string[]
  removedEvents: string[]
  /** 篇幅变化比例（正数=变长） */
  lengthDeltaRatio: number
  note: string
}

/** 中文 bigram 集合（与 detectFactConflict 同一套相似度思路，保持全项目一致） */
function bigramsOf(text: string): Set<string> {
  const set = new Set<string>()
  const cleaned = text.replace(/[^\u4e00-\u9fa5]/g, '')
  for (let i = 0; i + 2 <= cleaned.length; i++) set.add(cleaned.slice(i, i + 2))
  return set
}

function bigramSimilarity(a: string, b: string): number {
  const left = bigramsOf(a)
  const right = bigramsOf(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return shared / (left.size + right.size - shared)
}

/** 低于这个相似度就认为「不是同一件事被改写，而是新增/消失了事件」 */
const EVENT_SAME_THRESHOLD = 0.5
/** 润色允许的篇幅浮动（超过就提示作者确认，不是直接判定失败） */
const LENGTH_TOLERANCE = 0.4

/**
 * 润色前后的事实漂移检查（验收 3）。
 *
 * 关键设计：**不逐字比对**。润色本来就会改字，逐字比对必然误报
 * （实测「把→将」「收进→塞进」这种正常润色都会被判成改了事实）。
 *
 * 所以分三层，全部复用项目自己的事实提取器 `extractCanonWriteback`：
 *   1. 事实陈述（`newFacts`）：作者确认过的事实，增删必须报出；
 *   2. 人物认知边界（`characterDeltas.knowledge`）：润色不得让人物突然知道/忘掉什么；
 *   3. 事件（`newEvents`）：用 bigram 相似度判断「同一件事被改写」还是「换了一件事」。
 * 再补一条篇幅检查（润色不应显著改变篇幅）。
 *
 * 诚实性：如果三层都没提取到任何东西，返回 `verifiable = false` 并说明
 * 「无法确认」，而不是谎报「事实没变」。
 */
export function assertFactsUnchanged(before: string, after: string, characters: string[] = []): FactDrift {
  const extract = (text: string) => {
    const writeback = extractCanonWriteback({
      chapterNumber: 0,
      chapterTitle: '',
      chapterContent: text,
      characters: characters.map(name => ({ name })),
    })
    return {
      facts: (writeback.newFacts ?? []).map(fact => String(fact.statement ?? '').trim()).filter(Boolean),
      events: (writeback.newEvents ?? []).map(event => String(event.summary ?? '').trim()).filter(Boolean),
      knowledge: (writeback.characterDeltas ?? []).flatMap(delta =>
        (delta.after?.knowledge ?? []).map(item => `${delta.character}：${item}`),
      ),
    }
  }

  const beforeSet = extract(before)
  const afterSet = extract(after)

  const addedFacts = afterSet.facts.filter(item => !beforeSet.facts.includes(item))
  const removedFacts = beforeSet.facts.filter(item => !afterSet.facts.includes(item))
  const knowledgeAdded = afterSet.knowledge.filter(item => !beforeSet.knowledge.includes(item))
  const knowledgeRemoved = beforeSet.knowledge.filter(item => !afterSet.knowledge.includes(item))

  // 事件：能对上任何一条旧事件（相似度达标）就算「同一件事被改写」
  const addedEvents = afterSet.events.filter(
    item => !beforeSet.events.some(other => bigramSimilarity(item, other) >= EVENT_SAME_THRESHOLD),
  )
  const removedEvents = beforeSet.events.filter(
    item => !afterSet.events.some(other => bigramSimilarity(item, other) >= EVENT_SAME_THRESHOLD),
  )

  const lengthDeltaRatio = before.length > 0 ? (after.length - before.length) / before.length : 0
  const lengthChanged = Math.abs(lengthDeltaRatio) > LENGTH_TOLERANCE

  const verifiable =
    beforeSet.facts.length > 0 || afterSet.facts.length > 0
    || beforeSet.events.length > 0 || afterSet.events.length > 0
    || beforeSet.knowledge.length > 0 || afterSet.knowledge.length > 0

  const ok =
    addedFacts.length === 0 && removedFacts.length === 0
    && knowledgeAdded.length === 0 && knowledgeRemoved.length === 0
    && addedEvents.length === 0 && removedEvents.length === 0
    && !lengthChanged

  const parts: string[] = []
  if (!verifiable) parts.push('未能从两段文本里提取到事实或事件，无法确认（不等于没改）')
  if (addedFacts.length > 0) parts.push(`新增事实 ${addedFacts.length} 条`)
  if (removedFacts.length > 0) parts.push(`消失事实 ${removedFacts.length} 条`)
  if (knowledgeAdded.length > 0) parts.push(`人物新增已知信息 ${knowledgeAdded.length} 条`)
  if (knowledgeRemoved.length > 0) parts.push(`人物丢失已知信息 ${knowledgeRemoved.length} 条`)
  if (addedEvents.length > 0) parts.push(`疑似新增事件 ${addedEvents.length} 个`)
  if (removedEvents.length > 0) parts.push(`疑似消失事件 ${removedEvents.length} 个`)
  if (lengthChanged) parts.push(`篇幅变化 ${Math.round(lengthDeltaRatio * 100)}%`)

  const note = ok
    ? (verifiable
        ? '未检测到事实、人物认知或事件层面的增删，篇幅也在正常范围内（属表达层面的修改）。'
        : '未检测到事实、人物认知或事件层面的增删，但两段文本都提取不到可比对的事实或事件，**无法确认**（不等于没改）。')
    : `${parts.join('；')}。请作者确认这是润色还是改剧情。`

  return {
    ok,
    verifiable,
    addedFacts,
    removedFacts,
    knowledgeAdded,
    knowledgeRemoved,
    addedEvents,
    removedEvents,
    lengthDeltaRatio,
    note,
  }
}

// ============================================================
// 十二、大纲变更与重规划（验收 7）
// ============================================================

/** 大纲指纹：大纲内容变了就变，用来判断「策划是否过期」 */
export function outlineFingerprint(outline: PlotOutlineRecord): string {
  const payload = JSON.stringify({
    id: outline.id,
    title: outline.title,
    premise: outline.premise,
    protagonistGoal: outline.protagonistGoal,
    centralConflict: outline.centralConflict,
    characterChanges: outline.characterChanges,
    foreshadowing: outline.foreshadowing,
    beats: outline.beats,
  })
  let hash = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `outline-${(hash >>> 0).toString(16)}`
}

export interface PipelineState {
  chapterNumber: number
  outlineId: number
  /** 生成策划时的大纲指纹 */
  outlineFingerprint: string
  plan: ChapterPlan
  scenes: ScenePlan[]
  segments: PipelineSegment[]
  targetWords: number
  mode: WritingMode
  createdAt: string
  updatedAt: string
}

/**
 * 判断是否需要重新规划。
 *
 * 规则：大纲变了 → 需要重规划，但**只重规划尚未确认的部分**；
 * 已确认的段落一律保留（作者已经过目的东西不能被自动改掉）。
 */
export function needsReplan(state: PipelineState, outline: PlotOutlineRecord): boolean {
  return state.outlineFingerprint !== outlineFingerprint(outline)
}

export interface ReplanResult {
  scenes: ScenePlan[]
  /** 被保留（已确认）的段落 */
  kept: PipelineSegment[]
  /** 被作废、需要重新生成的段落序号 */
  resetSequences: number[]
  /** 重规划后应写回状态的大纲指纹 */
  outlineFingerprint: string
}

/**
 * 大纲修改后重规划：保留已确认段落，其余按新大纲重置为「待生成」。
 *
 * 这是验收 7 的核心：改大纲不会波及作者已经确认的正文。
 */
export function replanUnconfirmed(
  state: PipelineState,
  outline: PlotOutlineRecord,
  beats: PlotBeat[],
  contextPack?: ChapterContextPack | null,
): ReplanResult {
  const scenes = buildScenes({ beats, contextPack, totalWords: state.targetWords })
  const kept: PipelineSegment[] = []
  const resetSequences: number[] = []
  for (const segment of state.segments) {
    if (segment.status === 'confirmed') kept.push(segment)
    else resetSequences.push(segment.sequence)
  }
  return { scenes, kept, resetSequences, outlineFingerprint: outlineFingerprint(outline) }
}

// ============================================================
// 十三、正文合成（区分临时文本与作者确认的正文）
// ============================================================

/**
 * 作者确认的正文（只有这个算数）。
 *
 * 判定标准是「有没有确认过的文本」，而不是「当前状态是不是 confirmed」：
 * 作者确认过第 3 段之后又去重写它，第 3 段的**旧确认稿仍在正文里**，
 * 不会因为一次重新生成就从正文里消失。作者采纳候选稿时才会被覆盖。
 */
export function composeConfirmedText(segments: PipelineSegment[]): string {
  return segments
    .filter(segment => segment.confirmedText.trim())
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(segment => segment.confirmedText.trim())
    .join('\n\n')
}

/** 需要作者过目的段落（已生成待确认 / 待编辑 / 失败） */
export function needsReviewSegments(segments: PipelineSegment[]): PipelineSegment[] {
  return segments.filter(segment => segment.status === 'generated' || segment.status === 'editing' || segment.status === 'failed')
}

/** 工作稿：已确认的用正文，其余用临时文本（供预览与自检） */
export function composeWorkingText(segments: PipelineSegment[]): string {
  return segments
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(segment => (segment.status === 'confirmed' ? segment.confirmedText : segment.text).trim())
    .filter(Boolean)
    .join('\n\n')
}

/** 全章字数统计（按明确口径） */
export function chapterStats(segments: PipelineSegment[]): TextStats {
  return countText(composeWorkingText(segments))
}

// ============================================================
// 十四、任务持久化（可中断、可恢复）
// ============================================================

function normalizeMode(value: unknown): WritingMode {
  return WRITING_MODES.includes(value as WritingMode) ? (value as WritingMode) : 'outline-expand'
}

function normalizeSegment(raw: unknown, scene: ScenePlan | undefined): PipelineSegment | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const sequence = Number(record.sequence)
  if (!Number.isInteger(sequence)) return null
  const text = typeof record.text === 'string' ? record.text : ''
  const confirmedText = typeof record.confirmedText === 'string' ? record.confirmedText : ''
  const status = (typeof record.status === 'string' ? record.status : 'pending') as SegmentStatus
  return {
    sequence,
    beatTitle: typeof record.beatTitle === 'string' ? record.beatTitle : (scene?.beatTitle ?? ''),
    status,
    text,
    confirmedText,
    stats: countText(text || confirmedText),
    inputDigest: (record.inputDigest as SegmentInputDigest | undefined) ?? undefined,
    modelId: typeof record.modelId === 'string' ? record.modelId : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
  }
}

/** 保存流水线任务状态（每一步都调一次，保证断电也只丢最后一次） */
export async function savePipelineState(state: PipelineState): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await ipc.invoke('db:pipeline-save', {
      chapterNumber: state.chapterNumber,
      outlineId: state.outlineId,
      outlineFingerprint: state.outlineFingerprint,
      mode: state.mode,
      targetWords: state.targetWords,
      plan: state.plan,
      scenes: state.scenes,
      segments: state.segments,
    })
    return result?.success ? { success: true } : { success: false, error: result?.error ?? '保存失败' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * 读取某章的流水线任务。
 *
 * 读出来先把「生成中」归位为「失败，可重试」——上次进程被杀时留下的
 * 中间态不能永远卡住，否则任务再也推不动。
 */
export async function loadPipelineState(chapterNumber: number): Promise<PipelineState | null> {
  try {
    const record = await ipc.invoke('db:pipeline-get', chapterNumber)
    if (!record) return null
    const scenes = Array.isArray(record.scenes) ? (record.scenes as ScenePlan[]) : []
    const rawSegments = Array.isArray(record.segments) ? (record.segments as unknown[]) : []
    const segments = rawSegments
      .map(raw => normalizeSegment(raw, scenes.find(scene => scene.sequence === (raw as { sequence?: number })?.sequence)))
      .filter((segment): segment is PipelineSegment => segment !== null)
    return {
      chapterNumber: record.chapterNumber,
      outlineId: record.outlineId ?? 0,
      outlineFingerprint: record.outlineFingerprint ?? '',
      mode: normalizeMode(record.mode),
      targetWords: record.targetWords ?? 0,
      plan: (record.plan as ChapterPlan) ?? ({} as ChapterPlan),
      scenes,
      segments: recoverInterrupted(segments),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  } catch {
    return null
  }
}

export interface PipelineSummary {
  chapterNumber: number
  outlineId: number
  mode: WritingMode
  targetWords: number
  /** 未完成（待生成 / 生成中 / 失败）的段落数 */
  unfinished: number
  confirmed: number
  total: number
  updatedAt: string
}

/** 列出全部流水线任务，供界面「恢复未完成任务」入口使用 */
export async function listPipelineStates(): Promise<PipelineSummary[]> {
  try {
    const records = await ipc.invoke('db:pipeline-list')
    return (records ?? []).map(record => {
      const segments = (Array.isArray(record.segments) ? record.segments : [])
        .map(raw => normalizeSegment(raw, undefined))
        .filter((segment): segment is PipelineSegment => segment !== null)
      return {
        chapterNumber: record.chapterNumber,
        outlineId: record.outlineId ?? 0,
        mode: normalizeMode(record.mode),
        targetWords: record.targetWords ?? 0,
        unfinished: unfinishedSegments(segments).length,
        confirmed: segments.filter(segment => segment.status === 'confirmed').length,
        total: segments.length,
        updatedAt: record.updatedAt,
      }
    })
  } catch {
    return []
  }
}

/** 任务完成或作者主动放弃时删除任务状态 */
export async function removePipelineState(chapterNumber: number): Promise<boolean> {
  try {
    const result = await ipc.invoke('db:pipeline-remove', chapterNumber)
    return Boolean(result?.success)
  } catch {
    return false
  }
}
