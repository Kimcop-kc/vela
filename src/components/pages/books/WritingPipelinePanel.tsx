/**
 * 创作流水线面板（第四阶段）
 *
 * 与同目录的「正文生成」页签的区别：
 *   - 正文生成：一次性按节点跑完，改完存草稿（旧路径，保留不动）；
 *   - 本面板：六步流水线（理解任务 → 章节策划 → 场景设计 → 正文生成 → 章节自检 → 编辑修订），
 *     每段独立状态、可中断可恢复、可单段重试，并且**明确区分临时稿与作者确认的正文**。
 *
 * 所有模型调用都在 services/reconstruct/writing-pipeline 里，本组件只做编排与展示。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, Check, CheckCircle2, ChevronRight, FileText, Loader2, Play,
  RefreshCw, RotateCcw, Save, ShieldCheck, Sparkles, Trash2, Wand2, X,
} from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { NativeSelect } from '../../ui/NativeSelect'
import { Textarea } from '../../ui/Textarea'
import { EmptyState } from '../../ui/EmptyState'
import { toast } from '../../ui/Toast'
import { globalEventBus } from '../../../shared/event-bus'
import { canonStore } from '../../../services/narrative-consistency'
import {
  WRITING_MODES,
  buildChapterPlan,
  buildScenes,
  chapterStats,
  composeConfirmedText,
  composeWorkingText,
  confirmSegment,
  countText,
  createSegment,
  generateScene,
  listPipelineStates,
  loadChapterCanon,
  loadPipelineState,
  needsReplan,
  outlineFingerprint,
  removePipelineState,
  replanUnconfirmed,
  revertToConfirmed,
  runChapterSelfCheck,
  saveAsDraft,
  savePipelineState,
  transitionSegment,
  unfinishedSegments,
  type ChapterSelfCheck,
  type PipelineSegment,
  type PipelineState,
  type PipelineSummary,
  type RevisionSuggestion,
  type ScenePlan,
  type WritingMode,
} from '../../../services/reconstruct'
import { reconstructStore } from '../../../services/reconstruct'
import type { PlotOutlineRecord } from '../../../shared/reconstruct'

const STATUS_COLOR: Record<PipelineSegment['status'], string> = {
  pending: 'var(--color-text-muted)',
  generating: 'var(--color-warning-text)',
  generated: 'var(--color-text-secondary)',
  editing: 'var(--color-warning-text)',
  confirmed: 'var(--color-success-text)',
  failed: 'var(--color-error)',
}

export function WritingPipelinePanel() {
  const { t } = useTranslation('pages', { keyPrefix: 'booksOverview.pipeline' })

  const [outlines, setOutlines] = useState<PlotOutlineRecord[]>([])
  const [outlineId, setOutlineId] = useState<number | null>(null)
  const [chapterNumber, setChapterNumber] = useState(1)
  const [mode, setMode] = useState<WritingMode>('outline-expand')
  const [targetWords, setTargetWords] = useState(2000)
  const [userGuidance, setUserGuidance] = useState('')
  const [instruction, setInstruction] = useState('')

  const [state, setState] = useState<PipelineState | null>(null)
  const [resumable, setResumable] = useState<PipelineSummary[]>([])
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [selfCheck, setSelfCheck] = useState<ChapterSelfCheck | null>(null)

  const outline = useMemo(() => outlines.find(item => item.id === outlineId) ?? null, [outlines, outlineId])

  const reloadOutlines = useCallback(async () => {
    const list = await reconstructStore.listOutlines()
    setOutlines(list)
    setOutlineId(current => current ?? list[0]?.id ?? null)
  }, [])

  const refreshResumable = useCallback(async () => {
    setResumable(await listPipelineStates())
  }, [])

  useEffect(() => { void reloadOutlines() }, [reloadOutlines])
  useEffect(() => { void refreshResumable() }, [refreshResumable])
  useEffect(() => globalEventBus.on('RECONSTRUCT_UPDATED', () => { void reloadOutlines() }), [reloadOutlines])

  /** 新建一个任务：本地推导策划与场景，不调用模型 */
  const planFresh = useCallback((current: PlotOutlineRecord, chapter: number, words: number, nextMode: WritingMode) => {
    const beats = current.beats
    const plan = buildChapterPlan({ outline: current, beats, userGuidance })
    const scenes = buildScenes({ beats, totalWords: words })
    const next: PipelineState = {
      chapterNumber: chapter,
      outlineId: current.id,
      outlineFingerprint: outlineFingerprint(current),
      plan,
      scenes,
      // 1 个 beat = 1 个场景，段落序号与场景序号一一对应
      segments: scenes.map(createSegment),
      targetWords: words,
      mode: nextMode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setState(next)
    setSelfCheck(null)
    return next
  }, [userGuidance])

  // 换大纲 / 换章节时：优先恢复已落库的任务，没有才新建
  useEffect(() => {
    if (!outline) { setState(null); return }
    let cancelled = false
    void (async () => {
      const restored = await loadPipelineState(chapterNumber)
      if (cancelled) return
      if (restored && restored.outlineId === outline.id) {
        setState(restored)
        setMode(restored.mode)
        setTargetWords(restored.targetWords || targetWords)
        setSelfCheck(null)
        const pending = unfinishedSegments(restored.segments).length
        if (pending > 0) toast.info(t('resumed', { count: pending }))
        return
      }
      planFresh(outline, chapterNumber, targetWords, mode)
    })()
    return () => { cancelled = true }
    // 只在切换大纲 / 章节时重建，目标字数与模式改动不重置任务
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline?.id, chapterNumber])

  /** 落库（每步都存，断电只丢最后一步） */
  const persist = useCallback(async (next: PipelineState) => {
    setState(next)
    const result = await savePipelineState(next)
    if (!result.success) toast.error(t('saveStateFailed', { error: result.error ?? '' }))
    void refreshResumable()
  }, [refreshResumable, t])

  const stalePlan = state && outline ? needsReplan(state, outline) : false

  /** 大纲改了：重规划未确认部分（已确认的段落原样保留） */
  const replan = async () => {
    if (!state || !outline) return
    const result = replanUnconfirmed(state, outline, outline.beats)
    const keptBySequence = new Map(result.kept.map(segment => [segment.sequence, segment]))
    const segments = result.scenes.map(scene => keptBySequence.get(scene.sequence) ?? createSegment(scene))
    await persist({
      ...state,
      scenes: result.scenes,
      segments,
      outlineFingerprint: result.outlineFingerprint,
      plan: buildChapterPlan({ outline, beats: outline.beats, userGuidance }),
      updatedAt: new Date().toISOString(),
    })
    toast.success(t('replanned', { kept: result.kept.length, reset: result.resetSequences.length }))
  }

  /** 逐场景生成；已确认的段落一律跳过（不会被覆盖） */
  const generateAll = async () => {
    if (!state || !outline) return
    setRunning(true)
    setSelfCheck(null)
    try {
      const canon = await loadChapterCanon({ chapterNumber, chapterGoal: state.plan.goal, keywords: [] })
      let current = state
      for (const scene of current.scenes) {
        const existing = current.segments.find(segment => segment.sequence === scene.sequence)
        if (existing?.status === 'confirmed') continue
        setStatus(t('generatingScene', { sequence: scene.sequence, total: current.scenes.length }))
        // 先落库「生成中」，这样中途关程序也能看出是中断而不是没开始
        const started = current.segments.map(segment =>
          segment.sequence === scene.sequence ? transitionSegment(segment, 'generating') : segment,
        )
        current = { ...current, segments: started, updatedAt: new Date().toISOString() }
        setState(current)

        const result = await generateScene({
          mode: current.mode,
          plan: current.plan,
          scene,
          segments: current.segments,
          scenes: current.scenes,
          canonRendered: canon.rendered,
          ownNovel: '',
          style: '',
          userGuidance,
          instruction: instruction || undefined,
          targetWords: scene.targetWords,
        })
        current = {
          ...current,
          segments: current.segments.map(segment =>
            segment.sequence === scene.sequence ? result.segment : segment,
          ),
          updatedAt: new Date().toISOString(),
        }
        await persist(current)
        if (result.repetition) {
          toast.warning(t('repetitionWarning', { sequence: scene.sequence, length: result.repetition.length }))
        }
      }
      toast.success(t('generated'))
    } finally {
      setRunning(false)
      setStatus('')
    }
  }

  /** 单场景生成 / 重试 / 润色 / 扩写 / 重写 —— 都只动这一段 */
  const runScene = async (scene: ScenePlan, nextMode: WritingMode) => {
    if (!state || !outline) return
    setRunning(true)
    setStatus(t('generatingScene', { sequence: scene.sequence, total: state.scenes.length }))
    try {
      const canon = await loadChapterCanon({ chapterNumber, chapterGoal: state.plan.goal, keywords: [] })
      const target = state.segments.find(segment => segment.sequence === scene.sequence)
      if (!target) return
      // 已确认的段落必须先退回编辑态，避免误点直接顶掉正文
      const prepared = target.status === 'confirmed' ? transitionSegment(target, 'editing') : target
      const runningSegments = state.segments.map(segment =>
        segment.sequence === scene.sequence ? transitionSegment(prepared, 'generating') : segment,
      )
      setState({ ...state, segments: runningSegments })

      const result = await generateScene({
        mode: nextMode,
        plan: state.plan,
        scene,
        segments: runningSegments,
        scenes: state.scenes,
        canonRendered: canon.rendered,
        ownNovel: '',
        style: '',
        userGuidance,
        instruction: instruction || undefined,
        sourceText: nextMode === 'polish' || nextMode === 'expand' ? target.text || target.confirmedText : undefined,
        targetWords: scene.targetWords,
      })
      await persist({
        ...state,
        segments: runningSegments.map(segment =>
          segment.sequence === scene.sequence ? result.segment : segment,
        ),
        updatedAt: new Date().toISOString(),
      })
      if (result.error) toast.error(result.error)
      else if (result.repetition) toast.warning(t('repetitionWarning', { sequence: scene.sequence, length: result.repetition.length }))
      else toast.success(t('sceneDone', { sequence: scene.sequence }))
    } finally {
      setRunning(false)
      setStatus('')
    }
  }

  const applyToSegment = async (sequence: number, update: (segment: PipelineSegment) => PipelineSegment) => {
    if (!state) return
    await persist({
      ...state,
      segments: state.segments.map(segment => (segment.sequence === sequence ? update(segment) : segment)),
      updatedAt: new Date().toISOString(),
    })
  }

  const editSegmentText = (sequence: number, text: string) => {
    if (!state) return
    setState({
      ...state,
      segments: state.segments.map(segment =>
        segment.sequence === sequence ? { ...segment, text, stats: countText(text) } : segment,
      ),
    })
  }

  const runSelfCheck = async () => {
    if (!state) return
    setRunning(true)
    setStatus(t('checking'))
    try {
      const canon = await loadChapterCanon({ chapterNumber, chapterGoal: state.plan.goal, keywords: [] })
      const characters = (await canonStore.getAllCharacterStates().catch(() => [])).map(item => item.character)
      const result = await runChapterSelfCheck({
        chapterNumber,
        plan: state.plan,
        scenes: state.scenes,
        segments: state.segments,
        targetWords: state.targetWords,
        canon: canon.canon,
        mode: state.mode,
        polishSource: state.mode === 'polish' ? composeWorkingText(state.segments) : undefined,
        characters,
      })
      setSelfCheck(result)
      toast.success(t('checked'))
    } finally {
      setRunning(false)
      setStatus('')
    }
  }

  const saveDraft = async (kind: 'working' | 'confirmed') => {
    if (!state) return
    const content = kind === 'confirmed' ? composeConfirmedText(state.segments) : composeWorkingText(state.segments)
    if (!content.trim()) { toast.error(t('needContent')); return }
    const result = await saveAsDraft({ chapterNumber, content })
    if (!result.success) { toast.error(t('saveFailed', { error: result.error ?? '' })); return }
    toast.success(t('saved', { version: result.version ?? 0 }))
    globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts', 'all'] })
  }

  const discardTask = async () => {
    if (!state) return
    await removePipelineState(chapterNumber)
    await refreshResumable()
    if (outline) planFresh(outline, chapterNumber, targetWords, mode)
    toast.success(t('taskDiscarded'))
  }

  const stats = state ? chapterStats(state.segments) : null
  const confirmedCount = state ? state.segments.filter(segment => segment.status === 'confirmed').length : 0
  const unfinished = state ? unfinishedSegments(state.segments).length : 0

  return (
    <div className="space-y-3">
      {/* 工具条 —— 两个下拉都统一走 NativeSelect（此前是模块级 selectStyle 的手写原生 select），
          与同一行的 Input 高度、边框、聚焦环保持一致。
          组件默认 w-full，在 flex 工具条里要改回按内容宽度。 */}
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          className="w-auto"
          value={outlineId ?? ''}
          onChange={(e) => setOutlineId(Number(e.target.value) || null)}
        >
          {outlines.length === 0 && <option value="">{t('noOutline')}</option>}
          {outlines.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </NativeSelect>
        <Input
          type="number"
          value={chapterNumber}
          onChange={(e) => setChapterNumber(Number(e.target.value) || 1)}
          className="max-w-[90px]"
        />
        <NativeSelect
          className="w-auto"
          value={mode}
          onChange={(e) => setMode(e.target.value as WritingMode)}
        >
          {WRITING_MODES.map(item => <option key={item} value={item}>{t(`mode.${item}`)}</option>)}
        </NativeSelect>
        <Input
          type="number"
          value={targetWords}
          onChange={(e) => setTargetWords(Number(e.target.value) || 0)}
          className="max-w-[100px]"
        />
        <Button variant="outline" size="sm" disabled={running || !state} onClick={() => { void generateAll() }}>
          {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          {t('generateAll')}
        </Button>
        <Button variant="ghost" size="sm" disabled={running || !state} onClick={() => { void runSelfCheck() }}>
          <ShieldCheck size={11} />{t('selfCheck')}
        </Button>
        <Button variant="ghost" size="sm" disabled={!state} onClick={() => { void saveDraft('working') }}>
          <Save size={11} />{t('saveWorking')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={confirmedCount === 0}
          onClick={() => { void saveDraft('confirmed') }}
        >
          <CheckCircle2 size={11} />{t('saveConfirmed', { count: confirmedCount })}
        </Button>
        {status && <span className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{status}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={userGuidance}
          onChange={(e) => setUserGuidance(e.target.value)}
          placeholder={t('guidancePlaceholder')}
          className="flex-1 min-w-[220px]"
        />
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t('instructionPlaceholder')}
          className="flex-1 min-w-[220px]"
        />
      </div>

      {/* 可恢复任务 */}
      {resumable.length > 0 && (
        <details className="rounded-md px-2 py-1.5" style={{ border: '1px solid var(--color-border)' }}>
          <summary className="text-[0.68rem] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            {t('resumableTitle', { count: resumable.length })}
          </summary>
          <div className="mt-1 space-y-1">
            {resumable.map(item => (
              <div key={item.chapterNumber} className="flex items-center gap-2 text-[0.66rem]" style={{ color: 'var(--color-text-muted)' }}>
                <span>{t('resumableRow', {
                  chapter: item.chapterNumber,
                  unfinished: item.unfinished,
                  confirmed: item.confirmed,
                  total: item.total,
                })}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setChapterNumber(item.chapterNumber); if (item.outlineId) setOutlineId(item.outlineId) }}
                >
                  <ChevronRight size={11} />{t('resume')}
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}

      {!outline || !state ? (
        <EmptyState icon={<FileText size={20} />} message={t('noOutline')} opacity={0.55} />
      ) : (
        <>
          {/* 大纲改过 → 提示重规划（只重规划未确认部分） */}
          {stalePlan && (
            <div className="rounded-md px-3 py-2 flex flex-wrap items-center gap-2 text-[0.68rem]"
              style={{ border: '1px solid var(--color-warning-text)', backgroundColor: 'var(--color-panel)' }}>
              <AlertTriangle size={12} style={{ color: 'var(--color-warning-text)' }} />
              <span style={{ color: 'var(--color-text-secondary)' }}>{t('stalePlan')}</span>
              <Button variant="outline" size="sm" disabled={running} onClick={() => { void replan() }}>
                <RotateCcw size={11} />{t('replan')}
              </Button>
            </div>
          )}

          {/* 字数统计：口径分开显示 */}
          {stats && (
            <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
              {t('statsLine', {
                total: stats.totalChars,
                chinese: stats.chineseChars,
                noSpace: stats.withoutWhitespace,
                noTitle: stats.withoutTitle,
                target: state.targetWords,
              })}
              <span className="ml-2">{t('progressLine', {
                confirmed: confirmedCount,
                unfinished,
                total: state.segments.length,
              })}</span>
            </div>
          )}

          {/* 第一步 / 第二步：章节策划 */}
          <details className="rounded-md px-2 py-1.5" style={{ border: '1px solid var(--color-border)' }}>
            <summary className="text-[0.68rem] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
              {t('planTitle')}
            </summary>
            <div className="mt-1 space-y-1 text-[0.66rem]" style={{ color: 'var(--color-text-muted)' }}>
              <div><span style={{ color: 'var(--color-text)' }}>{t('plan.goal')}：</span>{state.plan.goal}</div>
              <div><span style={{ color: 'var(--color-text)' }}>{t('plan.opening')}：</span>{state.plan.openingState}</div>
              <div><span style={{ color: 'var(--color-text)' }}>{t('plan.conflict')}：</span>{state.plan.centralConflict || t('none')}</div>
              <div><span style={{ color: 'var(--color-text)' }}>{t('plan.ending')}：</span>{state.plan.endingChange}</div>
              <div><span style={{ color: 'var(--color-text)' }}>{t('plan.hook')}：</span>{state.plan.endingRequirement || t('none')}</div>
              {state.plan.drives.length > 0 && (
                <div>
                  <span style={{ color: 'var(--color-text)' }}>{t('plan.drives')}：</span>
                  {state.plan.drives.map(drive => `${drive.character}→${drive.goal}（阻碍：${drive.obstacle}）`).join('；')}
                </div>
              )}
              <div>
                <span style={{ color: 'var(--color-text)' }}>{t('plan.eventOrder')}：</span>
                {state.plan.eventOrder.join(' → ')}
              </div>
              {state.plan.contradictions.map((item, index) => (
                <div key={index} style={{ color: 'var(--color-warning-text)' }}>
                  <AlertTriangle size={10} className="inline mr-1" />{item}
                </div>
              ))}
            </div>
          </details>

          {/* 分段列表：场景设计 + 状态 + 操作 */}
          <div className="space-y-2">
            {state.scenes.map(scene => {
              const segment = state.segments.find(item => item.sequence === scene.sequence)
              if (!segment) return null
              return (
                <div key={scene.sequence} className="rounded-md px-3 py-2 space-y-1.5"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.7rem] font-mono tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                      {scene.sequence}
                    </span>
                    <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{scene.beatTitle}</span>
                    <span className="text-[0.65rem] px-1.5 py-0.5 rounded" style={{ color: STATUS_COLOR[segment.status], border: `1px solid ${STATUS_COLOR[segment.status]}` }}>
                      {t(`status.${segment.status}`)}
                    </span>
                    <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                      {t('sceneWords', { target: scene.targetWords, actual: countText(segment.text).chineseChars })}
                    </span>
                    {segment.inputDigest?.precedingTruncated && (
                      <span className="text-[0.62rem]" style={{ color: 'var(--color-warning-text)' }}>{t('precedingTruncated')}</span>
                    )}
                  </div>

                  {/* 场景设计 */}
                  <div className="text-[0.64rem] space-y-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    <div>{t('scene.purpose')}：{scene.purpose}</div>
                    <div>
                      {t('scene.where')}：{scene.time || t('unset')} · {scene.location || t('unset')}
                      {scene.sceneInferred && <span className="ml-1" style={{ color: 'var(--color-warning-text)' }}>{t('scene.inferred')}</span>}
                    </div>
                    {scene.conflict && <div>{t('scene.conflict')}：{scene.conflict}</div>}
                    {scene.reveal && <div>{t('scene.reveal')}：{scene.reveal}</div>}
                    {scene.turn && <div>{t('scene.turn')}：{scene.turn}</div>}
                    {scene.openQuestion && <div>{t('scene.openQuestion')}：{scene.openQuestion}</div>}
                  </div>

                  {segment.error && (
                    <div className="text-[0.68rem]" style={{ color: 'var(--color-error)' }}>{segment.error}</div>
                  )}

                  <Textarea
                    rows={6}
                    value={segment.text}
                    placeholder={t('segmentPlaceholder')}
                    onChange={(e) => editSegmentText(scene.sequence, e.target.value)}
                  />

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button variant="ghost" size="sm" disabled={running}
                      onClick={() => { void runScene(scene, state.mode) }}>
                      {segment.status === 'failed' ? <RotateCcw size={11} /> : <Play size={11} />}
                      {segment.status === 'failed' ? t('retry') : segment.text ? t('regenerate') : t('generate')}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={running || !segment.text}
                      onClick={() => { void runScene(scene, 'polish') }}>
                      <Wand2 size={11} />{t('polish')}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={running || !segment.text}
                      onClick={() => { void runScene(scene, 'expand') }}>
                      <Sparkles size={11} />{t('expand')}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={running || !segment.text}
                      onClick={() => { void runScene(scene, 'rewrite') }}>
                      <RefreshCw size={11} />{t('rewrite')}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!segment.text || segment.status === 'confirmed'}
                      onClick={() => { void applyToSegment(scene.sequence, confirmSegment) }}>
                      <Check size={11} />{t('confirm')}
                    </Button>
                    {segment.confirmedText && (
                      <Button variant="ghost" size="sm"
                        onClick={() => { void applyToSegment(scene.sequence, revertToConfirmed) }}>
                        <X size={11} />{t('revert')}
                      </Button>
                    )}
                    {segment.confirmedText && (
                      <span className="text-[0.62rem]" style={{ color: 'var(--color-success-text)' }}>
                        {t('hasConfirmed', { count: countText(segment.confirmedText).chineseChars })}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" disabled={running} onClick={() => { void discardTask() }}>
              <Trash2 size={11} />{t('discardTask')}
            </Button>
          </div>

          {/* 第五步 / 第六步：自检与修订建议 */}
          {selfCheck && (
            <div className="rounded-md px-3 py-2 space-y-1.5"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
              <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                <ShieldCheck size={12} />{t('selfCheckTitle')}
                <span style={{ color: selfCheck.needsAttention ? 'var(--color-warning-text)' : 'var(--color-success-text)' }}>
                  {selfCheck.needsAttention ? t('needsAttention') : t('allClear')}
                </span>
              </div>
              <div className="text-[0.68rem]" style={{ color: 'var(--color-text-secondary)' }}>{selfCheck.summary}</div>

              {selfCheck.goals.map(goal => (
                <div key={goal.key} className="text-[0.65rem]"
                  style={{ color: goal.ok ? 'var(--color-text-muted)' : 'var(--color-warning-text)' }}>
                  {goal.ok ? '✓' : '✗'} {t(`goalCheck.${goal.key}`)}：{goal.detail}
                </div>
              ))}

              {selfCheck.polishDrift && (
                <div className="text-[0.65rem]"
                  style={{ color: selfCheck.polishDrift.ok ? 'var(--color-text-muted)' : 'var(--color-warning-text)' }}>
                  {t('polishDrift')}：{selfCheck.polishDrift.note}
                </div>
              )}

              {selfCheck.consistency.issues.slice(0, 8).map((issue, index) => (
                <div key={index} className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>· {issue.issue}</div>
              ))}

              {selfCheck.revisions.length > 0 && (
                <div className="space-y-1 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <div className="text-[0.68rem]" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('revisionsTitle', { count: selfCheck.revisions.length })}
                  </div>
                  {selfCheck.revisions.map((suggestion: RevisionSuggestion, index) => (
                    <div key={index} className="text-[0.65rem] space-y-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      <div style={{ color: 'var(--color-text-secondary)' }}>
                        {suggestion.sequence > 0 ? t('segmentLabel', { sequence: suggestion.sequence }) : t('wholeChapter')}：{suggestion.reason}
                      </div>
                      <div>{t('suggestion')}：{suggestion.suggestion}</div>
                      {suggestion.excerpt && (
                        <div className="font-mono text-[0.62rem] opacity-80">…{suggestion.excerpt}…</div>
                      )}
                      {suggestion.sequence > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={running}
                          onClick={() => {
                            const scene = state.scenes.find(item => item.sequence === suggestion.sequence)
                            if (!scene) return
                            setInstruction(suggestion.suggestion)
                            void runScene(scene, 'rewrite')
                          }}
                        >
                          <Check size={11} />{t('acceptSuggestion')}
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="text-[0.62rem]" style={{ color: 'var(--color-text-muted)' }}>{t('acceptHint')}</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
