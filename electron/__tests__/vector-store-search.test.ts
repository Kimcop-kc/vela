/**
 * 知识库关键词检索回归测试
 *
 * 覆盖两处曾经真实出现的问题：
 * 1. 查询文本里带单引号时，LIKE 谓词被截断，整个检索抛错并静默返回空
 *    （日志：`Error optimizing sql filter: text LIKE '%…'`）；
 * 2. 带章节范围的检索用 `where()` 二次设置条件，把关键词条件顶掉了，
 *    结果返回该范围内的任意文本块。
 */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chunkText } from '../embedding'
import { addChunks, closeConnection, search, searchWithScope } from '../vector-store'

let projectPath = ''

afterEach(() => {
  if (projectPath) closeConnection(projectPath)
  if (projectPath) {
    const resolved = path.resolve(projectPath)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-vector-search-')) {
      throw new Error('Unsafe cleanup path')
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
  projectPath = ''
})

describe('vector store 关键词检索', () => {
  it('按关键词召回，且查询里的引号不会让检索整体失败', async () => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-vector-search-'))
    await addChunks(projectPath, 'doc-a', 'a.txt', chunkText('顾野把炭笔收进暗袋，他记得师父说过：纸骨认墨不认人。', 220, 30))
    await addChunks(projectPath, 'doc-b', 'b.txt', chunkText('老邵在茶棚里用剩茶净手，听见后院的动静。', 220, 30))

    const plain = await search(projectPath, '纸骨认墨不认人')
    expect(plain.length).toBeGreaterThan(0)
    expect(plain[0].text).toContain('纸骨认墨不认人')
    expect(plain[0].score).toBeGreaterThan(0)

    // 回归点：带引号、带 % 与下划线的查询同样要能召回
    const quoted = await search(projectPath, `他说："纸骨认墨不认人" 100% 纯_净`)
    expect(quoted.length).toBeGreaterThan(0)
    expect(quoted[0].text).toContain('纸骨认墨不认人')

    // 只有标点与空白的查询不该召回任何内容
    expect(await search(projectPath, '  ，。！？ "...%_  ')).toEqual([])
  })

  it('带章节范围的检索不会丢掉关键词条件', async () => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-vector-search-'))
    await addChunks(
      projectPath, 'doc-1', 'ch1.txt',
      chunkText('第一章：顾野在废土上醒来，风里全是铁锈味。', 220, 30),
      undefined, undefined, { chapterNumber: 1 },
    )
    await addChunks(
      projectPath, 'doc-9', 'ch9.txt',
      chunkText('第九章：老邵守着他的茶棚，慢慢擦着柜台。', 220, 30),
      undefined, undefined, { chapterNumber: 9 },
    )

    const inScope = await searchWithScope(projectPath, '顾野', undefined, 5, [1, 3])
    expect(inScope.length).toBeGreaterThan(0)
    expect(inScope.every(r => r.text.includes('顾野'))).toBe(true)

    // 关键词只出现在范围外：必须返回空，而不是「范围内随便几条」
    expect(await searchWithScope(projectPath, '老邵', undefined, 5, [1, 3])).toEqual([])
  })
})
