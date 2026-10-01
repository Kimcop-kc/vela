import * as React from 'react'
import { cn } from '../../lib/utils'

/**
 * 通用 Input 组件
 *
 * type="number" 的增强行为：
 * - 编辑中允许清空输入框（不会阻止删除操作）
 * - 失焦时若为空值，自动恢复为 min 属性值（若设置）或 "0"
 * - 业务组件可通过自定义 onBlur 覆盖恢复逻辑
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, onBlur, onFocus, ...props }, ref) => {
    // 对 number 类型添加 onBlur 空值兜底
    const handleBlur: React.FocusEventHandler<HTMLInputElement> = (e) => {
      if (type === 'number' && e.target.value === '') {
        // 恢复为 min 属性值或 "0"
        const fallback = props.min != null ? String(props.min) : '0'
        // 通过 nativeInputValueSetter 触发 React onChange
        const nativeSet = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'value'
        )?.set
        nativeSet?.call(e.target, fallback)
        e.target.dispatchEvent(new Event('input', { bubbles: true }))
      }
      // 调用业务传入的 onBlur（若有）
      onBlur?.(e)
    }

    return (
      <input
        type={type}
        className={cn(
          'vela-field flex h-7 w-full px-3 py-1 text-xs',
          'disabled:cursor-not-allowed',
          className
        )}
        ref={ref}
        onBlur={handleBlur}
        onFocus={onFocus}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
