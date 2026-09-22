/**
 * 字体 A/B 对照图：把同一段中文与同一段数字，用不同字号/字体渲染在同一张图上，
 * 并在真实设备像素比（DPR 1.25）下截图。
 *
 * 用途：像素字体的清晰度是小尺度的视觉判断，统计量会被底色渐变淹没、视觉模型也
 * 反复看错。唯一可靠的办法是把候选并排放在同一张图上，由人眼裁决。
 *
 * 用法: node tools/font-ab.mjs [输出名]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DPR = 1.25
const outName = process.argv[2] ?? 'font-ab.png'

const fontUrl = new URL(`file:///${join(root, 'src', 'assets', 'fonts', 'fusion-pixel-12px-proportional.woff2').replace(/\\/g, '/')}`).href

const CASES = [
  { tag: '改前 · 像素体 16px（1.67 倍，发虚）', size: '16px', face: 'pix' },
  { tag: '现在 · 像素体 19.2px（整 2 倍 + 尺寸回到正常水位）', size: '19.2px', face: 'pix' },
  { tag: '更大 · 像素体 24px（2 倍，但界面会显得笨重）', size: '24px', face: 'pix' },
  { tag: '对照 · 系统矢量字体 19.2px（最清楚，但不是像素风）', size: '19.2px', face: 'ui' },
]

const CJK = '新会话　任务看板　记忆系统　皮肤中心　插件市场'
const LAT = 'DeepSeek 915K tok · 用时 6分17秒 · 22:28'

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face{font-family:"PX";src:url("${fontUrl}") format("woff2");font-weight:400;font-display:block}
*{box-sizing:border-box}
body{margin:0;padding:20px 22px;background:#12102a;color:#fff1e8}
.row{margin-bottom:18px}
.tag{font-size:14px;color:#ffec27;letter-spacing:1px;margin-bottom:5px;font-family:"PingFang SC","Microsoft YaHei UI",system-ui,sans-serif}
.pix{font-family:"PX",sans-serif;letter-spacing:0}
.ui{font-family:"PingFang SC","Microsoft YaHei UI",system-ui,sans-serif}
</style></head><body>
${CASES.map(
  (c) => `<div class="row">
<div class="tag">${c.tag}</div>
<div class="${c.face}" style="font-size:${c.size}">${CJK}</div>
<div class="${c.face}" style="font-size:${c.size};color:#b8b4d8">${LAT}</div>
</div>`,
).join('')}
</body></html>`

mkdirSync(join(root, 'preview-src'), { recursive: true })
const htmlPath = join(root, 'preview-src', 'font-ab.html')
writeFileSync(htmlPath, html, 'utf8')

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', `--force-device-scale-factor=${DPR}`],
  defaultViewport: { width: 900, height: 460, deviceScaleFactor: DPR },
})
try {
  const page = await browser.newPage()
  await page.goto(new URL(`file:///${htmlPath.replace(/\\/g, '/')}`).href, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const outPath = join(root, 'preview-src', outName)
  await page.screenshot({ path: outPath })
  console.log(`DPR ${DPR} → ${outPath}（${900 * DPR}x${460 * DPR} 设备像素）`)
} finally {
  await browser.close()
}