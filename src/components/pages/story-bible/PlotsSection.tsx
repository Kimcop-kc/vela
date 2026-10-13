/**
 * 故事圣经 · 线索分区（剧情线 / 伏笔）
 *
 * 作者可以在这里把一条线索标记为剧情线或伏笔，并填写伏笔的「预计回收阶段」。
 * 这两件事都写 canon（updatePlotLineMeta），写成功后由外层页面重新拉取数据。
 *
 * 编辑草稿 plotPlanDraft 按剧情线 id 存：输入框受控于草稿，失焦/回车才落库，
 * 避免每敲一个字就打一次 IPC。
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlotLine } from '../../../services/narrative-consistency'
import { canonStore } from '../../../services/narrative-consistency'
import { EmptyLine } from './parts'

interface PlotsSectionProps {
  plots: PlotLine[]
  /** 数据变更后让外层页面重新拉取 */
  onChanged: () => Promise<void>
}

export function PlotsSection({ plots, onChanged }: PlotsSectionProps) {
  const { t } = useTranslation('pages')
  /** 伏笔「预计回收阶段」的编辑草稿（按剧情线 id） */
  const [plotPlanDraft, setPlotPlanDraft] = useState<Record<number, string>>({})

  /** 把一条线索标记为剧情线或伏笔 */
  const handlePlotKind = useCallback(async (id: number, kind: 'plot' | 'foreshadow') => {
    if (await canonStore.updatePlotLineMeta(id, { kind })) await onChanged()
  }, [onChanged])

  /** 保存伏笔的预计回收阶段 */
  const handlePlotPlan = useCallback(async (id: number, plannedResolveAt: string) => {
    const next = plannedResolveAt.trim()
    const current = plots.find(plot => plot.id === id)?.plannedResolveAt ?? ''
    if (next === current) return
    if (await canonStore.updatePlotLineMeta(id, { plannedResolveAt: next })) await onChanged()
  }, [plots, onChanged])

  if (plots.length === 0) return <EmptyLine text={t('storyBibleOverview.emptyPlots')} />

  return (
    <div className="space-y-2">
      {plots.map(plot => {
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
}
