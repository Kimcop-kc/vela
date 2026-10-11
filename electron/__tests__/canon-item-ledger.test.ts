/**
 * 物品流转台账：迁移 + 存取
 *
 * 道具的去向属于「作者说了算」的信息，所以台账只做登记，不做自动推断。
 * 老库必须能安全升级（只加表，不动数据）。
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
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-item-ledger-'))
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-item-ledger-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

/** 伪造 v5 老库：没有任何物品台账表 */
function createLegacyV5Database(projectPath: string): void {
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
    VALUES ('item', '顾野得到一截炭笔', 3, '["顾野"]', '炭笔', 'active');
  `)
  legacy.pragma('user_version = 5')
  legacy.close()
}

describe('物品台账迁移（v5 → v6）', () => {
  it('老库加表后数据仍在，且重复打开幂等', () => {
    createLegacyV5Database(folder)
    initProjectDatabase(folder)

    const db = getProjectDb()!
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='canon_item_events'`).get()).toBeTruthy()
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(6)
    expect(CanonRepository.getFacts()).toHaveLength(1)
    expect(CanonRepository.getItemEvents()).toEqual([])

    initProjectDatabase(folder)
    expect(CanonRepository.getFacts()).toHaveLength(1)
  })
})

describe('物品流转登记', () => {
  beforeEach(() => {
    initProjectDatabase(folder)
  })

  it('按物品与章节记录，并可按物品过滤', () => {
    CanonRepository.addItemEvent({ item: '炭笔', action: 'obtained', chapterNumber: 3, actor: '顾野' })
    CanonRepository.addItemEvent({ item: '炭笔', action: 'consumed', chapterNumber: 20, note: '画引火纹烧掉了' })
    CanonRepository.addItemEvent({ item: '残契', action: 'obtained', chapterNumber: 11, actor: '顾野' })

    const all = CanonRepository.getItemEvents()
    expect(all).toHaveLength(3)
    // 按物品名排序，同一物品内按章节升序
    expect(all.map(event => `${event.item}#${event.chapterNumber}`)).toEqual(['残契#11', '炭笔#3', '炭笔#20'])

    const charcoal = CanonRepository.getItemEvents('炭笔')
    expect(charcoal.map(event => event.action)).toEqual(['obtained', 'consumed'])
    expect(charcoal[1].note).toBe('画引火纹烧掉了')
  })

  it('只按物品名去空格与限长，不猜内容', () => {
    const id = CanonRepository.addItemEvent({ item: '  炭笔  ', action: 'lost', chapterNumber: 0, note: 'x'.repeat(800) })
    const event = CanonRepository.getItemEvents().find(item => item.id === id)!

    expect(event.item).toBe('炭笔')
    expect(event.note!.length).toBe(500)
    expect(event.chapterNumber).toBe(0)
  })

  it('物品名为空时报错，登记错了可以删', () => {
    expect(() => CanonRepository.addItemEvent({ item: '   ', action: 'obtained', chapterNumber: 1 })).toThrow()

    const id = CanonRepository.addItemEvent({ item: '残契', action: 'lost', chapterNumber: 9 })
    expect(CanonRepository.removeItemEvent(id)).toBe(true)
    expect(CanonRepository.getItemEvents()).toHaveLength(0)
    expect(CanonRepository.removeItemEvent(id)).toBe(false)
  })
})
