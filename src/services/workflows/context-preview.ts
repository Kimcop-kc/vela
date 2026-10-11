/**
 * 生成前上下文预览
 *
 * 目的：让作者在生成正文前就能看到「这次到底喂了什么、来自哪里」，
 * 而不是只能翻工作流日志里那一行「架构 X 字 / Canon Y 字」。
 *
 * 这里只做统计与结构化（纯函数，不依赖 i18n、不调用模型）；
 * 段落名称与提示文案由界面按 key 渲染，因此同一份数据能支持多语言。
 */
import { estimateTokens } from '../text-analysis'

/** 预览里的一个上下文段落 */
export interface ContextPreviewSection {
  /** 段落标识，界面用它取 i18n 文案 */
  key: string
  chars: number
  tokens: number
  /** 列表类段落的条目数（时间线事件 / 角色状态 / 剧情线 / 事实 / 检索结果） */
  items?: number
  /** 计数明细：如「时间线 24 · 角色状态 7 · 剧情线 3 · 事实 41」 */
  breakdown?: Array<{ key: string; count: number }>
  /** 该段因为长度上限被截断 */
  truncated?: boolean
  /** 该段没有内容（例如第 1 章不检索知识库） */
  empty?: boolean
}

export interface ContextPreview {
  chapterNumber: number
  /** 最终提示词总量（含模板、硬性要求、正文上下文） */
  promptChars: number
  promptTokens: number
  tokenBudget: number
  sections: ContextPreviewSection[]
  /** 需要作者注意的问题（知识库无内容、超出预算等） */
  warnings: string[]
  /** 中性说明（例如「第 1 章不注入上一章结尾」） */
  notes: string[]
}

export interface ContextPreviewInput {
  chapterNumber: number
  firstChapter: boolean
  /** 最终拼装出的提示词 */
  prompt: string
  tokenBudget: number
  architecture: string
  globalGuidance: string
  writingStyle: string
  /** 渲染后的 Canon 动态段（第 1 章不注入时为 null） */
  renderedCanon: string | null
  canonCounts?: { timeline: number; characterStates: number; plotLines: number; facts: number; summaries: number }
  chapterInfo: string
  futureBlueprints: string
  previousEnding: string
  knowledgeContext: string
  knowledgeCount: number
  userGuidance: string
}

/** 每段字符数超过该值时认为被长度上限截断（与提示词构建里的钳制策略一致） */
const TRUNCATED_ARCHITECTURE_CHARS = 6000

export function buildContextPreview(input: ContextPreviewInput): ContextPreview {
  const sections: ContextPreviewSection[] = []
  const warnings: string[] = []
  const notes: string[] = []

  const push = (
    key: string,
    text: string,
    extra?: Partial<Pick<ContextPreviewSection, 'items' | 'breakdown' | 'truncated' | 'empty'>>,
  ) => {
    const chars = (text ?? '').length
    sections.push({
      key,
      chars,
      tokens: chars > 0 ? Math.ceil(chars / 1.5) : 0,
      ...(extra ?? {}),
    })
  }

  push('architecture', input.architecture, {
    truncated: input.architecture.length >= TRUNCATED_ARCHITECTURE_CHARS,
  })

  if (input.renderedCanon !== null) {
    const counts = input.canonCounts
    push('canon', input.renderedCanon, counts
      ? {
          items: counts.timeline + counts.characterStates + counts.plotLines + counts.facts,
          breakdown: [
            { key: 'timeline', count: counts.timeline },
            { key: 'characterStates', count: counts.characterStates },
            { key: 'plotLines', count: counts.plotLines },
            { key: 'facts', count: counts.facts },
          ],
        }
      : undefined)
  }

  push('chapterInfo', input.chapterInfo)
  push('futureBlueprints', input.futureBlueprints)
  push('previousEnding', input.previousEnding)
  push('knowledge', input.knowledgeContext, { items: input.knowledgeCount, empty: input.knowledgeCount === 0 })
  push('guidance', input.globalGuidance)
  push('userGuidance', input.userGuidance)
  push('style', input.writingStyle)

  if (input.knowledgeCount === 0) warnings.push('no-knowledge')
  const promptTokens = estimateTokens(input.prompt)
  if (input.tokenBudget > 0 && promptTokens > input.tokenBudget) {
    warnings.push('over-budget')
  }
  if (input.firstChapter) notes.push('first-chapter')
  if (sections.some(section => section.truncated)) notes.push('truncated')

  return {
    chapterNumber: input.chapterNumber,
    promptChars: input.prompt.length,
    promptTokens,
    tokenBudget: input.tokenBudget,
    sections: sections.filter(section => section.chars > 0 || section.key === 'knowledge'),
    warnings,
    notes,
  }
}
