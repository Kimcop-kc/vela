/**
 * 守门：Storybook 的主题清单与画布背景色必须与 src/index.css 的 5 套主题保持一致。
 *
 * 为什么要有这个测试：`.storybook/preview.ts` 里的 `backgrounds.values` 曾是硬编码的 4 个色值，
 * 其中 4 个都与 index.css 的 `--color-bg` 对不上（light 写成 #F7F9FC，实际 #F5F5F5；
 * paper 写成 #F5F0E8，实际 #F4F0E7；dark 写成 #1E1E1E，实际 #1C1C1C），并且漏掉了 `.ocean`。
 * 硬编码色值和令牌一旦脱节，在 Storybook 里做的「主题走查」看到的就不是真实底色，
 * 会把好的看成坏的、坏的看成好的。该测试把这两处永久拉齐。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const css = read('../../src/index.css')
const preview = read('../preview.ts')

/**
 * 逐行扫 index.css，取出每套主题的 `--color-bg`。
 * 主题块形如 `  .ocean {`（两个空格缩进），light 主题写作 `  :root {`，返回时归一为 light。
 * 只认 `--color-bg:` 这一种写法，因此不会被 `--color-bg-elevated:` / `--color-bg-rgb:` 误匹配。
 */
function themeBackgrounds(): Record<string, string> {
  const out: Record<string, string> = {}
  let current: string | null = null
  for (const line of css.split(/\r?\n/)) {
    const open = /^ {2}(?::root|\.([\w-]+))\s*\{\s*$/.exec(line)
    if (open) {
      current = open[1] ?? 'light'
      continue
    }
    if (current && /^ {2}\}\s*$/.test(line)) {
      current = null
      continue
    }
    if (current) {
      const bg = /--color-bg:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(line)
      if (bg) out[current] = bg[1]
    }
  }
  return out
}

/** 从 preview.ts 取 `const themes = [...]` 里的主题名 */
function previewThemes(): string[] {
  const m = /const themes = \[([^\]]*)\]/.exec(preview)
  if (!m) throw new Error('preview.ts 里找不到 const themes = [...]')
  return [...m[1].matchAll(/'([\w-]+)'/g)].map(x => x[1])
}

/** 从 preview.ts 取 `backgrounds.values` 里的 name -> value */
function previewBackgrounds(): Record<string, string> {
  const m = /values: \[([\s\S]*?)\n\s*\],/.exec(preview)
  if (!m) throw new Error('preview.ts 里找不到 backgrounds.values')
  const out: Record<string, string> = {}
  for (const e of m[1].matchAll(/\{\s*name:\s*'([\w-]+)'\s*,\s*value:\s*'([^']+)'\s*\}/g)) {
    out[e[1]] = e[2]
  }
  return out
}

describe('Storybook 预览与 index.css 主题一致性', () => {
  const cssBackgrounds = themeBackgrounds()

  it('index.css 里应当能解析出 5 套主题', () => {
    expect(Object.keys(cssBackgrounds).sort()).toEqual(['dark', 'galaxy', 'light', 'ocean', 'paper'])
  })

  it('预览主题清单覆盖每一套主题，且不多不少', () => {
    expect(previewThemes().sort()).toEqual(Object.keys(cssBackgrounds).sort())
  })

  it('每套主题的画布背景色等于该主题的 --color-bg', () => {
    const values = previewBackgrounds()
    expect(Object.keys(values).sort()).toEqual(previewThemes().sort())
    for (const [name, value] of Object.entries(values)) {
      expect(value.toUpperCase(), `主题 ${name} 的背景色与 --color-bg 不一致`).toBe(cssBackgrounds[name].toUpperCase())
    }
  })

  it('故事容器直接从令牌取底色，不依赖 backgrounds 的硬编码色值', () => {
    expect(preview).toContain("background: 'var(--color-bg)'")
  })
})
