/**
 * 全部内置 Prompt 模板
 *
 * 这里的拼接顺序**就是** PromptSettings 里的展示顺序：
 * 界面拿 `BUILTIN_PROMPTS.filter(t => EDITABLE_PROMPT_KEYS.includes(t.key))` 渲染，
 * 所以顺序一旦变动，用户看到的提示词列表顺序就会变。
 * 拆分自单文件时保持了原始顺序，并由 prompt-placeholder-guard 测试锁定。
 */
import type { PromptTemplate } from '../prompt-template-types'
import { ARCHITECTURE_PROMPTS } from './architecture'
import { BLUEPRINT_PROMPTS } from './blueprint'
import { DRAFT_PROMPTS } from './draft'
import { REVISION_PROMPTS } from './revision'
import { IMPORT_PROMPTS } from './novel-import'
import { STYLE_PROMPTS } from './style'

export const BUILTIN_PROMPTS: PromptTemplate[] = [
  ...ARCHITECTURE_PROMPTS,
  ...BLUEPRINT_PROMPTS,
  ...DRAFT_PROMPTS,
  ...REVISION_PROMPTS,
  ...IMPORT_PROMPTS,
  ...STYLE_PROMPTS,
]
