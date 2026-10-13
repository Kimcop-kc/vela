/**
 * Prompt 模板的类型定义与本地化取值辅助
 *
 * 这些函数是「模板字段 → 当前语言下的实际文本」的唯一入口，
 * 内置模板、自定义覆盖、渲染器都从这里取值，避免各自拼 `contentLocalized[lang]`。
 */
import i18n from '../../i18n'

export interface PromptTemplate {
  /** 模板唯一标识 */
  key: string
  /** 显示名称（i18n key: promptTemplates.{key}.name） */
  name: string
  /** 用途说明（i18n key: promptTemplates.{key}.description） */
  description: string
  /** 模板内容（支持 {{变量}} 插值）— 中文默认 */
  content: string
  /** 不可编辑的系统约束（输出格式、JSON schema 等），渲染时自动追加到 content 末尾 */
  systemSuffix?: string
  /** LLM system message 角色定位（由模板统一定义，command 不再硬编码） */
  systemRole?: string
  /** 可用变量列表 */
  variables: Record<string, string>
  /** Localized content overrides keyed by locale */
  contentLocalized?: Record<string, string>
  /** Localized systemRole overrides */
  systemRoleLocalized?: Record<string, string>
  /** Localized systemSuffix overrides */
  systemSuffixLocalized?: Record<string, string>
}

/** 获取翻译后的模板名称 */
export function getPromptName(key: string): string {
  return i18n.t(`promptTemplates.${key}.name`, { ns: 'settings' })
}

/** 获取翻译后的模板描述 */
export function getPromptDescription(key: string): string {
  return i18n.t(`promptTemplates.${key}.description`, { ns: 'settings' })
}

/** Получить локализованное содержимое промпта */
export function getLocalizedContent(template: PromptTemplate): string {
  const lang = i18n.language
  return template.contentLocalized?.[lang] || template.contentLocalized?.[lang.split('-')[0]] || template.content
}

/** Получить локализованную системную роль */
export function getLocalizedSystemRole(template: PromptTemplate): string {
  const lang = i18n.language
  return template.systemRoleLocalized?.[lang] || template.systemRoleLocalized?.[lang.split('-')[0]] || template.systemRole || ''
}

/** Получить локализованный системный суффикс */
export function getLocalizedSystemSuffix(template: PromptTemplate): string {
  const lang = i18n.language
  return template.systemSuffixLocalized?.[lang] || template.systemSuffixLocalized?.[lang.split('-')[0]] || template.systemSuffix || ''
}

/** 允许用户自定义编辑的模板 Key 列表（其余为系统模板，不可编辑） */
export const EDITABLE_PROMPT_KEYS: string[] = [
  'generate_global_config',
  'premise',
  'character_dynamics',
  'world_building',
  'synopsis',
  'first_chapter_draft',
  'next_chapter_draft',
  'refine_chapter',
  'consistency_check',
  'analyze_writing_style',
  'refine_from_review',
  'qualitative_review',
  'style_imitation',
  'deai_revise',
]
