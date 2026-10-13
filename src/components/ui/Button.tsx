/* eslint-disable react-refresh/only-export-components */
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

 

export const buttonVariants = cva(
  /* Fluent 2：4px 控件圆角、1px 焦点描边、克制点击缩放 */
  'inline-flex items-center justify-center gap-1.5 text-xs font-medium transition-all duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        default:
          /* 强调色底上的字色必须走 --color-on-accent：accent 是亮色的主题
             （galaxy #5CB8F0 / dark #4CC2FF / ocean #38C8E8）用白字对比度只有 2.0~2.2，
             而令牌里已经为每套主题配好了高对比的前景色（8.3~8.7）。 */
          'btn-primary text-[var(--color-on-accent)]',
        ai:
          /* .ai-glow 已改为 color: var(--color-on-accent)，
             这里不能再叠 text-white 把它盖回去。 */
          'ai-glow shadow-sm hover:shadow-md relative overflow-hidden',
        destructive:
          /* 同 default：--color-error 在 galaxy/dark/ocean 是亮色，白字只有 2.0~2.9 */
          'bg-[var(--color-error)] text-[var(--color-on-error)] shadow-sm hover:shadow-md hover:shadow-[var(--color-error)]/30 transition-all duration-150 hover:brightness-110 active:scale-[0.97]',
        outline:
          'border border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:bg-[var(--color-hover)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all duration-150',
        ghost:
          'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] active:scale-[0.98] transition-all duration-150',
        success:
          /* 同 destructive；另需注意 paper 的 --color-success 已压暗到 #438361 才能过 AA */
          'bg-[var(--color-success)] text-[var(--color-on-success)] shadow-sm hover:shadow-md hover:shadow-[var(--color-success)]/30 transition-all duration-150 hover:brightness-110 active:scale-[0.97]',
      },
      size: {
        default: 'h-7 px-3 py-1 rounded-[var(--radius-sm)]',    /* 28px 高 */
        sm:      'h-6 px-2.5 py-0.5 rounded-[var(--radius-sm)]', /* 24px 高 */
        lg:      'h-8 px-4 py-1.5 rounded-[var(--radius-md)]',   /* 32px 高 */
        icon:    'h-7 w-7 p-0 rounded-[var(--radius-sm)]',       /* 28x28 方形图标按钮 */
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }
