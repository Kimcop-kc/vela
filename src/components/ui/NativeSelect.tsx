import * as React from 'react'
import { cn } from '../../lib/utils'

/** 原生 select 的统一样式封装（轻量替代 Radix Select） */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          'vela-field flex h-7 w-full pl-2 pr-7 py-1 text-xs',
          'appearance-none cursor-pointer',
          'disabled:cursor-not-allowed',
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    )
  }
)
NativeSelect.displayName = 'NativeSelect'

export { NativeSelect }
