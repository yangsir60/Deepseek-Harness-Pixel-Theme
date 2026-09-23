/**
 * 官方 token 覆盖缺口。
 *
 * 为什么需要：verify.mjs 只在覆盖率低于 35% 时告警，所以「漏了几个 token」永远不会
 * 被发现 —— 而漏掉的 token 会**保留官方取值**，于是官方那套冷白/浅蓝就漏进主题里。
 * 用户反馈「侧栏底色还是蓝的」就是这么来的：侧栏背景用的 token 本皮肤没定义。
 *
 * 用法: node tools/official-gap.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTokens } from '../src/lib/tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const REG =
  'C:/Users/23676/.dsh/profiles/desktop/node_modules/@linxin666/dsh-client-ui-skin-center/contracts/official-tokens-v1.json'

const reg = JSON.parse(readFileSync(REG, 'utf8'))
const official = [...(reg.tokens ?? reg)]
console.log(`官方 token 注册表：${official.length} 个\n`)

// 与「背景/底色」相关的关键字：这些漏掉最致命，直接表现为「某块区域还是官方冷色」
const BGISH = /fill|bg|surface|layer|overlay|base|card|panel|mask|scrim|shade/i

for (const id of ['arcade', 'handheld', 'amber']) {
  const palette = JSON.parse(readFileSync(join(root, 'src', 'palettes', `${id}.json`), 'utf8'))
  const mine = new Set(buildTokens(palette.dark).map(([n]) => n))
  for (const [n] of buildTokens(palette.light)) mine.add(n)
  const missing = official.filter((t) => !mine.has(t))
  const bgMissing = missing.filter((t) => BGISH.test(t))
  console.log(`=== ${id} ===`)
  console.log(`  已定义 ${official.length - missing.length}/${official.length}，缺口 ${missing.length}（其中背景类 ${bgMissing.length}）`)
  if (bgMissing.length) {
    console.log('  ★ 背景/底色类缺口（最可能是「漏出官方冷色」的元凶）：')
    for (const t of bgMissing) console.log(`      ${t}`)
  }
  const other = missing.filter((t) => !BGISH.test(t))
  if (other.length) console.log(`  其它缺口：${other.join(', ')}`)
  console.log('')
}
