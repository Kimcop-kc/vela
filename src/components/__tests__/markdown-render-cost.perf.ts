/**
 * Markdown 渲染成本基准（流式对话的主要热点）
 *
 * 为什么单独立基准：
 *   · Agent 流式生成时，`agent-store` 每 40ms 把累计文本合并成一次 setState；
 *   · 那次 setState 会让「正在流式的那条消息」重渲染，而 `MarkdownContent` 目前
 *     是「整段内容全量重解析」（parseThinkSegments → 逐行状态机 → 逐行内联解析）；
 *   · 于是整段流式的累计成本是 O(n²)：第 k 次刷新要重新解析前 k 段的全部内容。
 *
 * 这里用 react-dom/server 的 renderToStaticMarkup 计时，不需要 DOM，
 * 因此可以在 node 环境的 vitest 里跑（仓库没装 jsdom）。
 *
 * 阈值取得很宽（数量级回归保护），并用多次运行的最优值抵消调度抖动。
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import MarkdownContent from '../ui/MarkdownContent'

// node 环境下 src/i18n 不会注册 react-i18next 实例（只在浏览器里注册），
// 直接渲染会打印 NO_I18NEXT_INSTANCE 警告。基准只关心 Markdown 解析成本，
// 文案不是变量，因此这里把 t 换成恒等函数即可。
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

/** 造一段「像真实生成结果」的中文正文：段落 + 加粗 + 列表 + 代码块 + 表格 */
function makeProse(targetChars: number): string {
  const blocks = [
    '顾野把炭笔在指间转了半圈，笔尖上还沾着昨夜没擦净的墨。\n',
    '老邵说过，**这支笔认得路**，只要顺着它指的方向走，就能找到城外的那个地方。\n',
    '- 第一件事：出城\n- 第二件事：找到那口井\n- 第三件事：把笔还回去\n',
    '他在心里默数了三遍，还是没敢把话说出口。\n',
    '```ts\nconst clue = pencil.direction()\nif (clue === "north") leave()\n```\n',
    '| 时间 | 地点 | 人物 |\n| --- | --- | --- |\n| 三更 | 茶棚 | 顾野 |\n| 五更 | 城门口 | 老邵 |\n',
    '风从北边来，带着一股铁锈味。\n',
  ]
  const parts: string[] = []
  let size = 0
  let i = 0
  while (size < targetChars) {
    const block = blocks[i % blocks.length]
    parts.push(block)
    size += block.length
    i++
  }
  return parts.join('\n')
}

function bestOf(runs: number, fn: () => void): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    fn()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

/** 渲染一次并返回耗时（ms） */
const renderOnce = (content: string, streaming: boolean): number => {
  const start = performance.now()
  renderToStaticMarkup(createElement(MarkdownContent, { content, streaming }))
  return performance.now() - start
}

describe('Markdown 渲染成本', () => {
  it('8KB 流式内容单次渲染必须能装进一个刷新窗口（40ms）内', () => {
    const content = makeProse(8_000)
    const elapsed = bestOf(10, () => {
      renderToStaticMarkup(createElement(MarkdownContent, { content, streaming: true }))
    })
    // 基准参考值（本机）：8KB ≈ 5.9ms，即约 0.76ms/KB
    // 40ms 是流式合并窗口本身：单帧超过它就意味着主线程跟不上刷新节奏。
    expect(elapsed).toBeLessThan(40)
  })

  it('渲染成本随内容长度近似线性，不出现平方级退化', () => {
    const small = makeProse(2_000)
    const large = makeProse(16_000)
    const tSmall = bestOf(10, () => { renderOnce(small, false) })
    const tLarge = bestOf(10, () => { renderOnce(large, false) })
    // 基准参考值（本机）：2KB ≈ 1.4ms，16KB ≈ 11.3ms（2/8/32/64KB 分别为 1.4/5.7/22.4/48.9ms）

    // 内容长度是 8 倍。线性实现应该 ≈8 倍；给到 3 倍余量（24 倍）才算退化。
    const ratio = tLarge / Math.max(tSmall, 0.01)
    expect(ratio).toBeLessThan(24)
  })

  it('一次完整的 8KB 流式会话（40ms 合并窗口，累计文本）总渲染时间必须低于 3 秒', () => {
    // 模拟真实流式：文本从 0 增长到 8KB，每次刷新都重新渲染「当前累计的全部内容」。
    const full = makeProse(8_000)
    const step = Math.ceil(full.length / 60)
    const elapsed = bestOf(3, () => {
      for (let end = step; end <= full.length; end += step) {
        renderOnce(full.slice(0, end), true)
      }
    })
    // 60 次刷新 × 平均 4KB。如果这里是「平方级」实现，长文会明显顶不住。
    expect(elapsed).toBeLessThan(3_000)
  })
})
