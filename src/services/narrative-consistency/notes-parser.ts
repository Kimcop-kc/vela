/**
 * 章节要点解析 —— 把模型已经生成的「结构化章节要点」拆成可写回的结构化数据。
 *
 * 背景（为什么需要它）：定稿写回原本只有一套关键词启发式（段首是角色名＋动作动词才算事件、
 * 事实必须匹配「X 是 Y」这类句式）。正常文学写法几乎不命中，于是 19 章定稿下来
 * 时间线只有 3 条、事实 0 条，故事圣经基本是空的。
 *
 * 而同一批章节其实已经有一份高质量的模型产物：定稿时生成的「章节要点」，
 * 里面按【剧情节点 / 角色动态 / 新增设定 / 伏笔与钩子】分好了段。
 * 这里只做解析与映射，不额外调用模型：
 *   剧情节点 → 时间线事件
 *   角色动态 → 角色状态
 *   新增设定 → 事实（待作者确认）
 *   [埋]     → 伏笔（剧情线）
 *   [钩]     → 时间线事件（章末悬念）
 */
import type { CharacterStateDelta, Fact, PlotLine, TimelineEvent } from './types'

export interface ParsedChapterNotes {
  events: Array<Omit<TimelineEvent, 'id' | 'createdAt'>>
  characterDeltas: CharacterStateDelta[]
  facts: Array<Omit<Fact, 'id'>>
  foreshadows: Array<Omit<PlotLine, 'id' | 'startedAt' | 'lastAdvancedAt'>>
  /** 解析到的东西够不够用（界面/日志据此提示「要点里没有可写回的内容」） */
  stats: { beats: number; characters: number; settings: number; foreshadows: number; hooks: number }
}

/** 章节要点里可能出现的中英段落名（模型两种语言都会输出） */
const SECTION_ALIASES = {
  beats: ['剧情节点', '关键剧情', 'plot beats', 'plot points'],
  characters: ['角色动态', '角色变化', 'character changes', 'characters'],
  settings: ['新增设定', '世界观设定', 'new settings', 'new canon'],
  hooks: ['伏笔与钩子', '伏笔', 'foreshadowing', 'hooks'],
} as const

type SectionKey = keyof typeof SECTION_ALIASES

function sectionOf(heading: string): SectionKey | null {
  const text = heading.replace(/^#+\s*/, '').replace(/[【】[\]]/g, '').trim().toLowerCase()
  for (const [key, aliases] of Object.entries(SECTION_ALIASES) as Array<[SectionKey, readonly string[]]>) {
    if (aliases.some(alias => text.includes(alias.toLowerCase()))) return key
  }
  return null
}

/** 剥掉 [触发] 这类标记与行首符号 */
function cleanLine(line: string): { tag: string; text: string } {
  const withoutBullet = line.replace(/^\s*[-*·]\s*/, '').trim()
  const match = withoutBullet.match(/^[【[]([^】\]]{1,6})[】\]]\s*(.+)$/)
  if (match) return { tag: match[1].trim(), text: match[2].trim() }
  return { tag: '', text: withoutBullet }
}

/** 文本里出现的已知角色名（按名字长度优先，避免短名误判） */
function namesIn(text: string, knownNames: string[]): string[] {
  return knownNames
    .filter(name => name.length >= 2 && text.includes(name))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4)
}

/**
 * 解析章节要点。
 *
 * @param notes 要点全文（可能带【结构化要点】前缀）
 * @param ctx 章节号、标题、已知角色名（来自角色卡）
 */
export function parseChapterNotes(
  notes: string,
  ctx: { chapterNumber: number; chapterTitle: string; characterNames: string[] },
): ParsedChapterNotes {
  const empty: ParsedChapterNotes = {
    events: [], characterDeltas: [], facts: [], foreshadows: [],
    stats: { beats: 0, characters: 0, settings: 0, foreshadows: 0, hooks: 0 },
  }
  const text = (notes ?? '').replace(/\r\n/g, '\n')
  if (!text.trim()) return empty

  const sections = new Map<SectionKey, string[]>()
  let current: SectionKey | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd()
    if (/^#{1,6}\s/.test(line)) {
      current = sectionOf(line)
      if (current && !sections.has(current)) sections.set(current, [])
      continue
    }
    // 只有一级标题形式才算分段；表格与列表都归到当前段
    if (current) sections.get(current)!.push(line)
  }

  const known = ctx.characterNames.filter(name => name && name.length >= 2)
  const events: ParsedChapterNotes['events'] = []
  const facts: ParsedChapterNotes['facts'] = []
  const foreshadows: ParsedChapterNotes['foreshadows'] = []
  const characterDeltas: ParsedChapterNotes['characterDeltas'] = []
  let hooks = 0

  // ── 剧情节点 → 时间线事件 ──
  for (const line of sections.get('beats') ?? []) {
    if (!/^\s*[-*·]/.test(line)) continue
    const { tag, text: body } = cleanLine(line)
    if (body.length < 4) continue
    events.push({
      chapterNumber: ctx.chapterNumber,
      sequence: events.length + 1,
      characters: namesIn(body, known),
      location: '',
      timeFlow: 'sequential',
      summary: tag ? `[${tag}] ${body}`.slice(0, 200) : body.slice(0, 200),
      impact: '',
    })
  }

  // ── 角色动态 → 角色状态（只认角色卡里有的名字，表格里的「他」这类代称丢掉） ──
  for (const line of sections.get('characters') ?? []) {
    if (!line.includes('|')) continue
    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean)
    if (cells.length < 2) continue
    const [rawName, ...rest] = cells
    if (/^-+$/.test(rawName) || /角色|character/i.test(rawName)) continue
    const name = known.find(item => rawName.includes(item) || item.includes(rawName))
    if (!name) continue
    const state = rest.join('；').replace(/\*\*/g, '').trim()
    if (state.length < 2) continue
    characterDeltas.push({
      character: name,
      chapterNumber: ctx.chapterNumber,
      after: { recentEvents: state.slice(0, 300) },
    })
  }

  // ── 新增设定 → 事实（待确认，不冒充已确认事实） ──
  for (const line of sections.get('settings') ?? []) {
    if (!/^\s*[-*·]/.test(line)) continue
    const { text: body } = cleanLine(line)
    if (body.length < 4) continue
    facts.push({
      category: /地|城|镇|谷|山|海|村|坊|楼|矿/.test(body) ? 'location' : 'world',
      statement: body.slice(0, 200),
      introducedAt: ctx.chapterNumber,
      characters: namesIn(body, known),
      evidence: `第 ${ctx.chapterNumber} 章要点`,
      status: 'tentative',
    })
  }

  // ── 伏笔与钩子 ──
  for (const line of sections.get('hooks') ?? []) {
    if (!/^\s*[-*·]/.test(line)) continue
    const { tag, text: body } = cleanLine(line)
    if (body.length < 4) continue
    if (tag.includes('钩') || /hook/i.test(tag)) {
      hooks += 1
      events.push({
        chapterNumber: ctx.chapterNumber,
        sequence: events.length + 1,
        characters: namesIn(body, known),
        location: '',
        timeFlow: 'sequential',
        summary: `[章末钩子] ${body}`.slice(0, 200),
        impact: '留给后续章节的悬念',
      })
      continue
    }
    foreshadows.push({
      name: body.slice(0, 30),
      status: 'active',
      characters: namesIn(body, known),
      currentState: `第 ${ctx.chapterNumber} 章埋下`,
      description: body.slice(0, 200),
    })
  }

  return {
    events,
    characterDeltas,
    facts,
    foreshadows,
    stats: {
      beats: events.filter(event => event.summary.startsWith('[')).length - hooks,
      characters: characterDeltas.length,
      settings: facts.length,
      foreshadows: foreshadows.length,
      hooks,
    },
  }
}
