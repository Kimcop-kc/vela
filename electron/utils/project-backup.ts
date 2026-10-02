import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { closeConnection } from '../vector-store'

export type SnapshotTrigger = 'manual' | 'auto_before_restore'

export interface ProjectSnapshotInfo {
  id: string
  createdAt: string
  trigger: SnapshotTrigger
  note: string
  size: number
  hasDatabase: boolean
  hasPrompts: boolean
  hasPromptHistory: boolean
  hasBooks: boolean
  hasVectors: boolean
  appVersion: string
}

interface SnapshotManifest extends ProjectSnapshotInfo {
  projectPath: string
  formatVersion: 1
}

const SNAPSHOT_ROOT = path.join('.vela', 'backups')
const MAX_SNAPSHOTS = 20

function snapshotRoot(projectPath: string): string {
  return path.join(projectPath, SNAPSHOT_ROOT)
}

function snapshotDir(projectPath: string, id: string): string {
  if (!/^[0-9a-fTZ-]+$/.test(id)) throw new Error('无效的快照标识')
  return path.join(snapshotRoot(projectPath), id)
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target)
    return true
  } catch {
    return false
  }
}

async function directorySize(target: string): Promise<number> {
  if (!await exists(target)) return 0
  const stat = await fs.promises.stat(target)
  if (stat.isFile()) return stat.size
  let total = 0
  for (const entry of await fs.promises.readdir(target, { withFileTypes: true })) {
    total += await directorySize(path.join(target, entry.name))
  }
  return total
}

async function copyIfExists(source: string, target: string): Promise<boolean> {
  if (!await exists(source)) return false
  await fs.promises.cp(source, target, { recursive: true, force: true, errorOnExist: false })
  return true
}

async function removeIfExists(target: string): Promise<void> {
  await fs.promises.rm(target, { recursive: true, force: true })
}

async function readManifest(projectPath: string, id: string): Promise<SnapshotManifest | null> {
  try {
    const raw = await fs.promises.readFile(path.join(snapshotDir(projectPath, id), 'manifest.json'), 'utf8')
    return JSON.parse(raw) as SnapshotManifest
  } catch {
    return null
  }
}

export async function listProjectSnapshots(projectPath: string): Promise<ProjectSnapshotInfo[]> {
  const root = snapshotRoot(projectPath)
  if (!await exists(root)) return []
  const snapshots: ProjectSnapshotInfo[] = []
  for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.tmp-')) continue
    const manifest = await readManifest(projectPath, entry.name)
    if (manifest) snapshots.push(manifest)
  }
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function cleanupSnapshots(projectPath: string): Promise<void> {
  const snapshots = await listProjectSnapshots(projectPath)
  for (const snapshot of snapshots.slice(MAX_SNAPSHOTS)) {
    await removeIfExists(snapshotDir(projectPath, snapshot.id))
  }
}

export async function createProjectSnapshot(
  projectPath: string,
  trigger: SnapshotTrigger = 'manual',
  note = '',
): Promise<ProjectSnapshotInfo> {
  if (!projectPath || !path.isAbsolute(projectPath)) throw new Error('无效的项目路径')
  if (!getProjectDb()) initProjectDatabase(projectPath)

  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const root = snapshotRoot(projectPath)
  const temporary = path.join(root, `.tmp-${id}`)
  const target = snapshotDir(projectPath, id)
  await fs.promises.mkdir(temporary, { recursive: true })

  try {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')
    const databasePath = path.join(temporary, 'vela.db')
    await db.backup(databasePath)

    const hasPrompts = await copyIfExists(path.join(projectPath, '.vela', 'prompts'), path.join(temporary, 'prompts'))
    const hasPromptHistory = await copyIfExists(path.join(projectPath, '.vela', 'prompt-history'), path.join(temporary, 'prompt-history'))
    const hasBooks = await copyIfExists(path.join(projectPath, '.vela', 'books'), path.join(temporary, 'books'))

    closeConnection(projectPath)
    const hasVectors = await copyIfExists(path.join(projectPath, '.vela', 'lancedb'), path.join(temporary, 'lancedb'))
    const hasLegacyVectors = await copyIfExists(path.join(projectPath, '.vela', 'vectors.json'), path.join(temporary, 'vectors.json'))

    const manifest: SnapshotManifest = {
      id,
      createdAt: new Date().toISOString(),
      trigger,
      note,
      size: 0,
      hasDatabase: true,
      hasPrompts,
      hasPromptHistory,
      hasBooks,
      hasVectors: hasVectors || hasLegacyVectors,
      appVersion: process.env.npm_package_version ?? '',
      projectPath,
      formatVersion: 1,
    }
    manifest.size = await directorySize(temporary)
    await fs.promises.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    await fs.promises.rename(temporary, target)
    await cleanupSnapshots(projectPath)
    return manifest
  } catch (error) {
    await removeIfExists(temporary)
    throw error
  }
}

export async function restoreProjectSnapshot(projectPath: string, id: string): Promise<ProjectSnapshotInfo> {
  const source = snapshotDir(projectPath, id)
  const manifest = await readManifest(projectPath, id)
  if (!manifest || !await exists(path.join(source, 'vela.db'))) throw new Error('快照不存在或已损坏')

  await createProjectSnapshot(projectPath, 'auto_before_restore', `恢复 ${id} 前自动备份`)
  closeProjectDatabase()
  closeConnection(projectPath)

  const velaDir = path.join(projectPath, '.vela')
  const databasePath = path.join(velaDir, 'vela.db')
  const temporaryDatabase = path.join(velaDir, `vela.db.restore-${Date.now()}.tmp`)

  await fs.promises.copyFile(path.join(source, 'vela.db'), temporaryDatabase)
  await removeIfExists(databasePath)
  await removeIfExists(`${databasePath}-wal`)
  await removeIfExists(`${databasePath}-shm`)
  await fs.promises.rename(temporaryDatabase, databasePath)

  if (manifest.hasPrompts) {
    await removeIfExists(path.join(velaDir, 'prompts'))
    await copyIfExists(path.join(source, 'prompts'), path.join(velaDir, 'prompts'))
  }
  if (manifest.hasPromptHistory) {
    await removeIfExists(path.join(velaDir, 'prompt-history'))
    await copyIfExists(path.join(source, 'prompt-history'), path.join(velaDir, 'prompt-history'))
  }
  if (manifest.hasBooks) {
    await removeIfExists(path.join(velaDir, 'books'))
    await copyIfExists(path.join(source, 'books'), path.join(velaDir, 'books'))
  }
  if (manifest.hasVectors) {
    await removeIfExists(path.join(velaDir, 'lancedb'))
    await removeIfExists(path.join(velaDir, 'vectors.json'))
    await copyIfExists(path.join(source, 'lancedb'), path.join(velaDir, 'lancedb'))
    await copyIfExists(path.join(source, 'vectors.json'), path.join(velaDir, 'vectors.json'))
  }

  initProjectDatabase(projectPath)
  return manifest
}

export async function deleteProjectSnapshot(projectPath: string, id: string): Promise<void> {
  await removeIfExists(snapshotDir(projectPath, id))
}
