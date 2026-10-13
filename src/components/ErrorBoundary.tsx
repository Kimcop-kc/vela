import { Component, createContext } from 'react'
import type { CSSProperties, ReactNode, ErrorInfo, ContextType } from 'react'
import i18n from '../i18n'
import { TriangleAlert } from 'lucide-react'
import { appLogger } from '../services/app-logger'
import { Z_INDEX } from '../shared/z-index'

interface Props {
  children: ReactNode
  fallbackLabel?: string
  /**
   * 兜底层的定位方式：
   * - 'panel'（默认）撑满父容器，用于侧栏 / 编辑区 / 面板等内容区；
   * - 'overlay' 脱离文档流铺满窗口，用于弹窗位置 —— 弹窗崩溃后它自己的遮罩会一并卸载，
   *   兜底层必须自己盖住窗口，否则错误信息会掉进主布局里、把三栏结构撑乱。
   */
  variant?: 'panel' | 'overlay'
  /** 点「关闭」时调用：把仍处于打开状态的弹窗关掉，避免兜底层把用户困住 */
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
  componentStack: string
}

/** 全局 Error Boundary — 防止单个组件崩溃导致整个 React 树卸载 */
export class ErrorBoundary extends Component<Props, State> {
  static contextType = createContext(undefined)
  declare context: ContextType<typeof ErrorBoundary.contextType>

  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, componentStack: '' }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    appLogger.error('ui', 'React 组件崩溃', { error, componentStack: info.componentStack })
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  render() {
    if (this.state.hasError) {
      const { variant = 'panel', onReset } = this.props
      const container: CSSProperties =
        variant === 'overlay'
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: Z_INDEX.modal,
              backgroundColor: 'var(--color-bg)',
            }
          : { height: '100%', backgroundColor: 'var(--color-editor-bg)' }

      return (
        <div
          style={{
            ...container,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            color: 'var(--color-text)',
          }}
        >
          <TriangleAlert size={32} strokeWidth={1.5} style={{ color: 'var(--color-warning)' }} />
          <p style={{ fontWeight: 600, fontSize: 14 }}>
            {this.props.fallbackLabel || i18n.t('componentRenderError', { ns: 'common' })}
          </p>
          <pre
            style={{
              fontSize: '0.75rem',
              color: 'var(--color-error)',
              backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              maxWidth: '100%',
              overflow: 'auto',
              maxHeight: 200,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {this.state.error?.message}
            {'\n'}
            {this.state.componentStack}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              style={{
                padding: '6px 16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-hover)',
                color: 'var(--color-text)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                transition: 'background-color var(--transition-fast)',
              }}
              onClick={() => this.setState({ hasError: false, error: null, componentStack: '' })}
            >
              {i18n.t('retry', { ns: 'common' })}
            </button>
            {onReset && (
              <button
                style={{
                  padding: '6px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  transition: 'background-color var(--transition-fast)',
                }}
                onClick={() => {
                  this.setState({ hasError: false, error: null, componentStack: '' })
                  onReset()
                }}
              >
                {i18n.t('close', { ns: 'common' })}
              </button>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
