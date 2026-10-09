/**
 * 写前校验（prewrite validation）
 *
 * 在调用模型之前，用确定性规则拦住「占位符 / 未补齐」的章纲信息：
 * 把 {章纲目标}、第N章、待补 这类占位文本当真实剧情喂给模型，写出来必然跑偏。
 * 本模块只做校验，不改任何数据；由调用方决定是阻断还是只提示。
 */

export type PrewriteIssueKind = 'placeholder' | 'missing' | 'too-short'

export interface PrewriteIssue {
  kind: PrewriteIssueKind
  /** 字段标识（供 i18n 展示） */
  field: string
  /** 命中的占位文本或片段 */
  detail: string
}

export interface PrewriteInput {
  title?: string
  role?: string
  purpose?: string
  characters?: string[]
  keyEvents?: string
  suspenseHook?: string
  userGuidance?: string
  knowledgeQueryHint?: string
}

/** 占位符 / 未替换变量的固定模式（公开、可审计）。 */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\{\{[^{}\n]*\}\}/,        // 未替换的模板变量 {{xxx}}
  /\{[^{}\n]{1,40}\}/,        // {章纲目标} / {待补} 这类花括号占位
  /第\s*[NnXx?？]+\s*章/,      // 第N章 / 第X章
  /\bT[O0]D[O0]\b/i,
  /XXX+/i,
  /待补(充|齐)?|待定|待填|此处省略|略写/,
]

/** 必填字段（缺失/过短只提示，不禁写）。 */
const KEY_FIELDS: Array<{ key: keyof PrewriteInput; field: string }> = [
  { key: 'title', field: 'title' },
  { key: 'keyEvents', field: 'keyEvents' },
]

const MIN_KEY_EVENTS_LENGTH = 10

/** 扫描章纲信息，返回占位符 / 缺失 / 过短问题。 */
export function validateChapterPrewrite(input: PrewriteInput): PrewriteIssue[] {
  const issues: PrewriteIssue[] = []

  for (const { key, field } of KEY_FIELDS) {
    const value = String(input[key] ?? '').trim()
    if (!value) {
      issues.push({ kind: 'missing', field, detail: '' })
    } else if (key === 'keyEvents' && value.length < MIN_KEY_EVENTS_LENGTH) {
      issues.push({ kind: 'too-short', field, detail: value })
    }
  }

  const scanFields: Array<{ field: string; value: string }> = Object.entries(input)
    .filter(([key]) => key !== 'characters')
    .map(([key, value]) => ({ field: key, value: String(value ?? '').trim() }))
  for (const [index, name] of (input.characters ?? []).entries()) {
    scanFields.push({ field: `characters[${index}]`, value: String(name ?? '').trim() })
  }

  for (const { field, value } of scanFields) {
    if (!value) continue
    for (const pattern of PLACEHOLDER_PATTERNS) {
      const match = value.match(pattern)
      if (match) {
        issues.push({ kind: 'placeholder', field, detail: match[0] })
        break
      }
    }
  }

  return issues
}
