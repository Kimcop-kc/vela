/**
 * 拆书分析 —— 提示词构建与结果归一化
 *
 * 这里刻意与「调用模型」分开：构建提示词、把模型返回的松散 JSON 收拾成
 * 结构化的 ChapterAnalysis，都是纯函数，可以单独测。
 *
 * 归一化原则（对齐任务文档 4.2-F）：
 *   - 模型推测出来的东西一律标成 inference，不许冒充正文事实；
 *   - 缺字段不报错，留空并记一条 warning；
 *   - 数组里混进字符串/对象都能吃下，不让一条脏数据毁掉整章结论。
 */
import {
  TECHNIQUE_KEYS,
  type AnalysisBasis,
  type AnalysisCharacter,
  type AnalysisConflict,
  type AnalysisConfidence,
  type AnalysisEvidence,
  type AnalysisHook,
  type AnalysisPlotStructure,
  type ChapterAnalysis,
  type TechniqueKey,
} from '../../shared/reconstruct'

/** 提示词里对八项叙事技巧的中文说明（顺序与 TECHNIQUE_KEYS 一致） */
export const TECHNIQUE_LABELS: Record<TechniqueKey, string> = {
  opening: '开头如何吸引读者',
  conflictSetup: '如何建立冲突',
  infoRelease: '如何控制信息释放',
  characterDrive: '如何推动人物行动',
  expectation: '如何制造期待',
  cliffhanger: '如何设置章节结尾悬念',
  chapterLink: '如何连接前后章节',
  pacing: '如何控制叙事节奏',
}

const BASIS_VALUES: AnalysisBasis[] = ['text', 'inference', 'unclear']
const CONFIDENCE_VALUES: AnalysisConfidence[] = ['high', 'medium', 'low']

function asText(value: unknown, max = 4000): string {
  if (typeof value === 'string') return value.trim().slice(0, max)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(item => asText(item, max)).filter(Boolean).join('；').slice(0, max)
  return ''
}

function asTextList(value: unknown, max = 20): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n；;、]/) : value == null ? [] : [value]
  return raw
    .map(item => (typeof item === 'object' && item !== null ? asText((item as Record<string, unknown>).name ?? (item as Record<string, unknown>).title ?? item) : asText(item, 500)))
    .filter(Boolean)
    .slice(0, max)
}

function pickBasis(value: unknown, fallback: AnalysisBasis = 'text'): AnalysisBasis {
  const text = typeof value === 'string' ? value.toLowerCase().trim() : ''
  if (BASIS_VALUES.includes(text as AnalysisBasis)) return text as AnalysisBasis
  // 中文别名也认一下，模型经常直接写中文
  if (/推测|推断|猜测|infer/.test(text)) return 'inference'
  if (/无法|未知|不确定|unclear/.test(text)) return 'unclear'
  if (/原文|正文|text|fact/.test(text)) return 'text'
  return fallback
}

function pickConfidence(value: unknown, fallback: AnalysisConfidence = 'medium'): AnalysisConfidence {
  const text = typeof value === 'string' ? value.toLowerCase().trim() : ''
  if (CONFIDENCE_VALUES.includes(text as AnalysisConfidence)) return text as AnalysisConfidence
  if (/高|high/.test(text)) return 'high'
  if (/低|low/.test(text)) return 'low'
  if (/中|medium/.test(text)) return 'medium'
  return fallback
}

function pickNumber(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(num) ? num : fallback
}

/** 剥掉模型爱加的 ```json 代码块围栏 */
export function stripJsonFence(text: string): string {
  const trimmed = (text ?? '').trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1].trim() : trimmed
}

/**
 * 构建单章分析的提示词。
 *
 * 明确写死三件事，避免模型自由发挥：
 *   1. 只分析这一章，不要引用其他章节的情节；
 *   2. 推测必须标 basis=inference；
 *   3. 只输出 JSON。
 */
export function buildChapterAnalysisMessages(params: {
  bookName: string
  chapterNumber: number
  chapterTitle: string
  chapterText: string
  /** 附加要求（界面上的「本次分析侧重」） */
  focus?: string
  /** 单章正文过长时的截断提示，由调用方给出 */
  truncated?: boolean
}): Array<{ role: 'system' | 'user'; content: string }> {
  const techniqueLines = TECHNIQUE_KEYS
    .map(key => `    "${key}": "【${TECHNIQUE_LABELS[key]}】本章具体怎么做的（一句话，要具体到这个章节的做法，不要写通用理论）"`)
    .join(',\n')

  const system = [
    '你是小说拆解分析师。你的任务是分析**参考作品**的指定章节，输出结构化结论，供作者借鉴通用叙事技法。',
    '',
    '硬性规则：',
    '1. 只依据给出的这一章正文，不要引入其他章节的情节，也不要补充自己的创作。',
    '2. 属于正文能直接读到的结论，basis 写 "text"；属于你的推测，basis 必须写 "inference"；无法判断写 "unclear"。',
    '3. 每条重要结论都要带 quote（原文片段，尽量短）与 confidence（high/medium/low）。原文里找不到支撑的，不要写成 text。',
    '4. 只输出 JSON，不要任何解释、不要 Markdown 代码块以外的文字。',
  ].join('\n')

  const user = [
    `参考作品：《${params.bookName}》`,
    `本章：第 ${params.chapterNumber} 章 ${params.chapterTitle || ''}`.trim(),
    params.focus?.trim() ? `本次分析侧重：${params.focus.trim()}` : '',
    params.truncated ? '注意：本章正文较长，只提供了前半部分，结论以给出的内容为准，不要推测后文。' : '',
    '',
    '【本章正文】',
    params.chapterText,
    '',
    '【输出 JSON 结构】',
    '{',
    '  "summary": "本章讲了什么（150 字以内）",',
    '  "protagonist": "本章视角/行动核心人物",',
    '  "characters": [',
    '    { "name": "", "identity": "", "goal": "", "motive": "", "personality": "", "relationships": "", "change": "", "interestConflict": "" }',
    '  ],',
    '  "locations": ["主要地点"],',
    '  "items": ["关键物品"],',
    '  "keyEvents": ["关键事件，按发生顺序"],',
    '  "plotStructure": {',
    '    "coreEvent": "", "goal": "", "protagonistAction": "", "obstacle": "", "escalation": "",',
    '    "resolution": "", "twist": "", "outcome": "", "impactOnLater": ""',
    '  },',
    '  "conflicts": [ { "parties": [""], "cause": "", "escalation": "", "resolution": "" } ],',
    '  "techniques": {',
    techniqueLines,
    '  },',
    '  "hooks": [ { "content": "", "position": "", "purpose": "", "status": "planted|resolved|open|unclear", "basis": "text|inference", "confidence": "high|medium|low" } ],',
    '  "evidence": [ { "claim": "", "quote": "", "basis": "text|inference", "confidence": "high|medium|low" } ]',
    '}',
  ].filter(Boolean).join('\n')

  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

/**
 * 把模型返回的松散对象归一化成 ChapterAnalysis。
 *
 * @param raw 已解析的 JSON（未解析成功时传 null，此时返回带 warning 的空骨架）
 */
export function normalizeChapterAnalysis(raw: unknown, ctx: { chapterNumber: number; chapterTitle: string }): ChapterAnalysis {
  const warnings: string[] = []
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (typeof raw !== 'object' || raw === null) warnings.push('模型没有返回可解析的 JSON，本章只有空结论，请重试。')

  const characters: AnalysisCharacter[] = (Array.isArray(source.characters) ? source.characters : [])
    .map(item => {
      if (typeof item === 'string') return { name: asText(item, 200), identity: '', goal: '', motive: '', personality: '', relationships: '', change: '', interestConflict: '' }
      const row = (item ?? {}) as Record<string, unknown>
      return {
        name: asText(row.name, 200),
        identity: asText(row.identity, 1000),
        goal: asText(row.goal, 1000),
        motive: asText(row.motive, 1000),
        personality: asText(row.personality, 1000),
        relationships: asText(row.relationships, 1500),
        change: asText(row.change, 1000),
        interestConflict: asText(row.interestConflict ?? row.conflict, 1000),
      }
    })
    .filter(character => character.name)
    .slice(0, 30)

  const plotRaw = (typeof source.plotStructure === 'object' && source.plotStructure !== null ? source.plotStructure : {}) as Record<string, unknown>
  const plotStructure: AnalysisPlotStructure = {
    coreEvent: asText(plotRaw.coreEvent),
    goal: asText(plotRaw.goal),
    protagonistAction: asText(plotRaw.protagonistAction),
    obstacle: asText(plotRaw.obstacle),
    escalation: asText(plotRaw.escalation),
    resolution: asText(plotRaw.resolution),
    twist: asText(plotRaw.twist),
    outcome: asText(plotRaw.outcome),
    impactOnLater: asText(plotRaw.impactOnLater),
  }
  const missingPlot = Object.entries(plotStructure).filter(([, value]) => !value).map(([key]) => key)
  if (missingPlot.length > 0) warnings.push(`剧情结构缺少：${missingPlot.join('、')}。`)

  const conflicts: AnalysisConflict[] = (Array.isArray(source.conflicts) ? source.conflicts : [])
    .map(item => {
      const row = (typeof item === 'string' ? { cause: item } : (item ?? {})) as Record<string, unknown>
      return {
        parties: asTextList(row.parties, 10),
        cause: asText(row.cause),
        escalation: asText(row.escalation),
        resolution: asText(row.resolution),
      }
    })
    .filter(conflict => conflict.cause || conflict.parties.length > 0)
    .slice(0, 20)

  const techniqueRaw = (typeof source.techniques === 'object' && source.techniques !== null ? source.techniques : {}) as Record<string, unknown>
  const techniques = {} as Record<TechniqueKey, string>
  for (const key of TECHNIQUE_KEYS) techniques[key] = asText(techniqueRaw[key], 2000)
  const missingTechniques = TECHNIQUE_KEYS.filter(key => !techniques[key])
  if (missingTechniques.length > 0) warnings.push(`叙事技巧缺少：${missingTechniques.map(key => TECHNIQUE_LABELS[key]).join('、')}。`)

  const hooks: AnalysisHook[] = (Array.isArray(source.hooks) ? source.hooks : [])
    .map(item => {
      const row = (typeof item === 'string' ? { content: item } : (item ?? {})) as Record<string, unknown>
      const statusText = asText(row.status, 40).toLowerCase()
      const status: AnalysisHook['status'] = statusText.includes('resolv') || statusText.includes('回收')
        ? 'resolved'
        : statusText.includes('open') || statusText.includes('未回收') || statusText.includes('悬')
          ? 'open'
          : statusText.includes('unclear') || statusText.includes('无法')
            ? 'unclear'
            : 'planted'
      return {
        content: asText(row.content, 1000),
        position: asText(row.position, 200),
        purpose: asText(row.purpose, 1000),
        status,
        basis: pickBasis(row.basis, 'inference'),
        confidence: pickConfidence(row.confidence, 'low'),
      }
    })
    .filter(hook => hook.content)
    .slice(0, 40)

  const evidence: AnalysisEvidence[] = (Array.isArray(source.evidence) ? source.evidence : [])
    .map(item => {
      const row = (typeof item === 'string' ? { claim: item } : (item ?? {})) as Record<string, unknown>
      return {
        claim: asText(row.claim, 1000),
        quote: asText(row.quote, 1000),
        chapterNumber: pickNumber(row.chapterNumber, ctx.chapterNumber),
        basis: pickBasis(row.basis, 'text'),
        confidence: pickConfidence(row.confidence, 'medium'),
      }
    })
    .filter(item => item.claim)
    .slice(0, 60)

  // 关键事件/地点/物品：模型经常给成对象数组，这里统一压成字符串
  const keyEvents = asTextList(source.keyEvents, 40)
  if (keyEvents.length === 0) warnings.push('没有提取到关键事件。')

  const rawWarnings = asTextList(source.warnings, 20)
  const summary = asText(source.summary, 2000)
  if (!summary) warnings.push('没有生成章节概要。')

  return {
    chapterNumber: ctx.chapterNumber,
    chapterTitle: ctx.chapterTitle,
    summary,
    protagonist: asText(source.protagonist, 200),
    characters,
    locations: asTextList(source.locations, 20),
    items: asTextList(source.items, 20),
    keyEvents,
    plotStructure,
    conflicts,
    techniques,
    hooks,
    evidence,
    warnings: [...warnings, ...rawWarnings].slice(0, 30),
  }
}
