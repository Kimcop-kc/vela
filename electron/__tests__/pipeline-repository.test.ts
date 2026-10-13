/**
 * 写作流水线任务持久化（第四阶段）
 *
 * 需求验收点：
 *   1. 中途关闭程序后恢复生成 —— 任务状态必须真的落库，重开能读回。
 *   6. 生成失败不会覆盖原文 —— 失败只写 error，不碰 text / confirmedText。
 *   第五步：分段独立状态（待生成 / 生成中 / 已生成 / 待编辑 / 已确认 / 失败可重试）。
 *   重试单个场景不能导致其他已确认正文被覆盖。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { PipelineRepository } from '../repositories/pipeline-repository'
import {
  confirmSegment,
  createSegment,
  recoverInterrupted,
  transitionSegment,
  type ChapterPlan,
  type PipelineSegment,
  type ScenePlan,
} from '../../src/services/reconstruct/writing-pipeline'

let folder = ''

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-pipeline-'))
  initProjectDatabase(folder)
})

afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-pipeline-')) {
    throw new Error('Unsafe cleanup path')
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

const plan: ChapterPlan = {
  goal: '顾野拿到炭笔',
  openingState: '顾野在废土醒来',
  centralConflict: '炭笔被老邵扣下',
  drives: [{ character: '顾野', goal: '拿回炭笔', obstacle: '老邵不放' }],
  eventOrder: ['第 1 段：顾野醒来', '第 2 段：争执'],
  mustEvents: ['顾野在废土醒来', '老邵扣下炭笔'],
  endingChange: '顾野拿回炭笔',
  endingRequirement: '暗示炭笔来历',
  contradictions: [],
}

function scene(sequence: number): ScenePlan {
  return {
    sequence,
    beatTitle: `第 ${sequence} 段`,
    purpose: `目的 ${sequence}`,
    time: '夜',
    location: '茶棚',
    characters: ['顾野', '老邵'],
    conflict: '争执',
    reveal: '炭笔来历',
    emotionShift: '警惕 → 松动',
    turn: '老邵让步',
    openQuestion: '炭笔到底是谁的',
    targetWords: 800,
    sceneInferred: false,
  }
}

function segments(): PipelineSegment[] {
  return [createSegment(scene(1)), createSegment(scene(2))]
}

describe('写作流水线任务持久化', () => {
  it('保存后能读回，策划 / 场景 / 分段状态一字不差（关闭程序后可恢复）', () => {
    const first = transitionSegment(segments()[0], 'generating')
    const generated = transitionSegment(first, 'generated', {
      text: '第一段的正文。',
      modelId: 'model-a',
      inputDigest: { mode: 'outline-expand', precedingChars: 0, precedingTruncated: false, targetWords: 800, revealedCount: 0 },
    })
    const list = [generated, createSegment(scene(2))]

    const saved = PipelineRepository.upsert({
      chapterNumber: 7,
      outlineId: 3,
      outlineFingerprint: 'outline-abc',
      mode: 'outline-expand',
      targetWords: 1600,
      plan,
      scenes: [scene(1), scene(2)],
      segments: list,
    })
    expect(saved.success).toBe(true)

    const record = PipelineRepository.get(7)
    expect(record).not.toBeNull()
    expect(record!.outlineId).toBe(3)
    expect(record!.outlineFingerprint).toBe('outline-abc')
    expect(record!.targetWords).toBe(1600)
    expect((record!.plan as ChapterPlan).goal).toBe('顾野拿到炭笔')
    expect(record!.scenes as ScenePlan[]).toHaveLength(2)
    const restored = record!.segments as PipelineSegment[]
    expect(restored).toHaveLength(2)
    expect(restored[0].status).toBe('generated')
    expect(restored[0].text).toBe('第一段的正文。')
    expect(restored[0].modelId).toBe('model-a')
    expect(restored[0].inputDigest?.targetWords).toBe(800)
    expect(restored[1].status).toBe('pending')
  })

  it('覆盖保存不会产生第二行（按章节号唯一）', () => {
    const base = { chapterNumber: 7, plan, scenes: [scene(1)], segments: [] }
    PipelineRepository.upsert({ ...base, targetWords: 800 })
    PipelineRepository.upsert({ ...base, targetWords: 1600 })
    expect(PipelineRepository.list()).toHaveLength(1)
    expect(PipelineRepository.get(7)!.targetWords).toBe(1600)
  })

  it('进程被杀留下的「生成中」重启后归位为「失败，可重试」，不会永远卡住', () => {
    const stuck = transitionSegment(createSegment(scene(1)), 'generating')
    expect(stuck.status).toBe('generating')

    const recovered = recoverInterrupted([stuck])
    expect(recovered[0].status).toBe('failed')
    expect(recovered[0].error).toContain('中断')
    // 归位后可以重新生成（failed → generating 是合法迁移）
    expect(transitionSegment(recovered[0], 'generating').status).toBe('generating')
  })

  it('生成失败只写 error，不碰 text 与 confirmedText（不覆盖原文）', () => {
    const confirmed = confirmSegment(transitionSegment(
      transitionSegment(createSegment(scene(1)), 'generating'),
      'generated',
      { text: '作者认可的正文。' },
    ))
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.confirmedText).toBe('作者认可的正文。')

    // 重试失败
    const reopened = transitionSegment(confirmed, 'editing')
    const running = transitionSegment(reopened, 'generating')
    const failed = transitionSegment(running, 'failed', { error: '模型超时' })
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('模型超时')
    expect(failed.text).toBe('作者认可的正文。')
    expect(failed.confirmedText).toBe('作者认可的正文。')
  })

  it('重试单个场景不会覆盖其他已确认段落', () => {
    const confirmedOne = confirmSegment(transitionSegment(
      transitionSegment(createSegment(scene(1)), 'generating'), 'generated', { text: '第一段正文。' },
    ))
    const confirmedTwo = confirmSegment(transitionSegment(
      transitionSegment(createSegment(scene(2)), 'generating'), 'generated', { text: '第二段正文。' },
    ))

    // 只重试第 1 段，第 2 段原样带过去
    const retried = transitionSegment(confirmedOne, 'editing')
    const regenerated = transitionSegment(retried, 'generating')
    const next = transitionSegment(regenerated, 'generated', { text: '第一段重写后的正文。' })

    PipelineRepository.upsert({
      chapterNumber: 7, plan, scenes: [scene(1), scene(2)],
      segments: [next, confirmedTwo],
    })

    const restored = PipelineRepository.get(7)!.segments as PipelineSegment[]
    expect(restored[0].text).toBe('第一段重写后的正文。')
    // 第 2 段一个字都没动
    expect(restored[1].status).toBe('confirmed')
    expect(restored[1].confirmedText).toBe('第二段正文。')
    expect(restored[1].text).toBe('第二段正文。')
  })

  it('删除任务状态后读不到（任务完成后清理）', () => {
    PipelineRepository.upsert({ chapterNumber: 9, plan, scenes: [scene(1)], segments: [] })
    expect(PipelineRepository.get(9)).not.toBeNull()
    expect(PipelineRepository.remove(9)).toBe(true)
    expect(PipelineRepository.get(9)).toBeNull()
    expect(PipelineRepository.list()).toHaveLength(0)
  })

  it('JSON 损坏时退回默认值而不是整条读不出来', () => {
    PipelineRepository.upsert({ chapterNumber: 11, plan, scenes: [scene(1)], segments: [] })
    // 直接写坏 JSON，模拟异常中断写库
    const db = getProjectDb()!
    db.prepare("UPDATE writing_pipeline SET plan_json = '{坏', scenes_json = '坏', segments_json = '坏' WHERE chapter_number = 11").run()

    const record = PipelineRepository.get(11)
    expect(record).not.toBeNull()
    expect(record!.plan).toEqual({})
    expect(record!.scenes).toEqual([])
    expect(record!.segments).toEqual([])
  })
})
