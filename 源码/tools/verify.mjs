/**
 * 皮肤产物校验器：投放前的唯一闸门。
 *
 * 用法: node tools/verify.mjs [id...]     省略则校验 dist 下全部
 *
 * 做三件事：
 *   1) 用官方 skin-manifest-v2.schema.json 本体做校验（实现其用到的 JSON Schema
 *      子集），而不是手抄一份规则——官方 schema 若变更，本校验自动跟随；
 *   2) 复刻加载器的 CSS 白名单与告警（禁 @import / 远程 / 绝对 / 越界 URL、
 *      [class*=] 子串匹配、通用关键帧名）；
 *   3) 复核设计系统：token 覆盖率、关键 token 齐备、对比度、自定义属性闭环、
 *      字体文件真实存在。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { contrast } from '../src/lib/color.mjs'
import { audit } from '../src/lib/tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const distRoot = join(root, 'dist')

const SKIN_CENTER = 'C:/Users/23676/.dsh/profiles/desktop/node_modules/@linxin666/dsh-client-ui-skin-center'
const schemaPath = join(SKIN_CENTER, 'contracts', 'skin-manifest-v2.schema.json')
const registryPath = join(SKIN_CENTER, 'contracts', 'official-tokens-v1.json')

/** 承重 token：缺一个就会让某片官方 UI 掉回默认色，故列为硬错误。 */
const CRITICAL = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-brand-primary',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-markdown-code-block',
  '--dsw-shadow-lv3',
  '--dsw-mask-blur',
  '--dsh-scrollbar-thumb',
]

const GENERIC_KEYFRAMES = new Set([
  'spin', 'pulse', 'fade', 'fadein', 'fade-in', 'fadeout', 'fade-out',
  'slide', 'slidein', 'slide-in', 'bounce', 'glow', 'blink', 'shake', 'float',
])

/* ------------------------------------------------------------------ */
/* 1) JSON Schema 子集校验                                             */
/* ------------------------------------------------------------------ */
function validate(node, schema, rootSchema, path, errors) {
  if (schema.$ref) {
    const ref = schema.$ref.replace('#/', '').split('/')
    let target = rootSchema
    for (const key of ref) target = target[key]
    return validate(node, target, rootSchema, path, errors)
  }
  const bad = (msg) => errors.push(`${path}: ${msg}`)

  if (schema.type === 'object' || schema.properties || schema.additionalProperties !== undefined) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return bad(`应为对象，实为 ${Array.isArray(node) ? 'array' : typeof node}`)
    }
    for (const key of schema.required ?? []) {
      if (!(key in node)) bad(`缺少必填字段 "${key}"`)
    }
    const props = schema.properties ?? {}
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(node)) {
        if (!(key in props)) bad(`schema 不允许的字段 "${key}"（fail-closed 会拒绝整个皮肤）`)
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in node) validate(node[key], sub, rootSchema, `${path}.${key}`, errors)
    }
  }

  if (schema.type === 'array') {
    if (!Array.isArray(node)) return bad(`应为数组，实为 ${typeof node}`)
    if (schema.uniqueItems && new Set(node.map((x) => JSON.stringify(x))).size !== node.length) {
      bad('数组元素重复')
    }
    if (schema.items) node.forEach((item, i) => validate(item, schema.items, rootSchema, `${path}[${i}]`, errors))
  }

  if (schema.type === 'string' && typeof node !== 'string') return bad(`应为字符串，实为 ${typeof node}`)
  if (schema.type === 'integer' && !Number.isInteger(node)) return bad(`应为整数，实为 ${JSON.stringify(node)}`)
  if (typeof node === 'string') {
    if (schema.minLength !== undefined && node.length < schema.minLength) bad(`长度不足 ${schema.minLength}`)
    if (schema.pattern && !new RegExp(schema.pattern).test(node)) bad(`不匹配 pattern ${schema.pattern} → "${node}"`)
    if (schema.enum && !schema.enum.includes(node)) bad(`不在枚举 ${JSON.stringify(schema.enum)} 内 → "${node}"`)
  }
  if (schema.const !== undefined && node !== schema.const) bad(`应为常量 ${JSON.stringify(schema.const)}`)
  if (schema.enum && typeof node !== 'string' && !schema.enum.includes(node)) bad(`不在枚举内`)
}

/* ------------------------------------------------------------------ */
/* 2) CSS 白名单复刻                                                   */
/* ------------------------------------------------------------------ */
function checkCss(file, errors, warnings) {
  const css = readFileSync(file, 'utf8')
  const name = file.split(/[\\/]/).pop()

  for (const m of css.matchAll(/@import\b[^;]*/g)) {
    errors.push(`${name}: 禁用 @import → ${m[0].trim()}`)
  }
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const u = m[2].trim()
    if (/^https?:\/\//i.test(u)) errors.push(`${name}: 远程 URL "${u}"（必须随皮肤目录分发资源）`)
    else if (u.startsWith('//')) errors.push(`${name}: 协议相对 URL "${u}"`)
    else if (u.startsWith('/')) errors.push(`${name}: 绝对路径 "${u}"（逃出皮肤目录）`)
    else if (u.startsWith('../')) errors.push(`${name}: 越界路径 "${u}"`)
    else if (/^data:/i.test(u)) warnings.push(`${name}: 内联 data: URL，建议改为 assets/ 下的真实文件`)
  }
  // 显式豁免：CSS-Modules 的**局部名**（_title、sectionLabel 这类）在官方重建后依然
  // 稳定，只有官方改名才会失配，而失配是「静默不生效」而不是破坏布局。允许在样式里用
  // 注释显式豁免，一条注释豁免一个选择器、必须写明理由 —— 否则这类已知取舍会把告警
  // 通道长期占满，真正的新告警就被淹没了。
  const allowedHash = (css.match(/verify-allow:\s*hash-class/g) ?? []).length
  let hashSeen = 0
  for (const m of css.matchAll(/\[class\s*[*^$]=/g)) {
    hashSeen += 1
    if (hashSeen <= allowedHash) continue
    warnings.push(`${name}: [class${m[0].slice(6, 7)}=...] 依赖 CSS-Modules 哈希类名，官方重建即失效（要豁免就加注释 verify-allow: hash-class 并写明理由）`)
  }
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
    if (GENERIC_KEYFRAMES.has(m[1].toLowerCase())) {
      warnings.push(`${name}: 通用关键帧名 "${m[1]}" 有跨皮肤碰撞风险，应加皮肤 id 前缀`)
    }
  }
  const open = (css.match(/\{/g) ?? []).length
  const close = (css.match(/\}/g) ?? []).length
  if (open !== close) errors.push(`${name}: 花括号不配对（{ ${open} 个 / } ${close} 个）`)

  return css
}

/** 自定义属性闭环：用到的 var(--pr-*) 必须有定义。 */
function checkCustomProps(css, errors) {
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
  const used = new Set([...css.matchAll(/var\(\s*(--pr-[\w-]+)/g)].map((m) => m[1]))
  for (const v of used) {
    if (!defined.has(v)) errors.push(`skin.css: 引用了未定义的自定义属性 ${v}`)
  }
  return { defined, used }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
const registryTokens = new Set(registry.tokens ?? registry)

const wanted = process.argv.slice(2)
const ids = readdirSync(distRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((id) => wanted.length === 0 || wanted.includes(id))
  .sort()

let totalErrors = 0
let totalWarnings = 0

for (const id of ids) {
  const dir = join(distRoot, id)
  const errors = []
  const warnings = []
  console.log(`\n=== 校验 ${id} ===`)

  // --- 清单 ---
  const manifestPath = join(dir, 'skin.json')
  if (!existsSync(manifestPath)) {
    console.log('  ✗ 缺少 skin.json')
    totalErrors += 1
    continue
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  validate(manifest, schema, schema, 'skin.json', errors)

  // --- 引用文件存在性 ---
  const referenced = [
    manifest.contributes?.stylesheet,
    manifest.contributes?.patches,
    manifest.preview?.light,
    manifest.preview?.dark,
  ].filter(Boolean)
  for (const rel of referenced) {
    const p = join(dir, rel)
    if (!existsSync(p)) errors.push(`skin.json 引用的文件不存在: ${rel}`)
    else if (statSync(p).size === 0) errors.push(`文件为空: ${rel}`)
  }
  if (manifest.contributes?.patches === undefined) {
    warnings.push('未声明 contributes.patches —— L3 组件层不会加载，像素控件不会生效')
  }
  if (manifest.facets?.client) {
    errors.push('声明了 facets.client（hooks）—— 手工投放的皮肤拿不到信任链，hooks 永不执行，应移除')
  }

  // --- CSS ---
  const skinCss = checkCss(join(dir, 'skin.css'), errors, warnings)
  const patchesCss = checkCss(join(dir, 'patches.css'), errors, warnings)
  const allCss = `${skinCss}\n${patchesCss}`
  checkCustomProps(skinCss, errors)

  // --- 字体 ---
  const fontRefs = [...skinCss.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1])
  if (fontRefs.length === 0) warnings.push('skin.css 未引用任何字体文件')
  for (const rel of fontRefs) {
    const p = join(dir, rel)
    if (!existsSync(p)) {
      errors.push(`@font-face 引用的字体不存在: ${rel}`)
    } else if (!/\.(woff2?|ttf|otf)$/i.test(rel)) {
      warnings.push(`@font-face 引用了非字体扩展名: ${rel}`)
    }
  }
  if (!/@font-face/.test(skinCss)) warnings.push('skin.css 无 @font-face')

  // --- token 覆盖率 ---
  const definedTokens = new Set([...skinCss.matchAll(/(--dsw-[\w-]+|--ds-[\w-]+|--shiki-[\w-]+|--aion-[\w-]+|--dsh-[\w-]+)\s*:/g)].map((m) => m[1]))
  const missingCritical = CRITICAL.filter((t) => !definedTokens.has(t))
  for (const t of missingCritical) errors.push(`缺少承重 token ${t}`)
  const covered = [...registryTokens].filter((t) => definedTokens.has(t)).length
  if (covered / registryTokens.size < 0.35) {
    warnings.push(`官方 token 覆盖率偏低: ${covered}/${registryTokens.size}`)
  }

  // --- 亮暗双模都必须给出 token（暗模靠 body[data-ds-dark-theme] 覆盖）---
  for (const t of CRITICAL) {
    const count = [...skinCss.matchAll(new RegExp(`${t}\\s*:`, 'g'))].length
    if (count === 1) errors.push(`${t} 只声明了一次 —— 亮暗双模需各给一份`)
  }

  // --- 设计系统复核（直接读源配色重算）---
  const paletteFile = join(root, 'src', 'palettes', `${id.replace(/^pixel-/, '')}.json`)
  if (existsSync(paletteFile)) {
    const palette = JSON.parse(readFileSync(paletteFile, 'utf8'))
    const { errors: aerr, warnings: awarn } = audit(palette)
    errors.push(...aerr)
    warnings.push(...awarn)
    for (const mode of ['dark', 'light']) {
      const m = palette[mode]
      console.log(
        `  ${mode.padEnd(5)} 正文 ${contrast(m.ink, m.surface[0]).toFixed(2)}:1  ` +
          `主按钮 ${contrast(m.accentFg, m.accent).toFixed(2)}:1  ` +
          `强调/底 ${contrast(m.accent, m.surface[0]).toFixed(2)}:1`,
      )
    }
  } else {
    warnings.push(`找不到源配色 ${paletteFile}，跳过设计系统复核`)
  }

  // --- 体积 ---
  const sum = (d) =>
    readdirSync(d, { withFileTypes: true }).reduce(
      (acc, e) => acc + (e.isDirectory() ? sum(join(d, e.name)) : statSync(join(d, e.name)).size),
      0,
    )
  console.log(`  体积 ${(sum(dir) / 1024 / 1024).toFixed(2)}MB   token ${definedTokens.size} 个`)
  console.log(`  官方 token 覆盖 ${covered}/${registryTokens.size}`)

  for (const e of errors) console.log(`  ✗ ${e}`)
  for (const w of warnings) console.log(`  ! ${w}`)
  if (errors.length === 0) console.log(`  ✓ 通过${warnings.length === 0 ? '（零告警）' : `（${warnings.length} 条告警）`}`)
  totalErrors += errors.length
  totalWarnings += warnings.length
}

console.log(`\n合计：${ids.length} 个皮肤，${totalErrors} 错误 / ${totalWarnings} 告警`)
if (totalErrors > 0) process.exit(1)