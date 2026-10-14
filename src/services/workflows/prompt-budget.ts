/**
 * 整份提示词的预算裁剪
 *
 * 背景：Canon 段内部已经由「本章资料包」（chapter-context-pack）按优先级裁剪，
 * 但提示词里还有几段不受它管——全书架构、上一章结尾、后续章节预告、知识库检索、
 * 全局写作要求、文风要求。它们加起来能让提示词超出模型窗口，而程序以前只是打一条
 * 「已超出预算」的警告，请求照样发出去。
 *
 * 这里做的是「按重要性从低到高削」：先整段丢弃，丢一段不够就把当前这段按句子边界截断，
 * 截到刚好放进预算为止。硬性约束、本章信息、Canon 段是保护段——它们的字数照常计入
 * 总量，但不会被丢；真的只剩它们还超预算时，如实返回 stillOver，由调用方报给作者。
 */
import { estimateTokens } from '../text-analysis'

export type PromptSectionKey =
  | 'canon'
  | 'chapterInfo'
  | 'architecture'
  | 'previousEnding'
  | 'futureBlueprints'
  | 'rag'
  | 'globalGuidance'
  | 'writingStyle'

/** 数字越小越重要：预算不够时从数字大的开始削 */
export const PROMPT_SECTION_PRIORITY: Record<PromptSectionKey, number> = {
  chapterInfo: 1,
  canon: 2,
  writingStyle: 3,
  globalGuidance: 4,
  architecture: 5,
  previousEnding: 6,
  futureBlueprints: 7,
  rag: 8,
}

/** 保护段：计数但从不裁剪（缺了会直接影响这一章写得对不对） */
const PROTECTED_KEYS: PromptSectionKey[] = ['canon', 'chapterInfo']

export interface PromptBudgetTrim {
  key: PromptSectionKey
  mode: 'dropped' | 'truncated'
  removedTokens: number
}

export interface PromptBudgetResult {
  /** 逐段的最终文本（未裁剪的段原样返回） */
  values: Record<PromptSectionKey, string>
  trims: PromptBudgetTrim[]
  tokensBefore: number
  tokensAfter: number
  /** 削完仍然超预算（只剩保护段时才会出现） */
  stillOver: boolean
}

/** 在句子边界上截断到不超过 tokens 的预算 */
function cutToTokens(text: string, tokens: number): string {
  if (tokens <= 0) return ''
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (estimateTokens(text.slice(0, mid)) <= tokens) low = mid
    else high = mid - 1
  }
  const clipped = text.slice(0, low)
  const boundary = Math.max(clipped.lastIndexOf('。'), clipped.lastIndexOf('！'), clipped.lastIndexOf('？'), clipped.lastIndexOf('\n'))
  // 句子边界太靠前（不足七成）时宁可硬截，也不丢一半内容
  const kept = boundary > low * 0.7 ? clipped.slice(0, boundary + 1) : clipped
  const omitted = text.length - kept.length
  return `${kept.trimEnd()}\n…（此处已按上下文预算省略约 ${omitted} 字）`
}

/**
 * 截断说明自身也要占 token。
 * 不预留的话，削完刚好超预算一点点（实测差 17 tokens 这种），等于白削。
 */
const MARKER_TOKENS = estimateTokens('…（此处已按上下文预算省略约 99999 字）')

/**
 * 按预算裁剪各段。
 *
 * @param sections 参与计价的段落（含保护段，保护段请自行标记或放进 PROTECTED_KEYS）
 * @param budgetTokens 本次可用的输入预算
 */
export function applyPromptBudget(
  sections: Array<{ key: PromptSectionKey; text: string }>,
  budgetTokens: number,
): PromptBudgetResult {
  const values = {} as Record<PromptSectionKey, string>
  const tokensOf = new Map<PromptSectionKey, number>()
  let total = 0
  for (const section of sections) {
    const text = section.text ?? ''
    values[section.key] = text
    const tokens = estimateTokens(text)
    tokensOf.set(section.key, tokens)
    total += tokens
  }
  const tokensBefore = total
  const trims: PromptBudgetTrim[] = []
  if (total <= budgetTokens || budgetTokens <= 0) {
    return { values, trims, tokensBefore, tokensAfter: total, stillOver: total > budgetTokens }
  }

  const candidates = sections
    .filter(section => !PROTECTED_KEYS.includes(section.key))
    .sort((a, b) => PROMPT_SECTION_PRIORITY[b.key] - PROMPT_SECTION_PRIORITY[a.key])

  let excess = total - budgetTokens
  for (const section of candidates) {
    if (excess <= 0) break
    const tokens = tokensOf.get(section.key) ?? 0
    if (tokens <= 0) continue
    if (tokens <= excess) {
      // 整段丢掉更划算：截一半反而既占地方又读不通
      values[section.key] = ''
      trims.push({ key: section.key, mode: 'dropped', removedTokens: tokens })
      excess -= tokens
      continue
    }
    const keep = tokens - excess
    values[section.key] = cutToTokens(values[section.key], Math.max(0, keep - MARKER_TOKENS))
    trims.push({ key: section.key, mode: 'truncated', removedTokens: excess })
    excess = 0
  }

  const tokensAfter = sections.reduce((sum, section) => sum + estimateTokens(values[section.key] ?? ''), 0)
  return { values, trims, tokensBefore, tokensAfter, stillOver: tokensAfter > budgetTokens }
}
