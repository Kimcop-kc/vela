import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chunkText } from '../embedding'
import { addChunks, closeConnection, getDocumentTextPage, getStats } from '../vector-store'

let projectPath = ''

afterEach(() => {
  if (projectPath) closeConnection(projectPath)
  if (projectPath) {
    const resolved = path.resolve(projectPath)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-vector-page-')) {
      throw new Error('Unsafe cleanup path')
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
  projectPath = ''
})

describe('vector store document pages', () => {
  it('reassembles chunk pages without duplicating overlap', async () => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-vector-page-'))
    const content = Array.from({ length: 30 }, (_, index) => (
      `第${index + 1}段。` + '这是一段用于验证分页读取不会重复重叠内容的测试文字。'.repeat(6)
    )).join('\n\n')
    const chunks = chunkText(content, 220, 30)
    const docId = 'page-test-doc'

    const added = await addChunks(projectPath, docId, 'page-test.txt', chunks)
    expect(added.success).toBe(true)

    let start = 0
    let restored = ''
    let done = false
    while (!done) {
      const page = await getDocumentTextPage(projectPath, docId, start, 3)
      restored += page.text
      done = page.done
      start = page.nextChunkIndex
    }

    expect(restored).toBe(content)
  })

  it('uses the embedding model dimension instead of a hardcoded 2048', async () => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-vector-page-'))
    const chunks = ['第一段测试', '第二段测试']
    const vectors = chunks.map((_, index) => Array.from({ length: 1024 }, (_, i) => ((index + i) % 7) / 10))
    const added = await addChunks(projectPath, 'dimension-test', 'dimension.txt', chunks, vectors)
    expect(added.success).toBe(true)

    const stats = await getStats(projectPath)
    expect(stats.vectorDimension).toBe(1024)
    expect(stats.hasVectors).toBe(true)
  })
})
