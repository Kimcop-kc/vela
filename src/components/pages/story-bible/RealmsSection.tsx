/**
 * 故事圣经 · 境界阶梯分区
 *
 * 自行拉取与保存境界数据（含草稿），不占用外层页面的 state。
 * `reloadToken` 由外层页面在「刷新 / 收到外部资源变更事件」时递增，用来触发重新拉取；
 * 首次挂载时也会拉一次，所以外层不需要在初次加载里额外查一遍境界。
 *
 * 编辑即保存：输入框用 defaultValue + onBlur，失焦时只在内容真的变了才写库。
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { Realm } from '../../../services/narrative-consistency'
import { canonStore } from '../../../services/narrative-consistency'
import { Button } from '../../ui/Button'
import { EmptyLine } from './parts'

interface RealmsSectionProps {
  /** 外层页面每次刷新后递增，用于触发重新拉取 */
  reloadToken: number
}

export function RealmsSection({ reloadToken }: RealmsSectionProps) {
  const { t } = useTranslation('pages')
  /** 境界阶梯（阶数从低到高） */
  const [realms, setRealms] = useState<Realm[]>([])
  const [realmDraft, setRealmDraft] = useState({ name: '', rankOrder: '' })

  // 挂载时拉一次；reloadToken 变化（外层刷新 / 外部资源变更）时重拉。
  // 用 .then 而非 async 函数体直接 setState：避免在 effect 里同步触发级联渲染，
  // 顺带处理组件已卸载的情况。
  useEffect(() => {
    let cancelled = false
    void canonStore.getRealms().then(rows => {
      if (!cancelled) setRealms(rows)
    })
    return () => { cancelled = true }
  }, [reloadToken])

  /** 保存一阶境界（改完即存：只在内容真的变了时写库） */
  const handleSaveRealm = useCallback(async (realm: Realm, patch: Partial<Realm>) => {
    const next: Realm = { ...realm, ...patch }
    if (!next.name.trim()) return
    const changed = (Object.keys(patch) as Array<keyof Realm>).some(key => (realm[key] ?? '') !== (next[key] ?? ''))
    if (!changed) return
    if (await canonStore.upsertRealm(next)) setRealms(await canonStore.getRealms())
  }, [])

  /** 新增一阶境界 */
  const handleAddRealm = useCallback(async () => {
    const name = realmDraft.name.trim()
    if (!name) return
    const rankOrder = Number.parseInt(realmDraft.rankOrder, 10)
    if (await canonStore.upsertRealm({
      name,
      rankOrder: Number.isSafeInteger(rankOrder) ? rankOrder : realms.length + 1,
      abilities: '', limits: '', breakthrough: '',
    })) {
      setRealmDraft({ name: '', rankOrder: '' })
      setRealms(await canonStore.getRealms())
    }
  }, [realmDraft, realms.length])

  /** 删除一阶境界 */
  const handleRemoveRealm = useCallback(async (id: number) => {
    if (await canonStore.removeRealm(id)) setRealms(await canonStore.getRealms())
  }, [])

  return (
    <>
      <div className="text-[0.68rem] mb-2" style={{ color: 'var(--color-text-muted)' }}>
        {t('storyBibleOverview.realmHint')}
      </div>
      {realms.length === 0 ? <EmptyLine text={t('storyBibleOverview.realmEmpty')} /> : (
        <div className="rounded-md overflow-hidden mb-3" style={{ border: '1px solid var(--color-border)' }}>
          {realms.map((realm, index) => (
            <div
              key={realm.id}
              className="px-2 py-2 flex items-center gap-1.5 flex-wrap text-[0.68rem]"
              style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}
            >
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-mono text-center"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 44 }}
                defaultValue={String(realm.rankOrder)}
                title={t('storyBibleOverview.realmRank')}
                onBlur={e => void handleSaveRealm(realm, { rankOrder: Number.parseInt(e.target.value, 10) || 0 })}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-medium"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 110 }}
                defaultValue={realm.name}
                onBlur={e => void handleSaveRealm(realm, { name: e.target.value.trim() || realm.name })}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                placeholder={t('storyBibleOverview.realmAbilities')}
                defaultValue={realm.abilities ?? ''}
                onBlur={e => void handleSaveRealm(realm, { abilities: e.target.value })}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                placeholder={t('storyBibleOverview.realmLimits')}
                defaultValue={realm.limits ?? ''}
                onBlur={e => void handleSaveRealm(realm, { limits: e.target.value })}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                placeholder={t('storyBibleOverview.realmBreakthrough')}
                defaultValue={realm.breakthrough ?? ''}
                onBlur={e => void handleSaveRealm(realm, { breakthrough: e.target.value })}
              />
              <button
                className="p-1 rounded"
                style={{ color: 'var(--color-text-muted)' }}
                title={t('storyBibleOverview.realmRemove')}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                onClick={() => void handleRemoveRealm(realm.id!)}
              >×</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
          style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 110 }}
          placeholder={t('storyBibleOverview.realmName')}
          value={realmDraft.name}
          onChange={e => setRealmDraft(draft => ({ ...draft, name: e.target.value }))}
        />
        <input
          className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-mono text-center"
          style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 44 }}
          placeholder={t('storyBibleOverview.realmRank')}
          value={realmDraft.rankOrder}
          onChange={e => setRealmDraft(draft => ({ ...draft, rankOrder: e.target.value.replace(/[^0-9]/g, '') }))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddRealm() } }}
        />
        <Button variant="ghost" size="sm" onClick={() => void handleAddRealm()}>
          <Plus size={11} />{t('storyBibleOverview.realmAdd')}
        </Button>
      </div>
    </>
  )
}
