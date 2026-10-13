/**
 * 临时工具：把主题走查页按 5 套主题各截一张全页图。
 * 用法：node .tmp-theme-preview/shoot.mjs
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = fileURLToPath(new URL('.', import.meta.url))
const shotsDir = path.join(here, 'shots')
if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.join(here, rel)
    if (!file.startsWith(here) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch (err) {
    res.writeHead(500).end(String(err))
  }
})

await new Promise(resolve => server.listen(5599, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:5599/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 1 })
page.on('console', m => { if (m.type() === 'error') console.error('[page error]', m.text()) })
page.on('pageerror', e => console.error('[page exception]', e.message))

for (const theme of ['light', 'galaxy', 'paper', 'dark', 'ocean']) {
  await page.goto(`${base}?theme=${theme}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('#root section', { timeout: 15000 })
  await page.waitForTimeout(400)
  const out = path.join(shotsDir, `${theme}.png`)
  await page.screenshot({ path: out, fullPage: true })
  const h = await page.evaluate(() => document.body.scrollHeight)
  console.log(`${theme.padEnd(7)} -> ${out}  (页高 ${h}px)`)
}

await browser.close()
server.close()
console.log('done')
