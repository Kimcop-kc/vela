import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipc } from '../ipc-client'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useEditorStore } from '../../stores/editor-store'
import { useCharacterStore } from '../../stores/character-store'
import { openEditorTool } from '../agent/tools/open-editor.tool'
import { openModuleTool } from '../agent/tools/open-module.tool'
import { updateConfigTool } from '../agent/tools/update-config.tool'
import { writeFileTool } from '../agent/tools/write-file.tool'
import { builtinTools } from '../agent/tools'
import type { NovelConfig } from '../../shared/ipc-channels'

const baseConfig: NovelConfig = {
  genre: '都市',
  subGenre: '',
  targetAudience: '男频',
  totalChapters: 100,
  wordsPerChapter: 3000,
  plotStructure: 'three_act',
  narrativePOV: 'third_limited',
  coreOutline: '旧大纲',
  worldSetting: '',
  goldenFinger: '',
  protagonistProfile: '',
  globalGuidance: '',
  writingStyle: '',
  referenceWorks: '',
}

function resetStores() {
  useProjectStore.setState({
    currentProject: {
      id: 'project-1',
      name: '测试小说',
      path: 'D:/novel',
      novelConfig: { ...baseConfig },
      characterStates: '',
      createdAt: '',
      updatedAt: '',
    },
    loading: false,
    saveProject: vi.fn(async () => true),
  })
  useWorkflowStore.setState({ activeRuns: [] })
  useEditorStore.setState({ tabs: [] })
  useCharacterStore.setState({ loaded: false })
}

afterEach(() => {
  vi.restoreAllMocks()
  useProjectStore.setState({ currentProject: null, loading: false })
  useLayoutStore.setState({ sidebarView: 'project', sidebarOpen: true })
})

describe('agent module tools', () => {
  it('updates multiple novel config fields in one call and keeps content + simple fields together', async () => {
    resetStores()
    const storyContent: Record<string, string> = {
      genre: '都市',
      targetAudience: '男频',
      totalChapters: '100',
      plotStructure: 'three_act',
      synopsis: '旧大纲',
    }
    let appliedEdits: Array<{ kind: string; id: string; field: string; version: string; oldText: string; newText: string }> = []

    vi.spyOn(ipc, 'invoke').mockImplementation(async (channel, ...args) => {
      if (channel === 'db:project-core-get') {
        return {
          genre: '都市',
          subGenre: '',
          targetAudience: '男频',
          totalChapters: 100,
          wordsPerChapter: 3000,
          plotStructure: 'three_act',
          writingStyle: '',
          narrativePov: 'third_limited',
          globalGuidance: '',
          referenceWorks: '',
          goldenFinger: '',
          synopsis: '旧大纲',
          worldbuilding: '',
          charactersArch: '',
        } as never
      }
      if (channel === 'story:read') {
        const field = (args[1] as { field: string }).field
        return { version: 'v1', content: storyContent[field] ?? '', nextOffset: null } as never
      }
      if (channel === 'story:apply') {
        appliedEdits = (args[1] as { edits: typeof appliedEdits }).edits
        return {
          id: 'revision-1',
          intent: '更新配置',
          summary: '更新配置',
          createdAt: new Date().toISOString(),
          status: 'applied',
          changes: appliedEdits.map(edit => ({
            kind: 'core',
            id: 'main',
            title: '全书设定与架构',
            field: edit.field,
            before: storyContent[edit.field] ?? '',
            after: edit.newText,
          })),
        } as never
      }
      return {} as never
    })

    const result = await updateConfigTool.execute({
      genre: '玄幻',
      plotStructure: '英雄之旅',
      targetAudience: '女频',
      totalChapters: 300,
    })

    expect(result.success).toBe(true)
    expect(appliedEdits).toEqual([
      { kind: 'core', id: 'main', field: 'genre', version: 'v1', oldText: '都市', newText: '玄幻' },
      { kind: 'core', id: 'main', field: 'targetAudience', version: 'v1', oldText: '男频', newText: '女频' },
      { kind: 'core', id: 'main', field: 'totalChapters', version: 'v1', oldText: '100', newText: '300' },
      { kind: 'core', id: 'main', field: 'plotStructure', version: 'v1', oldText: 'three_act', newText: 'heros_journey' },
    ])
    expect(result.artifacts?.[0]).toMatchObject({ type: 'story_revision', revisionId: 'revision-1' })
  })

  it('accepts Chinese aliases and the legacy field/value shape', async () => {
    resetStores()
    let appliedEdit: { field: string; newText: string } | null = null
    vi.spyOn(ipc, 'invoke').mockImplementation(async (channel, ...args) => {
      if (channel === 'db:project-core-get') return {
        genre: '都市', subGenre: '', targetAudience: '男频', totalChapters: 100, wordsPerChapter: 3000,
        plotStructure: 'three_act', writingStyle: '', referenceWorks: '',
        narrativePov: 'third_limited', globalGuidance: '', goldenFinger: '', synopsis: '旧大纲',
        worldbuilding: '', charactersArch: '',
      } as never
      if (channel === 'story:read') return { version: 'v2', content: 'third_limited', nextOffset: null } as never
      if (channel === 'story:apply') {
        appliedEdit = (args[1] as { edits: Array<{ field: string; newText: string }> }).edits[0]
        return { id: 'revision-2', intent: '更新视角', summary: '更新视角', createdAt: '', status: 'applied', changes: [] } as never
      }
      return {} as never
    })

    const result = await updateConfigTool.execute({ field: '叙事视角', value: '第一人称' })
    expect(result.success).toBe(true)
    expect(appliedEdit).toMatchObject({ field: 'narrativePov', newText: 'first_person' })
  })

  it('previews a config update without writing when dry_run is enabled', async () => {
    resetStores()
    const apply = vi.fn()
    vi.spyOn(ipc, 'invoke').mockImplementation(async (channel, ...args) => {
      if (channel === 'db:project-core-get') return {
        genre: '都市', subGenre: '', targetAudience: '男频', totalChapters: 100, wordsPerChapter: 3000,
        plotStructure: 'three_act', writingStyle: '', referenceWorks: '', narrativePov: 'third_limited',
        globalGuidance: '', goldenFinger: '', synopsis: '旧大纲', worldbuilding: '', charactersArch: '',
      } as never
      if (channel === 'story:read') return { version: 'v1', content: (args[1] as { field: string }).field === 'genre' ? '都市' : '100', nextOffset: null } as never
      if (channel === 'story:apply') {
        apply()
        return {} as never
      }
      return {} as never
    })

    const result = await updateConfigTool.execute({ genre: '玄幻', totalChapters: 300, dry_run: true })
    expect(result.success).toBe(true)
    expect(result.content).toContain('配置修改预览')
    expect(result.content).toContain('玄幻')
    expect(apply).not.toHaveBeenCalled()
  })

  it('opens requested software modules without confirmation', async () => {
    expect(builtinTools.some(tool => tool.name === 'open_module')).toBe(true)
    expect(openEditorTool.requiresConfirmation).toBe(false)
    expect(writeFileTool.requiresConfirmation).toBe(false)
    await openModuleTool.execute({ module: 'knowledge' })
    expect(useLayoutStore.getState()).toMatchObject({ sidebarView: 'knowledge', sidebarOpen: true })

    await openModuleTool.execute({ module: 'settings' })
    expect(useLayoutStore.getState().settingsOpen).toBe(true)
  })

  it('rejects unsupported config fields with a useful error', async () => {
    resetStores()
    const result = await updateConfigTool.execute({ field: '不存在', value: 'x' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('不支持的配置项')
  })
})
