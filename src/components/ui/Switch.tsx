/**
 * Vela Switch 开关组件 — Fluent 2 精致版
 *
 * 40×20px 规格，渐变滑轨 + 投影滑钮，焦点环 + 弹簧过渡。
 */

import * as React from 'react'
import { cn } from '../../lib/utils'

interface SwitchProps {
  /** 当前状态 */
  checked: boolean
  /** 状态变更回调 */
  onCheckedChange: (checked: boolean) => void
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义 className */
  className?: string
  /** 无障碍标签 */
  'aria-label'?: string
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex items-center flex-shrink-0 cursor-pointer',
          'w-10 h-5 rounded-full outline-none',
          'focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)] focus-visible:ring-[var(--color-accent)]',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        style={{
          backgroundColor: checked
            ? 'var(--color-accent)'
            : 'rgba(var(--color-text-muted-rgb), 0.18)',
          backgroundImage: checked
            ? 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0))'
            : 'none',
          boxShadow: checked
            ? '0 0 0 1px rgba(var(--color-accent-rgb), 0.4), inset 0 1px 1px rgba(255,255,255,0.18)'
            : 'inset 0 1px 1px rgba(0,0,0,0.12)',
          transition: 'background-color var(--transition-normal), box-shadow var(--transition-normal)',
        }}
        {...props}
      >
        {/* 滑钮圆点 */}
        <span
          className="inline-block w-4 h-4 rounded-full"
          style={{
            transform: checked ? 'translateX(22px)' : 'translateX(2px)',
            transition: 'transform var(--transition-spring)',
            background: 'var(--color-surface-raised)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.24), 0 0 0 0.5px rgba(0,0,0,0.06)',
          }}
        />
      </button>
    )
  }
)
Switch.displayName = 'Switch'

export { Switch }
