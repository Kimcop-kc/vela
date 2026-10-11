/**
 * 大纲写回 —— 把「审稿时确认的新方向」落回章节大纲。
 *
 * 背景：审稿会指出本章与蓝图不符（deviated）或大纲没规定但写得合理（creative）。
 * 作者确认「就这么写」之后，蓝图还停在旧方向：下次重写这一章，模型又会按旧方向拉回去。
 *
 * 本模块只做两件确定性的事：
 *   1. 判断这条观察是否适合写回（只有偏差与合理创新需要，冲突/遗漏属于别的问题）；
 *   2. 把一段文字**追加**到既有字段末尾，并给出仓储层能接受的锚点。
 *
 * 不做的事：不覆盖原有内容（只追加）、不改后续章节、不改正文。
 */
import i18n from '../../i18n'
import type { OutlineClass, ReviewObservation } from './types'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'editors', ...opts })

/**
 * 可以直接写回大纲的分类。
 *
 * done / pending 是进度问题，missing 需要补写正文，conflict 是设定冲突——
 * 这些都不该用「确认新方向」的方式处理，硬写回反而会把问题掩盖掉。
 */
export const WRITEBACK_OUTLINE_CLASSES: OutlineClass[] = ['deviated', 'creative']

/** 这条观察是否适合「一键写回大纲」 */
export function canWriteBackToOutline(observation: ReviewObservation): boolean {
  return observation.dimension === 'outline-deviation'
    && !!observation.outlineClass
    && WRITEBACK_OUTLINE_CLASSES.includes(observation.outlineClass)
}

/** 锚点最短长度：太短的锚点容易在文中重复出现，仓储层会判定「替换位置不唯一」 */
const ANCHOR_MIN = 24
/** 锚点最长长度：超过这个长度还找不到唯一后缀，就直接用整段兜底 */
const ANCHOR_MAX = 200

/**
 * 构造「在末尾追加一段」的编辑指令。
 *
 * 仓储层要求 oldText 在字段里**只出现一次**，所以这里取一个足够长、且只出现一次的后缀
 * 作为锚点；都找不到时用整段内容兜底（整段出现在自身里必然只有一次）。
 *
 * @returns 追加为空时返回 null（没有可写入的内容）；字段原本为空时 oldText 为空字符串，
 *          这是仓储层允许的「填入空字段」用法。
 */
export function buildAppendEdit(current: string, addition: string): { oldText: string; newText: string } | null {
  const add = addition.trim()
  if (!add) return null
  const base = current.replace(/\s+$/, '')
  if (!base) return { oldText: '', newText: add }

  let anchor = ''
  const shortest = Math.min(ANCHOR_MIN, base.length)
  const longest = Math.min(ANCHOR_MAX, base.length)
  for (let length = shortest; length <= longest; length++) {
    const candidate = base.slice(base.length - length)
    if (base.indexOf(candidate) === base.length - length) {
      anchor = candidate
      break
    }
  }
  if (!anchor) anchor = base

  return { oldText: anchor, newText: `${anchor}\n\n${add}` }
}

/** 写回章节大纲时的固定标记（让作者一眼看出这段是审稿确认的，而不是原始规划） */
export function buildOutlineAdjustmentBlock(text: string, chapterNumber: number): string {
  return t('reviewReport.qualitative.writebackBlock', { chapter: chapterNumber, text: text.trim() })
}

/** 打开写回编辑框时的预填文字（可直接改） */
export function buildWritebackPrefill(observation: ReviewObservation): string {
  return t('reviewReport.qualitative.writebackPrefill', { detail: (observation.detail || observation.title).trim() })
}
