/**
 * Narrative Consistency 类型定义
 *
 * CanonContext —— 生成前注入的统一上下文（不可变优先级）
 * TimelineEvent —— 结构化时间线事件
 * CharacterState —— 动态角色状态（按章节更新，含 knowledge/relationships/goal）
 * PlotLine —— 长期未结剧情线
 * Fact —— 客观事实条目
 */

/** 单个角色在某章时间点的状态快照（增量式） */
export interface CharacterStateSnapshot {
  /** 角色名（唯一） */
  character: string
  /** 当前所在地点（字符串，存为最大可能匹配的地点名） */
  location: string
  /** 当前修为/境界 */
  powerLevel: string
  /** 身体状态（伤势/异常） */
  physicalState: string
  /** 心理状态（情绪/愿望/恐惧） */
  mentalState: string
  /** 当前持有的关键道具/资源（逗号或顿号分隔） */
  keyItems: string
  /** 角色当前目标（推动剧情的当下任务） */
  currentGoal: string
  /** 该角色当前拥有的 known facts（信息集合），用于越权检测 */
  knowledge: string[]
  /** 与其他角色的关系映射（角色名 -> 关系描述） */
  relationships: Record<string, string>
  /** 最近事件摘要 */
  recentEvents: string
  /** 状态更新来源的章节号 */
  updatedAtChapter: number
  /** 状态更新时间戳 ISO 字符串 */
  updatedAt: string
}

/** 单条结构化时间线事件 */
export interface TimelineEvent {
  /** 唯一 id（自增或 UUID） */
  id?: number
  /** 所属章节号 */
  chapterNumber: number
  /** 章节内的顺序（同一章内从 1 开始） */
  sequence: number
  /** 涉及角色（数组） */
  characters: string[]
  /** 发生地点 */
  location: string
  /** 时间标签：sequential=顺序推进；flashback=闪回（必须显式标记） */
  timeFlow: 'sequential' | 'flashback'
  /** 事件简短摘要（<= 60 字） */
  summary: string
  /** 影响描述：人物/关系/物品变化（自由文本） */
  impact: string
  /** 创建时间 */
  createdAt?: string
}

/** 长期未结剧情线 */
export interface PlotLine {
  id?: number
  /** 剧情线名（短名） */
  name: string
  /** 剧情线状态：active=进行中；resolved=已解决；paused=暂缓 */
  status: 'active' | 'resolved' | 'paused'
  /** 起始章节号 */
  startedAt: number
  /** 最新一次推进的章节号 */
  lastAdvancedAt: number
  /** 解决章节号（status=resolved 时有效） */
  resolvedAt?: number
  /**
   * 线索类型：plot=剧情线；foreshadow=伏笔（埋设与回收需要台账跟踪）。
   * 未标记时按 plot 处理。
   */
  kind?: 'plot' | 'foreshadow'
  /** 伏笔的预计回收阶段（「中期」「第三卷末」这类自由文本，可为空） */
  plannedResolveAt?: string
  /** 涉及角色 */
  characters: string[]
  /** 当前进度描述 */
  currentState: string
  /** 完整描述（背景/伏笔/悬念） */
  description: string
}

/** 记忆状态：active=有效，outdated=已过期（不再注入），contradicted=与其他事实矛盾（待确认），tentative=暂定 */
export type FactStatus = 'active' | 'outdated' | 'contradicted' | 'tentative'

/** 客观事实条目（短句） */
export interface Fact {
  id?: number
  /** 事实所属类别：world/location/item/event/relationship/identity */
  category: 'world' | 'location' | 'item' | 'event' | 'relationship' | 'identity'
  /** 事实简短陈述（<= 80 字） */
  statement: string
  /** 引入章节 */
  introducedAt: number
  /** 涉及角色 */
  characters: string[]
  /** 关键证据短语（用于自动校验） */
  evidence?: string
  /** 记忆状态；未标记时按 active 处理 */
  status?: FactStatus
  /**
   * 作者确认时间（ISO 字符串）。
   * 为 null / 未设置表示这条事实是 AI 提取、还没有经过作者确认。
   */
  confirmedAt?: string | null
  /** 最后一次变更时间（状态、确认、写回都会更新） */
  updatedAt?: string | null
  /** [v10] 事实在原文章节中的段落索引（-1 = 未定位） */
  sourceParagraphIndex?: number
  /** [v10] 所属分卷 id（可空） */
  arcId?: number
}

/** 生成前注入的 CanonContext —— 按固定优先级排序 */
export interface CanonContext {
  /** 世界观 / 设定基础（不可违背） */
  worldRules: string
  /** 静态人物图谱（来自架构层） */
  characterArch: string
  /** 角色当前动态状态（最高优先级，生成时不可推翻） */
  characterStates: CharacterStateSnapshot[]
  /** 已发生事件（按章节排序，严格单向） */
  timeline: TimelineEvent[]
  /** 最近 N 章摘要 */
  recentChapterSummaries: string
  /** 未解决剧情线 */
  openPlotLines: PlotLine[]
  /** 当前章节目标 */
  chapterGoal: string
  /** 已知事实摘要（短文本） */
  knownFacts: Fact[]
  /** [v10] 当前章节所属分卷/阶段记忆（本卷矛盾、人物发展、阶段性目标） */
  currentArc?: Arc
  /** 物品流转台账（获得 / 转交 / 丢失 / 损毁 / 消耗），用于防止道具凭空出现或消失 */
  itemLedger?: string
  /** 境界阶梯（由低到高：能做到什么 / 做不到什么 / 怎么突破），用于约束战斗与突破描写 */
  realmLadder?: string
  /** 地点与空间关系（区域 / 势力 / 距离 / 通行耗时），用于约束人物移动 */
  locationMap?: string
  /** 上一章结尾（用于衔接） */
  previousEnding: string
  /** RAG 检索结果（最低优先级） */
  ragContext: string
  /** 风格要求 */
  writingStyle: string
  /** 全局行文指导 */
  globalGuidance: string
  /** 硬性约束（生成约束清单） */
  hardConstraints: string
  /**
   * 第三阶段：逐条追溯用的原始来源快照。
   *
   * 渲染好的段落（itemLedger / realmLadder / locationMap 等）只够喂模型，
   * 而「本章上下文预览」需要知道每条来自哪张表、第几章——这里保留原始行，
   * 让上游不必再查一遍数据库，也不会因为重查而得到与本次注入不一致的结果。
   */
  contextSources?: {
    summaries: ChapterSummary[]
    itemEvents: ItemEvent[]
    realms: Realm[]
    locations: Location[]
    /** 构建过程中发现的资料缺失/未来泄漏等问题 */
    warnings: string[]
  }
  /** 元数据：构造时间 / 章节号 */
  meta: {
    chapterNumber: number
    builtAt: string
    ragSources: number
  }
}

/** 一致性校验问题 */
export interface ConsistencyIssue {
  severity: 'error' | 'warning' | 'info'
  category:
    | 'location'
    | 'knowledge'
    | 'timeline'
    | 'relationship'
    | 'event-order'
    | 'item'
    | 'continuity'
  message: string
  /** 相关角色（可选） */
  characters?: string[]
  /** 涉及章节号（可选） */
  chapterNumber?: number
  /** 证据短语（可选） */
  evidence?: string
}

/** 校验结果 */
export interface ConsistencyReport {
  issues: ConsistencyIssue[]
  /** 是否自动修复成功 */
  autoFixed: boolean
  /** 自动修复后的内容（若未修复则等于原内容） */
  repairedContent?: string
  /** 报告生成时间 */
  generatedAt: string
}

/** 角色状态变更 delta（用于写回） */
export interface CharacterStateDelta {
  character: string
  /** 旧值（仅当发生变化时填写） */
  before?: Partial<CharacterStateSnapshot>
  /** 新值 */
  after: Partial<CharacterStateSnapshot>
  /** 来源章节号 */
  chapterNumber: number
}

/** 章节定稿时的写回 payload */
export interface CanonWriteback {
  chapterNumber: number
  chapterTitle: string
  chapterSummary: string
  /**
   * 本章正文。
   * 写回时用它把「本章沿用了哪些既有事实」匹配出来落库（canon_fact_usage），
   * 这样以后修改前文时才能精确列出受影响的后续章节。
   */
  chapterContent?: string
  /** 本章新增事件 */
  newEvents: Omit<TimelineEvent, 'id' | 'createdAt'>[]
  /** 角色状态变更 */
  characterDeltas: CharacterStateDelta[]
  /** 新增/推进/解决的剧情线 */
  plotLineChanges: {
    added?: Omit<PlotLine, 'id'>[]
    advanced?: Array<{ id: number; currentState: string; lastAdvancedAt: number }>
    resolved?: number[]
  }
  /** 新增事实 */
  newFacts: Omit<Fact, 'id'>[]
}

/**
 * 因本次重写而消失（被删或被替换）的事实，以及引用过它的后续章节。
 *
 * 只用于**报告**：让作者知道改这一章会牵动后面哪些内容，
 * 系统不会自动去改后续章节。
 */
export interface FactImpactCandidate {
  fact: Fact
  usedBy: Array<{ chapterNumber: number; evidence: string }>
}

/** 写回结果（含影响分析所需的候选） */
export interface CanonWritebackResult {
  ok: boolean
  errors: string[]
  conflicts: string[]
  impactCandidates: FactImpactCandidate[]
}

/** 物品流转的动作类型 */
export type ItemEventAction = 'obtained' | 'transferred' | 'lost' | 'destroyed' | 'consumed'

/**
 * 物品流转记录：某件道具在第几章被谁获得 / 转交 / 丢失 / 损毁 / 消耗。
 *
 * 由作者（或助手）显式登记，不做自动推断——道具的去向属于「作者说了算」的信息，猜错比不记更糟。
 * 登记结果会进入 Canon 上下文，防止道具凭空出现或消失。
 */
export interface ItemEvent {
  id?: number
  /** 物品名（与事实里 item 类目的名称对应） */
  item: string
  action: ItemEventAction
  chapterNumber: number
  /** 相关角色（获得者 / 交出者 / 接手者） */
  actor?: string
  note?: string
  createdAt?: string
}

/** 章节摘要（用于 recentChapterSummaries） */
/**
 * 地点与空间关系：区域、势力、与别处的距离、通行方式与耗时。
 *
 * 目的是让模型知道「A 到 B 有多远、怎么去」——避免人物在没有交通或特殊能力的情况下
 * 突然出现在远距离地点（现有的地点连续性检查只能事后发现，这里是事前给约束）。
 */
export interface Location {
  id?: number
  /** 地点名（如「黑水渡口」） */
  name: string
  /** 所属区域（如「云州西部」） */
  region?: string
  /** 控制此地的势力（如「周家」） */
  faction?: string
  /** 与哪些地方相邻 / 有多远 */
  distanceNote?: string
  /** 怎么去、大概要多久 */
  travelNote?: string
  notes?: string
  createdAt?: string
}

/** 章节摘要（用于 recentChapterSummaries） */
/**
 * 境界台阶：修仙/玄幻的等级规则。
 *
 * 由作者维护一张阶梯表（练气 → 筑基 → …），写明每阶能做到什么、做不到什么、怎么突破。
 * 它会进入 Canon 上下文，让模型在写战斗与突破时守住规则（越级要有条件，突破要有代价）。
 */
export interface Realm {
  id?: number
  /** 境界名（如「筑基中期」） */
  name: string
  /** 由低到高的阶数，用于判断越级 */
  rankOrder: number
  /** 该境界能做到什么 */
  abilities?: string
  /** 做不到什么 / 代价与限制 */
  limits?: string
  /** 突破所需条件 */
  breakthrough?: string
  notes?: string
  createdAt?: string
}

/** 章节摘要（用于 recentChapterSummaries） */
export interface ChapterSummary {
  chapterNumber: number
  title: string
  summary: string
  createdAt: string
}

// ============================================================
// 第二阶段：分层记忆与精准检索
// ============================================================

/** 分卷/阶段记忆 */
export interface Arc {
  id?: number
  /** 卷名（如「第一卷·风起青云」） */
  title: string
  /** 起始章节号 */
  startChapter: number
  /** 结束章节号（0 或未设=进行中） */
  endChapter: number
  /** 本卷主要矛盾 */
  mainConflict: string
  /** 人物发展概要 */
  characterDevelopment: string
  /** 关键事件列表 */
  keyEvents: string
  /** 阶段性目标 */
  stageGoal: string
  /** 排序序号 */
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

/** 角色状态历史快照（每次写回留痕） */
export interface CharacterStateHistoryEntry {
  id?: number
  character: string
  chapterNumber: number
  /** 完整状态快照（JSON） */
  snapshot: CharacterStateSnapshot
  createdAt?: string
}

/** 统一检索的命中来源类型 */
export type MemoryHitType =
  | 'fact'
  | 'timeline'
  | 'character_state'
  | 'character_history'
  | 'plot_line'
  | 'item_event'
  | 'chapter_summary'
  | 'arc'

/** 统一检索的单条命中 */
export interface MemorySearchHit {
  /** 命中类型 */
  type: MemoryHitType
  /** 数据库 id（如有） */
  id?: number
  /** 显示标题 */
  title: string
  /** 命中内容摘要 */
  snippet: string
  /** 来源章节号 */
  chapterNumber?: number
  /** 涉及角色 */
  characters?: string[]
  /** 关联物品 */
  item?: string
  /** 记忆状态（仅 fact 有效） */
  status?: string
  /** 是否作者确认（仅 fact 有效） */
  confirmed?: boolean
  /** 相关度分数（0-1，越高越相关） */
  score: number
  /** 命中原因（人类可读） */
  matchReasons: string[]
  /** 是否当前有效（false = 历史/过期/已废弃） */
  isCurrent: boolean
  /** 冲突标记（如有） */
  conflictsWith?: string[]
  /** 原文定位（章节号 + 段落索引，如有） */
  sourceLocation?: {
    chapterNumber: number
    paragraphIndex: number
  }
}

/** 统一检索请求 */
export interface MemorySearchParams {
  /** 搜索文本 */
  query: string
  /** 限定类型（不设=全部） */
  types?: MemoryHitType[]
  /** 限定角色名（含别名匹配） */
  character?: string
  /** 限定章节范围 */
  chapterRange?: { from?: number; to?: number }
  /** 限定物品 */
  item?: string
  /** 是否包含历史/过期记忆（默认 false） */
  includeHistorical?: boolean
  /** 最大返回数 */
  limit?: number
}

/** 统一检索结果 */
export interface MemorySearchResult {
  hits: MemorySearchHit[]
  total: number
  /** 搜索是否降级（如向量检索不可用时退化为关键词） */
  degraded: boolean
  /** 降级原因 */
  degradeReason?: string
  /** 查询耗时（ms） */
  elapsedMs: number
}
