/**
 * 地点与空间关系：迁移 + 存取
 *
 * 作者登记若干地点（区域 / 势力 / 与别处的距离 / 通行方式与耗时），它会进入写作提示词，
 * 让模型写人物移动时守住空间关系。老库必须能安全升级（只加表）。
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
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-locations-'))
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-locations-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

/** 伪造 v7 老库：没有地点表 */
function createLegacyV7Database(projectPath: string): void {
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
  legacy.pragma('user_version = 7')
  legacy.close()
}

describe('地点表迁移（v7 → v8）', () => {
  it('老库加表后数据仍在，且重复打开幂等', () => {
    createLegacyV7Database(folder)
    initProjectDatabase(folder)

    const db = getProjectDb()!
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='canon_locations'`).get()).toBeTruthy()
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(8)
    expect(CanonRepository.getFacts()).toHaveLength(1)
    expect(CanonRepository.getLocations()).toEqual([])

    initProjectDatabase(folder)
    expect(CanonRepository.getFacts()).toHaveLength(1)
  })
})

describe('地点存取', () => {
  beforeEach(() => {
    initProjectDatabase(folder)
  })

  it('按区域、名称排序', () => {
    CanonRepository.upsertLocation({ name: '黑水渡口', region: '云州西部' })
    CanonRepository.upsertLocation({ name: '青石镇', region: '云州西部' })
    CanonRepository.upsertLocation({ name: '落雷谷', region: '北境' })

    // 区域优先（同区域的人会连在一起），区域内按名称；中文按码点序
    expect(CanonRepository.getLocations().map(l => l.name)).toEqual(['青石镇', '黑水渡口', '落雷谷'])
  })

  it('同名视为更新，不会重复建行', () => {
    const first = CanonRepository.upsertLocation({ name: '黑水渡口', distanceNote: '距青石镇一日脚程' })
    const second = CanonRepository.upsertLocation({ name: '黑水渡口', distanceNote: '距青石镇一日脚程', travelNote: '渡船，逢雨停摆' })

    expect(second).toBe(first)
    expect(CanonRepository.getLocations()).toHaveLength(1)
    expect(CanonRepository.getLocations()[0].travelNote).toContain('渡船')
  })

  it('带 id 时按 id 更新（改名不会留下旧行）', () => {
    const id = CanonRepository.upsertLocation({ name: '黑水渡口' })
    CanonRepository.upsertLocation({ id, name: '黑水码头', faction: '周家' })

    const locations = CanonRepository.getLocations()
    expect(locations).toHaveLength(1)
    expect(locations[0].name).toBe('黑水码头')
    expect(locations[0].faction).toBe('周家')
  })

  it('字段限长、空名报错、可删除', () => {
    const id = CanonRepository.upsertLocation({ name: '落雷谷', distanceNote: 'x'.repeat(900), region: 'y'.repeat(400) })
    const saved = CanonRepository.getLocations()[0]
    expect(saved.distanceNote!.length).toBe(500)
    expect(saved.region!.length).toBe(200)
    expect(() => CanonRepository.upsertLocation({ name: '  ' })).toThrow()

    expect(CanonRepository.removeLocation(id)).toBe(true)
    expect(CanonRepository.removeLocation(id)).toBe(false)
  })
})
