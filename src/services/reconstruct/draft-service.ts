/** 按原创大纲生成章节正文：逐节点生成、可单节点重写，产出先落草稿，绝不覆盖已有正文。 */
import { ipc } from '../ipc-client'
import { estimateTokens } from '../workflows/segmented-generation'
import { loadChapterCanon } from './canon-adapter'
import type { PlotBeat, PlotOutlineRecord } from '../../shared/reconstruct'

/** 单个节点生成的正文段 */
export interface DraftSegment {
  sequence: number
  title: string
  text: string
  wordCount: number
  error?: string
}

// 从大纲里抽 2-4 字的中文片段当关键词，供「按本章相关事实筛选」使用。
// 宁可稍微多带一点上下文，也别把关键设定漏掉。
function keywordsOf(outline: PlotOutlineRecord, beats: PlotBeat[]): string[] {
  const text = [
    outline.protagonistGoal, outline.centralConflict, outline.characterChanges, outline.foreshadowing,
    ...beats.flatMap(beat => [beat.title, beat.event, beat.protagonistAction, beat.conflict, beat.consequence, beat.characterChange]),
  ].join(' ')
  const candidates = new Set<string>()
  for (const match of text.matchAll(/[\u4e00-\u9fa5]{2,4}/g)) {
    candidates.add(match[0])
    if (candidates.size >= 60) break
  }
  return [...candidates]
}

/** 生成某个节点的提示词（以节点为单位产出，便于单独重写） */
export function buildBeatDraftPrompt(params: {
  outline: PlotOutlineRecord
  beat: PlotBeat
  previousText: string
  canonRendered: string
  ownNovel: string
  targetWords: number
  guidance?: string
  instruction?: string
}): Array<{ role: 'system' | 'user'; content: string }> {
  const { beat, previousText, canonRendered, ownNovel, targetWords, guidance, instruction } = params
  const system = [
    '你是中文小说写手。按给定的剧情节点写正文，只写这一段。',
    '',
    '硬性要求：',
    '1. 严格遵循下面的正史设定与既有剧情，不得推翻人物状态、时间线、物品归属与世界观规则。',
    '2. 只写这一个节点要求的内容，不要提前推进后续节点，不要替读者总结主题。',
    '3. 直接输出正文纯文本：不要标题、不要 Markdown 标记、不要解释，对话用中文双引号。',
    '4. 长短句交错，避免段尾总结、排比式设定倾泻，以及「仿佛」「不禁」这类套话。',
  ].join('\n')

  const user = [
    ownNovel ? `【作者的小说设定】\n${ownNovel}` : '',
    canonRendered ? `【正史设定与既有剧情（不可违背）】\n${canonRendered}` : '',
    `【本段剧情大纲】第 ${beat.sequence} 段《${beat.title}》`,
    `事件：${beat.event}`,
    beat.protagonistAction ? `主角行动：${beat.protagonistAction}` : '',
    beat.conflict ? `冲突：${beat.conflict}` : '',
    beat.consequence ? `后果：${beat.consequence}` : '',
    beat.characterChange ? `人物变化：${beat.characterChange}` : '',
    beat.hook ? `结尾要留的钩子：${beat.hook}` : '',
    previousText ? `【前文结尾（必须自然衔接）】\n${previousText.slice(-600)}` : '',
    guidance ? `【文风与硬性要求】\n${guidance}` : '',
    instruction ? `【作者的额外要求（最高优先级）】\n${instruction}` : '',
    `【篇幅】约 ${targetWords} 字（上下浮动两成以内即可，不要注水）。`,
  ].filter(Boolean).join('\n\n')

  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

/** 粗略判断这一段有没有写到节点要求（本地关键词覆盖，不调用模型） */
export function beatCoverage(text: string, beat: PlotBeat): number {
  const target = `${beat.event} ${beat.protagonistAction} ${beat.conflict}`
  const tokens = [...new Set([...target.matchAll(/[\u4e00-\u9fa5]{2,4}/g)].map(match => match[0]))].slice(0, 12)
  if (tokens.length === 0) return 1
  const hit = tokens.filter(token => text.includes(token)).length
  return Math.round((hit / tokens.length) * 100) / 100
}

export interface GenerateDraftParams {
  outline: PlotOutlineRecord
  /** 要生成的节点（默认全部） */
  beats: PlotBeat[]
  chapterNumber: number
  targetWordsPerBeat: number
  guidance?: string
  isCancelled?: () => boolean
  onSegment?: (segment: DraftSegment) => void
  onProgress?: (done: number, total: number) => void
}

/**
 * 逐节点生成正文段。
 *
 * 每段独立生成：这样「重新生成指定段落」就是重跑一段，
 * 也避免「整章一次性生成」撞上输出上限后被截断。
 */
export async function generateDraftSegments(params: GenerateDraftParams): Promise<{ segments: DraftSegment[]; cancelled: boolean; error?: string }> {
  const { outline, beats, chapterNumber, targetWordsPerBeat, guidance, isCancelled, onSegment, onProgress } = params
  const project = (await import('../../stores/project-store')).useProjectStore.getState().currentProject
  const ownNovel = [project?.novelConfig?.genre, project?.novelConfig?.worldSetting, project?.novelConfig?.protagonistProfile]
    .filter(Boolean).join('\n').slice(0, 2000)
  const canon = await loadChapterCanon({
    chapterNumber,
    chapterGoal: outline.premise || outline.title,
    keywords: keywordsOf(outline, beats),
  })

  const { useLLMStore } = await import('../../stores/llm-store')
  const modelId = useLLMStore.getState().resolveModelId('reconstruct_draft')
  if (!modelId) {
    return { segments: [], cancelled: false, error: '没有可用模型：正文生成使用「正文生成」用途的模型，请先在设置里绑定。' }
  }

  const segments: DraftSegment[] = []
  let previousText = ''
  for (const [index, beat] of beats.entries()) {
    if (isCancelled?.()) return { segments, cancelled: true }
    const messages = buildBeatDraftPrompt({
      outline, beat, previousText, canonRendered: canon.rendered, ownNovel,
      targetWords: targetWordsPerBeat, guidance,
    })
    let text = ''
    let error: string | undefined
    try {
      const response = await ipc.invoke('llm:generate', {
        modelId,
        messages,
        temperature: 0.85,
        thinking: false,
        purpose: 'reconstruct_draft',
      })
      if (response.success === false) error = response.error || '模型调用失败'
      else text = (response.content ?? '').trim()
    } catch (caught) {
      error = String(caught)
    }
    const segment: DraftSegment = {
      sequence: beat.sequence,
      title: beat.title,
      text,
      wordCount: text.replace(/\s/g, '').length,
      error,
    }
    segments.push(segment)
    onSegment?.(segment)
    onProgress?.(index + 1, beats.length)
    if (text) previousText = text
  }
  return { segments, cancelled: false }
}

/** 重写单个节点（保留其它段落） */
export async function regenerateBeatSegment(params: {
  outline: PlotOutlineRecord
  beat: PlotBeat
  chapterNumber: number
  targetWords: number
  previousText: string
  instruction?: string
}): Promise<DraftSegment> {
  const { outline, beat, chapterNumber, targetWords, previousText, instruction } = params
  const { useLLMStore } = await import('../../stores/llm-store')
  const modelId = useLLMStore.getState().resolveModelId('reconstruct_draft')
  if (!modelId) return { sequence: beat.sequence, title: beat.title, text: '', wordCount: 0, error: '没有可用模型。' }

  const project = (await import('../../stores/project-store')).useProjectStore.getState().currentProject
  const ownNovel = [project?.novelConfig?.genre, project?.novelConfig?.worldSetting, project?.novelConfig?.protagonistProfile]
    .filter(Boolean).join('\n').slice(0, 2000)
  const canon = await loadChapterCanon({
    chapterNumber,
    chapterGoal: outline.premise || outline.title,
    keywords: keywordsOf(outline, [beat]),
  })

  try {
    const response = await ipc.invoke('llm:generate', {
      modelId,
      messages: buildBeatDraftPrompt({
        outline, beat, previousText, canonRendered: canon.rendered, ownNovel,
        targetWords, instruction,
        guidance: project?.novelConfig?.writingStyle,
      }),
      temperature: 0.85,
      thinking: false,
      purpose: 'reconstruct_draft',
    })
    if (response.success === false) {
      return { sequence: beat.sequence, title: beat.title, text: '', wordCount: 0, error: response.error || '模型调用失败' }
    }
    const text = (response.content ?? '').trim()
    return { sequence: beat.sequence, title: beat.title, text, wordCount: text.replace(/\s/g, '').length }
  } catch (error) {
    return { sequence: beat.sequence, title: beat.title, text: '', wordCount: 0, error: String(error) }
  }
}

/** 把段落拼成整章正文（空段跳过，段间空行） */
export function composeChapterText(segments: DraftSegment[]): string {
  return segments
    .filter(segment => segment.text.trim())
    .map(segment => segment.text.trim())
    .join('\n\n')
}

/**
 * 把生成结果保存为新草稿。
 *
 * 走草稿版本机制：每次生成都是新版本，已有正文一个字都不会被覆盖，
 * 作者在编辑器里确认后才谈得上替换。
 */
export async function saveAsDraft(params: {
  chapterNumber: number
  content: string
}): Promise<{ success: boolean; draftId?: number; version?: number; error?: string }> {
  const { chapterNumber, content } = params
  if (!content.trim()) return { success: false, error: '正文为空，未保存。' }
  try {
    const version = await ipc.invoke('db:draft-next-version', chapterNumber)
    const result = await ipc.invoke('db:draft-create', {
      chapterNumber,
      version,
      source: 'write',
      content,
      wordCount: content.replace(/\s/g, '').length,
    })
    if (!result?.success) return { success: false, error: result?.error ?? '保存失败' }
    return { success: true, draftId: result.id, version }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/** 正文段的 token 估算（界面显示用） */
export function segmentTokens(text: string): number {
  return estimateTokens(text)
}
