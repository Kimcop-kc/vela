/**
 * 故事圣经 · 地点与空间关系分区
 *
 * 自行拉取与保存地点数据（含草稿），不占用外层页面的 state。
 * `reloadToken` 由外层页面在「刷新 / 收到外部资源变更事件」时递增，用来触发重新拉取；
 * 首次挂载时也会拉一次，所以外层不需要在初次加载里额外查一遍地点。
 *
 * 编辑即保存：输入框用 defaultValue + onBlur，失焦时只在内容真的变了才写库。
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { Location } from '../../../services/narrative-consistency'
import { canonStore } from '../../../services/narrative-consistency'
import { Button } from '../../ui/Button'
import { EmptyLine } from './parts'

interface LocationsSectionProps {
  /** 外层页面每次刷新后递增，用于触发重新拉取 */
  reloadToken: number
}

export function LocationsSection({ reloadToken }: LocationsSectionProps) {
  const { t } = useTranslation('pages')
  /** 地点与空间关系 */
  const [locations, setLocations] = useState<Location[]>([])
  const [locationDraft, setLocationDraft] = useState({ name: '', region: '' })

  // 挂载时拉一次；reloadToken 变化（外层刷新 / 外部资源变更）时重拉。
  // 用 .then 而非 async 函数体直接 setState：避免在 effect 里同步触发级联渲染，
  // 顺带处理组件已卸载的情况。
  useEffect(() => {
    let cancelled = false
    void canonStore.getLocations().then(rows => {
      if (!cancelled) setLocations(rows)
    })
    return () => { cancelled = true }
  }, [reloadToken])

  /** 保存一个地点（改完即存：只在内容真的变了时写库） */
  const handleSaveLocation = useCallback(async (location: Location, patch: Partial<Location>) => {
    const next: Location = { ...location, ...patch }
    if (!next.name.trim()) return
    const changed = (Object.keys(patch) as Array<keyof Location>).some(key => (location[key] ?? '') !== (next[key] ?? ''))
    if (!changed) return
    if (await canonStore.upsertLocation(next)) setLocations(await canonStore.getLocations())
  }, [])

  /** 新增一个地点 */
  const handleAddLocation = useCallback(async () => {
    const name = locationDraft.name.trim()
    if (!name) return
    if (await canonStore.upsertLocation({ name, region: locationDraft.region.trim() })) {
      setLocationDraft({ name: '', region: '' })
      setLocations(await canonStore.getLocations())
    }
  }, [locationDraft])

  /** 删除一个地点 */
  const handleRemoveLocation = useCallback(async (id: number) => {
    if (await canonStore.removeLocation(id)) setLocations(await canonStore.getLocations())
  }, [])

  return (
    <>
      <div className="text-[0.68rem] mb-2" style={{ color: 'var(--color-text-muted)' }}>
        {t('storyBibleOverview.locationHint')}
      </div>
      {locations.length === 0 ? <EmptyLine text={t('storyBibleOverview.locationEmpty')} /> : (
        <div className="rounded-md overflow-hidden mb-3" style={{ border: '1px solid var(--color-border)' }}>
          {locations.map((location, index) => (
            <div
              key={location.id}
              className="px-2 py-2 flex items-center gap-1.5 flex-wrap text-[0.68rem]"
              style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border)' }}
            >
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none font-medium"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 110 }}
                defaultValue={location.name}
                onBlur={e => void handleSaveLocation(location, { name: e.target.value.trim() || location.name })}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 100 }}
                placeholder={t('storyBibleOverview.locationRegion')}
                defaultValue={location.region ?? ''}
                onBlur={e => void handleSaveLocation(location, { region: e.target.value })}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 100 }}
                placeholder={t('storyBibleOverview.locationFaction')}
                defaultValue={location.faction ?? ''}
                onBlur={e => void handleSaveLocation(location, { faction: e.target.value })}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                placeholder={t('storyBibleOverview.locationDistance')}
                defaultValue={location.distanceNote ?? ''}
                onBlur={e => void handleSaveLocation(location, { distanceNote: e.target.value })}
              />
              <input
                className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none flex-1"
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 140 }}
                placeholder={t('storyBibleOverview.locationTravel')}
                defaultValue={location.travelNote ?? ''}
                onBlur={e => void handleSaveLocation(location, { travelNote: e.target.value })}
              />
              <button
                className="p-1 rounded"
                style={{ color: 'var(--color-text-muted)' }}
                title={t('storyBibleOverview.locationRemove')}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                onClick={() => void handleRemoveLocation(location.id!)}
              >×</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
          style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 110 }}
          placeholder={t('storyBibleOverview.locationName')}
          value={locationDraft.name}
          onChange={e => setLocationDraft(draft => ({ ...draft, name: e.target.value }))}
        />
        <input
          className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
          style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: 100 }}
          placeholder={t('storyBibleOverview.locationRegion')}
          value={locationDraft.region}
          onChange={e => setLocationDraft(draft => ({ ...draft, region: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddLocation() } }}
        />
        <Button variant="ghost" size="sm" onClick={() => void handleAddLocation()}>
          <Plus size={11} />{t('storyBibleOverview.locationAdd')}
        </Button>
      </div>
    </>
  )
}
