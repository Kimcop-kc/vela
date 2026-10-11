/**
 * 境界阶梯：迁移 + 存取
 *
 * 作者维护一张由低到高的境界表（能力范围 / 限制 / 突破条件），它会进入写作提示词，
 * 约束战斗与突破描写。老库必须能安全升级（只加表）。
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
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-realms-'))
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-realms-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

/** 伪造 v6 老库：没有境界表 */
function createLegacyV6Database(projectPath: string): void {
  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE canon_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, statement TEXT NOT NULL,
      introduced_at INTEGER DEFAULT 0, characters TEXT DEFAULT '[]', evidence TEXT DEFAULT '',
      status TEXT DEFAULT 'active', confirmed_at TEXT, updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO canon_facts (category, statement, introduced_at, characters, evidence, status)
    VALUES ('world', '地脉逆旋可通缝隙', 7, '[]', '', 'active');
  `)
  legacy.pragma('user_version = 6')
  legacy.close()
}

describe('境界表迁移（v6 → v7）', () => {
  it('老库加表后数据仍在，且重复打开幂等', () => {
    createLegacyV6Database(folder)
    initProjectDatabase(folder)

    const db = getProjectDb()!
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='canon_realms'`).get()).toBeTruthy()
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(7)
    expect(CanonRepository.getFacts()).toHaveLength(1)
    expect(CanonRepository.getRealms()).toEqual([])

    initProjectDatabase(folder)
    expect(CanonRepository.getFacts()).toHaveLength(1)
  })
})

describe('境界阶梯存取', () => {
  beforeEach(() => {
    initProjectDatabase(folder)
  })

  it('按阶数从低到高排序', () => {
    CanonRepository.upsertRealm({ name: '筑基', rankOrder: 2, abilities: '御器飞行' })
    CanonRepository.upsertRealm({ name: '练气', rankOrder: 1, abilities: '引气入体' })
    CanonRepository.upsertRealm({ name: '金丹', rankOrder: 3 })

    expect(CanonRepository.getRealms().map(realm => realm.name)).toEqual(['练气', '筑基', '金丹'])
  })

  it('同名视为更新，不会重复建行', () => {
    const first = CanonRepository.upsertRealm({ name: '筑基', rankOrder: 2, abilities: '御器' })
    const second = CanonRepository.upsertRealm({ name: '筑基', rankOrder: 2, abilities: '御器飞行，可短暂滞空' })

    expect(second).toBe(first)
    expect(CanonRepository.getRealms()).toHaveLength(1)
    expect(CanonRepository.getRealms()[0].abilities).toContain('滞空')
  })

  it('带 id 时按 id 更新（改名不会留下旧行）', () => {
    const id = CanonRepository.upsertRealm({ name: '筑基', rankOrder: 2 })
    CanonRepository.upsertRealm({ id, name: '筑基中期', rankOrder: 2, limits: '灵力有限' })

    const realms = CanonRepository.getRealms()
    expect(realms).toHaveLength(1)
    expect(realms[0].name).toBe('筑基中期')
    expect(realms[0].limits).toBe('灵力有限')
  })

  it('字段限长、空名报错、可删除', () => {
    const id = CanonRepository.upsertRealm({ name: '金丹', rankOrder: 3, breakthrough: 'x'.repeat(900) })
    expect(CanonRepository.getRealms()[0].breakthrough!.length).toBe(500)
    expect(() => CanonRepository.upsertRealm({ name: '  ', rankOrder: 1 })).toThrow()

    expect(CanonRepository.removeRealm(id)).toBe(true)
    expect(CanonRepository.removeRealm(id)).toBe(false)
  })
})
