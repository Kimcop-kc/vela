/**
 * FactExtractor —— 从定稿章节中提取结构化 CanonWriteback
 *
 * 输入：定稿章节正文 + 既有角色/世界架构
 * 输出：CanonWriteback payload（事件 / 角色 delta / 剧情线 / 事实 / 摘要）
 *
 * 策略：
 *   - 「章节要点」优先：定稿时生成的要点已经按段落分好（剧情节点/角色动态/新增设定/伏笔与钩子），
 *     直接解析它比关键词启发式准得多，且同样不额外调用模型。
 *   - 本地启发式兜底：要点缺失或解析不出东西时，才用正则/词法提取。
 *   - LLM 增强：可选；若调用方传入 llmExtractor 函数，则用它抽取更精细的
 *     角色目标/关系/目标剧情线。最终以本地提取为兜底，LLM 提取为补充。
 *
 * 设计目标：
 *   - 失败不阻塞定稿流程：任何 step 抛错都吞掉，仅记录空 payload
 *   - 与现有 chapter-notes 模板兼容：notes 文本会作为摘要补充
 */
import type {
  CanonWriteback,
  CanonWritebackResult,
  TimelineEvent,
  CharacterStateDelta,
  Fact,
} from './types'
import { canonStore } from './canon-store'
import { parseChapterNotes } from './notes-parser'

const FLASHBACK_MARKERS = ['回忆', '十年前', '二十年前', '那年', '曾经', '脑海中']

export interface ExtractParams {
  chapterNumber: number
  chapterTitle: string
  chapterContent: string
  /** 现有角色卡（用于对齐角色名） */
  characters: Array<{ name: string; currentState?: { location?: string; powerLevel?: string; physicalState?: string; mentalState?: string; keyItems?: string; recentEvents?: string } }>
  /** 章节蓝图（用于提取关键事件目标） */
  chapterBlueprint?: {
    keyEvents?: string
    characters?: string[]
    suspenseHook?: string
  }
  /** 可选：之前由 generate_chapter_notes 模板生成的 notes 文本 */
  existingNotes?: string
}

/** 检测段落是否处于闪回上下文 */
function isInFlashbackContext(text: string, position: number): boolean {
  const window = text.slice(Math.max(0, position - 100), Math.min(text.length, position + 100))
  return FLASHBACK_MARKERS.some(m => window.includes(m))
}

/**
 * 从章节正文中提取结构化事件。
 * 启发式：每段以"<角色名>+<动作动词>"开头的句子视为一个事件。
 */
function extractEvents(
  content: string,
  chapterNumber: number,
  characters: Array<{ name: string }>,
): Omit<TimelineEvent, 'id' | 'createdAt'>[] {
  const events: Omit<TimelineEvent, 'id' | 'createdAt'>[] = []
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean)
  const charNames = characters.map(c => c.name).filter(n => n && n.length >= 2)

  let sequence = 1
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = paragraphs[pi]
    // 跳过空段/标题/纯对话
    if (p.length < 10) continue

    // 检测本段是否为事件段（包含明确的"动作动词"+"对象"）
    const actionVerbs = ['冲', '斩', '击', '逃', '追', '杀', '救', '进入', '发现', '拿到', '拾起', '递给', '归还', '拒绝', '答应', '背叛', '和好', '决裂', '相遇', '分别', '对话', '争执', '决斗']
    const hasAction = actionVerbs.some(v => p.includes(v))
    if (!hasAction) continue

    // 提取涉及的角色
    const involvedChars = charNames.filter(name => p.includes(name))
    if (involvedChars.length === 0) continue

    // 提取地点（粗略："在/来到 地点"）
    const locMatch = p.match(/(在|来到|抵达|前往|进入|返回|走出)([\u4e00-\u9fa5A-Za-z0-9_]{2,10})/)
    const location = locMatch?.[2] || ''

    // 截取前 60 字作为摘要
    const summary = p.length > 60 ? p.slice(0, 60) + '...' : p

    // 检测闪回
    const isFlashback = isInFlashbackContext(content, content.indexOf(p))

    events.push({
      chapterNumber,
      sequence: sequence++,
      characters: involvedChars,
      location,
      timeFlow: isFlashback ? 'flashback' : 'sequential',
      summary,
      impact: '', // 由 LLM 抽取或留空
    })

    // 一章最多记录 10 个事件，避免 prompt 爆炸
    if (events.length >= 10) break
  }

  return events
}

/**
 * 从章节正文提取角色状态变更
 * 启发式：每个角色最后一次出现时，记录当前位置/状态
 *
 * [P0-1 修复] 新增 knowledge 提取：
 *   扫描全章正文，提取该角色"获知/得知/发现/意识到/明白"的信息，
 *   填入 after.knowledge，使知识越权检查有数据可用。
 */
function extractCharacterDeltas(
  content: string,
  chapterNumber: number,
  characters: ExtractParams['characters'],
): CharacterStateDelta[] {
  const deltas: CharacterStateDelta[] = []
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean)

  // 收集所有角色名（用于 containsWholeWord 智能边界检查）
  const allCharNames = new Set(characters.map(c => c.name).filter(n => n && n.length >= 2))

  // [P0-1] 知识提取：扫描全文，提取该角色获知的信息
  // 注意：不使用 (?![\u4e00-\u9fa5]) 边界检查，因为中文名后紧跟的总是中文字符（得/与/决等），
  // 该 lookahead 会错误地阻止所有匹配。改用角色名后紧跟知识动词的方式确保精确匹配。
  const KNOWLEDGE_VERBS = ['知道了', '知道', '了解到', '明白', '听到', '听说', '得知', '意识到', '发现', '想起', '记起', '认清', '看透', '察觉', '获悉']
  function extractKnowledge(charName: string): string[] {
    const knowledge: string[] = []
    const pattern = new RegExp(
      `${escapeRegex(charName)}[^。]{0,10}?(?:${KNOWLEDGE_VERBS.join('|')})([^。]{3,50})`,
      'g',
    )
    let m: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((m = pattern.exec(content)) !== null) {
      const info = m[1].trim()
      // 过滤掉"知道自己饿了"这类非实质信息
      if (info.length < 4) continue
      // 排除身体感受类
      if (/(饿了|渴了|累了|困了|疼|痛|冷|热)/.test(info)) continue
      knowledge.push(info.slice(0, 60))
      if (knowledge.length >= 10) break
    }
    return knowledge
  }

  for (const char of characters) {
    if (!char.name || char.name.length < 2) continue
    // 找到该角色最后一次有信息出现的段落
    let lastMeaningfulIdx = -1
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      if (!containsWholeWord(paragraphs[i], char.name, allCharNames)) continue
      if (hasStateSignal(paragraphs[i])) {
        lastMeaningfulIdx = i
        break
      }
    }

    // [P0-1] 即使没有"最后出现"段落，也要提取知识
    const newKnowledge = extractKnowledge(char.name)

    // [P0-1] 提取关系变化（扫描全文，不依赖 lastPara）
    const newRelationships: Record<string, string> = {}
    const relPattern = new RegExp(
      `${escapeRegex(char.name)}[^。]{0,15}?(与|和|跟)([\\u4e00-\\u9fa5]{2,8})[^。]{0,10}?(成为|结为|结盟|和解|反目|决裂|对立|结为|认作|拜|结拜)`,
      'g',
    )
    let relMatch: RegExpExecArray | null
    relPattern.lastIndex = 0
    while ((relMatch = relPattern.exec(content)) !== null) {
      const other = relMatch[2].trim()
      const action = relMatch[3]
      if (allCharNames.has(other) || other.length >= 2) {
        newRelationships[other] = action
      }
    }

    // [P0-1] 提取当前目标/意图（扫描全文）
    let newGoal = ''
    const goalPattern = new RegExp(`${escapeRegex(char.name)}[^。]{0,15}?(决定|打算|计划|准备|想要|誓要|立志)([^。]{4,40})`, 'g')
    let goalMatch: RegExpExecArray | null
    goalPattern.lastIndex = 0
    while ((goalMatch = goalPattern.exec(content)) !== null) {
      newGoal = goalMatch[2].trim().slice(0, 60)
      break // 取第一个匹配
    }

    // 跳过没有任何有用信息的角色
    if (lastMeaningfulIdx < 0
      && newKnowledge.length === 0
      && Object.keys(newRelationships).length === 0
      && !newGoal) continue

    const lastPara = lastMeaningfulIdx >= 0 ? paragraphs[lastMeaningfulIdx] : ''
    const before = char.currentState || {}

    // 提取新位置
    let newLocation = before.location || ''
    if (lastPara) {
      const locMatch = lastPara.match(new RegExp(`${escapeRegex(char.name)}[^。]{0,20}?(在|来到|抵达|前往|进入|返回|走出)([\u4e00-\u9fa5A-Za-z0-9_]{2,8})`))
      newLocation = locMatch?.[2] || before.location || ''
    }

    // 提取新的身体状态（受伤/死亡等）
    let newPhysical = before.physicalState || ''
    if (lastPara) {
      // 使用多字短语避免单字误判
      if (new RegExp(`${escapeRegex(char.name)}[^。]{0,15}(受伤|受了伤|负伤)`).test(lastPara)) {
        newPhysical = `${before.physicalState || '正常'};受伤`
      }
      if (new RegExp(`${escapeRegex(char.name)}[^。]{0,15}(死亡|牺牲|身亡|殒命|毙命|气绝)`).test(lastPara)) {
        newPhysical = '死亡'
      }
      if (lastPara.includes(`${char.name}昏迷`)) newPhysical = '昏迷'
      // 突破/提升境界
      const breakthroughMatch = lastPara.match(new RegExp(`${escapeRegex(char.name)}[^。]{0,20}?(突破|晋升|踏入|进阶|达到)([^。]{2,15})`))
      if (breakthroughMatch) {
        newPhysical = `${before.physicalState || '正常'};突破至${breakthroughMatch[2].trim()}`
      }
    }

    // 提取关键道具
    let newKeyItems = before.keyItems || ''
    if (lastPara) {
      const itemMatch = lastPara.match(new RegExp(`${escapeRegex(char.name)}[^。]{0,30}?(拿到|拾起|获得|捡到|收下|接过|夺过|取回)([^。]{2,15})`))
      if (itemMatch) newKeyItems = `${newKeyItems}、${itemMatch[2]}`.replace(/^[、,，]/, '')
    }

    // [P0-1] 关系和目标已在上方提前提取（在 skip 检查之前）

    deltas.push({
      character: char.name,
      chapterNumber,
      before: {
        location: before.location,
        physicalState: before.physicalState,
        keyItems: before.keyItems,
      },
      after: {
        character: char.name,
        location: newLocation,
        physicalState: newPhysical,
        keyItems: newKeyItems,
        recentEvents: lastPara ? lastPara.slice(0, 80) : '',
        knowledge: newKnowledge,
        currentGoal: newGoal,
        relationships: Object.keys(newRelationships).length > 0 ? newRelationships : undefined,
      },
    })
  }

  return deltas
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 检查 text 中是否包含完整词语 word（不被其他汉字包围）。
 * 修复："林轩" 命中 "林轩雨" 段落的问题。
 *
 * 策略：只在 word 后面跟着**已知其他角色名**的前缀时，才要求边界。
 * 例如：若 character list 里有 "林轩" 和 "林轩雨"，则 "林轩雨" 段落里 "林轩" 必须用字边界匹配。
 * 但 "林轩知道" 中 "知" 不是角色名 → 直接用 substring 匹配即可（保留原行为）。
 */
function containsWholeWord(text: string, word: string, allCharNames?: Set<string>): boolean {
  if (!word) return false
  // 基础 substring 匹配（保留原行为，应对常见 case "林轩知道" 等）
  if (!text.includes(word)) return false
  // 如果有其他角色名以 word 为前缀 → 必须用字边界
  if (allCharNames && allCharNames.size > 0) {
    for (const name of allCharNames) {
      if (name !== word && name.startsWith(word) && name.length > word.length) {
        // 需要字边界：检查每个 occurrence
        const isWordChar = (c: string) => /[一-鿿A-Za-z0-9_]/.test(c)
        let found = false
        let idx = text.indexOf(word)
        while (idx >= 0) {
          const after = idx + word.length < text.length ? text[idx + word.length] : ''
          if (!isWordChar(after)) { found = true; break }
          idx = text.indexOf(word, idx + 1)
        }
        return found
      }
    }
  }
  return true
}

/**
 * 状态信号白名单（Set 查找，O(1)）。覆盖常见动作/状态描述。
 * 修复：原 stateSignals 列表仅 17 个，缺 飞/遁/跳/望/听/思/答/喊 等大量常用动词。
 */
const STATE_SIGNALS_SET: Set<string> = new Set([
  // 移动/位置
  '走', '跑', '飞', '遁', '跳', '跃', '踏', '游', '爬', '降', '升',
  '站', '坐', '蹲', '卧', '躺', '跪',
  '出', '入', '进', '退', '逃', '追', '赶', '来', '去', '回', '返',
  '离', '到', '达', '寻', '找', '探', '巡', '来', '去',
  '前', '后', '左', '右', '旁', '侧',
  // 动作
  '看', '观', '望', '眺', '视', '盯', '扫', '窥',
  '说', '答', '喊', '叫', '吼', '喝', '唤', '诉', '叹', '吟', '唱',
  '听', '闻', '嗅',
  '想', '思', '念', '忆', '梦', '念',
  '拿', '取', '拾', '握', '持', '抓', '按', '拔', '举',
  '打', '击', '斩', '砍', '刺', '搏', '斗', '搏', '劈',
  '杀', '封', '锁', '破',
  '穿', '脱', '戴', '佩',
  '笑', '哭', '怒', '恨', '悲', '喜', '惊', '恐', '哀',
  '叹', '息', '惊', '恐',
  // 状态变化
  '生', '死', '伤', '病', '醒', '睡', '醉', '昏', '倒',
  '现', '消',
  '遇', '逢', '撞', '碰', '见',
  '告', '别', '逢', '见',
  '传', '授', '教', '学', '习', '修', '炼',
  '战', '争', '搏', '伐', '征',
  // 关键短语（双字）—— 避免被 in 操作误判；用 2 字迭代匹配
  '发现', '知道', '明白', '意识到', '了解', '得知', '听说', '想起', '记起',
  '决定', '打算', '计划', '准备', '想要', '希望',
  '抵达', '来到', '前往', '赶到', '回到', '进入', '返回', '走出',
  '出现', '消失', '离开', '到来', '等待',
  '告别', '分别', '重逢', '相遇', '冲突', '战斗',
  '击败', '战胜', '打败', '击退',
  '翻看', '拿起', '放下', '交出', '送给', '握住', '拔出', '佩戴', '装备',
  '走向', '走向', '跑去', '飞向', '逃向', '冲向', '奔向', '走向',
  '受伤', '死亡', '昏迷', '清醒', '倒下', '起身',
])

function hasStateSignal(text: string): boolean {
  if (!text) return false
  // 单字 + 双字短语扫描
  for (let i = 0; i < text.length; i++) {
    if (STATE_SIGNALS_SET.has(text[i])) return true
  }
  // 双字短语
  for (let i = 0; i < text.length - 1; i++) {
    if (STATE_SIGNALS_SET.has(text.substr(i, 2))) return true
  }
  return false
}

/**
 * 从章节正文提取关键事实条目
 *
 * [P0-9 修复] 扩展提取模式：
 *   - 原有：身份/地点/物品/关系（4类，仅匹配角色名开头的句子）
 *   - 新增：世界规则（"只有…才能…"）、能力限制（"无法/不能"）、
 *           势力关系（"属于/归…管辖"）、事件结果（"…被…摧毁/封印"）、
 *           条件规则（"必须…才能"）、禁忌（"禁止/不许/不得"）
 *   - 取消"必须角色名开头"限制：世界规则类事实常常不以角色名开头
 */
function extractFacts(content: string, chapterNumber: number, characters: string[]): Omit<Fact, 'id'>[] {
  const facts: Omit<Fact, 'id'>[] = []
  const sentences = content.split(/[。！？]/).map(s => s.trim()).filter(s => s.length >= 6 && s.length <= 100)
  const charSet = new Set(characters)

  for (const s of sentences) {
    // --- 世界规则类（不以角色名开头） ---
    // "只有X才能Y" / "必须X才能Y" / "X是Y的唯一途径"
    let m = s.match(/(只有|必须|唯有|唯有通过)([^，]{2,20}?)?(才能|方可|才能够)([^。]{2,30})/)
    if (m) {
      facts.push({ category: 'world', statement: s.slice(0, 80), introducedAt: chapterNumber, characters: [], evidence: s, status: 'tentative' })
      continue
    }
    // 禁忌/规则："禁止/不许/不得 X"
    m = s.match(/(禁止|不许|不得|严禁|不可|无法|不能)([^。]{4,40})/)
    if (m && !charSet.has(m[0].slice(0, 2))) {
      // 排除角色动作描述（"林轩不能…"），只保留世界规则
      if (!characters.some(name => m![0].includes(name))) {
        facts.push({ category: 'world', statement: s.slice(0, 80), introducedAt: chapterNumber, characters: [], evidence: s, status: 'tentative' })
        continue
      }
    }

    // --- 身份类："X 是 Y" ---
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(是|乃)([\u4e00-\u9fa5A-Za-z0-9_]{2,15})/)
    if (m && charSet.has(m[1])) {
      facts.push({ category: 'identity', statement: `${m[1]}${m[2]}${m[3]}`, introducedAt: chapterNumber, characters: [m[1]], evidence: s, status: 'tentative' })
      continue
    }

    // --- 地点类 ---
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(位于|坐落在|处于|属于|归属|归[^。]{0,5}管辖)([\u4e00-\u9fa5A-Za-z0-9_]{2,15})/)
    if (m) {
      const chars = characters.filter(name => s.includes(name))
      facts.push({ category: 'location', statement: `${m[1]}${m[2]}${m[3]}`, introducedAt: chapterNumber, characters: chars, evidence: s, status: 'tentative' })
      continue
    }

    // --- 物品类 ---
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(拥有|持有|保管|藏有)([\u4e00-\u9fa5A-Za-z0-9_]{2,12})/)
    if (m && charSet.has(m[1])) {
      facts.push({ category: 'item', statement: `${m[1]}${m[2]}${m[3]}`, introducedAt: chapterNumber, characters: [m[1]], evidence: s, status: 'tentative' })
      continue
    }
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(递给|交给|赠予|给了|拿到|拾起|获得|收下|接过|夺过|取回)(?:他|她|其)?(?:一[柄把枚颗件卷])?([\u4e00-\u9fa5A-Za-z0-9_]{2,12})/)
    if (m && charSet.has(m[1])) {
      facts.push({ category: 'item', statement: `${m[1]}${m[2]}${m[3]}`, introducedAt: chapterNumber, characters: [m[1]], evidence: s, status: 'tentative' })
      continue
    }

    // --- 关系类 ---
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(与|和|跟)([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(是|为|成为|结为|拜|认作)([\u4e00-\u9fa5]{2,8})/)
    if (m && charSet.has(m[1]) && charSet.has(m[3])) {
      facts.push({ category: 'relationship', statement: `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`, introducedAt: chapterNumber, characters: [m[1], m[3]], evidence: s, status: 'tentative' })
      continue
    }

    // --- 事件结果类："X被Y摧毁/封印/杀死/夺走" ---
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,10})被([\u4e00-\u9fa5A-Za-z0-9_]{2,10})(摧毁|封印|杀死|夺走|攻破|消灭|吞噬|炼化|击杀)/)
    if (m) {
      const chars = characters.filter(name => s.includes(name))
      facts.push({ category: 'event', statement: s.slice(0, 80), introducedAt: chapterNumber, characters: chars, evidence: s, status: 'tentative' })
      continue
    }

    // --- 能力/境界类："X突破到Y" / "X达到Y境界" ---
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(突破到?|晋升到?|踏入|达到|修炼到)([\u4e00-\u9fa5A-Za-z0-9_]{2,12}(?:境界?|期|层)?)/)
    if (m && charSet.has(m[1])) {
      facts.push({ category: 'identity', statement: `${m[1]}${m[2]}${m[3]}`, introducedAt: chapterNumber, characters: [m[1]], evidence: s, status: 'tentative' })
      continue
    }
  }

  // 去重（按 statement）
  const seen = new Set<string>()
  return facts.filter(f => {
    if (seen.has(f.statement)) return false
    seen.add(f.statement)
    return true
  })
}

/**
 * 把章节正文压缩为结构化摘要
 *
 * [P0-7 修复] 改进策略：
 *   1. 提取关键句：包含人名+动作动词的句子（剧情推进句）优先
 *   2. 按出现顺序保留首句、末句、关键剧情句
 *   3. 放宽到 500 字（原 300 字太短，中长篇一章关键信息经常超过 300 字）
 */
function extractSummary(content: string, chapterTitle: string): string {
  const sentences = content.split(/[。！？]/).map(s => s.trim()).filter(s => s.length >= 6)
  if (sentences.length === 0) return `第${chapterTitle}章定稿`

  const KEYWORDS = ['突破', '死亡', '牺牲', '重伤', '获得', '丢失', '背叛', '和解', '发现', '揭示', '秘密', '真相', '离开', '抵达', '相遇', '决战', '失败', '成功', '转变', '觉醒']
  const scored = sentences.map((s, idx) => {
    let score = 0
    // 首句和末句加分
    if (idx === 0) score += 3
    if (idx === sentences.length - 1) score += 3
    // 包含关键剧情词加分
    for (const kw of KEYWORDS) {
      if (s.includes(kw)) score += 2
    }
    // 较长句子加分（信息量更大）
    if (s.length >= 20) score += 1
    return { sentence: s, idx, score }
  })

  // 取 score 最高的 5 句，按原文顺序排列
  const top = scored.sort((a, b) => b.score - a.score).slice(0, 5).sort((a, b) => a.idx - b.idx)
  const parts = top.map(item => item.sentence + '。')

  return parts.join(' ').slice(0, 500)
}

/**
 * 主入口：从定稿章节构造 CanonWriteback
 */
export function extractCanonWriteback(params: ExtractParams): CanonWriteback {
  const { chapterNumber, chapterTitle, chapterContent, characters } = params

  // 清理标题（去掉 "第N章 " 前缀）
  const cleanTitle = chapterTitle.replace(/^第\s*[\d一二三四五六七八九十百千万零〇]+\s*章\s*/, '').trim()

  // 优先用「章节要点」里已经分好段的结构（模型产物，质量高、零额外调用）；
  // 要点缺失或解析不出东西时，才退回关键词启发式。
  const fromNotes = params.existingNotes?.trim()
    ? parseChapterNotes(params.existingNotes, {
        chapterNumber,
        chapterTitle: cleanTitle,
        characterNames: characters.map(c => c.name).filter(Boolean),
      })
    : null
  const notesUsable = !!fromNotes && (fromNotes.events.length > 0 || fromNotes.facts.length > 0 || fromNotes.characterDeltas.length > 0)

  const events = notesUsable && fromNotes!.events.length > 0
    ? fromNotes!.events
    : extractEvents(chapterContent, chapterNumber, characters)
  // 正文始终提取；要点只覆盖非空字段，不能抹掉正文里的知识、关系或其他角色。
  const deltaMap = new Map<string, CharacterStateDelta>()
  for (const delta of [
    ...extractCharacterDeltas(chapterContent, chapterNumber, characters),
    ...(notesUsable ? fromNotes!.characterDeltas : []),
  ]) {
    const existing = deltaMap.get(delta.character)
    const after = { ...existing?.after }
    for (const [key, value] of Object.entries(delta.after)) {
      if (key === 'knowledge' || key === 'relationships') continue
      if (value !== undefined && value !== null && (typeof value !== 'string' || value.trim())) {
        Object.assign(after, { [key]: value })
      }
    }
    const knowledge = [...new Set([...(existing?.after.knowledge ?? []), ...(delta.after.knowledge ?? [])])]
    if (knowledge.length > 0) after.knowledge = knowledge
    const relationships = {
      ...existing?.after.relationships,
      ...Object.fromEntries(Object.entries(delta.after.relationships ?? {}).filter(([, value]) => value?.trim())),
    }
    if (Object.keys(relationships).length > 0) after.relationships = relationships
    deltaMap.set(delta.character, {
      ...delta,
      before: existing?.before ?? delta.before,
      after,
    })
  }
  const characterDeltas = [...deltaMap.values()]
  const noteFacts = notesUsable ? fromNotes!.facts : []
  const heuristicFacts = extractFacts(chapterContent, chapterNumber, characters.map(c => c.name))
  // 合并两边的候选事实并按陈述去重；要点里的排在前面（更具体）
  const seenStatements = new Set<string>()
  const facts = [...noteFacts, ...heuristicFacts].filter(fact => {
    const statement = String(fact.statement ?? '').trim()
    if (!statement || seenStatements.has(statement)) return false
    seenStatements.add(statement)
    return true
  })

  // 摘要：本地提取 + existing notes（若有）
  let summary = extractSummary(chapterContent, cleanTitle)
  if (params.existingNotes?.trim()) {
    summary = `${summary}\n\n【结构化要点】\n${params.existingNotes.trim()}`
  }

  // 剧情线变更：要点里的 [埋] 直接登记为伏笔，比只认关键词准得多
  const plotLineChanges: CanonWriteback['plotLineChanges'] = {}
  if (notesUsable && fromNotes!.foreshadows.length > 0) {
    plotLineChanges.added = fromNotes!.foreshadows.map(item => ({
      ...item,
      kind: 'foreshadow' as const,
      startedAt: chapterNumber,
      lastAdvancedAt: chapterNumber,
    }))
  }
  if (params.chapterBlueprint?.keyEvents?.trim()) {
    const kev = params.chapterBlueprint.keyEvents.trim()
    // 只在出现"开启"、"开启"、"建立"、"启动"等关键词时新建
    if (/开启|启动|建立|开启|启动|开启|开端/.test(kev)) {
      plotLineChanges.added = [...(plotLineChanges.added ?? []), {
        name: kev.slice(0, 30),
        status: 'active',
        startedAt: chapterNumber,
        lastAdvancedAt: chapterNumber,
        characters: params.chapterBlueprint.characters || [],
        currentState: '本章开启',
        description: kev,
      }]
    }
  }

  return {
    chapterNumber,
    chapterTitle: cleanTitle,
    chapterSummary: summary,
    chapterContent: params.chapterContent,
    newEvents: events,
    characterDeltas,
    plotLineChanges,
    newFacts: facts,
  }
}

/**
 * 便捷方法：执行提取 + 写回（调用 CanonStore）
 *
 * [P0-3 修复] 提取失败不再静默：
 *   - 提取结果为全空（events=0, deltas=0, facts=0）时，在 errors 中标注"提取为空"
 *   - 调用方可据此判断"是提取失败还是真的没有新信息"
 *   - 任何异常仍不抛出（不阻塞定稿流程），但 ok=false 且 errors 有具体原因
 */
export async function extractAndWriteback(params: ExtractParams): Promise<CanonWritebackResult> {
  try {
    const payload = extractCanonWriteback(params)
    // [P0-3] 检测空提取：如果所有结构化提取项都为空，标记为可疑
    // 注意：chapterSummary 不参与判断，因为 extractSummary 即使输入为空也会生成兜底摘要
    const isEmpty = payload.newEvents.length === 0
      && payload.characterDeltas.length === 0
      && payload.newFacts.length === 0
    if (isEmpty) {
      console.warn('[FactExtractor] 提取结果为全空 — 可能是提取失败而非"无新信息"。章节:', params.chapterNumber)
    }
    const result = await canonStore.writeback(payload)
    // [P0-3] 空提取时补充警告（不论写回本身是否成功，都要标记空提取）
    if (isEmpty) {
      if (result.ok) {
        result.ok = false
      }
      // 避免重复添加
      if (!result.errors.some(e => e.includes('提取结果为空'))) {
        result.errors.push('提取结果为空（events=0, deltas=0, facts=0）— 可能是提取失败被静默忽略')
      }
    }
    return result
  } catch (err) {
    return { ok: false, errors: [String(err)], conflicts: [], impactCandidates: [] }
  }
}
