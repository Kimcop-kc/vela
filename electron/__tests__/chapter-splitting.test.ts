import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { splitFileIntoChaptersAsync, splitFilePathsIntoChapters } from '../chapter-splitting'

const tempFolders: string[] = []

afterEach(() => {
  for (const folder of tempFolders.splice(0)) {
    const resolved = path.resolve(folder)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-chapter-splitting-')) {
      throw new Error('Unsafe cleanup path')
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})

function writeTempNovel(content: string): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-chapter-splitting-'))
  tempFolders.push(folder)
  const filePath = path.join(folder, 'novel.txt')
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

function writeTempNovelBytes(content: Buffer): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-chapter-splitting-'))
  tempFolders.push(folder)
  const filePath = path.join(folder, 'novel-gbk.txt')
  fs.writeFileSync(filePath, content)
  return filePath
}

describe('chapter splitting', () => {
  it('streams the same chapter structure as the synchronous splitter', async () => {
    const content = [
      '第1章 开端',
      '第一章正文。',
      '',
      '第2章 暗流',
      '第二章正文。',
      '',
      '第3章 转折',
      '第三章正文。',
    ].join('\n')
    const filePath = writeTempNovel(content)

    const sync = splitFilePathsIntoChapters([filePath])
    const asyncChapters = await splitFileIntoChaptersAsync(filePath)

    expect(asyncChapters).toEqual(sync.chapters)
  })

  it('treats a file without chapter headings as one chapter', async () => {
    const filePath = writeTempNovel('这是一部没有章节标题的小说。\n\n正文继续。')
    const chapters = await splitFileIntoChaptersAsync(filePath)

    expect(chapters).toHaveLength(1)
    expect(chapters[0].content).toContain('正文继续')
  })

  it('decodes GBK/GB18030 novels before splitting chapters', async () => {
    const gbk = Buffer.from(
      'b5da31d5c220b2e2cad40ad5fdcec4c4dac8dda1a30ab5da32d5c220bcccd0f80ab5dab6fed5c2d5fdcec4a1a3',
      'hex',
    )
    const chapters = await splitFileIntoChaptersAsync(writeTempNovelBytes(gbk))

    expect(chapters).toHaveLength(2)
    expect(chapters[0]).toMatchObject({ title: '测试', content: '正文内容。' })
    expect(chapters[1]).toMatchObject({ title: '继续', content: '第二章正文。' })
  })

})
