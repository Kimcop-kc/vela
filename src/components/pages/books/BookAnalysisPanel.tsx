/**
 * 拆书分析面板 —— 参考小说的逐章分析
 *
 * 与「参考小说」页签的分工：那边看原文，这边跑分析、看结论、改结论。
 * 所有结论都来自数据库（book_analyses 表），关掉软件再打开仍在。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Loader2, Pencil, Play, Square, Trash2, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { EmptyState } from '../../ui/EmptyState'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { globalEventBus } from '../../../shared/event-bus'
import { getChapterTextPage } from '../../../services/book-service'
import {
  TECHNIQUE_KEYS,
  TECHNIQUE_LABELS,
  analyzeBook,
  reconstructStore,
  type AnalysisBasis,
  type BookAnalysisRecord,
  type BookAnalysisProgress,
  type ChapterAnalysis,
} from '../../../services/reconstruct'
import type { BookChapterEntry, BookRecord } from '../../../shared/ipc-channels'

interface Props {
  book: BookRecord
  chapters: BookChapterEntry[]
}

type RunMode = 'all' | 'selected' | 'failed'

/** 每条结论的可信度徽标颜色：事实/推测/无法判断三档 */
const BASIS_COLOR: Record<AnalysisBasis, string> = {
  text: 'var(--color-success-text)',
  inference: 'var(--color-warning-text)',
  unclear: 'var(--color-text-muted)',
}

export default function BookAnalysisPanel({ book, chapters }: Props) {
  const { t } = useTranslation('pages', { keyPrefix: 'booksOverview.analysis' })
  const [records, setRecords] = useState<BookAnalysisRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BookAnalysisProgress | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [focus, setFocus] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<{ summary: string; keyEvents: string; techniques: Record<string, string> }>({
    summary: '', keyEvents: '', techniques: {},
  })
  const [sourceChapter, setSourceChapter] = useState<{ number: number; text: string; loading: boolean } | null>(null)
  const cancelledRef = useRef(false)

  const byChapter = useMemo(() => {
    const map = new Map<number, BookAnalysisRecord>()
    for (const record of records) map.set(record.chapterNumber, record)
    return map
  }, [records])

  const stats = useMemo(() => {
    let done = 0
    let failed = 0
    for (const chapter of chapters) {
      const record = byChapter.get(chapter.number)
      if (!record) continue
      if (record.status === 'failed') failed += 1
      else done += 1
    }
    return { done, failed, missing: chapters.length - done - failed }
  }, [chapters, byChapter])

  const reload = useCallback(async () => {
    if (!book.id) return
    setLoading(true)
    try {
      setRecords(await reconstructStore.listAnalyses(book.id))
    } finally {
      setLoading(false)
    }
  }, [book.id])

  useEffect(() => { void reload() }, [reload])

  // 别处（例如批量分析结束）也会更新分析结果，跟着刷新
  useEffect(() => {
    const unsubscribe = globalEventBus.on('RECONSTRUCT_UPDATED', (payload: { kind: string; bookId?: string }) => {
      if (payload.kind === 'analysis' && (!payload.bookId || payload.bookId === book.id)) void reload()
    })
    return unsubscribe
  }, [book.id, reload])

  const toggleSelected = (chapterNumber: number) => {
    setSelected(prev => prev.includes(chapterNumber) ? prev.filter(n => n !== chapterNumber) : [...prev, chapterNumber])
  }

  /** 跑分析：mode 决定范围，单章重跑用 selected + 只勾那一章 */
  const run = async (mode: RunMode, onlyChapter?: number) => {
    if (running) return
    const targetSelected = onlyChapter ? [onlyChapter] : selected
    if ((mode === 'selected' || onlyChapter) && targetSelected.length === 0) {
      toast.error(t('needSelection'))
      return
    }
    cancelledRef.current = false
    setRunning(true)
    try {
      const result = await analyzeBook({
        book,
        chapters,
        mode: onlyChapter ? 'selected' : mode,
        selected: targetSelected,
        // 单章重跑与「重试失败」都是显式覆盖意图
        skipExisting: false,
        focus: focus.trim() || undefined,
        isCancelled: () => cancelledRef.current,
        onProgress: setProgress,
      })
      if (result.cancelled) toast.warning(t('cancelled', { done: result.done, failed: result.failed }))
      else if (result.failed > 0) toast.warning(t('finishedWithErrors', { done: result.done, failed: result.failed, skipped: result.skipped }))
      else toast.success(t('finished', { done: result.done, skipped: result.skipped }))
    } catch (error) {
      toast.error(t('failed', { error: String(error) }))
    } finally {
      setRunning(false)
      setProgress(null)
      await reload()
    }
  }

  const stop = () => { cancelledRef.current = true }

  const startEdit = (record: BookAnalysisRecord) => {
    const result = record.result
    if (!result) return
    setEditingId(record.id)
    setEditDraft({
      summary: result.summary,
      keyEvents: result.keyEvents.join('\n'),
      techniques: { ...result.techniques },
    })
  }

  const saveEdit = async (record: BookAnalysisRecord) => {
    if (!record.result) return
    const next: ChapterAnalysis = {
      ...record.result,
      summary: editDraft.summary.trim(),
      keyEvents: editDraft.keyEvents.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 40),
      techniques: Object.fromEntries(TECHNIQUE_KEYS.map(key => [key, (editDraft.techniques[key] ?? '').trim()])) as ChapterAnalysis['techniques'],
    }
    const id = await reconstructStore.putAnalysis({
      bookId: record.bookId,
      bookName: record.bookName,
      chapterNumber: record.chapterNumber,
      chapterTitle: record.chapterTitle,
      docId: record.docId,
      status: 'done',
      modelId: record.modelId,
      sourceHash: record.sourceHash,
      result: next,
    })
    if (!id) {
      toast.error(t('saveFailed'))
      return
    }
    setEditingId(null)
    toast.success(t('saved'))
    await reload()
  }

  const removeOne = async (record: BookAnalysisRecord) => {
    const ok = await confirm(t('removeConfirm', { chapter: record.chapterNumber }), { danger: true })
    if (!ok) return
    if (await reconstructStore.removeAnalysis(record.id)) {
      toast.success(t('removed'))
      await reload()
    } else toast.error(t('removeFailed'))
  }

  /** 展开原文：分析结论要能一键回查来源章节 */
  const viewSource = async (chapterNumber: number) => {
    if (sourceChapter?.number === chapterNumber) { setSourceChapter(null); return }
    const chapter = chapters.find(item => item.number === chapterNumber)
    if (!chapter) return
    setSourceChapter({ number: chapterNumber, text: '', loading: true })
    try {
      const page = await getChapterTextPage(chapter.docId, 0, 16)
      setSourceChapter({ number: chapterNumber, text: page?.text ?? '', loading: false })
    } catch {
      setSourceChapter({ number: chapterNumber, text: '', loading: false })
    }
  }

  const disabled = running || chapters.length === 0

  return (
    <div className="space-y-4">
      {/* 工具条：范围 / 侧重 / 开始停止 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => { void run('all') }}>
          {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          {t('analyzeMissing')}
        </Button>
        <Button variant="outline" size="sm" disabled={disabled || selected.length === 0} onClick={() => { void run('selected') }}>
          <Play size={11} />
          {t('analyzeSelected', { count: selected.length })}
        </Button>
        <Button variant="outline" size="sm" disabled={disabled || stats.failed === 0} onClick={() => { void run('failed') }}>
          <Play size={11} />
          {t('retryFailed', { count: stats.failed })}
        </Button>
        {running && (
          <Button variant="ghost" size="sm" onClick={stop}>
            <Square size={11} />
            {t('stop')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder={t('focusPlaceholder')}
          className="max-w-[420px]"
        />
        <span className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
          {t('stats', { done: stats.done, failed: stats.failed, missing: stats.missing })}
        </span>
      </div>

      {progress && (
        <div className="text-[0.7rem]" style={{ color: 'var(--color-text-secondary)' }}>
          {progress.phase === 'finished' || progress.phase === 'cancelled'
            ? t('progressDone', { done: progress.done, failed: progress.failed, skipped: progress.skipped })
            : t('progressRunning', {
                done: progress.done,
                failed: progress.failed,
                total: progress.total,
                chapter: progress.currentChapter,
              })}
        </div>
      )}

      {chapters.length === 0 ? (
        <EmptyState icon={<AlertTriangle size={20} />} message={t('noChapters')} opacity={0.55} />
      ) : (
        <>
          {/* 章节清单：勾选 + 状态 */}
          <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {chapters.map((chapter, index) => {
              const record = byChapter.get(chapter.number)
              const status = !record ? 'missing' : record.status === 'failed' ? 'failed' : 'done'
              const statusColor = status === 'done'
                ? 'var(--color-success-text)'
                : status === 'failed' ? 'var(--color-error)' : 'var(--color-text-muted)'
              return (
                <div
                  key={chapter.docId || chapter.number}
                  className="flex items-center gap-2 px-2 py-1.5 text-[0.7rem]"
                  style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}
                >
                  <input
                    type="checkbox"
                    className="flex-shrink-0"
                    checked={selected.includes(chapter.number)}
                    onChange={() => toggleSelected(chapter.number)}
                    aria-label={t('selectChapter', { chapter: chapter.number })}
                  />
                  <span className="flex-shrink-0 tabular-nums font-mono" style={{ color: 'var(--color-text-muted)' }}>
                    {chapter.number}
                  </span>
                  <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }}>
                    {chapter.title || t('untitledChapter')}
                  </span>
                  <span className="flex-shrink-0" style={{ color: statusColor }}>
                    {t(`status.${status}`)}
                  </span>
                  <button
                    className="flex-shrink-0 px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={t('reanalyze')}
                    disabled={running}
                    onClick={() => { void run('selected', chapter.number) }}
                  >
                    {t('reanalyze')}
                  </button>
                  <button
                    className="flex-shrink-0 px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={t('viewSource')}
                    onClick={() => { void viewSource(chapter.number) }}
                  >
                    {t('viewSource')}
                  </button>
                </div>
              )
            })}
          </div>

          {sourceChapter && (
            <div className="rounded-md p-3" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                  {t('sourceTitle', { chapter: sourceChapter.number })}
                </span>
                <button className="p-1 rounded" style={{ color: 'var(--color-text-muted)' }} onClick={() => setSourceChapter(null)}>
                  <X size={12} />
                </button>
              </div>
              <div className="text-[0.7rem] leading-relaxed whitespace-pre-wrap max-h-[260px] overflow-y-auto" style={{ color: 'var(--color-text-secondary)' }}>
                {sourceChapter.loading ? t('loading') : sourceChapter.text || t('sourceEmpty')}
              </div>
              <div className="mt-2 text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{t('sourceTruncated')}</div>
            </div>
          )}

          {/* 分析结论 */}
          {loading && records.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('loading')}</div>
          ) : records.length === 0 ? (
            <EmptyState icon={<Play size={20} />} message={t('noAnalysis')} opacity={0.55}>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('noAnalysisHint')}</span>
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {records.map(record => {
                const result = record.result
                const expanded = expandedId === record.id
                const editing = editingId === record.id
                return (
                  <div key={record.id} className="rounded-md px-3 py-2" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
                    <div className="flex items-center gap-2">
                      <button
                        className="flex-1 min-w-0 flex items-center gap-2 text-left"
                        onClick={() => setExpandedId(expanded ? null : record.id)}
                      >
                        <span className="text-[0.7rem] tabular-nums font-mono flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                          {record.chapterNumber}
                        </span>
                        <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                          {record.chapterTitle || t('untitledChapter')}
                        </span>
                        {record.status === 'failed' && (
                          <span className="flex-shrink-0 text-[0.65rem]" style={{ color: 'var(--color-error)' }}>{t('status.failed')}</span>
                        )}
                      </button>
                      <button className="p-1 rounded flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} title={t('edit')} onClick={() => startEdit(record)} disabled={!result}>
                        <Pencil size={11} />
                      </button>
                      <button className="p-1 rounded flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} title={t('remove')} onClick={() => { void removeOne(record) }}>
                        <Trash2 size={11} />
                      </button>
                    </div>

                    {record.status === 'failed' && record.error && (
                      <div className="mt-1 text-[0.68rem]" style={{ color: 'var(--color-error)' }}>{record.error}</div>
                    )}

                    {editing && result && (
                      <div className="mt-2 space-y-2">
                        <div>
                          <div className="text-[0.68rem] mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('fieldSummary')}</div>
                          <Textarea
                            rows={3}
                            value={editDraft.summary}
                            onChange={(e) => setEditDraft(draft => ({ ...draft, summary: e.target.value }))}
                          />
                        </div>
                        <div>
                          <div className="text-[0.68rem] mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('fieldKeyEvents')}</div>
                          <Textarea
                            rows={4}
                            value={editDraft.keyEvents}
                            onChange={(e) => setEditDraft(draft => ({ ...draft, keyEvents: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{t('fieldTechniques')}</div>
                          {TECHNIQUE_KEYS.map(key => (
                            <div key={key} className="flex items-start gap-2">
                              <span className="w-[132px] flex-shrink-0 text-[0.68rem] pt-1" style={{ color: 'var(--color-text-secondary)' }}>
                                {TECHNIQUE_LABELS[key]}
                              </span>
                              <Input
                                value={editDraft.techniques[key] ?? ''}
                                onChange={(e) => setEditDraft(draft => ({ ...draft, techniques: { ...draft.techniques, [key]: e.target.value } }))}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => { void saveEdit(record) }}>
                            <Check size={11} />{t('save')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>{t('cancel')}</Button>
                        </div>
                      </div>
                    )}

                    {!editing && result && (
                      <div className="mt-1.5 space-y-1.5">
                        {result.summary && (
                          <div className="text-[0.7rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                            {expanded ? result.summary : result.summary.slice(0, 90) + (result.summary.length > 90 ? '…' : '')}
                          </div>
                        )}
                        {expanded && (
                          <>
                            {result.characters.length > 0 && (
                              <div className="text-[0.68rem]" style={{ color: 'var(--color-text-secondary)' }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>{t('fieldCharacters')}：</span>
                                {result.characters.map(character => character.name).join('、')}
                              </div>
                            )}
                            {result.locations.length > 0 && (
                              <div className="text-[0.68rem]" style={{ color: 'var(--color-text-secondary)' }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>{t('fieldLocations')}：</span>
                                {result.locations.join('、')}
                              </div>
                            )}
                            {result.items.length > 0 && (
                              <div className="text-[0.68rem]" style={{ color: 'var(--color-text-secondary)' }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>{t('fieldItems')}：</span>
                                {result.items.join('、')}
                              </div>
                            )}
                            {result.keyEvents.length > 0 && (
                              <div className="text-[0.68rem]" style={{ color: 'var(--color-text-secondary)' }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>{t('fieldKeyEvents')}：</span>
                                {result.keyEvents.join(' → ')}
                              </div>
                            )}
                            <div className="text-[0.68rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                              {([
                                ['fieldCoreEvent', result.plotStructure.coreEvent],
                                ['fieldGoal', result.plotStructure.goal],
                                ['fieldEscalation', result.plotStructure.escalation],
                                ['fieldResolution', result.plotStructure.resolution],
                                ['fieldImpact', result.plotStructure.impactOnLater],
                              ] as const).filter(([, value]) => value).map(([labelKey, value]) => (
                                <div key={labelKey}>
                                  <span style={{ color: 'var(--color-text-muted)' }}>{t(labelKey)}：</span>{value}
                                </div>
                              ))}
                            </div>
                            <div className="space-y-1">
                              {TECHNIQUE_KEYS.filter(key => result.techniques[key]).map(key => (
                                <div key={key} className="text-[0.68rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                                  <span style={{ color: 'var(--color-text-muted)' }}>{TECHNIQUE_LABELS[key]}：</span>{result.techniques[key]}
                                </div>
                              ))}
                            </div>
                            {result.hooks.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{t('fieldHooks')}：</div>
                                {result.hooks.map((hook, hookIndex) => (
                                  <div key={hookIndex} className="text-[0.68rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                                    <span style={{ color: BASIS_COLOR[hook.basis] }}>{t(`basis.${hook.basis}`)}</span>
                                    <span className="mx-1">·</span>
                                    {hook.content}
                                    {hook.position ? <span style={{ color: 'var(--color-text-muted)' }}>（{hook.position}）</span> : null}
                                  </div>
                                ))}
                              </div>
                            )}
                            {result.evidence.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{t('fieldEvidence')}：</div>
                                {result.evidence.slice(0, 12).map((item, evidenceIndex) => (
                                  <div key={evidenceIndex} className="text-[0.68rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                                    <span style={{ color: BASIS_COLOR[item.basis] }}>{t(`basis.${item.basis}`)}</span>
                                    <span className="mx-1">·</span>
                                    {item.claim}
                                    {item.quote ? <span style={{ color: 'var(--color-text-muted)' }}>「{item.quote}」</span> : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                        {result.warnings.length > 0 && (
                          <div className="text-[0.65rem] leading-relaxed" style={{ color: 'var(--color-warning-text)' }}>
                            {expanded ? result.warnings.join('；') : t('warningCount', { count: result.warnings.length })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
