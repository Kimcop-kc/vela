/**
 * 守门：强调色底上不允许写死 `text-white`，必须走 `--color-on-accent`。
 *
 * 为什么要守：`.btn-primary` 与 `bg-[var(--color-accent)]` 的底色是跟着主题变的，
 * 而 5 套主题里有 3 套的强调色是亮色（galaxy #5CB8F0 / dark #4CC2FF / ocean #38C8E8），
 * 白字在它们上面的对比度只有 2.0~2.2；令牌里本来就为每套主题配好了前景色
 * （galaxy 8.31 / dark 8.70 / ocean 8.51）。写死白色等于把令牌作废。
 *
 * 实测数据（WCAG 对比度，白字 vs. 各主题 --color-accent）：
 *   light 4.40 · paper 4.43 · galaxy 2.19 · dark 2.01 · ocean 1.98
 * 正文是 12px，AA 要求 4.5:1，也就是说 5 套主题里有 4 套不达标。
 *
 * 本测试是行级启发式：同一行同时出现 `text-white` 与强调色底（`--color-accent` /
 * `btn-primary`）即判失败。换成跨行写法需要同步升级本测试。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('../../..', import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe('强调色底上的字色', () => {
  it('不得在同一行把 text-white 和强调色底写在一起', () => {
    const offenders: string[] = []
    for (const file of walk(srcDir)) {
      const rel = path.relative(srcDir, file)
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (!line.includes('text-white')) return
        if (line.includes('--color-accent') || line.includes('btn-primary')) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`)
        }
      })
    }
    expect(offenders, `以下位置在强调色底上写死了 text-white，应改用 text-[var(--color-on-accent)]：\n${offenders.join('\n')}`).toEqual([])
  })
})
