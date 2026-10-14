/**
 * 标题栏上的长任务指示器（拆书导入 / 向量重建）
 *
 * 放在标题栏而不是拆书页里，是为了解决「切到别的页面就看不到还在跑」——
 * 标题栏在任何页面都在，进度条、当前阶段与「停止」按钮始终可见。
 */
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Loader2, Square, X } from 'lucide-react'
import { useKnowledgeTaskStore, taskPercent, isTaskRunning } from '../../stores/knowledge-task-store'

export function KnowledgeTaskIndicator() {
  const { t } = useTranslation('layout')
  const task = useKnowledgeTaskStore(s => s.task)
  const cancel = useKnowledgeTaskStore(s => s.cancel)
  const dismiss = useKnowledgeTaskStore(s => s.dismiss)

  if (!task) return null

  const percent = taskPercent(task)
  const running = isTaskRunning(task)
  const keyPrefix = 'titleBar.knowledgeTask'
  const phaseLabel = t(`${keyPrefix}.phase.${task.phase}`)
  const statusLabel = running
    ? phaseLabel
    : t(`${keyPrefix}.status.${task.status}`)
  const counter = task.total > 0 ? ` ${task.current}/${task.total}` : ''

  return (
    <div
      className="flex items-center gap-2 flex-shrink-0 mr-2 px-2 py-0.5 rounded"
      style={{
        WebkitAppRegion: 'no-drag',
        backgroundColor: 'var(--color-hover)',
        border: '1px solid var(--color-border)',
        maxWidth: 320,
      } as React.CSSProperties}
      title={`${task.label} · ${statusLabel}${counter}`}
    >
      {running
        ? <Loader2 size={11} className="animate-spin flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
        : task.status === 'done'
          ? <CheckCircle2 size={11} className="flex-shrink-0" style={{ color: 'var(--color-success-text)' }} />
          : <Square size={11} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />}

      <span className="text-[0.68rem] truncate" style={{ color: 'var(--color-titlebar-text)' }}>
        {t(`${keyPrefix}.kind.${task.kind}`)}
        <span className="mx-1 opacity-60">·</span>
        {statusLabel}{counter}
      </span>

      {percent !== null && (
        <span
          className="flex-shrink-0 rounded-full overflow-hidden"
          style={{ width: 56, height: 4, backgroundColor: 'var(--color-border)' }}
          aria-hidden
        >
          <span
            className="block h-full transition-[width] duration-300"
            style={{ width: `${percent}%`, backgroundColor: running ? 'var(--color-accent)' : 'var(--color-success-text)' }}
          />
        </span>
      )}

      {running ? (
        <button
          className="icon-btn flex-shrink-0"
          title={t(`${keyPrefix}.stop`)}
          onClick={() => { void cancel() }}
        >
          <Square size={10} />
        </button>
      ) : (
        <button
          className="icon-btn flex-shrink-0"
          title={t(`${keyPrefix}.dismiss`)}
          onClick={dismiss}
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}
