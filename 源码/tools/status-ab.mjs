/**
 * 元信息（底部状态栏那种小字）字号候选对照图。
 *
 * 用户画红框指出「这个有点大」后，需要在小字档位之间做取舍，而像素字体在小尺度下的
 * 清晰度无法可靠地用统计量或视觉模型判断 —— 底色渐变会淹没笔画统计，视觉模型也反复
 * 看错。唯一可靠的办法是把候选并排放在同一张物理尺寸的图上，由人眼裁决。
 *
 * 底色与文字取自「掌机绿」暗色的真实取值，并同样跑在 DPR 1.25（本机实际值）。
 * 用法: node tools/status-ab.mjs [输出名]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DPR = 1.25
const outName = process.argv[2] ?? 'status-ab.png'

const fontUrl = new URL(
  `file:///${join(root, 'src', 'assets', 'fonts', 'fusion-pixel-12px-proportional.woff2').replace(/\\/g, '/')}`,
).href

const CASES = [
  { tag: '候选 1 · 像素体 12px（本机 1.25 倍 · 官方给徽章与极小字）', size: '12px', face: 'pix' },
  { tag: '候选 2 · 像素体 13px（本机 1.35 倍 · 官方给状态栏，现在用的）', size: '13px', face: 'pix' },
  { tag: '候选 3 · 像素体 14px（本机 1.46 倍 · 官方给正文与侧栏）', size: '14px', face: 'pix' },
  { tag: '候选 4 · 像素体 16px（本机 1.67 倍 · 现在给侧栏用）', size: '16px', face: 'pix' },
  { tag: '改前 · 像素体 19.2px（整 2 倍 · 你说太大的那一档）', size: '19.2px', face: 'pix' },
  { tag: '对照 · 系统矢量体 13px（任何字号都锐利，但不是像素风）', size: '13px', face: 'ui' },
]

// 真实状态栏串：三段分别是轮次/步数、缓存命中、模型名
const BAR = '6 轮　6 步 · 78 tok/s　│　75K tok · 缓存命中 65%　│　Deepseek Flash V4.1:Default'
// 再给一行中文标签，检查汉字在同样字号下的可读性
const CJK = '任务看板　记忆系统　插件市场　设置　未分组　已思考　有更新'

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face{font-family:"PX";src:url("${fontUrl}") format("woff2");font-weight:400;font-display:block}
*{box-sizing:border-box}
body{margin:0;padding:18px 22px;background:#0f380f;color:#c9e6b2}
.row{margin-bottom:14px;padding:8px 12px;background:#275727;border:2px solid #3d7a3d}
.tag{font-size:13px;color:#9bbc0f;letter-spacing:1px;margin-bottom:6px;font-family:"PingFang SC","Microsoft YaHei UI",system-ui,sans-serif}
.pix{font-family:"PX",sans-serif;letter-spacing:0;-webkit-font-smoothing:none;font-smooth:never}
.ui{font-family:"PingFang SC","Microsoft YaHei UI",system-ui,sans-serif}
.bar{white-space:nowrap}
.cjk{margin-top:4px;color:#badea6}
</style></head><body>
${CASES.map(
  (c) => `<div class="row">
<div class="tag">${c.tag}</div>
<div class="${c.face} bar" style="font-size:${c.size}">${BAR}</div>
<div class="${c.face} cjk" style="font-size:${c.size}">${CJK}</div>
</div>`,
).join('')}
</body></html>`

mkdirSync(join(root, 'preview-src'), { recursive: true })
const htmlPath = join(root, 'preview-src', 'status-ab.html')
writeFileSync(htmlPath, html, 'utf8')

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', `--force-device-scale-factor=${DPR}`],
  defaultViewport: { width: 1560, height: 640, deviceScaleFactor: DPR },
})
try {
  const page = await browser.newPage()
  await page.goto(new URL(`file:///${htmlPath.replace(/\\/g, '/')}`).href, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const outPath = join(root, 'preview-src', outName)
  await page.screenshot({ path: outPath, fullPage: true })
  console.log(`DPR ${DPR} → ${outPath}`)
} finally {
  await browser.close()
}