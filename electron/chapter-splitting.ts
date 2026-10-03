/**
 * 章节拆分 — 主进程共用工具
 *
 * 「导入小说」与「拆书知识库」都用同一套拆章规则：
 * 1. 中文标准格式："第X章 标题" / "第X章：标题"
 * 2. 英文标准格式："Chapter X: Title"
 * 3. Markdown 标题格式："# 第X章 标题"
 * 如果所有正则均不命中，则将整个文件视为单章。
 */
import fs from 'node:fs'
import path from 'node:path'
import { detectFileTextEncoding, readTextFileSync } from './text-encoding'

// ===== 拆章正则池 =====

/** 中文"第X章"格式（支持中文数字和阿拉伯数字，冒号可有可无） */
export const RE_CN_CHAPTER = /^第[一二三四五六七八九十百千零\d]+章[\s：:·—-]*(.*)/

/** 英文 "Chapter X" 格式 */
export const RE_EN_CHAPTER = /^Chapter\s+(\d+)[\s：:·—-]*(.*)/i

/** Markdown 标题格式："# 第X章" 或 "## Chapter X" */
export const RE_MD_HEADING = /^#{1,3}\s+(?:第[一二三四五六七八九十百千零\d]+章|Chapter\s+\d+)[\s：:·—-]*(.*)/i

/** 所有候选正则 */
const CHAPTER_PATTERNS = [RE_CN_CHAPTER, RE_EN_CHAPTER, RE_MD_HEADING]

/** 中文数字到阿拉伯数字的映射 */
function chineseNumToArabic(str: string): number {
  const map: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
    '十': 10, '百': 100, '千': 1000,
  }

  // 纯阿拉伯数字
  const n = parseInt(str)
  if (!isNaN(n)) return n

  // 中文数字解析（支持"一百二十三"等简单组合）
  let result = 0
  let current = 0
  for (const ch of str) {
    const val = map[ch]
    if (val === undefined) continue
    if (val >= 10) {
      if (current === 0) current = 1
      current *= val
      result += current
      current = 0
    } else {
      current = val
    }
  }
  return result + current
}

/** 从章节标题行提取章节号 */
export function extractChapterNumber(line: string): number {
  // 尝试从"第X章"格式提取
  const cnMatch = line.match(/第([一二三四五六七八九十百千零\d]+)章/)
  if (cnMatch) return chineseNumToArabic(cnMatch[1])

  // 尝试从"Chapter X"格式提取
  const enMatch = line.match(/Chapter\s+(\d+)/i)
  if (enMatch) return parseInt(enMatch[1])

  return 0
}

/** 检测一行是否是章节标题 */
export function isChapterHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!CHAPTER_PATTERNS.some(re => re.test(trimmed))) return false
  const title = extractTitle(trimmed)
  // 正文里也常出现“第二章正文。此类句子；真正的章节标题通常较短且不以句末标点结束。
  return title.length <= 60 && !/[。！？!?；;]$/.test(title)
}

/** 从章节标题行提取标题文字（去掉"第X章"前缀） */
export function extractTitle(line: string): string {
  const trimmed = line.trim()
  for (const re of CHAPTER_PATTERNS) {
    const match = trimmed.match(re)
    if (match) {
      // 取最后一个捕获组（标题部分）
      const title = match[match.length - 1]?.trim()
      if (title) return title
      // 如果标题为空，返回完整行
      return trimmed
    }
  }
  return trimmed
}

export interface ParsedChapter {
  number: number
  title: string
  content: string
  wordCount: number
}

/** 将单个文件内容拆分为章节数组 */
export function splitSingleFileContent(content: string): ParsedChapter[] {
  const lines = content.split('\n')
  const chapters: ParsedChapter[] = []
  let currentChapter: { headerLine: string; lines: string[] } | null = null
  let autoNumber = 0

  for (const line of lines) {
    if (isChapterHeading(line)) {
      // 保存上一个章节
      if (currentChapter) {
        autoNumber++
        const num = extractChapterNumber(currentChapter.headerLine) || autoNumber
        const text = currentChapter.lines.join('\n').trim()
        if (text.length > 0) {
          chapters.push({
            number: num,
            title: extractTitle(currentChapter.headerLine),
            content: text,
            wordCount: text.length,
          })
        }
      }
      // 开始新章节
      currentChapter = { headerLine: line, lines: [] }
    } else if (currentChapter) {
      currentChapter.lines.push(line)
    } else {
      // 在第一个章节标题之前的内容 → 创建前言/序章
      if (!currentChapter) {
        currentChapter = { headerLine: line, lines: [] }
      }
    }
  }

  // 保存最后一个章节
  if (currentChapter) {
    autoNumber++
    const num = extractChapterNumber(currentChapter.headerLine) || autoNumber
    const text = currentChapter.lines.join('\n').trim()
    if (text.length > 0) {
      chapters.push({
        number: num,
        title: extractTitle(currentChapter.headerLine),
        content: text,
        wordCount: text.length,
      })
    }
  }

  return chapters
}

/** 如果内容中没有匹配到任何章节标题，则整文件视为一章 */
export function hasChapterHeadings(content: string): boolean {
  const lines = content.split('\n')
  return lines.some(line => isChapterHeading(line))
}

function normalizeChapters(chapters: ParsedChapter[]): ParsedChapter[] {
  const chapterMap = new Map<number, ParsedChapter>()
  for (const chapter of chapters) chapterMap.set(chapter.number, chapter)
  return Array.from(chapterMap.values())
    .sort((a, b) => a.number - b.number)
    .map((chapter, index) => ({ ...chapter, number: index + 1 }))
}

/**
 * 流式读取单个文件并拆章。
 *
 * 大文件导入时不阻塞主进程事件循环；每处理一批文本主动让出一次，
 * 窗口仍可响应，进度也可以正常刷新。
 */
export async function splitFileIntoChaptersAsync(
  filePath: string,
  onProgress?: (linesProcessed: number) => void,
): Promise<ParsedChapter[]> {
  const chapters: ParsedChapter[] = []
  let currentHeaderLine: string | null = null
  let currentLines: string[] = []
  const preHeadingLines: string[] = []
  let sawHeading = false
  let autoNumber = 0
  let linesProcessed = 0

  const appendChapter = (headerLine: string, lines: string[]) => {
    autoNumber++
    const number = extractChapterNumber(headerLine) || autoNumber
    const content = lines.join('\n').trim()
    if (content.length > 0) {
      chapters.push({
        number,
        title: extractTitle(headerLine),
        content,
        wordCount: content.length,
      })
    }
  }

  const flushCurrent = () => {
    if (currentHeaderLine === null) return
    appendChapter(currentHeaderLine, currentLines)
    currentHeaderLine = null
    currentLines = []
  }

  const encoding = detectFileTextEncoding(filePath)
  const input = fs.createReadStream(filePath)
  const decoder = new TextDecoder(encoding)
  let pending = ''

  const processLine = (line: string) => {
    if (isChapterHeading(line)) {
      if (!sawHeading) {
        sawHeading = true
        if (preHeadingLines.length > 0) {
          appendChapter(preHeadingLines[0], preHeadingLines.slice(1))
        }
      } else {
        flushCurrent()
      }
      currentHeaderLine = line
    } else if (!sawHeading) {
      preHeadingLines.push(line)
    } else {
      currentLines.push(line)
    }

    linesProcessed++
  }

  try {
    for await (const chunk of input) {
      pending += decoder.decode(chunk as Buffer, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        processLine(line.endsWith('\r') ? line.slice(0, -1) : line)
      }

      if (linesProcessed % 5000 === 0) {
        onProgress?.(linesProcessed)
        await new Promise<void>(resolve => setImmediate(resolve))
      }
    }
    pending += decoder.decode()
    if (pending.length > 0) processLine(pending.endsWith('\r') ? pending.slice(0, -1) : pending)

    if (sawHeading) {
      flushCurrent()
    } else if (preHeadingLines.length > 0) {
      const content = preHeadingLines.join('\n').trim()
      if (content.length > 0) {
        chapters.push({
          number: 1,
          title: path.basename(filePath, path.extname(filePath)),
          content,
          wordCount: content.length,
        })
      }
    }
    onProgress?.(linesProcessed)
    return normalizeChapters(chapters)
  } finally {
    input.destroy()
  }
}

/** 读取若干文件并按章号排序、重新连续编号 */
export function splitFilePathsIntoChapters(filePaths: string[]): {
  success: boolean
  chapters: ParsedChapter[]
  totalWords: number
  error?: string
} {
  try {
    const allChapters: ParsedChapter[] = []

    if (filePaths.length === 1) {
      // ===== 单文件模式 =====
      const filePath = filePaths[0]
      const content = readTextFileSync(filePath)

      if (hasChapterHeadings(content)) {
        // 文件内含章节标题 → 正则拆章
        allChapters.push(...splitSingleFileContent(content))
      } else {
        // 无章节标题 → 整文件视为一章
        allChapters.push({
          number: 1,
          title: path.basename(filePath, path.extname(filePath)),
          content: content.trim(),
          wordCount: content.trim().length,
        })
      }
    } else {
      // ===== 多文件模式 =====
      // 按文件名自然排序
      const sorted = [...filePaths].sort((a, b) => {
        const nameA = path.basename(a)
        const nameB = path.basename(b)
        return nameA.localeCompare(nameB, 'zh-CN', { numeric: true })
      })

      for (const filePath of sorted) {
        const content = readTextFileSync(filePath).trim()
        if (!content) continue

        // 尝试从文件内容中检测章节标题
        if (hasChapterHeadings(content)) {
          // 文件内含多章 → 拆分
          allChapters.push(...splitSingleFileContent(content))
        } else {
          // 文件内无章节标题 → 整文件视为一章
          const fileName = path.basename(filePath, path.extname(filePath))
          const num = extractChapterNumber(fileName) || (allChapters.length + 1)
          allChapters.push({
            number: num,
            title: fileName,
            content,
            wordCount: content.length,
          })
        }
      }
    }

    // 去重排序：按章节号排序，重复章号保留后者
    // 去重排序并重新编号（确保从1开始连续）
    const renumbered = normalizeChapters(allChapters)
    const totalWords = renumbered.reduce((sum, ch) => sum + ch.wordCount, 0)

    return { success: true, chapters: renumbered, totalWords }
  } catch (error) {
    return { success: false, chapters: [], totalWords: 0, error: String(error) }
  }
}
