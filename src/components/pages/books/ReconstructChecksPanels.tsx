/** 正文生成 / 一致性检查 / 相似度报告 三个页签。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, FileText, Loader2, Play, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { EmptyState } from '../../ui/EmptyState'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { globalEventBus } from '../../../shared/event-bus'
import { getChapterTextPage } from '../../../services/book-service'
import { canonStore } from '../../../services/narrative-consistency'
import {
  buildSimilarityReport,
  checkDraftConsistency,
  composeChapterText,
  extractPendingFacts,
  generateDraftSegments,
  loadChapterCanon,
  reconstructStore,
  regenerateBeatSegment,
  saveAsDraft,
  segmentTokens,
  type BookAnalysisRecord,
  type DraftConsistencyResult,
  type DraftSegment,
  type PlotOutlineRecord,
  type ReferenceChapter,
  type SimilarityReportPayload,
  type SimilarityReportRecord,
} from '../../../services/reconstruct'
import type { BookRecord } from '../../../shared/ipc-channels'

interface CommonProps {
  books: BookRecord[]
}

/** 读出参考书的若干章正文，供相似度比对（只读前 8 块，不整本载入） */
async function readReferenceChapters(books: BookRecord[], limitPerBook = 6): Promise<ReferenceChapter[]> {
  const out: ReferenceChapter[] = []
  for (const book of books) {
    for (const chapter of book.chapters.slice(0, limitPerBook)) {
      try {
        const page = await getChapterTextPage(chapter.docId, 0, 8)
        if (page?.text) out.push({ chapterNumber: chapter.number, bookId: book.id, bookName: book.name, text: page.text })
      } catch {
        // 读不到就跳过，不影响其它章节
      }
    }
  }
  return out
}

async function loadSourcesForOutline(outline: PlotOutlineRecord): Promise<BookAnalysisRecord[]> {
  return reconstructStore.getAnalyses(outline.sources.map(source => source.analysisId))
}

/** 正文生成页签：选大纲 → 选节点 → 逐节点生成 → 改段 / 重生成 → 存草稿 → 跑检查 */
export function DraftGeneratePanel() {
  const { t } = useTranslation('pages', { keyPrefix: 'booksOverview.draftGenerate' })
  const [outlines, setOutlines] = useState<PlotOutlineRecord[]>([])
  const [outlineId, setOutlineId] = useState<number | null>(null)
  const [selectedBeats, setSelectedBeats] = useState<number[]>([])
  const [chapterNumber, setChapterNumber] = useState(1)
  const [wordsPerBeat, setWordsPerBeat] = useState(800)
  const [segments, setSegments] = useState<DraftSegment[]>([])
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [consistency, setConsistency] = useState<DraftConsistencyResult | null>(null)
  const [factResult, setFactResult] = useState('')

  const outline = useMemo(() => outlines.find(item => item.id === outlineId) ?? null, [outlines, outlineId])

  const reload = useCallback(async () => {
    const list = await reconstructStore.listOutlines()
    setOutlines(list)
    setOutlineId(current => current ?? list[0]?.id ?? null)
  }, [])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => globalEventBus.on('RECONSTRUCT_UPDATED', () => { void reload() }), [reload])
  useEffect(() => {
    setSelectedBeats(outline ? outline.beats.map(beat => beat.sequence) : [])
    setSegments([])
    setConsistency(null)
  }, [outline])

  const generate = async () => {
    if (!outline) return
    const beats = outline.beats.filter(beat => selectedBeats.includes(beat.sequence))
    if (beats.length === 0) { toast.error(t('needBeats')); return }
    setRunning(true)
    setStatus(t('generating'))
    setSegments([])
    try {
      const result = await generateDraftSegments({
        outline,
        beats,
        chapterNumber,
        targetWordsPerBeat: wordsPerBeat,
        onSegment: segment => setSegments(prev => [...prev, segment]),
        onProgress: (done, total) => setStatus(t('progress', { done, total })),
      })
      if (result.error) toast.error(result.error)
      else if (result.cancelled) toast.warning(t('cancelled'))
      else toast.success(t('generated'))
    } finally {
      setRunning(false)
      setStatus('')
    }
  }

  const rewriteSegment = async (index: number) => {
    if (!outline) return
    const segment = segments[index]
    const beat = outline.beats.find(item => item.sequence === segment.sequence)
    if (!beat) return
    setRunning(true)
    try {
      const next = await regenerateBeatSegment({
        outline, beat, chapterNumber, targetWords: wordsPerBeat,
        previousText: segments[index - 1]?.text ?? '',
      })
      if (next.error) { toast.error(next.error); return }
      setSegments(prev => prev.map((item, i) => i === index ? next : item))
      toast.success(t('segmentRegenerated'))
    } finally {
      setRunning(false)
    }
  }

  const content = composeChapterText(segments)

  const save = async () => {
    const result = await saveAsDraft({ chapterNumber, content })
    if (!result.success) { toast.error(t('saveFailed', { error: result.error ?? '' })); return }
    toast.success(t('saved', { version: result.version ?? 0 }))
    globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts', 'all'] })
  }

  const runChecks = async () => {
    if (!content.trim()) { toast.error(t('needContent')); return }
    setStatus(t('checking'))
    try {
      const canon = await loadChapterCanon({ chapterNumber, chapterGoal: outline?.premise ?? '', keywords: [] })
      setConsistency(await checkDraftConsistency({ chapterNumber, content, canon: canon.canon }))
      const states = await canonStore.getAllCharacterStates().catch(() => [])
      const facts = await extractPendingFacts({
        chapterNumber,
        chapterTitle: outline?.title ?? '',
        content,
        characterNames: states.map(state => state.character).filter(Boolean),
      })
      setFactResult(facts.error
        ? t('factsFailed', { error: facts.error })
        : t('factsExtracted', { proposed: facts.proposed, added: facts.added, skipped: facts.skipped }))
      toast.success(t('checked'))
    } finally {
      setStatus('')
    }
  }

  const selectStyle = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="px-2 py-1 rounded text-[0.7rem]" style={selectStyle} value={outlineId ?? ''} onChange={(e) => setOutlineId(Number(e.target.value) || null)}>
          {outlines.length === 0 && <option value="">{t('noOutline')}</option>}
          {outlines.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <Input type="number" value={chapterNumber} onChange={(e) => setChapterNumber(Number(e.target.value) || 1)} className="max-w-[90px]" />
        <Input type="number" value={wordsPerBeat} onChange={(e) => setWordsPerBeat(Number(e.target.value) || 800)} className="max-w-[100px]" />
        <Button variant="outline" size="sm" disabled={running || !outline} onClick={() => { void generate() }}>
          {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          {t('generate')}
        </Button>
        <Button variant="ghost" size="sm" disabled={!segments.length} onClick={() => { void save() }}>
          <Save size={11} />{t('saveAsDraft')}
        </Button>
        <Button variant="ghost" size="sm" disabled={!segments.length || running} onClick={() => { void runChecks() }}>
          <ShieldCheck size={11} />{t('runChecks')}
        </Button>
        {status && <span className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{status}</span>}
      </div>

      {!outline ? (
        <EmptyState icon={<FileText size={20} />} message={t('noOutline')} opacity={0.55} />
      ) : (
        <>
          <div className="rounded-md max-h-[140px] overflow-y-auto" style={{ border: '1px solid var(--color-border)' }}>
            {outline.beats.map((beat, index) => (
              <label key={beat.sequence} className="flex items-center gap-2 px-2 py-1 text-[0.68rem] cursor-pointer" style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}>
                <input
                  type="checkbox"
                  checked={selectedBeats.includes(beat.sequence)}
                  onChange={() => setSelectedBeats(prev => prev.includes(beat.sequence) ? prev.filter(n => n !== beat.sequence) : [...prev, beat.sequence])}
                />
                <span className="flex-shrink-0 font-mono tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{beat.sequence}</span>
                <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }}>{beat.title}</span>
                <span className="flex-shrink-0 truncate max-w-[360px]" style={{ color: 'var(--color-text-muted)' }}>{beat.event.slice(0, 50)}</span>
              </label>
            ))}
          </div>

          <div className="space-y-2">
            {segments.map((segment, index) => (
              <div key={`${segment.sequence}-${index}`} className="rounded-md px-3 py-2 space-y-1.5" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.7rem] font-mono tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{segment.sequence}</span>
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{segment.title}</span>
                  <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                    {t('wordCount', { count: segment.wordCount, tokens: segmentTokens(segment.text) })}
                  </span>
                  <Button variant="ghost" size="sm" disabled={running} onClick={() => { void rewriteSegment(index) }}>
                    <RefreshCw size={11} />{t('rewriteSegment')}
                  </Button>
                </div>
                {segment.error && <div className="text-[0.68rem]" style={{ color: 'var(--color-error)' }}>{segment.error}</div>}
                <Textarea
                  rows={6}
                  value={segment.text}
                  onChange={(e) => setSegments(prev => prev.map((item, i) => i === index ? { ...item, text: e.target.value, wordCount: e.target.value.replace(/\s/g, '').length } : item))}
                />
              </div>
            ))}
          </div>

          {content && (
            <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
              {t('totalWords', { count: content.replace(/\s/g, '').length, tokens: segmentTokens(content) })}
            </div>
          )}

          {consistency && (
            <div className="rounded-md px-3 py-2 space-y-1" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
              <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                <ShieldCheck size={12} />
                {t('consistencyTitle')}
                <span style={{ color: consistency.verdict === 'clear' ? 'var(--color-success-text)' : consistency.verdict === 'conflict' ? 'var(--color-error)' : 'var(--color-warning-text)' }}>
                  {t(`verdict.${consistency.verdict}`)}
                </span>
              </div>
              <div className="text-[0.68rem]" style={{ color: 'var(--color-text-secondary)' }}>{consistency.summary}</div>
              {consistency.issues.slice(0, 8).map((issue, index) => (
                <div key={index} className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>· {issue.issue}</div>
              ))}
              {factResult && <div className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{factResult}</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 相似度报告页签：本地算法比对文本与情节，报告可保存回看 */
export function SimilarityPanel({ books }: CommonProps) {
  const { t } = useTranslation('pages', { keyPrefix: 'booksOverview.similarity' })
  const [outlines, setOutlines] = useState<PlotOutlineRecord[]>([])
  const [outlineId, setOutlineId] = useState<number | null>(null)
  const [draftText, setDraftText] = useState('')
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<SimilarityReportPayload | null>(null)
  const [saved, setSaved] = useState<SimilarityReportRecord[]>([])
  const [status, setStatus] = useState('')

  const reload = useCallback(async () => {
    const [list, reports] = await Promise.all([reconstructStore.listOutlines(), reconstructStore.listSimilarityReports(20)])
    setOutlines(list)
    setOutlineId(current => current ?? list[0]?.id ?? null)
    setSaved(reports)
  }, [])

  useEffect(() => { void reload() }, [reload])

  const run = async () => {
    if (!draftText.trim()) { toast.error(t('needText')); return }
    setRunning(true)
    setStatus(t('comparing'))
    try {
      const references = await readReferenceChapters(books)
      const outline = outlines.find(item => item.id === outlineId) ?? null
      const analyses = outline ? await loadSourcesForOutline(outline) : []
      const payload = buildSimilarityReport({
        generated: draftText,
        references,
        beats: outline?.beats ?? [],
        analyses,
      })
      setReport(payload)
      const id = await reconstructStore.saveSimilarityReport({
        outlineId: outline?.id ?? null,
        bookIds: [...new Set(references.map(reference => reference.bookId))],
        report: payload,
      })
      if (!id) toast.error(t('saveFailed'))
      await reload()
      toast.success(t('done', { count: payload.findings.length }))
    } finally {
      setRunning(false)
      setStatus('')
    }
  }

  const remove = async (id: number) => {
    const ok = await confirm(t('removeConfirm'), { danger: true })
    if (!ok) return
    if (await reconstructStore.removeSimilarityReport(id)) {
      toast.success(t('removed'))
      await reload()
    }
  }

  const riskColor = (risk: string) => risk === 'high'
    ? 'var(--color-error)'
    : risk === 'medium' ? 'var(--color-warning-text)' : risk === 'low' ? 'var(--color-success-text)' : 'var(--color-text-muted)'

  return (
    <div className="space-y-3">
      <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{t('hint')}</div>
      <Textarea rows={6} placeholder={t('placeholder')} value={draftText} onChange={(e) => setDraftText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="px-2 py-1 rounded text-[0.7rem]"
          style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          value={outlineId ?? ''}
          onChange={(e) => setOutlineId(Number(e.target.value) || null)}
        >
          <option value="">{t('noOutline')}</option>
          {outlines.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <Button variant="outline" size="sm" disabled={running} onClick={() => { void run() }}>
          {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          {t('run')}
        </Button>
        {status && <span className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{status}</span>}
      </div>

      {report && (
        <div className="rounded-md px-3 py-2 space-y-1.5" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
            {t('overall')}
            <span style={{ color: riskColor(report.overallRisk) }}>{t(`risk.${report.overallRisk}`)}</span>
            <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
              {t('statsLine', { chapters: report.stats.referenceChapters, chars: report.stats.generatedChars, run: report.stats.longestCommonRun, sentences: report.stats.nearDuplicateSentences })}
            </span>
          </div>
          <div className="text-[0.68rem]" style={{ color: 'var(--color-text-secondary)' }}>{report.summary}</div>
          {report.findings.map((finding, index) => (
            <div key={index} className="text-[0.68rem] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              <span style={{ color: finding.severity === 'high' ? 'var(--color-error)' : finding.severity === 'warning' ? 'var(--color-warning-text)' : 'var(--color-text-muted)' }}>
                {t(`category.${finding.category}`)}
              </span>
              <span className="mx-1">·</span>
              {finding.description}
              <div className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                {t('source')}：{finding.sourceReference} → {t('generated')}：{finding.generatedReference}
              </div>
              <div className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{t('recommendation')}：{finding.recommendation}</div>
            </div>
          ))}
        </div>
      )}

      {saved.length > 0 && (
        <div className="space-y-1">
          <div className="text-[0.7rem] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('history')}</div>
          {saved.map(item => (
            <div key={item.id} className="flex items-center gap-2 text-[0.68rem] rounded-md px-2 py-1" style={{ border: '1px solid var(--color-border)' }}>
              <span style={{ color: riskColor(item.overallRisk) }}>{t(`risk.${item.overallRisk}`)}</span>
              <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text-muted)' }}>{item.generatedAt} · {item.summary}</span>
              <button className="p-1 rounded" style={{ color: 'var(--color-text-muted)' }} onClick={() => { void remove(item.id) }}><Trash2 size={11} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 一致性检查页签：事实库里的待确认与冲突清单 */
export function ConsistencyPanel() {
  const { t } = useTranslation('pages', { keyPrefix: 'booksOverview.consistency' })
  const [facts, setFacts] = useState<Array<{ id?: number; statement: string; status?: string; introducedAt: number; characters?: string[] }>>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setFacts(await canonStore.getFacts())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const pending = facts.filter(fact => !fact.status || fact.status === 'tentative')
  const conflicts = facts.filter(fact => fact.status === 'contradicted')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.7rem]" style={{ color: 'var(--color-text-secondary)' }}>
          {t('stats', { total: facts.length, pending: pending.length, conflicts: conflicts.length })}
        </span>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => { void reload() }}>
          <RefreshCw size={11} />{t('refresh')}
        </Button>
      </div>

      <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{t('hint')}</div>

      {pending.length === 0 && conflicts.length === 0 ? (
        <EmptyState icon={<Check size={20} />} message={t('empty')} opacity={0.55} />
      ) : (
        <div className="space-y-1.5">
          {[...conflicts, ...pending].map(fact => (
            <div key={fact.id} className="rounded-md px-3 py-2 text-[0.7rem] flex items-start gap-2" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" style={{ color: fact.status === 'contradicted' ? 'var(--color-error)' : 'var(--color-warning-text)' }} />
              <div className="flex-1 min-w-0">
                <div style={{ color: 'var(--color-text)' }}>{fact.statement}</div>
                <div className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                  {t('factMeta', { chapter: fact.introducedAt, status: fact.status ?? 'tentative' })}
                  {fact.characters?.length ? ` · ${fact.characters.join('、')}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
