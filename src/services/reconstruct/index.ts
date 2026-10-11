/**
 * 拆书创作系统 —— 统一门面
 *
 * 界面只从这里取数据与发起任务，不直接拼 IPC 参数：
 * 拆书分析（analysis-*）、原创剧情重构（outline-service）、
 * 正文生成（draft-service）、事实库联动（canon-adapter）、相似度检查（similarity）。
 */

export * from '../../shared/reconstruct'
export { reconstructStore } from './store'
export {
  analyzeBook,
  clampChapterText,
  hashChapterText,
  indexAnalyses,
  isAnalysisFresh,
  parseAnalysisJson,
  pickAnalysisTargets,
  type AnalysisTargetMode,
  type AnalyzeBookParams,
  type AnalyzeBookResult,
} from './analysis-service'
export {
  TECHNIQUE_LABELS,
  buildChapterAnalysisMessages,
  normalizeChapterAnalysis,
  stripJsonFence,
} from './analysis-prompt'
export {
  buildSourceDigest,
  buildReconstructMessages,
  loadOwnNovelBrief,
  normalizePlotOutline,
  reconstructPlotOutline,
  regenerateBeat,
  beatSimilarityTo,
  type ReconstructOutcome,
} from './outline-service'
export {
  beatCoverage,
  buildBeatDraftPrompt,
  composeChapterText,
  generateDraftSegments,
  regenerateBeatSegment,
  saveAsDraft,
  segmentTokens,
  type DraftSegment,
  type GenerateDraftParams,
} from './draft-service'
export {
  checkDraftConsistency,
  extractPendingFacts,
  filterRelevantFacts,
  loadChapterCanon,
  type ChapterCanonContext,
  type ConsistencyVerdict,
  type DraftConsistencyResult,
} from './canon-adapter'
export {
  HIGH_RISK_RUN,
  MIN_COMMON_RUN,
  NEAR_DUPLICATE_THRESHOLD,
  buildPlotFindings,
  buildSimilarityReport,
  buildTextFindings,
  containmentSimilarity,
  deriveOverallRisk,
  findCommonRuns,
  findNearDuplicateSentences,
  normalizeForCompare,
  textSimilarity,
  type CommonRun,
  type ReferenceChapter,
  type SentencePair,
  type SimilarityInput,
} from './similarity'
