import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeProjectDatabase, initProjectDatabase } from '../database'
import { ProjectCoreRepository } from '../repositories/project-core-repository'
import {
  createProjectSnapshot,
  deleteProjectSnapshot,
  listProjectSnapshots,
  restoreProjectSnapshot,
} from '../utils/project-backup'

const tempDirs: string[] = []

function makeProject(): string {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-backup-'))
  tempDirs.push(projectPath)
  initProjectDatabase(projectPath)
  ProjectCoreRepository.init('Original')
  ProjectCoreRepository.update({ genre: '玄幻' })
  return projectPath
}

afterEach(() => {
  closeProjectDatabase()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('project snapshots', () => {
  it('creates, lists, restores, and deletes a complete project snapshot', async () => {
    const projectPath = makeProject()
    const snapshot = await createProjectSnapshot(projectPath, 'manual', 'test snapshot')

    expect(snapshot.id).toMatch(/^[0-9a-fTZ-]+$/)
    expect(snapshot.hasDatabase).toBe(true)
    expect(snapshot.size).toBeGreaterThan(0)
    expect((await listProjectSnapshots(projectPath)).map(item => item.id)).toContain(snapshot.id)

    ProjectCoreRepository.update({ projectName: 'Changed', genre: '都市' })
    expect(ProjectCoreRepository.get()?.projectName).toBe('Changed')

    await restoreProjectSnapshot(projectPath, snapshot.id)
    const restored = ProjectCoreRepository.get()
    expect(restored?.projectName).toBe('Original')
    expect(restored?.genre).toBe('玄幻')

    const snapshotsAfterRestore = await listProjectSnapshots(projectPath)
    expect(snapshotsAfterRestore.some(item => item.trigger === 'auto_before_restore')).toBe(true)

    await deleteProjectSnapshot(projectPath, snapshot.id)
    expect((await listProjectSnapshots(projectPath)).some(item => item.id === snapshot.id)).toBe(false)
  })
})
