import { ipc } from './ipc-client'
import type { ProjectSnapshotInfo } from '../shared/ipc-channels'

export type { ProjectSnapshotInfo }

export async function listProjectSnapshots(projectPath: string): Promise<ProjectSnapshotInfo[]> {
  const result = await ipc.invoke('backup:list', projectPath)
  if (!result.success) throw new Error(result.error || '读取快照失败')
  return result.snapshots
}

export async function createProjectSnapshot(projectPath: string, note = ''): Promise<ProjectSnapshotInfo> {
  const result = await ipc.invoke('backup:create', projectPath, note)
  if (!result.success || !result.snapshot) throw new Error(result.error || '创建快照失败')
  return result.snapshot
}

export async function restoreProjectSnapshot(projectPath: string, id: string): Promise<ProjectSnapshotInfo> {
  const result = await ipc.invoke('backup:restore', projectPath, id)
  if (!result.success || !result.snapshot) throw new Error(result.error || '恢复快照失败')
  return result.snapshot
}

export async function deleteProjectSnapshot(projectPath: string, id: string): Promise<void> {
  const result = await ipc.invoke('backup:delete', projectPath, id)
  if (!result.success) throw new Error(result.error || '删除快照失败')
}

export async function openProjectBackupFolder(projectPath: string): Promise<string> {
  const result = await ipc.invoke('backup:open-folder', projectPath)
  if (!result.success) throw new Error(result.error || '打开备份目录失败')
  return result.path
}
