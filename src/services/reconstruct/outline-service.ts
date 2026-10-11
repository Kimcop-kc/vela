/**
 * 原创剧情重构服务
 *
 * 输入是「参考作品的分析结论 + 自己小说的设定 + 本次创作目标」，输出是可编辑的原创剧情大纲。
 *
 * 两条纪律（对齐任务文档五）：
 *   1. 只借通用技法，不搬具体人事：送进模型的参考材料里，人物名一律换成「角色甲/乙」；
 *   2. 选「只借鉴技巧」时，参考材料里连具体事件都不给，只留技法观察与结构骨架。
 */
import { parseLooseJson } from '../workflows/segmented-generation'
import { ipc } from '../ipc-client'
import { repairTruncatedObject } from './json-repair'
import { reconstructStore } from './store'
import { TECHNIQUE_LABELS } from './analysis-prompt'
import { textSimilarity } from './similarity'
import {
  TECHNIQUE_KEYS,
  type BookAnalysisRecord,
  type PlotBeat,
  type PlotOutlineRecord,
  type PlotOutlineSource,
  type PlotReconstructInput,
  type TechniqueKey,
} from '../../shared/reconstruct'

const BEAT_LIMIT = 40

/** 参考作品里的人名换成中性代号，避免「换个名照搬」 */
function anonymize(text: string, names: string[]): string {
  let output = text
  const labels = ['角色甲', '角色乙', '角色丙', '角色丁', '角色戊', '角色己', '角色庚', '角色辛']
  names.forEach((name, index) => {
    if (!name || name.length < 2) return
    output = output.split(name).join(labels[index] ?? `角色${index + 1}`)
  })
  return output
}

/**
 * 把选中的分析结论压成一份「技法台账」。
 *
 * @param techniquesOnly 只借鉴技巧：不给具体事件与冲突内容，只给技法观察与结构骨架
 */
export function buildSourceDigest(
  analyses: BookAnalysisRecord[],
  techniques: TechniqueKey[],
  techniquesOnly: boolean,
): string {
  const picked = techniques.length > 0 ? techniques : [...TECHNIQUE_KEYS]
  const blocks: string[] = []
  for (const analysis of analyses.slice(0, 20)) {
    const result = analysis.result
    if (!result) continue
    const names = result.characters.map(character => character.name).filter(Boolean)
    const lines: string[] = [`【${analysis.bookName || '参考作品'} 第 ${analysis.chapterNumber} 章 ${analysis.chapterTitle || ''}】`.trim()]
    if (result.summary) lines.push(`  本章概览：${anonymize(result.summary, names)}`)
    for (const key of picked) {
      const note = result.techniques?.[key]
      if (note) lines.push(`  ${TECHNIQUE_LABELS[key]}：${anonymize(note, names)}`)
    }
    const structure = result.plotStructure
    if (structure.coreEvent || structure.escalation || structure.outcome) {
      lines.push(`  结构骨架：核心事件 → ${anonymize(structure.coreEvent || '（未记录）', names)}；升级 → ${anonymize(structure.escalation || '（未记录）', names)}；结果 → ${anonymize(structure.outcome || '（未记录）', names)}`)
    }
    if (!techniquesOnly) {
      if (result.keyEvents.length > 0) lines.push(`  事件序列：${result.keyEvents.map(event => anonymize(event, names)).join(' → ')}`)
      for (const conflict of result.conflicts.slice(0, 3)) {
        lines.push(`  冲突：${anonymize(`${conflict.cause}｜升级：${conflict.escalation}｜解决：${conflict.resolution}`, names)}`)
      }
    }
    if (result.hooks.length > 0) {
      lines.push(`  可借鉴的悬念手法：${result.hooks.slice(0, 4).map(hook => anonymize(`${hook.content}（${hook.status}）`, names)).join('；')}`)
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

/** 自己小说的设定摘要（从项目里读；取不到就留空，不编） */
export async function loadOwnNovelBrief(): Promise<string> {
  try {
    const core = await ipc.invoke('db:project-core-get').catch(() => null)
    const characters = await ipc.invoke('db:character-get-all').catch(() => [] as Array<{ name: string; role: string; motivation?: string }>)
    const parts: string[] = []
    if (core?.premise) parts.push(`核心大纲：${core.premise}`)
    if (core?.worldbuilding) parts.push(`世界观：${core.worldbuilding}`)
    if (core?.synopsis) parts.push(`全书梗概（节选）：${String(core.synopsis).slice(0, 1200)}`)
    if (characters.length > 0) {
      parts.push(`主要角色：${characters.slice(0, 12).map(character => `${character.name}（${character.role || '角色'}${character.motivation ? `，动机：${character.motivation}` : ''}）`).join('；')}`)
    }
    return parts.join('\n')
  } catch {
    return ''
  }
}

/** 构建重构提示词 */
export function buildReconstructMessages(params: {
  input: PlotReconstructInput
  digest: string
  ownNovel: string
  techniquesOnly: boolean
}): Array<{ role: 'system' | 'user'; content: string }> {
  const { input, digest, ownNovel, techniquesOnly } = params
  const system = [
    '你是小说剧情设计师。任务：借鉴参考作品的通用叙事技法，为作者自己的小说重新设计一段原创剧情大纲。',
    '',
    '铁律（违反即失败）：',
    '1. 不许靠换人名、地名、物品名来「原创」；参考材料里的人名已用角色甲/乙代替，你的大纲里也不要出现它们。',
    '2. 不许照搬参考作品的事件组合、人物关系与冲突解法：人物目标、行动动机、冲突来源、事件因果、解决方式都要重新设计。',
    '3. 必须结合作者自己的世界观、人物与已发生剧情，不得与其冲突；不确定的设定标注「待作者确认」，不要自己拍板。',
    '4. 每个节点都要有可追溯的因果链：谁因为什么做了什么，付出什么代价，导致什么后果。',
    '5. 只输出 JSON，不要解释、不要代码块之外的文字。',
  ].join('\n')

  const user = [
    '【作者自己的小说】',
    ownNovel || '（作者尚未填写小说设定，请保持通用，不要引入陌生专有名词）',
    '',
    '【本次创作目标】',
    `目标：${input.goal || '（未填写）'}`,
    `当前故事阶段：${input.stage || '（未填写）'}`,
    `预期的剧情冲突：${input.expectedConflict || '（未填写）'}`,
    `必须避开的内容：${input.exclusions || '（无）'}`,
    `目标章数：${input.targetChapters} 章，每章约 ${input.wordsPerChapter} 字`,
    input.title ? `大纲标题：${input.title}` : '请顺便起一个大纲标题',
    '',
    `【可借鉴的技法（只借这些：${input.techniques.map(key => TECHNIQUE_LABELS[key]).join('、') || '全部'}）】`,
    techniquesOnly ? '本次只借鉴技法与结构骨架，参考材料中的具体事件、冲突内容不会提供，也不要去猜。' : '',
    digest || '（没有选中任何分析结论：请完全基于作者自己的设定来设计）',
    '',
    '【输出 JSON 结构】',
    '{',
    '  "title": "大纲标题",',
    '  "premise": "这段剧情的核心前提（150 字以内）",',
    '  "protagonistGoal": "主角表面追求 × 终极渴望（写清错位）",',
    '  "centralConflict": "核心冲突：谁挡着谁、为什么都不肯退",',
    '  "characterChanges": "人物弧光：起点、终点、中段代价",',
    '  "foreshadowing": "埋设的伏笔与预计回收点",',
    '  "continuityNotes": "与已有剧情/设定的衔接说明；不确定的写「待作者确认」",',
    '  "originalityNotes": "说明这版大纲相对参考作品换了什么（人物关系、冲突来源、事件因果、解法）",',
    `  "beats": [ { "sequence": 1, "title": "", "event": "", "protagonistAction": "", "conflict": "", "consequence": "", "characterChange": "", "hook": "" } ]（约 ${input.targetChapters} 个）`,
    '}',
  ].filter(Boolean).join('\n')

  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

function asText(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** 归一化模型返回的大纲；缺节点只记 warning，不抛错 */
export function normalizePlotOutline(
  raw: unknown,
  ctx: { techniques: TechniqueKey[]; sources: PlotOutlineSource[]; fallbackTitle: string },
): { outline: Omit<PlotOutlineRecord, 'id' | 'createdAt' | 'updatedAt'>; warnings: string[] } {
  const warnings: string[] = []
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const beats: PlotBeat[] = (Array.isArray(source.beats) ? source.beats : [])
    .map((item, index) => {
      const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
      const sequence = Number(row.sequence)
      return {
        sequence: Number.isSafeInteger(sequence) && sequence > 0 ? sequence : index + 1,
        title: asText(row.title, 200) || `节点 ${index + 1}`,
        event: asText(row.event, 2000),
        protagonistAction: asText(row.protagonistAction, 1000),
        conflict: asText(row.conflict, 1000),
        consequence: asText(row.consequence, 1000),
        characterChange: asText(row.characterChange, 1000),
        hook: asText(row.hook, 1000),
      }
    })
    .filter(beat => beat.event || beat.conflict || beat.protagonistAction)
    .slice(0, BEAT_LIMIT)
    .sort((a, b) => a.sequence - b.sequence)
    .map((beat, index) => ({ ...beat, sequence: index + 1 }))

  if (beats.length === 0) warnings.push('模型没有给出可用的剧情节点，请重新生成或手工添加。')
  const incomplete = beats.filter(beat => !beat.event || !beat.hook).length
  if (incomplete > 0) warnings.push(`${incomplete} 个节点缺少事件内容或结尾钩子。`)

  return {
    outline: {
      title: asText(source.title, 200) || ctx.fallbackTitle,
      premise: asText(source.premise),
      protagonistGoal: asText(source.protagonistGoal),
      centralConflict: asText(source.centralConflict),
      characterChanges: asText(source.characterChanges),
      foreshadowing: asText(source.foreshadowing),
      continuityNotes: asText(source.continuityNotes),
      originalityNotes: asText(source.originalityNotes),
      techniques: ctx.techniques,
      beats,
      sources: ctx.sources,
      status: 'draft',
    },
    warnings,
  }
}

export interface ReconstructOutcome {
  saved: boolean
  outline: Omit<PlotOutlineRecord, 'id' | 'createdAt' | 'updatedAt'> | null
  warnings: string[]
  error?: string
  /** 送进模型的参考材料规模，供界面说明「这次用了什么」 */
  digestChars: number
}

/**
 * 生成一版原创剧情大纲并落库。
 *
 * 模型走 llm:generate（purpose: plot_reconstruct，归入「正文生成」用途类别）。
 */
export async function reconstructPlotOutline(params: {
  input: PlotReconstructInput
  techniquesOnly: boolean
}): Promise<ReconstructOutcome> {
  const { input, techniquesOnly } = params
  const analyses = await reconstructStore.getAnalyses(input.sources.map(source => source.analysisId))
  const digest = buildSourceDigest(analyses, input.techniques, techniquesOnly)
  const ownNovel = await loadOwnNovelBrief()

  const { useLLMStore } = await import('../../stores/llm-store')
  const modelId = useLLMStore.getState().resolveModelId('plot_reconstruct')
  if (!modelId) {
    return {
      saved: false, outline: null, warnings: [], digestChars: digest.length,
      error: '没有可用模型：剧情重构使用「正文生成」用途的模型，请先在设置里绑定。',
    }
  }

  let responseText = ''
  let requestError = ''
  try {
    const response = await ipc.invoke('llm:generate', {
      modelId,
      messages: buildReconstructMessages({ input, digest, ownNovel, techniquesOnly }),
      temperature: 0.8,
      thinking: false,
      responseFormat: { type: 'json_object' },
      purpose: 'plot_reconstruct',
    })
    if (response.success === false) requestError = response.error || '模型调用失败'
    else responseText = response.content ?? ''
  } catch (error) {
    requestError = String(error)
  }
  if (requestError && !responseText.trim()) {
    return { saved: false, outline: null, warnings: [], digestChars: digest.length, error: requestError }
  }

  const parsed = parseLooseJson<unknown>(responseText) ?? repairTruncatedObject<Record<string, unknown>>(responseText)
  const { outline, warnings } = normalizePlotOutline(parsed, {
    techniques: input.techniques,
    sources: input.sources,
    fallbackTitle: input.title?.trim() || '未命名大纲',
  })
  if (!parsed) warnings.unshift('模型返回的内容不是合法 JSON，已尽量抢救；建议重新生成。')
  if (outline.beats.length === 0) {
    return { saved: false, outline, warnings, digestChars: digest.length, error: '生成结果里没有可用的剧情节点。' }
  }
  // 参考作品的人物名出现在大纲里就直接提示：这是「换名照搬」最典型的痕迹
  const referenceNames = analyses
    .flatMap(record => record.result?.characters.map(character => character.name) ?? [])
    .filter(name => name.length >= 2)
  const outlineText = outline.beats.map(beat => `${beat.event} ${beat.conflict}`).join(' ')
  const reused = referenceNames.filter(name => outlineText.includes(name))
  if (reused.length > 0) warnings.push(`大纲里出现了参考作品的人物名（${reused.slice(0, 5).join('、')}），请替换成你自己的角色。`)

  const id = await reconstructStore.saveOutline({ ...outline, status: 'draft' })
  if (!id) return { saved: false, outline, warnings, digestChars: digest.length, error: '大纲未能保存到数据库。' }
  return { saved: true, outline, warnings, digestChars: digest.length }
}

/** 重新生成单个节点（其余节点保持不动） */
export async function regenerateBeat(params: {
  outline: PlotOutlineRecord
  beatIndex: number
  instruction?: string
  techniquesOnly?: boolean
}): Promise<{ saved: boolean; outline?: PlotOutlineRecord; error?: string; warnings?: string[] }> {
  const { outline, beatIndex, instruction } = params
  const techniquesOnly = params.techniquesOnly !== false
  const target = outline.beats[beatIndex]
  if (!target) return { saved: false, error: '这个节点不存在。' }

  const input: PlotReconstructInput = {
    sources: outline.sources,
    techniques: outline.techniques,
    goal: instruction?.trim() || `只重写第 ${target.sequence} 个节点：${target.title}`,
    stage: `前一节点：${outline.beats[beatIndex - 1]?.event ?? '（这是第一个节点）'}；后一节点：${outline.beats[beatIndex + 1]?.event ?? '（这是最后一个节点）'}`,
    expectedConflict: outline.centralConflict,
    exclusions: '不要改动其他节点，不要引入参考作品的人物名',
    targetChapters: 1,
    wordsPerChapter: 0,
  }
  const analyses = await reconstructStore.getAnalyses(outline.sources.map(source => source.analysisId))
  const digest = buildSourceDigest(analyses, outline.techniques, techniquesOnly)
  const ownNovel = await loadOwnNovelBrief()

  const { useLLMStore } = await import('../../stores/llm-store')
  const modelId = useLLMStore.getState().resolveModelId('plot_reconstruct')
  if (!modelId) return { saved: false, error: '没有可用模型：剧情重构使用「正文生成」用途的模型。' }

  const response = await ipc.invoke('llm:generate', {
    modelId,
    messages: [
      ...buildReconstructMessages({ input, digest, ownNovel, techniquesOnly }),
      {
        role: 'user',
        content: [
          '【只重写这一个节点】',
          `原节点：${JSON.stringify(target)}`,
          `输出 JSON：{ "beats": [ { "sequence": ${target.sequence}, "title": "", "event": "", "protagonistAction": "", "conflict": "", "consequence": "", "characterChange": "", "hook": "" } ] }`,
        ].join('\n'),
      },
    ],
    temperature: 0.85,
    thinking: false,
    responseFormat: { type: 'json_object' },
    purpose: 'plot_reconstruct',
  })
  if (response.success === false) return { saved: false, error: response.error || '模型调用失败' }

  const parsed = parseLooseJson<unknown>(response.content ?? '') ?? repairTruncatedObject<Record<string, unknown>>(response.content ?? '')
  const { outline: normalized, warnings } = normalizePlotOutline(parsed, {
    techniques: outline.techniques, sources: outline.sources, fallbackTitle: outline.title,
  })
  const replacement = normalized.beats[0]
  if (!replacement) return { saved: false, error: '没有拿到可用的节点内容。', warnings }

  const beats = outline.beats.map((beat, index) => index === beatIndex ? { ...replacement, sequence: target.sequence } : beat)
  const id = await reconstructStore.saveOutline({ ...outline, beats })
  if (!id) return { saved: false, error: '未保存成功。' }
  return { saved: true, outline: { ...outline, beats }, warnings }
}

/** 节点与参考文本的相似度（界面用来提示「和参考章节太像了」） */
export function beatSimilarityTo(beat: PlotBeat, referenceText: string): number | null {
  return textSimilarity(`${beat.event} ${beat.conflict}`, referenceText)
}
