import { useCallback, useEffect, useState } from 'react'
import { Archive, FolderOpen, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'
import {
  createProjectSnapshot,
  deleteProjectSnapshot,
  listProjectSnapshots,
  openProjectBackupFolder,
  restoreProjectSnapshot,
  type ProjectSnapshotInfo,
} from '../../services/backup-service'
import { Button } from '../ui/Button'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function BackupSettings() {
  const { t } = useTranslation('settings')
  const project = useProjectStore(s => s.currentProject)
  const openProject = useProjectStore(s => s.openProject)
  const [snapshots, setSnapshots] = useState<ProjectSnapshotInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!project?.path) {
      setSnapshots([])
      return
    }
    setLoading(true)
    try {
      setSnapshots(await listProjectSnapshots(project.path))
    } catch (error) {
      toast.error(t('backup.loadFailed', { error: String(error) }))
    } finally {
      setLoading(false)
    }
  }, [project?.path, t])

  useEffect(() => { void refresh() }, [refresh])

  const handleCreate = async () => {
    if (!project?.path) return
    setLoading(true)
    try {
      await createProjectSnapshot(project.path, t('backup.manualNote'))
      await refresh()
      toast.success(t('backup.created'))
    } catch (error) {
      toast.error(t('backup.createFailed', { error: String(error) }))
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async (snapshot: ProjectSnapshotInfo) => {
    if (!project?.path) return
    const ok = await confirm(t('backup.restoreConfirm', { time: new Date(snapshot.createdAt).toLocaleString() }), {
      title: t('backup.restoreTitle'),
      confirmText: t('backup.restoreConfirmBtn'),
      danger: true,
    })
    if (!ok) return
    setBusyId(snapshot.id)
    try {
      await restoreProjectSnapshot(project.path, snapshot.id)
      await openProject(project.path)
      toast.success(t('backup.restored'))
    } catch (error) {
      toast.error(t('backup.restoreFailed', { error: String(error) }))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (snapshot: ProjectSnapshotInfo) => {
    if (!project?.path) return
    const ok = await confirm(t('backup.deleteConfirm', { time: new Date(snapshot.createdAt).toLocaleString() }), {
      title: t('backup.deleteTitle'),
      confirmText: t('backup.deleteConfirmBtn'),
      danger: true,
    })
    if (!ok) return
    setBusyId(snapshot.id)
    try {
      await deleteProjectSnapshot(project.path, snapshot.id)
      await refresh()
      toast.success(t('backup.deleted'))
    } catch (error) {
      toast.error(t('backup.deleteFailed', { error: String(error) }))
    } finally {
      setBusyId(null)
    }
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Archive size={28} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('backup.noProject')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div
        className="flex items-start justify-between gap-4 p-4 rounded-xl"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
      >
        <div className="flex gap-3 min-w-0">
          <ShieldCheck size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('backup.title')}</p>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              {t('backup.description')}
            </p>
          </div>
        </div>
        <Button onClick={handleCreate} disabled={loading} className="flex-shrink-0">
          <Archive size={13} />
          {t('backup.create')}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {t('backup.count', { count: snapshots.length })}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {t('backup.refresh')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void openProjectBackupFolder(project.path)}>
            <FolderOpen size={12} />
            {t('backup.openFolder')}
          </Button>
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl" style={{ border: '1.5px dashed var(--color-border)' }}>
          <Archive size={28} style={{ color: 'var(--color-text-muted)', opacity: 0.45 }} />
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{t('backup.empty')}</span>
        </div>
      ) : (
        <div className="space-y-2">
          {snapshots.map(snapshot => (
            <div
              key={snapshot.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
            >
              <Archive size={16} className="flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>
                    {new Date(snapshot.createdAt).toLocaleString()}
                  </span>
                  <span
                    className="text-[0.65rem] px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: snapshot.trigger === 'manual' ? 'var(--color-accent-soft)' : 'var(--color-hover)',
                      color: snapshot.trigger === 'manual' ? 'var(--color-info-text)' : 'var(--color-text-muted)',
                    }}
                  >
                    {snapshot.trigger === 'manual' ? t('backup.manual') : t('backup.beforeRestore')}
                  </span>
                </div>
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {formatSize(snapshot.size)} · {snapshot.hasVectors ? t('backup.withVectors') : t('backup.databaseOnly')}
                  {snapshot.note ? ` · ${snapshot.note}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="outline" size="sm" disabled={busyId === snapshot.id} onClick={() => void handleRestore(snapshot)}>
                  <RotateCcw size={12} />
                  {t('backup.restore')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busyId === snapshot.id}
                  onClick={() => void handleDelete(snapshot)}
                  title={t('backup.delete')}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
