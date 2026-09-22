/**
 * 像素机架构建器：配色 JSON → 可直接投放的 skin-center v2 皮肤目录。
 *
 * 用法:
 *   node src/build.mjs               生成全部配色
 *   node src/build.mjs amber         只生成 id 含 "amber" 的配色
 *   node src/build.mjs --no-clean    保留 dist 下已有产物（默认清理同名目录）
 *
 * 产物结构（skin-center v2，见 contracts/skin-manifest-v2.schema.json）：
 *   dist/<id>/skin.json  skin.css  patches.css  assets/fonts/*.woff2
 *             LICENSE-OFL-font.txt  NOTICE.txt  preview/{light,dark}.jpg
 *
 * 设计要点：skin.css = 字体装载 + L1 token（亮/暗两块）+ L2 层次骨架；
 *          patches.css = L3 组件层。两者都由本脚本拼装，配色只影响 token 块。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { audit, buildTokens } from './lib/tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const paletteDir = join(here, 'palettes')
const cssDir = join(here, 'css')
const assetDir = join(here, 'assets', 'fonts')
const outRoot = join(root, 'dist')

const args = process.argv.slice(2)
const filter = args.find((a) => !a.startsWith('--'))
const noClean = args.includes('--no-clean')

const readCss = (name) => readFileSync(join(cssDir, name), 'utf8').trimEnd()
const fontsCss = readCss('fonts.css')
const surfacesCss = readCss('surfaces.css')
const patchesTemplate = readCss('patches.css')

/** 一行一条声明：加载器按行克隆 :root 的 body 级声明，跨行会丢。 */
const tokenBlock = (selector, tokens, indent = '  ') =>
  `${selector} {\n${tokens.map(([n, v]) => `${indent}${n}: ${v};`).join('\n')}\n}`

/** 只保留 schema 允许的字段，避免 fail-closed。 */
function manifest(palette, hasPreview) {
  const m = {
    $schema: 'https://schemas.linxin666.org/dsh-skin/v2.json',
    skinManifestVersion: 2,
    id: palette.id,
    name: palette.name,
    nameEn: palette.nameEn,
    version: palette.version,
    author: palette.author,
    tagline: palette.tagline,
    description: palette.description,
    tags: palette.tags,
    accent: palette.accent,
    order: palette.order,
    license: 'OFL-1.1 (字体) / MIT (皮肤代码)',
    licenseUrl: 'https://github.com/TakWolf/fusion-pixel-font/blob/master/LICENSE-OFL',
    sourceUrl: 'https://github.com/TakWolf/fusion-pixel-font',
    attribution: `字体：缝合像素字体 Fusion Pixel Font © TakWolf，SIL Open Font License 1.1。主题：像素机架 Pixel Rig。`,
    contributes: {
      stylesheet: 'skin.css',
      patches: 'patches.css',
    },
  }
  // preview 为可选字段；只有两张图都落地才写，否则宁可省略也不让皮肤因缺文件失败。
  if (hasPreview) m.preview = { light: 'preview/light.jpg', dark: 'preview/dark.jpg' }
  return m
}

const NOTICE = `像素机架 Pixel Rig — 第三方资源与授权声明
================================================================

1) 缝合像素字体 / Fusion Pixel Font（本皮肤内置 assets/fonts/ 下两个 woff2）
   Copyright (c) 2022, TakWolf (https://takwolf.com)
   Reserved Font Name 'Fusion Pixel'.
   授权：SIL Open Font License, Version 1.1（全文见 LICENSE-OFL-font.txt）
   来源：https://github.com/TakWolf/fusion-pixel-font
   上游字形授权：方舟像素字体 Ark Pixel Font (OFL-1.1)、美咲フォント Misaki
   (无类型许可证，兼容 OFL-1.1)、美績点陣體 MisekiBitmap (OFL-1.1)、
   精品點陣體 7x7 / 9x9 (OFL-1.1)、俐方體 11 號 Cubic 11 (OFL-1.1)、
   Galmuri (OFL-1.1)。
   本皮肤未修改字体文件，仅按 OFL 允许的方式随皮肤目录再分发。

2) 皮肤代码（skin.css / patches.css / skin.json）
   由本仓库生成，按 MIT 授权使用。像素斜面配方（凸起/凹陷/按下翻转）为通用技术，
   参考自 NES.css 与 98.css 的公开实现思路，未复制其代码。

3) 本皮肤不含 hooks.mjs，不执行任何脚本，全部效果由声明式 CSS 与本地字体完成。
`

let built = 0
let failed = 0

for (const file of readdirSync(paletteDir).filter((f) => f.endsWith('.json')).sort()) {
  const palette = JSON.parse(readFileSync(join(paletteDir, file), 'utf8'))
  if (filter && !palette.id.includes(filter)) continue

  console.log(`\n=== 构建 ${palette.id}  ${palette.name} ===`)

  // 1) 过设计系统不变量（层次梯级 / 对比度 / 按钮契约）
  const { errors, warnings } = audit(palette)
  for (const w of warnings) console.log(`  ! ${w}`)
  if (errors.length > 0) {
    for (const e of errors) console.log(`  ✗ ${e}`)
    console.log('  ✗ 未通过审计，跳过')
    failed += 1
    continue
  }

  const outDir = join(outRoot, palette.id)
  if (!noClean && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(join(outDir, 'assets', 'fonts'), { recursive: true })

  // 2) 字体资源
  for (const font of readdirSync(assetDir)) {
    copyFileSync(join(assetDir, font), join(outDir, 'assets', 'fonts', font))
  }

  // 3) 预览图（可选，存在才纳入清单）
  const prevSrc = join(root, 'preview-src', palette.id)
  let hasPreview = false
  if (existsSync(prevSrc)) {
    mkdirSync(join(outDir, 'preview'), { recursive: true })
    for (const [mode, src] of [['light', 'light.jpg'], ['dark', 'dark.jpg']]) {
      const from = join(prevSrc, src)
      if (existsSync(from)) {
        copyFileSync(from, join(outDir, 'preview', `${mode}.jpg`))
        hasPreview = true
      }
    }
    hasPreview =
      existsSync(join(outDir, 'preview', 'light.jpg')) &&
      existsSync(join(outDir, 'preview', 'dark.jpg'))
  }

  // 4) skin.css = 字体 + L1 token（亮/暗） + L2 层次骨架
  const light = buildTokens(palette.light)
  const dark = buildTokens(palette.dark)
  const skinCss = [
    `/* ${palette.name} / ${palette.nameEn} — DSH 皮肤 · 由像素机架构建器生成，请勿手改。 */`,
    `/* 源配色：src/palettes/${file}  ·  层次与对比度由构建期审计强制 */`,
    fontsCss,
    '',
    '/* ===== L1 · 亮色模（抬升层级越高 → 底色越亮） ===== */',
    tokenBlock(':root', light),
    '',
    '/* ===== L1 · 暗色模 ===== */',
    tokenBlock('body[data-ds-dark-theme]', dark),
    '',
    surfacesCss,
    '',
  ].join('\n')
  writeFileSync(join(outDir, 'skin.css'), skinCss, 'utf8')

  // 5) patches.css = L3 组件层（关键帧名注入皮肤 id 前缀）
  writeFileSync(join(outDir, 'patches.css'), `${patchesTemplate.replaceAll('{{id}}', palette.id)}\n`, 'utf8')

  // 6) 清单与声明文件
  writeFileSync(join(outDir, 'skin.json'), `${JSON.stringify(manifest(palette, hasPreview), null, 2)}\n`, 'utf8')
  writeFileSync(join(outDir, 'NOTICE.txt'), NOTICE, 'utf8')
  writeFileSync(
    join(outDir, 'LICENSE'),
    `MIT License\n\nCopyright (c) 2026 像素机架 Pixel Rig\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`,
    'utf8',
  )

  // 7) 报告
  const size = (p) => `${(statSync(p).size / 1024).toFixed(1)}KB`
  console.log(`  ✓ token ${light.length}×2 = ${light.length * 2}`)
  console.log(`  ✓ skin.css ${size(join(outDir, 'skin.css'))}  patches.css ${size(join(outDir, 'patches.css'))}`)
  console.log(`  ✓ 预览图 ${hasPreview ? 'light+dark' : '（尚未生成，清单中已省略 preview 字段）'}`)
  console.log(`  ✓ 产物 ${outDir}`)
  built += 1
}

console.log(`\n构建完成：${built} 个配色${failed > 0 ? `，${failed} 个因审计失败跳过` : ''}`)
if (failed > 0) process.exit(1)