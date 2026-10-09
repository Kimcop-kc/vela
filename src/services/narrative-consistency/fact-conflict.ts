/**
 * 事实冲突检测（保守）
 *
 * 只标记「很可能互相矛盾」的事实对：同类别、共享角色（或双方都没角色）、
 * 一方带否定/反义线索、且两边文字高度重合。宁可漏判，也不制造噪音——
 * 被标记的事实内容不会被删除，只会标成 contradicted 交给作者确认。
 */

export interface FactLike {
  category: string
  statement: string
  characters?: string[]
}

/** 否定 / 反义线索：出现这些词的一方与没有的一方可能语义相反。 */
const NEGATION_CUES = [
  '没有', '没再', '不再', '不在', '不是', '不能', '无法', '尚未', '未曾', '还没',
  '并未', '不曾', '不知道', '已死', '死亡', '失去', '拒绝', '离开',
]

/** 相似度下限：低于该值视为两条不同的事实，不再判冲突。 */
const MIN_SIMILARITY = 0.5

function bigrams(text: string): Set<string> {
  const compact = text.replace(/[\s\p{P}\p{S}]/gu, '')
  const grams = new Set<string>()
  for (let index = 0; index < compact.length - 1; index++) {
    grams.add(compact.slice(index, index + 2))
  }
  if (compact.length === 1) grams.add(compact)
  return grams
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const item of a) if (b.has(item)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function sharesCharacterOrSubject(a: FactLike, b: FactLike): boolean {
  const left = a.characters ?? []
  const right = b.characters ?? []
  if (left.length === 0 && right.length === 0) return true
  return left.some(name => right.includes(name))
}

/** 判定两条事实是否可能矛盾；返回冲突说明，或 null 表示未发现冲突。 */
export function detectFactConflict(a: FactLike, b: FactLike): { reason: string } | null {
  if (a.category !== b.category) return null
  if (a.statement === b.statement) return null
  if (!sharesCharacterOrSubject(a, b)) return null

  const aNegated = NEGATION_CUES.some(cue => a.statement.includes(cue))
  const bNegated = NEGATION_CUES.some(cue => b.statement.includes(cue))
  if (aNegated === bNegated) return null

  const similarity = jaccard(bigrams(a.statement), bigrams(b.statement))
  if (similarity < MIN_SIMILARITY) return null

  return { reason: `「${a.statement}」与「${b.statement}」可能存在矛盾` }
}
