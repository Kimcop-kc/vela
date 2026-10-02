/**
 * update_config — 直接更新小说配置
 *
 * 支持一次修改多个字段，兼容旧版 field/value 调用，并接受作者常用的中文别名。
 * 配置属于项目核心数据，写入前会先保存当前配置编辑状态，避免要求作者手动点击保存。
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { applyRevision, assertStoryProject } from '../story-revision-service'
import type { NovelConfig } from '../../../shared/ipc-channels'
import type { StoryReadResult } from '../../../shared/story-revision'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

const CONFIG_FIELDS = [
  'genre', 'subGenre', 'targetAudience', 'totalChapters', 'wordsPerChapter',
  'plotStructure', 'coreOutline', 'worldSetting', 'goldenFinger', 'protagonistProfile',
  'globalGuidance', 'writingStyle', 'narrativePOV', 'referenceWorks',
] as const

type ConfigField = typeof CONFIG_FIELDS[number]

const FIELD_ALIASES: Record<string, ConfigField> = {
  genre: 'genre',
  '类型': 'genre',
  '题材': 'genre',
  subgenre: 'subGenre',
  sub_genre: 'subGenre',
  '子类型': 'subGenre',
  '细分类型': 'subGenre',
  targetaudience: 'targetAudience',
  target_audience: 'targetAudience',
  '目标读者': 'targetAudience',
  '受众': 'targetAudience',
  totalchapters: 'totalChapters',
  total_chapters: 'totalChapters',
  '总章节数': 'totalChapters',
  '章节数': 'totalChapters',
  wordsperchapter: 'wordsPerChapter',
  words_per_chapter: 'wordsPerChapter',
  '每章字数': 'wordsPerChapter',
  '单章字数': 'wordsPerChapter',
  plotstructure: 'plotStructure',
  plot_structure: 'plotStructure',
  '故事结构': 'plotStructure',
  '叙事结构': 'plotStructure',
  '结构': 'plotStructure',
  coreoutline: 'coreOutline',
  core_outline: 'coreOutline',
  '核心大纲': 'coreOutline',
  '大纲': 'coreOutline',
  worldsetting: 'worldSetting',
  world_setting: 'worldSetting',
  '世界观': 'worldSetting',
  '世界设定': 'worldSetting',
  goldenfinger: 'goldenFinger',
  golden_finger: 'goldenFinger',
  '金手指': 'goldenFinger',
  protagonistprofile: 'protagonistProfile',
  protagonist_profile: 'protagonistProfile',
  '主角设定': 'protagonistProfile',
  '主角人设': 'protagonistProfile',
  globalguidance: 'globalGuidance',
  global_guidance: 'globalGuidance',
  '全局指导': 'globalGuidance',
  '全局写作要求': 'globalGuidance',
  writingstyle: 'writingStyle',
  writing_style: 'writingStyle',
  '写作风格': 'writingStyle',
  '文风': 'writingStyle',
  narrativepov: 'narrativePOV',
  narrative_pov: 'narrativePOV',
  '叙事视角': 'narrativePOV',
  '叙述视角': 'narrativePOV',
  '视角': 'narrativePOV',
  referenceworks: 'referenceWorks',
  reference_works: 'referenceWorks',
  '参考作品': 'referenceWorks',
  '参考书': 'referenceWorks',
}

const CONTENT_FIELDS: Partial<Record<ConfigField, string>> = {
  genre: 'genre',
  subGenre: 'subGenre',
  plotStructure: 'plotStructure',
  coreOutline: 'synopsis',
  worldSetting: 'worldbuilding',
  goldenFinger: 'goldenFinger',
  protagonistProfile: 'charactersArch',
  globalGuidance: 'globalGuidance',
  writingStyle: 'writingStyle',
  narrativePOV: 'narrativePov',
}

const SIMPLE_FIELDS = new Set<ConfigField>(['targetAudience', 'totalChapters', 'wordsPerChapter', 'referenceWorks'])

const PLOT_STRUCTURES: Record<string, string> = {
  three_act: 'three_act',
  heros_journey: 'heros_journey',
  save_the_cat: 'save_the_cat',
  kishotenketsu: 'kishotenketsu',
  multi_thread: 'multi_thread',
  freeform: 'freeform',
  '三幕式': 'three_act',
  '英雄之旅': 'heros_journey',
  '救猫咪': 'save_the_cat',
  '起承转合': 'kishotenketsu',
  '多线叙事': 'multi_thread',
  '多线': 'multi_thread',
  '自由结构': 'freeform',
}

const NARRATIVE_POVS: Record<string, string> = {
  first_person: 'first_person',
  third_limited: 'third_limited',
  third_omniscient: 'third_omniscient',
  multi_pov: 'multi_pov',
  '第一人称': 'first_person',
  '第三人称有限': 'third_limited',
  '有限视角': 'third_limited',
  '第三人称全知': 'third_omniscient',
  '全知视角': 'third_omniscient',
  '多视角': 'multi_pov',
}

function normalizeField(raw: unknown): ConfigField | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  const alias = FIELD_ALIASES[value] ?? FIELD_ALIASES[value.toLowerCase()]
  if (alias) return alias
  return CONFIG_FIELDS.includes(value as ConfigField) ? value as ConfigField : null
}

function normalizeValue(field: ConfigField, raw: unknown): string | number {
  if (field === 'totalChapters' || field === 'wordsPerChapter') {
    const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('章节数和每章字数必须是正整数。')
    return value
  }
  if (field === 'plotStructure') {
    const value = String(raw).trim()
    const normalized = PLOT_STRUCTURES[value] ?? PLOT_STRUCTURES[value.toLowerCase()]
    if (!normalized) throw new Error('故事结构必须是 three_act、heros_journey、save_the_cat、kishotenketsu、multi_thread 或 freeform。')
    return normalized
  }
  if (field === 'narrativePOV') {
    const value = String(raw).trim()
    const normalized = NARRATIVE_POVS[value] ?? NARRATIVE_POVS[value.toLowerCase()]
    if (!normalized) throw new Error('叙事视角必须是 first_person、third_limited、third_omniscient 或 multi_pov。')
    return normalized
  }
  return String(raw)
}

function collectUpdates(args: Record<string, unknown>): Map<ConfigField, string | number> {
  const updates = new Map<ConfigField, string | number>()
  const add = (rawField: unknown, rawValue: unknown) => {
    if (rawValue === undefined) return
    const field = normalizeField(rawField)
    if (!field) throw new Error(`不支持的配置项：${String(rawField)}`)
    updates.set(field, normalizeValue(field, rawValue))
  }

  add(args.field, args.value)
  for (const field of CONFIG_FIELDS) {
    if (Object.hasOwn(args, field)) add(field, args[field])
  }

  if (typeof args.updates_json === 'string' && args.updates_json.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(args.updates_json)
    } catch {
      throw new Error('updates_json 必须是 JSON 数组。')
    }
    if (!Array.isArray(parsed)) throw new Error('updates_json 必须是 JSON 数组。')
    for (const item of parsed) {
      if (!item || typeof item !== 'object') throw new Error('updates_json 中的每一项都必须是对象。')
      const entry = item as Record<string, unknown>
      add(entry.field, entry.value)
    }
  }

  if (updates.size === 0) throw new Error('请至少提供一个要修改的配置项。')
  return updates
}

async function readCoreField(projectPath: string, field: string, expectedVersion: string | null): Promise<{ content: string; version: string }> {
  const chunks: string[] = []
  let offset: number | null = 0
  let version = expectedVersion
  do {
    const doc: StoryReadResult = await ipc.invoke('story:read', projectPath, { kind: 'core', id: 'main', field, offset })
    assertStoryProject(projectPath)
    if (version && doc.version !== version) throw new Error('配置读取期间已有更新，请重新执行本次修改。')
    version = doc.version
    chunks.push(doc.content ?? '')
    offset = doc.nextOffset ?? null
  } while (offset !== null)
  return { content: chunks.join(''), version: version! }
}

export const updateConfigTool = buildAgentTool({
  name: 'update_config',
  description: t('agent.tools.updateConfig.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      field: { type: 'string', description: t('agent.tools.updateConfig.fieldDesc') },
      value: { type: 'string', description: t('agent.tools.updateConfig.valueDesc') },
      genre: { type: 'string', description: '小说类型，例如玄幻、都市、悬疑。' },
      subGenre: { type: 'string', description: '细分类型。' },
      targetAudience: { type: 'string', description: '目标读者。' },
      totalChapters: { type: 'number', description: '计划总章节数。' },
      wordsPerChapter: { type: 'number', description: '每章目标字数。' },
      plotStructure: { type: 'string', description: '故事结构：three_act、heros_journey、save_the_cat、kishotenketsu、multi_thread 或 freeform。' },
      coreOutline: { type: 'string', description: '核心大纲。' },
      worldSetting: { type: 'string', description: '世界观与核心设定。' },
      goldenFinger: { type: 'string', description: '主角金手指或核心优势。' },
      protagonistProfile: { type: 'string', description: '主角设定与人物架构。' },
      globalGuidance: { type: 'string', description: '全局写作要求。' },
      writingStyle: { type: 'string', description: '写作风格。' },
      narrativePOV: { type: 'string', description: '叙事视角：first_person、third_limited、third_omniscient 或 multi_pov。' },
      referenceWorks: { type: 'string', description: '参考作品。' },
      updates_json: { type: 'string', description: '可选：一次修改多项时传入 JSON 数组，例如 [{"field":"genre","value":"玄幻"},{"field":"totalChapters","value":300}]。' },
    },
  },
  requiresConfirmation: false,
  isReadOnly: false,
  execute: async (args, context) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return { success: false, content: '', error: t('agent.tools.noProject') }

    let updates: Map<ConfigField, string | number>
    try {
      updates = collectUpdates(args)
    } catch (error) {
      return { success: false, content: '', error: String(error instanceof Error ? error.message : error) }
    }

    const saved = await useProjectStore.getState().saveProject()
    if (!saved) return { success: false, content: '', error: t('agent.tools.updateConfig.updateFailed') }
    assertStoryProject(project.path)
    const activeProject = useProjectStore.getState().currentProject
    if (!activeProject || activeProject.path !== project.path) return { success: false, content: '', error: '项目已切换，本次操作已停止。' }

    const changedFields: string[] = []
    const contentEdits: Array<{ kind: 'core'; id: string; field: string; version: string; oldText: string; newText: string }> = []
    let coreVersion: string | null = null

    for (const [field, value] of updates) {
      const storyField = CONTENT_FIELDS[field]
      if (!storyField) continue
      const current = await readCoreField(activeProject.path, storyField, coreVersion)
      coreVersion = current.version
      const nextValue = String(value)
      if (current.content === nextValue) continue
      contentEdits.push({ kind: 'core', id: 'main', field: storyField, version: current.version, oldText: current.content, newText: nextValue })
      changedFields.push(field)
    }

    if (contentEdits.length > 0) {
      await applyRevision(activeProject.path, {
        intent: '按作者要求直接更新小说配置',
        summary: '更新小说核心配置，正文是否需要调整应另行核对。',
        edits: contentEdits,
      }, context?.signal, { allowDirtyEditor: true, allowDirtyCharacters: true })
    }

    const latestProject = useProjectStore.getState().currentProject
    if (!latestProject || latestProject.path !== activeProject.path) {
      return { success: false, content: '', error: '项目已切换，本次操作已停止。' }
    }

    const simpleData: Partial<NovelConfig> = {}
    for (const [field, value] of updates) {
      if (!SIMPLE_FIELDS.has(field)) continue
      const currentValue = latestProject.novelConfig[field as keyof NovelConfig]
      if (currentValue === value) continue
      Object.assign(simpleData, { [field]: value })
      changedFields.push(field)
    }

    if (Object.keys(simpleData).length > 0) {
      const result = await ipc.invoke('project:update-config', latestProject.id, {
        novelConfig: { ...latestProject.novelConfig, ...simpleData },
      })
      if (!result.success) return { success: false, content: '', error: result.error ?? t('agent.tools.updateConfig.updateFailed') }
      useProjectStore.getState().updateNovelConfig(simpleData)
    }

    if (changedFields.length === 0) {
      return { success: true, content: '当前配置已经符合要求，无需重复修改。' }
    }

    return {
      success: true,
      content: `配置已直接保存：${changedFields.join('、')}。正文是否需要同步调整已单独说明。`,
    }
  },
})
