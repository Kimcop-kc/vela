/**
 * 剧情调整工具的授权策略
 *
 * 作者要求「助手改正文时直接改，不要每次弹确认」。这条策略一旦被改回逐次确认，
 * 助手就会退回「写不进去、要作者手动操作」的状态，所以在这里固化下来。
 * 防误改的约束仍然在仓储层：定稿/归档不可覆盖、按 version 检查并发、整次要么全写要么不写，
 * 每次改动都记录前后内容并可用 undo_story_change 撤回。
 */
import { describe, expect, it } from 'vitest'
import { storyReviseTool, storyRewriteDraftTool, touchesWrittenProse } from '../agent/tools/story-content.tool'

const edits = (list: unknown[]) => ({ edits_json: JSON.stringify(list) })

describe('剧情调整工具的授权策略', () => {
  it('改正文与整章改写都不再逐次征求确认', () => {
    expect(storyReviseTool.requiresConfirmation).toBe(false)
    expect(storyRewriteDraftTool.requiresConfirmation).toBe(false)
  })

  it('能识别本次是否动到已写正文（决定自动置位 editWrittenText）', () => {
    expect(touchesWrittenProse(edits([{ kind: 'draft', id: '20', field: 'content' }]))).toBe(true)
    expect(touchesWrittenProse(edits([
      { kind: 'core', id: 'main', field: 'writingStyle' },
      { kind: 'draft', id: '20', field: 'content' },
    ]))).toBe(true)
    expect(touchesWrittenProse(edits([{ kind: 'blueprint', id: '3', field: 'keyEvents' }]))).toBe(false)
    expect(touchesWrittenProse(edits([{ kind: 'draft', id: '20', field: 'title' }]))).toBe(false)
  })

  it('edits_json 不是合法数组时不误判为改正文', () => {
    expect(touchesWrittenProse({ edits_json: '不是 JSON' })).toBe(false)
    expect(touchesWrittenProse({ edits_json: '[]' })).toBe(false)
    expect(touchesWrittenProse({})).toBe(false)
  })
})
