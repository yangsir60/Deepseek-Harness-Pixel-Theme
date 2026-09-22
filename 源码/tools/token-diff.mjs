/**
 * 明暗两模的 token 差异体检。
 *
 * 动机：亮色模式下若某些「背景类」token 仍然解析成暗色值，说明亮色分支漏了这一项
 * ——它会在亮色界面上留下一块暗面，配上同样漏掉的浅色文字就是低对比甚至白底白字。
 * 这类漏项在大截图里非常隐蔽，但静态比对 token 表一次就能全找出来。
 *
 * 用法: node tools/token-diff.mjs
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTokens } from '../src/lib/tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const paletteDir = join(root, 'src', 'palettes')

/** 背景语义的 token：亮色模式下这些必须是亮色 */
const BGISH = /bg|surface|fill|layer|base|card|overlay|input|select|panel|hover|code-block/i

const rel = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255)
}

let flagged = 0
for (const file of readdirSync(paletteDir).filter((f) => f.endsWith('.json')).sort()) {
  const palette = JSON.parse(readFileSync(join(paletteDir, file), 'utf8'))
  // buildTokens 返回的是 [名, 值] 二元组数组，直接喂给 Map
  const dark = new Map(buildTokens(palette.modes?.dark ?? palette.dark))
  const light = new Map(buildTokens(palette.modes?.light ?? palette.light))
  const onlyDark = [...dark.keys()].filter((k) => !light.has(k))
  const onlyLight = [...light.keys()].filter((k) => !dark.has(k))

  console.log(`\n=== ${palette.id} ===`)
  console.log(`  token 数 暗=${dark.size} 亮=${light.size}`)
  if (onlyDark.length) console.log(`  ✗ 只有暗色分支有: ${onlyDark.join(', ')}`)
  if (onlyLight.length) console.log(`  ✗ 只有亮色分支有: ${onlyLight.join(', ')}`)

  const bad = []
  for (const [name, lv] of light) {
    const l = rel(lv)
    if (l === null) continue
    if (!BGISH.test(name)) continue
    // 亮色模式下的背景类 token 应当是亮色；暗于 0.25 说明它还是暗色值
    if (l < 0.25) bad.push({ name, light: lv, dark: dark.get(name) ?? '-', l: l.toFixed(3) })
  }
  if (bad.length === 0) {
    console.log('  ✓ 亮色模式下没有残留的暗色背景 token')
  } else {
    flagged += bad.length
    console.log(`  ⚠ 亮色模式下仍是暗色的背景类 token（${bad.length} 个）:`)
    for (const b of bad) console.log(`      ${b.name}\n          亮=${b.light} (L=${b.l})   暗=${b.dark}`)
  }
}

console.log('')
console.log(flagged > 0 ? `合计 ${flagged} 个可疑 token` : '合计 0 个可疑 token')