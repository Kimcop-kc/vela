/**
 * 知识库文本检索的关键词处理（纯函数，便于单测）
 *
 * 背景：LanceDB 的全文检索对中文分词支持有限，知识库长期用 DataFusion 的
 * `text LIKE '%…%'` 做模糊匹配。旧实现把整段查询文本逐字拆开拼成
 * `%顶%光%裂%墨%…` 这种巨型模式，只要查询里出现一个单引号就会截断 SQL 字面量，
 * 整个检索直接抛错并静默返回空。这里把「查询文本 → 关键词 → 安全的 LIKE 谓词」
 * 收敛成纯函数，保证：
 *   · 关键词里不会出现单引号、百分号、下划线、反斜杠（前两个是 SQL/LIKE 语义字符）；
 *   · 词数与词长都有上限，不会拼出超长模式；
 *   · 多个关键词用 OR 组合（命中任意一个即可召回），而不是要求整段文本按顺序出现。
 */

export interface SearchTermOptions {
  /** 最多保留多少个关键词，默认 8 */
  maxTerms?: number
  /** 单个关键词的最大长度，超长的中文串按此长度切片，默认 6 */
  maxTermLength?: number
}

const DEFAULT_MAX_TERMS = 8
const DEFAULT_MAX_TERM_LENGTH = 6

/** LIKE 里具有特殊含义、或会破坏 SQL 字面量的字符 */
const UNSAFE_CHARS = /['"%_\\]/g
/** 拼音字母、数字、汉字视为词的一部分，其余字符（标点、空白、引号等）都是分隔符 */
const RUN_SPLITTER = /[^\p{Script=Han}\p{L}\p{N}]+/u

/**
 * 把查询文本拆成用于模糊匹配的关键词。
 *
 * 例：`第16章 废纸淘契，"顾野"说 100%` → ['第16章', '废纸淘契', '顾野说', '100']
 */
export function extractSearchTerms(queryText: string, options: SearchTermOptions = {}): string[] {
  const maxTerms = Math.max(1, options.maxTerms ?? DEFAULT_MAX_TERMS)
  const maxTermLength = Math.max(1, options.maxTermLength ?? DEFAULT_MAX_TERM_LENGTH)

  const runs = (queryText ?? '')
    .replace(UNSAFE_CHARS, ' ')
    .split(RUN_SPLITTER)
    .filter(run => run.length > 0)

  const terms: string[] = []
  const push = (term: string) => {
    if (terms.length >= maxTerms || terms.includes(term)) return
    terms.push(term)
  }

  // 优先保留多字词：单字命中率过高，几乎会把所有文本块都召回
  for (const run of runs) {
    if (run.length < 2) continue
    for (let i = 0; i < run.length; i += maxTermLength) {
      const slice = run.slice(i, i + maxTermLength)
      if (slice.length >= 2) push(slice)
    }
  }
  // 查询本身很短（例如只有「剑」一个字）时保留单字，否则会完全检索不到
  if (terms.length === 0) {
    for (const run of runs) push(run.slice(0, maxTermLength))
  }
  return terms
}

/** 把关键词拼成 DataFusion 的 LIKE 谓词（多词用 OR 连接） */
export function buildLikePredicate(column: string, terms: string[]): string {
  const predicates = terms.filter(Boolean).map(term => `${column} LIKE '%${term}%'`)
  if (predicates.length === 0) return ''
  return predicates.length === 1 ? predicates[0] : `(${predicates.join(' OR ')})`
}

/** 文本命中了几个关键词 */
export function countTermHits(text: string, terms: string[]): number {
  let hits = 0
  for (const term of terms) {
    if (term && text.includes(term)) hits += 1
  }
  return hits
}

/**
 * 按命中关键词的比例打分（0-1）。
 * 用比例而不是命中数，是为了和向量检索的 `1/(1+距离)` 落在同一个量级，
 * 界面上展示的「相关度」才有可比性。
 */
export function scoreByTermHits(text: string, terms: string[]): number {
  if (terms.length === 0) return 0
  return countTermHits(text, terms) / terms.length
}
