/**
 * 全量对比度实测：遍历真实渲染结果里所有含文字的元素，读出实际字色与
 * 「逐级向上合成的有效背景」，现场计算 WCAG 对比度。
 *
 * 相比早先只测主操作按钮的版本，这里覆盖走查页上全部 ui 组件
 * （徽章 7 变体 / 按钮 6 变体 / 表单 / 图标按钮 / Markdown 正文 / 对话框）。
 *
 * 背景解析规则（关键，早先的版本在这里错得很厉害）：
 *   1. 元素自身带渐变 backgroundImage 时，取渐变的第一个色标作为它的背景
 *      —— .btn-primary / .ai-glow 的 backgroundColor 是 transparent，
 *        直接向上找会拿到外层卡片色，把深色字算成 1.00。
 *   2. 半透明层不跳过，而是逐层向下合成：.glass 是 0.72 透明 + 背景模糊，
 *      .vela-badge--* 是 10%~24% 淡色底，跳过它们都会算错。
 *   3. 一路向上直到第一个不透明背景为止。
 *
 * 判定阈值按 WCAG 2.1：正文（<18.66px，或 <24px 的非加粗文本）需 ≥4.5；
 * 大字（≥24px，或 ≥18.66px 且加粗）与 UI 组件需 ≥3。
 *
 * 用法：先 `vite build --config tools/theme-preview/vite.config.ts`，再跑本脚本。
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = fileURLToPath(new URL('.', import.meta.url))
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
}
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.join(here, rel)
    if (!file.startsWith(here) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end('nf')
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch (e) {
    res.writeHead(500).end(String(e))
  }
})
await new Promise(r => server.listen(5603, '127.0.0.1', r))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } })

const perTheme = {}
for (const theme of ['light', 'galaxy', 'paper', 'dark', 'ocean']) {
  await page.goto(`http://127.0.0.1:5603/?theme=${theme}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('button')
  await page.waitForTimeout(150)
  perTheme[theme] = await page.evaluate(() => {
    const num = s => (s.match(/[\d.]+/g) || []).map(Number)

    // 取元素自身背景：渐变取第一个色标，纯色取该色，透明返回 null
    function ownBg(cs) {
      const bi = cs.backgroundImage
      if (bi && bi !== 'none' && /gradient/.test(bi)) {
        const hex = bi.match(/#[0-9a-fA-F]{3,8}/)
        if (hex) return hex[0]
        const rgb = bi.match(/rgba?\(([^)]+)\)/)
        if (rgb) return 'rgb(' + rgb[1].split('/')[0].trim() + ')'
        const srgb = bi.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/)
        if (srgb) {
          const v = x => Math.round(Number(x) * 255)
          return `rgb(${v(srgb[1])}, ${v(srgb[2])}, ${v(srgb[3])})`
        }
      }
      const m = num(cs.backgroundColor)
      if (m.length >= 3 && (m.length < 4 || m[3] > 0)) return cs.backgroundColor
      return null
    }

    function effectiveBg(el) {
      // 自底向上收集，遇到第一个不透明层停止
      const layers = []
      let node = el
      while (node) {
        const cs = getComputedStyle(node)
        const own = ownBg(cs)
        if (own) {
          const m = num(own)
          const a = m.length >= 4 ? m[3] : 1
          if (a >= 0.999) { layers.push([m[0], m[1], m[2], 1]); break }
          layers.push([m[0], m[1], m[2], a])
        }
        node = node.parentElement
      }
      if (!layers.length) return 'rgb(0, 0, 0)'
      // 从最底层往上合成
      let base = layers[layers.length - 1]
      for (let i = layers.length - 2; i >= 0; i--) {
        const [r, g, b, a] = layers[i]
        base = [
          r * a + base[0] * (1 - a),
          g * a + base[1] * (1 - a),
          b * a + base[2] * (1 - a),
          1,
        ]
      }
      return `rgb(${base.slice(0, 3).map(v => Math.round(v)).join(', ')})`
    }

    const out = []
    const seen = new Set()
    for (const el of document.querySelectorAll('*')) {
      const own = [...el.childNodes]
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join(' ')
        .trim()
      if (!own) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
      // sr-only 是给屏幕阅读器用的视觉隐藏文本（裁切到 1px），不参与视觉对比度
      if (el.classList.contains('sr-only')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width <= 1 || rect.height <= 1) continue
      const sig = el.tagName + '|' + own.slice(0, 18) + '|' + cs.fontSize + '|' + cs.fontWeight
      if (seen.has(sig)) continue
      seen.add(sig)
      out.push({
        sig,
        tag: el.tagName,
        text: own.slice(0, 24),
        fontSize: parseFloat(cs.fontSize),
        bold: Number(cs.fontWeight) >= 700,
        color: cs.color,
        bg: effectiveBg(el),
      })
    }
    return out
  })
}
await browser.close()
server.close()

function toRgb(v) {
  const s = String(v).trim()
  if (s.startsWith('#')) {
    const h = s.slice(1)
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
  }
  const m = s.match(/[\d.]+/g)
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}
function lum(rgb) {
  const f = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}
function contrast(a, b) {
  const l1 = lum(toRgb(a)), l2 = lum(toRgb(b))
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
// WCAG 大字：>=24px，或 >=18.66px 且加粗
const isLarge = s => s.fontSize >= 24 || (s.fontSize >= 18.66 && s.bold)

const themes = Object.keys(perTheme)
const all = new Map()
for (const t of themes) for (const s of perTheme[t]) if (!all.has(s.sig)) all.set(s.sig, s)

const report = []
for (const [sig, s] of all) {
  const per = {}
  let worst = Infinity, worstTheme = ''
  for (const t of themes) {
    const hit = perTheme[t].find(x => x.sig === sig)
    if (!hit) continue
    const r = contrast(hit.color, hit.bg)
    per[t] = r
    if (r < worst) { worst = r; worstTheme = t }
  }
  const need = isLarge(s) ? 3 : 4.5
  report.push({ tag: s.tag, text: s.text, fontSize: s.fontSize, bold: s.bold, worst, worstTheme, need, per })
}
report.sort((a, b) => a.worst - b.worst)

console.log('主题：' + themes.join(' / ') + '，共测 ' + report.length + ' 类文本元素\n')
console.log('元素'.padEnd(30) + '字号'.padStart(6) + '  ' + themes.map(t => t.padStart(7)).join('') + '   最差   判定')
console.log('-'.repeat(96))
for (const r of report) {
  const cells = themes.map(t => (r.per[t] != null ? r.per[t].toFixed(2).padStart(7) : '   n/a ')).join('')
  const verdict = r.worst >= r.need ? '通过' : r.worst >= 3 ? '仅大字/UI' : '不达标'
  console.log(
    (r.tag + ' ' + r.text).slice(0, 29).padEnd(30) +
    (' ' + r.fontSize.toFixed(0) + (r.bold ? 'B' : ' ')).padStart(6) + '  ' +
    cells + '  ' + r.worst.toFixed(2).padStart(5) + ' @' + r.worstTheme.padEnd(7) + verdict,
  )
}

const bad = report.filter(r => r.worst < r.need)
console.log('\n未达对应阈值：' + bad.length + ' / ' + report.length)
for (const r of bad) {
  console.log('  - ' + r.tag + '「' + r.text + '」' + r.fontSize.toFixed(0) + 'px' + (r.bold ? ' 加粗' : '') +
    ' 最差 ' + r.worst.toFixed(2) + '（需 ' + r.need + '，@' + r.worstTheme + '）')
}
