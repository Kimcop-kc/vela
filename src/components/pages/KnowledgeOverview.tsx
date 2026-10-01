import { useState, useEffect, useCallback } from 'react'
import {
  BookOpen, FileText,
  Search, RefreshCw, Layers, Zap, Server, Activity,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { useProjectStore } from '../../stores/project-store'
import { cn } from '../../lib/utils'
import { toast } from '../ui/Toast'
import { globalEventBus } from '../../shared/event-bus'
import {
  loadKBData, getVectorlessCount, searchKB, backfillVectors,
  type KBDocument, type SearchResult, type KBStatsData,
} from '../../services/knowledge-service'

/**
 * 知识库概览页面 — LanceDB 向量数据库的管理中心
 * 当侧栏视图为"知识库"时，作为中间编辑区的固定内容展示。
 */
export default function KnowledgeOverview() {
  const { t } = useTranslation('pages', { keyPrefix: 'knowledgeOverview' })
  const [documents, setDocuments] = useState<KBDocument[]>([])
  const [stats, setStats] = useState<KBStatsData>({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [topK, setTopK] = useState(10)
  const [vectorlessCount, setVectorlessCount] = useState(0)
  const [backfilling, setBackfilling] = useState(false)

  const currentProject = useProjectStore(s => s.currentProject)

  const loadData = useCallback(async () => {
    if (!currentProject) return
    try {
      const { documents: docs, stats: s } = await loadKBData()
      setDocuments(docs)
      setStats(s)
    } catch { /* 忽略 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.path])

  const checkVectorless = useCallback(async () => {
    if (!currentProject) return
    try {
      setVectorlessCount(await getVectorlessCount())
    } catch { /* 忽略 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.path])

  useEffect(() => { 
    loadData()
    checkVectorless()
  }, [loadData, checkVectorless])

  useEffect(() => { checkVectorless() }, [checkVectorless, documents])

  // 通过 EventBus 监听资源刷新和定稿完成事件
  useEffect(() => {
    const unsub1 = globalEventBus.on('REFRESH_RESOURCE', (payload: { resources: string[] }) => {
      if (payload.resources.includes('all') || payload.resources.includes('fileTree')) {
        loadData()
        checkVectorless()
      }
    })
    const unsub2 = globalEventBus.on('FINALIZE_COMPLETE', () => {
      loadData()
      checkVectorless()
    })
    return () => { unsub1(); unsub2() }
  }, [loadData, checkVectorless])

  // 判断检索模式
  const hasVectors = stats.vectorDimension > 0
  const searchMode = hasVectors ? t('hybridSearch') : t('bm25Search')

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <EmptyState icon={<BookOpen size={22} />} message={t('openProjectFirst')} opacity={0.55} />
      </div>
    )
  }

  /** 语义检索 */
  const handleSearch = async () => {
    setSearching(true)
    try {
      const results = await searchKB(searchQuery, topK)
      setSearchResults(results)
    } catch { /* 忽略 */ }
    setSearching(false)
  }

  /** 向量回填 */
  const handleBackfill = async () => {
    setBackfilling(true)
    try {
      const result = await backfillVectors()
      if (result.success) {
        toast.success(t('rebuildSuccess', { processed: result.processed, failed: result.failed > 0 ? t('failedCount', { count: result.failed }) : '' }))
      } else {
        toast.error(result.error || t('rebuildFailed'))
      }
    } catch (e) {
      toast.error(t('rebuildFailed') + ': ' + String(e))
    } finally {
      setBackfilling(false)
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['all'] })
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* 页头：标题 + 规模（与拆书页同款） */}
      <div
        className="flex items-center justify-between gap-3 px-4 h-11 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-editor-bg)' }}
      >
        <span className="text-[0.82rem] font-semibold truncate" style={{ color: 'var(--color-text)' }}>
          {t('title')}
        </span>
        <span className="text-[0.68rem] flex-shrink-0 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
          {t('headerStats', { docs: stats.documentCount, chunks: stats.totalChunks })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[880px] mx-auto px-6 py-5 space-y-6">
        <p className="text-[0.72rem] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('description')}
        </p>

        {/* ===== 统计条 =====
            刻意不用「四张等宽卡片」：那是模板感最强的布局，而且这四个数字之间
            没有真实层级差异，包成卡片只是噪声。改用一条带发丝分隔线的统计条，
            数字用等宽数字对齐，靠间距分层而不是靠卡片。 */}
        <div
          className="mb-6 flex flex-wrap items-stretch divide-x divide-[var(--color-border)]"
          style={{
            backgroundColor: 'var(--color-surface-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <StatCell icon={<FileText size={13} />} label={t('docCount')} value={stats.documentCount} />
          <StatCell icon={<Layers size={13} />} label={t('chunkCount')} value={stats.totalChunks} />
          <StatCell icon={<Server size={13} />} label={t('engine')} value="LanceDB" />
          <StatCell
            icon={<Activity size={13} />}
            label={t('searchMode')}
            value={hasVectors ? t('ftsVector') : t('ftsOnly')}
            note={hasVectors ? t('hybrid') : t('basic')}
            noteTone={hasVectors ? 'success' : 'info'}
          />
        </div>

        {/* ===== 向量回填卡片 ===== */}
        {vectorlessCount > 0 && (
          <div
            className="rounded-xl border border-amber-500/20 mb-6 overflow-hidden"
            style={{ backgroundColor: 'rgba(245, 158, 11, 0.06)' }}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <Zap size={16} className="text-amber-400" />
                </div>
                <div>
                  <div className="text-sm font-medium text-[var(--color-warning-text)]">{t('indexUpgrade')}</div>
                  <div className="text-[0.7rem] text-[var(--color-warning-text)] opacity-80">
                    {t('vectorlessCount', { count: vectorlessCount })}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                className="text-xs border-amber-500/30 text-[var(--color-warning-text)] hover:bg-amber-500/20"
                onClick={handleBackfill}
                disabled={backfilling}
              >
                {backfilling ? (
                  <><RefreshCw size={12} className="animate-spin mr-1.5" />{t('rebuilding')}</>
                ) : (
                  <>{t('rebuildIndex')}</>
                )}
              </Button>
            </div>
            {/* 进度条（回填时显示） */}
            {backfilling && (
              <div className="h-1 w-full bg-amber-500/10">
                <div className="h-full bg-gradient-to-r from-amber-500 to-amber-300 animate-pulse rounded-full w-full" />
              </div>
            )}
          </div>
        )}

        {/* ===== 语义检索区域 ===== */}
        <div
          className="rounded-xl border border-[var(--color-border)] mb-6 overflow-hidden"
          style={{ backgroundColor: 'var(--color-sidebar)' }}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
            <Search size={14} className="text-[var(--color-accent)] flex-shrink-0" />
            <span className="text-sm font-semibold text-[var(--color-text)]">{t('semanticSearch')}</span>
            {/* 检索模式标签 */}
            <span className={cn(
              'text-[0.65rem] px-1.5 py-0.5 rounded-full font-medium',
              hasVectors
                ? 'bg-emerald-500/15 text-[var(--color-success-text)]'
                : 'bg-blue-500/15 text-[var(--color-info-text)]'
            )}>
              {searchMode}
            </span>
            <span className="text-[0.7rem] text-[var(--color-text-muted)] ml-auto">
              {hasVectors ? t('hybridHint') : t('basicHint')}
            </span>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center gap-2">
              <Input
                className="flex-1 h-9"
                placeholder={t('searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[0.7rem] text-[var(--color-text-muted)]">Top</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={topK}
                  onChange={(e) => setTopK(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
                  className="w-12 h-7 text-xs rounded px-1.5 text-center"
                />
              </div>
              <Button
                variant="ai"
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
                {t('search')}
              </Button>
            </div>
          </div>

          {/* 检索结果 */}
          {searchResults.length > 0 && (
            <div className="border-t border-[var(--color-border)]">
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  {t('searchResults', { count: searchResults.length })}
                </span>
                <button
                  className="text-[0.7rem] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                  onClick={() => setSearchResults([])}
                >
                  {t('clear')}
                </button>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                {[...searchResults].reverse().map((r, i) => (
                  <div
                    key={i}
                    className="px-4 py-3 border-t border-[var(--color-border)] hover:bg-[var(--color-hover)] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
                        <FileText size={10} />
                        {r.fileName}
                      </span>
                      <span className={cn(
                        'text-[0.7rem] px-1.5 py-0.5 rounded font-mono',
                        r.score > 0.8 ? 'bg-green-500/20 text-[var(--color-success-text)]' :
                        r.score > 0.6 ? 'bg-yellow-500/20 text-[var(--color-warning-text)]' :
                        'bg-[var(--color-hover)] text-[var(--color-text-muted)]'
                      )}>
                        {r.score === 0.5 ? t('fullTextMatch') : t('similarity', { score: (r.score * 100).toFixed(1) })}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                      {r.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}

/** 统计条单体：标签在上、数字在下，靠发丝线分隔，不用卡片 */
function StatCell({ icon, label, value, note, noteTone }: {
  icon: React.ReactNode
  label: string
  value: number | string
  note?: string
  noteTone?: 'success' | 'info'
}) {
  return (
    <div className="flex-1 min-w-[150px] px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
        {icon}
        <span className="text-[0.7rem]">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-xl font-semibold leading-none tabular-nums"
          style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}
        >
          {value}
        </span>
        {note && (
          <span
            className="px-1.5 py-[1px] text-[0.62rem] font-medium"
            style={{
              borderRadius: 'var(--radius-pill)',
              color: noteTone === 'success' ? 'var(--color-success-text)' : 'var(--color-info-text)',
              backgroundColor: noteTone === 'success'
                ? 'rgba(16, 185, 129, 0.12)'
                : 'rgba(59, 130, 246, 0.12)',
            }}
          >
            {note}
          </span>
        )}
      </div>
    </div>
  )
}
