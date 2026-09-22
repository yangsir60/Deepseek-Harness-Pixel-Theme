/**
 * 设计系统 → 官方 token 的派生器。
 *
 * 这是整套主题「层次清晰」的实现方式：皮肤作者只决定约 16 个语义颜色，
 * 剩余 ~110 个官方 token 全部由固定关系式推导。于是：
 *   - 三个配色自动共享同一套层次结构（不会出现某个配色层次糊掉）；
 *   - 明暗两模共用一条不变量：抬升层级越高 → 底色越亮、边框越亮、硬阴影偏移越大；
 *   - 硬阴影与零模糊是像素语言的物理规则，也从这里统一注入。
 */

import { alpha, contrast, darken, lighten, mix, parse } from './color.mjs'

/** HSL 风格的感知明度（0..1），用于校验层次梯级。 */
export function lightness(c) {
  const [r, g, b] = parse(c)
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255
}

/**
 * 硬阴影：无模糊，纯二维位移。
 * 档位与自建像素 UI 对齐 —— 控件 2px、菜单 4px、模态 8px；
 * 按下时控件整体位移同样的距离并收拢投影，这就是「按下去」的手感来源。
 */
const hardShadow = (ink, d) => `${d}px ${d}px 0 0 ${alpha(ink, d >= 8 ? 0.62 : d >= 4 ? 0.55 : 0.5)}`

/**
 * 由一份模式调色板推导全部 token。
 * @param {object} m 形如 palette.modes.dark / palette.modes.light
 * @returns {Array<[string, string]>} 有序的 [tokenName, value] 列表
 */
export function buildTokens(m) {
  const [s0, s1, s2, s3] = m.surface
  const ink = m.ink
  const inkDim = m.inkDim
  const inkMute = m.inkMute
  const { accent, accentFg, accent2, success, warn, error, shadowInk } = m

  // 反色面（在深色底上要用浅色文字之类的场景）
  const inverted = m.inverted
  const invertedFg = m.invertedFg

  // 代码块是「凹陷面」：比最底层面再退半步
  const recessed = mix(s0, shadowInk, 0.28)
  const codeBlock = recessed

  const t = []
  const add = (name, value) => t.push([name, value])

  // ---- 面（层次骨架）-----------------------------------------------
  add('--dsw-alias-bg-base', s0)
  add('--dsw-alias-bg-layer-1', s1)
  add('--dsw-alias-bg-layer-2', s2)
  add('--dsw-alias-bg-layer-3', s3)
  add('--dsw-alias-bg-overlay', s3)
  add('--dsw-alias-bg-module-platform', s1)
  add('--dsw-alias-bg-multi-select', m.select ?? s1)
  add('--dsw-alias-bg-skeleton', alpha(ink, 0.07))

  // 遮蔽层（模态背后的纱）
  add('--dsw-alias-bg-mask-1', alpha(shadowInk, 0.28))
  add('--dsw-alias-bg-mask-2', alpha(shadowInk, 0.16))
  add('--dsw-alias-bg-mask-3', alpha(shadowInk, 0.5))
  add('--dsw-alias-bg-mask-photo', alpha(shadowInk, 0.88))
  add('--dsw-alias-bg-mask-drop', alpha(inverted, 0.7))

  // ---- 边框（层次第二重：越往上越亮）-------------------------------
  // 参考配方的关键是「描边可见」：不是淡淡的一层 alpha，而是一个真正的
  // 中间色（如 #3a5585），控件再加 2px 描边才有明确的边界感。
  const edge = m.border ?? mix(ink, s0, 0.5)
  add('--dsw-alias-border-l1', alpha(edge, 0.44))
  add('--dsw-alias-border-l2-darkmode-thin', alpha(edge, 0.42))
  add('--dsw-alias-border-l2', alpha(edge, 0.56))
  add('--dsw-alias-border-l3', edge)
  add('--dsw-alias-border-l4', lighten(edge, 0.18))
  add('--dsw-alias-border-inverted', alpha(inverted, 0.1))
  add('--dsw-alias-border-inverted2', alpha(inverted, 0.16))
  add('--dsw-alias-line-secondary', alpha(edge, 0.45))
  add('--dsw-alias-separator-primary', alpha(edge, 0.32))

  // 皮肤自用：焦点环 / 选中填充 / 描边本色。放在 token 层是为了让三套配色
  // 各自给出合适的值，patches.css 只消费、不写死颜色。
  add('--pr-focus', m.focus ?? accent)
  add('--pr-select', m.select ?? accent2)
  add('--pr-edge', edge)

  // ---- 品牌 / 强调（吝啬即重量：全卡唯一交互强调色）----------------
  add('--dsw-alias-brand-primary', accent)
  add('--dsw-alias-brand-primary-invert', accentFg)
  add('--dsw-alias-brand-primary-new-colorprimary-new-color', accent)
  add('--dsw-alias-brand-text', accent)

  // ---- 主按钮四件套（契约：必须成组，且对比度 ≥3:1）----------------
  add('--dsw-alias-button-primary-fill', accent)
  add('--dsw-alias-button-primary-hover', lighten(accent, 0.14))
  add('--dsw-alias-button-primary-dimmed', alpha(accent, 0.42))
  add('--dsw-alias-label-primary-foreground', accentFg)

  // ---- 按钮族 -------------------------------------------------------
  add('--dsw-alias-button-contrast-fill', inverted)
  add('--dsw-alias-button-elevated-fill', s2)
  add('--dsw-alias-button-floating-fill', s2)
  add('--dsw-alias-button-floating-hover', s3)
  add('--dsw-alias-button-ghost-active-fill', alpha(ink, 0.09))
  add('--dsw-alias-button-ghost-active-hover', alpha(ink, 0.14))
  add('--dsw-alias-button-ghost-active-border', alpha(ink, 0.32))
  add('--dsw-alias-button-info-fill', accent2)
  add('--dsw-alias-button-info-hover', lighten(accent2, 0.14))
  add('--dsw-alias-button-tool-bar-fill', alpha(ink, 0.5))
  add('--dsw-alias-button-tool-bar-fill-invisible', alpha(ink, 0.34))
  add('--dsw-alias-button-tool-bar-hover', alpha(ink, 0.62))

  // ---- 交互态 -------------------------------------------------------
  add('--dsw-alias-interactive-bg-hover', alpha(ink, 0.08))
  add('--dsw-alias-interactive-bg-active', alpha(ink, 0.13))
  add('--dsw-alias-interactive-bg-hover-solid', s3)
  add('--dsw-alias-interactive-bg-hover-accent', m.select ?? alpha(accent, 0.16))
  add('--dsw-alias-interactive-bg-hover-danger', alpha(error, 0.16))

  // ---- 文字（明度即层级：四级阶梯）--------------------------------
  add('--dsw-alias-label-primary', ink)
  add('--dsw-alias-label-primary-bluish', mix(ink, accent, 0.12))
  add('--dsw-alias-label-primary-dimmed', inkDim)
  add('--dsw-alias-label-primary-inverted', invertedFg)
  add('--dsw-alias-label-secondary', inkDim)
  add('--dsw-alias-label-tertiary', inkMute)
  // 第四级文字：官方用它承载输入框占位符、区块小标题这类「最淡但不是禁用」的文字。
  // 像素字体的笔画只有一个像素宽，抗锯齿会把它整体拉淡，所以这一档得比常规设计
  // 系统更亮；而 label-dimmed 更不能往底色方向混太多 —— 混多了在亮色下就变成
  // 「灰字压浅底」（实测只有 4.42:1），这正是用户说的「看不清」。
  // 门槛取 WCAG AA 对正文的 4.5:1，且要按更高的面（surface[2]/[3]）算，不能只按底。
  add('--dsw-alias-label-quaternary', darken(inkMute, 0.05))
  add('--dsw-alias-label-caption', inkMute)
  add('--dsw-alias-label-dimmed', mix(inkMute, s0, 0.04))

  // ---- 状态色（独立色相，绝不拿强调色顶替）------------------------
  add('--dsw-alias-state-business-primary', accent)
  add('--dsw-alias-state-business-subtle', alpha(accent, 0.2))
  add('--dsw-alias-state-business-tertiary', alpha(accent, 0.12))
  add('--dsw-alias-state-success-primary', success)
  add('--dsw-alias-state-success-secondary', alpha(success, 0.2))
  add('--dsw-alias-state-success-tertiary', alpha(success, 0.12))
  add('--dsw-alias-state-warn-primary', warn)
  add('--dsw-alias-state-warn-label', lighten(warn, 0.3))
  add('--dsw-alias-state-warn-secondary', alpha(warn, 0.2))
  add('--dsw-alias-state-warn-tertiary', alpha(warn, 0.12))
  add('--dsw-alias-state-warning-primary', warn)
  add('--dsw-alias-state-error-primary', error)
  add('--dsw-alias-state-error-secondary', alpha(error, 0.2))

  // ---- Markdown（代码块是凹陷面）----------------------------------
  add('--dsw-alias-markdown-code-block', codeBlock)
  add('--dsw-alias-markdown-code-block-banner', s1)
  add('--dsw-alias-markdown-inline-code', alpha(ink, 0.1))
  add('--dsw-alias-markdown-tag', alpha(accent2, 0.55))
  add('--dsw-alias-markdown-placeholder', inkMute)
  add('--dsw-alias-markdown-citation', s1)
  add('--dsw-alias-markdown-code-segment-selected', alpha(ink, 0.14))
  add('--dsw-alias-markdown-code-segment-unselected', alpha(ink, 0.05))

  // ---- 滚动条 -------------------------------------------------------
  add('--dsw-alias-scrollbar-bg-l1', alpha(ink, 0.04))
  add('--dsw-alias-scrollbar-bg-l2', alpha(ink, 0.04))
  add('--dsw-alias-scrollbar-hover-l1', alpha(ink, 0.3))
  add('--dsw-alias-scrollbar-hover-l2', alpha(ink, 0.3))

  // ---- 浮层表面 -----------------------------------------------------
  add('--dsw-alias-toast-bg', s3)
  add('--dsw-alias-tooltip-bg', s3)
  add('--dsw-alias-tooltip-fg', ink)

  // ---- 悬浮卡与思考态梯度 -------------------------------------------
  // 注: hovercard 的底色被官方硬编码在组件元素上 (--dsw-hovercard-bg:#2C2C2E)
  // 且配套 color:#fff —— 该组件本就设计为深色芯片, 故不覆盖; 其阴影走
  // --dsw-shadow-lv3, 已自动继承本主题的硬阴影。
  add('--dsw-hovercard-bg', s3)
  // 思考态梯度: 官方预留 token (当前 dist 未消费)。若被启用,
  // 用硬分段而非平滑过渡, 与像素语言一致。
  add(
    '--dsw-linear-gradient-think',
    `linear-gradient(90deg, ${accent2} 0 20%, ${accent} 20% 45%, ${accent2} 45% 70%, ${accent} 70% 100%)`,
  )
  add('--dsw-linear-think-select', accent)

  // ---- 具名表面 -----------------------------------------------------
  add('--dsw-specific-bubble', s2)
  add('--dsw-specific-bubble-highlight', s3)
  add('--dsw-specific-sidebar-fill', s1)
  add('--dsw-specific-sidebar-nav-item-hover', alpha(ink, 0.07))
  add('--dsw-specific-sidebar-nav-item-active', alpha(accent, 0.18))
  add('--dsw-specific-sidebar-nav-item-active-accent', accent)
  add('--dsw-specific-menu', s3)
  add('--dsw-specific-selector', s3)
  add('--dsw-specific-tip', s3)
  add('--dsw-specific-input-major', s1)
  add('--dsw-specific-login-input', s1)

  // ---- 阴影：全部硬阴影，零模糊 ------------------------------------
  add('--dsw-shadow-lv1', hardShadow(shadowInk, 2))
  add('--dsw-shadow-lv1-blur', '0px')
  add('--dsw-shadow-lv2', hardShadow(shadowInk, 4))
  add('--dsw-shadow-lv3', hardShadow(shadowInk, 8))
  add('--dsw-mask-blur', '0px')

  // ---- 代码高亮面 ---------------------------------------------------
  add('--shiki-background', codeBlock)
  add('--shiki-foreground', ink)
  add('--dsh-scrollbar-thumb', alpha(ink, 0.22))
  add('--dsh-scrollbar-thumb-hover', alpha(ink, 0.36))

  // ---- 旧版 aion 变量（仍在被消费，保持覆盖）----------------------
  add('--aion-bg-base', s0)
  add('--aion-bg-1', s1)
  add('--aion-bg-2', s2)
  add('--aion-bg-3', s3)
  add('--aion-bg-4', alpha(ink, 0.3))
  add('--aion-bg-hover', alpha(ink, 0.08))
  add('--aion-bg-active', alpha(ink, 0.14))
  add('--aion-text-primary', ink)
  add('--aion-text-secondary', inkDim)
  add('--aion-text-tertiary', inkMute)
  add('--aion-text-disabled', mix(inkMute, s0, 0.4))
  add('--aion-primary', accent)
  add('--aion-success', success)
  add('--aion-warning', warn)
  add('--aion-danger', error)
  add('--aion-brand', accent2)
  add('--aion-aou-1', mix(s1, accent, 0.05))
  add('--aion-aou-2', mix(s2, accent, 0.08))
  add('--aion-aou-3', mix(s3, accent, 0.12))
  add('--aion-aou-4', mix(s3, accent, 0.2))
  add('--aion-aou-5', accent)
  add('--aion-aou-6', lighten(accent, 0.3))
  add('--aion-fill-2', s2)
  add('--aion-fill-3', s3)
  add('--aion-border-base', alpha(ink, 0.18))
  add('--aion-overlay-shadow', hardShadow(shadowInk, 4))
  add('--aion-font-sans', 'var(--pr-ui)')
  add('--aion-font-mono', 'var(--pr-mon)')

  return t
}

/**
 * 设计系统不变量校验。返回 { errors, warnings }。
 * 这是「层次清晰」的可测保证：梯级必须单调且步长足够。
 */
export function audit(palette) {
  const errors = []
  const warnings = []
  const all = palette.modes ?? palette

  for (const mode of ['dark', 'light']) {
    const m = all[mode]
    if (!m) {
      errors.push(`[${mode}] 缺少调色板`)
      continue
    }
    const tag = `[${mode}]`

    if (!Array.isArray(m.surface) || m.surface.length !== 4) {
      errors.push(`${tag} surface 必须是 4 个颜色`)
      continue
    }

    // 不变量 1：抬升梯级单调递增，且相邻步长足够（否则层次糊掉）
    const ls = m.surface.map(lightness)
    for (let i = 1; i < ls.length; i += 1) {
      const d = ls[i] - ls[i - 1]
      if (d <= 0) {
        errors.push(
          `${tag} 层次梯级非单调: ${m.surface[i - 1]}(${ls[i - 1].toFixed(3)}) → ` +
            `${m.surface[i]}(${ls[i].toFixed(3)})`,
        )
      } else if (d < 0.02) {
        warnings.push(
          `${tag} 层次步长偏小 (ΔL=${d.toFixed(3)}): ${m.surface[i - 1]} → ${m.surface[i]}`,
        )
      }
    }

    // 不变量 2：正文对比度（正文目标 7:1，硬底线 4.5:1）
    const inkContrast = contrast(m.ink, m.surface[0])
    if (inkContrast < 4.5) {
      errors.push(`${tag} 正文对比度仅 ${inkContrast.toFixed(2)}:1，低于 4.5:1 硬底线`)
    } else if (inkContrast < 7) {
      warnings.push(`${tag} 正文对比度 ${inkContrast.toFixed(2)}:1，未达 7:1 目标`)
    }

    // 不变量 3：主按钮契约 —— 文字与填充 ≥3:1
    const btn = contrast(m.accentFg, m.accent)
    if (btn < 3) {
      errors.push(
        `${tag} 主按钮对比度仅 ${btn.toFixed(2)}:1（accentFg ${m.accentFg} / accent ${m.accent}），低于契约 3:1`,
      )
    }

    // 不变量 4：强调色本身要能从底色里跳出来
    const accentContrast = contrast(m.accent, m.surface[0])
    if (accentContrast < 3) {
      errors.push(`${tag} 强调色对底色对比度仅 ${accentContrast.toFixed(2)}:1，低于 3:1`)
    }

    // 不变量 5：四级文字阶梯必须真的分层。
    // 判据与明暗方向无关：对底色的对比度必须逐级递减（越次要越贴近底色）。
    const textSteps = [m.ink, m.inkDim, m.inkMute]
    const contrasts = textSteps.map((c) => contrast(c, m.surface[0]))
    for (let i = 1; i < contrasts.length; i += 1) {
      if (contrasts[i] >= contrasts[i - 1]) {
        errors.push(
          `${tag} 文字阶梯对比度未递减: ${contrasts[i - 1].toFixed(2)}:1 → ${contrasts[i].toFixed(2)}:1`,
        )
      }
    }
    if (contrasts[2] < 3) {
      warnings.push(`${tag} 三级文字对比度仅 ${contrasts[2].toFixed(2)}:1，可能过淡`)
    }
  }

  return { errors, warnings }
}