/**
 * 拆书创作系统 —— 迁移与持久化
 *
 * 覆盖任务文档十（持久化）与十三（阶段 2、3）：
 *   - 老库加表（v8 → v9），数据不动、可重复执行；
 *   - 分析结果按「书 + 章 + 类型」唯一：重跑覆盖，不堆半成品；
 *   - 失败记录不携带上一次的结论；
 *   - 大纲与相似度报告能存能取能删。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { ReconstructRepository } from '../repositories/reconstruct-repository'
import type { ChapterAnalysis } from '../../src/shared/reconstruct'

let folder = ''

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-reconstruct-'))
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-reconstruct-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

/** 伪造 v8 老库：没有拆书创作系统的三张表 */
function createLegacyV8Database(projectPath: string): void {
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
  legacy.pragma('user_version = 8')
  legacy.close()
}

const analysis = (summary: string): ChapterAnalysis => ({
  chapterNumber: 1,
  chapterTitle: '第一章',
  summary,
  protagonist: '云玉辞',
  characters: [],
  locations: ['山门'],
  items: [],
  keyEvents: ['主角入山门'],
  plotStructure: {
    coreEvent: '', goal: '', protagonistAction: '', obstacle: '', escalation: '',
    resolution: '', twist: '', outcome: '', impactOnLater: '',
  },
  conflicts: [],
  techniques: {
    opening: '', conflictSetup: '', infoRelease: '', characterDrive: '',
    expectation: '', cliffhanger: '', chapterLink: '', pacing: '',
  },
  hooks: [],
  evidence: [],
  warnings: [],
})

describe('拆书创作系统迁移（v8 → v9）', () => {
  it('老库加表后数据仍在，且重复打开幂等', () => {
    createLegacyV8Database(folder)
    initProjectDatabase(folder)

    const db = getProjectDb()!
    for (const table of ['book_analyses', 'plot_outlines', 'similarity_reports']) {
      expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table)).toBeTruthy()
    }
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(9)
    expect(db.prepare('SELECT COUNT(*) AS c FROM canon_facts').get()).toMatchObject({ c: 1 })
    expect(ReconstructRepository.listAnalyses('book-1')).toEqual([])

    initProjectDatabase(folder)
    expect(db.prepare('SELECT COUNT(*) AS c FROM canon_facts').get()).toMatchObject({ c: 1 })
  })
})

describe('分析结果持久化', () => {
  beforeEach(() => {
    initProjectDatabase(folder)
  })

  it('同一本书同一章重复写入是覆盖，不是新增', () => {
    const first = ReconstructRepository.upsertAnalysis({
      bookId: 'book-1', bookName: '参考书', chapterNumber: 1, chapterTitle: '第一章',
      docId: 'doc-1', status: 'done', modelId: 'm1', sourceHash: 'h1', result: analysis('第一版'),
    })
    const second = ReconstructRepository.upsertAnalysis({
      bookId: 'book-1', bookName: '参考书', chapterNumber: 1, chapterTitle: '第一章',
      docId: 'doc-1', status: 'done', modelId: 'm1', sourceHash: 'h2', result: analysis('第二版'),
    })

    expect(second).toBe(first)
    const rows = ReconstructRepository.listAnalyses('book-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].result?.summary).toBe('第二版')
    expect(rows[0].sourceHash).toBe('h2')
  })

  it('失败记录不携带上一次的结论（避免界面显示过期分析）', () => {
    ReconstructRepository.upsertAnalysis({
      bookId: 'book-1', bookName: '参考书', chapterNumber: 2, chapterTitle: '第二章',
      docId: 'doc-2', status: 'done', result: analysis('写好了'),
    })
    ReconstructRepository.upsertAnalysis({
      bookId: 'book-1', bookName: '参考书', chapterNumber: 2, chapterTitle: '第二章',
      docId: 'doc-2', status: 'failed', error: '模型超时',
    })

    const row = ReconstructRepository.listAnalyses('book-1')[0]
    expect(row.status).toBe('failed')
    expect(row.result).toBeNull()
    expect(row.error).toContain('超时')
  })

  it('按章节升序返回，且能按 id 批量回捞', () => {
    const ids = [3, 1, 2].map(chapter => ReconstructRepository.upsertAnalysis({
      bookId: 'book-1', bookName: '参考书', chapterNumber: chapter, chapterTitle: `第 ${chapter} 章`,
      docId: `doc-${chapter}`, status: 'done', result: analysis(`第 ${chapter} 章概要`),
    }))

    expect(ReconstructRepository.listAnalyses('book-1').map(row => row.chapterNumber)).toEqual([1, 2, 3])
    expect(ReconstructRepository.getAnalyses([ids[1], ids[2]])).toHaveLength(2)
    expect(ReconstructRepository.getAnalysis(ids[0])?.chapterNumber).toBe(3)
  })

  it('校验参数：空 bookId、非法章节号、非法状态都拒绝', () => {
    const base = { bookName: '参考书', chapterNumber: 1, chapterTitle: '', docId: '', status: 'done' as const }
    expect(() => ReconstructRepository.upsertAnalysis({ ...base, bookId: '' })).toThrow()
    expect(() => ReconstructRepository.upsertAnalysis({ ...base, bookId: 'book-1', chapterNumber: 0 })).toThrow()
    expect(() => ReconstructRepository.upsertAnalysis({ ...base, bookId: 'book-1', status: 'running' as unknown as 'done' })).toThrow()
  })

  it('删除单条 / 按书清理', () => {
    const keep = ReconstructRepository.upsertAnalysis({
      bookId: 'book-1', bookName: 'A', chapterNumber: 1, chapterTitle: '', docId: '', status: 'done', result: analysis('A1'),
    })
    ReconstructRepository.upsertAnalysis({
      bookId: 'book-2', bookName: 'B', chapterNumber: 1, chapterTitle: '', docId: '', status: 'done', result: analysis('B1'),
    })

    expect(ReconstructRepository.removeAnalysesByBook('book-2')).toBe(1)
    expect(ReconstructRepository.listAnalyses('book-2')).toHaveLength(0)
    expect(ReconstructRepository.removeAnalysis(keep)).toBe(true)
    expect(ReconstructRepository.removeAnalysis(keep)).toBe(false)
  })
})

describe('原创大纲持久化', () => {
  beforeEach(() => {
    initProjectDatabase(folder)
  })

  it('保存后可读回，节点与来源完整', () => {
    const id = ReconstructRepository.saveOutline({
      title: '重生之北境',
      premise: '主角带着记忆重来一次',
      protagonistGoal: '守住山门',
      techniques: ['conflictSetup', 'cliffhanger'],
      sources: [{ analysisId: 1, bookId: 'book-1', bookName: '参考书', chapterNumber: 3 }],
      beats: [{
        sequence: 1, title: '夜渡', event: '主角连夜渡河', protagonistAction: '渡河',
        conflict: '追兵', consequence: '失去补给', characterChange: '变得谨慎', hook: '对岸有人等他',
      }],
    })

    const outline = ReconstructRepository.getOutline(id)!
    expect(outline.title).toBe('重生之北境')
    expect(outline.techniques).toEqual(['conflictSetup', 'cliffhanger'])
    expect(outline.beats).toHaveLength(1)
    expect(outline.beats[0].hook).toContain('等他')
    expect(outline.sources[0].chapterNumber).toBe(3)
    expect(outline.status).toBe('draft')
  })

  it('更新按 id 覆盖；标题为空拒绝；删除生效', () => {
    const id = ReconstructRepository.saveOutline({ title: '草稿大纲', beats: [] })
    ReconstructRepository.saveOutline({ id, title: '定稿大纲', beats: [], status: 'confirmed' })

    const updated = ReconstructRepository.getOutline(id)!
    expect(updated.title).toBe('定稿大纲')
    expect(updated.status).toBe('confirmed')
    expect(ReconstructRepository.listOutlines()).toHaveLength(1)
    expect(() => ReconstructRepository.saveOutline({ title: '   ', beats: [] })).toThrow()
    expect(() => ReconstructRepository.saveOutline({ id: 9999, title: '不存在', beats: [] })).toThrow()
    expect(ReconstructRepository.removeOutline(id)).toBe(true)
    expect(ReconstructRepository.getOutline(id)).toBeNull()
  })
})

describe('相似度报告持久化', () => {
  beforeEach(() => {
    initProjectDatabase(folder)
  })

  it('保存后按时间倒序可读，风险值非法时归为 undetermined', () => {
    ReconstructRepository.saveSimilarityReport({
      chapterNumber: 12, draftId: 5, outlineId: 2, bookIds: ['book-1'],
      report: {
        overallRisk: 'medium',
        findings: [{
          category: 'paragraph', severity: 'warning', description: '与参考段落接近',
          sourceReference: '参考书第 3 章', generatedReference: '第 12 章第 4 段',
          recommendation: '改写因果链', similarity: 0.71,
        }],
        summary: '有一处需要留意',
        stats: { referenceChapters: 1, generatedChars: 3000, longestCommonRun: 42, nearDuplicateSentences: 1 },
        generatedAt: new Date(0).toISOString(),
      },
    })
    ReconstructRepository.saveSimilarityReport({
      report: {
        overallRisk: 'bogus' as unknown as 'low',
        findings: [], summary: '', stats: { referenceChapters: 0, generatedChars: 0, longestCommonRun: 0, nearDuplicateSentences: 0 },
        generatedAt: new Date(0).toISOString(),
      },
    })

    const reports = ReconstructRepository.listSimilarityReports()
    expect(reports).toHaveLength(2)
    expect(reports[0].overallRisk).toBe('undetermined')
    expect(reports[1].chapterNumber).toBe(12)
    expect(reports[1].findings[0].similarity).toBeCloseTo(0.71)
    expect(reports[1].draftId).toBe(5)
  })
})
