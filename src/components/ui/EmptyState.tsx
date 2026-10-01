import React from 'react'

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
  message: string
  /** 仅控制图标的淡出程度。文字不再参与淡化，始终按可读对比度渲染。 */
  opacity?: number
}

export function EmptyState({
  icon,
  message,
  opacity = 0.45,
  className,
  style,
  children,
  ...props
}: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center h-full gap-3 text-center ${className || ''}`}
      style={style}
      {...props}
    >
      {icon ? (
        <span
          className="flex items-center justify-center flex-shrink-0"
          style={{ opacity, color: 'var(--color-text-muted)' }}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <span
        className="text-sm"
        style={{ color: 'var(--color-text-muted)', textWrap: 'pretty', maxWidth: '46ch' }}
      >
        {message}
      </span>
      {children}
    </div>
  )
}
