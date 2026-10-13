import { Sparkles, FolderOpen, Clock, BookOpen, FileUp, ChevronRight, PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore } from '../../stores/layout-store'
import { formatRelativeTime } from '../../utils/time'
import { EmptyState } from '../ui/EmptyState'
import { parseUpdatedAt, shortenPath } from './welcome-helpers'

interface WelcomePageProps {
  onNewProject: () => void
  onOpenProject: () => void
  onImportNovel?: () => void
}

/**
 * 欢迎页面 — 无项目打开时显示。
 * 布局：左右分栏（左侧品牌与操作，右侧最近项目），避免居中式三卡并列的空洞感。
 * 层级：仅「新建项目」为主操作，其余为次级行式操作。
 */
export default function WelcomePage({ onNewProject, onOpenProject, onImportNovel }: WelcomePageProps) {
  const { t } = useTranslation('pages')
  const recentProjects = useProjectStore(s => s.recentProjects)
  const openProject = useProjectStore(s => s.openProject)
  const currentProject = useProjectStore(s => s.currentProject)

  // 已打开项目时（侧栏切到「主页」也会渲染本页），主操作变成「继续创作」——
  // 它只是把侧栏切回「项目结构」，让用户接着上次的章节写，不涉及任何虚构的进度数据。
  const primary = currentProject
    ? {
        id: 'continue',
        icon: PenLine,
        title: t('welcome.continueWriting'),
        desc: t('welcome.continueWritingDesc'),
        onClick: () => useLayoutStore.getState().setSidebarView('project'),
      }
    : {
        id: 'new',
        icon: Sparkles,
        title: t('welcome.newProject'),
        desc: t('welcome.newProjectDesc'),
        onClick: onNewProject,
      }

  const secondary = [
    // 项目已打开时「新建项目」降级为次级操作，避免与主操作抢注意力
    ...(currentProject
      ? [{
          id: 'new',
          icon: Sparkles,
          title: t('welcome.newProject'),
          desc: t('welcome.newProjectDesc'),
          onClick: onNewProject,
        }]
      : []),
    {
      id: 'open',
      icon: FolderOpen,
      title: t('welcome.openProject'),
      desc: t('welcome.openProjectDesc'),
      onClick: onOpenProject,
    },
    {
      id: 'import',
      icon: FileUp,
      title: t('welcome.importNovel'),
      desc: t('welcome.importNovelDesc'),
      onClick: onImportNovel,
    },
  ]

  const PrimaryIcon = primary.icon

  return (
    <div className="w-full h-full overflow-y-auto" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
      <div className="mx-auto flex w-full max-w-[1020px] flex-col gap-10 px-10 py-12 lg:flex-row lg:gap-12">
        {/* ===== 左：品牌 + 操作 ===== */}
        <div className="min-w-0 flex-1">
          <div className="mb-7 flex items-center gap-3">
            <div
              className="brand-mark ai-glow flex h-11 w-11 flex-shrink-0 items-center justify-center"
              style={{ borderRadius: 'var(--radius-lg)' }}
            >
              <BookOpen size={20} strokeWidth={1.8} color="var(--color-on-accent)" />
            </div>
            <div className="min-w-0">
              <h1
                className="truncate text-[17px] font-semibold tracking-tight"
                style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}
              >
                {currentProject ? currentProject.name : t('welcome.title')}
              </h1>
              <p className="truncate text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                {currentProject ? shortenPath(currentProject.path) : t('welcome.subtitle')}
              </p>
            </div>
          </div>

          {/* 主操作：唯一主色按钮 */}
          <button
            type="button"
            onClick={primary.onClick}
            className="btn-primary group flex w-full items-center gap-3 px-4 py-3 text-left text-[var(--color-on-accent)]"
            style={{ borderRadius: 'var(--radius-lg)' }}
          >
            <PrimaryIcon size={17} strokeWidth={1.9} className="flex-shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight">{primary.title}</span>
              <span className="block text-[11px] font-normal leading-snug opacity-80">
                {primary.desc}
              </span>
            </span>
            <ChevronRight
              size={15}
              className="flex-shrink-0 opacity-60 transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </button>

          {/* 次级操作：行式列表，用分隔线而非卡片堆叠 */}
          <div
            className="mt-2.5 overflow-hidden"
            style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}
          >
            {secondary.map(({ id, icon: Icon, title, desc, onClick }, i) => (
              <button
                key={id}
                type="button"
                onClick={onClick}
                className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-hover)]"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}
              >
                <Icon
                  size={15}
                  strokeWidth={1.8}
                  className="flex-shrink-0"
                  style={{ color: 'var(--color-text-secondary)' }}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" style={{ color: 'var(--color-text)' }}>
                  {title}
                </span>
                <span
                  className="hidden max-w-[42%] truncate text-[11px] sm:block"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {desc}
                </span>
                <ChevronRight
                  size={14}
                  className="flex-shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-60"
                  style={{ color: 'var(--color-accent)' }}
                />
              </button>
            ))}
          </div>

          <p
            className="mt-8 text-[11px] leading-relaxed"
            style={{ color: 'var(--color-text-muted)', opacity: 0.8, textWrap: 'pretty' }}
          >
            {/* 版本号取自构建期注入的 __APP_VERSION__，不再写死在文案里
                （原文案写的是 v0.1.0，与实际版本 0.2.7 不符） */}
            {`Vela v${__APP_VERSION__} · ${t('welcome.footer')}`}
          </p>
        </div>

        {/* ===== 右：最近项目 ===== */}
        <aside className="w-full flex-shrink-0 lg:w-[320px]">
          <div className="mb-2.5 flex items-center gap-2 px-0.5">
            <Clock size={13} style={{ color: 'var(--color-text-muted)' }} />
            <span className="section-title">{t('welcome.recentProjects')}</span>
          </div>

          {recentProjects.length === 0 ? (
            /* 统一走 EmptyState（此前是手写 dashed 框）；「空状态要给出真正可用的操作」由 children 承担 */
            <EmptyState
              icon={<BookOpen size={22} strokeWidth={1.6} />}
              message={t('welcome.emptyRecent')}
              className="px-6 py-9"
              style={{ border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-lg)' }}
            >
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {t('welcome.emptyRecentDesc')}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onNewProject}
                  className="btn-primary px-3 py-1.5 text-[12px] font-medium text-[var(--color-on-accent)]"
                  style={{ borderRadius: 'var(--radius-md)' }}
                >
                  {t('welcome.newProject')}
                </button>
                <button
                  type="button"
                  onClick={onOpenProject}
                  className="px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--color-hover)]"
                  style={{
                    color: 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  {t('welcome.openProject')}
                </button>
              </div>
            </EmptyState>
          ) : (
            <div
              className="overflow-hidden"
              style={{
                backgroundColor: 'var(--color-panel)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
              }}
            >
              {recentProjects.slice(0, 8).map((p, i) => {
                const ts = parseUpdatedAt(p.updatedAt)
                const timeLabel = ts === null ? null : formatRelativeTime(ts)
                return (
                  <button
                    key={`${p.path}-${i}`}
                    type="button"
                    onClick={() => openProject(p.path)}
                    title={p.path}
                    className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--color-hover)]"
                    style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}
                  >
                    <div
                      className="tile-accent flex flex-shrink-0 items-center justify-center"
                      style={{ width: 28, height: 28, borderRadius: 'var(--radius-md)' }}
                    >
                      <BookOpen size={13} strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px]" style={{ color: 'var(--color-text)' }}>
                        {p.name}
                      </div>
                      <div className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {shortenPath(p.path)}
                      </div>
                    </div>
                    {/* 最近打开时间：来自主进程写入的真实 updatedAt */}
                    {timeLabel && (
                      <span
                        className="flex-shrink-0 text-[10.5px] tabular-nums"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {timeLabel}
                      </span>
                    )}
                    <ChevronRight
                      size={13}
                      className="flex-shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-70"
                      style={{ color: 'var(--color-accent)' }}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}