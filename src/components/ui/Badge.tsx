/* eslint-disable react-refresh/only-export-components */
/**
 * Vela Badge 标签组件 — Fluent 2 精致版
 *
 * 轻量标签，用于状态标识、分类标注。支持多种语义变体，自动适配双主题。
 *
 * 用法：
 *   import { Badge } from '@/components/ui/Badge'
 *   <Badge variant="success">已完成</Badge>
 */

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  /* 基础：精致胶囊徽章 */
  'inline-flex items-center gap-1 px-2 py-0.5 text-[0.7rem] font-medium rounded-full leading-none whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'vela-badge--default',
        success: 'vela-badge--success',
        warning: 'vela-badge--warning',
        error:   'vela-badge--error',
        outline: 'vela-badge--outline',
        solid:   'vela-badge--solid',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      />
    )
  }
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
