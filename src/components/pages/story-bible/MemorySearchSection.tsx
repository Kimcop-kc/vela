/**
 * 故事圣经 · 统一记忆检索分区（[v10] 分层记忆与精准检索）
 *
 * 跨事实/时间线/人物/物品/伏笔/章节/分卷做一次检索，并支持展开查看原文段落证据。
 * 完全自包含：检索条件、结果、原文展开状态都在本组件内，不占用外层页面的 state。
 *
 * 两个刻意的设计：
 *   · 命中键 `memHitKey` 把 type/id/chapter/title 拼在一起 —— 同一条事实可能在不同章节
 *     各有一条历史记录，只用 id 会串行展开；
 *   · 检索失败时把 degraded + degradeReason 带出来展示，而不是假装「没有结果」。
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, Search } from 'lucide-react'
import type { MemoryHitType, MemorySearchHit, MemorySearchResult } from '../../../services/narrative-consistency'
import { canonStore } from '../../../services/narrative-consistency'
import { toast } from '../../ui/Toast'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { EmptyLine } from './parts'

export function MemorySearchSection() {
  const { t } = useTranslation('pages')
  const [memQuery, setMemQuery] = useState('')
  const [memTypes, setMemTypes] = useState<MemoryHitType[]>([])
  const [memIncludeHistorical, setMemIncludeHistorical] = useState(false)
  const [memResult, setMemResult] = useState<MemorySearchResult | null>(null)
  const [memSearching, setMemSearching] = useState(false)
  const [memSearched, setMemSearched] = useState(false)
  /** 展开查看原文的命中键 + 该章段落 */
  const [memSourceKey, setMemSourceKey] = useState<string | null>(null)
  const [memSourceParagraphs, setMemSourceParagraphs] = useState<string[]>([])
  const [memSourceLoading, setMemSourceLoading] = useState(false)

  const memHitKey = useCallback((hit: MemorySearchHit) =>
    `${hit.type}:${hit.id ?? ''}:${hit.chapterNumber ?? 0}:${hit.title}`, [])

  const handleMemSearch = useCallback(async () => {
    const q = memQuery.trim()
    if (!q) {
      setMemResult(null)
      setMemSearched(false)
      return
    }
    setMemSearching(true)
    setMemSearched(true)
    setMemSourceKey(null)
    try {
      const r = await canonStore.searchCanon({
        query: q,
        types: memTypes.length > 0 ? memTypes : undefined,
        includeHistorical: memIncludeHistorical,
        limit: 60,
      })
      setMemResult(r)
    } catch (error) {
      toast.error(String(error))
      setMemResult({ hits: [], total: 0, degraded: true, degradeReason: String(error), elapsedMs: 0 })
    } finally {
      setMemSearching(false)
    }
  }, [memQuery, memTypes, memIncludeHistorical])

  const handleViewSource = useCallback(async (hit: MemorySearchHit) => {
    const key = memHitKey(hit)
    if (memSourceKey === key) {
      setMemSourceKey(null)
      return
    }
    setMemSourceKey(key)
    setMemSourceParagraphs([])
    if (!hit.chapterNumber) return
    setMemSourceLoading(true)
    try {
      setMemSourceParagraphs(await canonStore.getChapterParagraphs(hit.chapterNumber))
    } finally {
      setMemSourceLoading(false)
    }
  }, [memSourceKey, memHitKey])

  const toggleMemType = useCallback((type: MemoryHitType) => {
    setMemTypes(prev => prev.includes(type) ? prev.filter(item => item !== type) : [...prev, type])
  }, [])

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('storyBibleOverview.memSearch.hint')}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <Input
            value={memQuery}
            onChange={e => setMemQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleMemSearch() } }}
            placeholder={t('storyBibleOverview.memSearch.placeholder')}
            className="pl-7"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => void handleMemSearch()} disabled={memSearching}>
          {memSearching ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
          {memSearching ? t('storyBibleOverview.memSearch.searching') : t('storyBibleOverview.sections.search')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(['fact', 'timeline', 'character_state', 'character_history', 'plot_line', 'item_event', 'chapter_summary', 'arc'] as MemoryHitType[]).map(type => {
          const active = memTypes.includes(type)
          return (
            <button
              key={type}
              onClick={() => toggleMemType(type)}
              className="px-2 py-1 rounded text-[0.68rem] transition-colors"
              style={{
                border: '1px solid var(--color-border)',
                backgroundColor: active ? 'var(--color-hover)' : 'transparent',
                color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
              }}
            >
              {t(`storyBibleOverview.memSearch.types.${type}`)}
            </button>
          )
        })}
        <label className="flex items-center gap-1.5 text-[0.68rem] ml-1 cursor-pointer" style={{ color: 'var(--color-text-muted)' }}>
          <input type="checkbox" checked={memIncludeHistorical} onChange={e => setMemIncludeHistorical(e.target.checked)} />
          {t('storyBibleOverview.memSearch.includeHistorical')}
        </label>
      </div>

      {memResult?.degraded && (
        <div className="text-[0.68rem] px-3 py-2 rounded" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
          {t('storyBibleOverview.memSearch.degraded', { reason: memResult.degradeReason || '' })}
        </div>
      )}

      {memSearched && !memSearching && memResult && (
        <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
          {t('storyBibleOverview.memSearch.total', { total: memResult.total })}
        </div>
      )}

      {memSearched && !memSearching && memResult && memResult.hits.length === 0 && (
        <EmptyLine text={t('storyBibleOverview.memSearch.empty')} />
      )}

      <div className="space-y-2">
        {(memResult?.hits ?? []).map(hit => {
          const key = memHitKey(hit)
          const expanded = memSourceKey === key
          return (
            <div key={key} className="px-3 py-3 rounded-md" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[0.62rem] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}>
                  {t(`storyBibleOverview.memSearch.types.${hit.type}`)}
                </span>
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{hit.title}</span>
                {hit.chapterNumber ? <span className="text-[0.65rem] font-mono" style={{ color: 'var(--color-text-muted)' }}>Ch.{hit.chapterNumber}</span> : null}
                {hit.status ? (
                  <span className="text-[0.62rem]" style={{ color: 'var(--color-text-muted)' }}>
                    {hit.status === 'contradicted' ? '⚠️ ' : ''}{hit.status}{hit.confirmed ? ' · ✅' : ''}
                  </span>
                ) : null}
                <span className="text-[0.62rem] ml-auto" style={{ color: hit.isCurrent ? 'var(--color-text-muted)' : 'var(--color-amber)' }}>
                  {hit.isCurrent ? t('storyBibleOverview.memSearch.current') : t('storyBibleOverview.memSearch.historical')}
                </span>
              </div>
              {hit.snippet && (
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{hit.snippet}</p>
              )}
              {hit.matchReasons.length > 0 && (
                <div className="text-[0.65rem] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('storyBibleOverview.memSearch.reasons')}: {hit.matchReasons.join(' · ')}
                </div>
              )}
              {hit.conflictsWith && hit.conflictsWith.length > 0 && (
                <div className="text-[0.65rem] mt-1 flex items-start gap-1" style={{ color: 'var(--color-amber)' }}>
                  <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                  <span>{t('storyBibleOverview.memSearch.conflict')}: {hit.conflictsWith.join(' / ')}</span>
                </div>
              )}
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => void handleViewSource(hit)}
                  className="text-[0.68rem] underline-offset-2 hover:underline"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {expanded ? t('storyBibleOverview.memSearch.hideSource') : t('storyBibleOverview.memSearch.viewSource')}
                </button>
                {hit.sourceLocation && (
                  <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                    {t('storyBibleOverview.memSearch.sourceChapter', { chapter: hit.sourceLocation.chapterNumber, paragraph: hit.sourceLocation.paragraphIndex + 1 })}
                  </span>
                )}
              </div>
              {expanded && (
                <div className="mt-2 rounded overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  {memSourceLoading ? (
                    <div className="px-3 py-2 text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{t('storyBibleOverview.memSearch.searching')}</div>
                  ) : memSourceParagraphs.length === 0 ? (
                    <div className="px-3 py-2 text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>{t('storyBibleOverview.memSearch.noEvidence')}</div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto">
                      {memSourceParagraphs.map((para, idx) => {
                        const highlight = hit.sourceLocation?.paragraphIndex === idx
                        return (
                          <div
                            key={idx}
                            className="px-3 py-1.5 text-[0.7rem]"
                            style={{
                              backgroundColor: highlight ? 'var(--color-hover)' : 'transparent',
                              color: 'var(--color-text-secondary)',
                              borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                            }}
                          >
                            <span className="font-mono mr-2" style={{ color: 'var(--color-text-muted)' }}>¶{idx + 1}</span>
                            {para}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
