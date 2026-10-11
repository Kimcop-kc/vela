/**
 * 事实库的「作者确认」与迁移
 *
 * 两条不变量：
 * 1. 老库（v2，没有 confirmed_at / updated_at）打开后必须被安全迁移，不丢数据；
 * 2. AI 写回的事实默认未确认；作者确认后才算过目，确认 tentative 事实时提升为 active。
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
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-canon-review-'))
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-canon-review-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

/** 伪造一个 v2 老库：canon_facts 只有旧列，并已有数据 */
function createLegacyV2Database(projectPath: string): void {
  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE canon_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      statement TEXT NOT NULL,
      introduced_at INTEGER DEFAULT 0,
      characters TEXT DEFAULT '[]',
      evidence TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO canon_facts (category, statement, introduced_at, characters, evidence, status)
    VALUES ('item', '顾野得到一截炭笔', 3, '["顾野"]', '炭笔', 'active');
  `)
  legacy.pragma('user_version = 2')
  legacy.close()
}

describe('事实库迁移（v2 → v3）', () => {
  it('老库加列后数据仍在，并重复迁移幂等', () => {
    createLegacyV2Database(folder)

    initProjectDatabase(folder)

    const db = getProjectDb()!
    const columns = (db.prepare('PRAGMA table_info(canon_facts)').all() as Array<{ name: string }>).map(c => c.name)
    expect(columns).toContain('confirmed_at')
    expect(columns).toContain('updated_at')
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='canon_fact_history'`).get()).toBeTruthy()
    expect((db.pragma('user_version', { simple: true }) as number)).toBeGreaterThanOrEqual(3)

    // 老数据保留，且被视作「未确认」
    const facts = CanonRepository.getFacts()
    expect(facts).toHaveLength(1)
    expect(facts[0].statement).toContain('炭笔')
    expect(facts[0].confirmedAt).toBeNull()

    // 再打开一次（幂等）：不报错、数据不变
    initProjectDatabase(folder)
    expect(CanonRepository.getFacts()).toHaveLength(1)
  })
})

describe('作者确认与变更历史', () => {
  beforeEach(() => {
    initProjectDatabase(folder)
  })

  it('写回产生的事实默认未确认，确认后留下时间与历史', () => {
    const id = CanonRepository.addFact({
      category: 'item', statement: '顾野把炭笔收进暗袋', introducedAt: 4,
      characters: ['顾野'], evidence: '炭笔',
    })

    expect(CanonRepository.getFactById(id)?.confirmedAt).toBeNull()
    expect(CanonRepository.getFactHistory(id)).toHaveLength(0)

    CanonRepository.setFactConfirmed(id, true)
    const confirmed = CanonRepository.getFactById(id)!
    expect(confirmed.confirmedAt).toBeTruthy()
    expect(confirmed.updatedAt).toBeTruthy()
    const history = CanonRepository.getFactHistory(id)
    expect(history).toHaveLength(1)
    expect(history[0].action).toBe('confirm')

    CanonRepository.setFactConfirmed(id, false)
    expect(CanonRepository.getFactById(id)?.confirmedAt).toBeNull()
    expect(CanonRepository.getFactHistory(id).map(row => row.action)).toEqual(['unconfirm', 'confirm'])
  })

  it('确认 tentative 事实时提升为 active', () => {
    const id = CanonRepository.addFact({
      category: 'event', statement: '井台封泥下另有入口', introducedAt: 6,
      characters: ['顾野'], evidence: '封泥', status: 'tentative',
    })
    expect(CanonRepository.getFactById(id)?.status).toBe('tentative')

    CanonRepository.setFactConfirmed(id, true)
    expect(CanonRepository.getFactById(id)?.status).toBe('active')
  })

  it('改记忆状态会记录历史并更新时间', () => {
    const id = CanonRepository.addFact({
      category: 'world', statement: '地脉逆旋可通缝隙', introducedAt: 7, characters: [],
    })
    CanonRepository.markFactStatus(id, 'contradicted')

    expect(CanonRepository.getFactById(id)?.status).toBe('contradicted')
    expect(CanonRepository.getFactHistory(id)[0].action).toBe('status')
  })

  it('批量确认只处理存在的 id', () => {
    const a = CanonRepository.addFact({ category: 'item', statement: '事实甲', introducedAt: 1, characters: [] })
    CanonRepository.addFact({ category: 'item', statement: '事实乙', introducedAt: 2, characters: [] })

    const count = CanonRepository.setFactsConfirmed([a, 999999], true)

    expect(count).toBe(1)
    expect(CanonRepository.getFactById(a)?.confirmedAt).toBeTruthy()
  })
})

describe('原子写回与确认状态', () => {
  beforeEach(() => {
    initProjectDatabase(folder)
  })

  const writeback = (chapterNumber: number, statements: Array<{ statement: string; status?: 'active' | 'tentative' }>) => {
    return CanonRepository.writebackAtomically({
      chapterNumber,
      newEvents: [],
      characterDeltas: [],
      newFacts: statements.map(item => ({
        category: 'item' as const,
        statement: item.statement,
        introducedAt: chapterNumber,
        characters: [],
        evidence: '',
        status: item.status,
      })),
    })
  }

  it('写回产生的事实未确认，重写本章会清掉旧事实的历史', () => {
    const first = writeback(3, [{ statement: '顾野得到一截炭笔' }])
    const id = first.factIds[0]
    CanonRepository.setFactConfirmed(id, true)
    expect(CanonRepository.getFactHistory(id)).toHaveLength(1)

    // 重写同一章：旧事实被删除，它的历史也要一起清掉，避免孤儿记录
    const second = writeback(3, [{ statement: '顾野得到一截炭笔（改）' }])
    expect(second.factIds[0]).not.toBe(id)
    expect(CanonRepository.getFactHistory(id)).toHaveLength(0)
    expect(CanonRepository.getFacts()).toHaveLength(1)
  })

  it('新事实与既有 active 事实冲突时两边都标 contradicted', () => {
    writeback(2, [{ statement: '顾野把炭笔留在客栈' }])
    const result = writeback(9, [{ statement: '顾野没有把炭笔留在客栈' }])

    expect(result.conflicts.length).toBeGreaterThan(0)
    const statuses = CanonRepository.getFacts().map(fact => fact.status)
    expect(statuses).toContain('contradicted')
    expect(statuses.filter(status => status === 'contradicted')).toHaveLength(2)
  })
})
