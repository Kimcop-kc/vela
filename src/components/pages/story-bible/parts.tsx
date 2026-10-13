/**
 * 故事圣经页的小零件
 *
 * 这两个组件原本定义在 StoryBibleOverview.tsx 末尾，被多个分区复用，因此单独放。
 */

export function TextBlock({ title, text }: { title: string; text?: string }) {
  return (
    <section>
      <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{title}</h3>
      <p className="text-xs leading-relaxed whitespace-pre-wrap px-3 py-2.5 rounded-md" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)', color: text ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
        {text || '—'}
      </p>
    </section>
  )
}

export function EmptyLine({ text }: { text: string }) {
  return (
    <div className="py-12 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
      {text}
    </div>
  )
}
