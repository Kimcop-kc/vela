import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import i18n from '../../../i18n'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'commands', ...opts })

import {
  buildCanonContext,
  renderCanonContext,
  runConsistencyGate,
} from '../../narrative-consistency'

/**
 * 从「审稿驱动修稿」的模型输出里切出正文，剥离【修复说明】【待作者确认】等元信息段落。
 * 自定义提示词常要求「正文 + 说明」多段输出，内置模板则只输出正文；两处都要兼容，
 * 否则说明块会被当成正文写进修订稿、出现在 diff 里。
 */
export function splitRefineOutput(raw: string): { body: string; notes: string } {
  const text = (raw || '').trim()
  if (!text) return { body: '', notes: '' }

  const bodyMarkers = ['【修复后正文】', '【修复后的正文】', '【修订后正文】', '【正文】']
  const notesMarkers = ['【修复说明】', '【修改说明】', '【修订说明】', '【待作者确认】']

  let start = 0
  for (const marker of bodyMarkers) {
    const index = text.indexOf(marker)
    if (index !== -1) {
      start = index + marker.length
      break
    }
  }

  let end = text.length
  for (const marker of notesMarkers) {
    const index = text.indexOf(marker, start)
    if (index !== -1 && index < end) end = index
  }

  const body = text.slice(start, end).trim()
  const notes = text.slice(end).trim()
  // 没有正文标记且说明标记在最前时 body 会为空，此时退回完整文本，避免产出空修订稿。
  return { body: body || text, notes }
}


export interface RefineFromReviewParams {
  draftPath: string
  draftContent: string
  reviewReport: string
  reviewFileName?: string
  chapterNumber: number
  userRefinePrompt?: string
}

export class RefineFromReviewCommand extends BaseWorkflowCommand<string> {
  constructor(private params: RefineFromReviewParams) {
    super()
  }

  async execute({ callbacks, context }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('common.noProject'))

    callbacks.log(t('refineFromReview.repairing'))

    const template = getPromptTemplate('refine_from_review')
    if (!template) throw new Error(t('refineFromReview.templateNotFound'))

    const userPromptBlock = this.params.userRefinePrompt?.trim()
      ? `★【用户额外修稿指导（绝对优先级）】★：\n${this.params.userRefinePrompt}`
      : ''

    const promptBuilder = new ChapterPromptBuilder(template)
      .withReviewReport(this.params.reviewReport)
      .withDraftContent(this.params.draftContent)
      .withGlobalGuidance(project.novelConfig.globalGuidance || '')
      .withUserRefinePrompt(userPromptBlock)

    // ==========================================
    // [Canon] 注入叙事一致性上下文（审稿修复时绝不破坏既有事实）
    // ==========================================
    try {
      const [core, allCharacters] = await Promise.all([
        ipc.invoke('db:project-core-get').catch(() => null as null | { premise?: string; charactersArch?: string; worldbuilding?: string; synopsis?: string }),
        ipc.invoke('db:character-get-all').catch(() => [] as Array<{ name: string; role: string; currentState?: { location?: string; powerLevel?: string; physicalState?: string; mentalState?: string; keyItems?: string; recentEvents?: string; updatedAtChapter?: number } }>),
      ])
      const canon = await buildCanonContext({
        chapterNumber: this.params.chapterNumber,
        architecture: {
          premise: core?.premise || '',
          charactersArch: core?.charactersArch || '',
          worldbuilding: core?.worldbuilding || '',
          synopsis: core?.synopsis || '',
        },
        characters: (allCharacters || []).map(c => ({
          name: c.name,
          role: c.role,
          currentState: c.currentState,
        })),
        chapterGoal: `第${this.params.chapterNumber}章审稿修复`,
        previousEnding: '',
        ragContext: '',
        writingStyle: project.novelConfig.writingStyle || '',
        globalGuidance: project.novelConfig.globalGuidance || '',
      })
      promptBuilder.withCanonContext(renderCanonContext(canon))
      callbacks.log(t('canon.reviewFixContextInjected', { timeline: canon.timeline.length, characters: canon.characterStates.length }))
      ;(context.data as Record<string, unknown>).__canonForReviewRefine = canon
    } catch (e) {
      callbacks.log(t('canon.reviewFixContextFailed', { error: String(e) }))
    }

    const refined = await this.callLLMWithBuilder(promptBuilder, callbacks)
    const { body: cleanRefined, notes: refineNotes } = splitRefineOutput(this.stripThinkingTags(refined))
    if (refineNotes) {
      callbacks.log(t('refineFromReview.notesDetached', { length: refineNotes.length }))
      callbacks.log(refineNotes)
    }

    // ==========================================
    // [Canon] 审稿修复后一致性 Gate（isRewrite=true）
    // ==========================================
    let finalRefined = cleanRefined
    const canonForReviewRefine = (context.data as Record<string, unknown>).__canonForReviewRefine as import('../../narrative-consistency').CanonContext | undefined
    if (canonForReviewRefine) {
      try {
        const gateResult = await runConsistencyGate({
          chapterNumber: this.params.chapterNumber,
          chapterContent: cleanRefined,
          canon: canonForReviewRefine,
          isRewrite: true,
        })
        callbacks.log(t('canon.reviewFixGateVerdict', { verdict: gateResult.verdict, report: gateResult.report }))
        if (gateResult.verdict === 'BLOCK') {
          throw new Error(t('refineFromReview.gateBlocked', { reasons: gateResult.blockingReasons.join('；') }))
        }
        if (gateResult.verdict === 'REPAIR' && gateResult.repairedContent) {
          finalRefined = gateResult.repairedContent
          callbacks.log(t('canon.reviewFixAutoRepair', { attempts: gateResult.repairAttempts }))
        }
        if (gateResult.issues.length === 0) {
          callbacks.log(t('canon.reviewFixCheckPassed'))
        }
        const remaining = gateResult.issues.map(i => i.issue)
        if (remaining.length > 0) context.data.consistencyWarnings = remaining
        context.data.consistencyReport = {
          verdict: gateResult.verdict,
          totalIssues: gateResult.issues.length,
          repairAttempts: gateResult.repairAttempts,
          remaining: gateResult.issues.length,
        }
      } catch (e) {
        callbacks.log(t('canon.reviewFixGateError', { error: String(e) }))
        throw e
      }
    }

    const { parseDraftMeta } = await import('../chapter-workflow')
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    if (!baseDraft) throw new Error(t('common.baseDraftNotFound'))

    const revIndex = await ipc.invoke('db:revision-next-index', baseDraft.id)

    // 清理该草稿下已有的 pending 状态修稿，保证只保留最新的一条
    const pendingRevs = await ipc.invoke('db:revision-get-pending', baseDraft.id)
    for (const rev of pendingRevs) {
      await ipc.invoke('db:revision-mark-discarded', rev.id)
    }

    const createRes = await ipc.invoke('db:revision-create', {
      baseDraftId: baseDraft.id,
      revisionIndex: revIndex,
      revisionType: 'review-fix',
      content: finalRefined,
      wordCount: finalRefined.length,
      userPrompt: this.params.userRefinePrompt,
    }) as { success: boolean; id: number }

    const { useEditorStore } = await import('../../../stores/editor-store')
    useEditorStore.getState().openFile({
      id: `diff-${this.params.draftPath}-${createRes.id}`,
      name: t('refineFromReview.tabName', { chapter: this.params.chapterNumber }),
      type: 'diff',
      filePath: this.params.draftPath,
      originalContent: this.params.draftContent,
      content: finalRefined,
      revisionPath: String(createRes.id),
      chapterNumber: this.params.chapterNumber,
      chapterDir: `vela://draft/ch${this.params.chapterNumber}`,
    })

    callbacks.log(t('refineFromReview.completed', { length: finalRefined.length, version: revIndex }))
    return finalRefined
  }
}
