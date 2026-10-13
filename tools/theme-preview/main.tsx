/* eslint-disable react-refresh/only-export-components -- 本文件是独立入口，一次性挂载后即结束，不参与 Fast Refresh。 */
/**
 * 主题走查页（开发期工具，见 tools/theme-preview/README.md）。
 *
 * 目的：无头环境起不了 Electron，无法对整套界面做人工回归；这里用**真实的
 * src/index.css 与真实的 ui 组件**搭一个可截图的画廊，按主题逐套核对
 * 「令牌 → 组件」的落地效果，尤其是暗色/亮色强调色上的文字对比度。
 *
 * 用法：vite build 后用 ?theme=light|galaxy|paper|dark|ocean 切换。
 * 样式一律用内联，不依赖 Tailwind 工具类，避免扫描范围带来的偏差。
 * 主题清单与 theme-store 的 resolveTheme 保持一致（light 不加类，其余加对应类）。
 */
import { createRoot } from 'react-dom/client'
import type { CSSProperties, ReactNode } from 'react'
import { BookOpen, Folder, Search, Settings, Sparkles } from 'lucide-react'

import '../../src/i18n'
import '../../src/index.css'
import { Badge } from '../../src/components/ui/Badge'
import { Button } from '../../src/components/ui/Button'
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '../../src/components/ui/Dialog'
import { DialogContent } from '../../src/components/ui/Dialog'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { Icon } from '../../src/components/ui/Icon'
import { IconBtn } from '../../src/components/ui/IconBtn'
import { Input } from '../../src/components/ui/Input'
import { Label } from '../../src/components/ui/Label'
import MarkdownContent from '../../src/components/ui/MarkdownContent'
import { NativeSelect } from '../../src/components/ui/NativeSelect'
import { Skeleton } from '../../src/components/ui/Skeleton'
import { Switch } from '../../src/components/ui/Switch'
import { Textarea } from '../../src/components/ui/Textarea'

const THEME_CLASSES = ['galaxy', 'paper', 'dark', 'ocean']

function applyTheme(): string {
  const theme = new URLSearchParams(location.search).get('theme') ?? 'light'
  const root = document.documentElement
  root.classList.remove(...THEME_CLASSES)
  if (THEME_CLASSES.includes(theme)) root.classList.add(theme)
  root.style.fontSize = '16px'
  return theme
}

const theme = applyTheme()

const SWATCHES: Array<[string, string]> = [
  ['bg', '--color-bg'],
  ['elevated', '--color-bg-elevated'],
  ['panel', '--color-panel'],
  ['border', '--color-border'],
  ['text', '--color-text'],
  ['text-2nd', '--color-text-secondary'],
  ['muted', '--color-text-muted'],
  ['accent', '--color-accent'],
  ['on-accent', '--color-on-accent'],
  ['success', '--color-success'],
  ['warning', '--color-warning'],
  ['error', '--color-error'],
  ['info', '--color-info'],
]

const card: CSSProperties = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px 18px',
  marginBottom: 14,
}
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }
const heading: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.01em',
  color: 'var(--color-text-secondary)',
}
const labelStyle: CSSProperties = { display: 'block', marginBottom: 6, fontSize: 12 }

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section style={card}>
      <h2 style={heading}>{props.title}</h2>
      {props.children}
    </section>
  )
}

const VARIANTS = ['default', 'info', 'success', 'warning', 'error', 'outline', 'solid'] as const

function App() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
        padding: '20px 24px 40px',
        maxWidth: 980,
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Vela 主题走查 — {theme}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
          组件取自 src/components/ui，样式来自 src/index.css（与正式构建同一份）
        </div>
      </div>

      <Section title="语义色板">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {SWATCHES.map(([name, token]) => (
            <div key={name} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 62,
                  height: 34,
                  borderRadius: 'var(--radius-sm)',
                  background: `var(${token})`,
                  border: '1px solid var(--color-border)',
                }}
              />
              <div style={{ fontSize: 10, marginTop: 4, color: 'var(--color-text-muted)' }}>{name}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="徽章（7 变体）">
        <div style={row}>
          {VARIANTS.map(v => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="按钮">
        <div style={row}>
          <Button>主操作</Button>
          <Button variant="ai">AI 生成</Button>
          <Button variant="outline">次操作</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="destructive">删除</Button>
          <Button variant="success">通过</Button>
        </div>
        <div style={{ ...row, marginTop: 10 }}>
          <Button size="sm">小号主操作</Button>
          <Button size="sm" variant="outline">
            小号次操作
          </Button>
        </div>
      </Section>

      <Section title="表单">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <Label style={labelStyle}>项目名称</Label>
            <Input placeholder="请输入项目名称" defaultValue="顾野的废土编年史" />
          </div>
          <div>
            <Label style={labelStyle}>章节范围</Label>
            <NativeSelect defaultValue="all">
              <option value="all">全部章节</option>
              <option value="recent">最近 5 章</option>
            </NativeSelect>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Label style={labelStyle}>章节梗概</Label>
            <Textarea rows={3} defaultValue="顾野在废土上醒来，风里全是铁锈味。" />
          </div>
          <div style={{ ...row, gridColumn: '1 / -1' }}>
            <Switch defaultChecked id="sw" />
            <Label htmlFor="sw">自动保存</Label>
          </div>
        </div>
      </Section>

      <Section title="图标">
        <div style={row}>
          <Icon icon={BookOpen} size={18} />
          <Icon icon={Folder} size={18} />
          <Icon icon={Search} size={18} />
          <Icon icon={Sparkles} size={18} />
        </div>
      </Section>

      <Section title="空状态与骨架屏">
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <EmptyState message="还没有章节，先写第一章吧" icon={<Icon icon={BookOpen} size={22} />} />
          <div style={{ flex: 1 }}>
            <Skeleton style={{ height: 12, width: '60%', marginBottom: 8 }} />
            <Skeleton style={{ height: 12, width: '85%', marginBottom: 8 }} />
            <Skeleton style={{ height: 12, width: '40%' }} />
          </div>
        </div>
      </Section>

      <Section title="图标按钮">
        <div style={row}>
          <IconBtn title="设置" onClick={() => {}}>
            <Settings size={16} />
          </IconBtn>
          <IconBtn title="搜索" onClick={() => {}}>
            <Search size={16} />
          </IconBtn>
          <IconBtn title="收藏" active onClick={() => {}}>
            <Sparkles size={16} />
          </IconBtn>
          <IconBtn title="禁用" disabled onClick={() => {}}>
            <Folder size={16} />
          </IconBtn>
          <IconBtn title="带角标" badge={3} onClick={() => {}}>
            <BookOpen size={16} />
          </IconBtn>
        </div>
      </Section>

      <Section title="正文渲染（MarkdownContent）">
        <div
          style={{
            background: 'var(--color-bg-sunken, var(--color-bg))',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
          }}
        >
          <MarkdownContent
            content={[
              '# 第三章 · 铁锈味的风',
              '',
              '顾野在**废土**上醒来，风里全是铁锈味。他记得的最后一件事，是`编号 07`的探照灯。',
              '',
              '> 所有记忆都会被存档，包括你不想记住的那部分。',
              '',
              '- 第一项：检查滤罐',
              '- 第二项：确认风向',
              '',
              '```ts',
              "const dust = collect('east')",
              '```',
              '',
              '1. 有序第一',
              '2. 有序第二',
            ].join('\n')}
          />
        </div>
      </Section>

      <Section title="对话框">
        <Dialog defaultOpen>
          <DialogPortal>
            <DialogOverlay />
            <DialogContent>
              <DialogTitle>删除章节？</DialogTitle>
              <DialogDescription>该操作不可撤销，正文将从工程中移除。</DialogDescription>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <Button variant="outline" size="sm">取消</Button>
                <Button variant="destructive" size="sm">删除</Button>
              </div>
            </DialogContent>
          </DialogPortal>
        </Dialog>
      </Section>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
