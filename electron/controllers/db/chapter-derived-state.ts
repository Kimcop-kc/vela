/**
 * 章节「派生状态」的清理与恢复
 *
 * 定稿 / 撤销定稿 / 重置章节时，除了草稿本身，还有一串由本章派生出来的数据要一起处理：
 * 根目录的定稿文本投影、知识库里的章节文档、后处理跑批记录、下游审稿摘要，
 * 以及（有回滚快照时）角色状态与剧情线历史。
 *
 * 这段逻辑原先内联在 db-controller.ts 里被三个 handler 共用。拆出来单独放，
 * 是因为它是「跨多个仓储的补偿流程」，与单个 handler 的转发职责不是一回事；
 * 同时它也是目前唯一需要按顺序处理多个仓储、并把失败降级成 warning 的地方。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getCurrentProjectPath } from '../../database'
import { listDocuments as listKnowledgeDocuments, removeDocument as removeKnowledgeDocument } from '../../knowledge-base'
import { BlueprintRepository } from '../../repositories/blueprint-repository'
import { CanonRepository } from '../../repositories/canon-repository'
import { SummaryRepository } from '../../repositories/summary-repository'
import { PostProcessRepository } from '../../repositories/post-process-repository'
import { ReviewDigestRepository } from '../../repositories/review-digest-repository'
import { ChapterRollbackRepository } from '../../repositories/chapter-rollback-repository'

export function getFinalizedProjectionPaths(chapterNumber: number, chapterTitle?: string): string[] {
  const projectPath = getCurrentProjectPath()
  if (!projectPath) return []

  const safeTitle = chapterTitle ? ` ${chapterTitle.replace(/[/\\]/g, '_')}` : ''
  const paths = [path.join(projectPath, `第${chapterNumber}章${safeTitle}.txt`)]
  if (safeTitle) {
    paths.push(path.join(projectPath, `第${chapterNumber}章.txt`))
  }
  paths.push(path.join(projectPath, `chapter_${chapterNumber}.txt`))
  return Array.from(new Set(paths))
}

export function removeFinalizedProjection(chapterNumber: number, chapterTitle?: string): string | undefined {
  for (const projectionPath of getFinalizedProjectionPaths(chapterNumber, chapterTitle)) {
    if (!fs.existsSync(projectionPath)) continue
    try {
      fs.rmSync(projectionPath)
      return undefined
    } catch (error) {
      return `根目录定稿文件删除失败：${String(error)}`
    }
  }
  return undefined
}

export async function removeChapterKnowledgeDocuments(chapterNumber: number, chapterTitle?: string): Promise<string | undefined> {
  const projectPath = getCurrentProjectPath()
  if (!projectPath) return undefined
  const safeTitle = chapterTitle ? `第${chapterNumber}章 ${chapterTitle.replace(/[/\\]/g, '_')}.txt` : ''
  const generatedNames = new Set([
    safeTitle,
    `第${chapterNumber}章.txt`,
    `chapter_${chapterNumber}.txt`,
  ].filter(Boolean))
  try {
    for (const document of await listKnowledgeDocuments(projectPath)) {
      if (!generatedNames.has(document.fileName)) continue
      await removeKnowledgeDocument(document.id, projectPath)
    }
    return undefined
  } catch (error) {
    return `知识库定稿记录清理失败：${String(error)}`
  }
}

/**
 * 恢复/清理本章的派生状态，返回给界面展示的警告文案（无问题时为 undefined）。
 *
 * 注意这里刻意不抛异常：撤销定稿这类操作即使派生数据清理失败，草稿本身的状态也必须变更，
 * 否则作者会卡在「想撤销却撤不掉」。失败信息以 warning 形式回传给界面。
 */
export async function restoreChapterDerivedState(chapterNumber: number, chapterTitle?: string): Promise<string | undefined> {
  let warning: string | undefined
  const rollback = ChapterRollbackRepository.restore(chapterNumber)
  if (!rollback.restored) {
    // 旧版本定稿没有快照：仍清理章节级派生数据，但无法恢复角色/剧情线历史。
    BlueprintRepository.clearGeneratedNotes(chapterNumber)
    CanonRepository.clearChapterTimeline(chapterNumber)
    CanonRepository.clearChapterFacts(chapterNumber)
    CanonRepository.clearChapterSummary(chapterNumber)
    SummaryRepository.clearChapter(chapterNumber)
    warning = '该章节定稿早于回滚快照功能，角色状态和剧情线只能做部分清理。'
  }

  PostProcessRepository.deleteRunsBySource('chapter_finalize', String(chapterNumber))
  // 章节回滚会改变此章及之后的 Canon；下游审稿摘要一并失效，下次审稿自动重建。
  ReviewDigestRepository.deleteFromChapter(chapterNumber)
  const projectionWarning = removeFinalizedProjection(chapterNumber, chapterTitle)
  const knowledgeWarning = await removeChapterKnowledgeDocuments(chapterNumber, chapterTitle)
  warning = warning ?? projectionWarning
  warning = warning ?? knowledgeWarning
  return warning
}
