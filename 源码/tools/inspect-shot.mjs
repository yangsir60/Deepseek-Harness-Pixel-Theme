/**
 * 逐像素核对截图：自己解码 PNG，输出统计数据 + 亮度 ASCII 图 + 主色直方图。
 *
 * 用法: node tools/inspect-shot.mjs <png> [列数] [行数]
 *
 * 为什么需要它：视觉模型与取色工具可能把整图缩成极小缩略图（例如 64×40），
 * UI 的文字与 1px 边框会被平均掉，于是「有内容的截图」被误判成纯色空场。
 * 本工具不缩放：直接解 PNG 像素，既给出真实的亮暗分布，也用一张 ASCII
 * 灰度图把版面结构以纯文本呈现出来——不依赖任何视觉后端。
 *
 * 只支持 8 位非隔行的 RGB / RGBA / 灰度 PNG（Chromium 截图即为此格式）。
 */

import { inflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const cols = Number(process.argv[3] ?? 96)
const rows = Number(process.argv[4] ?? 34)
if (!file) throw new Error('用法: node tools/inspect-shot.mjs <png> [列数] [行数]')

const buf = readFileSync(file)
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件')

/** 收集 IDAT 并解析 IHDR */
let pos = 8
let width = 0
let height = 0
let colorType = 0
let bitDepth = 0
let interlace = 0
const idat = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  const data = buf.subarray(pos + 8, pos + 8 + len)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0)
    height = data.readUInt32BE(4)
    bitDepth = data[8]
    colorType = data[9]
    interlace = data[12]
  } else if (type === 'IDAT') {
    idat.push(data)
  } else if (type === 'IEND') break
  pos += 12 + len
}
if (bitDepth !== 8 || interlace !== 0) throw new Error(`不支持 bitDepth=${bitDepth} interlace=${interlace}`)

const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
if (!channels) throw new Error(`不支持的 colorType=${colorType}`)

const raw = inflateSync(Buffer.concat(idat))
const stride = width * channels
const px = Buffer.alloc(height * stride)

/** PNG 逐行反滤波（None / Sub / Up / Average / Paeth） */
const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
for (let y = 0; y < height; y += 1) {
  const filter = raw[y * (stride + 1)]
  const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
  const out = px.subarray(y * stride, (y + 1) * stride)
  const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null
  for (let i = 0; i < stride; i += 1) {
    const a = i >= channels ? out[i - channels] : 0
    const b = prev ? prev[i] : 0
    const c = prev && i >= channels ? prev[i - channels] : 0
    const x = line[i]
    out[i] = filter === 0 ? x
      : filter === 1 ? (x + a) & 255
      : filter === 2 ? (x + b) & 255
      : filter === 3 ? (x + ((a + b) >> 1)) & 255
      : filter === 4 ? (x + paeth(a, b, c)) & 255
      : (() => { throw new Error(`未知滤波类型 ${filter} 于第 ${y} 行`) })()
  }
}

/** 累积统计 */
const lum = (i) => {
  const r = px[i]
  const g = px[i + 1]
  const b = px[i + 2]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
let min = 255
let max = 0
let sum = 0
let bright = 0
const hist = new Map()
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = y * stride + x * channels
    const l = lum(i)
    if (l < min) min = l
    if (l > max) max = l
    sum += l
    if (l > 100) bright += 1
    if (hist.size < 4096) {
      const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3)
      hist.set(key, (hist.get(key) ?? 0) + 1)
    }
  }
}

const total = width * height
console.log(`文件   : ${file}`)
console.log(`尺寸   : ${width}x${height}  colorType=${colorType} 通道=${channels}`)
console.log(`亮度   : min=${min.toFixed(1)} max=${max.toFixed(1)} 平均=${(sum / total).toFixed(1)}`)
console.log(`亮像素 : ${bright} / ${total}  (${((bright / total) * 100).toFixed(2)}% 亮度>100)`)

/** ---- 锐度：判断像素字有没有被非整数倍缩放糊掉 --------------------------
    像素字清晰的标志是「字色与底色两种像素，中间没有过渡带」；一旦被非整数倍
    缩放，每条笔画边缘都会散出一圈中间灰。所以取文本像素中「接近字色」的比例
    作为锐度，并数一下实际用到的灰度级数 —— 发虚的渲染级数会明显变多。
    区域可用 --box=x0,y0,x1,y1 限定到文字密集处。
    注意：这是「同一界面两次构建」的相对比较指标，不是绝对值。 */
const boxArg = process.argv.find((a) => a.startsWith('--box='))
const box = boxArg ? boxArg.slice('--box='.length).split(',').map(Number) : [0, 0, width, height]
const bx0 = Math.max(0, box[0])
const by0 = Math.max(0, box[1])
const bx1 = Math.min(width, box[2])
const by1 = Math.min(height, box[3])

const bins = new Array(256).fill(0)
for (let y = by0; y < by1; y += 1) {
  for (let x = bx0; x < bx1; x += 1) bins[Math.round(lum(y * stride + x * channels))] += 1
}
let modeBin = 0
for (let i = 1; i < 256; i += 1) if (bins[i] > bins[modeBin]) modeBin = i
let inkBin = 255
while (inkBin > 0 && bins[inkBin] === 0) inkBin -= 1
const span = Math.max(1, inkBin - modeBin)
// 只统计「明显属于文字」的上半带。底色渐变（CRT 暗角、扫描线）会撒出大量中间
// 灰，若把背景也算进来，指标会被渐变淹没 —— 初版正是踩了这个坑：改前改后都读
// 出 11.7%，看似没变。上半带对背景渐变不敏感，只反映笔画的抗锯齿程度。
const bandGate = modeBin + span * 0.45
const solidAt = modeBin + span * 0.72
let textN = 0
let solidN = 0
const levels = new Set()
for (let y = by0; y < by1; y += 1) {
  for (let x = bx0; x < bx1; x += 1) {
    const l = Math.round(lum(y * stride + x * channels))
    if (l < bandGate) continue
    textN += 1
    levels.add(l)
    if (l >= solidAt) solidN += 1
  }
}
const pct = (v) => (textN ? ((v / textN) * 100).toFixed(1) : '0.0')
console.log(`\n锐度（区域 x${bx0}-${bx1} y${by0}-${by1}）`)
console.log(`  底色 ${modeBin} ／ 字色 ${inkBin} ／ 字色带像素 ${textN}`)
console.log(`  实心占比 ${pct(solidN)}%   ← 越高越锐利`)
console.log(`  字色带灰度级数 ${levels.size}   ← 越少越锐利（理想是个位数到几十）`)

const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
console.log('主色   :')
for (const [key, count] of top) {
  const r = ((key >> 10) & 31) << 3
  const g = ((key >> 5) & 31) << 3
  const b = (key & 31) << 3
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  console.log(`  ${hex}  ${((count / total) * 100).toFixed(2)}%`)
}

/** 色相族统计：量化强调色用量，并捕捉任何不属于本配色的杂色。
    这是设计核对的主力指标 —— 强调色应当「少而准」，一旦出现本当没有的
    色相族（例如官方品牌蓝漏过 token 重映射），这里会立刻显形。 */
const hueOf = (r, g, b) => {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  if (mx - mn < 22) return '中性'
  let h
  if (mx === r) h = ((g - b) / (mx - mn)) * 60
  else if (mx === g) h = (2 + (b - r) / (mx - mn)) * 60
  else h = (4 + (r - g) / (mx - mn)) * 60
  if (h < 0) h += 360
  if (h < 20 || h >= 340) return '红'
  if (h < 60) return '琥珀橙'
  if (h < 100) return '黄绿'
  if (h < 165) return '绿'
  if (h < 205) return '青'
  if (h < 265) return '蓝'
  if (h < 300) return '紫'
  return '品红'
}
const FAMILIES = ['中性', '琥珀橙', '黄绿', '绿', '青', '蓝', '紫', '品红', '红']
const allFam = {}
const litFam = {}
const satFam = {}
const litBounds = {}
for (const f of FAMILIES) {
  allFam[f] = 0
  litFam[f] = 0
  satFam[f] = 0
}
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = y * stride + x * channels
    const r = px[i]
    const g = px[i + 1]
    const b = px[i + 2]
    const fam = hueOf(r, g, b)
    allFam[fam] += 1
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    // 高饱和 = 真正的强调色；低饱和同色相多是暖色正文（例如米色 #f2e6cd）
    if (mx - mn >= 60 && mx >= 110) satFam[fam] += 1
    if (lum(i) > 80) {
      litFam[fam] += 1
      const cur = litBounds[fam]
      if (!cur) litBounds[fam] = { x0: x, y0: y, x1: x, y1: y, n: 1 }
      else {
        cur.x0 = Math.min(cur.x0, x)
        cur.y0 = Math.min(cur.y0, y)
        cur.x1 = Math.max(cur.x1, x)
        cur.y1 = Math.max(cur.y1, y)
        cur.n += 1
      }
    }
  }
}
console.log('\n色相族（全图占比 / 亮度>80 且高饱和的显色像素）:')
for (const f of FAMILIES) {
  const a = allFam[f]
  const l = litFam[f]
  if (a === 0 && l === 0) continue
  const box = litBounds[f]
  const where = box ? `  范围 x${box.x0}-${box.x1} y${box.y0}-${box.y1}` : ''
  console.log(
    `  ${f.padEnd(4)} 全图 ${((a / total) * 100).toFixed(2).padStart(6)}%   高饱和 ${satFam[f].toString().padStart(6)} px${where}`,
  )
}

/** 强调色落点图：只标出「高饱和暖色」像素（强调色），一眼看清强调是否克制、
    以及落在哪些控件上。低饱和的同色相像素是暖色正文，不计入。 */
const ramp = ' .:-=+*#%@'
const cw = width / cols
const ch = height / rows
const header = '    ' + Array.from({ length: cols }, (_, i) => (i % 10 === 0 ? String((i / 10) % 10) : ' ')).join('')
console.log('\n强调色落点（高饱和暖色像素密度，空格=无）:')
console.log(header)
for (let r = 0; r < rows; r += 1) {
  let line = ''
  for (let c = 0; c < cols; c += 1) {
    let n = 0
    const x0 = Math.floor(c * cw)
    const x1 = Math.max(x0 + 1, Math.floor((c + 1) * cw))
    const y0 = Math.floor(r * ch)
    const y1 = Math.max(y0 + 1, Math.floor((r + 1) * ch))
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = y * stride + x * channels
        const rr = px[i]
        const gg = px[i + 1]
        const bb = px[i + 2]
        const mx = Math.max(rr, gg, bb)
        const mn = Math.min(rr, gg, bb)
        if (mx - mn >= 60 && mx >= 110 && (rr === mx || (gg === mx && bb < gg))) n += 1
      }
    }
    line += n === 0 ? ' ' : ramp[Math.min(ramp.length - 1, 1 + Math.floor(Math.log2(n + 1)))]
  }
  console.log(`${String(r).padStart(3)} ${line}`)
}

/** 亮度 ASCII 图：不缩放判断内容，只用于把版面结构变成可读文本 */
console.log(`\n亮度图 ${cols}x${rows}（每格为区域平均亮度，空格=最暗 @=最亮）:`)
console.log(header)
for (let r = 0; r < rows; r += 1) {
  let line = ''
  for (let c = 0; c < cols; c += 1) {
    let acc = 0
    let n = 0
    const x0 = Math.floor(c * cw)
    const x1 = Math.max(x0 + 1, Math.floor((c + 1) * cw))
    const y0 = Math.floor(r * ch)
    const y1 = Math.max(y0 + 1, Math.floor((r + 1) * ch))
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        acc += lum(y * stride + x * channels)
        n += 1
      }
    }
    const v = n > 0 ? acc / n : 0
    const idx = Math.min(ramp.length - 1, Math.round((v / 255) ** 0.6 * (ramp.length - 1)))
    line += ramp[idx]
  }
  console.log(`${String(r).padStart(3)} ${line}`)
}

/** 逐像素灰度图：1 个字符 = 1 个设备像素，不缩放、不平均。
    这是唯一能直接看出「笔画是整数像素的方块，还是被重采样糊成过渡带」的办法。
    用法: --crop=x,y,w,h */
const cropArg = process.argv.find((a) => a.startsWith('--crop='))
if (cropArg) {
  const [cx, cy, cw, chh] = cropArg.slice('--crop='.length).split(',').map(Number)
  console.log(`\n逐像素灰度图 (${cx},${cy}) ${cw}x${chh}  「1 字符 = 1 设备像素」:`)
  for (let y = cy; y < cy + chh && y < height; y += 1) {
    let line = ''
    for (let x = cx; x < cx + cw && x < width; x += 1) {
      const l = lum(y * stride + x * channels)
      line += ramp[Math.min(ramp.length - 1, Math.round((l / 255) ** 0.7 * (ramp.length - 1)))]
    }
    console.log(String(y).padStart(4) + ' ' + line)
  }
}