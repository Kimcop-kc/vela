/**
 * 拆书分析服务 —— 逐章分析参考小说，结果落项目数据库
 *
 * 关键约束（对齐任务文档四、十一、十二）：
 *   - 绝不把整本书一次性发给模型：逐章取正文，超长按 token 预算截断并标注；
 *   - 断点续跑：已有结果的章节默认跳过，重复点击不会重复烧额度；
 *   - 可取消：每章开始与结束时检查取消标记，取消后已完成的结果全部保留；
 *   - 失败可重试：单章失败只记该章失败，不中断整批；
 *   - 不把推测当事实：归一化时区分 text / inference。
 */
import { globalEventBus } from '../../shared/event-bus'
import { estimateTokens, parseLooseJson } from '../workflows/segmented-generation'
import { ipc } from '../ipc-client'
import { stripJsonFence, buildChapterAnalysisMessages, normalizeChapterAnalysis } from './analysis-prompt'
import { repairTruncatedObject } from './json-repair'
import type {
  BookAnalysisInput, BookAnalysisProgress, BookAnalysisRecord, ChapterAnalysis,
} from '../../shared/reconstruct'
import type { BookChapterEntry, BookRecord } from '../../shared/ipc-channels'

/** 并发上限：拆书分析是长任务，同时跑太多既慢又容易触发服务商限流 */
const ANALYSIS_CONCURRENCY = 2
/** 单章喂给模型的正文上限（token 估算），超出即截断并标注 */
const CHAPTER_TOKEN_BUDGET = 9000
/** 单章正文分页读取的最大块数（防止超大章节把内存吃满） */
const MAX_TEXT_CHUNKS = 24

/** 稳定的正文指纹：同一章正文没变就不重复分析 */
export function hashChapterText(text: string): string {
  let hash = 5381
  const sample = text.length > 20000 ? text.slice(0, 10000) + text.slice(-10000) : text
  for (let index = 0; index < sample.length; index++) {
    hash = ((hash << 5) + hash + sample.charCodeAt(index)) >>> 0
  }
  return `${hash.toString(36)}-${text.length}`
}

/** 按预算截断正文，返回截断后的文本与是否发生截断 */
export function clampChapterText(text: string, budget = CHAPTER_TOKEN_BUDGET): { text: string; truncated: boolean } {
  if (!text) return { text: '', truncated: false }
  if (estimateTokens(text) <= budget) return { text, truncated: false }
  // 按段落累加，尽量在段落边界收尾，避免切出半句话
  const paragraphs = text.split(/\n\s*\n/)
  const kept: string[] = []
  let used = 0
  for (const paragraph of paragraphs) {
    const cost = estimateTokens(paragraph)
    if (used + cost > budget) break
    kept.push(paragraph)
    used += cost
  }
  if (kept.length === 0) {
    // 整章就是一大段：退化为按字符粗切
    const approx = Math.max(1000, Math.floor(budget * 1.5))
    return { text: text.slice(0, approx), truncated: true }
  }
  return { text: kept.join('\n\n'), truncated: true }
}

/** 取回整章正文（分页拼接，避免一次请求过大） */
async function readChapterText(docId: string): Promise<string> {
  if (!docId) return ''
  let chunkStart = 0
  const parts: string[] = []
  for (let page = 0; page < MAX_TEXT_CHUNKS; page++) {
    const result = await ipc.invoke('kb:get-document-text-page', docId, chunkStart, 16)
    if (!result?.success || !result.text) break
    parts.push(result.text)
    if (result.done) break
    const next = result.nextChunkIndex
    if (typeof next !== 'number' || next <= chunkStart) break
    chunkStart = next
  }
  return parts.join('\n')
}

/** 已有分析记录索引：章节号 → 记录（用于跳过与重试判定） */
export function indexAnalyses(records: BookAnalysisRecord[]): Map<number, BookAnalysisRecord> {
  const map = new Map<number, BookAnalysisRecord>()
  for (const record of records) map.set(record.chapterNumber, record)
  return map
}

export type AnalysisTargetMode = 'all' | 'selected' | 'failed' | 'missing'

/**
 * 挑出这次要分析哪些章节。
 *
 * - all：全部章节（默认跳过已有结果的，除非把 skipExisting 显式设为 false）
 * - selected：界面勾选的章节
 * - failed：只重试上次失败的
 * - missing：只补没分析过的
 */
export function pickAnalysisTargets(
  chapters: BookChapterEntry[],
  existing: Map<number, BookAnalysisRecord>,
  options: { mode: AnalysisTargetMode; selected?: number[]; skipExisting?: boolean },
): { targets: BookChapterEntry[]; skipped: number } {
  const selectedSet = new Set(options.selected ?? [])
  let targets = chapters.filter(chapter => {
    if (options.mode === 'selected') return selectedSet.has(chapter.number)
    if (options.mode === 'failed') return existing.get(chapter.number)?.status === 'failed'
    if (options.mode === 'missing') return !existing.has(chapter.number)
    return true
  })
  // 默认跳过已有结果的章节：重复点击不该重复消耗模型额度
  if (options.mode === 'all' && options.skipExisting !== false) {
    targets = targets.filter(chapter => !existing.has(chapter.number))
  }
  return { targets, skipped: chapters.length - targets.length }
}

export interface AnalyzeBookParams {
  book: BookRecord
  chapters: BookChapterEntry[]
  mode: AnalysisTargetMode
  selected?: number[]
  /** all 模式下是否覆盖已有结果（默认 false，只补缺） */
  skipExisting?: boolean
  /** 本次分析的侧重（附加要求） */
  focus?: string
  /** 外部取消标记（界面上的「停止」按钮） */
  isCancelled?: () => boolean
  onProgress?: (progress: BookAnalysisProgress) => void
  onChapterDone?: (record: BookAnalysisRecord) => void
}

export interface AnalyzeBookResult {
  done: number
  failed: number
  skipped: number
  cancelled: boolean
  results: BookAnalysisRecord[]
}

/**
 * 逐章分析一本书。返回本次实际处理的统计。
 *
 * 模型调用走 llm:generate（非流式 + JSON 模式），单章失败不影响其他章节。
 */
export async function analyzeBook(params: AnalyzeBookParams): Promise<AnalyzeBookResult> {
  const { book, chapters, mode, focus, isCancelled, onProgress, onChapterDone } = params
  const existingRecords = await ipc.invoke('db:book-analysis-list', book.id).catch(() => [] as BookAnalysisRecord[])
  const existing = indexAnalyses(existingRecords ?? [])
  const { targets, skipped } = pickAnalysisTargets(chapters, existing, { mode, selected: params.selected, skipExisting: params.skipExisting })

  const modelId = await resolveAnalysisModelId()
  const progress: BookAnalysisProgress = {
    bookId: book.id, total: targets.length, done: 0, failed: 0, skipped,
    currentChapter: 0, phase: 'analyzing',
  }
  const report = (patch: Partial<BookAnalysisProgress> = {}) => {
    Object.assign(progress, patch)
    onProgress?.({ ...progress })
  }
  report()

  const results: BookAnalysisRecord[] = []
  let cursor = 0
  let cancelled = false
  const takeNext = (): BookChapterEntry | null => {
    const index = cursor++
    return index < targets.length ? targets[index] : null
  }
  const worker = async () => {
    let chapter = takeNext()
    while (chapter) {
      if (isCancelled?.()) { cancelled = true; return }
      report({ currentChapter: chapter.number })
      try {
        const record = await analyzeOneChapter({ book, chapter, modelId, focus })
        results.push(record)
        if (record.status === 'failed') report({ failed: progress.failed + 1 })
        else report({ done: progress.done + 1 })
        onChapterDone?.(record)
        globalEventBus.emit('RECONSTRUCT_UPDATED', { kind: 'analysis', bookId: book.id })
      } catch (error) {
        report({ failed: progress.failed + 1, message: String(error) })
      }
      chapter = takeNext()
    }
  }

  const concurrency = Math.min(ANALYSIS_CONCURRENCY, Math.max(1, targets.length))
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  report({ phase: cancelled ? 'cancelled' : 'finished' })
  return { done: progress.done, failed: progress.failed, skipped, cancelled, results }
}

/** 单章分析：取正文 → 调模型 → 归一化 → 落库 */
async function analyzeOneChapter(params: {
  book: BookRecord
  chapter: BookChapterEntry
  modelId: string | null
  focus?: string
}): Promise<BookAnalysisRecord> {
  const { book, chapter, modelId, focus } = params
  const rawText = await readChapterText(chapter.docId)
  const { text, truncated } = clampChapterText(rawText)
  const base: BookAnalysisInput = {
    bookId: book.id,
    bookName: book.name,
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    docId: chapter.docId,
    status: 'failed',
    modelId: modelId ?? '',
    sourceHash: hashChapterText(rawText),
  }

  if (!text.trim()) {
    return persistAnalysis({ ...base, error: '读取不到章节正文（知识库中可能已删除该章）。' })
  }
  if (!modelId) {
    // 拆书分析走「摘要/提取」这一用途类别（见 shared/purpose-routing.ts），设置页里绑的是类别
    return persistAnalysis({ ...base, error: '没有可用模型：拆书分析使用「摘要与提取」用途的模型，请在设置里确认模型池与该用途绑定。' })
  }

  const messages = buildChapterAnalysisMessages({
    bookName: book.name,
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    chapterText: text,
    focus,
    truncated,
  })

  let responseText = ''
  let requestError = ''
  try {
    const response = await ipc.invoke('llm:generate', {
      modelId,
      messages,
      temperature: 0.2,
      thinking: false,
      responseFormat: { type: 'json_object' },
      purpose: 'book_analysis',
    })
    if (response.success === false) requestError = response.error || '模型调用失败'
    else responseText = response.content ?? ''
  } catch (error) {
    requestError = String(error)
  }

  if (requestError && !responseText.trim()) {
    return persistAnalysis({ ...base, error: requestError })
  }

  const parsed = parseAnalysisJson(responseText)
  const result = normalizeChapterAnalysis(parsed, { chapterNumber: chapter.number, chapterTitle: chapter.title })
  if (truncated) result.warnings.unshift('本章正文超过分析预算，只分析了前半部分。')
  if (!parsed) result.warnings.unshift('模型返回的内容不是合法 JSON，已尽量抢救；建议重试本章。')
  // JSON 解析失败或结论为空时按失败落库，避免界面显示一份空分析
  const usable = !!parsed && (!!result.summary || result.keyEvents.length > 0)
  return persistAnalysis({
    ...base,
    status: usable ? 'done' : 'failed',
    error: usable ? '' : (requestError || '模型没有返回可用的分析结论，请重试本章。'),
    result: usable ? result : null,
  })
}

/** 解析模型返回：先常规解析，失败再用抢救式解析，最后才放弃 */
export function parseAnalysisJson(text: string): unknown | null {
  const clean = stripJsonFence(text)
  if (!clean) return null
  // 1) 先试「补括号」：它保留所有已经写完的字段，截断时信息损失最小
  const rescued = repairTruncatedObject<Record<string, unknown>>(clean)
  if (rescued && typeof rescued === 'object') return rescued
  // 2) 再退到通用容错解析（截断修补 + 片段提取）
  const parsed = parseLooseJson<unknown>(clean)
  return parsed && typeof parsed === 'object' ? parsed : null
}

async function persistAnalysis(input: BookAnalysisInput): Promise<BookAnalysisRecord> {
  const saved = await ipc.invoke('db:book-analysis-put', input).catch(() => ({ success: false }) as { success: boolean; id?: number })
  const id = saved?.id ?? 0
  if (id) {
    const record = await ipc.invoke('db:book-analysis-get', id).catch(() => null as BookAnalysisRecord | null)
    if (record) return record
  }
  // 落库失败时也要把结果带回界面，但明确标注没保存成功
  return {
    id: 0,
    bookId: input.bookId,
    bookName: input.bookName,
    chapterNumber: input.chapterNumber,
    chapterTitle: input.chapterTitle,
    docId: input.docId,
    analysisType: 'chapter',
    status: input.status,
    modelId: input.modelId ?? '',
    error: input.error ? `${input.error}（结果未能保存到数据库）` : '结果未能保存到数据库',
    sourceHash: input.sourceHash ?? '',
    result: input.result ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** 解析「拆书分析」用途要用的模型；未绑定则按用途路由回落到默认模型 */
async function resolveAnalysisModelId(): Promise<string | null> {
  const { useLLMStore } = await import('../../stores/llm-store')
  return useLLMStore.getState().resolveModelId('book_analysis')
}

/** 某章的分析结果是否仍然有效（正文没变过） */
export function isAnalysisFresh(record: BookAnalysisRecord | undefined, currentHash: string): boolean {
  return !!record && record.status === 'done' && !!record.result && record.sourceHash === currentHash
}

export type { ChapterAnalysis }
