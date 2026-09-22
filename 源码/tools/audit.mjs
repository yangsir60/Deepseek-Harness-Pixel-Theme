/**
 * 配色审计：只跑设计系统不变量，不生成产物。
 * 用法: node tools/audit.mjs [配色id...]   省略则审计全部
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { contrast } from '../src/lib/color.mjs'
import { audit, buildTokens, lightness } from '../src/lib/tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const paletteDir = join(here, '..', 'src', 'palettes')

const wanted = process.argv.slice(2)
const files = readdirSync(paletteDir).filter((f) => f.endsWith('.json'))

let failed = 0

for (const file of files.sort()) {
  const palette = JSON.parse(readFileSync(join(paletteDir, file), 'utf8'))
  if (wanted.length > 0 && !wanted.includes(palette.id)) continue

  const { errors, warnings } = audit(palette)
  const tokenCount = buildTokens(palette.dark).length

  console.log(`\n=== ${palette.id}  ${palette.name} / ${palette.nameEn} ===`)
  console.log(`token 数: ${tokenCount}×2 模 = ${tokenCount * 2}`)

  for (const mode of ['dark', 'light']) {
    const m = palette.modes?.[mode] ?? palette[mode]
    const l = m.surface.map((c) => lightness(c).toFixed(3)).join(' → ')
    console.log(
      `  ${mode.padEnd(5)} 梯级 ${l}  ` +
        `正文 ${contrast(m.ink, m.surface[0]).toFixed(2)}:1  ` +
        `按钮 ${contrast(m.accentFg, m.accent).toFixed(2)}:1  ` +
        `强调 ${contrast(m.accent, m.surface[0]).toFixed(2)}:1`,
    )
  }

  if (errors.length > 0) {
    failed += 1
    console.log('  错误:')
    for (const e of errors) console.log(`    ✗ ${e}`)
  }
  if (warnings.length > 0) {
    console.log('  告警:')
    for (const w of warnings) console.log(`    ! ${w}`)
  }
  if (errors.length === 0) console.log('  ✓ 通过全部不变量')
}

console.log('')
if (failed > 0) {
  console.log(`✗ ${failed} 个配色未通过`)
  process.exit(1)
}
console.log('✓ 全部配色通过')