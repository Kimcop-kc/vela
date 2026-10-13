/**
 * 分层记忆 schema 迁移（v9 → v10）
 *
 * 第二阶段新增了角色状态历史链、分卷记忆，以及三处新列。老库必须能安全升级：
 * 新表新列建齐、原有数据一行不丢、重复打开幂等。
 * 这里刻意伪造一个「真实的老库」（缺 v10 的表与列），而不是从空库出发，
 * 因为空库升级路径覆盖不到「用户已有项目」这条最容易出事的路。
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
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-migration-'))
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-migration-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

/** 伪造 v9 老库：没有 v10 的两张表，也没有三处新列，并留下用户已有数据 */
function createLegacyV9Database(projectPath: string): void {
  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE characters (
      name TEXT PRIMARY KEY, role TEXT DEFAULT 'supporting', gender TEXT DEFAULT '',
      age TEXT DEFAULT '', appearance TEXT DEFAULT '', personality TEXT DEFAULT '',
      background TEXT DEFAULT '', abilities TEXT DEFAULT '', motivation TEXT DEFAULT '',
      relationships TEXT DEFAULT '', arc TEXT DEFAULT '', notes TEXT DEFAULT '',
      cs_location TEXT DEFAULT '', cs_power_level TEXT DEFAULT '', cs_physical_state TEXT DEFAULT '',
      cs_mental_state TEXT DEFAULT '', cs_key_items TEXT DEFAULT '', cs_recent_events TEXT DEFAULT '',
      cs_updated_at_chapter INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE canon_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, statement TEXT NOT NULL,
      introduced_at INTEGER DEFAULT 0, characters TEXT DEFAULT '[]', evidence TEXT DEFAULT '',
      status TEXT DEFAULT 'active', confirmed_at TEXT, updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE canon_chapter_summaries (
      chapter_number INTEGER PRIMARY KEY, title TEXT DEFAULT '', summary TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE canon_plot_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, status TEXT DEFAULT 'active',
      started_at INTEGER DEFAULT 0, last_advanced_at INTEGER DEFAULT 0, resolved_at INTEGER,
      characters TEXT DEFAULT '[]', current_state TEXT DEFAULT '', description TEXT DEFAULT '',
      kind TEXT DEFAULT 'plot', planned_resolve_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE canon_character_state (
      character TEXT PRIMARY KEY, location TEXT DEFAULT '', power_level TEXT DEFAULT '',
      physical_state TEXT DEFAULT '', mental_state TEXT DEFAULT '', key_items TEXT DEFAULT '',
      current_goal TEXT DEFAULT '', knowledge_json TEXT DEFAULT '[]',
      relationships_json TEXT DEFAULT '{}', recent_events TEXT DEFAULT '',
      updated_at_chapter INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO characters (name, role) VALUES ('顾野', 'protagonist'), ('老邵', 'supporting');
    INSERT INTO canon_character_state (character, location, updated_at_chapter)
      VALUES ('顾野', '废土暗袋', 2), ('老邵', '茶棚', 2);
    INSERT INTO canon_facts (category, statement, introduced_at, status)
      VALUES ('world', '地脉逆旋可通缝隙', 3, 'active'),
             ('character', '顾野持有炭笔', 2, 'tentative');
    INSERT INTO canon_chapter_summaries (chapter_number, title, summary)
      VALUES (1, '开局', '顾野在废土醒来'), (2, '暗袋', '顾野收好炭笔');
    INSERT INTO canon_plot_lines (name, status, started_at, kind)
      VALUES ('纸骨认墨之谜', 'active', 1, 'foreshadow');
  `)
  legacy.pragma('user_version = 9')
  legacy.close()
}

function tableNames(db: NonNullable<ReturnType<typeof getProjectDb>>): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map(r => r.name)
}

function columnsOf(db: NonNullable<ReturnType<typeof getProjectDb>>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(r => r.name)
}

describe('分层记忆迁移（v9 → v10）', () => {
  it('老库升级后新表新列齐全，原有数据一行不丢，且重复打开幂等', () => {
    createLegacyV9Database(folder)

    initProjectDatabase(folder)
    const db = getProjectDb()!
    try {
      // 版本号推进
      expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(10)

      // 两张新表建齐
      const tables = tableNames(db)
      expect(tables).toContain('canon_character_state_history')
      expect(tables).toContain('canon_arcs')
      expect(tables).toContain('writing_pipeline')

      // 三处新列补齐
      expect(columnsOf(db, 'canon_facts')).toContain('source_paragraph_index')
      expect(columnsOf(db, 'canon_facts')).toContain('arc_id')
      expect(columnsOf(db, 'characters')).toContain('aliases_json')

      // 原有数据一条不少（这是迁移测试最该守住的一条）
      expect(CanonRepository.getFacts()).toHaveLength(2)
      expect(CanonRepository.getSummariesUpTo(2)).toHaveLength(2)
      expect(CanonRepository.getPlotLines()).toHaveLength(1)
      expect(CanonRepository.getAllCharacterStates()).toHaveLength(2)

      // 新列要有可用默认值，不能让读取端拿到 NULL 后炸掉
      const fact = db.prepare('SELECT source_paragraph_index AS p, arc_id AS a FROM canon_facts LIMIT 1')
        .get() as { p: number | null; a: number | null }
      expect(fact.p).toBe(-1)
      expect(fact.a).toBeNull()
      const character = db.prepare("SELECT aliases_json AS j FROM characters WHERE name='顾野'")
        .get() as { j: string | null }
      expect(character.j).toBe('[]')
    } finally {
      closeProjectDatabase()
    }

    // 再打开一次：迁移已跑过，必须幂等且数据不变
    initProjectDatabase(folder)
    expect(CanonRepository.getFacts()).toHaveLength(2)
    expect(CanonRepository.getAllCharacterStates()).toHaveLength(2)
    const again = getProjectDb()!
    const duplicated = again
      .prepare("SELECT name, COUNT(*) AS c FROM sqlite_master WHERE type='table' GROUP BY name HAVING c > 1")
      .all()
    expect(duplicated).toEqual([])
  })

  it('全新库直接就是最新版本，新表新列同样齐全', () => {
    initProjectDatabase(folder)
    const db = getProjectDb()!
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(10)
    expect(tableNames(db)).toContain('canon_character_state_history')
    expect(tableNames(db)).toContain('canon_arcs')
    expect(tableNames(db)).toContain('writing_pipeline')
    expect(columnsOf(db, 'canon_facts')).toContain('source_paragraph_index')
    expect(columnsOf(db, 'characters')).toContain('aliases_json')
  })

  it('v10 老库升级到 v11：补上写作流水线表，原有数据不受影响', () => {
    // 造一个「已经是 v10、但还没有流水线表」的库
    initProjectDatabase(folder)
    const before = getProjectDb()!
    before.prepare("INSERT INTO canon_facts (category, statement, status) VALUES ('world', '地脉逆旋', 'active')").run()
    before.exec('DROP TABLE IF EXISTS writing_pipeline')
    before.pragma('user_version = 10')
    expect(tableNames(before)).not.toContain('writing_pipeline')
    closeProjectDatabase()

    initProjectDatabase(folder)
    const after = getProjectDb()!
    expect(tableNames(after)).toContain('writing_pipeline')
    expect(after.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(11)
    // v11 只加表，不动旧数据
    expect(CanonRepository.getFacts()).toHaveLength(1)
  })
})
