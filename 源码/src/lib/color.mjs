/**
 * 极简色彩工具：十六进制解析、混色、明度调整、透明度。
 * 输出统一使用 8 位十六进制 (#rrggbbaa)，Chromium 全支持且比 rgba() 短。
 */

/** '#rgb' / '#rrggbb' / '#rrggbbaa' -> [r, g, b, a(0..1)] */
export function parse(input) {
  let s = String(input).trim().replace(/^#/, '')
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('')
  if (s.length === 6) s += 'ff'
  if (s.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(s)) {
    throw new Error(`无法解析颜色: ${input}`)
  }
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
    parseInt(s.slice(6, 8), 16) / 255,
  ]
}

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)))
const hx = (n) => clamp255(n).toString(16).padStart(2, '0')

/** [r,g,b] + a -> '#rrggbbaa' */
export function toHex(rgb, a = 1) {
  return `#${hx(rgb[0])}${hx(rgb[1])}${hx(rgb[2])}${hx(clamp255(a * 255))}`
}

/** 线性混色：t=0 取 a，t=1 取 b。alpha 亦按 t 插值。 */
export function mix(a, b, t) {
  const A = parse(a)
  const B = parse(b)
  return toHex(
    [
      A[0] + (B[0] - A[0]) * t,
      A[1] + (B[1] - A[1]) * t,
      A[2] + (B[2] - A[2]) * t,
    ],
    A[3] + (B[3] - A[3]) * t,
  )
}

/** 向白提亮（保持 alpha） */
export const lighten = (c, t) => mix(c, '#ffffff', t)

/** 向黑压暗（保持 alpha） */
export const darken = (c, t) => mix(c, '#000000', t)

/** 替换 alpha，保留色彩 */
export function alpha(c, a) {
  const [r, g, b] = parse(c)
  return toHex([r, g, b], a)
}

/** 在指定底色上叠加一个半透明前景后的等效不透明色 */
export function over(fg, bg) {
  const F = parse(fg)
  const B = parse(bg)
  const a = F[3]
  return toHex([
    F[0] * a + B[0] * (1 - a),
    F[1] * a + B[1] * (1 - a),
    F[2] * a + B[2] * (1 - a),
  ])
}

/** WCAG 相对亮度 */
export function luminance(c) {
  const [r, g, b] = parse(c)
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG 2.x 对比度（1..21） */
export function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}