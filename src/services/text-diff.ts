/**
 * 文本差异内核 —— 选区逐词对比与整章三栏合并共用一套实现。
 *
 * 分两层：
 * 1. 段落层：用字符重叠率 + 动态规划对齐段落，支持 1:1 / 1:2 / 1:3 / 2:1 / 3:1
 *    （也就是一段拆成两段、两段并成一段这类情况），产出「相同段」与「变更块」。
 *    整章修稿的三栏合并按这一层把原稿与修稿对齐成块，逐块采用或保留。
 * 2. 字符层：diff-match-patch 逐字比对，产出「相同 / 新增 / 删除」片段。
 *    选区 AI 预览按这一层标出到底改了哪几个字；合并窗口也用它把变更块内部的变化标出来。
 */
import DiffMatchPatch from 'diff-match-patch'

// ============================================================
// 通用文本工具
// ============================================================

/** 去除 YAML frontmatter（章节文件开头可能带元信息） */
export function stripFrontmatter(text: string): string {
  const m = (text ?? '').match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return m ? text.slice(m[0].length) : (text ?? '')
}

/**
 * 提取段落列表（空行是分隔符）
 * 每个元素是一个段落的完整文本（可能包含多行）
 */
export function extractParagraphs(text: string): string[] {
  const paras: string[] = []
  let buf: string[] = []
  for (const line of (text ?? '').split('\n')) {
    if (line.trim() === '') {
      if (buf.length > 0) { paras.push(buf.join('\n')); buf = [] }
    } else {
      buf.push(line)
    }
  }
  if (buf.length > 0) paras.push(buf.join('\n'))
  return paras
}

/** 字符频率表 */
type CharFreq = Map<string, number>

function buildCharFreq(text: string): CharFreq {
  const freq: CharFreq = new Map()
  for (const c of text) freq.set(c, (freq.get(c) || 0) + 1)
  return freq
}

function mergeFreqs(...maps: CharFreq[]): CharFreq {
  const merged: CharFreq = new Map()
  for (const m of maps) for (const [c, n] of m) merged.set(c, (merged.get(c) || 0) + n)
  return merged
}

/** 从预计算的频率表计算相似度（避免重复创建 Map） */
function simFromFreqs(fa: CharFreq, lenA: number, fb: CharFreq, lenB: number): number {
  if (lenA === 0 && lenB === 0) return 1
  if (lenA === 0 || lenB === 0) return 0
  // 长度比 >5 直接判定不相似（快速拒绝）
  if (lenA > lenB * 5 || lenB > lenA * 5) return 0
  let common = 0
  const [smaller, larger] = fa.size <= fb.size ? [fa, fb] : [fb, fa]
  for (const [c, n] of smaller) common += Math.min(n, larger.get(c) || 0)
  return (2 * common) / (lenA + lenB)
}

/** 两段文本的字符重叠率（0-1），用于判断「润色」还是「重写」 */
export function charSimilarity(a: string, b: string): number {
  return simFromFreqs(buildCharFreq(a ?? ''), (a ?? '').length, buildCharFreq(b ?? ''), (b ?? '').length)
}

// ============================================================
// 第一层：段落对齐
// ============================================================

/** 对齐操作类型 */
const AlignOp = {
  MATCH: 0, DELETE: 1, INSERT: 2, SPLIT_1_2: 3, SPLIT_1_3: 4, MERGE_2_1: 5, MERGE_3_1: 6,
} as const
type AlignOp = typeof AlignOp[keyof typeof AlignOp]

interface AlignPair {
  origIdx: number[]
  modIdx: number[]
}

/**
 * 基于相似度的 DP 段落对齐
 * 预计算所有频率表，避免 DP 循环中重复创建
 */
function alignParagraphs(origParas: string[], modParas: string[]): AlignPair[] {
  const n = origParas.length, m = modParas.length
  const SIM_THRESH = 0.15, GAP = -0.05

  const oFreqs = origParas.map(buildCharFreq)
  const mFreqs = modParas.map(buildCharFreq)
  const oLens = origParas.map(p => p.length)
  const mLens = modParas.map(p => p.length)

  // 预计算相邻 2/3 段落的合并频率（用于 split/merge）
  const mPairFreqs: CharFreq[] = new Array(m)
  const mPairLens: number[] = new Array(m)
  for (let j = 1; j < m; j++) {
    mPairFreqs[j] = mergeFreqs(mFreqs[j - 1], mFreqs[j])
    mPairLens[j] = mLens[j - 1] + mLens[j]
  }
  const mTriFreqs: CharFreq[] = new Array(m)
  const mTriLens: number[] = new Array(m)
  for (let j = 2; j < m; j++) {
    mTriFreqs[j] = mergeFreqs(mFreqs[j - 2], mFreqs[j - 1], mFreqs[j])
    mTriLens[j] = mLens[j - 2] + mLens[j - 1] + mLens[j]
  }
  const oPairFreqs: CharFreq[] = new Array(n)
  const oPairLens: number[] = new Array(n)
  for (let i = 1; i < n; i++) {
    oPairFreqs[i] = mergeFreqs(oFreqs[i - 1], oFreqs[i])
    oPairLens[i] = oLens[i - 1] + oLens[i]
  }
  const oTriFreqs: CharFreq[] = new Array(n)
  const oTriLens: number[] = new Array(n)
  for (let i = 2; i < n; i++) {
    oTriFreqs[i] = mergeFreqs(oFreqs[i - 2], oFreqs[i - 1], oFreqs[i])
    oTriLens[i] = oLens[i - 2] + oLens[i - 1] + oLens[i]
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-1e9))
  const op: AlignOp[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(AlignOp.MATCH))
  dp[0][0] = 0
  for (let i = 1; i <= n; i++) { dp[i][0] = i * GAP; op[i][0] = AlignOp.DELETE }
  for (let j = 1; j <= m; j++) { dp[0][j] = j * GAP; op[0][j] = AlignOp.INSERT }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = -1e9, bestOp: AlignOp = AlignOp.MATCH

      // 1:1
      const s11 = simFromFreqs(oFreqs[i - 1], oLens[i - 1], mFreqs[j - 1], mLens[j - 1])
      const v11 = dp[i - 1][j - 1] + (s11 >= SIM_THRESH ? s11 : s11 - 0.5)
      if (v11 > best) { best = v11; bestOp = AlignOp.MATCH }

      // 删除 / 插入
      if (dp[i - 1][j] + GAP > best) { best = dp[i - 1][j] + GAP; bestOp = AlignOp.DELETE }
      if (dp[i][j - 1] + GAP > best) { best = dp[i][j - 1] + GAP; bestOp = AlignOp.INSERT }

      // 1:2 拆分
      if (j >= 2) {
        const s = simFromFreqs(oFreqs[i - 1], oLens[i - 1], mPairFreqs[j - 1], mPairLens[j - 1])
        if (s >= SIM_THRESH) { const v = dp[i - 1][j - 2] + s * 0.95; if (v > best) { best = v; bestOp = AlignOp.SPLIT_1_2 } }
      }
      // 1:3 拆分
      if (j >= 3) {
        const s = simFromFreqs(oFreqs[i - 1], oLens[i - 1], mTriFreqs[j - 1], mTriLens[j - 1])
        if (s >= SIM_THRESH) { const v = dp[i - 1][j - 3] + s * 0.9; if (v > best) { best = v; bestOp = AlignOp.SPLIT_1_3 } }
      }
      // 2:1 合并
      if (i >= 2) {
        const s = simFromFreqs(oPairFreqs[i - 1], oPairLens[i - 1], mFreqs[j - 1], mLens[j - 1])
        if (s >= SIM_THRESH) { const v = dp[i - 2][j - 1] + s * 0.95; if (v > best) { best = v; bestOp = AlignOp.MERGE_2_1 } }
      }
      // 3:1 合并
      if (i >= 3) {
        const s = simFromFreqs(oTriFreqs[i - 1], oTriLens[i - 1], mFreqs[j - 1], mLens[j - 1])
        if (s >= SIM_THRESH) { const v = dp[i - 3][j - 1] + s * 0.9; if (v > best) { best = v; bestOp = AlignOp.MERGE_3_1 } }
      }

      dp[i][j] = best; op[i][j] = bestOp
    }
  }

  // 回溯构建对齐结果
  const pairs: AlignPair[] = []
  let ci = n, cj = m
  while (ci > 0 || cj > 0) {
    if (ci === 0) { pairs.unshift({ origIdx: [], modIdx: [--cj] }); continue }
    if (cj === 0) { pairs.unshift({ origIdx: [--ci], modIdx: [] }); continue }
    switch (op[ci][cj]) {
      case AlignOp.MATCH:
        pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 1] }); ci--; cj--; break
      case AlignOp.DELETE:
        pairs.unshift({ origIdx: [ci - 1], modIdx: [] }); ci--; break
      case AlignOp.INSERT:
        pairs.unshift({ origIdx: [], modIdx: [cj - 1] }); cj--; break
      case AlignOp.SPLIT_1_2:
        pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 2, cj - 1] }); ci--; cj -= 2; break
      case AlignOp.SPLIT_1_3:
        pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 3, cj - 2, cj - 1] }); ci--; cj -= 3; break
      case AlignOp.MERGE_2_1:
        pairs.unshift({ origIdx: [ci - 2, ci - 1], modIdx: [cj - 1] }); ci -= 2; cj--; break
      case AlignOp.MERGE_3_1:
        pairs.unshift({ origIdx: [ci - 3, ci - 2, ci - 1], modIdx: [cj - 1] }); ci -= 3; cj--; break
    }
  }
  return pairs
}

/** 一处变更块：原文块与改后块（任一侧可能为空，即纯新增或纯删除） */
export interface BlockDiffHunk {
  index: number
  originalLines: string[]
  modifiedLines: string[]
  /** 两块文本的字符重叠率（0-1）：低到一定程度就是重写，不是润色 */
  similarity: number
}

export interface BlockDiffSegment {
  type: 'same' | 'hunk'
  lines?: string[]
  hunk?: BlockDiffHunk
}

export interface BlockDiffResult {
  segments: BlockDiffSegment[]
  hunks: BlockDiffHunk[]
}

function buildSegments(origParas: string[], modParas: string[], pairs: AlignPair[]): BlockDiffResult {
  const segments: BlockDiffSegment[] = []
  const hunks: BlockDiffHunk[] = []
  let hunkIdx = 0

  /** 多个段落 → 行数组（段落间插入空行） */
  const parasToLines = (paras: string[], indices: number[]) => {
    const lines: string[] = []
    indices.forEach((idx, i) => {
      if (i > 0) lines.push('') // 段落间空行
      lines.push(...paras[idx].split('\n'))
    })
    return lines
  }

  for (let p = 0; p < pairs.length; p++) {
    const pair = pairs[p]
    const origLines = pair.origIdx.length > 0 ? parasToLines(origParas, pair.origIdx) : []
    const modLines = pair.modIdx.length > 0 ? parasToLines(modParas, pair.modIdx) : []

    const isSame = origLines.length > 0 && modLines.length > 0 &&
      origLines.length === modLines.length &&
      origLines.every((l, i) => l === modLines[i])

    if (isSame) {
      segments.push({ type: 'same', lines: origLines })
    } else {
      const hunk: BlockDiffHunk = {
        index: hunkIdx++,
        originalLines: origLines,
        modifiedLines: modLines,
        similarity: charSimilarity(origLines.join('\n'), modLines.join('\n')),
      }
      hunks.push(hunk)
      segments.push({ type: 'hunk', hunk })
    }

    // 段落之间插入空行同步锚点（最后一组不加）
    if (p < pairs.length - 1) {
      segments.push({ type: 'same', lines: [''] })
    }
  }
  return { segments, hunks }
}

/** 段落层入口：整章修稿的三栏合并用它把原稿与修稿对齐 */
export function computeBlockDiff(original: string, modified: string): BlockDiffResult {
  const origParas = extractParagraphs(stripFrontmatter(original))
  const modParas = extractParagraphs(stripFrontmatter(modified))
  return buildSegments(origParas, modParas, alignParagraphs(origParas, modParas))
}

// ============================================================
// 第二层：字符级逐词对比
// ============================================================

export type InlineDiffKind = 'same' | 'add' | 'remove'

export interface InlineDiffSegment {
  kind: InlineDiffKind
  text: string
  /** 该片段属于第几处改动（0 起）；未改动的片段为 null */
  changeIndex: number | null
}

/** 一处改动：可以整处采用（added）或整处保持原样（removed） */
export interface InlineDiffChange {
  removed: string
  added: string
}

export interface InlineDiffResult {
  segments: InlineDiffSegment[]
  changes: InlineDiffChange[]
  /** 连续改动块的数量，即「几处不同」 */
  changeGroups: number
  addedChars: number
  removedChars: number
  identical: boolean
  /** 文本过长未做字符级比对：此时结果是粗粒度的「整段替换」 */
  tooLong: boolean
}

/** 超过这个长度就不做字符级比对，避免大段文本把界面拖住 */
const MAX_DIFF_CHARS = 20000

export function computeInlineDiff(before: string, after: string): InlineDiffResult {
  const left = before ?? ''
  const right = after ?? ''

  if (left === right) {
    return {
      segments: left ? [{ kind: 'same', text: left, changeIndex: null }] : [],
      changes: [],
      changeGroups: 0,
      addedChars: 0,
      removedChars: 0,
      identical: true,
      tooLong: false,
    }
  }

  const tooLong = left.length > MAX_DIFF_CHARS || right.length > MAX_DIFF_CHARS
  let raw: [number, string][]
  if (tooLong) {
    raw = [[-1, left], [1, right]]
  } else {
    const dmp = new DiffMatchPatch()
    // 超时后 diff-match-patch 会给出退化结果（通常是整段替换），界面仍可用
    dmp.Diff_Timeout = 1
    raw = dmp.diff_main(left, right) as [number, string][]
    dmp.diff_cleanupSemantic(raw)
  }

  const segments: InlineDiffSegment[] = []
  const changes: InlineDiffChange[] = []
  let changeGroups = 0
  let addedChars = 0
  let removedChars = 0
  let previousKind: InlineDiffKind | null = null

  for (const [op, rawText] of raw) {
    const text = rawText ?? ''
    if (!text) continue
    const kind: InlineDiffKind = op === 1 ? 'add' : op === -1 ? 'remove' : 'same'
    if (kind === 'add') addedChars += text.length
    if (kind === 'remove') removedChars += text.length
    // 一段连续的增删算「一处改动」
    if (kind !== 'same' && (previousKind === null || previousKind === 'same')) {
      changeGroups += 1
      changes.push({ removed: '', added: '' })
    }
    const changeIndex = kind === 'same' ? null : changeGroups - 1
    if (changeIndex !== null) {
      const change = changes[changeIndex]
      if (kind === 'remove') change.removed += text
      else change.added += text
    }
    previousKind = kind

    const last = segments[segments.length - 1]
    if (last && last.kind === kind) last.text += text
    else segments.push({ kind, text, changeIndex })
  }

  return { segments, changes, changeGroups, addedChars, removedChars, identical: false, tooLong }
}

/**
 * 按「保留哪几处改动」拼出最终文本：未保留的改动退回原文，其余保持不动。
 *
 * 用于「逐条」视图：作者可以只采纳其中几处润色，而不是整段替换。
 */
export function applyInlineDiffSelection(result: InlineDiffResult, rejected: ReadonlySet<number>): string {
  return result.segments
    .map(segment => {
      if (segment.changeIndex === null) return segment.text
      const keepChange = !rejected.has(segment.changeIndex)
      if (segment.kind === 'add') return keepChange ? segment.text : ''
      if (segment.kind === 'remove') return keepChange ? '' : segment.text
      return segment.text
    })
    .join('')
}

/**
 * 把逐词片段按行切开，供三栏合并按行渲染高亮。
 *
 * 必须指定是按「哪一侧」切：先剔除只属于另一侧的片段（原文侧剔除新增、修稿侧剔除删除），
 * 剩下的片段正好拼出这一侧的完整文本，切出来的行数才与它的行数一致。
 * 若不做剔除，段落合并/拆分（两侧行数不同）时会出现行错位。
 */
export function splitInlineDiffIntoLines(segments: InlineDiffSegment[], side: 'original' | 'modified'): InlineDiffSegment[][] {
  const otherSideOnly: InlineDiffKind = side === 'original' ? 'add' : 'remove'
  const lines: InlineDiffSegment[][] = [[]]
  for (const segment of segments.filter(item => item.kind !== otherSideOnly)) {
    const chunks = segment.text.split('\n')
    chunks.forEach((chunk, i) => {
      if (i > 0) lines.push([])
      if (chunk) lines[lines.length - 1].push({ ...segment, text: chunk })
    })
  }
  return lines
}
