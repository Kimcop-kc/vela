import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle, FilePenLine, Info, HelpCircle, ListChecks, LoaderCircle, Quote, ScanText, Sparkles, WandSparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { ipc } from '../../services/ipc-client'
import { useProjectStore } from '../../stores/project-store'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { toast } from '../ui/Toast'
import {
  OBSERVATION_DIMENSIONS,
  OUTLINE_CLASSES,
  type AiTraceFinding,
  type OutlineClass,
  type ObservationDimension,
  type ObservationSeverity,
  type QualitativeReview,
  type ReviewObservation,
  buildAppendEdit,
  buildOutlineAdjustmentBlock,
  buildWritebackPrefill,
  canWriteBackToOutline,
} from '../../services/review'

/** 审稿问题条目（JSON 格式） */
interface ReviewIssue {
  category: string
  severity: 'error' | 'warning' | 'pass'
  description: string
  /** 引用的原文片段（有问题时提供） */
  quote?: string
}

/** AI 返回的 JSON 审稿结构 */
interface ReviewJSON {
  items: Array<{
    category: string
    severity: string
    description: string
    quote?: string
  }>
  summary: string
}

interface ReviewReportProps {
  /** 原始审稿报告文本（JSON 或旧版 markdown） */
  reportText: string
  /** 审稿报告关联的草稿路径（用于触发修稿） */
  draftPath?: string
  /** 章节号 */
  chapterNumber?: number
  /** 章节目录 */
  chapterDir?: string
}

// ===== 解析器 =====

/** 标准化 severity 值 */
function normalizeSeverity(raw: string): ReviewIssue['severity'] {
  const s = raw.toLowerCase().trim()
  if (s === 'error' || s === 'critical' || s === 'severe') return 'error'
  if (s === 'warning' || s === 'warn' || s === 'minor') return 'warning'
  return 'pass'
}

/** 尝试从文本中提取 JSON（兼容 ```json 包裹） */
function extractJSON(text: string): string | null {
  // 先尝试直接解析
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return trimmed

  // 尝试从 ```json ... ``` 中提取
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (codeBlockMatch) return codeBlockMatch[1].trim()

  // 尝试找第一个 { 和最后一个 }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return null
}

/** 解析审稿报告（优先 JSON，回退到旧版文本解析） */
function parseReport(text: string, defaultCategory: string): { issues: ReviewIssue[]; summary: string } {
  const jsonStr = extractJSON(text)
  if (jsonStr) {
    try {
      const data = JSON.parse(jsonStr) as ReviewJSON
      if (data.items && Array.isArray(data.items)) {
        const issues: ReviewIssue[] = data.items.map(item => ({
          category: item.category || defaultCategory,
          severity: normalizeSeverity(item.severity),
          description: item.description || '',
          quote: item.quote || undefined,
        }))
        return { issues, summary: data.summary || '' }
      }
    } catch {
      // JSON 解析失败，回退到文本解析
    }
  }

  // 回退：旧版 markdown 文本解析（兼容历史数据）
  return parseLegacyReport(text, defaultCategory)
}

/** 旧版文本解析器（兼容历史审稿报告） */
function parseLegacyReport(text: string, defaultCategory: string): { issues: ReviewIssue[]; summary: string } {
  const issues: ReviewIssue[] = []
  const lines = text.split('\n')
  let currentCategory = defaultCategory
  const summaryLines: string[] = []
  let inSummary = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 匹配标题行
    const headingMatch = trimmed.match(/^#{2,3}\s+(.+)/)
    if (headingMatch) {
      const heading = headingMatch[1].replace(/[*_]/g, '')
      if (/总体评价|总结|总评/.test(heading)) {
        inSummary = true
      } else {
        inSummary = false
        currentCategory = heading
      }
      continue
    }

    if (inSummary) {
      summaryLines.push(trimmed.replace(/^[-*]\s*/, ''))
      continue
    }

    // 检测 emoji 严重级别
    let severity: ReviewIssue['severity'] = 'pass'
    if (trimmed.includes('🔴')) severity = 'error'
    else if (trimmed.includes('🟡')) severity = 'warning'
    else if (trimmed.includes('🟢') || trimmed.includes('✅')) severity = 'pass'
    else if (trimmed.startsWith('-') || trimmed.startsWith('*')) severity = 'warning'
    else continue

    const cleanDesc = trimmed
      .replace(/^[-*]\s*/, '')
      .replace(/[🔴🟡🟢✅]\s*/u, '')
      .replace(/\*\*/g, '')

    if (cleanDesc) {
      issues.push({ category: currentCategory, severity, description: cleanDesc })
    }
  }

  return { issues, summary: summaryLines.join(' ') }
}

// ===== 定性审稿产物（结构化 JSON） =====

/** 校验一条观察是否具备可渲染的最小结构 */
function isReviewObservation(value: unknown): value is ReviewObservation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ReviewObservation>
  return typeof candidate.title === 'string' && Array.isArray(candidate.evidence)
}

/** 校验一条 AI 痕迹是否具备可渲染的最小结构 */
function isAiTraceFinding(value: unknown): value is AiTraceFinding {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AiTraceFinding>
  return typeof candidate.kind === 'string' && typeof candidate.message === 'string'
}

/**
 * 解析定性审稿产物。
 * 不是该结构（旧版 items/summary 报告）时返回 null，交给旧版渲染器处理。
 */
function parseQualitativeReview(text: string): QualitativeReview | null {
  const jsonStr = extractJSON(text)
  if (!jsonStr) return null
  try {
    const data = JSON.parse(jsonStr) as Partial<QualitativeReview>
    if (!Array.isArray(data.observations) && !Array.isArray(data.aiTraces)) return null
    return {
      chapterNumber: typeof data.chapterNumber === 'number' ? data.chapterNumber : 0,
      chapterTitle: typeof data.chapterTitle === 'string' ? data.chapterTitle : '',
      observations: Array.isArray(data.observations) ? data.observations.filter(isReviewObservation) : [],
      aiTraces: Array.isArray(data.aiTraces) ? data.aiTraces.filter(isAiTraceFinding) : [],
      context: {
        timelineEvents: data.context?.timelineEvents ?? 0,
        characterStates: data.context?.characterStates ?? 0,
        openPlotLines: data.context?.openPlotLines ?? 0,
        knownFacts: data.context?.knownFacts ?? 0,
      },
      stats: {
        characters: data.stats?.characters ?? 0,
        paragraphs: data.stats?.paragraphs ?? 0,
        sentences: data.stats?.sentences ?? 0,
        dialogueRatio: data.stats?.dialogueRatio ?? 0,
      },
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : '',
    }
  } catch {
    return null
  }
}

/** 计算字符偏移所在行号（1 基）；没有正文时返回 0 */
function lineNumberAt(content: string, offset: number): number {
  if (!content || offset <= 0) return 0
  return content.slice(0, offset - 1).split('\n').length
}
// ===== 视觉配置 =====
// Note: Labels are handled via i18n (see severityLabels below).
// This constant only holds visual properties (emoji, colors).

const SEVERITY_META: Record<ReviewIssue['severity'], {
  dotClass: string
  colorClass: string
  bgClass: string
  borderClass: string
}> = {
  error: {
    dotClass: 'bg-[var(--color-error)]',
    colorClass: 'text-[var(--color-error)]',
    bgClass: 'bg-[rgba(var(--color-error-rgb),0.10)]',
    borderClass: 'border-[rgba(var(--color-error-rgb),0.30)]',
  },
  warning: {
    dotClass: 'bg-[var(--color-warning)]',
    colorClass: 'text-[var(--color-warning)]',
    bgClass: 'bg-[rgba(var(--color-warning-rgb),0.10)]',
    borderClass: 'border-[rgba(var(--color-warning-rgb),0.30)]',
  },
  pass: {
    dotClass: 'bg-[var(--color-success)]',
    colorClass: 'text-[var(--color-success)]',
    bgClass: 'bg-[rgba(var(--color-success-rgb),0.10)]',
    borderClass: 'border-[rgba(var(--color-success-rgb),0.30)]',
  },
}

/** 审稿报告查看器：结构化定性审稿产物走专用视图，旧版报告保持原样渲染 */
export default function ReviewReport(props: ReviewReportProps) {
  const qualitative = useMemo(() => parseQualitativeReview(props.reportText), [props.reportText])
  if (qualitative) return <QualitativeReviewReport review={qualitative} {...props} />
  return <LegacyReviewReport {...props} />
}

/** 审稿报告查看器（旧版 items/summary 结构） */
function LegacyReviewReport({ reportText, draftPath, chapterNumber, chapterDir }: ReviewReportProps) {
  const { t } = useTranslation('editors')
  const { issues, summary } = parseReport(reportText, t('reviewReport.generalCheck'))
  const [showRefineDialog, setShowRefineDialog] = useState(false)
  const [userRefinePrompt, setUserRefinePrompt] = useState('')
  const [processing, setProcessing] = useState(false)
  const [showLegend, setShowLegend] = useState(false)

  // 按分类分组
  const categories = new Map<string, ReviewIssue[]>()
  for (const issue of issues) {
    const list = categories.get(issue.category) || []
    list.push(issue)
    categories.set(issue.category, list)
  }

  // 统计
  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  const passCount = issues.filter((i) => i.severity === 'pass').length

  // Translated severity labels (source of truth for all language display)
  const severityLabels: Record<ReviewIssue['severity'], { label: string; actionLabel: string }> = {
    error: { label: t('reviewReport.severity.error.label'), actionLabel: t('reviewReport.severity.error.actionLabel') },
    warning: { label: t('reviewReport.severity.warning.label'), actionLabel: t('reviewReport.severity.warning.actionLabel') },
    pass: { label: t('reviewReport.severity.pass.label'), actionLabel: t('reviewReport.severity.pass.actionLabel') },
  }

  /** 根据审稿意见修稿 */
  const doRefineFromReview = async () => {
    if (!draftPath || !chapterDir) return
    setProcessing(true)
    setShowRefineDialog(false)
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')

      const { createRefineFromReviewWorkflow } = await import('../../services/workflows/chapter-workflow')
      const { getLatestReview } = await import('../../services/draft-index')
      const { readDraftBody } = await import('../../stores/draft-store')

      const draftContent = await readDraftBody(draftPath)
      if (!draftContent) return

      // 提取版本信息
      const versionMatch = draftPath.match(/draft_v(\d+)\.md$/)
      const baseVersion = versionMatch ? parseInt(versionMatch[1]) : 1
      const chapterNum = chapterNumber || 0

      // 获取最新审稿文件名（用于关联）
      const latestReview = await getLatestReview(chapterDir, baseVersion)
      const reviewFileName = latestReview?.fileName || ''

      // 从 index.json 读取章节标题
      const { readDraftIndex } = await import('../../services/draft-index')
      const index = await readDraftIndex()
      const chapterTitle = index.chapterTitle || t('reviewReport.chapterFallback', { chapterNum })

      useWorkflowStore.getState().startWorkflow(createRefineFromReviewWorkflow({
        chapterNumber: chapterNum,
        chapterTitle,
        draftPath,
        draftContent,
        reviewReport: reportText,
        reviewFileName,
        userRefinePrompt: userRefinePrompt.trim() || undefined,
      }), false)
    } finally {
      setProcessing(false)
    }
  }

  const SeverityIcon = ({ severity }: { severity: string }) => {
    if (severity === 'error') return <AlertTriangle size={14} className="text-[var(--color-error)] flex-shrink-0" />
    if (severity === 'warning') return <AlertTriangle size={14} className="text-[var(--color-warning)] flex-shrink-0" />
    return <CheckCircle size={14} className="text-[var(--color-success)] flex-shrink-0" />
  }

  // 是否可以触发修稿（有草稿路径和章节信息时）
  const canRefine = !!(draftPath && chapterDir)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-4">
        {/* 统计栏 */}
        <div className="flex items-center gap-4 mb-4 pb-3 border-b border-[var(--color-border)]">
          <h3 className="text-base font-bold text-[var(--color-text)]"> {t('reviewReport.title')}</h3>
          <div className="flex items-center gap-3 text-xs ml-auto">
            {errorCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[rgba(var(--color-error-rgb),0.20)] text-[var(--color-error)]">
                <span className="inline-block rounded-full bg-[var(--color-error)]" style={{ width: 7, height: 7 }} />
                {errorCount} {t('reviewReport.criticalIssues')}
              </span>
            )}
            {warningCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[rgba(var(--color-warning-rgb),0.20)] text-[var(--color-warning)]">
                <span className="inline-block rounded-full bg-[var(--color-warning)]" style={{ width: 7, height: 7 }} />
                {warningCount} {t('reviewReport.suggestions')}
              </span>
            )}
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[rgba(var(--color-success-rgb),0.20)] text-[var(--color-success)]">
              <span className="inline-block rounded-full bg-[var(--color-success)]" style={{ width: 7, height: 7 }} />
              {passCount} {t('reviewReport.passed')}
            </span>
            {/* 图例帮助按钮 */}
            <button
              className="flex items-center justify-center rounded-full hover:bg-[var(--color-hover)] transition-colors"
              style={{ width: 22, height: 22 }}
              onClick={() => setShowLegend(!showLegend)}
              title={t('reviewReport.colorLegend')}
            >
              <HelpCircle size={14} style={{ color: 'var(--color-text-muted)' }} />
            </button>
          </div>
        </div>

        {/* 颜色图例说明 */}
        {showLegend && (
          <div
            className="mb-4 rounded-lg border p-3 text-xs space-y-2"
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
            }}
          >
            <div className="font-medium text-[var(--color-text)] mb-1.5">{t('reviewReport.colorLegendTitle')}</div>
            {(['error', 'warning', 'pass'] as const).map(sev => {
              const meta = SEVERITY_META[sev]
              const label = severityLabels[sev]
              return (
                <div key={sev} className="flex items-center gap-2">
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded',
                    meta.bgClass, meta.colorClass
                  )}>
                    <span className={cn('inline-block rounded-full', meta.dotClass)} style={{ width: 7, height: 7 }} />
                    {label.label}
                  </span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    · {label.actionLabel}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* 总体评价（如有） */}
        {summary && (
          <div
            className="mb-4 px-4 py-3 rounded-lg border text-sm"
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          >
            <span className="font-medium">{t('reviewReport.overallEvaluation')}</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>{summary}</span>
          </div>
        )}

        {/* 分类展示 */}
        {issues.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
            <CheckCircle size={32} className="mx-auto mb-2 text-[var(--color-success)]" />
            {t('reviewReport.noIssues')}
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(categories.entries()).map(([category, items]) => (
              <div key={category}>
                <h4 className="text-sm font-semibold text-[var(--color-text)] mb-2 flex items-center gap-1.5">
                  <Info size={14} className="text-[var(--color-text-muted)]" />
                  {category}
                </h4>
                <div className="space-y-1.5 pl-1">
                  {items.map((item, i) => {
                    const sevMeta = SEVERITY_META[item.severity]
                    const label = severityLabels[item.severity]
                    return (
                      <div
                        key={i}
                        className={cn(
                          'px-3 py-2 rounded-md border text-xs leading-relaxed',
                          sevMeta.borderClass, sevMeta.bgClass
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <SeverityIcon severity={item.severity} />
                          <div className="flex-1 min-w-0">
                            <span className="text-[var(--color-text-secondary)]">{item.description}</span>
                            <span
                              className={cn('ml-2 text-[0.65rem] opacity-70', sevMeta.colorClass)}
                            >
                              [{label.actionLabel}]
                            </span>
                          </div>
                        </div>
                        {/* 引用原文（如有） */}
                        {item.quote && (
                          <div
                            className="mt-1.5 ml-5 pl-2 text-[0.7rem] italic"
                            style={{
                              borderLeft: '2px solid var(--color-border)',
                              color: 'var(--color-text-muted)',
                            }}
                          >
                            <Quote size={10} className="inline mr-1 opacity-60" />
                            {item.quote}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 原始文本折叠 */}
        <details className="mt-6">
          <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text)]">
            {t('reviewReport.viewRawText')}
          </summary>
          <pre className="mt-2 text-xs whitespace-pre-wrap font-mono leading-5 text-[var(--color-text-secondary)] bg-[var(--color-sidebar)] rounded-md p-3 border border-[var(--color-border)]">
            {reportText}
          </pre>
        </details>

        {/* 🔧 根据审稿意见修稿 — 核心循环入口 */}
        {canRefine && (
          <div className="mt-6 pt-6 border-t border-[var(--color-border)] flex flex-col items-center">
            <Button
              variant="ai"
              className="px-8"
              onClick={() => { setUserRefinePrompt(''); setShowRefineDialog(true) }}
              disabled={processing}
            >
              <Sparkles size={14} className="mr-1" />
              {t('reviewReport.aiRefine')}
            </Button>
            <p className="text-[0.7rem] text-center mt-3" style={{ color: 'var(--color-text-muted)' }}>
              {t('reviewReport.aiRefineDescription')}
            </p>
          </div>
        )}
      </div>

      {/* 修稿确认弹窗（含自定义提示词） */}
      <Dialog open={showRefineDialog} onOpenChange={(v) => !v && setShowRefineDialog(false)}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={15} className="text-[var(--color-accent)]" />
              {t('reviewReport.refineDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('reviewReport.refineDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-2 text-sm space-y-1.5" style={{ color: 'var(--color-text-secondary)' }}>
            <div className="font-medium text-[var(--color-text)]">{t('reviewReport.refineScopeTitle')}</div>
            <div>{t('reviewReport.refineScope1')}</div>
            <div>{t('reviewReport.refineScope2')}</div>
          </div>
          <div className="px-5 pb-2">
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              {t('reviewReport.additionalRefineGuidance')}
            </label>
            <textarea
              className="w-full px-3 py-2 rounded-md text-sm"
              style={{
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                minHeight: 72,
                resize: 'vertical',
                outline: 'none',
              }}
              placeholder={t('reviewReport.additionalRefinePlaceholder')}
              value={userRefinePrompt}
              onChange={e => setUserRefinePrompt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowRefineDialog(false)}>{t('reviewReport.cancel')}</Button>
            <Button variant="ai" onClick={doRefineFromReview}>
              {t('reviewReport.confirmRefine')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===== 定性审稿视图 =====

/**
 * 大纲分类的配色：完成类是正向色，偏差类用告警色，
 * 但「偏离不等于错误」——所以 creative（合理创新）用中性色，不当成问题。
 */
const OUTLINE_CLASS_COLOR: Record<OutlineClass, string> = {
  done: 'var(--color-success-text)',
  pending: 'var(--color-text-muted)',
  deviated: 'var(--color-warning-text)',
  missing: 'var(--color-warning-text)',
  creative: 'var(--color-info-text)',
  conflict: 'var(--color-error)',
}

/** 观察强度 → 视觉样式（只表示建议的阅读优先级，不是通过/失败判定） */
const OBSERVATION_SEVERITY_META: Record<ObservationSeverity, {
  colorClass: string
  bgClass: string
  borderClass: string
}> = {
  note: {
    colorClass: 'text-[var(--color-text-muted)]',
    bgClass: 'bg-[var(--color-bg-elevated)]',
    borderClass: 'border-[var(--color-border)]',
  },
  watch: {
    colorClass: 'text-[var(--color-warning)]',
    bgClass: 'bg-[rgba(var(--color-warning-rgb),0.10)]',
    borderClass: 'border-[rgba(var(--color-warning-rgb),0.30)]',
  },
  concern: {
    colorClass: 'text-[var(--color-error)]',
    bgClass: 'bg-[rgba(var(--color-error-rgb),0.10)]',
    borderClass: 'border-[rgba(var(--color-error-rgb),0.30)]',
  },
}

interface QualitativeViewProps extends ReviewReportProps {
  review: QualitativeReview
}

/** 发起修订所需的基础信息 */
interface RevisionContext {
  draftBody: string
  reviewFileName: string
  chapterTitle: string
}

/**
 * 定性审稿视图。
 *
 * 只呈现两类内容：
 *   - 可追溯的创作观察（附原文证据与行号）；
 *   - 内置检测标出的「可修订位置」。
 * 不做通过/失败判定，也不自动改稿：是否修订由用户显式选择条目后发起。
 */
function QualitativeReviewReport({ review, reportText, draftPath, chapterNumber, chapterDir }: QualitativeViewProps) {
  const { t } = useTranslation('editors')
  // 被勾选、准备交给 AI 处理的观察
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<'deai' | 'revise' | null>(null)
  // 证据偏移相对「被审正文」，需要读回草稿正文才能换算成行号
  const [draftContent, setDraftContent] = useState('')
  /** 正在写回大纲的观察 id（null 表示没有展开编辑框） */
  const [writebackId, setWritebackId] = useState<string | null>(null)
  const [writebackText, setWritebackText] = useState('')
  const [writebackBusy, setWritebackBusy] = useState(false)

  useEffect(() => {
    if (!draftPath) return
    let cancelled = false
    import('../../stores/draft-store')
      .then(({ readDraftBody }) => readDraftBody(draftPath))
      .then((text) => { if (!cancelled) setDraftContent(text || '') })
      .catch(() => { /* 读取失败只影响行号显示，不影响审稿内容 */ })
    return () => { cancelled = true }
  }, [draftPath])

  // 按维度分组，保持固定顺序，便于多轮审稿之间对照
  const groups = useMemo(() => {
    const buckets = new Map<ObservationDimension, ReviewObservation[]>(
      OBSERVATION_DIMENSIONS.map((dimension) => [dimension, [] as ReviewObservation[]])
    )
    for (const observation of review.observations) {
      buckets.get(observation.dimension)?.push(observation)
    }
    return OBSERVATION_DIMENSIONS
      .map((dimension) => ({ dimension, items: buckets.get(dimension) ?? [] }))
      .filter((group) => group.items.length > 0)
  }, [review.observations])

  const selectedObservations = review.observations.filter((observation) => selected[observation.id])
  const canAct = !!(draftPath && chapterDir)
  const contextTotal = review.context.timelineEvents + review.context.characterStates
    + review.context.openPlotLines + review.context.knownFacts

  // 大纲维度的六类汇总：需求文档要求「偏离不等于错误」，
  // 所以这里把「已完成 / 未完成 / 偏差 / 遗漏 / 合理创新 / 冲突」分开计数，供作者判断。
  const outlineSummary = useMemo(() => {
    const counts: Record<OutlineClass, number> = { done: 0, pending: 0, deviated: 0, missing: 0, creative: 0, conflict: 0 }
    for (const observation of review.observations) {
      if (observation.dimension !== 'outline-deviation' || !observation.outlineClass) continue
      counts[observation.outlineClass] += 1
    }
    return OUTLINE_CLASSES
      .map((outlineClass) => ({ outlineClass, count: counts[outlineClass] }))
      .filter(item => item.count > 0)
  }, [review.observations])

  /** 收集发起修订所需的信息（草稿正文 / 章节标题 / 最新审稿文件名） */
  const resolveRevisionContext = async (targetPath: string, targetDir: string): Promise<RevisionContext | null> => {
    const { readDraftBody } = await import('../../stores/draft-store')
    const { getLatestReview, readDraftIndex } = await import('../../services/draft-index')
    const draftBody = await readDraftBody(targetPath)
    if (!draftBody) return null
    const versionMatch = targetPath.match(/draft_v(\d+)\.md$/)
    const baseVersion = versionMatch ? parseInt(versionMatch[1]) : 1
    const latestReview = await getLatestReview(targetDir, baseVersion)
    const index = await readDraftIndex()
    return {
      draftBody,
      reviewFileName: latestReview?.fileName || '',
      chapterTitle: index.chapterTitle
        || t('reviewReport.chapterFallback', { chapterNum: chapterNumber || review.chapterNumber }),
    }
  }

  /** 显式发起：按选中的观察修稿（审稿本身不会自动触发） */
  const doReviseSelected = async () => {
    const targetPath = draftPath
    const targetDir = chapterDir
    if (!targetPath || !targetDir || selectedObservations.length === 0) return
    setBusy('revise')
    try {
      const info = await resolveRevisionContext(targetPath, targetDir)
      if (!info) {
        toast.error(t('reviewReport.qualitative.noDraft'))
        return
      }
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createRefineFromReviewWorkflow } = await import('../../services/workflows/chapter-workflow')
      const { buildRevisionBrief } = await import('../../services/review')
      useWorkflowStore.getState().startWorkflow(createRefineFromReviewWorkflow({
        chapterNumber: chapterNumber || review.chapterNumber,
        chapterTitle: info.chapterTitle,
        draftPath: targetPath,
        draftContent: info.draftBody,
        reviewReport: buildRevisionBrief(selectedObservations, info.draftBody),
        reviewFileName: info.reviewFileName,
      }), false)
    } catch (e) {
      toast.error(t('reviewReport.qualitative.reviseStartFailed', { error: String(e) }))
    } finally {
      setBusy(null)
    }
  }

  /** 显式发起：去 AI 味（语义方法由可替换的 Skill 提供，结果只生成待审阅修订） */
  const doDeai = async () => {
    const targetPath = draftPath
    const targetDir = chapterDir
    if (!targetPath || !targetDir) return
    setBusy('deai')
    try {
      const info = await resolveRevisionContext(targetPath, targetDir)
      if (!info) {
        toast.error(t('reviewReport.qualitative.noDraft'))
        return
      }
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createDeaiReviseWorkflow } = await import('../../services/workflows/chapter-workflow')
      useWorkflowStore.getState().startWorkflow(createDeaiReviseWorkflow({
        chapterNumber: chapterNumber || review.chapterNumber,
        chapterTitle: info.chapterTitle,
        draftPath: targetPath,
        draftContent: info.draftBody,
      }), false)
    } catch (e) {
      toast.error(t('reviewReport.qualitative.deaiStartFailed', { error: String(e) }))
    } finally {
      setBusy(null)
    }
  }

  /**
   * 显式发起：把作者确认的新方向写回本章大纲。
   *
   * 只追加到「作者微操指导」这一栏（写稿时按最高优先级注入），不覆盖原有规划；
   * 走的是剧情调整那条通路，所以留前后对照、可在剧情调整记录里撤回。
   */
  const doWritebackOutline = async (observation: ReviewObservation) => {
    const text = writebackText.trim()
    if (!text) return
    const chapter = chapterNumber || review.chapterNumber
    const projectPath = useProjectStore.getState().currentProject?.path
    if (!projectPath) {
      toast.error(t('reviewReport.qualitative.writebackFailed', { error: t('reviewReport.qualitative.noDraft') }))
      return
    }
    setWritebackBusy(true)
    try {
      // 内容走蓝图接口拿全文（story:read 每次只返回 3500 字，截断的尾巴会挑错锚点）；
      // 版本号仍取自 story:read，写入时由仓储层校验并发冲突。
      const [doc, blueprint] = await Promise.all([
        ipc.invoke('story:read', projectPath, { kind: 'blueprint', id: String(chapter) }),
        ipc.invoke('db:blueprint-get', chapter),
      ])
      if (!blueprint) throw new Error(t('reviewReport.qualitative.writebackNoBlueprint', { chapter }))
      const edit = buildAppendEdit(blueprint.userGuidance ?? '', buildOutlineAdjustmentBlock(text, chapter))
      if (!edit) throw new Error(t('reviewReport.qualitative.writebackEmpty'))
      const { applyRevision } = await import('../../services/agent/story-revision-service')
      await applyRevision(projectPath, {
        intent: t('reviewReport.qualitative.writebackIntent', { chapter }),
        summary: t('reviewReport.qualitative.writebackSummary', { chapter, title: observation.title }),
        edits: [{
          kind: 'blueprint',
          id: String(chapter),
          version: doc.version,
          field: 'userGuidance',
          oldText: edit.oldText,
          newText: edit.newText,
        }],
      })
      setWritebackId(null)
      setWritebackText('')
      toast.success(t('reviewReport.qualitative.writebackSuccess', { chapter }))
    } catch (e) {
      toast.error(t('reviewReport.qualitative.writebackFailed', { error: String(e) }))
    } finally {
      setWritebackBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-4">
        {/* 标题 + 正文统计 */}
        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-[var(--color-border)]">
          <h3 className="text-base font-bold text-[var(--color-text)] flex items-center gap-1.5">
            <ScanText size={15} className="text-[var(--color-accent)]" />
            {t('reviewReport.qualitative.title')}
          </h3>
          <span className="text-xs ml-auto" style={{ color: 'var(--color-text-muted)' }}>
            {t('reviewReport.qualitative.statsLine', {
              characters: review.stats.characters,
              paragraphs: review.stats.paragraphs,
              sentences: review.stats.sentences,
              dialogue: Math.round(review.stats.dialogueRatio * 100),
            })}
          </span>
        </div>

        {/* 本次观察参照的既定事实规模 */}
        <div className="mb-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {contextTotal > 0
            ? t('reviewReport.qualitative.contextLine', {
              timeline: review.context.timelineEvents,
              characters: review.context.characterStates,
              plots: review.context.openPlotLines,
              facts: review.context.knownFacts,
            })
            : t('reviewReport.qualitative.contextUnavailable')}
        </div>

        {/* 审稿观察（按维度分组） */}
        <section className="mb-6">
          <h4 className="text-sm font-semibold text-[var(--color-text)] mb-2 flex items-center gap-1.5">
            <ListChecks size={14} className="text-[var(--color-text-muted)]" />
            {t('reviewReport.qualitative.observationSection', { count: review.observations.length })}
          </h4>
          {groups.length === 0 ? (
            <div className="text-xs py-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('reviewReport.qualitative.noObservations')}
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.dimension}>
                  <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(`commands:review.dimension.${group.dimension}`)} · {group.items.length}
                  </div>
                  {group.dimension === 'outline-deviation' && outlineSummary.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5 pl-1">
                      {outlineSummary.map(item => (
                        <span
                          key={item.outlineClass}
                          className="px-1.5 py-[1px] rounded text-[0.65rem]"
                          style={{
                            border: '1px solid var(--color-border)',
                            color: OUTLINE_CLASS_COLOR[item.outlineClass],
                          }}
                        >
                          {t(`reviewReport.qualitative.outlineClass.${item.outlineClass}`)} {item.count}
                        </span>
                      ))}
                      <span className="text-[0.62rem]" style={{ color: 'var(--color-text-muted)' }}>
                        {t('reviewReport.qualitative.outlineClassHint')}
                      </span>
                    </div>
                  )}
                  <div className="space-y-1.5 pl-1">
                    {group.items.map((observation) => {
                      const meta = OBSERVATION_SEVERITY_META[observation.severity] ?? OBSERVATION_SEVERITY_META.note
                      return (
                        <div
                          key={observation.id}
                          className={cn('px-3 py-2 rounded-md border text-xs leading-relaxed', meta.borderClass, meta.bgClass)}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-0.5 flex-shrink-0"
                              checked={!!selected[observation.id]}
                              onChange={(e) => setSelected((prev) => ({ ...prev, [observation.id]: e.target.checked }))}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-[var(--color-text)]">{observation.title}</div>
                              {observation.detail && (
                                <div className="mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{observation.detail}</div>
                              )}
                              <div className={cn('mt-1 text-[0.65rem]', meta.colorClass)}>
                                {t(`commands:review.severity.${observation.severity}`)}
                                {observation.outlineClass && (
                                  <span className="ml-1.5" style={{ color: OUTLINE_CLASS_COLOR[observation.outlineClass] }}>
                                    {t(`reviewReport.qualitative.outlineClass.${observation.outlineClass}`)}
                                  </span>
                                )}
                                {observation.origin === 'rule' ? ` · ${t('reviewReport.qualitative.originRule')}` : ''}
                              </div>
                            </div>
                          </div>
                          {observation.evidence.map((evidence, evidenceIndex) => (
                            <div
                              key={evidenceIndex}
                              className="mt-1.5 ml-5 pl-2 text-[0.7rem] italic"
                              style={{ borderLeft: '2px solid var(--color-border)', color: 'var(--color-text-muted)' }}
                            >
                              <Quote size={10} className="inline mr-1 opacity-60" />
                              {evidence.quote}
                              <span className="ml-1 not-italic">
                                {evidence.start > 0
                                  ? t('reviewReport.qualitative.evidenceLine', { line: lineNumberAt(draftContent, evidence.start) })
                                  : t('reviewReport.qualitative.evidenceUnlocated')}
                              </span>
                            </div>
                          ))}
                          {observation.suggestion && (
                            <div className="mt-1.5 ml-5 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                              {t('reviewReport.qualitative.suggestion')} {observation.suggestion}
                            </div>
                          )}
                          {canWriteBackToOutline(observation) && (
                            <div className="mt-2 ml-5">
                              {writebackId === observation.id ? (
                                <div
                                  className="p-2 rounded-md"
                                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
                                >
                                  <Textarea
                                    rows={3}
                                    value={writebackText}
                                    onChange={(e) => setWritebackText(e.target.value)}
                                    placeholder={t('reviewReport.qualitative.writebackPlaceholder')}
                                  />
                                  <div className="mt-1 text-[0.65rem] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                                    {t('reviewReport.qualitative.writebackHint', { chapter: chapterNumber || review.chapterNumber })}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <Button
                                      size="sm"
                                      disabled={writebackBusy || !writebackText.trim()}
                                      onClick={() => void doWritebackOutline(observation)}
                                    >
                                      {writebackBusy ? <LoaderCircle size={11} className="animate-spin" /> : <FilePenLine size={11} />}
                                      {t('reviewReport.qualitative.writebackConfirm')}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={writebackBusy}
                                      onClick={() => { setWritebackId(null); setWritebackText('') }}
                                    >
                                      {t('reviewReport.qualitative.writebackCancel')}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setWritebackId(observation.id)
                                    setWritebackText(buildWritebackPrefill(observation))
                                  }}
                                >
                                  <FilePenLine size={11} />
                                  {t('reviewReport.qualitative.writeback')}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* AI 痕迹：只标记可修订位置；改写由下面的按钮显式发起 */}
        <section className="mb-6">
          <h4 className="text-sm font-semibold text-[var(--color-text)] mb-2 flex items-center gap-1.5">
            <Sparkles size={14} className="text-[var(--color-text-muted)]" />
            {t('reviewReport.qualitative.aiTraceSection', { count: review.aiTraces.length })}
          </h4>
          {review.aiTraces.length === 0 ? (
            <div className="text-xs py-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('reviewReport.qualitative.noAiTraces')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {review.aiTraces.map((finding) => (
                <div
                  key={finding.id}
                  className="px-3 py-2 rounded-md border border-[var(--color-border)] text-xs leading-relaxed"
                  style={{ backgroundColor: 'var(--color-bg-elevated)' }}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="px-1.5 py-0.5 rounded text-[0.65rem] flex-shrink-0"
                      style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}
                    >
                      {t(`commands:review.aiTrace.kind.${finding.kind}`)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div style={{ color: 'var(--color-text-secondary)' }}>{finding.message}</div>
                      {finding.metric && (
                        <div className="mt-0.5 text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                          {t('reviewReport.qualitative.metricLine', {
                            label: t(`commands:review.aiTrace.metric.${finding.metric.label}`),
                            value: finding.metric.value,
                            threshold: finding.metric.threshold,
                          })}
                        </div>
                      )}
                      {finding.hint && (
                        <div className="mt-0.5 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>{finding.hint}</div>
                      )}
                    </div>
                  </div>
                  {finding.quote && (
                    <div
                      className="mt-1.5 ml-5 pl-2 text-[0.7rem] italic"
                      style={{ borderLeft: '2px solid var(--color-border)', color: 'var(--color-text-muted)' }}
                    >
                      <Quote size={10} className="inline mr-1 opacity-60" />
                      {finding.quote}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {canAct && review.aiTraces.length > 0 && (
            <div className="mt-3 flex flex-col items-start gap-2">
              <Button variant="ai" size="sm" onClick={doDeai} disabled={busy !== null}>
                {busy === 'deai'
                  ? <LoaderCircle size={13} className="mr-1 animate-spin" />
                  : <WandSparkles size={13} className="mr-1" />}
                {t('reviewReport.qualitative.deai')}
              </Button>
              <p className="text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                {t('reviewReport.qualitative.deaiDescription')}
              </p>
            </div>
          )}
        </section>

        {/* 显式发起修订：只处理被勾选的观察 */}
        {canAct && review.observations.length > 0 && (
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(Object.fromEntries(review.observations.map((observation) => [observation.id, true])))}
            >
              {t('reviewReport.qualitative.selectAll')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelected({})}>
              {t('reviewReport.qualitative.selectNone')}
            </Button>
            <Button
              variant="ai"
              size="sm"
              onClick={doReviseSelected}
              disabled={busy !== null || selectedObservations.length === 0}
            >
              {busy === 'revise'
                ? <LoaderCircle size={13} className="mr-1 animate-spin" />
                : <Sparkles size={13} className="mr-1" />}
              {t('reviewReport.qualitative.reviseSelected', { count: selectedObservations.length })}
            </Button>
          </div>
        )}

        <p className="text-[0.7rem] mb-4" style={{ color: 'var(--color-text-muted)' }}>
          {t('reviewReport.qualitative.notVerdict')}
        </p>

        {/* 原始文本折叠 */}
        <details>
          <summary className="text-xs cursor-pointer hover:text-[var(--color-text)]" style={{ color: 'var(--color-text-muted)' }}>
            {t('reviewReport.viewRawText')}
          </summary>
          <pre className="mt-2 text-xs whitespace-pre-wrap font-mono leading-5 text-[var(--color-text-secondary)] bg-[var(--color-sidebar)] rounded-md p-3 border border-[var(--color-border)]">
            {reportText}
          </pre>
        </details>
      </div>
    </div>
  )
}
