/**
 * 色相分区图：把一张 PNG 按网格降采样，逐格判定主色属于哪个族，打印成字符地图。
 *
 * 为什么需要它：用户反馈「侧栏底色还是蓝的」，但我这边的实测（皮肤产物 + 运行实例）
 * 都显示侧栏是主题绿。整个画面的平均色相会被文字、边框、任务栏稀释，无法定位；
 * 只有把画面分成网格、逐格判色，才能看出「哪一块不是我配色里的颜色」。
 * 逐格判定用**与调色板的距离**：给出参考色，格子最接近哪个参考色就标成哪个字母，
 * 都不接近则标 ?（即「不属于本皮肤色调」的区域，正是要找的东西）。
 *
 * 用法: node tools/hue-map.mjs <png> [列数] [参考色=字母,...]
 *   例: node tools/hue-map.mjs shot.png 60
 */

import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const file = process.argv[2]
const cols = Number(process.argv[3] ?? 60)
if (!file) throw new Error('用法: node tools/hue-map.mjs <png> [列数]')

// 参考色：掌机绿亮色四档 + 深色档，外加冷白/青作对照
const REFS = [
  ['#c2d4a8', 'a', 's0 黄绿'],
  ['#d2e0bc', 'b', 's1 黄绿'],
  ['#e4eed4', 'c', 's2 黄绿'],
  ['#f6faf0', 'd', 's3 暖白'],
  ['#0f380f', 'D', '暗绿'],
  ['#275727', 'E', '暗绿'],
  ['#306230', 'F', '暗绿'],
  ['#c9e6b2', 'G', '亮绿字'],
  ['#9bbc0f', 'H', '强调黄绿'],
  ['#e0f8f8', 'X', '青白（非本配色）'],
  ['#d0e0f0', 'Y', '淡蓝（非本配色）'],
  ['#ffffff', 'W', '纯白'],
  ['#000000', 'K', '黑'],
]

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const refs = REFS.map(([hex, ch, name]) => ({ ch, name, rgb: hex2rgb(hex) }))

// ---- 最小 PNG 解码（8 位、非隔行、colorType 2/6）----
const buf = readFileSync(file)
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
let pos = 8
let w = 0
let h = 0
let bitDepth = 0
let colorType = 0
const idat = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  const data = buf.subarray(pos + 8, pos + 8 + len)
  if (type === 'IHDR') {
    w = data.readUInt32BE(0)
    h = data.readUInt32BE(4)
    bitDepth = data[8]
    colorType = data[9]
    if (data[12] !== 0) throw new Error('不支持隔行 PNG')
  } else if (type === 'IDAT') idat.push(data)
  else if (type === 'IEND') break
  pos += 12 + len
}
if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
  throw new Error(`只支持 8 位 RGB/RGBA，实际 bitDepth=${bitDepth} colorType=${colorType}`)
}
const ch = colorType === 6 ? 4 : 3
const raw = inflateSync(Buffer.concat(idat))
const stride = w * ch
const px = Buffer.alloc(h * stride)
for (let y = 0; y < h; y += 1) {
  const ft = raw[y * (stride + 1)]
  const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
  const out = px.subarray(y * stride, (y + 1) * stride)
  const prev = y ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
  for (let x = 0; x < stride; x += 1) {
    const a = x >= ch ? out[x - ch] : 0
    const b = prev[x]
    const c = x >= ch ? prev[x - ch] : 0
    let v = line[x]
    if (ft === 1) v += a
    else if (ft === 2) v += b
    else if (ft === 3) v += (a + b) >> 1
    else if (ft === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    out[x] = v & 0xff
  }
}
console.log(`文件 ${file}\n尺寸 ${w}x${h}  colorType=${colorType}\n`)

// ---- 分格取均值并分类 ----
const rows = Math.max(8, Math.round((cols * h) / w / 2))
const tally = new Map()
console.log(`色相图（${cols} 列 x ${rows} 行，每格取区域均值后按「离哪个参考色最近」判定）：`)
for (let gy = 0; gy < rows; gy += 1) {
  let line = ''
  for (let gx = 0; gx < cols; gx += 1) {
    const x0 = Math.floor((gx * w) / cols)
    const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / cols))
    const y0 = Math.floor((gy * h) / rows)
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / rows))
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const o = y * stride + x * ch
        r += px[o]
        g += px[o + 1]
        b += px[o + 2]
        n += 1
      }
    }
    r /= n
    g /= n
    b /= n
    let best = null
    let bestD = Infinity
    for (const ref of refs) {
      const d = (r - ref.rgb[0]) ** 2 + (g - ref.rgb[1]) ** 2 + (b - ref.rgb[2]) ** 2
      if (d < bestD) {
        bestD = d
        best = ref
      }
    }
    // 距离太大就说明这一格不属于本皮肤的任何色调
    const ch2 = bestD > 3600 ? '?' : best.ch
    line += ch2
    const key = ch2 === '?' ? `? 非本配色 (如 rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)}))` : `${ch2} ${best.name}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  console.log(`  ${line}`)
}
console.log('\n图例统计（格数）：')
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`)
}
console.log('\n参考色：' + REFS.map(([hex, c2, n]) => `${c2}=${hex} ${n}`).join('  '))
