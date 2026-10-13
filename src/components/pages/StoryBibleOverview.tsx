/**
 * 故事圣经总览页
 *
 * 拆分前这个文件 1207 行、单个组件 1131 行、25 个 useState —— 找「撤销定稿会清哪些数据」
 * 之类的问题得在千行里翻。现在这里只留**外壳职责**：
 *   · 顶栏（补写圣经数据、刷新）与分区切换、全局关键词搜索、四个统计卡片；
 *   · 页面级数据拉取（时间线/线索/事实/摘要/角色状态/蓝图）与事件订阅；
 *   · 把过滤后的数据分发给各分区。
 *
 * 各分区组件放在 ./story-bible/ 下，**谁的状态谁自己管**：
 *   OverviewSection / CharactersSection / TimelineSection   纯展示，数据由外壳传入
 *   PlotsSection / FactsSection                             自己管编辑草稿，变更后回调 onChanged
 *   RealmsSection / LocationsSection                        自己拉取与保存，靠 reloadToken 触发重拉
 *   MemorySearchSection                                     完全自包含（检索条件与结果都在内部）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookMarked, Clock3, GitBranch, History, Lightbulb, Loader2, MapPin, Mountain, RefreshCw, Search, Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore, type StoryBibleSection } from '../../stores/layout-store'
import { useCharacterStore } from '../../stores/character-store'
import { ipc } from '../../services/ipc-client'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { backfillCanonWriteback, canonStore, findChaptersMissingWriteback } from '../../services/narrative-consistency'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { globalEventBus } from '../../shared/event-bus'
import { EMPTY_DATA, includesQuery, sectionTitle, type BibleData } from './story-bible/helpers'
import { OverviewSection } from './story-bible/OverviewSection'
import { CharactersSection } from './story-bible/CharactersSection'
import { TimelineSection } from './story-bible/TimelineSection'
import { PlotsSection } from './story-bible/PlotsSection'
import { FactsSection } from './story-bible/FactsSection'
import { RealmsSection } from './story-bible/RealmsSection'
import { LocationsSection } from './story-bible/LocationsSection'
import { MemorySearchSection } from './story-bible/MemorySearchSection'

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
  /** 「补写圣经数据」的进度（已定稿但没写回的章节） */
  const [backfilling, setBackfilling] = useState(false)
  const [backfillDone, setBackfillDone] = useState(0)
  const [backfillTotal, setBackfillTotal] = useState(0)
  /**
   * 递增后通知「自行拉取数据」的分区（境界 / 地点）重新拉取。
   * 只在显式刷新或收到外部资源变更事件时递增 —— 首次挂载时不递增，
   * 这样这些分区挂载时自己拉一次即可，不会重复请求。
   */
  const [reloadToken, setReloadToken] = useState(0)

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
    } finally {
      setLoading(false)
    }
  }, [projectPath, totalChapters])

  /** 整页刷新：除自身数据外，也让自管数据的分区重拉 */
  const reloadAll = useCallback(async () => {
    await load()
    setReloadToken(token => token + 1)
  }, [load])

  useEffect(() => { void load() }, [load])
  useEffect(() => globalEventBus.on('REFRESH_RESOURCE', () => { void reloadAll() }), [reloadAll])
  useEffect(() => globalEventBus.on('STORY_REVISED', () => { void reloadAll() }), [reloadAll])

  const sections: Array<{ id: StoryBibleSection; label: string; icon: typeof BookMarked }> = [
    { id: 'overview', label: t('storyBibleOverview.sections.overview'), icon: BookMarked },
    { id: 'characters', label: t('storyBibleOverview.sections.characters'), icon: Users },
    { id: 'timeline', label: t('storyBibleOverview.sections.timeline'), icon: Clock3 },
    { id: 'plots', label: t('storyBibleOverview.sections.plots'), icon: GitBranch },
    { id: 'facts', label: t('storyBibleOverview.sections.facts'), icon: Lightbulb },
    { id: 'realms', label: t('storyBibleOverview.sections.realms'), icon: Mountain },
    { id: 'locations', label: t('storyBibleOverview.sections.locations'), icon: MapPin },
    { id: 'search', label: t('storyBibleOverview.sections.search'), icon: Search },
  ]

  const activePlots = data.plots.filter(plot => plot.status === 'active')

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

  /**
   * 补写圣经数据：把「已定稿但时间线/角色状态/事实都没有痕迹」的章节重跑一遍写回。
   *
   * 用的是现成材料（已定稿正文 + 定稿时生成的章节要点 + 角色卡 + 蓝图），
   * 不重新调用模型、也不改动正文。
   */
  const handleBackfill = useCallback(async () => {
    const missing = await findChaptersMissingWriteback()
    if (missing.length === 0) {
      toast.info(t('storyBibleOverview.backfillNothing'))
      return
    }
    const ok = await confirm(t('storyBibleOverview.backfillConfirm', { count: missing.length }))
    if (!ok) return
    setBackfilling(true)
    setBackfillDone(0)
    setBackfillTotal(missing.length)
    try {
      const result = await backfillCanonWriteback({
        chapters: missing,
        onProgress: (_item, done) => setBackfillDone(done),
      })
      const written = result.chapters.filter(item => item.ok && (item.events > 0 || item.facts > 0 || item.characterStates > 0 || item.foreshadows > 0))
      const empty = result.chapters.filter(item => item.ok && item.events === 0 && item.facts === 0 && item.characterStates === 0 && item.foreshadows === 0)
      if (written.length === 0) toast.warning(t('storyBibleOverview.backfillNoResult', { count: result.chapters.length }))
      else toast.success(t('storyBibleOverview.backfillDone', {
        chapters: written.length,
        events: written.reduce((sum, item) => sum + item.events, 0),
        facts: written.reduce((sum, item) => sum + item.facts, 0),
        empty: empty.length,
      }))
      await load()
    } catch (error) {
      toast.error(t('storyBibleOverview.backfillFailed', { error: String(error) }))
    } finally {
      setBackfilling(false)
    }
  }, [load, t])

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
          {/* 页头标题统一走 .section-title（原为硬编码 text-[0.82rem] font-semibold） */}
          <span className="section-title truncate">{project.name}</span>
          <span className="text-[0.68rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            {sectionTitle(section, t)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={() => void handleBackfill()} disabled={loading || backfilling}>
            {backfilling
              ? <Loader2 size={11} className="animate-spin" />
              : <History size={11} />}
            {backfilling
              ? t('storyBibleOverview.backfillRunning', { done: backfillDone, total: backfillTotal })
              : t('storyBibleOverview.backfill')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void reloadAll()} disabled={loading}>
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {t('storyBibleOverview.refresh')}
          </Button>
        </div>
      </header>

      {/* 内容宽度与「项目概览 / 知识库」对齐（此前是 960px，同一套页头下比另两页宽 80px） */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[880px] mx-auto px-6 py-5">
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
            <OverviewSection
              premise={project.novelConfig.coreOutline}
              world={project.novelConfig.worldSetting}
              protagonist={project.novelConfig.protagonistProfile}
              summaries={data.summaries}
            />
          )}

          {section === 'characters' && <CharactersSection characters={filteredCharacters} />}

          {section === 'timeline' && <TimelineSection events={filteredTimeline} />}

          {section === 'plots' && <PlotsSection plots={filteredPlots} onChanged={load} />}

          {section === 'facts' && <FactsSection facts={data.facts} query={query} onChanged={load} />}

          {section === 'realms' && <RealmsSection reloadToken={reloadToken} />}

          {section === 'locations' && <LocationsSection reloadToken={reloadToken} />}

          {section === 'search' && <MemorySearchSection />}
        </div>
      </div>
    </div>
  )
}
