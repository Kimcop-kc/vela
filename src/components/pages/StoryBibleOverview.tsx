import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookMarked, Clock3, GitBranch, Lightbulb, RefreshCw, Search, Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore, type StoryBibleSection } from '../../stores/layout-store'
import { useCharacterStore } from '../../stores/character-store'
import { ipc } from '../../services/ipc-client'
import { canonStore } from '../../services/narrative-consistency'
import type { CharacterStateSnapshot, ChapterSummary, Fact, PlotLine, TimelineEvent } from '../../services/narrative-consistency'
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

function sectionTitle(section: StoryBibleSection, t: (key: string) => string): string {
  const labels: Record<StoryBibleSection, string> = {
    overview: t('storyBibleOverview.sections.overview'),
    characters: t('storyBibleOverview.sections.characters'),
    timeline: t('storyBibleOverview.sections.timeline'),
    plots: t('storyBibleOverview.sections.plots'),
    facts: t('storyBibleOverview.sections.facts'),
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

  useEffect(() => { void load() }, [load])
  useEffect(() => globalEventBus.on('REFRESH_RESOURCE', () => { void load() }), [load])
  useEffect(() => globalEventBus.on('STORY_REVISED', () => { void load() }), [load])

  const sections: Array<{ id: StoryBibleSection; label: string; icon: typeof BookMarked }> = [
    { id: 'overview', label: t('storyBibleOverview.sections.overview'), icon: BookMarked },
    { id: 'characters', label: t('storyBibleOverview.sections.characters'), icon: Users },
    { id: 'timeline', label: t('storyBibleOverview.sections.timeline'), icon: Clock3 },
    { id: 'plots', label: t('storyBibleOverview.sections.plots'), icon: GitBranch },
    { id: 'facts', label: t('storyBibleOverview.sections.facts'), icon: Lightbulb },
  ]

  const activePlots = data.plots.filter(plot => plot.status === 'active')
  const factsByCategory = useMemo(() => {
    const groups = new Map<Fact['category'], Fact[]>()
    for (const fact of data.facts.filter(item => includesQuery(query, item.statement, item.evidence))) {
      groups.set(fact.category, [...(groups.get(fact.category) ?? []), fact])
    }
    return groups
  }, [data.facts, query])

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
                {filteredPlots.map(plot => (
                  <div key={`${plot.id ?? plot.name}`} className="px-3 py-3 rounded-md" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{plot.name}</span>
                      <span className="text-[0.65rem]" style={{ color: plot.status === 'active' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>{plot.status}</span>
                      <span className="text-[0.65rem] ml-auto font-mono" style={{ color: 'var(--color-text-muted)' }}>Ch.{plot.startedAt} → {plot.lastAdvancedAt}</span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text)' }}>{plot.currentState}</p>
                    {plot.description && <p className="text-[0.68rem] mt-1" style={{ color: 'var(--color-text-muted)' }}>{plot.description}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {section === 'facts' && (
            factsByCategory.size === 0 ? <EmptyLine text={t('storyBibleOverview.emptyFacts')} /> : (
              <div className="space-y-4">
                {[...factsByCategory.entries()].map(([category, facts]) => (
                  <section key={category}>
                    <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{category}</h3>
                    <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                      {facts.map((fact, index) => (
                        <div key={`${fact.id ?? fact.statement}-${index}`} className="px-3 py-2 text-xs" style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}>
                          <span style={{ color: 'var(--color-text)' }}>{fact.statement}</span>
                          {fact.introducedAt > 0 && <span className="ml-2 font-mono text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>Ch.{fact.introducedAt}</span>}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )
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
