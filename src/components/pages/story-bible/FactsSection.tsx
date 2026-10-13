/**
 * 故事圣经 · 事实分区（本页最重的一块）
 *
 * 包含三部分：
 *   1. 物品流转台账 —— 「道具在谁手上、什么时候丢的」属于作者说了算的信息，只登记不推断；
 *   2. 事实筛选 —— 全部 / 待确认（AI 提取但作者没过目）/ 冲突 / 已确认，支持一键全部确认；
 *   3. 按类别分组的事实列表 —— 每条可确认/取消确认、标记冲突、标记废弃/恢复、展开变更历史。
 *
 * 「确认」与「记忆状态」是两件事：confirmedAt 只表示作者是否过目，status 才影响注入措辞。
 * 因此筛选口径统一走 helpers 里的三个谓词，避免与其它分区口径不一致。
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Archive, Check, ChevronDown, ChevronRight, History, Plus, RotateCcw, Undo2 } from 'lucide-react'
import type { Fact, ItemEvent } from '../../../services/narrative-consistency'
import { canonStore } from '../../../services/narrative-consistency'
import { toast } from '../../ui/Toast'
import { Button } from '../../ui/Button'
import { NativeSelect } from '../../ui/NativeSelect'
import { isConflictFact, isConfirmedFact, isPendingFact, includesQuery } from './helpers'
import { EmptyLine } from './parts'

interface FactsSectionProps {
  /** 全部事实（未经筛选，用于统计各状态数量） */
  facts: Fact[]
  /** 外层页面的关键词，用于过滤列表 */
  query: string
  /** 数据变更后让外层页面重新拉取 */
  onChanged: () => Promise<void>
}

export function FactsSection({ facts, query, onChanged }: FactsSectionProps) {
  const { t } = useTranslation('pages')
  /** 事实筛选：全部 / 待确认（AI 提取但作者没看过）/ 冲突 / 已确认 */
  const [factFilter, setFactFilter] = useState<'all' | 'pending' | 'conflict' | 'confirmed'>('all')
  const [busyFactId, setBusyFactId] = useState<number | null>(null)
  const [historyFactId, setHistoryFactId] = useState<number | null>(null)
  const [factHistory, setFactHistory] = useState<Array<{ id: number; action: string; at: string }>>([])
  /** 物品流转台账 */
  const [itemLedgerOpen, setItemLedgerOpen] = useState(false)
  const [itemEvents, setItemEvents] = useState<ItemEvent[]>([])
  const [itemDraft, setItemDraft] = useState({ item: '', action: 'obtained' as ItemEvent['action'], chapter: '', actor: '', note: '' })

  const pendingFactCount = useMemo(() => facts.filter(isPendingFact).length, [facts])
  const conflictFactCount = useMemo(() => facts.filter(isConflictFact).length, [facts])
  const confirmedFactCount = useMemo(() => facts.filter(isConfirmedFact).length, [facts])

  const visibleFacts = useMemo(() => facts.filter(fact => {
    if (!includesQuery(query, fact.statement, fact.evidence)) return false
    if (factFilter === 'pending') return isPendingFact(fact)
    if (factFilter === 'conflict') return isConflictFact(fact)
    if (factFilter === 'confirmed') return isConfirmedFact(fact)
    return true
  }), [facts, query, factFilter])

  const factsByCategory = useMemo(() => {
    const groups = new Map<Fact['category'], Fact[]>()
    for (const fact of visibleFacts) {
      groups.set(fact.category, [...(groups.get(fact.category) ?? []), fact])
    }
    return groups
  }, [visibleFacts])

  /** 作者确认 / 取消确认；确认 tentative 事实时主进程会顺带提升为 active */
  const handleConfirmFacts = useCallback(async (ids: number[], confirmed: boolean) => {
    const changed = await canonStore.confirmFacts(ids, confirmed)
    if (changed > 0) {
      toast.success(t('storyBibleOverview.factsConfirmedToast', { count: changed }))
      await onChanged()
    }
  }, [onChanged, t])

  /** 标记记忆状态（争议 / 废弃 / 恢复有效） */
  const handleFactStatus = useCallback(async (id: number, status: 'active' | 'outdated' | 'contradicted' | 'tentative') => {
    setBusyFactId(id)
    try {
      const ok = await canonStore.markFactStatus(id, status)
      if (ok) await onChanged()
    } finally {
      setBusyFactId(null)
    }
  }, [onChanged])

  /** 展开 / 收起某条事实的变更历史 */
  const handleToggleHistory = useCallback(async (id: number) => {
    if (historyFactId === id) {
      setHistoryFactId(null)
      setFactHistory([])
      return
    }
    setHistoryFactId(id)
    setFactHistory(await canonStore.getFactHistory(id))
  }, [historyFactId])

  /** 打开 / 收起物品流转台账（打开时拉一次记录） */
  const handleToggleItemLedger = useCallback(async () => {
    const next = !itemLedgerOpen
    setItemLedgerOpen(next)
    if (next) setItemEvents(await canonStore.getItemEvents())
  }, [itemLedgerOpen])

  /** 登记一条物品流转 */
  const handleAddItemEvent = useCallback(async () => {
    const item = itemDraft.item.trim()
    if (!item) return
    const chapter = Number.parseInt(itemDraft.chapter, 10)
    const id = await canonStore.addItemEvent({
      item,
      action: itemDraft.action,
      chapterNumber: Number.isSafeInteger(chapter) ? chapter : 0,
      actor: itemDraft.actor.trim(),
      note: itemDraft.note.trim(),
    })
    if (id) {
      setItemDraft({ item: '', action: 'obtained', chapter: '', actor: '', note: '' })
      setItemEvents(await canonStore.getItemEvents())
    }
  }, [itemDraft])

  /** 删除一条物品流转记录 */
  const handleRemoveItemEvent = useCallback(async (id: number) => {
    if (await canonStore.removeItemEvent(id)) setItemEvents(await canonStore.getItemEvents())
  }, [])

  return (
    <>
      {/* 物品流转台账：道具在谁手上、什么时候丢的，属于「作者说了算」的信息，只登记不推断 */}
      <div className="mb-3 rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <button
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs"
          style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-elevated)' }}
          onClick={() => void handleToggleItemLedger()}
        >
          {itemLedgerOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="font-medium">{t('storyBibleOverview.itemLedgerTitle')}</span>
          <span className="ml-auto text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
            {itemEvents.length > 0 ? t('storyBibleOverview.itemLedgerCount', { count: itemEvents.length }) : ''}
          </span>
        </button>
        {itemLedgerOpen && (
          <div className="px-2 py-2 space-y-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
            {itemEvents.length === 0 ? (
              <div className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
                {t('storyBibleOverview.itemLedgerEmpty')}
              </div>
            ) : [...new Set(itemEvents.map(event => event.item))].map(item => (
              <div key={item} className="flex items-baseline gap-2 text-[0.68rem]">
                <span style={{ color: 'var(--color-text)', minWidth: 80 }}>{item}</span>
                <span className="flex-1" style={{ color: 'var(--color-text-muted)' }}>
                  {itemEvents.filter(event => event.item === item).map(event => (
                    <span key={event.id} className="mr-2 whitespace-nowrap">
                      第{event.chapterNumber}章 {t(`storyBibleOverview.itemAction.${event.action}`)}
                      {event.actor ? `（${event.actor}）` : ''}
                      {event.note ? `·${event.note}` : ''}
                      <button
                        className="ml-1 align-middle"
                        style={{ color: 'var(--color-text-muted)' }}
                        title={t('storyBibleOverview.itemLedgerRemove')}
                        onClick={() => void handleRemoveItemEvent(event.id!)}
                      >×</button>
                    </span>
                  ))}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 120 }}
                placeholder={t('storyBibleOverview.itemLedgerItem')}
                value={itemDraft.item}
                onChange={e => setItemDraft(draft => ({ ...draft, item: e.target.value }))}
              />
              {/* 统一走 NativeSelect：此前是原生 select，用的是系统箭头且聚焦环与同排输入框不一致。
                  尺寸刻意压到 h-6 与同排的紧凑输入框齐平（组件默认是 h-7）。 */}
              <NativeSelect
                className="w-auto h-6"
                value={itemDraft.action}
                onChange={e => setItemDraft(draft => ({ ...draft, action: e.target.value as ItemEvent['action'] }))}
              >
                {(['obtained', 'transferred', 'lost', 'destroyed', 'consumed'] as const).map(action => (
                  <option key={action} value={action}>{t(`storyBibleOverview.itemAction.${action}`)}</option>
                ))}
              </NativeSelect>
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-mono"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 56 }}
                placeholder={t('storyBibleOverview.itemLedgerChapter')}
                value={itemDraft.chapter}
                onChange={e => setItemDraft(draft => ({ ...draft, chapter: e.target.value.replace(/[^0-9]/g, '') }))}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 88 }}
                placeholder={t('storyBibleOverview.itemLedgerActor')}
                value={itemDraft.actor}
                onChange={e => setItemDraft(draft => ({ ...draft, actor: e.target.value }))}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 120 }}
                placeholder={t('storyBibleOverview.itemLedgerNote')}
                value={itemDraft.note}
                onChange={e => setItemDraft(draft => ({ ...draft, note: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddItemEvent() } }}
              />
              <Button variant="ghost" size="sm" onClick={() => void handleAddItemEvent()}>
                <Plus size={11} />{t('storyBibleOverview.itemLedgerAdd')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center flex-wrap gap-2 mb-3">
        {([
          ['all', t('storyBibleOverview.factsFilterAll'), facts.length],
          ['pending', t('storyBibleOverview.factsFilterPending'), pendingFactCount],
          ['conflict', t('storyBibleOverview.factsFilterConflict'), conflictFactCount],
          ['confirmed', t('storyBibleOverview.factsFilterConfirmed'), confirmedFactCount],
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            className="px-2 py-0.5 rounded-md text-[0.68rem] transition-colors"
            style={{
              border: '1px solid var(--color-border)',
              backgroundColor: factFilter === id ? 'var(--color-accent)' : 'transparent',
              color: factFilter === id ? 'var(--color-on-accent)' : 'var(--color-text-secondary)',
            }}
            onClick={() => setFactFilter(id)}
          >
            {label}{count > 0 ? ` ${count}` : ''}
          </button>
        ))}
        {visibleFacts.filter(isPendingFact).length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleConfirmFacts(
              visibleFacts.filter(isPendingFact).map(fact => fact.id!).filter(id => id != null),
              true,
            )}
          >
            <Check size={11} />
            {t('storyBibleOverview.factsConfirmAll', { count: visibleFacts.filter(isPendingFact).length })}
          </Button>
        )}
      </div>
      {factsByCategory.size === 0 ? <EmptyLine text={t('storyBibleOverview.emptyFacts')} /> : (
        <div className="space-y-4">
          {[...factsByCategory.entries()].map(([category, facts]) => (
            <section key={category}>
              <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{category}</h3>
              <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                {facts.map((fact, index) => {
                  const status = fact.status ?? 'active'
                  const statusLabel = status === 'contradicted'
                    ? t('storyBibleOverview.factStatusConflict')
                    : status === 'outdated'
                      ? t('storyBibleOverview.factStatusOutdated')
                      : status === 'tentative'
                        ? t('storyBibleOverview.factStatusTentative')
                        : t('storyBibleOverview.factStatusActive')
                  const statusColor = status === 'contradicted' ? 'var(--color-warning-text)'
                    : status === 'outdated' ? 'var(--color-text-muted)'
                      : status === 'tentative' ? 'var(--color-info-text)' : 'var(--color-success-text)'
                  return (
                    <div
                      key={`${fact.id ?? fact.statement}-${index}`}
                      className="px-3 py-2 text-xs"
                      style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="flex-shrink-0 mt-[2px] px-1.5 py-[1px] rounded text-[0.6rem]"
                          style={{ border: '1px solid var(--color-border)', color: statusColor }}
                          title={fact.confirmedAt
                            ? t('storyBibleOverview.factConfirmedAt', { time: fact.confirmedAt })
                            : t('storyBibleOverview.factPendingHint')}
                        >
                          {statusLabel}
                        </span>
                        <span className="flex-1" style={{ color: 'var(--color-text)' }}>
                          {fact.statement}
                          {fact.introducedAt > 0 && (
                            <span className="ml-2 font-mono text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>Ch.{fact.introducedAt}</span>
                          )}
                          {!fact.confirmedAt && (
                            <span className="ml-2 text-[0.65rem]" style={{ color: 'var(--color-warning-text)' }}>
                              {t('storyBibleOverview.factPending')}
                            </span>
                          )}
                          {fact.evidence && (
                            <div className="mt-0.5 text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{fact.evidence}</div>
                          )}
                        </span>
                        <span className="flex items-center gap-0.5 flex-shrink-0">
                          {fact.confirmedAt ? (
                            <button
                              className="p-1 rounded transition-colors"
                              style={{ color: 'var(--color-text-secondary)' }}
                              title={t('storyBibleOverview.factActionUnconfirm')}
                              disabled={busyFactId === fact.id}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                              onClick={() => void handleConfirmFacts([fact.id!], false)}
                            ><Undo2 size={12} /></button>
                          ) : (
                            <button
                              className="p-1 rounded transition-colors"
                              style={{ color: 'var(--color-success-text)' }}
                              title={t('storyBibleOverview.factActionConfirm')}
                              disabled={busyFactId === fact.id}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                              onClick={() => void handleConfirmFacts([fact.id!], true)}
                            ><Check size={12} /></button>
                          )}
                          {status !== 'contradicted' && (
                            <button
                              className="p-1 rounded transition-colors"
                              style={{ color: 'var(--color-text-secondary)' }}
                              title={t('storyBibleOverview.factActionConflict')}
                              disabled={busyFactId === fact.id}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                              onClick={() => void handleFactStatus(fact.id!, 'contradicted')}
                            ><AlertTriangle size={12} /></button>
                          )}
                          {status !== 'outdated' ? (
                            <button
                              className="p-1 rounded transition-colors"
                              style={{ color: 'var(--color-text-secondary)' }}
                              title={t('storyBibleOverview.factActionOutdated')}
                              disabled={busyFactId === fact.id}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                              onClick={() => void handleFactStatus(fact.id!, 'outdated')}
                            ><Archive size={12} /></button>
                          ) : (
                            <button
                              className="p-1 rounded transition-colors"
                              style={{ color: 'var(--color-text-secondary)' }}
                              title={t('storyBibleOverview.factActionRestore')}
                              disabled={busyFactId === fact.id}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                              onClick={() => void handleFactStatus(fact.id!, 'active')}
                            ><RotateCcw size={12} /></button>
                          )}
                          <button
                            className="p-1 rounded transition-colors"
                            style={{ color: historyFactId === fact.id ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
                            title={t('storyBibleOverview.factActionHistory')}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                            onClick={() => void handleToggleHistory(fact.id!)}
                          ><History size={12} /></button>
                        </span>
                      </div>
                      {historyFactId === fact.id && (
                        <div className="mt-1.5 pl-2 text-[0.65rem] space-y-0.5" style={{ borderLeft: '2px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                          {factHistory.length === 0
                            ? <div>{t('storyBibleOverview.factHistoryEmpty')}</div>
                            : factHistory.map(entry => (
                              <div key={entry.id}>
                                <span className="font-mono">{entry.at}</span>
                                <span className="ml-2">{t(`storyBibleOverview.factHistoryAction.${entry.action}`, entry.action)}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
