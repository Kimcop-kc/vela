/**
 * 剧情调整的并发冲突自动重试测试
 *
 * 背景：日志里反复出现「第 N 章 · 草稿 v1 已有更新，请重新读取后调整；本次未写入任何修改」。
 * 助手读到写入之间作者又保存过，整次调整就白跑了。这里锁住新的行为：
 * 并发冲突自动重读最新版本并重试一次；其它错误不重试；重试后仍冲突时明确提示重新读取。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipc } from '../ipc-client'
import { useProjectStore } from '../../stores/project-store'
import { applyRevision } from '../agent/story-revision-service'
import { STALE_VERSION_MARKER, type StoryRevision, type StoryRevisionRequest } from '../../shared/story-revision'

const PROJECT = 'C:/tmp/vela-retry-test'

const request = (version: string): StoryRevisionRequest => ({
  intent: '让顾野在第三章败走',
  summary: '把码头交给幕后商会，保留密信伏笔。',
  edits: [{ kind: 'blueprint', id: '3', field: 'keyEvents', oldText: '顾野继续控制码头。', newText: '顾野败退。', version }],
})

const revision: StoryRevision = {
  id: 'r1', intent: '让顾野在第三章败走', summary: '…', createdAt: '2026-01-01T00:00:00.000Z', status: 'applied', changes: [],
}

beforeEach(() => {
  useProjectStore.setState({
    currentProject: { path: PROJECT, novelConfig: {} } as never,
    loading: false,
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('剧情调整的并发冲突重试', () => {
  it('冲突后自动重读版本并重试一次', async () => {
    const applied: StoryRevisionRequest[] = []
    vi.spyOn(ipc, 'invoke').mockImplementation((async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:project-core-get') return null
      if (channel === 'story:read') return { version: 'fresh-version' }
      if (channel === 'story:apply') {
        applied.push(args[1] as StoryRevisionRequest)
        if (applied.length === 1) throw new Error(`第 3 章 · 对峙 ${STALE_VERSION_MARKER}，请重新读取后调整；本次未写入任何修改。`)
        return revision
      }
      throw new Error(`未预期的调用：${channel}`)
    }) as never)

    const result = await applyRevision(PROJECT, request('stale-version'))

    expect(result).toBe(revision)
    expect(applied).toHaveLength(2)
    expect(applied[0].edits[0].version).toBe('stale-version')
    expect(applied[1].edits[0].version).toBe('fresh-version')
  })

  it('不是并发冲突的错误不重试', async () => {
    let applyCalls = 0
    vi.spyOn(ipc, 'invoke').mockImplementation((async (channel: string) => {
      if (channel === 'db:project-core-get') return null
      if (channel === 'story:apply') {
        applyCalls += 1
        throw new Error('第 3 章 · 对峙 的替换位置不唯一或不存在，请读取更多上下文。')
      }
      throw new Error(`未预期的调用：${channel}`)
    }) as never)

    await expect(applyRevision(PROJECT, request('v1'))).rejects.toThrow('不唯一')
    expect(applyCalls).toBe(1)
  })

  it('重试后仍然冲突时提示需要重新读取', async () => {
    let applyCalls = 0
    vi.spyOn(ipc, 'invoke').mockImplementation((async (channel: string) => {
      if (channel === 'db:project-core-get') return null
      if (channel === 'story:read') return { version: 'v2' }
      if (channel === 'story:apply') {
        applyCalls += 1
        throw new Error(`第 3 章 · 对峙 ${STALE_VERSION_MARKER}，请重新读取后调整；本次未写入任何修改。`)
      }
      throw new Error(`未预期的调用：${channel}`)
    }) as never)

    await expect(applyRevision(PROJECT, request('v1'))).rejects.toThrow('已自动重读最新版本仍冲突')
    expect(applyCalls).toBe(2)
  })
})
