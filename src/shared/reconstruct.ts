/**
 * 拆书创作系统 —— 共享类型（主进程 / 渲染进程共用）
 *
 * 三块数据各管一段：
 *   BookAnalysisRecord  参考小说的逐章分析结论（可追溯来源、区分事实与推测）
 *   PlotOutlineRecord   基于分析结果重写出的原创剧情大纲（节点可编辑、可排序）
 *   SimilarityReport    新稿与参考材料的相似风险提示（只提示、不下结论）
 *
 * 这些内容都落在项目数据库里（见 electron/database.ts 的 v9 迁移），
 * 而不是只存在界面状态里。
 */

// ============================================================
// 一、拆书分析
// ============================================================

/** 分析任务的落库状态 */
export type BookAnalysisStatus = 'done' | 'failed'

/** 分析类型：逐章 / 整书（整书为后续扩展预留） */
export type BookAnalysisType = 'chapter' | 'book'

/**
 * 结论的可靠程度。
 * text = 正文里能直接读到的；inference = 模型推测；unclear = 无法确定。
 */
export type AnalysisBasis = 'text' | 'inference' | 'unclear'
export type AnalysisConfidence = 'high' | 'medium' | 'low'

/** 带出处的结论（章节号 + 原文片段） */
export interface AnalysisCitation {
  chapterNumber: number
  quote: string
}

/** 叙事技巧的八个观察角度（与任务文档 4.2-C 一一对应） */
export const TECHNIQUE_KEYS = [
  'opening',        // 开头如何吸引读者
  'conflictSetup',  // 如何建立冲突
  'infoRelease',    // 如何控制信息释放
  'characterDrive', // 如何推动人物行动
  'expectation',    // 如何制造期待
  'cliffhanger',    // 如何设置章节结尾悬念
  'chapterLink',    // 如何连接前后章节
  'pacing',         // 如何控制叙事节奏
] as const
export type TechniqueKey = typeof TECHNIQUE_KEYS[number]

/** 剧情结构（任务文档 4.2-B） */
export interface AnalysisPlotStructure {
  coreEvent: string
  goal: string
  protagonistAction: string
  obstacle: string
  escalation: string
  resolution: string
  twist: string
  outcome: string
  impactOnLater: string
}

/** 人物分析（任务文档 4.2-D） */
export interface AnalysisCharacter {
  name: string
  identity: string
  goal: string
  motive: string
  personality: string
  relationships: string
  change: string
  /** 与其他角色之间的利益冲突 */
  interestConflict: string
}

/** 冲突（含升级过程与解决方式） */
export interface AnalysisConflict {
  parties: string[]
  cause: string
  escalation: string
  resolution: string
}

/** 伏笔与悬念（任务文档 4.2-E） */
export interface AnalysisHook {
  content: string
  /** 出现位置：章节号或「第 N 章第 M 段」这类可回查的描述 */
  position: string
  /** 可能的后续作用（推测时必须标为 inference） */
  purpose: string
  status: 'planted' | 'resolved' | 'open' | 'unclear'
  basis: AnalysisBasis
  confidence: AnalysisConfidence
}

/** 结论级证据：每条重要结论都带来源与可信度 */
export interface AnalysisEvidence {
  claim: string
  quote: string
  chapterNumber: number
  basis: AnalysisBasis
  confidence: AnalysisConfidence
}

/** 单章分析结论（模型返回并归一化后的完整结构） */
export interface ChapterAnalysis {
  chapterNumber: number
  chapterTitle: string
  summary: string
  protagonist: string
  characters: AnalysisCharacter[]
  locations: string[]
  items: string[]
  keyEvents: string[]
  plotStructure: AnalysisPlotStructure
  conflicts: AnalysisConflict[]
  techniques: Record<TechniqueKey, string>
  hooks: AnalysisHook[]
  evidence: AnalysisEvidence[]
  /** 归一化过程中发现的问题（截断、缺字段、推测被标为事实等） */
  warnings: string[]
}

/** 一条分析记录（数据库行） */
export interface BookAnalysisRecord {
  id: number
  bookId: string
  /** 冗余保存书名：书被移除后历史记录仍能读 */
  bookName: string
  chapterNumber: number
  chapterTitle: string
  docId: string
  analysisType: BookAnalysisType
  status: BookAnalysisStatus
  modelId: string
  error: string
  /** 分析时章节正文的指纹：正文没变就不重复分析 */
  sourceHash: string
  /** 失败时为 null */
  result: ChapterAnalysis | null
  createdAt: string
  updatedAt: string
}

/** 写库参数（新增或覆盖同一章的分析结果） */
export interface BookAnalysisInput {
  bookId: string
  bookName: string
  chapterNumber: number
  chapterTitle: string
  docId: string
  analysisType?: BookAnalysisType
  status: BookAnalysisStatus
  modelId?: string
  error?: string
  sourceHash?: string
  result?: ChapterAnalysis | null
}

/** 批量分析进度（渲染进程据此显示，不用轮询） */
export interface BookAnalysisProgress {
  bookId: string
  total: number
  done: number
  failed: number
  skipped: number
  currentChapter: number
  phase: 'analyzing' | 'cancelled' | 'finished'
  message?: string
}

// ============================================================
// 二、原创剧情重构
// ============================================================

/** 大纲里的一个剧情节点（可编辑、可排序、可单独重生成） */
export interface PlotBeat {
  sequence: number
  title: string
  event: string
  protagonistAction: string
  conflict: string
  consequence: string
  characterChange: string
  hook: string
}

/** 大纲引用了哪些分析结论（可追溯，也用于界面显示来源章节） */
export interface PlotOutlineSource {
  analysisId: number
  bookId: string
  bookName: string
  chapterNumber: number
}

export type PlotOutlineStatus = 'draft' | 'confirmed'

export interface PlotOutlineRecord {
  id: number
  title: string
  premise: string
  protagonistGoal: string
  centralConflict: string
  characterChanges: string
  foreshadowing: string
  continuityNotes: string
  originalityNotes: string
  /** 本次只借鉴这些叙事技巧（八选若干） */
  techniques: TechniqueKey[]
  beats: PlotBeat[]
  sources: PlotOutlineSource[]
  status: PlotOutlineStatus
  createdAt: string
  updatedAt: string
}

/** 写库参数：id 为空表示新建 */
export interface PlotOutlineInput {
  id?: number
  title: string
  premise?: string
  protagonistGoal?: string
  centralConflict?: string
  characterChanges?: string
  foreshadowing?: string
  continuityNotes?: string
  originalityNotes?: string
  techniques?: TechniqueKey[]
  beats?: PlotBeat[]
  sources?: PlotOutlineSource[]
  status?: PlotOutlineStatus
}

/** 重构的输入条件（界面收集后交给服务层） */
export interface PlotReconstructInput {
  /** 参考哪些分析结论 */
  sources: PlotOutlineSource[]
  /** 希望借鉴的叙事技巧 */
  techniques: TechniqueKey[]
  /** 本次创作目标 */
  goal: string
  /** 当前故事发展阶段 */
  stage: string
  /** 预期的剧情冲突 */
  expectedConflict: string
  /** 不希望出现的内容 */
  exclusions: string
  /** 目标章节数量 */
  targetChapters: number
  /** 目标篇幅（每章字数） */
  wordsPerChapter: number
  /** 标题（可空，交给模型起名） */
  title?: string
}

// ============================================================
// 三、原创性与相似度辅助检查
// ============================================================

export type SimilarityCategory = 'text' | 'sentence' | 'paragraph' | 'plot' | 'character' | 'structure'
export type SimilaritySeverity = 'info' | 'warning' | 'high'
export type SimilarityRisk = 'low' | 'medium' | 'high' | 'undetermined'

export interface SimilarityFinding {
  category: SimilarityCategory
  severity: SimilaritySeverity
  description: string
  /** 参考材料一侧的位置（章节号 / 段落号 / 片段） */
  sourceReference: string
  /** 新稿一侧的位置 */
  generatedReference: string
  recommendation: string
  /** 0–1 的算法相似度；无法计算时为 null（界面显示「无法判断」而不是硬给分数） */
  similarity: number | null
}

export interface SimilarityStats {
  /** 参与比对的参考章节数 */
  referenceChapters: number
  /** 比对的新稿字数 */
  generatedChars: number
  /** 命中的最长连续重复字数 */
  longestCommonRun: number
  /** 近重复句对数量 */
  nearDuplicateSentences: number
}

export interface SimilarityReportPayload {
  overallRisk: SimilarityRisk
  findings: SimilarityFinding[]
  summary: string
  stats: SimilarityStats
  generatedAt: string
}

export interface SimilarityReportRecord extends SimilarityReportPayload {
  id: number
  chapterNumber: number | null
  draftId: number | null
  outlineId: number | null
  /** 参与比对的参考书 id（逗号分隔） */
  bookIds: string
  createdAt: string
}

export interface SimilarityReportInput {
  chapterNumber?: number | null
  draftId?: number | null
  outlineId?: number | null
  bookIds?: string[]
  report: SimilarityReportPayload
}
