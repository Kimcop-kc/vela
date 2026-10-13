/**
 * Prompt 注册表：三级覆盖（项目级 > 全局级 > 内置）与版本留档
 *
 * 自定义覆盖以 JSON 存在磁盘上（~/.vela/prompts/ 与 {project}/.vela/prompts/），
 * 保存前会把旧版本归档到 prompt-history/，最多保留 30 份，供界面回滚。
 *
 * 所有磁盘操作都走 ipc（渲染进程没有 fs 权限），失败一律降级为返回值而不是抛错：
 * 读不到自定义覆盖就用内置模板继续创作，不能因为提示词文件坏了就写不了小说。
 */
import type { PromptTemplate } from './prompt-template-types'
import { getLocalizedContent, getLocalizedSystemSuffix } from './prompt-template-types'
import { BUILTIN_PROMPTS } from './builtin'

/** 全局自定义覆盖 Prompt 缓存（~/.vela/prompts/） */
const customPrompts: Map<string, PromptTemplate> = new Map()
let globalPromptsLoadPromise: Promise<void> | null = null

/** 项目级自定义覆盖 Prompt 缓存（{project}/.vela/prompts/） */
const projectCustomPrompts: Map<string, PromptTemplate> = new Map()
let projectPromptsLoadPromise: Promise<void> | null = null
let loadedProjectPromptPath: string | null = null

/** 加载全局自定义 Prompt 覆盖（从 ~/.vela/prompts/ 目录） */
export function loadCustomPrompts(): Promise<void> {
  if (!globalPromptsLoadPromise) {
    globalPromptsLoadPromise = (async () => {
      try {
        const { ipc } = await import('../ipc-client')
        if (!ipc.isElectron) return

        const velaHome = await ipc.invoke('config:get-vela-home')
        const promptsDir = `${velaHome}/prompts`

        await _loadPromptsFromDir(promptsDir, customPrompts)
        console.log(`[Vela Prompts] 已加载 ${customPrompts.size} 个全局自定义覆盖`)
      } catch {
        // prompts 目录可能不存在，忽略
      }
    })()
  }
  return globalPromptsLoadPromise
}

/** 加载项目级自定义 Prompt 覆盖（从 {projectPath}/.vela/prompts/ 目录） */
export function loadProjectCustomPrompts(projectPath: string): Promise<void> {
  if (loadedProjectPromptPath === projectPath && projectPromptsLoadPromise) {
    return projectPromptsLoadPromise
  }
  loadedProjectPromptPath = projectPath
  projectPromptsLoadPromise = (async () => {
    try {
      projectCustomPrompts.clear()
      const promptsDir = `${projectPath}/.vela/prompts`

      await _loadPromptsFromDir(promptsDir, projectCustomPrompts)
      console.log(`[Vela Prompts] 已加载 ${projectCustomPrompts.size} 个项目级自定义覆盖`)
    } catch {
      // 目录不存在时忽略
    }
  })()
  return projectPromptsLoadPromise
}

/** 确保全局和项目级自定义提示词都已加载；供工作流启动前调用。 */
export async function ensurePromptsLoaded(projectPath?: string): Promise<void> {
  await loadCustomPrompts()
  if (projectPath) await loadProjectCustomPrompts(projectPath)
}

/** 内部工具：从目录加载 JSON 覆盖到指定 Map */
async function _loadPromptsFromDir(dirPath: string, target: Map<string, PromptTemplate>): Promise<void> {
  const { ipc } = await import('../ipc-client')
  const exists = await ipc.invoke('fs:check-exists', dirPath)
  if (!exists) return

  const files = await ipc.invoke('fs:list-dir', dirPath)
  const jsonFiles = files.filter((f) => !f.isDir && f.name.endsWith('.json'))

  for (const file of jsonFiles) {
    const result = await ipc.invoke('fs:read-file', file.path)
    if (result.success && result.content.trim()) {
      try {
        const custom = JSON.parse(result.content) as PromptTemplate
        if (custom.key) {
          target.set(custom.key, custom)
        }
      } catch { /* 忽略无效 JSON */ }
    }
  }
}

/** 根据 key 获取 Prompt 模板（三级优先级：项目级 > 全局级 > 内置） */
export function getPromptTemplate(key: string): PromptTemplate | undefined {
  // 优先级 1：项目级自定义覆盖
  const projectCustom = projectCustomPrompts.get(key)
  if (projectCustom) return projectCustom

  // 优先级 2：全局自定义覆盖
  const globalCustom = customPrompts.get(key)
  if (globalCustom) return globalCustom

  // 优先级 3：内置默认
  return BUILTIN_PROMPTS.find((p) => p.key === key)
}

/** 获取指定模板当前生效的来源 */
export function getPromptSource(key: string): 'builtin' | 'global' | 'project' {
  if (projectCustomPrompts.has(key)) return 'project'
  if (customPrompts.has(key)) return 'global'
  return 'builtin'
}

/** 获取所有模板（合并自定义，保留三级覆盖优先级） */
export function getAllPromptTemplates(): PromptTemplate[] {
  const all = [...BUILTIN_PROMPTS]
  // 用全局自定义覆盖同名内置模板
  for (const [key, custom] of customPrompts) {
    const idx = all.findIndex((p) => p.key === key)
    if (idx >= 0) {
      all[idx] = custom
    } else {
      all.push(custom)
    }
  }
  // 用项目级自定义覆盖
  for (const [key, custom] of projectCustomPrompts) {
    const idx = all.findIndex((p) => p.key === key)
    if (idx >= 0) {
      all[idx] = custom
    } else {
      all.push(custom)
    }
  }
  return all
}

export type PromptVersionScope = 'global' | 'project'

export interface PromptVersionInfo {
  id: string
  key: string
  scope: PromptVersionScope
  createdAt: string
  reason: string
  preview: string
}

interface PromptVersionRecord extends PromptVersionInfo {
  template: PromptTemplate
}

async function promptHistoryDir(
  key: string,
  scope: PromptVersionScope,
  projectPath?: string,
): Promise<string> {
  const { ipc } = await import('../ipc-client')
  if (scope === 'project') {
    if (!projectPath) throw new Error('缺少项目路径')
    return `${projectPath}/.vela/prompt-history/${key}`
  }
  const velaHome = await ipc.invoke('config:get-vela-home')
  return `${velaHome}/prompt-history/${key}`
}

async function archivePromptVersion(
  filePath: string,
  key: string,
  scope: PromptVersionScope,
  reason: string,
  projectPath?: string,
): Promise<void> {
  try {
    const { ipc } = await import('../ipc-client')
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (!exists) return
    const current = await ipc.invoke('fs:read-file', filePath)
    if (!current.success || !current.content.trim()) return
    const template = JSON.parse(current.content) as PromptTemplate
    if (!template.key) return

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const createdAt = new Date().toISOString()
    const record: PromptVersionRecord = {
      id,
      key,
      scope,
      createdAt,
      reason,
      preview: getLocalizedContent(template).slice(0, 180),
      template,
    }
    const dir = await promptHistoryDir(key, scope, projectPath)
    await ipc.invoke('fs:write-file', `${dir}/${id}.json`, JSON.stringify(record, null, 2))

    const files = await ipc.invoke('fs:list-dir', dir)
    const versions = files.filter(file => !file.isDir && file.name.endsWith('.json')).sort((a, b) => b.name.localeCompare(a.name))
    for (const old of versions.slice(30)) {
      await ipc.invoke('fs:write-file', old.path, '')
    }
  } catch {
    // 版本留档失败不应阻塞当前保存；原文件保持不变。
  }
}

export async function listPromptVersions(
  key: string,
  scope: PromptVersionScope,
  projectPath?: string,
): Promise<PromptVersionInfo[]> {
  try {
    const { ipc } = await import('../ipc-client')
    const dir = await promptHistoryDir(key, scope, projectPath)
    const files = await ipc.invoke('fs:list-dir', dir)
    const versions: PromptVersionInfo[] = []
    for (const file of files.filter(file => !file.isDir && file.name.endsWith('.json'))) {
      const result = await ipc.invoke('fs:read-file', file.path)
      if (!result.success || !result.content.trim()) continue
      try {
        const record = JSON.parse(result.content) as PromptVersionRecord
        if (!record.id || !record.template) continue
        versions.push({
          id: record.id,
          key: record.key,
          scope: record.scope,
          createdAt: record.createdAt,
          reason: record.reason,
          preview: record.preview,
        })
      } catch {
        // 忽略单个损坏版本
      }
    }
    return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

async function readPromptVersion(
  key: string,
  id: string,
  scope: PromptVersionScope,
  projectPath?: string,
): Promise<PromptTemplate> {
  const { ipc } = await import('../ipc-client')
  const dir = await promptHistoryDir(key, scope, projectPath)
  const result = await ipc.invoke('fs:read-file', `${dir}/${id}.json`)
  if (!result.success || !result.content.trim()) throw new Error('提示词版本不存在')
  const record = JSON.parse(result.content) as PromptVersionRecord
  if (!record.template?.key) throw new Error('提示词版本已损坏')
  return record.template
}

export async function restorePromptVersion(
  key: string,
  id: string,
  scope: PromptVersionScope,
  projectPath?: string,
): Promise<boolean> {
  const template = await readPromptVersion(key, id, scope, projectPath)
  return scope === 'project'
    ? saveProjectCustomPrompt(projectPath!, template)
    : saveCustomPrompt(template)
}

export async function deletePromptVersion(
  key: string,
  id: string,
  scope: PromptVersionScope,
  projectPath?: string,
): Promise<boolean> {
  try {
    const { ipc } = await import('../ipc-client')
    const dir = await promptHistoryDir(key, scope, projectPath)
    await ipc.invoke('fs:write-file', `${dir}/${id}.json`, '')
    return true
  } catch {
    return false
  }
}

/** 保存全局自定义 Prompt 到 ~/.vela/prompts/ */
export async function saveCustomPrompt(template: PromptTemplate): Promise<boolean> {
  try {
    const { ipc } = await import('../ipc-client')
    const velaHome = await ipc.invoke('config:get-vela-home')
    const dirPath = `${velaHome}/prompts`
    // 确保目录存在
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) await ipc.invoke('fs:mkdir', dirPath)
    const filePath = `${dirPath}/${template.key}.json`

    await archivePromptVersion(filePath, template.key, 'global', 'save')
    await ipc.invoke('fs:write-file', filePath, JSON.stringify(template, null, 2))
    customPrompts.set(template.key, template)
    return true
  } catch {
    return false
  }
}

/** 保存项目级自定义 Prompt 到 {projectPath}/.vela/prompts/ */
export async function saveProjectCustomPrompt(projectPath: string, template: PromptTemplate): Promise<boolean> {
  try {
    const { ipc } = await import('../ipc-client')
    const dirPath = `${projectPath}/.vela/prompts`
    // 确保目录存在
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) {
      await ipc.invoke('fs:mkdir', `${projectPath}/.vela`)
      await ipc.invoke('fs:mkdir', dirPath)
    }
    const filePath = `${dirPath}/${template.key}.json`

    await archivePromptVersion(filePath, template.key, 'project', 'save', projectPath)
    await ipc.invoke('fs:write-file', filePath, JSON.stringify(template, null, 2))
    projectCustomPrompts.set(template.key, template)
    return true
  } catch {
    return false
  }
}

/** 删除全局自定义 Prompt（恢复为内置版本） */
export async function deleteCustomPrompt(key: string): Promise<boolean> {
  try {
    const { ipc } = await import('../ipc-client')
    const velaHome = await ipc.invoke('config:get-vela-home')
    const filePath = `${velaHome}/prompts/${key}.json`
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (exists) {
      await archivePromptVersion(filePath, key, 'global', 'reset')
      await ipc.invoke('fs:write-file', filePath, '')
    }
    customPrompts.delete(key)
    return true
  } catch {
    return false
  }
}

/** 删除项目级自定义 Prompt（恢复为全局/内置版本） */
export async function deleteProjectCustomPrompt(projectPath: string, key: string): Promise<boolean> {
  try {
    const { ipc } = await import('../ipc-client')
    const filePath = `${projectPath}/.vela/prompts/${key}.json`
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (exists) {
      await archivePromptVersion(filePath, key, 'project', 'reset', projectPath)
      await ipc.invoke('fs:write-file', filePath, '')
    }
    projectCustomPrompts.delete(key)
    return true
  } catch {
    return false
  }
}

/** 渲染 Prompt 模板（填充变量 + 自动追加内置 systemSuffix + 空段落裁剪） */
export function renderPrompt(template: PromptTemplate, variables: Record<string, string>): string {
  let content = getLocalizedContent(template)
  for (const [key, value] of Object.entries(variables)) {
    content = content.replaceAll(`{{${key}}}`, value)
  }

  // 自动追加系统约束（始终从内置模板获取，不受用户自定义影响）
  const builtinTemplate = BUILTIN_PROMPTS.find(p => p.key === template.key)
  const suffix = builtinTemplate ? getLocalizedSystemSuffix(builtinTemplate) : undefined
  if (suffix) {
    let renderedSuffix = suffix
    for (const [key, value] of Object.entries(variables)) {
      renderedSuffix = renderedSuffix.replaceAll(`{{${key}}}`, value)
    }
    content = content + '\n\n' + renderedSuffix
  }

  // 空变量段落裁剪：当可选变量为空时，清除残留的空标签段落，避免分散 LLM 注意力
  content = content
    .replace(/\n★【[^】]*】★[：:]\s*\n?\s*$/gm, '')   // 清除空的 ★【...】★ 标签行
    .replace(/\n【[^】]*（如有[^）]*）[^】]*】\s*\n?\s*$/gm, '') // 清除空的 【...如有...】 标签行
    .replace(/\n{3,}/g, '\n\n') // 合并多余空行

  // 防御性：残留的 {{变量}} 绝不能进提示词（模型会把占位符当正文照抄）。
  const leftover = content.match(/\{\{[^{}]*\}\}/g)
  if (leftover) {
    console.warn(`[renderPrompt] 警告：模板 "${template.name}" 中有未赋值的变量，已从提示词中移除:`, [...new Set(leftover.map(v => v.slice(2, -2).trim()))])
    content = content
      .replace(/^[^\S\n]*\{\{[^{}]*\}\}[^\S\n]*$/gm, '')
      .replace(/\{\{[^{}]*\}\}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  return content
}

