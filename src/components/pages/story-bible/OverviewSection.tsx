/**
 * 故事圣经 · 总览分区
 *
 * 只读：项目级设定（前提 / 世界观 / 主角）+ 最近章节摘要。
 * 数据由外层页面传入，这里不做任何写操作。
 */
import { useTranslation } from 'react-i18next'
import type { ChapterSummary } from '../../../services/narrative-consistency'
import { EmptyLine, TextBlock } from './parts'

interface OverviewSectionProps {
  premise?: string
  world?: string
  protagonist?: string
  summaries: ChapterSummary[]
}

export function OverviewSection({ premise, world, protagonist, summaries }: OverviewSectionProps) {
  const { t } = useTranslation('pages')

  return (
    <div className="space-y-5">
      <TextBlock title={t('storyBibleOverview.fields.premise')} text={premise} />
      <TextBlock title={t('storyBibleOverview.fields.world')} text={world} />
      <TextBlock title={t('storyBibleOverview.fields.protagonist')} text={protagonist} />
      <section>
        <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{t('storyBibleOverview.recentSummaries')}</h3>
        {summaries.length === 0 ? <EmptyLine text={t('storyBibleOverview.emptySummaries')} /> : (
          <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {summaries.map((summary, index) => (
              <div key={summary.chapterNumber} className="px-3 py-2.5 text-xs" style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}>
                <span className="font-mono mr-2" style={{ color: 'var(--color-text-muted)' }}>Ch.{summary.chapterNumber}</span>
                <span style={{ color: 'var(--color-text)' }}>{summary.summary}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
