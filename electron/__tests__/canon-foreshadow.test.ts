/**
 * 伏笔台账：迁移 + 存取
 *
 * 剧情线表新增 kind（剧情线 / 伏笔）与 planned_resolve_at（预计回收阶段），
 * 老库必须能安全升级，且默认行为不变（未标记的按剧情线处理）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { CanonRepository } from '../repositories/canon-repository'

let folder = ''

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-canon-foreshadow-'))
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-canon-foreshadow-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

/** 伪造 v3 老库：canon_plot_lines 没有 kind / planned_resolve_at，且已有数据 */
function createLegacyV3Database(projectPath: string): void {
  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE canon_plot_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      started_at INTEGER DEFAULT 0,
      last_advanced_at INTEGER DEFAULT 0,
      resolved_at INTEGER,
      characters TEXT DEFAULT '[]',
      current_state TEXT DEFAULT '',
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO canon_plot_lines (name, status, started_at, last_advanced_at, characters, current_state)
    VALUES ('逆旋纹的来历', 'active', 9, 11, '["顾野"]', '顾野在井壁看到逆旋纹');
  `)
  legacy.pragma('user_version = 3')
  legacy.close()
}

describe('剧情线表迁移（v3 → v4）', () => {
  it('老库加列后数据仍在，未标记的按剧情线处理', () => {
    createLegacyV3Database(folder)
    initProjectDatabase(folder)

    const db = getProjectDb()!
    const columns = (db.prepare('PRAGMA table_info(canon_plot_lines)').all() as Array<{ name: string }>).map(c => c.name)
    expect(columns).toContain('kind')
    expect(columns).toContain('planned_resolve_at')
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(4)

    const lines = CanonRepository.getPlotLines()
    expect(lines).toHaveLength(1)
    expect(lines[0].name).toBe('逆旋纹的来历')
    expect(lines[0].kind).toBe('plot')
    expect(lines[0].plannedResolveAt).toBe('')

    // 幂等：再打开一次不报错
    initProjectDatabase(folder)
    expect(CanonRepository.getPlotLines()).toHaveLength(1)
  })
})

describe('伏笔台账存取', () => {
  beforeEach(() => {
    initProjectDatabase(folder)
  })

  it('新建时按剧情线处理，可标记为伏笔并记录预计回收阶段', () => {
    const id = CanonRepository.addPlotLine({
      name: '井台封泥下的入口', status: 'active', startedAt: 9, lastAdvancedAt: 11,
      characters: ['顾野'], currentState: '顾野看到封泥', description: '',
    })

    expect(CanonRepository.getPlotLines()[0].kind).toBe('plot')

    CanonRepository.updatePlotLineMeta(id, { kind: 'foreshadow', plannedResolveAt: '中期' })
    const line = CanonRepository.getPlotLines().find(item => item.id === id)!
    expect(line.kind).toBe('foreshadow')
    expect(line.plannedResolveAt).toBe('中期')

    // 只改台账信息，不动状态与进度
    expect(line.status).toBe('active')
    expect(line.lastAdvancedAt).toBe(11)

    CanonRepository.updatePlotLineMeta(id, { kind: 'plot' })
    expect(CanonRepository.getPlotLines().find(item => item.id === id)!.kind).toBe('plot')
  })

  it('预计回收阶段是自由文本且有长度上限', () => {
    const id = CanonRepository.addPlotLine({
      name: '残简断口的凉气', status: 'active', startedAt: 12, lastAdvancedAt: 12,
      characters: [], currentState: '', description: '',
    })

    CanonRepository.updatePlotLineMeta(id, { plannedResolveAt: '第'.repeat(200) })
    expect(CanonRepository.getPlotLines().find(item => item.id === id)!.plannedResolveAt!.length).toBe(60)
  })

  it('按名字去重不受台账字段影响', () => {
    const first = CanonRepository.addPlotLine({
      name: '逆旋纹', status: 'active', startedAt: 9, lastAdvancedAt: 9,
      characters: [], currentState: '', description: '', kind: 'foreshadow', plannedResolveAt: '后期',
    })
    const second = CanonRepository.addPlotLine({
      name: '逆旋纹', status: 'active', startedAt: 20, lastAdvancedAt: 20,
      characters: [], currentState: '', description: '',
    })

    expect(second).toBe(first)
    expect(CanonRepository.getPlotLines()).toHaveLength(1)
  })
})
