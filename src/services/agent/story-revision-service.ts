import { ipc } from '../ipc-client'
import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useCharacterStore } from '../../stores/character-store'
import { globalEventBus } from '../../shared/event-bus'
import { STALE_VERSION_MARKER, type StoryDocumentRef, type StoryReadResult, type StoryRevision, type StoryRevisionRequest } from '../../shared/story-revision'
import type { NovelConfig } from '../../shared/ipc-channels'

const configMap: Record<string, keyof NovelConfig> = { genre: 'genre', subGenre: 'subGenre', targetAudience: 'targetAudience', totalChapters: 'totalChapters', wordsPerChapter: 'wordsPerChapter', plotStructure: 'plotStructure', writingStyle: 'writingStyle', narrativePov: 'narrativePOV', globalGuidance: 'globalGuidance', referenceWorks: 'referenceWorks', goldenFinger: 'goldenFinger', synopsis: 'coreOutline', worldbuilding: 'worldSetting', charactersArch: 'protagonistProfile' }

export interface RevisionPreflightOptions {
  allowDirtyEditor?: boolean
  allowDirtyCharacters?: boolean
}
export function assertStoryProject(projectPath: string) {
  const state = useProjectStore.getState()
  if (state.loading || state.currentProject?.path !== projectPath) throw new Error('项目已切换，本次操作已停止。')
}

async function ready(projectPath: string, options: RevisionPreflightOptions = {}) {
  assertStoryProject(projectPath)
  if (useWorkflowStore.getState().hasActiveRun()) throw new Error('请等当前写作任务结束后再调整方向，避免两项任务互相覆盖。')
  if (!options.allowDirtyEditor && useEditorStore.getState().tabs.some(tab => tab.dirty)) throw new Error('编辑器中有未保存的修改。请先保存或放弃编辑，再继续这次调整。')
  const core = await ipc.invoke('db:project-core-get')
  assertStoryProject(projectPath)
  const config = useProjectStore.getState().currentProject!.novelConfig
  for (const [field, configKey] of Object.entries(configMap)) {
    if (core && String(config[configKey] ?? '') !== String(core[field as keyof typeof core] ?? '')) {
      // The configuration editor writes directly into the store before saving.
      // Do not refresh that store over a user's unpublished edits.
      throw new Error('小说配置与已保存内容不同，请先保存配置或重新打开项目，再调整方向。')
    }
  }
  if (!options.allowDirtyCharacters && useCharacterStore.getState().loaded) {
    const saved = await ipc.invoke('db:character-get-all')
    assertStoryProject(projectPath)
    const local = useCharacterStore.getState().characters
    if (saved.length !== local.length || saved.some(card => JSON.stringify(card) !== JSON.stringify(local.find(c => c.name === card.name)))) throw new Error('角色卡中有未保存的修改，请先保存或重新加载后再调整。')
  }
  // Recheck immediately before the caller dispatches the write, including after reads.
  assertStoryProject(projectPath)
  if (useWorkflowStore.getState().hasActiveRun() || (!options.allowDirtyEditor && useEditorStore.getState().tabs.some(tab => tab.dirty))) throw new Error('项目开始了新任务或编辑，请先完成后再调整。')
}

export function refreshAfterStoryRevision(projectPath: string, revision: StoryRevision) {
  if (useProjectStore.getState().currentProject?.path !== projectPath) return
  const updates: Partial<NovelConfig> = {}
  for (const change of revision.changes) {
    const value = revision.status === 'undone' ? change.before : change.after
    if (change.kind === 'draft') {
      const filePath = `vela://draft/${change.id}`
      const editor = useEditorStore.getState()
      for (const tab of editor.tabs) if (!tab.dirty && tab.type === 'chapter' && tab.filePath === filePath) editor.syncTabContent(tab.id, value)
      if (revision.status === 'applied') editor.openFile({ id: filePath, filePath, name: change.title, type: 'chapter', content: value })
      continue
    }
    if (change.kind !== 'core') continue
    const field = configMap[change.field]
    if (field) Object.assign(updates, { [field]: ['totalChapters', 'wordsPerChapter'].includes(field) ? Number(value) : value })
    const pathMap: Record<string, string> = { premise: 'premise', worldbuilding: 'worldbuilding', charactersArch: 'characters', synopsis: 'synopsis' }
    if (pathMap[change.field]) {
      for (const tab of useEditorStore.getState().tabs) {
        if (!tab.dirty && [ `vela://core/${pathMap[change.field]}`, `vela://core/${pathMap[change.field]}.md` ].includes(tab.filePath ?? '')) useEditorStore.getState().syncTabContent(tab.id, value)
      }
    }
  }
  useProjectStore.getState().updateNovelConfig(updates)
  globalEventBus.emit('STORY_REVISED', { projectPath, revision })
  globalEventBus.emit('REFRESH_RESOURCE', { resources: ['all'] })
}

/** 写入尝试次数：首次 + 并发冲突后自动重读重试一次 */
const APPLY_ATTEMPTS = 2

/** 是否属于「读到写入之间内容又被改过」的并发冲突 */
function isStaleVersionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(STALE_VERSION_MARKER)
}

/** 重新读取这些内容的最新 version（内容本身不必重新拉取：仓储层会再校验片段是否仍唯一） */
async function readVersions(projectPath: string, refs: StoryDocumentRef[]): Promise<Map<string, string>> {
  const versions = new Map<string, string>()
  for (const ref of refs) {
    const identity = `${ref.kind}:${ref.id}`
    if (versions.has(identity)) continue
    const doc: StoryReadResult = await ipc.invoke('story:read', projectPath, { kind: ref.kind, id: ref.id })
    assertStoryProject(projectPath)
    versions.set(identity, doc.version)
  }
  return versions
}

export async function applyRevision(projectPath: string, request: StoryRevisionRequest, signal?: AbortSignal, options?: RevisionPreflightOptions) {
  let attempt = request
  for (let round = 0; round < APPLY_ATTEMPTS; round++) {
    await ready(projectPath, options)
    if (signal?.aborted) throw new Error('调整已取消，未提交修改。')
    try {
      const result = await ipc.invoke('story:apply', projectPath, attempt)
      refreshAfterStoryRevision(projectPath, result)
      return result
    } catch (error) {
      if (!isStaleVersionError(error)) throw error
      // 读到写入之间作者又保存过：整次失败太亏，这里重新读取最新版本再试一次。
      // 如果内容真的被改到「旧片段对不上」，仓储层仍会拦下（整次不写）。
      if (round === APPLY_ATTEMPTS - 1) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}（已自动重读最新版本仍冲突，请重新读取该内容后再调整。）`)
      }
      const versions = await readVersions(projectPath, attempt.edits)
      attempt = {
        ...attempt,
        edits: attempt.edits.map(edit => ({ ...edit, version: versions.get(`${edit.kind}:${edit.id}`) ?? edit.version })),
      }
    }
  }
  throw new Error('调整未提交。')
}
export async function undoRevision(projectPath: string, id: string, signal?: AbortSignal) {
  await ready(projectPath)
  if (signal?.aborted) throw new Error('撤回操作已取消。')
  const result = await ipc.invoke('story:undo', projectPath, id)
  refreshAfterStoryRevision(projectPath, result)
  return result
}
