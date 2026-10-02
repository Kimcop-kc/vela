import { useCallback, useEffect, useState } from 'react'
import { BookMarked, Clock3, GitBranch, Lightbulb, RefreshCw, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../../stores/project-store'
import { useLayoutStore, type StoryBibleSection } from '../../../stores/layout-store'
import { canonStore } from '../../../services/narrative-consistency'
import { globalEventBus } from '../../../shared/event-bus'
import { Button } from '../../ui/Button'

export default function StoryBiblePanel() {
  const { t } = useTranslation('panels')
  const project = useProjectStore(s => s.currentProject)
  const projectPath = project?.path
  const totalChapters = project?.novelConfig.totalChapters
  const section = useLayoutStore(s => s.storyBibleSection)
  const setSection = useLayoutStore(s => s.setStoryBibleSection)
  const [counts, setCounts] = useState({ characters: 0, timeline: 0, plots: 0, facts: 0 })
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setCounts({ characters: 0, timeline: 0, plots: 0, facts: 0 })
      return
    }
    setLoading(true)
    try {
      const [characters, timeline, plots, facts] = await Promise.all([
        canonStore.getAllCharacterStates(),
        canonStore.getTimeline(totalChapters || Number.MAX_SAFE_INTEGER),
        canonStore.getPlotLines(),
        canonStore.getFacts(),
      ])
      setCounts({
        characters: characters.length,
        timeline: timeline.length,
        plots: plots.filter(item => item.status === 'active').length,
        facts: facts.length,
      })
    } finally {
      setLoading(false)
    }
  }, [projectPath, totalChapters])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => globalEventBus.on('REFRESH_RESOURCE', () => { void refresh() }), [refresh])
  useEffect(() => globalEventBus.on('STORY_REVISED', () => { void refresh() }), [refresh])

  const items: Array<{ id: StoryBibleSection; label: string; icon: typeof BookMarked; count?: number }> = [
    { id: 'overview', label: t('storyBible.overview'), icon: BookMarked },
    { id: 'characters', label: t('storyBible.characters'), icon: Users, count: counts.characters },
    { id: 'timeline', label: t('storyBible.timeline'), icon: Clock3, count: counts.timeline },
    { id: 'plots', label: t('storyBible.plots'), icon: GitBranch, count: counts.plots },
    { id: 'facts', label: t('storyBible.facts'), icon: Lightbulb, count: counts.facts },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {project?.name ?? t('storyBible.noProject')}
        </span>
        <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={loading} title={t('storyBible.refresh')}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {items.map(item => {
          const Icon = item.icon
          const active = section === item.id
          return (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-xs transition-colors hover:bg-[var(--color-hover)]"
              style={{
                backgroundColor: active ? 'var(--color-active)' : 'transparent',
                color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
              }}
            >
              <Icon size={13} className="flex-shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.count !== undefined && (
                <span className="text-[0.65rem] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                  {item.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
