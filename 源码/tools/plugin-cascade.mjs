/**
 * 插件配色层叠验证。
 *
 * 为什么需要它：用量插件（@ychris12138/dsh-usage-stats）只装在 desktop profile，
 * 而本仓库的截图工具跑在 web profile（端口 3080），那里没有装这个插件，所以无法
 * 在真实界面里量它的颜色。但「谁赢」这件事是纯层叠问题、可复现：把皮肤生成的
 * skin.css + patches.css 与插件的真实 CSS 按真实加载顺序拼进一个页面（皮肤在前、
 * 插件在后，与实际一致），再读 computed style 即可。
 *
 * 验证重点不只是「接管成功」，还有一条反例：**热力图的内联色必须不被压平**。
 * 皮肤若用 !important 去压 .usg_cell 的 background，内联的用量色会被抹掉，
 * 整张热力图会变成一片纯色 —— 这里专门放一个带内联色的格子来守住这一点。
 *
 * 用法: node tools/plugin-cascade.mjs [皮肤id]     （默认 pixel-handheld）
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const id = process.argv[2] ?? 'pixel-handheld'
const PLUGIN_JS =
  'C:\\Users\\23676\\.dsh\\profiles\\desktop\\node_modules\\@ychris12138\\dsh-usage-stats\\lib\\client.js'

const skinCss = readFileSync(join(root, 'dist', id, 'skin.css'), 'utf8')
const patchesCss = readFileSync(join(root, 'dist', id, 'patches.css'), 'utf8')

// 从插件 bundle 里抠出它自己的 CSS 规则（类名是普通全局名，非哈希）
const raw = readFileSync(PLUGIN_JS, 'utf8')
const pluginCss = [...raw.matchAll(/\.[a-zA-Z][a-zA-Z0-9_:-]*(?:\[[^\]]*\])?\{[^{}]{0,900}?\}/g)]
  .map((m) => m[0])
  .filter((r) => r.includes('usg_'))
  .join('\n')

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
/* 真实顺序：皮肤在前 */
${skinCss}
${patchesCss}
/* 插件 CSS 由运行时后注入 */
${pluginCss}
</style></head><body>
<div data-dsh-surface="sidebar" id="sidebar" style="width:260px;height:60px"></div>
<div class="usg_panel" id="panel" style="width:300px">
  <div class="usg_header">页头</div>
  <select class="usg_providerSelect"><option>DeepSeek</option></select>
  <div class="usg_accountGrid">
    <div class="usg_accountCard" data-provider="deepseek">
      <div class="usg_accountHead"><span class="usg_accountMark">DS</span><span class="usg_accountName">DeepSeek</span></div>
      <div class="usg_quotaRow"><div class="usg_quotaTrack"><div class="usg_quotaFill" style="width:40%"></div></div></div>
    </div>
  </div>
  <div class="usg_monthGrid">
    <button class="usg_cell"></button>
    <button class="usg_cell usg_cellToday"></button>
    <button class="usg_cell" data-inline style="background-color:#3d7a3d"></button>
  </div>
  <div class="usg_days"><button class="usg_day"><span class="usg_dayBar"></span></button></div>
</div>
</body></html>`

mkdirSync(join(root, 'preview-src'), { recursive: true })
const htmlPath = join(root, 'preview-src', 'plugin-cascade.html')
writeFileSync(htmlPath, html, 'utf8')

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', `--force-device-scale-factor=1.25`],
  defaultViewport: { width: 900, height: 700, deviceScaleFactor: 1.25 },
})
try {
  const page = await browser.newPage()
  await page.goto(new URL(`file:///${htmlPath.replace(/\\/g, '/')}`).href, { waitUntil: 'load' })
  const r = await page.evaluate(() => {
    const cs = (sel, prop) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el)[prop] : '(无此元素)'
    }
    return {
      侧栏底: cs('#sidebar', 'backgroundColor'),
      面板底: cs('#panel', 'backgroundColor'),
      页头底: cs('#panel .usg_header', 'backgroundColor'),
      下拉底: cs('#panel .usg_providerSelect', 'backgroundColor'),
      账号卡背景图: cs('#panel .usg_accountCard', 'backgroundImage'),
      品牌chip: cs('#panel .usg_accountMark', 'backgroundColor'),
      配额条: cs('#panel .usg_quotaFill', 'backgroundColor'),
      空日历格: cs('#panel .usg_cell', 'backgroundColor'),
      内联色格: cs('#panel .usg_cell[data-inline]', 'backgroundColor'),
      日柱: cs('#panel .usg_dayBar', 'backgroundColor'),
      今日格轮廓: cs('#panel .usg_cellToday', 'boxShadow'),
    }
  })

  console.log(`\n插件配色层叠验证 · 皮肤 ${id}\n`)
  console.log(`  像素环境：DPR 1.25，皮肤 CSS 在前、插件 CSS 在后（与实际一致）`)
  console.log(`  插件 CSS 规则数：${pluginCss.split('\n').length}\n`)

  const same = (a, b) => a.replace(/\s/g, '') === b.replace(/\s/g, '')
  const checks = [
    ['面板底色 == 侧栏底色（白斑消除）', same(r.面板底, r.侧栏底), `${r.面板底}  vs 侧栏 ${r.侧栏底}`],
    ['页头底色 == 侧栏底色', same(r.页头底, r.侧栏底), r.页头底],
    ['供应商下拉底色 == 侧栏底色', same(r.下拉底, r.侧栏底), r.下拉底],
    ['账号卡 8% 品牌色渐变已去掉', r.账号卡背景图 === 'none', r.账号卡背景图],
    ['品牌 chip 保留供应商色（不应等于主题底）', !same(r.品牌chip, r.侧栏底), r.品牌chip],
    ['配额进度条保留供应商色', !same(r.配额条, r.侧栏底), r.配额条],
    ['空日历格已改为主题填充', !r.空日历格.includes('128, 128, 128'), r.空日历格],
    ['★ 热力图内联色未被压平', r.内联色格.includes('61, 122, 61') || r.内联色格.includes('#3d7a3d'), r.内联色格],
    ['日柱改为主题强调色（非插件蓝）', !r.日柱.includes('31, 111, 235'), r.日柱],
    ['今日格轮廓非插件蓝', !r.今日格轮廓.includes('31, 111, 235'), r.今日格轮廓],
  ]
  let bad = 0
  for (const [name, ok, detail] of checks) {
    if (!ok) bad += 1
    console.log(`  ${ok ? '✓' : '✗'} ${name}`)
    console.log(`      ${detail}`)
  }
  console.log(`\n  ${bad === 0 ? '全部通过' : `${bad} 项未通过`}\n`)
} finally {
  await browser.close()
}
