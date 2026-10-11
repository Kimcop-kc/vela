/**
 * 长篇小说回归样本集（确定性部分）
 *
 * 样本定义在 `samples/novel-regression/cases/*.json`：每个场景给出章纲、前情、已确认事实、
 * 人工核对清单，以及两段示例文本 —— `bad` 应当被本地检测命中，`clean` 不应命中。
 *
 * 这里只跑不需要模型的部分（AI 痕迹检测是纯本地规则）：
 * 语义层面的判断（人物是否知道了不该知道的事、情节是否合理）走 README 里的人工清单，不进 CI。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { detectAiTraces } from '../review'
import type { AiTraceKind } from '../review/types'

interface RegressionCase {
  id: string
  title: string
  focus: string[]
  semanticOnly?: boolean
  chapterNumber: number
  blueprint: Record<string, unknown>
  precedingSummary: string
  canonFacts: unknown[]
  mustInclude: string[]
  mustNotInclude: string[]
  manualChecks: string[]
  excerpts?: { bad: string; clean: string }
}

const casesDir = fileURLToPath(new URL('../../../samples/novel-regression/cases/', import.meta.url))
const cases: Array<{ file: string; data: RegressionCase }> = fs.readdirSync(casesDir)
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => ({
    file: name,
    data: JSON.parse(fs.readFileSync(`${casesDir}${name}`, 'utf8')) as RegressionCase,
  }))

/** 本地检测能判定的痕迹类型（见 review/types.ts） */
const DETERMINISTIC_KINDS: AiTraceKind[] = [
  'high-frequency-word', 'monotonous-sentence', 'over-summary', 'list-enumeration',
  'cliche-expression', 'universal-adverb', 'dialogue-tag', 'transition-template',
]

const kindsOf = (text: string): AiTraceKind[] => [...new Set(detectAiTraces(text).map(finding => finding.kind))]

describe('回归样本集：结构完整', () => {
  it('至少有一个样本', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it.each(cases)('$file 字段齐全', ({ data }) => {
    expect(data.id).toBeTruthy()
    expect(data.title).toBeTruthy()
    expect(data.focus.length).toBeGreaterThan(0)
    expect(data.chapterNumber).toBeGreaterThan(0)
    expect(Object.keys(data.blueprint).length).toBeGreaterThan(0)
    expect(data.mustInclude.length).toBeGreaterThan(0)
    expect(data.mustNotInclude.length).toBeGreaterThan(0)
    expect(data.manualChecks.length).toBeGreaterThan(0)

    if (data.semanticOnly) {
      // 纯语义样本没有确定性断言，但必须写清人工核对项
      expect(data.excerpts).toBeUndefined()
    } else {
      expect(data.excerpts?.bad?.trim()).toBeTruthy()
      expect(data.excerpts?.clean?.trim()).toBeTruthy()
    }
  })
})

describe('回归样本集：确定性检测', () => {
  const deterministicCases = cases.filter(item => !item.data.semanticOnly)

  it.each(deterministicCases)('$file 的 bad 文本被检出 focus 中的痕迹', ({ data }) => {
    const focus = data.focus.filter(kind => DETERMINISTIC_KINDS.includes(kind as AiTraceKind))
    expect(focus.length).toBeGreaterThan(0)
    const kinds = kindsOf(data.excerpts!.bad)
    expect(focus.some(kind => kinds.includes(kind as AiTraceKind))).toBe(true)
  })

  it.each(deterministicCases)('$file 的 clean 文本不触发 focus 中的痕迹', ({ data }) => {
    const focus = data.focus.filter(kind => DETERMINISTIC_KINDS.includes(kind as AiTraceKind))
    const kinds = kindsOf(data.excerpts!.clean)
    expect(focus.filter(kind => kinds.includes(kind as AiTraceKind))).toEqual([])
  })
})
