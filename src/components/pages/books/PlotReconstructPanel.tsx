/** 剧情重构页签：选分析结论 + 填创作目标 → 生成原创大纲 → 逐节点编辑/调序/单节点重生成/保存。 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Loader2, Play, Plus, Save, Trash2, Wand2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { EmptyState } from '../../ui/EmptyState'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { globalEventBus } from '../../../shared/event-bus'
import {
  TECHNIQUE_KEYS,
  TECHNIQUE_LABELS,
  reconstructPlotOutline,
  reconstructStore,
  regenerateBeat,
  type BookAnalysisRecord,
  type PlotBeat,
  type PlotOutlineRecord,
  type PlotOutlineSource,
  type TechniqueKey,
} from '../../../services/reconstruct'
import type { BookRecord } from '../../../shared/ipc-channels'

interface Props {
  books: BookRecord[]
}

const emptyBeat = (sequence: number): PlotBeat => ({
  sequence, title: `节点 ${sequence}`, event: '', protagonistAction: '', conflict: '', consequence: '', characterChange: '', hook: '',
})

export default function PlotReconstructPanel({ books }: Props) {
  const { t } = useTranslation('pages', { keyPrefix: 'booksOverview.reconstruct' })
  const [outlines, setOutlines] = useState<PlotOutlineRecord[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [draft, setDraft] = useState<PlotOutlineRecord | null>(null)
  const [analyses, setAnalyses] = useState<BookAnalysisRecord[]>([])
  const [picked, setPicked] = useState<number[]>([])
  const [techniques, setTechniques] = useState<TechniqueKey[]>(['conflictSetup', 'cliffhanger', 'pacing'])
  const [techniquesOnly, setTechniquesOnly] = useState(false)
  const [form, setForm] = useState({ title: '', goal: '', stage: '', expectedConflict: '', exclusions: '', targetChapters: 10, wordsPerChapter: 3000 })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [beatInstruction, setBeatInstruction] = useState<Record<number, string>>({})

  const reload = useCallback(async () => {
    const list = await reconstructStore.listOutlines()
    setOutlines(list)
    setActiveId(current => current ?? list[0]?.id ?? null)
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const unsubscribe = globalEventBus.on('RECONSTRUCT_UPDATED', () => { void reload() })
    return unsubscribe
  }, [reload])

  // 载入参考书的分析结论（只拿有结果的，失败记录不能当参考材料）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const all: BookAnalysisRecord[] = []
      for (const book of books) {
        const list = await reconstructStore.listAnalyses(book.id)
        all.push(...list.filter(record => record.status === 'done' && record.result))
      }
      if (!cancelled) setAnalyses(all)
    })()
    return () => { cancelled = true }
  }, [books])

  useEffect(() => {
    setDraft(outlines.find(outline => outline.id === activeId) ?? null)
  }, [activeId, outlines])

  const pickSources = (): PlotOutlineSource[] => analyses
    .filter(record => picked.includes(record.id))
    .map(record => ({
      analysisId: record.id, bookId: record.bookId, bookName: record.bookName, chapterNumber: record.chapterNumber,
    }))

  const generate = async () => {
    if (picked.length === 0) { toast.error(t('needSource')); return }
    setBusy(true)
    setStatus(t('generating'))
    try {
      const result = await reconstructPlotOutline({
        input: {
          sources: pickSources(),
          techniques,
          goal: form.goal,
          stage: form.stage,
          expectedConflict: form.expectedConflict,
          exclusions: form.exclusions,
          targetChapters: Math.max(1, Math.min(60, form.targetChapters || 10)),
          wordsPerChapter: Math.max(0, form.wordsPerChapter || 3000),
          title: form.title,
        },
        techniquesOnly,
      })
      if (!result.saved || !result.outline) {
        toast.error(t('generateFailed', { error: result.error ?? '' }))
        if (result.warnings.length) setStatus(result.warnings.join('；'))
        return
      }
      toast.success(t('generated', { beats: result.outline.beats.length }))
      setStatus(result.warnings.length ? result.warnings.join('；') : '')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const updateBeat = (index: number, patch: Partial<PlotBeat>) => {
    setDraft(current => current ? { ...current, beats: current.beats.map((beat, i) => i === index ? { ...beat, ...patch } : beat) } : current)
  }

  const moveBeat = (index: number, delta: number) => {
    setDraft(current => {
      if (!current) return current
      const target = index + delta
      if (target < 0 || target >= current.beats.length) return current
      const beats = [...current.beats]
      const [moved] = beats.splice(index, 1)
      beats.splice(target, 0, moved)
      return { ...current, beats: beats.map((beat, i) => ({ ...beat, sequence: i + 1 })) }
    })
  }

  const removeBeat = (index: number) => {
    setDraft(current => current
      ? { ...current, beats: current.beats.filter((_, i) => i !== index).map((beat, i) => ({ ...beat, sequence: i + 1 })) }
      : current)
  }

  const addBeat = () => {
    setDraft(current => current ? { ...current, beats: [...current.beats, emptyBeat(current.beats.length + 1)] } : current)
  }

  const saveDraft = async () => {
    if (!draft) return
    const id = await reconstructStore.saveOutline({ ...draft, id: draft.id })
    if (!id) { toast.error(t('saveFailed')); return }
    toast.success(t('saved'))
    await reload()
  }

  const regenerateOneBeat = async (index: number) => {
    if (!draft) return
    setBusy(true)
    setStatus(t('regeneratingBeat'))
    try {
      const result = await regenerateBeat({
        outline: draft,
        beatIndex: index,
        instruction: beatInstruction[draft.beats[index].sequence],
        techniquesOnly,
      })
      if (!result.saved) { toast.error(t('generateFailed', { error: result.error ?? '' })); return }
      toast.success(t('beatRegenerated'))
      await reload()
    } finally {
      setBusy(false)
      setStatus('')
    }
  }

  const removeOutline = async (id: number) => {
    const ok = await confirm(t('removeConfirm'), { danger: true })
    if (!ok) return
    if (await reconstructStore.removeOutline(id)) {
      toast.success(t('removed'))
      setActiveId(null)
      await reload()
    }
  }

  return (
    <div className="space-y-4">
      {/* 来源与条件 */}
      <section className="space-y-2">
        <div className="text-[0.7rem] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('sources')}</div>
        {analyses.length === 0 ? (
          <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{t('noSources')}</div>
        ) : (
          <div className="rounded-md max-h-[180px] overflow-y-auto" style={{ border: '1px solid var(--color-border)' }}>
            {analyses.map((record, index) => (
              <label
                key={record.id}
                className="flex items-center gap-2 px-2 py-1 text-[0.68rem] cursor-pointer"
                style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}
              >
                <input
                  type="checkbox"
                  checked={picked.includes(record.id)}
                  onChange={() => setPicked(prev => prev.includes(record.id) ? prev.filter(id => id !== record.id) : [...prev, record.id])}
                />
                <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }}>
                  {record.bookName} · 第 {record.chapterNumber} 章 {record.chapterTitle}
                </span>
                <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                  {record.result?.summary?.slice(0, 24) ?? ''}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {TECHNIQUE_KEYS.map(key => {
            const active = techniques.includes(key)
            return (
              <button
                key={key}
                onClick={() => setTechniques(prev => active ? prev.filter(item => item !== key) : [...prev, key])}
                className="px-2 py-0.5 rounded text-[0.68rem]"
                style={{
                  border: '1px solid var(--color-border)',
                  backgroundColor: active ? 'var(--color-hover)' : 'transparent',
                  color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                }}
              >
                {TECHNIQUE_LABELS[key]}
              </button>
            )
          })}
          <label className="flex items-center gap-1.5 text-[0.68rem] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={techniquesOnly} onChange={(e) => setTechniquesOnly(e.target.checked)} />
            {t('techniquesOnly')}
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Input placeholder={t('goal')} value={form.goal} onChange={(e) => setForm(f => ({ ...f, goal: e.target.value }))} />
          <Input placeholder={t('stage')} value={form.stage} onChange={(e) => setForm(f => ({ ...f, stage: e.target.value }))} />
          <Input placeholder={t('expectedConflict')} value={form.expectedConflict} onChange={(e) => setForm(f => ({ ...f, expectedConflict: e.target.value }))} />
          <Input placeholder={t('exclusions')} value={form.exclusions} onChange={(e) => setForm(f => ({ ...f, exclusions: e.target.value }))} />
          <Input placeholder={t('title')} value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} />
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={form.targetChapters}
              onChange={(e) => setForm(f => ({ ...f, targetChapters: Number(e.target.value) || 0 }))}
            />
            <Input
              type="number"
              value={form.wordsPerChapter}
              onChange={(e) => setForm(f => ({ ...f, wordsPerChapter: Number(e.target.value) || 0 }))}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { void generate() }}>
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
            {t('generate')}
          </Button>
          {status && <span className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{status}</span>}
        </div>
      </section>

      {/* 已保存的大纲列表 */}
      {outlines.length > 0 && (
        <section className="flex flex-wrap items-center gap-1.5">
          {outlines.map(outline => (
            <button
              key={outline.id}
              onClick={() => setActiveId(outline.id)}
              className="px-2 py-0.5 rounded text-[0.68rem]"
              style={{
                border: '1px solid var(--color-border)',
                backgroundColor: outline.id === activeId ? 'var(--color-hover)' : 'transparent',
                color: outline.id === activeId ? 'var(--color-text)' : 'var(--color-text-muted)',
              }}
            >
              {outline.title}（{outline.beats.length} 节）
            </button>
          ))}
        </section>
      )}

      {!draft ? (
        <EmptyState icon={<Wand2 size={20} />} message={t('noOutline')} opacity={0.55}>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('noOutlineHint')}</span>
        </EmptyState>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="max-w-[280px]" />
            <Button size="sm" onClick={() => { void saveDraft() }}>
              <Save size={11} />{t('save')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { void removeOutline(draft.id) }}>
              <Trash2 size={11} />{t('remove')}
            </Button>
            {draft.originalityNotes && (
              <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{t('originalityHint')}：{draft.originalityNotes.slice(0, 80)}</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Textarea rows={2} placeholder={t('premise')} value={draft.premise} onChange={(e) => setDraft({ ...draft, premise: e.target.value })} />
            <Textarea rows={2} placeholder={t('protagonistGoal')} value={draft.protagonistGoal} onChange={(e) => setDraft({ ...draft, protagonistGoal: e.target.value })} />
            <Textarea rows={2} placeholder={t('centralConflict')} value={draft.centralConflict} onChange={(e) => setDraft({ ...draft, centralConflict: e.target.value })} />
            <Textarea rows={2} placeholder={t('characterChanges')} value={draft.characterChanges} onChange={(e) => setDraft({ ...draft, characterChanges: e.target.value })} />
            <Textarea rows={2} placeholder={t('foreshadowing')} value={draft.foreshadowing} onChange={(e) => setDraft({ ...draft, foreshadowing: e.target.value })} />
            <Textarea rows={2} placeholder={t('continuityNotes')} value={draft.continuityNotes} onChange={(e) => setDraft({ ...draft, continuityNotes: e.target.value })} />
          </div>

          <div className="space-y-2">
            {draft.beats.map((beat, index) => (
              <div key={`${beat.sequence}-${index}`} className="rounded-md px-3 py-2 space-y-1.5" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[0.7rem] font-mono tabular-nums flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{beat.sequence}</span>
                  <Input value={beat.title} onChange={(e) => updateBeat(index, { title: e.target.value })} className="max-w-[240px]" />
                  <button className="p-1 rounded" style={{ color: 'var(--color-text-muted)' }} onClick={() => moveBeat(index, -1)}><ArrowUp size={11} /></button>
                  <button className="p-1 rounded" style={{ color: 'var(--color-text-muted)' }} onClick={() => moveBeat(index, 1)}><ArrowDown size={11} /></button>
                  <button className="p-1 rounded" style={{ color: 'var(--color-text-muted)' }} title={t('removeBeat')} onClick={() => removeBeat(index)}><Trash2 size={11} /></button>
                </div>
                <Textarea rows={2} placeholder={t('event')} value={beat.event} onChange={(e) => updateBeat(index, { event: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder={t('protagonistAction')} value={beat.protagonistAction} onChange={(e) => updateBeat(index, { protagonistAction: e.target.value })} />
                  <Input placeholder={t('conflict')} value={beat.conflict} onChange={(e) => updateBeat(index, { conflict: e.target.value })} />
                  <Input placeholder={t('consequence')} value={beat.consequence} onChange={(e) => updateBeat(index, { consequence: e.target.value })} />
                  <Input placeholder={t('characterChange')} value={beat.characterChange} onChange={(e) => updateBeat(index, { characterChange: e.target.value })} />
                </div>
                <Input placeholder={t('hook')} value={beat.hook} onChange={(e) => updateBeat(index, { hook: e.target.value })} />
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder={t('beatInstruction')}
                    value={beatInstruction[beat.sequence] ?? ''}
                    onChange={(e) => setBeatInstruction(prev => ({ ...prev, [beat.sequence]: e.target.value }))}
                    className="max-w-[320px]"
                  />
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void regenerateOneBeat(index) }}>
                    <Play size={11} />{t('regenerateBeat')}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={addBeat}>
            <Plus size={11} />{t('addBeat')}
          </Button>
        </section>
      )}
    </div>
  )
}
