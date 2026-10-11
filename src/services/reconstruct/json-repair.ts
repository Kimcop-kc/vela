/**
 * 被长度上限截断的 JSON —— 补括号式抢救
 *
 * 为什么不用现成的那套（segmented-generation 的 repairTruncatedJson）：
 * 它是为「顶层是一个数组、数组里是条目」设计的，遇到
 * `{"summary":"...","characters":[{...` 这种「对象里套数组」的结构时，
 * 会只保留下最后一组条目，把 summary / keyEvents 这些已经写完的字段丢掉。
 * 单章分析恰恰是一份对象，丢字段等于整章白分析。
 *
 * 这里的做法更保守也更贪心：把没写完的尾巴剪掉，再按栈补齐括号，
 * 能解析就用（已经写完的字段全部保留），解析不了就再剪一层。
 */

/** 补齐未闭合的字符串与括号；返回 null 表示文本结构无法安全闭合 */
function closeBrackets(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start < 0) return null
  const stack: string[] = []
  let inString = false
  let escaped = false
  let truncatedInsideString = false

  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      const open = stack.pop()
      if ((char === '}' && open !== '{') || (char === ']' && open !== '[')) return null
    }
  }

  let body = text
  if (inString) {
    // 停在字符串中间：把这半截字符串连同它前面的分隔符一起丢掉
    truncatedInsideString = true
    body = text.replace(/"[^"\\]*(?:\\.[^"\\]*)*$/, '')
    body = body.replace(/[,:]\s*$/, '')
  }
  if (!body.trim()) return null

  let repaired = body.replace(/[\s,]+$/, '')
  // 尾巴停在 `"key":` 或 `,` 之类的位置时，先剪掉这个残缺片段
  if (truncatedInsideString) repaired = repaired.replace(/[,{[]\s*$/, '')
  for (let index = stack.length - 1; index >= 0; index--) {
    repaired += stack[index] === '{' ? '}' : ']'
  }
  return repaired
}

/**
 * 把一段被截断的 JSON 补成可解析的形式。
 *
 * 策略：先补括号；不行就把最后一个残缺元素剪掉再补，最多剪 40 层。
 *
 * @returns 解析后的对象；救不回来时返回 null
 */
export function repairTruncatedObject<T>(text: string): T | null {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    // 继续往下修
  }

  let working = trimmed
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = closeBrackets(working)
    if (candidate && candidate !== working) {
      try {
        return JSON.parse(candidate) as T
      } catch {
        // 补完还是不合格，继续剪
      }
    }
    // 剪掉最后一个残缺元素：从末尾删到最近的分隔符之后
    const cutAt = Math.max(working.lastIndexOf(','), working.lastIndexOf('['), working.lastIndexOf('{'))
    if (cutAt <= 0) return null
    working = working.slice(0, working.lastIndexOf('[') === cutAt ? cutAt + 1 : cutAt)
    if (working.trim().length < 2) return null
  }
  return null
}
