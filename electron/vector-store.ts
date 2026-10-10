/**
 * Vela 向量数据库封装 — 基于 LanceDB
 *
 * 提供本地嵌入式向量数据库能力，替代旧的 vectors.json 方案。
 * 支持两种检索模式：
 * - 关键词检索（DataFusion LIKE 模糊匹配，零配置默认可用；Tantivy 对中文分词支持有限）
 * - 混合检索（向量近邻优先，失败时回落到关键词检索，需要 Embedding 模型）
 *
 * 存储位置：{projectPath}/.vela/lancedb/
 */
import * as lancedb from '@lancedb/lancedb'
import { Field, FixedSizeList as ArrowFixedSizeList, Float32, Int32, Utf8, Schema as ArrowSchema } from 'apache-arrow'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { joinChunkTexts, stripChunkOverlap } from './embedding'
import { buildLikePredicate, extractSearchTerms, scoreByTermHits } from '../src/shared/search-terms'

// ===== 类型定义 =====

/** 写入 LanceDB 的文本块记录 */
export interface ChunkRecord {
  [key: string]: unknown
  id: string
  docId: string
  fileName: string
  /** 章节号（可选，用于范围检索） */
  chapterNumber?: number
  /** 章节标题（可选，用于展示） */
  chapterTitle?: string
  text: string
  vector?: number[]
  chunkIndex: number
  totalChunks: number
  importedAt: string
}

/** 文档元信息（聚合查询结果） */
export interface DocumentInfo {
  [key: string]: unknown
  id: string
  fileName: string
  importedAt: string
  chunkCount: number
  filePath: string
}

/** 检索结果 */
export interface SearchResult {
  text: string
  score: number
  fileName: string
}

export interface DocumentTextPage {
  text: string
  fileName: string
  chunkStart: number
  nextChunkIndex: number
  done: boolean
  totalChunks: number
}

/** 知识库统计 */
export interface KBStats {
  documentCount: number
  totalChunks: number
  vectorDimension: number
  hasVectors: boolean
}

export interface LanceRepairResult {
  repaired: boolean
  quarantined: string[]
}

// ===== 常量 =====

const TABLE_NAME = 'chunks'
const DOCS_TABLE_NAME = 'documents'

function vectorLength(value: unknown): number | null {
  if (!value) return null
  if (Array.isArray(value)) return value.length || null
  const candidate = value as { length?: number; toArray?: () => unknown[] }
  if (typeof candidate.toArray === 'function') return candidate.toArray().length || null
  return typeof candidate.length === 'number' && candidate.length > 0 ? candidate.length : null
}

function vectorDimensionFromSchema(schema: ArrowSchema): number | null {
  const field = schema.fields.find(item => item.name === 'vector')
  const listSize = (field?.type as { listSize?: number } | undefined)?.listSize
  return listSize && listSize > 0 ? listSize : null
}

function createChunkSchema(vectorDimension: number): ArrowSchema {
  return new ArrowSchema([
    new Field('id', new Utf8()),
    new Field('docId', new Utf8()),
    new Field('fileName', new Utf8()),
    new Field('chapterNumber', new Int32(), true),
    new Field('chapterTitle', new Utf8(), true),
    new Field('text', new Utf8()),
    new Field('vector', new ArrowFixedSizeList(vectorDimension, new Field('item', new Float32())), true),
    new Field('chunkIndex', new Int32()),
    new Field('totalChunks', new Int32()),
    new Field('importedAt', new Utf8()),
  ])
}

// ===== 连接池（按项目路径缓存） =====

const connectionPool = new Map<string, lancedb.Connection>()

/** 获取 LanceDB 连接（惰性创建） */
export async function getConnection(projectPath: string): Promise<lancedb.Connection> {
  const dbPath = path.join(projectPath, '.vela', 'lancedb')
  
  const cached = connectionPool.get(dbPath)
  if (cached) return cached

  // 确保目录存在
  fs.mkdirSync(dbPath, { recursive: true })

  const db = await lancedb.connect(dbPath)
  connectionPool.set(dbPath, db)
  return db
}

/** 关闭指定项目的连接 */
export function closeConnection(projectPath: string): void {
  const dbPath = path.join(projectPath, '.vela', 'lancedb')
  connectionPool.get(dbPath)?.close()
  connectionPool.delete(dbPath)
}

function allFileNames(root: string): Set<string> {
  const names = new Set<string>()
  const visit = (directory: string) => {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else names.add(entry.name)
    }
  }
  visit(root)
  return names
}

/**
 * LanceDB can leave an older manifest pointing at a data file that was removed
 * during an interrupted rebuild. Quarantine only those broken manifests so the
 * newest readable table version remains available.
 */
export function repairLanceStorage(projectPath: string): LanceRepairResult {
  const lancedbPath = path.join(projectPath, '.vela', 'lancedb')
  const quarantined: string[] = []
  closeConnection(projectPath)

  for (const tableName of [TABLE_NAME, DOCS_TABLE_NAME]) {
    const tableDir = path.join(lancedbPath, `${tableName}.lance`)
    const versionsDir = path.join(tableDir, '_versions')
    if (!fs.existsSync(versionsDir)) continue
    const existingFiles = allFileNames(tableDir)

    for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.manifest')) continue
      const manifestPath = path.join(versionsDir, entry.name)
      const raw = fs.readFileSync(manifestPath).toString('utf8')
      const references = raw.match(/\b[0-9a-f]{20,}\.lance\b/gi) ?? []
      const broken = references.some(reference => !existingFiles.has(reference))
      if (!broken) continue

      const backupName = `${entry.name}.corrupt-${Date.now()}`
      fs.renameSync(manifestPath, path.join(versionsDir, backupName))
      quarantined.push(path.join(versionsDir, backupName))
      console.warn(`[Vela VectorStore] 已隔离损坏的 LanceDB 版本清单: ${entry.name}`)
    }
  }

  return { repaired: quarantined.length > 0, quarantined }
}

export function isLanceCorruptionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Failed to get next batch from stream') ||
    /Not found: .+\.lance[\\/]data[\\/].+\.lance/i.test(message)
}


// ===== 核心操作 =====

/**
 * 写入文档块到 LanceDB
 * 支持带向量（混合模式）和不带向量（FTS-only 模式）
 */
export async function addChunks(
  projectPath: string,
  docId: string,
  fileName: string,
  chunks: string[],
  vectors?: number[][],
  filePath?: string,
  metadata?: { chapterNumber?: number; chapterTitle?: string },
): Promise<{ success: boolean; chunkCount: number; error?: string }> {
  try {
    const db = await getConnection(projectPath)
    const now = new Date().toISOString()

    // 构建记录
    const records: ChunkRecord[] = chunks.map((text, i) => {
      const record: ChunkRecord = {
        id: randomUUID(),
        docId,
        fileName,
        text,
        chunkIndex: i,
        totalChunks: chunks.length,
        importedAt: now,
        chapterNumber: metadata?.chapterNumber,
        chapterTitle: metadata?.chapterTitle,
      }
      // 如果有向量，附加到记录上
      if (vectors && vectors[i] && vectors[i].length > 0) {
        record.vector = vectors[i]
      }
      return record
    })

    // 写入 chunks 表
    const tableNames = await db.tableNames()
    const incomingDimension = vectors?.map(vectorLength).find((length): length is number => length !== null) ?? null
    let existingTable: Awaited<ReturnType<typeof db.openTable>> | null = null
    let existingSchema: ArrowSchema | null = null
    let existingDimension: number | null = null

    if (tableNames.includes(TABLE_NAME)) {
      existingTable = await db.openTable(TABLE_NAME)
      existingSchema = await existingTable.schema()
      existingDimension = vectorDimensionFromSchema(existingSchema)
    }

    const vectorDimension = incomingDimension ?? existingDimension ?? 1
    const targetSchema = createChunkSchema(vectorDimension)

    if (tableNames.includes(TABLE_NAME)) {
      const table = existingTable!
      existingSchema ??= await table.schema()
      const existingFieldNames = existingSchema.fields.map(f => f.name)
      // 检查旧表 schema 是否包含所有必要字段
      const requiredFields = ['id', 'docId', 'fileName', 'text', 'chunkIndex', 'totalChunks', 'importedAt', 'chapterNumber', 'chapterTitle', 'vector']
      const hasAllFields = requiredFields.every(f => existingFieldNames.includes(f))
      const dimensionMatches = incomingDimension === null || existingDimension === vectorDimension

      if (hasAllFields && dimensionMatches) {
        await table.add(records)
      } else {
        // schema 不匹配（旧表缺少字段），需要重建表
        // 先把 Arrow Vector 对象转成纯 number[]，避免 isValid 等元数据字段干扰 schema 校验
        const allRows = await table.query().toArray()
        const cleanRows = allRows.map((r: Record<string, unknown>) => {
          const cleaned: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(r)) {
            if (k === 'vector' && v) {
              // Arrow Vector → 纯数组
              const vec = v as { toArray?: () => number[] }
              const array = vec.toArray ? vec.toArray() : v
              if (Array.isArray(array) && array.length === vectorDimension) cleaned[k] = array
            } else {
              cleaned[k] = v
            }
          }
          return cleaned
        })
        await db.dropTable(TABLE_NAME)
        await db.createTable(TABLE_NAME, [...cleanRows, ...records], { schema: targetSchema })
      }
    } else {
      // 首次创建时使用显式 Schema，确保 vector 列正确识别为 FixedSizeList
      await db.createTable(TABLE_NAME, records, { schema: targetSchema })
    }

    // 写入/更新 documents 表
    const docInfo: DocumentInfo = {
      id: docId,
      fileName,
      importedAt: now,
      chunkCount: chunks.length,
      filePath: filePath || '',
    }

    if (tableNames.includes(DOCS_TABLE_NAME)) {
      const docsTable = await db.openTable(DOCS_TABLE_NAME)
      // 先删除同名文档（幂等性），再添加新的
      try {
        await docsTable.delete(`fileName = '${fileName.replace(/'/g, "''")}'`)
      } catch { /* 表可能为空或无匹配 */ }
      await docsTable.add([docInfo])
    } else {
      await db.createTable(DOCS_TABLE_NAME, [docInfo])
    }

    // 尝试创建 FTS 索引（如果尚不存在）
    try {
      const chunksTable = await db.openTable(TABLE_NAME)
      await chunksTable.createIndex('text', {
        config: lancedb.Index.fts(),
      })
    } catch {
      // FTS 索引可能已存在，忽略错误
    }

    return { success: true, chunkCount: chunks.length }
  } catch (error) {
    console.error('[Vela VectorStore] 写入失败:', error)
    return { success: false, chunkCount: 0, error: String(error) }
  }
}

/**
 * 删除文档及其所有块
 */
export async function removeDocument(
  projectPath: string,
  docId: string,
): Promise<boolean> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()

    if (tableNames.includes(TABLE_NAME)) {
      const table = await db.openTable(TABLE_NAME)
      await table.delete(`docId = '${docId}'`)
    }

    if (tableNames.includes(DOCS_TABLE_NAME)) {
      const docsTable = await db.openTable(DOCS_TABLE_NAME)
      await docsTable.delete(`id = '${docId}'`)
    }

    return true
  } catch (error) {
    console.error('[Vela VectorStore] 删除失败:', error)
    return false
  }
}

/**
 * 按文档 id 读取全部文本块（按 chunkIndex 升序）
 *
 * 拆书场景下每一章就是一条文档，拿 docId 即可取回该章完整正文；
 * 普通导入的文档同样适用（此时没有 chapterNumber）。
 */
export async function getChunksByDoc(
  projectPath: string,
  docId: string,
): Promise<ChunkRecord[]> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return []

    const table = await db.openTable(TABLE_NAME)
    const escaped = String(docId).replace(/'/g, "''")
    const rows = await table.query().filter(`docId = '${escaped}'`).toArray()
    return (rows as unknown as ChunkRecord[]).sort(
      (a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0),
    )
  } catch (error) {
    console.error('[Vela VectorStore] 按文档读取文本块失败:', error)
    return []
  }
}

/**
 * 按块范围读取文档正文，用于大章节分页预览。
 *
 * 查询只取正文需要的列，并额外读取前一块用于去掉分块 overlap；
 * 不会把整章文本和向量一次加载到主进程。
 */
export async function getDocumentTextPage(
  projectPath: string,
  docId: string,
  chunkStart: number,
  maxChunks: number,
): Promise<DocumentTextPage> {
  const db = await getConnection(projectPath)
  const tableNames = await db.tableNames()
  if (!tableNames.includes(TABLE_NAME)) {
    return { text: '', fileName: '', chunkStart, nextChunkIndex: chunkStart, done: true, totalChunks: 0 }
  }

  const safeStart = Math.max(0, Math.floor(chunkStart))
  const safeMax = Math.max(1, Math.min(200, Math.floor(maxChunks)))
  const queryStart = Math.max(0, safeStart - 1)
  const queryEnd = safeStart + safeMax
  const escaped = String(docId).replace(/'/g, "''")
  const table = await db.openTable(TABLE_NAME)
  const rows = await table.query()
    .where(`docId = '${escaped}' AND chunkIndex >= ${queryStart} AND chunkIndex < ${queryEnd}`)
    .select(['text', 'chunkIndex', 'totalChunks', 'fileName'])
    .limit(safeMax + 1)
    .toArray() as Array<{
      text: string
      chunkIndex: number
      totalChunks: number
      fileName: string
    }>

  rows.sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0))
  const previous = rows.find(row => row.chunkIndex === safeStart - 1)
  const pageRows = rows.filter(row => row.chunkIndex >= safeStart)

  if (pageRows.length === 0) {
    return {
      text: '',
      fileName: previous?.fileName ?? '',
      chunkStart: safeStart,
      nextChunkIndex: safeStart,
      done: true,
      totalChunks: previous?.totalChunks ?? 0,
    }
  }

  let text = joinChunkTexts(pageRows.map(row => row.text))
  if (previous) text = stripChunkOverlap(previous.text, text)

  const lastChunkIndex = pageRows[pageRows.length - 1].chunkIndex
  const totalChunks = pageRows[0].totalChunks ?? 0
  return {
    text,
    fileName: pageRows[0].fileName ?? '',
    chunkStart: safeStart,
    nextChunkIndex: lastChunkIndex + 1,
    done: totalChunks <= 0 || lastChunkIndex + 1 >= totalChunks,
    totalChunks,
  }
}

/**
 * 统一检索入口 — 自动选择 FTS / 混合模式
 *
 * @param queryText 搜索关键词/语句
 * @param queryVector 查询向量（可选，有值时启用混合检索）
 * @param topK 返回前 K 个结果
 */
export async function search(
  projectPath: string,
  queryText: string,
  queryVector?: number[],
  topK: number = 5,
): Promise<SearchResult[]> {
  return searchWithScope(projectPath, queryText, queryVector, topK)
}

/**
 * 支持章节范围限定的检索入口
 *
 * @param queryText 搜索关键词/语句
 * @param queryVector 查询向量（可选，有值时启用混合检索）
 * @param topK 返回前 K 个结果
 * @param chapterScope 可选，限定检索的章节范围 [fromChapter, toChapter]
 */
export async function searchWithScope(
  projectPath: string,
  queryText: string,
  queryVector?: number[],
  topK: number = 5,
  chapterScope?: [number, number],
): Promise<SearchResult[]> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return []

    const table = await db.openTable(TABLE_NAME)

    // 构建范围过滤条件
    let scopeFilter: string | undefined
    if (chapterScope) {
      const [from, to] = chapterScope
      scopeFilter = `chapterNumber >= ${from} AND chapterNumber <= ${to}`
    }

    // 如果有查询向量，先尝试混合检索
    if (queryVector && queryVector.length > 0) {
      try {
        let query = table.search(queryVector).limit(topK)
        if (scopeFilter) {
          query = query.where(scopeFilter)
        }
        const results = await query.toArray()

        if (results.length > 0) {
          return results.map((r: { text: string; _distance?: number; fileName: string }) => ({
            text: r.text,
            score: r._distance != null ? 1 / (1 + r._distance) : 0.5,
            fileName: r.fileName,
          }))
        }
      } catch {
        // 向量检索失败，降级到 FTS
      }
    }

    // 文本检索：Tantivy 对中文分词支持有限，改用 DataFusion LIKE 模糊匹配。
    // 关键词经 shared/search-terms 安全化与限长处理，再和章节范围拼成「一个」谓词——
    // where() 是覆盖式的，分两次调用会让后一个条件顶掉前一个（曾导致带章节范围的检索
    // 丢掉关键词条件，返回该范围内任意文本块）。
    const terms = extractSearchTerms(queryText)
    if (terms.length === 0) return []

    const textFilter = buildLikePredicate('text', terms)
    const combinedFilter = scopeFilter ? `(${textFilter}) AND (${scopeFilter})` : textFilter
    // 多取一些候选再按命中关键词数排序，避免 limit 截断掉更相关的那条
    const scanLimit = Math.min(Math.max(topK * 5, topK), 50)

    try {
      const rows = await table.query().where(combinedFilter).limit(scanLimit).toArray()
      return rankRowsByTerms(rows, terms, topK)
    } catch (e) {
      // 过滤条件本身出问题（老版本 LanceDB / 未预料到的字符）时退化为本地匹配，
      // 保证检索不会因为一条 SQL 谓词而整体拿不到结果。
      console.warn('[Vela VectorStore] 文本检索过滤失败，退化为本地匹配:', e)
      try {
        const rows = await table.query().limit(LOCAL_FALLBACK_SCAN_LIMIT).toArray()
        const scoped = chapterScope
          ? rows.filter((r: { chapterNumber?: number }) =>
            typeof r.chapterNumber === 'number'
            && r.chapterNumber >= chapterScope[0]
            && r.chapterNumber <= chapterScope[1])
          : rows
        return rankRowsByTerms(scoped, terms, topK)
      } catch (e2) {
        console.warn('[Vela VectorStore] 纯文本检索失败:', e2)
        return []
      }
    }
  } catch (error) {
    console.error('[Vela VectorStore] 检索失败:', error)
    return []
  }
}

/** 过滤条件失效时的本地兜底扫描上限（超过这个规模的库仍走 LIKE，不回退全表） */
const LOCAL_FALLBACK_SCAN_LIMIT = 2000

/** 按命中关键词数排序，取前 topK 条 */
function rankRowsByTerms(
  rows: Array<{ text?: unknown; fileName?: unknown }>,
  terms: string[],
  topK: number,
): SearchResult[] {
  const scored = rows
    .map(row => {
      const text = String(row.text ?? '')
      return { text, fileName: String(row.fileName ?? ''), score: scoreByTermHits(text, terms) }
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, topK))
}

/**
 * 列出所有已导入文档
 */
export async function listDocuments(
  projectPath: string,
): Promise<DocumentInfo[]> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(DOCS_TABLE_NAME)) return []

    const docsTable = await db.openTable(DOCS_TABLE_NAME)
    const rows = await docsTable.query().toArray()
    return rows.map((r: { id: string; fileName: string; importedAt: string; chunkCount: number; filePath?: string }) => ({
      id: r.id,
      fileName: r.fileName,
      importedAt: r.importedAt,
      chunkCount: r.chunkCount,
      filePath: r.filePath || '',
    }))
  } catch {
    return []
  }
}

/**
 * 获取知识库统计信息
 */
export async function getStats(projectPath: string): Promise<KBStats> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()

    if (!tableNames.includes(TABLE_NAME)) {
      return { documentCount: 0, totalChunks: 0, vectorDimension: 0, hasVectors: false }
    }

    const docs = tableNames.includes(DOCS_TABLE_NAME)
      ? await (await db.openTable(DOCS_TABLE_NAME)).countRows()
      : 0

    const table = await db.openTable(TABLE_NAME)
    const totalChunks = await table.countRows()

    // 检测是否有向量列（通过 schema 而非运行时值判断）
    let hasVectors = false
    let vectorDimension = 0
    try {
      const schema = await table.schema()
      const vectorField = schema.fields.find(f => f.name === 'vector')
      if (vectorField) {
        hasVectors = true
        vectorDimension = vectorDimensionFromSchema(schema) ?? 0
      }
    } catch { /* 忽略 */ }

    return {
      documentCount: docs,
      totalChunks,
      vectorDimension,
      hasVectors,
    }
  } catch {
    return { documentCount: 0, totalChunks: 0, vectorDimension: 0, hasVectors: false }
  }
}

/**
 * 获取没有向量的文本块数量（用于回填检测）
 */
export async function getChunksWithoutVectors(
  projectPath: string,
): Promise<{ count: number }> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return { count: 0 }

    const table = await db.openTable(TABLE_NAME)
    const schema = await table.schema()
    const hasVectorCol = schema.fields.some(f => f.name === 'vector')

    if (!hasVectorCol) {
      const total = await table.countRows()
      return { count: total }
    }

    // 有 vector 列的情况下，统计 vector 为 null 的记录
    const all = await table.query().select(['id', 'vector']).toArray()
    const missing = all.filter((r: { id: string; vector?: unknown }) => {
      if (!r.vector) return true
      const vec = r.vector as { length?: number; toArray?: () => unknown[] }
      if (typeof vec.toArray === 'function') {
        return vec.toArray().length === 0
      }
      return (vec.length ?? -1) === 0
    })
    return { count: missing.length }
  } catch (e) {
    console.error('[Vela KB] getChunksWithoutVectors error:', e)
    return { count: 0 }
  }
}

/**
 * 为缺少向量的块批量回填向量
 * 返回无向量的块列表（id + text），供调用方批量生成向量后更新
 */
export async function getChunksForBackfill(
  projectPath: string,
  batchSize: number = 50,
): Promise<Array<{ id: string; text: string }>> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return []

    const table = await db.openTable(TABLE_NAME)
    const schema = await table.schema()
    const hasVectorCol = schema.fields.some(f => f.name === 'vector')

    let missing = []

    if (!hasVectorCol) {
      const all = await table.query().select(['id', 'text']).toArray()
      missing = all // 全部没有向量
    } else {
      const all = await table.query().select(['id', 'text', 'vector']).toArray()
      missing = all.filter((r: { id: string; text: string; vector?: unknown }) => {
        if (!r.vector) return true
        const vec = r.vector as { length?: number; toArray?: () => number[] }
        const len = vec.toArray ? vec.toArray().length : (vec.length ?? 0)
        return len === 0
      })
    }
    
    // 只返回一批
    return missing.slice(0, batchSize).map((r: { id: string; text: string; vector?: number[] }) => ({
      id: r.id,
      text: r.text,
    }))
  } catch {
    return []
  }
}

/**
 * 更新指定块的向量（回填用）
 */
export async function updateChunkVectors(
  projectPath: string,
  updates: Array<{ id: string; vector: number[] }>,
): Promise<{ success: boolean; count: number }> {
  try {
    const db = await getConnection(projectPath)
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return { success: false, count: 0 }

    const table = await db.openTable(TABLE_NAME)
    const schema = await table.schema()
    const hasVectorCol = schema.fields.some(f => f.name === 'vector')
    const incomingDimension = updates.map(update => update.vector.length).find(length => length > 0) ?? null
    const existingDimension = vectorDimensionFromSchema(schema)
    const needsRebuild = !hasVectorCol || (incomingDimension !== null && existingDimension !== incomingDimension)

    if (!needsRebuild) {
      // 如果已有 vector 列，直接 update
      for (const update of updates) {
        try {
          await table.update({
            where: `id = '${update.id}'`,
            values: { vector: update.vector },
          })
        } catch (e) {
          console.warn(`[Vela VectorStore] 更新块 ${update.id} 向量失败:`, e)
        }
      }
      return { success: true, count: updates.length }
    } else {
      // 没有 vector 列，必须覆写全表以增加列
      const allRecords = await table.query().toArray()
      const vectorDimension = incomingDimension ?? existingDimension ?? 1
      const newData = allRecords.map((r: { [key: string]: unknown; id: string }) => {
        const up = updates.find(u => u.id === r.id)
        if (up) return { ...r, vector: up.vector }
        if (vectorLength(r.vector) === vectorDimension) return r
        const next = { ...r }
        delete next.vector
        return next
      })

      // 使用显式 Schema 确保 vector 列正确持久化
      const schema = createChunkSchema(vectorDimension)

      await db.dropTable(TABLE_NAME)
      await db.createTable(TABLE_NAME, newData, { schema })

      // 重建 FTS 索引
      try {
        const newTable = await db.openTable(TABLE_NAME)
        await newTable.createIndex('text', { config: lancedb.Index.fts() })
      } catch (e) {
        console.warn('[Vela VectorStore] 回填覆写后 FTS 重建失败:', e)
      }

      return { success: true, count: updates.length }
    }
  } catch (error) {
    console.error('[Vela VectorStore] 批量更新向量失败:', error)
    return { success: false, count: 0 }
  }
}

/**
 * 从旧 vectors.json 迁移数据到 LanceDB
 */
export async function migrateFromJSON(
  projectPath: string,
): Promise<{ success: boolean; migrated: number; error?: string }> {
  const jsonPath = path.join(projectPath, '.vela', 'vectors.json')
  
  if (!fs.existsSync(jsonPath)) {
    return { success: true, migrated: 0 }
  }

  try {
    console.log('[Vela VectorStore] 检测到旧 vectors.json，开始迁移...')
    const raw = fs.readFileSync(jsonPath, 'utf-8')
    const store = JSON.parse(raw) as {
      documents: Array<{ id: string; fileName: string; importedAt: string; chunkCount: number; filePath: string }>
      entries: Array<{ id: string; docId: string; text: string; vector: number[]; meta: { fileName: string; chunkIndex: number; totalChunks: number } }>
    }

    if (!store.entries || store.entries.length === 0) {
      // 空知识库，无需迁移
      fs.renameSync(jsonPath, jsonPath + '.migrated')
      return { success: true, migrated: 0 }
    }

    // 按文档分组写入
    const docMap = new Map<string, typeof store.entries>()
    for (const entry of store.entries) {
      const arr = docMap.get(entry.docId) || []
      arr.push(entry)
      docMap.set(entry.docId, arr)
    }

    let migrated = 0
    for (const [docId, entries] of docMap) {
      const docInfo = store.documents.find(d => d.id === docId)
      const fileName = docInfo?.fileName || entries[0]?.meta?.fileName || 'unknown'
      
      const chunks = entries.map(e => e.text)
      const vectors = entries.map(e => e.vector).filter(v => v && v.length > 0)
      
      await addChunks(
        projectPath,
        docId,
        fileName,
        chunks,
        vectors.length === chunks.length ? vectors : undefined,
        docInfo?.filePath,
      )
      migrated += entries.length
    }

    // 迁移完成，重命名旧文件
    fs.renameSync(jsonPath, jsonPath + '.migrated')
    console.log(`[Vela VectorStore] 迁移完成：${migrated} 个块已写入 LanceDB`)
    
    return { success: true, migrated }
  } catch (error) {
    console.error('[Vela VectorStore] 迁移失败:', error)
    return { success: false, migrated: 0, error: String(error) }
  }
}
