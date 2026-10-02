import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { BlueprintRepository } from '../repositories/blueprint-repository'
import { ProjectCoreRepository } from '../repositories/project-core-repository'
import { CharacterRepository } from '../repositories/character-repository'
import { CanonRepository } from '../repositories/canon-repository'
import { SummaryRepository } from '../repositories/summary-repository'
import { ChapterRollbackRepository } from '../repositories/chapter-rollback-repository'

let folder: string

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-chapter-rollback-'))
  initProjectDatabase(folder)
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-chapter-rollback-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true })
})

describe('chapter rollback snapshots', () => {
  it('can discard an orphan snapshot after the last draft is deleted', () => {
    ChapterRollbackRepository.capture(2)
    expect(ChapterRollbackRepository.hasSnapshot(2)).toBe(true)
    ChapterRollbackRepository.clear(2)
    expect(ChapterRollbackRepository.hasSnapshot(2)).toBe(false)
    expect(ChapterRollbackRepository.restore(2).restored).toBe(false)
  })

  it('restores settings, characters, timeline, facts, summaries and plot lines', () => {
    ProjectCoreRepository.init('回滚测试')
    ProjectCoreRepository.update({ writingStyle: '定稿前文风' })
    BlueprintRepository.upsert({
      chapterNumber: 3,
      title: '对峙',
      role: '转折',
      purpose: '取得证据',
      keyEvents: '主角进入码头。',
      characters: ['顾野'],
      suspenseHook: '密信出现',
      userGuidance: '',
      notes: '定稿前的章节要点',
      notesUpdatedAt: '2026-01-01T00:00:00.000Z',
    })
    CharacterRepository.upsert({
      name: '顾野', role: 'protagonist', gender: '', age: '', appearance: '',
      personality: '', background: '', abilities: '', motivation: '',
      relationships: '', arc: '', notes: '',
      currentState: {
        location: '旧城', powerLevel: '一层', physicalState: '正常',
        mentalState: '冷静', keyItems: '旧剑', recentEvents: '尚未行动',
        updatedAtChapter: 2,
      },
    })
    CanonRepository.appendTimelineEvent({
      chapterNumber: 3, sequence: 1, characters: ['顾野'], location: '旧城',
      timeFlow: 'sequential', summary: '旧事件', impact: '',
    })
    CanonRepository.addFact({
      category: 'event', statement: '旧事实', introducedAt: 3,
      characters: ['顾野'], evidence: '',
    })
    CanonRepository.upsertCharacterState({
      character: '顾野', location: '旧城', powerLevel: '一层',
      physicalState: '正常', mentalState: '冷静', keyItems: '旧剑',
      currentGoal: '', knowledge: ['旧知识'], relationships: {},
      recentEvents: '尚未行动', updatedAtChapter: 2, updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const oldPlotId = CanonRepository.addPlotLine({
      name: '旧线索', status: 'active', startedAt: 1, lastAdvancedAt: 2,
      characters: ['顾野'], currentState: '未推进', description: '旧剧情线',
    })
    CanonRepository.upsertSummary({
      chapterNumber: 3, title: '对峙', summary: '旧摘要',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    SummaryRepository.saveSnapshot(3, '旧角色快照')

    ChapterRollbackRepository.capture(3)

    BlueprintRepository.updateNotes(3, '定稿后要点')
    ProjectCoreRepository.update({ writingStyle: '定稿后文风' })
    CharacterRepository.updateState('顾野', {
      location: '新城', powerLevel: '二层', physicalState: '受伤',
      mentalState: '愤怒', keyItems: '新剑', recentEvents: '码头大战',
      updatedAtChapter: 3,
    })
    CharacterRepository.upsert({
      name: '新角色', role: 'supporting', gender: '', age: '', appearance: '',
      personality: '', background: '', abilities: '', motivation: '',
      relationships: '', arc: '', notes: '',
    })
    CanonRepository.clearChapterTimeline(3)
    CanonRepository.appendTimelineEvent({
      chapterNumber: 3, sequence: 1, characters: ['顾野'], location: '新城',
      timeFlow: 'sequential', summary: '新事件', impact: '',
    })
    CanonRepository.clearChapterFacts(3)
    CanonRepository.addFact({
      category: 'event', statement: '新事实', introducedAt: 3,
      characters: ['顾野'], evidence: '',
    })
    CanonRepository.upsertCharacterState({
      character: '顾野', location: '新城', powerLevel: '二层',
      physicalState: '受伤', mentalState: '愤怒', keyItems: '新剑',
      currentGoal: '', knowledge: ['新知识'], relationships: {},
      recentEvents: '码头大战', updatedAtChapter: 3, updatedAt: '2026-02-01T00:00:00.000Z',
    })
    CanonRepository.addPlotLine({
      name: '新线索', status: 'active', startedAt: 3, lastAdvancedAt: 3,
      characters: ['顾野'], currentState: '刚开始', description: '定稿新增',
    })
    CanonRepository.upsertSummary({
      chapterNumber: 3, title: '对峙', summary: '新摘要',
      createdAt: '2026-02-01T00:00:00.000Z',
    })
    SummaryRepository.saveSnapshot(3, '新角色快照')

    expect(ChapterRollbackRepository.restore(3).restored).toBe(true)

    expect(BlueprintRepository.getByChapter(3)?.notes).toBe('定稿前的章节要点')
    expect(ProjectCoreRepository.get()?.writingStyle).toBe('定稿前文风')
    expect(CharacterRepository.getByName('顾野')?.currentState).toMatchObject({
      location: '旧城', powerLevel: '一层', recentEvents: '尚未行动', updatedAtChapter: 2,
    })
    expect(CharacterRepository.getByName('新角色')).toBeNull()
    expect(CanonRepository.getTimelineByChapter(3)[0].summary).toBe('旧事件')
    expect(CanonRepository.getFacts().map(f => f.statement)).toEqual(['旧事实'])
    expect(CanonRepository.getSummary(3)?.summary).toBe('旧摘要')
    expect(CanonRepository.getCharacterState('顾野')).toMatchObject({
      location: '旧城', knowledge: ['旧知识'], updatedAtChapter: 2,
    })
    const plots = CanonRepository.getPlotLines()
    expect(plots.map(p => p.id)).toContain(oldPlotId)
    expect(plots.map(p => p.name)).toEqual(['旧线索'])
    expect(getProjectDb()!.prepare(
      'SELECT character_states FROM summary_snapshots WHERE chapter_number = 3 ORDER BY id DESC LIMIT 1'
    ).get()).toEqual({ character_states: '旧角色快照' })

    expect(ChapterRollbackRepository.restore(3).restored).toBe(true)
  })
})
