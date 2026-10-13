/**
 * 故事圣经 · 时间线分区
 *
 * 只读：按章节/章内顺序展示事件，闪回事件用不同颜色标出（闪回必须显式标记过才会出现在这里）。
 * 筛选（关键词）由外层页面完成，这里拿到的已是过滤后的事件列表。
 */
import { useTranslation } from 'react-i18next'
import type { TimelineEvent } from '../../../services/narrative-consistency'
import { EmptyLine } from './parts'

export function TimelineSection({ events }: { events: TimelineEvent[] }) {
  const { t } = useTranslation('pages')

  if (events.length === 0) return <EmptyLine text={t('storyBibleOverview.emptyTimeline')} />

  return (
    <div className="relative pl-5">
      <div className="absolute left-1.5 top-2 bottom-2 w-px" style={{ backgroundColor: 'var(--color-border)' }} />
      {events.map((event, index) => (
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
}
