/**
 * 故事圣经页的纯工具、类型与常量
 *
 * 从 StoryBibleOverview.tsx 抽出（原文件 1207 行，单组件 1131 行）。这些是不依赖 React
 * 的判定与格式化逻辑，放在这里可以让各个分区组件共用同一份语义。
 *
 * 事实的「确认」与「记忆状态」是两件事，容易混：
 *   · `confirmedAt` 只表示作者是否过目过这条 AI 提取的事实；
 *   · `status` 才影响后续注入措辞（contradicted=与其它事实冲突、outdated=不再注入）。
 * 所以三个谓词分开定义，避免各分区各写一遍导致口径不一致。
 */
import type { ChapterSummary, CharacterStateSnapshot, Fact, PlotLine, TimelineEvent } from '../../../services/narrative-consistency'
import type { StoryBibleSection } from '../../../stores/layout-store'
import type { BlueprintData } from '../../../../electron/repositories/blueprint-repository'

export interface BibleData {
  timeline: TimelineEvent[]
  plots: PlotLine[]
  facts: Fact[]
  summaries: ChapterSummary[]
  states: CharacterStateSnapshot[]
  blueprints: BlueprintData[]
}

export const EMPTY_DATA: BibleData = { timeline: [], plots: [], facts: [], summaries: [], states: [], blueprints: [] }

export function includesQuery(query: string, ...values: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return values.some(value => (value ?? '').toLowerCase().includes(q))
}

/** 待确认：AI 提取出来但作者还没过目 */
export const isPendingFact = (fact: Fact) => !fact.confirmedAt
/** 与其它事实冲突 */
export const isConflictFact = (fact: Fact) => (fact.status ?? 'active') === 'contradicted'
/** 已确认且既没冲突也没废弃 */
export const isConfirmedFact = (fact: Fact) => !!fact.confirmedAt && !isConflictFact(fact) && (fact.status ?? 'active') !== 'outdated'

export function sectionTitle(section: StoryBibleSection, t: (key: string) => string): string {
  const labels: Record<StoryBibleSection, string> = {
    overview: t('storyBibleOverview.sections.overview'),
    characters: t('storyBibleOverview.sections.characters'),
    timeline: t('storyBibleOverview.sections.timeline'),
    plots: t('storyBibleOverview.sections.plots'),
    facts: t('storyBibleOverview.sections.facts'),
    realms: t('storyBibleOverview.sections.realms'),
    locations: t('storyBibleOverview.sections.locations'),
    search: t('storyBibleOverview.sections.search'),
  }
  return labels[section]
}
