/**
 * 三栏合并视图 — 基于相似度 DP 对齐的段落级 diff
 *
 * 对齐算法与逐词对比统一放在 `services/text-diff`：
 * - 段落层：字符重叠率 + DP 对齐（1:1 / 1:2 / 1:3 / 2:1 / 3:1，处理段落拆分与合并）
 * - 字符层：变更块内部再用逐字对比标出改了哪些字（相似度太低=整段重写时不标，避免满屏彩色）
 *
 * 布局：左栏原稿（只读）| 中栏合并结果（可编辑）| 右栏修稿（只读）
 */
import React, { useState, useCallback, useRef, useMemo, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  computeBlockDiff, computeInlineDiff, splitInlineDiffIntoLines,
  type InlineDiffSegment,
} from '../../services/text-diff'
import './three-way-merge.css'

// ===== 类型定义 =====
interface ThreeWayMergeProps {
  originalContent: string
  modifiedContent: string
  onComplete: (mergedText: string) => void
  onCancel?: () => void
}

/** 变更块内部逐词高亮的最低相似度：低于它就当成整段重写，不做逐词标注 */
const HUNK_REFINE_MIN_SIMILARITY = 0.5

// ===== 渲染辅助 =====

/** 逐词片段渲染成一行（highlight 指定标出哪一类变化） */
function renderHighlightedLine(parts: InlineDiffSegment[], highlight: 'add' | 'remove') {
  const visible = parts.filter(part => (highlight === 'add' ? part.kind !== 'remove' : part.kind !== 'add'))
  if (!visible.length || !visible.some(part => part.text)) return '\u00A0'
  return visible.map((part, index) => (
    part.kind === highlight
      ? <span key={index} className={highlight === 'add' ? 'twm-word-added' : 'twm-word-removed'}>{part.text}</span>
      : <span key={index}>{part.text}</span>
  ))
}

function HunkLines({ lines, padCount, cls, emptyLabel, parts, highlight }: {
  lines: string[]; padCount: number; cls: string; emptyLabel: string
  parts?: InlineDiffSegment[][]
  highlight?: 'add' | 'remove'
}) {
  return (
    <>
      {lines.length > 0
        ? lines.map((l, i) => (
            <div key={i} className={cls}>
              {parts?.[i] && highlight ? renderHighlightedLine(parts[i], highlight) : (l || '\u00A0')}
            </div>
          ))
        : <div className="twm-line-placeholder">{emptyLabel}</div>}
      {Array.from({ length: padCount }).map((_, i) => (
        <div key={`p${i}`} className="twm-line-padding">{'\u00A0'}</div>
      ))}
    </>
  )
}

/** contentEditable 子组件 — 仅在挂载时设置内容 */
function EditableCell({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = text || '\u00A0'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div ref={ref} className="twm-editable" contentEditable
      suppressContentEditableWarning
      onInput={e => onChange((e.target as HTMLDivElement).innerText)} />
  )
}

// ===== 主组件 =====

export default function ThreeWayMerge({
  originalContent, modifiedContent, onComplete, onCancel,
}: ThreeWayMergeProps) {
  const { t } = useTranslation('editors')
  const { segments, hunks } = useMemo(() => computeBlockDiff(originalContent, modifiedContent),
    [originalContent, modifiedContent])

  // 变更块内部的逐词差异：相似度太低（等于重写）的块不标，避免满屏彩色反而看不清
  const hunkWordParts = useMemo(() => {
    const map = new Map<number, { original: InlineDiffSegment[][]; modified: InlineDiffSegment[][] }>()
    for (const hunk of hunks) {
      if (hunk.similarity < HUNK_REFINE_MIN_SIMILARITY) continue
      const refined = computeInlineDiff(hunk.originalLines.join('\n'), hunk.modifiedLines.join('\n'))
      if (refined.identical) continue
      map.set(hunk.index, {
        original: splitInlineDiffIntoLines(refined.segments, 'original'),
        modified: splitInlineDiffIntoLines(refined.segments, 'modified'),
      })
    }
    return map
  }, [hunks])

  const [applied, setApplied] = useState<Record<number, boolean>>({})

  // 每个 segment 的编辑文本
  const [segTexts, setSegTexts] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    segments.forEach((s, i) => {
      if (s.type === 'same') init[i] = (s.lines || []).join('\n')
      else if (s.hunk) init[i] = s.hunk.originalLines.join('\n')
    })
    return init
  })

  // hunk index → segment index 映射
  const hunkSegIdx = useMemo(() => {
    const m: Record<number, number> = {}
    segments.forEach((s, i) => { if (s.hunk) m[s.hunk.index] = i })
    return m
  }, [segments])

  const buildMergedText = useCallback(() => {
    return segments.map((_, i) => segTexts[i] ?? '').join('\n')
  }, [segments, segTexts])

  const toggleHunk = useCallback((idx: number) => {
    setApplied(prev => {
      const next = { ...prev, [idx]: !prev[idx] }
      const hunk = hunks.find(h => h.index === idx)
      const si = hunkSegIdx[idx]
      if (hunk && si !== undefined) {
        const text = next[idx] ? hunk.modifiedLines.join('\n') : hunk.originalLines.join('\n')
        setSegTexts(p => ({ ...p, [si]: text }))
      }
      return next
    })
  }, [hunks, hunkSegIdx])

  const applyAll = useCallback(() => {
    const next: Record<number, boolean> = {}
    const texts: Record<number, string> = {}
    hunks.forEach(h => { next[h.index] = true; texts[hunkSegIdx[h.index]] = h.modifiedLines.join('\n') })
    setApplied(next); setSegTexts(p => ({ ...p, ...texts }))
  }, [hunks, hunkSegIdx])

  const revertAll = useCallback(() => {
    const texts: Record<number, string> = {}
    hunks.forEach(h => { texts[hunkSegIdx[h.index]] = h.originalLines.join('\n') })
    setApplied({}); setSegTexts(p => ({ ...p, ...texts }))
  }, [hunks, hunkSegIdx])

  const processedCount = Object.values(applied).filter(Boolean).length

  const getPad = (oLen: number, mLen: number) => {
    const lV = oLen > 0 ? oLen : 1, rV = mLen > 0 ? mLen : 1
    return { leftPad: Math.max(0, rV - lV), rightPad: Math.max(0, lV - rV) }
  }

  return (
    <div className="three-way-merge">
      <div className="twm-toolbar">
        <Button variant="ghost" size="sm" onClick={revertAll}>{t('threeWayMerge.revertAll')}</Button>
        <Button variant="ghost" size="sm" onClick={applyAll}>{t('threeWayMerge.applyAll')}</Button>
        <span className="twm-toolbar-progress">{t('threeWayMerge.progress', { applied: processedCount, total: hunks.length })}</span>
        {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>{t('threeWayMerge.cancel')}</Button>}
        <Button variant="success" size="sm" onClick={() => onComplete(buildMergedText())}>{t('threeWayMerge.completeMerge')}</Button>
      </div>

      {/* 固定表头 */}
      <div className="twm-headers">
        <div className="twm-header">{t('threeWayMerge.original')} <span className="twm-tag readonly">{t('threeWayMerge.readonly')}</span></div>
        <div className="twm-header">{t('threeWayMerge.mergeResult')} <span className="twm-tag editable">{t('threeWayMerge.editable')}</span></div>
        <div className="twm-header">{t('threeWayMerge.revised')} <span className="twm-tag readonly">{t('threeWayMerge.readonly')}</span></div>
      </div>

      {/* 单滚动容器 + CSS Grid 自动行高对齐 */}
      <div className="twm-scroll">
        <div className="twm-grid">
          {segments.map((seg, idx) => {
            if (seg.type === 'same') {
              // same 行：三栏静态文本，中栏可编辑
              return (
                <React.Fragment key={idx}>
                  <div className="twm-cell twm-cell-left">
                    {seg.lines?.map((l, i) => <div key={i} className="twm-line-same">{l || '\u00A0'}</div>)}
                  </div>
                  <div className="twm-cell twm-cell-center">
                    <EditableCell key={`s${idx}`} text={segTexts[idx] ?? ''}
                      onChange={t => setSegTexts(p => ({ ...p, [idx]: t }))} />
                  </div>
                  <div className="twm-cell twm-cell-right">
                    {seg.lines?.map((l, i) => <div key={i} className="twm-line-same">{l || '\u00A0'}</div>)}
                  </div>
                </React.Fragment>
              )
            }

            // hunk 行
            const hunk = seg.hunk!
            const isApplied = applied[hunk.index]
            const { leftPad, rightPad } = getPad(hunk.originalLines.length, hunk.modifiedLines.length)
            const wordParts = hunkWordParts.get(hunk.index)

            return (
              <React.Fragment key={idx}>
                {/* 左栏 */}
                <div className={`twm-cell twm-cell-left ${isApplied ? 'processed' : ''}`}>
                  <HunkLines lines={hunk.originalLines} padCount={leftPad} cls="twm-line-removed"
                    emptyLabel={t('threeWayMerge.newLines', { count: hunk.modifiedLines.length })}
                    parts={wordParts?.original} highlight="remove" />
                </div>

                {/* 中栏 */}
                <div className={`twm-cell twm-cell-center ${isApplied ? 'adopted' : 'pending'}`}>
                  <EditableCell key={`h${idx}-${isApplied ? 1 : 0}`} text={segTexts[idx] ?? ''}
                    onChange={t => setSegTexts(p => ({ ...p, [idx]: t }))} />
                </div>

                {/* 右栏（含采用按钮） */}
                <div className={`twm-cell twm-cell-right ${isApplied ? 'processed' : ''}`}>
                  <div className="twm-hunk-row">
                    <button className={`twm-adopt ${isApplied ? 'adopted' : ''}`}
                      onClick={() => toggleHunk(hunk.index)}
                      title={isApplied ? t('threeWayMerge.revertTooltip') : t('threeWayMerge.adoptTooltip')}>
                      {isApplied ? <Check size={11} strokeWidth={2.6} /> : '«'}
                    </button>
                    <div className="twm-hunk-text">
                      <HunkLines lines={hunk.modifiedLines} padCount={rightPad} cls="twm-line-added"
                        emptyLabel={t('threeWayMerge.deletedLines', { count: hunk.originalLines.length })}
                        parts={wordParts?.modified} highlight="add" />
                    </div>
                  </div>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}

