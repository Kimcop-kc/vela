import { Sparkles, FolderOpen, Clock, BookOpen, FileUp, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'

interface WelcomePageProps {
  onNewProject: () => void
  onOpenProject: () => void
  onImportNovel?: () => void
}

/** 路径过长时只保留尾部三段，避免撑破布局 */
function shortenPath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 3) return normalized
  return '…/' + parts.slice(-3).join('/')
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

  const secondary = [
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
            onClick={onNewProject}
            className="btn-primary group flex w-full items-center gap-3 px-4 py-3 text-left text-white"
            style={{ borderRadius: 'var(--radius-lg)' }}
          >
            <Sparkles size={17} strokeWidth={1.9} className="flex-shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight">{t('welcome.newProject')}</span>
              <span className="block text-[11px] font-normal leading-snug opacity-80">
                {t('welcome.newProjectDesc')}
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
            {t('welcome.footer')}
          </p>
        </div>

        {/* ===== 右：最近项目 ===== */}
        <aside className="w-full flex-shrink-0 lg:w-[320px]">
          <div className="mb-2.5 flex items-center gap-2 px-0.5">
            <Clock size={13} style={{ color: 'var(--color-text-muted)' }} />
            <span className="section-title">{t('welcome.recentProjects')}</span>
          </div>

          {recentProjects.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center px-6 py-10 text-center"
              style={{ border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-lg)' }}
            >
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('welcome.emptyRecent')}
              </p>
            </div>
          ) : (
            <div
              className="overflow-hidden"
              style={{
                backgroundColor: 'var(--color-panel)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
              }}
            >
              {recentProjects.slice(0, 8).map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => openProject(p.path)}
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
                  <ChevronRight
                    size={13}
                    className="flex-shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-70"
                    style={{ color: 'var(--color-accent)' }}
                  />
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}