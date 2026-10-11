import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Archive, BookMarked, Check, ChevronDown, ChevronRight, Clock3, GitBranch, History, Lightbulb, MapPin, Mountain, Plus, RefreshCw, RotateCcw, Search, Undo2, Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore, type StoryBibleSection } from '../../stores/layout-store'
import { useCharacterStore } from '../../stores/character-store'
import { ipc } from '../../services/ipc-client'
import { toast } from '../ui/Toast'
import { canonStore } from '../../services/narrative-consistency'
import type { CharacterStateSnapshot, ChapterSummary, Fact, ItemEvent, Location, PlotLine, Realm, TimelineEvent } from '../../services/narrative-consistency'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { globalEventBus } from '../../shared/event-bus'

interface BibleData {
  timeline: TimelineEvent[]
  plots: PlotLine[]
  facts: Fact[]
  summaries: ChapterSummary[]
  states: CharacterStateSnapshot[]
  blueprints: BlueprintData[]
}

const EMPTY_DATA: BibleData = { timeline: [], plots: [], facts: [], summaries: [], states: [], blueprints: [] }

function includesQuery(query: string, ...values: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return values.some(value => (value ?? '').toLowerCase().includes(q))
}

/**
 * 事实的「确认」与「记忆状态」是两件事：
 * confirmedAt 只表示作者是否过目，status 才影响注入措辞。
 */
const isPendingFact = (fact: Fact) => !fact.confirmedAt
const isConflictFact = (fact: Fact) => (fact.status ?? 'active') === 'contradicted'
const isConfirmedFact = (fact: Fact) => !!fact.confirmedAt && !isConflictFact(fact) && (fact.status ?? 'active') !== 'outdated'

function sectionTitle(section: StoryBibleSection, t: (key: string) => string): string {
  const labels: Record<StoryBibleSection, string> = {
    overview: t('storyBibleOverview.sections.overview'),
    characters: t('storyBibleOverview.sections.characters'),
    timeline: t('storyBibleOverview.sections.timeline'),
    plots: t('storyBibleOverview.sections.plots'),
    facts: t('storyBibleOverview.sections.facts'),
    realms: t('storyBibleOverview.sections.realms'),
    locations: t('storyBibleOverview.sections.locations'),
  }
  return labels[section]
}

export default function StoryBibleOverview() {
  const { t } = useTranslation('pages')
  const project = useProjectStore(s => s.currentProject)
  const projectPath = project?.path
  const totalChapters = project?.novelConfig.totalChapters
  const characters = useCharacterStore(s => s.characters)
  const section = useLayoutStore(s => s.storyBibleSection)
  const setSection = useLayoutStore(s => s.setStoryBibleSection)
  const [data, setData] = useState<BibleData>(EMPTY_DATA)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  /** 事实筛选：全部 / 待确认（AI 提取但作者没看过）/ 冲突 / 已确认 */
  const [factFilter, setFactFilter] = useState<'all' | 'pending' | 'conflict' | 'confirmed'>('all')
  const [busyFactId, setBusyFactId] = useState<number | null>(null)
  const [historyFactId, setHistoryFactId] = useState<number | null>(null)
  const [factHistory, setFactHistory] = useState<Array<{ id: number; action: string; at: string }>>([])
  /** 伏笔「预计回收阶段」的编辑草稿（按剧情线 id） */
  const [plotPlanDraft, setPlotPlanDraft] = useState<Record<number, string>>({})
  /** 物品流转台账 */
  const [itemLedgerOpen, setItemLedgerOpen] = useState(false)
  const [itemEvents, setItemEvents] = useState<ItemEvent[]>([])
  const [itemDraft, setItemDraft] = useState({ item: '', action: 'obtained' as ItemEvent['action'], chapter: '', actor: '', note: '' })
  /** 境界阶梯（阶数从低到高） */
  const [realms, setRealms] = useState<Realm[]>([])
  const [realmDraft, setRealmDraft] = useState({ name: '', rankOrder: '' })
  /** 地点与空间关系 */
  const [locations, setLocations] = useState<Location[]>([])
  const [locationDraft, setLocationDraft] = useState({ name: '', region: '' })

  const load = useCallback(async () => {
    if (!projectPath) {
      setData(EMPTY_DATA)
      return
    }
    setLoading(true)
    try {
      const [timeline, plots, facts, summaries, states, blueprints] = await Promise.all([
        canonStore.getTimeline(totalChapters || Number.MAX_SAFE_INTEGER),
        canonStore.getPlotLines(),
        canonStore.getFacts(),
        canonStore.getRecentSummaries(30),
        canonStore.getAllCharacterStates(),
        ipc.invoke('db:blueprint-get-all', projectPath),
      ])
      setData({ timeline, plots, facts, summaries, states, blueprints: blueprints ?? [] })
      setRealms(await canonStore.getRealms())
      setLocations(await canonStore.getLocations())
    } finally {
      setLoading(false)
    }
  }, [projectPath, totalChapters])

  useEffect(() => { void load() }, [load])
  useEffect(() => globalEventBus.on('REFRESH_RESOURCE', () => { void load() }), [load])
  useEffect(() => globalEventBus.on('STORY_REVISED', () => { void load() }), [load])

  const sections: Array<{ id: StoryBibleSection; label: string; icon: typeof BookMarked }> = [
    { id: 'overview', label: t('storyBibleOverview.sections.overview'), icon: BookMarked },
    { id: 'characters', label: t('storyBibleOverview.sections.characters'), icon: Users },
    { id: 'timeline', label: t('storyBibleOverview.sections.timeline'), icon: Clock3 },
    { id: 'plots', label: t('storyBibleOverview.sections.plots'), icon: GitBranch },
    { id: 'facts', label: t('storyBibleOverview.sections.facts'), icon: Lightbulb },
    { id: 'realms', label: t('storyBibleOverview.sections.realms'), icon: Mountain },
    { id: 'locations', label: t('storyBibleOverview.sections.locations'), icon: MapPin },
  ]

  const activePlots = data.plots.filter(plot => plot.status === 'active')

  const pendingFactCount = useMemo(() => data.facts.filter(isPendingFact).length, [data.facts])
  const conflictFactCount = useMemo(() => data.facts.filter(isConflictFact).length, [data.facts])
  const confirmedFactCount = useMemo(() => data.facts.filter(isConfirmedFact).length, [data.facts])

  const visibleFacts = useMemo(() => data.facts.filter(fact => {
    if (!includesQuery(query, fact.statement, fact.evidence)) return false
    if (factFilter === 'pending') return isPendingFact(fact)
    if (factFilter === 'conflict') return isConflictFact(fact)
    if (factFilter === 'confirmed') return isConfirmedFact(fact)
    return true
  }), [data.facts, query, factFilter])

  const factsByCategory = useMemo(() => {
    const groups = new Map<Fact['category'], Fact[]>()
    for (const fact of visibleFacts) {
      groups.set(fact.category, [...(groups.get(fact.category) ?? []), fact])
    }
    return groups
  }, [visibleFacts])

  /** 作者确认 / 取消确认；确认 tentative 事实时主进程会顺带提升为 active */
  const handleConfirmFacts = useCallback(async (ids: number[], confirmed: boolean) => {
    const changed = await canonStore.confirmFacts(ids, confirmed)
    if (changed > 0) {
      toast.success(t('storyBibleOverview.factsConfirmedToast', { count: changed }))
      await load()
    }
  }, [load, t])

  /** 标记记忆状态（争议 / 废弃 / 恢复有效） */
  const handleFactStatus = useCallback(async (id: number, status: 'active' | 'outdated' | 'contradicted' | 'tentative') => {
    setBusyFactId(id)
    try {
      const ok = await canonStore.markFactStatus(id, status)
      if (ok) await load()
    } finally {
      setBusyFactId(null)
    }
  }, [load])

  /** 展开 / 收起某条事实的变更历史 */
  const handleToggleHistory = useCallback(async (id: number) => {
    if (historyFactId === id) {
      setHistoryFactId(null)
      setFactHistory([])
      return
    }
    setHistoryFactId(id)
    setFactHistory(await canonStore.getFactHistory(id))
  }, [historyFactId])

  /** 把一条线索标记为剧情线或伏笔 */
  const handlePlotKind = useCallback(async (id: number, kind: 'plot' | 'foreshadow') => {
    if (await canonStore.updatePlotLineMeta(id, { kind })) await load()
  }, [load])

  /** 保存伏笔的预计回收阶段 */
  const handlePlotPlan = useCallback(async (id: number, plannedResolveAt: string) => {
    const next = plannedResolveAt.trim()
    const current = data.plots.find(plot => plot.id === id)?.plannedResolveAt ?? ''
    if (next === current) return
    if (await canonStore.updatePlotLineMeta(id, { plannedResolveAt: next })) await load()
  }, [data.plots, load])

  /** 打开 / 收起物品流转台账（打开时拉一次记录） */
  const handleToggleItemLedger = useCallback(async () => {
    const next = !itemLedgerOpen
    setItemLedgerOpen(next)
    if (next) setItemEvents(await canonStore.getItemEvents())
  }, [itemLedgerOpen])

  /** 登记一条物品流转 */
  const handleAddItemEvent = useCallback(async () => {
    const item = itemDraft.item.trim()
    if (!item) return
    const chapter = Number.parseInt(itemDraft.chapter, 10)
    const id = await canonStore.addItemEvent({
      item,
      action: itemDraft.action,
      chapterNumber: Number.isSafeInteger(chapter) ? chapter : 0,
      actor: itemDraft.actor.trim(),
      note: itemDraft.note.trim(),
    })
    if (id) {
      setItemDraft({ item: '', action: 'obtained', chapter: '', actor: '', note: '' })
      setItemEvents(await canonStore.getItemEvents())
    }
  }, [itemDraft])

  /** 删除一条物品流转记录 */
  const handleRemoveItemEvent = useCallback(async (id: number) => {
    if (await canonStore.removeItemEvent(id)) setItemEvents(await canonStore.getItemEvents())
  }, [])

  /** 保存一阶境界（改完即存：只在内容真的变了时写库） */
  const handleSaveRealm = useCallback(async (realm: Realm, patch: Partial<Realm>) => {
    const next: Realm = { ...realm, ...patch }
    if (!next.name.trim()) return
    const changed = (Object.keys(patch) as Array<keyof Realm>).some(key => (realm[key] ?? '') !== (next[key] ?? ''))
    if (!changed) return
    if (await canonStore.upsertRealm(next)) setRealms(await canonStore.getRealms())
  }, [])

  /** 新增一阶境界 */
  const handleAddRealm = useCallback(async () => {
    const name = realmDraft.name.trim()
    if (!name) return
    const rankOrder = Number.parseInt(realmDraft.rankOrder, 10)
    if (await canonStore.upsertRealm({
      name,
      rankOrder: Number.isSafeInteger(rankOrder) ? rankOrder : realms.length + 1,
      abilities: '', limits: '', breakthrough: '',
    })) {
      setRealmDraft({ name: '', rankOrder: '' })
      setRealms(await canonStore.getRealms())
    }
  }, [realmDraft, realms.length])

  /** 删除一阶境界 */
  const handleRemoveRealm = useCallback(async (id: number) => {
    if (await canonStore.removeRealm(id)) setRealms(await canonStore.getRealms())
  }, [])

  /** 保存一个地点（改完即存：只在内容真的变了时写库） */
  const handleSaveLocation = useCallback(async (location: Location, patch: Partial<Location>) => {
    const next: Location = { ...location, ...patch }
    if (!next.name.trim()) return
    const changed = (Object.keys(patch) as Array<keyof Location>).some(key => (location[key] ?? '') !== (next[key] ?? ''))
    if (!changed) return
    if (await canonStore.upsertLocation(next)) setLocations(await canonStore.getLocations())
  }, [])

  /** 新增一个地点 */
  const handleAddLocation = useCallback(async () => {
    const name = locationDraft.name.trim()
    if (!name) return
    if (await canonStore.upsertLocation({ name, region: locationDraft.region.trim() })) {
      setLocationDraft({ name: '', region: '' })
      setLocations(await canonStore.getLocations())
    }
  }, [locationDraft])

  /** 删除一个地点 */
  const handleRemoveLocation = useCallback(async (id: number) => {
    if (await canonStore.removeLocation(id)) setLocations(await canonStore.getLocations())
  }, [])

  const filteredCharacters = useMemo(
    () => characters.filter(character => includesQuery(query, character.name, character.role, character.background, character.motivation, character.arc)),
    [characters, query],
  )
  const filteredTimeline = useMemo(
    () => data.timeline.filter(event => includesQuery(query, event.summary, event.location, event.impact, ...event.characters)),
    [data.timeline, query],
  )
  const filteredPlots = useMemo(
    () => data.plots.filter(plot => includesQuery(query, plot.name, plot.currentState, plot.description, ...plot.characters)),
    [data.plots, query],
  )

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState icon={<BookMarked size={22} />} message={t('storyBibleOverview.openProjectFirst')} opacity={0.55} />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      <header
        className="flex items-center justify-between gap-3 px-4 h-11 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-editor-bg)' }}
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[0.82rem] font-semibold truncate" style={{ color: 'var(--color-text)' }}>{project.name}</span>
          <span className="text-[0.68rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            {sectionTitle(section, t)}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {t('storyBibleOverview.refresh')}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[960px] mx-auto px-6 py-5">
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div className="flex items-center gap-1 rounded-md p-0.5" style={{ border: '1px solid var(--color-border)' }}>
              {sections.map(item => {
                const Icon = item.icon
                const active = item.id === section
                return (
                  <button
                    key={item.id}
                    onClick={() => setSection(item.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors"
                    style={{
                      backgroundColor: active ? 'var(--color-hover)' : 'transparent',
                      color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                    }}
                  >
                    <Icon size={12} />
                    {item.label}
                  </button>
                )
              })}
            </div>
            <div className="relative flex-1 min-w-[220px] max-w-[360px] ml-auto">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('storyBibleOverview.searchPlaceholder')}
                className="pl-7"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
            {[
              [t('storyBibleOverview.stats.characters'), filteredCharacters.length],
              [t('storyBibleOverview.stats.timeline'), filteredTimeline.length],
              [t('storyBibleOverview.stats.plots'), activePlots.length],
              [t('storyBibleOverview.stats.facts'), data.facts.length],
            ].map(([label, value]) => (
              <div key={label} className="px-3 py-2 rounded-md" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
                <div className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
                <div className="text-lg font-semibold tabular-nums mt-0.5" style={{ color: 'var(--color-text)' }}>{value}</div>
              </div>
            ))}
          </div>

          {section === 'overview' && (
            <div className="space-y-5">
              <TextBlock title={t('storyBibleOverview.fields.premise')} text={project.novelConfig.coreOutline} />
              <TextBlock title={t('storyBibleOverview.fields.world')} text={project.novelConfig.worldSetting} />
              <TextBlock title={t('storyBibleOverview.fields.protagonist')} text={project.novelConfig.protagonistProfile} />
              <section>
                <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{t('storyBibleOverview.recentSummaries')}</h3>
                {data.summaries.length === 0 ? <EmptyLine text={t('storyBibleOverview.emptySummaries')} /> : (
                  <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                    {data.summaries.map((summary, index) => (
                      <div key={summary.chapterNumber} className="px-3 py-2.5 text-xs" style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}>
                        <span className="font-mono mr-2" style={{ color: 'var(--color-text-muted)' }}>Ch.{summary.chapterNumber}</span>
                        <span style={{ color: 'var(--color-text)' }}>{summary.summary}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {section === 'characters' && (
            filteredCharacters.length === 0 ? <EmptyLine text={t('storyBibleOverview.emptyCharacters')} /> : (
              <div className="space-y-2">
                {filteredCharacters.map(character => (
                  <div key={character.name} className="px-3 py-3 rounded-md" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{character.name}</span>
                      <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{character.role}</span>
                      {character.currentState?.updatedAtChapter ? (
                        <span className="text-[0.65rem] ml-auto" style={{ color: 'var(--color-text-muted)' }}>
                          {t('storyBibleOverview.updatedAt', { chapter: character.currentState.updatedAtChapter })}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{character.motivation || character.personality || t('storyBibleOverview.noDescription')}</p>
                    {character.currentState && (
                      <div className="text-[0.68rem] mt-2 flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--color-text-muted)' }}>
                        {character.currentState.location && <span>@ {character.currentState.location}</span>}
                        {character.currentState.powerLevel && <span>{character.currentState.powerLevel}</span>}
                        {character.currentState.recentEvents && <span>{character.currentState.recentEvents}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {section === 'timeline' && (
            filteredTimeline.length === 0 ? <EmptyLine text={t('storyBibleOverview.emptyTimeline')} /> : (
              <div className="relative pl-5">
                <div className="absolute left-1.5 top-2 bottom-2 w-px" style={{ backgroundColor: 'var(--color-border)' }} />
                {filteredTimeline.map((event, index) => (
                  <div key={`${event.chapterNumber}-${event.sequence}-${index}`} className="relative pb-4">
                    <div className="absolute -left-[15px] top-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: event.timeFlow === 'flashback' ? 'var(--color-warning)' : 'var(--color-accent)' }} />
                    <div className="flex items-center gap-2 text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
                      <span className="font-mono">Ch.{event.chapterNumber}.{event.sequence}</span>
                      {event.location && <span>@ {event.location}</span>}
                      {event.characters.length > 0 && <span>{event.characters.join('、')}</span>}
                      {event.timeFlow === 'flashback' && <span>{t('storyBibleOverview.flashback')}</span>}
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text)' }}>{event.summary}</p>
                    {event.impact && <p className="text-[0.68rem] mt-1" style={{ color: 'var(--color-text-secondary)' }}>{event.impact}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {section === 'plots' && (
            filteredPlots.length === 0 ? <EmptyLine text={t('storyBibleOverview.emptyPlots')} /> : (
              <div className="space-y-2">
                {filteredPlots.map(plot => {
                  const isForeshadow = plot.kind === 'foreshadow'
                  const resolved = plot.status === 'resolved'
                  return (
                    <div key={`${plot.id ?? plot.name}`} className="px-3 py-3 rounded-md" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
                      <div className="flex items-center gap-2">
                        <span
                          className="px-1.5 py-[1px] rounded text-[0.6rem] flex-shrink-0"
                          style={{
                            border: '1px solid var(--color-border)',
                            color: isForeshadow ? 'var(--color-warning-text)' : 'var(--color-text-muted)',
                          }}
                        >
                          {isForeshadow ? t('storyBibleOverview.plotKindForeshadow') : t('storyBibleOverview.plotKindPlot')}
                        </span>
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{plot.name}</span>
                        <span className="text-[0.65rem]" style={{ color: plot.status === 'active' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>{plot.status}</span>
                        <span className="text-[0.65rem] ml-auto font-mono" style={{ color: 'var(--color-text-muted)' }}>
                          Ch.{plot.startedAt} → {resolved && plot.resolvedAt ? plot.resolvedAt : plot.lastAdvancedAt}
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--color-text)' }}>{plot.currentState}</p>
                      {plot.description && <p className="text-[0.68rem] mt-1" style={{ color: 'var(--color-text-muted)' }}>{plot.description}</p>}

                      {/* 台账操作：标记类型、填写预计回收阶段 */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <button
                          className="px-1.5 py-0.5 rounded text-[0.62rem]"
                          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                          onClick={() => void handlePlotKind(plot.id!, isForeshadow ? 'plot' : 'foreshadow')}
                        >
                          {isForeshadow ? t('storyBibleOverview.plotMarkAsPlot') : t('storyBibleOverview.plotMarkAsForeshadow')}
                        </button>
                        {isForeshadow && !resolved && (
                          <input
                            className="px-1.5 py-0.5 rounded text-[0.62rem] outline-none"
                            style={{
                              background: 'var(--color-bg-elevated)',
                              border: '1px solid var(--color-border)',
                              color: 'var(--color-text)',
                              width: 150,
                            }}
                            placeholder={t('storyBibleOverview.plotPlanPlaceholder')}
                            value={plotPlanDraft[plot.id!] ?? plot.plannedResolveAt ?? ''}
                            onChange={e => setPlotPlanDraft(prev => ({ ...prev, [plot.id!]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void handlePlotPlan(plot.id!, plotPlanDraft[plot.id!] ?? plot.plannedResolveAt ?? '')
                              }
                            }}
                            onBlur={e => void handlePlotPlan(plot.id!, e.target.value)}
                          />
                        )}
                        {isForeshadow && resolved && plot.plannedResolveAt && (
                          <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                            {t('storyBibleOverview.plotPlanLabel', { plan: plot.plannedResolveAt })}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}

          {section === 'facts' && (
            <>
              {/* 物品流转台账：道具在谁手上、什么时候丢的，属于「作者说了算」的信息，只登记不推断 */}
              <div className="mb-3 rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <button
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs"
                  style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-elevated)' }}
                  onClick={() => void handleToggleItemLedger()}
                >
                  {itemLedgerOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="font-medium">{t('storyBibleOverview.itemLedgerTitle')}</span>
                  <span className="ml-auto text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                    {itemEvents.length > 0 ? t('storyBibleOverview.itemLedgerCount', { count: itemEvents.length }) : ''}
                  </span>
                </button>
                {itemLedgerOpen && (
                  <div className="px-2 py-2 space-y-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
                    {itemEvents.length === 0 ? (
                      <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
                        {t('storyBibleOverview.itemLedgerEmpty')}
                      </div>
                    ) : [...new Set(itemEvents.map(event => event.item))].map(item => (
                      <div key={item} className="flex items-baseline gap-2 text-[0.68rem]">
                        <span style={{ color: 'var(--color-text)', minWidth: 80 }}>{item}</span>
                        <span className="flex-1" style={{ color: 'var(--color-text-muted)' }}>
                          {itemEvents.filter(event => event.item === item).map(event => (
                            <span key={event.id} className="mr-2 whitespace-nowrap">
                              第{event.chapterNumber}章 {t(`storyBibleOverview.itemAction.${event.action}`)}
                              {event.actor ? `（${event.actor}）` : ''}
                              {event.note ? `·${event.note}` : ''}
                              <button
                                className="ml-1 align-middle"
                                style={{ color: 'var(--color-text-muted)' }}
                                title={t('storyBibleOverview.itemLedgerRemove')}
                                onClick={() => void handleRemoveItemEvent(event.id!)}
                              >×</button>
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 120 }}
                        placeholder={t('storyBibleOverview.itemLedgerItem')}
                        value={itemDraft.item}
                        onChange={e => setItemDraft(draft => ({ ...draft, item: e.target.value }))}
                      />
                      <select
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                        value={itemDraft.action}
                        onChange={e => setItemDraft(draft => ({ ...draft, action: e.target.value as ItemEvent['action'] }))}
                      >
                        {(['obtained', 'transferred', 'lost', 'destroyed', 'consumed'] as const).map(action => (
                          <option key={action} value={action}>{t(`storyBibleOverview.itemAction.${action}`)}</option>
                        ))}
                      </select>
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-mono"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 56 }}
                        placeholder={t('storyBibleOverview.itemLedgerChapter')}
                        value={itemDraft.chapter}
                        onChange={e => setItemDraft(draft => ({ ...draft, chapter: e.target.value.replace(/[^0-9]/g, '') }))}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 88 }}
                        placeholder={t('storyBibleOverview.itemLedgerActor')}
                        value={itemDraft.actor}
                        onChange={e => setItemDraft(draft => ({ ...draft, actor: e.target.value }))}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 120 }}
                        placeholder={t('storyBibleOverview.itemLedgerNote')}
                        value={itemDraft.note}
                        onChange={e => setItemDraft(draft => ({ ...draft, note: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddItemEvent() } }}
                      />
                      <Button variant="ghost" size="sm" onClick={() => void handleAddItemEvent()}>
                        <Plus size={11} />{t('storyBibleOverview.itemLedgerAdd')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center flex-wrap gap-2 mb-3">
                {([
                  ['all', t('storyBibleOverview.factsFilterAll'), data.facts.length],
                  ['pending', t('storyBibleOverview.factsFilterPending'), pendingFactCount],
                  ['conflict', t('storyBibleOverview.factsFilterConflict'), conflictFactCount],
                  ['confirmed', t('storyBibleOverview.factsFilterConfirmed'), confirmedFactCount],
                ] as const).map(([id, label, count]) => (
                  <button
                    key={id}
                    className="px-2 py-0.5 rounded-md text-[0.68rem] transition-colors"
                    style={{
                      border: '1px solid var(--color-border)',
                      backgroundColor: factFilter === id ? 'var(--color-accent)' : 'transparent',
                      color: factFilter === id ? 'var(--color-on-accent)' : 'var(--color-text-secondary)',
                    }}
                    onClick={() => setFactFilter(id)}
                  >
                    {label}{count > 0 ? ` ${count}` : ''}
                  </button>
                ))}
                {visibleFacts.filter(isPendingFact).length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleConfirmFacts(
                      visibleFacts.filter(isPendingFact).map(fact => fact.id!).filter(id => id != null),
                      true,
                    )}
                  >
                    <Check size={11} />
                    {t('storyBibleOverview.factsConfirmAll', { count: visibleFacts.filter(isPendingFact).length })}
                  </Button>
                )}
              </div>
              {factsByCategory.size === 0 ? <EmptyLine text={t('storyBibleOverview.emptyFacts')} /> : (
                <div className="space-y-4">
                  {[...factsByCategory.entries()].map(([category, facts]) => (
                    <section key={category}>
                      <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{category}</h3>
                      <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                        {facts.map((fact, index) => {
                          const status = fact.status ?? 'active'
                          const statusLabel = status === 'contradicted'
                            ? t('storyBibleOverview.factStatusConflict')
                            : status === 'outdated'
                              ? t('storyBibleOverview.factStatusOutdated')
                              : status === 'tentative'
                                ? t('storyBibleOverview.factStatusTentative')
                                : t('storyBibleOverview.factStatusActive')
                          const statusColor = status === 'contradicted' ? 'var(--color-warning-text)'
                            : status === 'outdated' ? 'var(--color-text-muted)'
                              : status === 'tentative' ? 'var(--color-info-text)' : 'var(--color-success-text)'
                          return (
                            <div
                              key={`${fact.id ?? fact.statement}-${index}`}
                              className="px-3 py-2 text-xs"
                              style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}
                            >
                              <div className="flex items-start gap-2">
                                <span
                                  className="flex-shrink-0 mt-[2px] px-1.5 py-[1px] rounded text-[0.6rem]"
                                  style={{ border: '1px solid var(--color-border)', color: statusColor }}
                                  title={fact.confirmedAt
                                    ? t('storyBibleOverview.factConfirmedAt', { time: fact.confirmedAt })
                                    : t('storyBibleOverview.factPendingHint')}
                                >
                                  {statusLabel}
                                </span>
                                <span className="flex-1" style={{ color: 'var(--color-text)' }}>
                                  {fact.statement}
                                  {fact.introducedAt > 0 && (
                                    <span className="ml-2 font-mono text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>Ch.{fact.introducedAt}</span>
                                  )}
                                  {!fact.confirmedAt && (
                                    <span className="ml-2 text-[0.65rem]" style={{ color: 'var(--color-warning-text)' }}>
                                      {t('storyBibleOverview.factPending')}
                                    </span>
                                  )}
                                  {fact.evidence && (
                                    <div className="mt-0.5 text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{fact.evidence}</div>
                                  )}
                                </span>
                                <span className="flex items-center gap-0.5 flex-shrink-0">
                                  {fact.confirmedAt ? (
                                    <button
                                      className="p-1 rounded transition-colors"
                                      style={{ color: 'var(--color-text-secondary)' }}
                                      title={t('storyBibleOverview.factActionUnconfirm')}
                                      disabled={busyFactId === fact.id}
                                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                      onClick={() => void handleConfirmFacts([fact.id!], false)}
                                    ><Undo2 size={12} /></button>
                                  ) : (
                                    <button
                                      className="p-1 rounded transition-colors"
                                      style={{ color: 'var(--color-success-text)' }}
                                      title={t('storyBibleOverview.factActionConfirm')}
                                      disabled={busyFactId === fact.id}
                                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                      onClick={() => void handleConfirmFacts([fact.id!], true)}
                                    ><Check size={12} /></button>
                                  )}
                                  {status !== 'contradicted' && (
                                    <button
                                      className="p-1 rounded transition-colors"
                                      style={{ color: 'var(--color-text-secondary)' }}
                                      title={t('storyBibleOverview.factActionConflict')}
                                      disabled={busyFactId === fact.id}
                                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                      onClick={() => void handleFactStatus(fact.id!, 'contradicted')}
                                    ><AlertTriangle size={12} /></button>
                                  )}
                                  {status !== 'outdated' ? (
                                    <button
                                      className="p-1 rounded transition-colors"
                                      style={{ color: 'var(--color-text-secondary)' }}
                                      title={t('storyBibleOverview.factActionOutdated')}
                                      disabled={busyFactId === fact.id}
                                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                      onClick={() => void handleFactStatus(fact.id!, 'outdated')}
                                    ><Archive size={12} /></button>
                                  ) : (
                                    <button
                                      className="p-1 rounded transition-colors"
                                      style={{ color: 'var(--color-text-secondary)' }}
                                      title={t('storyBibleOverview.factActionRestore')}
                                      disabled={busyFactId === fact.id}
                                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                      onClick={() => void handleFactStatus(fact.id!, 'active')}
                                    ><RotateCcw size={12} /></button>
                                  )}
                                  <button
                                    className="p-1 rounded transition-colors"
                                    style={{ color: historyFactId === fact.id ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
                                    title={t('storyBibleOverview.factActionHistory')}
                                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                    onClick={() => void handleToggleHistory(fact.id!)}
                                  ><History size={12} /></button>
                                </span>
                              </div>
                              {historyFactId === fact.id && (
                                <div className="mt-1.5 pl-2 text-[0.65rem] space-y-0.5" style={{ borderLeft: '2px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                                  {factHistory.length === 0
                                    ? <div>{t('storyBibleOverview.factHistoryEmpty')}</div>
                                    : factHistory.map(entry => (
                                      <div key={entry.id}>
                                        <span className="font-mono">{entry.at}</span>
                                        <span className="ml-2">{t(`storyBibleOverview.factHistoryAction.${entry.action}`, entry.action)}</span>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}

          {section === 'realms' && (
            <>
              <div className="text-[0.68rem] mb-2" style={{ color: 'var(--color-text-muted)' }}>
                {t('storyBibleOverview.realmHint')}
              </div>
              {realms.length === 0 ? <EmptyLine text={t('storyBibleOverview.realmEmpty')} /> : (
                <div className="rounded-md overflow-hidden mb-3" style={{ border: '1px solid var(--color-border)' }}>
                  {realms.map((realm, index) => (
                    <div
                      key={realm.id}
                      className="px-2 py-2 flex items-center gap-1.5 flex-wrap text-[0.68rem]"
                      style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}
                    >
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-mono text-center"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 44 }}
                        defaultValue={String(realm.rankOrder)}
                        title={t('storyBibleOverview.realmRank')}
                        onBlur={e => void handleSaveRealm(realm, { rankOrder: Number.parseInt(e.target.value, 10) || 0 })}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-medium"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 110 }}
                        defaultValue={realm.name}
                        onBlur={e => void handleSaveRealm(realm, { name: e.target.value.trim() || realm.name })}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                        placeholder={t('storyBibleOverview.realmAbilities')}
                        defaultValue={realm.abilities ?? ''}
                        onBlur={e => void handleSaveRealm(realm, { abilities: e.target.value })}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                        placeholder={t('storyBibleOverview.realmLimits')}
                        defaultValue={realm.limits ?? ''}
                        onBlur={e => void handleSaveRealm(realm, { limits: e.target.value })}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                        placeholder={t('storyBibleOverview.realmBreakthrough')}
                        defaultValue={realm.breakthrough ?? ''}
                        onBlur={e => void handleSaveRealm(realm, { breakthrough: e.target.value })}
                      />
                      <button
                        className="p-1 rounded"
                        style={{ color: 'var(--color-text-muted)' }}
                        title={t('storyBibleOverview.realmRemove')}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                        onClick={() => void handleRemoveRealm(realm.id!)}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                  style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 110 }}
                  placeholder={t('storyBibleOverview.realmName')}
                  value={realmDraft.name}
                  onChange={e => setRealmDraft(draft => ({ ...draft, name: e.target.value }))}
                />
                <input
                  className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-mono text-center"
                  style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 44 }}
                  placeholder={t('storyBibleOverview.realmRank')}
                  value={realmDraft.rankOrder}
                  onChange={e => setRealmDraft(draft => ({ ...draft, rankOrder: e.target.value.replace(/[^0-9]/g, '') }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddRealm() } }}
                />
                <Button variant="ghost" size="sm" onClick={() => void handleAddRealm()}>
                  <Plus size={11} />{t('storyBibleOverview.realmAdd')}
                </Button>
              </div>
            </>
          )}

          {section === 'locations' && (
            <>
              <div className="text-[0.68rem] mb-2" style={{ color: 'var(--color-text-muted)' }}>
                {t('storyBibleOverview.locationHint')}
              </div>
              {locations.length === 0 ? <EmptyLine text={t('storyBibleOverview.locationEmpty')} /> : (
                <div className="rounded-md overflow-hidden mb-3" style={{ border: '1px solid var(--color-border)' }}>
                  {locations.map((location, index) => (
                    <div
                      key={location.id}
                      className="px-2 py-2 flex items-center gap-1.5 flex-wrap text-[0.68rem]"
                      style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}
                    >
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-medium"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 110 }}
                        defaultValue={location.name}
                        onBlur={e => void handleSaveLocation(location, { name: e.target.value.trim() || location.name })}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 100 }}
                        placeholder={t('storyBibleOverview.locationRegion')}
                        defaultValue={location.region ?? ''}
                        onBlur={e => void handleSaveLocation(location, { region: e.target.value })}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 100 }}
                        placeholder={t('storyBibleOverview.locationFaction')}
                        defaultValue={location.faction ?? ''}
                        onBlur={e => void handleSaveLocation(location, { faction: e.target.value })}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                        placeholder={t('storyBibleOverview.locationDistance')}
                        defaultValue={location.distanceNote ?? ''}
                        onBlur={e => void handleSaveLocation(location, { distanceNote: e.target.value })}
                      />
                      <input
                        className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                        style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                        placeholder={t('storyBibleOverview.locationTravel')}
                        defaultValue={location.travelNote ?? ''}
                        onBlur={e => void handleSaveLocation(location, { travelNote: e.target.value })}
                      />
                      <button
                        className="p-1 rounded"
                        style={{ color: 'var(--color-text-muted)' }}
                        title={t('storyBibleOverview.locationRemove')}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                        onClick={() => void handleRemoveLocation(location.id!)}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                  style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 110 }}
                  placeholder={t('storyBibleOverview.locationName')}
                  value={locationDraft.name}
                  onChange={e => setLocationDraft(draft => ({ ...draft, name: e.target.value }))}
                />
                <input
                  className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                  style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 100 }}
                  placeholder={t('storyBibleOverview.locationRegion')}
                  value={locationDraft.region}
                  onChange={e => setLocationDraft(draft => ({ ...draft, region: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddLocation() } }}
                />
                <Button variant="ghost" size="sm" onClick={() => void handleAddLocation()}>
                  <Plus size={11} />{t('storyBibleOverview.locationAdd')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TextBlock({ title, text }: { title: string; text?: string }) {
  return (
    <section>
      <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{title}</h3>
      <p className="text-xs leading-relaxed whitespace-pre-wrap px-3 py-2.5 rounded-md" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)', color: text ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
        {text || '—'}
      </p>
    </section>
  )
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="py-12 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
      {text}
    </div>
  )
}
