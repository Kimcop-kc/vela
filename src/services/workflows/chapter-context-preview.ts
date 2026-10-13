/**
 * 本章上下文预览（第三阶段）
 *
 * 需求原文：
 *   「预览必须来自真正发送给模型的最终请求，不能只是另一份看起来相似的展示文本。」
 *
 * 因此这里**不重新拼一遍提示词**，而是把 command 在调用前登记的真实请求快照
 * （见 base-command.ts 的 recordLLMRequestSnapshot）拿出来渲染。
 * 预览里显示的每一条消息，就是主进程实际收到的那一条。
 *
 * 本模块是**纯函数 + 只读**：不调用模型、不写库、不改正文。
 */
import type { WorkflowContext } from '../../stores/workflow-store'
import { getLLMRequestSnapshots, type LLMRequestSnapshot } from './commands/base-command'
import { estimateTokens } from '../text-analysis'
import type { ChapterContextPack, ContextNotice, ContextSection } from './chapter-context-pack'

/** 预览里的一条真实消息 */
export interface PreviewMessage {
  round: number
  role: 'system' | 'user' | 'assistant'
  content: string
  chars: number
  tokens: number
}

/** 逐轮请求概况 */
export interface PreviewRound {
  round: number
  purpose: string
  thinking: boolean
  maxTokens?: number
  messageCount: number
  chars: number
  tokens: number
}

export interface ChapterContextPreview {
  chapterNumber: number
  /** 资料包（十段、预算、缺口与冲突） */
  pack: ChapterContextPack
  /** 真正发送出去的完整消息（逐轮，按发送顺序） */
  messages: PreviewMessage[]
  /** 逐轮概况 */
  rounds: PreviewRound[]
  /** 资料包估算占用（用于和真实请求对比） */
  packTokens: number
  /** 真实请求总占用（所有轮次之和） */
  requestTokens: number
  /** 请求是否已捕获（未捕获说明还没调用过模型） */
  captured: boolean
}

/**
 * 从工作流上下文中取出真实请求，与资料包组合成预览。
 *
 * @param pack 已构建的资料包（buildChapterContextPack 的产物）
 * @param context 工作流上下文（请求快照的来源）
 * @param chapterNumber 本章章节号
 */
export function buildChapterContextPreview(
  pack: ChapterContextPack,
  context: WorkflowContext | undefined,
  chapterNumber: number,
): ChapterContextPreview {
  const snapshots: LLMRequestSnapshot[] = getLLMRequestSnapshots(context)
  const messages: PreviewMessage[] = []
  const rounds: PreviewRound[] = []

  for (const snapshot of snapshots) {
    let roundChars = 0
    let roundTokens = 0
    for (const message of snapshot.messages) {
      const tokens = estimateTokens(message.content)
      messages.push({
        round: snapshot.round,
        role: message.role,
        content: message.content,
        chars: message.content.length,
        tokens,
      })
      roundChars += message.content.length
      roundTokens += tokens
    }
    rounds.push({
      round: snapshot.round,
      purpose: snapshot.purpose,
      thinking: snapshot.thinking,
      maxTokens: snapshot.maxTokens,
      messageCount: snapshot.messages.length,
      chars: roundChars,
      tokens: roundTokens,
    })
  }

  const packTokens = pack.sections.reduce((sum, section) => sum + section.tokens, 0)
  const requestTokens = messages.reduce((sum, message) => sum + message.tokens, 0)

  return {
    chapterNumber,
    pack,
    messages,
    rounds,
    packTokens,
    requestTokens,
    captured: snapshots.length > 0,
  }
}

/** 明细行：让界面能逐条展示「哪一段、来自哪里、为何被选中/排除」 */
export interface ContextSectionReport {
  key: ContextSection['key']
  priority: number
  keptCount: number
  droppedCount: number
  tokens: number
  empty: boolean
  /** 被保留的条目（含选取理由） */
  kept: Array<{ id: string; title: string; reason: string; tokens: number; origin: string }>
  /** 被排除的条目（含排除原因） */
  dropped: Array<{ id: string; title: string; reason: string; tokens: number }>
}

/**
 * 把资料包整理成「界面直接可用」的明细报告：
 * 每条记忆的来源、类型、为何被选中、哪些被排除及原因。
 */
export function buildSectionReport(pack: ChapterContextPack): ContextSectionReport[] {
  const droppedBySection = new Map<string, ContextNotice[]>()
  for (const notice of pack.notices) {
    if (notice.kind !== 'truncated' || !notice.section) continue
    droppedBySection.set(notice.section, [...(droppedBySection.get(notice.section) ?? []), notice])
  }

  return pack.sections.map(section => ({
    key: section.key,
    priority: section.priority,
    keptCount: section.items.length,
    droppedCount: section.dropped,
    tokens: section.tokens,
    empty: section.empty,
    kept: section.items.map(item => ({
      id: item.id,
      title: item.title,
      reason: item.reason,
      tokens: item.tokens,
      origin: describeOrigin(item.source),
    })),
    dropped: (droppedBySection.get(section.key) ?? []).map(notice => ({
      id: `${section.key}:dropped`,
      title: notice.message,
      reason: '超出上下文预算，按优先级被省略',
      tokens: 0,
    })),
  }))
}

/** 把条目的原始来源转成人类可读的定位信息 */
function describeOrigin(source: unknown): string {
  if (!source || typeof source !== 'object') return '—'
  const record = source as Record<string, unknown>
  if (typeof record.chapterNumber === 'number') {
    const extra = typeof record.sequence === 'number' ? ` · 第 ${record.sequence} 段` : ''
    return `第 ${record.chapterNumber} 章${extra}`
  }
  if (typeof record.startedAt === 'number') return `剧情线（起始第 ${record.startedAt} 章）`
  if (typeof record.updatedAtChapter === 'number') return `人物状态（截至第 ${record.updatedAtChapter} 章）`
  if (typeof record.introducedAt === 'number') return `事实（第 ${record.introducedAt} 章引入）`
  if (typeof record.kind === 'string') return `作者设置：${record.kind}`
  if (Array.isArray(source)) return `物品流转记录（${source.length} 条）`
  return '—'
}

/** 预览文本：把真实请求逐轮拼成可读文本（默认终止对话框显示的就是它） */
export function renderPreviewText(preview: ChapterContextPreview): string {
  if (!preview.captured) {
    return '（尚未捕获到真实请求：请在生成一次后查看，或确认生成流程已接入）'
  }
  return preview.rounds
    .map(round => {
      const header = `===== 第 ${round.round + 1} 轮请求（${round.purpose}）· ${round.messageCount} 条消息 · 约 ${round.tokens} tokens =====`
      const body = preview.messages
        .filter(message => message.round === round.round)
        .map(message => `--- ${message.role} ---\n${message.content}`)
        .join('\n\n')
      return `${header}\n${body}`
    })
    .join('\n\n')
}
