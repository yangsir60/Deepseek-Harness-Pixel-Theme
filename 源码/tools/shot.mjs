/**
 * 生成预览图：驱动真实 GUI（本机 Edge headless），激活皮肤后截亮/暗两模。
 *
 * 用法: node tools/shot.mjs [id]    省略则取 dist 下第一个皮肤
 *
 * 为什么要走真实 GUI 而不是自建静态样张：
 *   皮肤中心把皮肤当「服务端注入的 <link> + <html data-dsh-skin>」下发，官方
 *   的 token 层、语义属性适配器、插件 DOM 都只在真身里齐全。自建 mock 只能
 *   画出近似结构，无法证明皮肤与官方前端真的对得上，因此不作为验收依据。
 *
 * 鉴权：web 服务被「启动令牌 + 签名 cookie」网关挡住（连 / 都 403）。启动令牌是
 * 进程内随机量取不到，但 cookie 的签名密钥持久化在 ~/.dsh/.credentials.yaml，且
 * 算法是公开的 HMAC-SHA256，因此这里就地为本机 authority 签一张有效会话 cookie。
 * 只读取那一条密钥记录，文件中的其它内容（API 密钥）一概不读取、不输出。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// 真正的 dsh web 服务在 3080；43120 是 DSH Desktop 自己的外壳服务（网关不同，
// 不接受 dsh web 的会话 cookie）。可用 --origin= 覆盖。
const originArg = process.argv.find((a) => a.startsWith('--origin='))
const ORIGIN = originArg ? originArg.slice('--origin='.length) : 'http://127.0.0.1:3080'
const AUTHORITY = new URL(ORIGIN).host
const COOKIE_PREFIX = 'dsh-auth-'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const CREDENTIALS = join(process.env.DSH_HOME ?? join(process.env.USERPROFILE, '.dsh'), '.credentials.yaml')

const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

/** 只抽出 client-connection/browser-session 的 secret，绝不读取文件里的其它记录。 */
function sessionSecret() {
  const yaml = readFileSync(CREDENTIALS, 'utf8')
  // 有界匹配：只在该记录名之后 400 字符内找 secret，避免误吞后面 refs 段的内容。
  const block = yaml.match(/client-connection\/browser-session:([\s\S]{0,400})/)
  if (!block) throw new Error('凭据库中没有 client-connection/browser-session 记录')
  const m = block[1].match(/^\s*secret:\s*([A-Za-z0-9_-]{43})\s*$/m)
  if (!m) throw new Error('该记录里没有可用的 secret')
  return Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/') + '=', 'base64')
}

function mintCookie(secret) {
  const name = COOKIE_PREFIX + b64url(createHash('sha256').update(AUTHORITY).digest())
  const now = Date.now()
  const body = b64url(
    Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + 864e5 }), 'utf8'),
  )
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return { name, value: `v1.${body}.${sig}` }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const wanted = process.argv.filter((a) => !a.startsWith('--'))[2]
const ids = readdirSync(join(root, 'dist'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((id) => !wanted || id === wanted)
if (ids.length === 0) throw new Error(`dist 下没有匹配的皮肤（id=${wanted ?? '任意'}）`)

const { name, value } = mintCookie(sessionSecret())
console.log(`会话 cookie: ${name}（已签发，有效 1 天）`)

// 设备像素比必须与真实屏幕一致，否则截图无法用来验证像素字体的清晰度。
// 本机实测 DPR = 1.25（3840x2160，AppliedDPI=120）。曾经的默认值 1 会让
// 10px 设计以 1.6 倍渲染 —— 与真实屏幕上的 2 倍完全不同，等于拿错的条件做验证。
const dprArg = process.argv.find((a) => a.startsWith('--dpr='))
const DPR = Number(dprArg ? dprArg.slice('--dpr='.length) : 1.25)
const VW = 1600
const VH = 1000

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', `--force-device-scale-factor=${DPR}`, '--hide-scrollbars'],
  defaultViewport: { width: VW, height: VH, deviceScaleFactor: DPR },
})
console.log(`设备像素比: ${DPR}（视口 ${VW}x${VH} → 位图 ${VW * DPR}x${VH * DPR}）`)

try {
  const page = await browser.newPage()
  await browser.setCookie({ name, value, url: ORIGIN, httpOnly: true, sameSite: 'Strict' })

  // 收集运行时错误：应用没渲染出来时，原因几乎都在这里
  const logs = []
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`console.${m.type()}: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => logs.push(`pageerror: ${String(e).slice(0, 300)}`))
  page.on('requestfailed', (r) => logs.push(`requestfailed: ${r.url().slice(0, 140)} — ${r.failure()?.errorText}`))

  // 1) 先登录并读到目录，确认皮肤真的被扫到
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const catalog = await page.evaluate(async () => {
    const r = await fetch('/api/skin-center/v2/catalog')
    return { status: r.status, body: r.ok ? await r.json() : await r.text() }
  })
  if (catalog.status !== 200) throw new Error(`catalog 读取失败: ${catalog.status} ${JSON.stringify(catalog.body)}`)

  const found = (catalog.body.skins ?? []).find((s) => s.manifest.id === ids[0])
  console.log(`目录中已发现 ${(catalog.body.skins ?? []).length} 个皮肤`)
  if (!found) throw new Error(`目录里没有 ${ids[0]}`)
  console.log(`  ${found.manifest.id}  ·  origin=${found.origin}`)
  const diags = catalog.body.diagnostics ?? []
  if (diags.length === 0) {
    console.log('  目录诊断：无')
  } else {
    console.log(`  目录诊断：${diags.length} 条`)
    for (const d of diags) console.log(`    ${JSON.stringify(d)}`)
  }

  // 2) 激活。注意：激活是「最后一个生效」——皮肤在页面加载时注入，中途改 active
// 不会换皮肤。所以无参数跑多个 id 时，真正渲染出来的是最后一个，截图目录也必须
// 跟着它走；曾经这里写的是 ids[0]，结果把掌机绿的画面存进了 amber 的目录，
// 按配色读出来的验证数字全部错配。要逐配色验证请显式传 id。
  for (const id of ids) {
    const res = await page.evaluate(async (skinId) => {
      const r = await fetch('/api/skin-center/v2/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: skinId }),
      })
      return { status: r.status, body: await r.text() }
    }, id)
    console.log(`  激活 ${id} -> ${res.status} ${res.body.slice(0, 120)}`)
    if (res.status !== 200) throw new Error(`激活失败：${res.status} ${res.body}`)
  }
  const shotId = ids[ids.length - 1]
  if (ids.length > 1) {
    console.log(`  ⚠ 一次传了 ${ids.length} 个皮肤，只有 ${shotId} 会真正渲染；本次只截它。`)
    console.log('     要逐配色验证请分别执行：node tools/shot.mjs <id>')
  }

  // 3) 重新加载，等皮肤与字体都就位
  await page.goto(ORIGIN, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('html')?.dataset.dshSkin !== undefined, { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  await sleep(1200)

  const state = await page.evaluate(() => {
    const links = [...document.querySelectorAll('link[data-dsh-skin-link]')].map((l) => l.getAttribute('data-dsh-skin-link'))
    const pix = getComputedStyle(document.documentElement).getPropertyValue('--pr-pix').trim()
    const root = document.getElementById('root')
    const bodyBg = getComputedStyle(document.body).backgroundColor
    return {
      skin: document.documentElement.dataset.dshSkin,
      dark: document.body.hasAttribute('data-ds-dark-theme'),
      links,
      pixVar: pix.length > 0,
      pixelLoaded: document.fonts.check('12px "PixelRig Pix"'),
      monoLoaded: document.fonts.check('12px "PixelRig Mono"'),
      surfaces: document.querySelectorAll('[data-dsh-surface]').length,
      rootChildren: root ? root.children.length : -1,
      rootHtmlLength: root ? root.innerHTML.length : -1,
      bodyTextLength: document.body.innerText.trim().length,
      bodyTextSample: document.body.innerText.trim().slice(0, 200).replaceAll('\n', ' / '),
      bodyBg,
      boot: typeof window.__DSH_BOOT__,
    }
  })
  console.log(`  运行态：skin=${state.skin} links=[${state.links}] 语义面=${state.surfaces}`)
  console.log(`  字体：像素体=${state.pixelLoaded} 等宽体=${state.monoLoaded} 变量表=${state.pixVar}`)
  console.log(`  DOM：#root 子节点=${state.rootChildren} innerHTML=${state.rootHtmlLength} 字符`)
  console.log(`  正文：${state.bodyTextLength} 字符  body底色=${state.bodyBg}  __DSH_BOOT__=${state.boot}`)
  if (state.bodyTextSample) console.log(`  正文开头：${state.bodyTextSample}`)

  // 谁盖在最上面：截图若是一片纯色，答案几乎总在这里
  const surfaces = await page.evaluate(() =>
    [...document.querySelectorAll('[data-dsh-surface]')].map((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        surface: el.dataset.dshSurface,
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean)[0] ?? '',
        rect: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`,
        pos: cs.position,
        z: cs.zIndex,
        bg: cs.backgroundColor,
        op: cs.opacity,
        vis: cs.visibility,
        disp: cs.display,
      }
    }),
  )
  console.log(`  语义面清点（${surfaces.length} 个）：`)
  for (const s of surfaces) {
    console.log(
      `    ${s.surface.padEnd(15)} ${s.tag} .${s.cls}  ${s.rect}  pos=${s.pos} z=${s.z} bg=${s.bg} op=${s.op} ${s.vis} ${s.disp}`,
    )
  }

  const stackHolder = await page.evaluate(() => {
    const out = []
    for (const [x, y] of [[800, 500], [150, 400]]) {
      const chain = []
      let el = document.elementFromPoint(x, y)
      for (let depth = 0; el && depth < 7; depth += 1) {
        const cs = getComputedStyle(el)
        chain.push(
          [
            el.tagName.toLowerCase(),
            el.id ? `#${el.id}` : '',
            (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 1).map((c) => `.${c}`).join(''),
            Object.entries(el.dataset ?? {}).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}=${String(v).slice(0, 18)}]`).join(''),
            `bg=${cs.backgroundColor}`,
            `rect=${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
          ].filter(Boolean).join(' '),
        )
        el = el.parentElement
      }
      out.push({ point: `${x},${y}`, chain })
    }
    return out
  })
  for (const s of stackHolder) {
    console.log(`  命中 (${s.point}):`)
    for (const c of s.chain) console.log(`    ${c}`)
  }

  // 侧栏可点项清点：预览图应展示真实会话，而非空态 hero
  const navItems = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.x >= 320 || r.width < 120 || r.height < 20 || r.height > 60) continue
      const text = (el.innerText ?? '').trim().replace(/\s+/g, ' ')
      if (!text || text.length > 60) continue
      // 只保留最内层的行（子元素不再重复收录同一段文字）
      if ([...el.children].some((c) => (c.innerText ?? '').trim().replace(/\s+/g, ' ') === text)) continue
      out.push({
        text: text.slice(0, 40),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') ?? '',
        attrs: [...el.attributes]
          .filter((a) => a.name.startsWith('data-'))
          .map((a) => `${a.name.replace(/^data-/, '')}=${a.value.slice(0, 16)}`)
          .join(' '),
        rect: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)}`,
        cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 1).join(''),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
      })
    }
    return out
  })
  console.log(`  侧栏行（${navItems.length} 个）：`)
  for (const i of navItems) {
    console.log(`    ${i.rect.padEnd(20)} ${i.tag}/${i.role || '-'} .${i.cls} [${i.attrs}]  ${i.text}`)
  }

  // 关键控件实算样式 + 样式表加载顺序：主操作是否真的吃到主色填充，
  // 以及本皮肤的两张表是否排在官方表之后（平特异性时后者胜）。
  const controls = await page.evaluate(async () => {
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return `${sel} → 未找到`
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return `${sel}\n        bg=${cs.backgroundColor} fg=${cs.color}\n        阴影=${cs.boxShadow.slice(0, 64)}\n        边框=${cs.borderColor} 圆角=${cs.borderRadius} 字体=${cs.fontFamily.split(',')[0]} ${cs.fontSize}\n        rect=${Math.round(r.width)}x${Math.round(r.height)} disabled=${el.disabled ?? '-'}`
    }
    /** 就地把候选声明注入页面并读回实算背景。
        本皮肤的两张表排在官方表之前，平特异性时官方必胜；官方按钮的底色
        又可能来自简写、@layer 或伪元素，静态找规则既慢又不可靠。
        直接试出「需要多高的特异性才能赢」最快也最可信。 */
    const fixProbe = async (sel) => {
      const el = document.querySelector(sel)
      if (!el) return [`${sel} → 未找到`]
      const out = []
      const wait = () => new Promise((r) => setTimeout(r, 260))
      const read = () => getComputedStyle(el).backgroundColor
      out.push(`基线（不注入）        ${read()}`)
      const style = document.createElement('style')
      document.head.append(style)
      const trials = [
        ['(0,2,1) 追加在末尾', `html[data-dsh-skin] ${sel}{background-color:#ffb000}`],
        ['(0,2,2) 追加在末尾', `html[data-dsh-skin] body ${sel}{background-color:#ffb000}`],
        ['(0,2,2) 插在最前', `html[data-dsh-skin] body ${sel}{background-color:#ffb000}`],
        ['(0,2,3) 插在最前', `html[data-dsh-skin] body ${sel}[data-dsh-part]{background-color:#ffb000}`],
        ['(0,3,3) 插在最前', `html[data-dsh-skin][data-dsh-skin] body ${sel}{background-color:#ffb000}`],
        ['(0,2,1)+!important 插在最前', `html[data-dsh-skin] ${sel}{background-color:#ffb000!important}`],
      ]
      const prev = style.textContent
      for (const [name, css] of trials) {
        style.textContent = css
        style.remove()
        if (name.includes('插在最前')) document.head.prepend(style)
        else document.head.append(style)
        // 该按钮带 background-color 过渡，必须等过渡结束再读
        await wait()
        out.push(`${name.padEnd(28)} ${read()}`)
      }
      void prev
      style.remove()
      return out
    }
    /** 关键令牌在 body 上的实际取值 */
    const tokenRows = [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-bg-layer-2',
      '--dsw-alias-bg-layer-3',
      '--dsw-alias-bg-overlay',
      '--dsw-specific-sidebar-fill',
      '--dsw-alias-brand-primary',
      '--dsw-alias-button-primary-fill',
      '--dsw-alias-button-elevated-fill',
      '--dsw-alias-border-l1',
      '--dsw-alias-border-l2',
      '--dsw-alias-border-l3',
      '--dsw-alias-border-l4',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-tertiary',
    ].map((t) => `${t} = ${getComputedStyle(document.body).getPropertyValue(t).trim() || '(未定义)'}`)
    const sheets = [...document.styleSheets].map((s, i) => {
      const href = s.href ?? '(内联)'
      const tag = href.includes('/skins/') ? '皮肤' : '官方'
      return `${i}. ${tag} ${href.split('/').slice(-2).join('/').slice(0, 46)}`
    })
    return {
      list: [
        pick('[data-dsh-part="new-session"]'),
        pick('button[type="submit"]'),
        pick('[data-tone]'),
        pick('[role="tab"][aria-selected="true"]'),
        pick('input'),
        pick('textarea'),
      ],
      winner: await fixProbe('[data-dsh-part="new-session"]'),
      tokenRows,
      sheets,
    }
  })
  console.log('  关键控件实算样式：')
  for (const c of controls.list) console.log(`    ${c}`)
  console.log('  「新会话」按钮底色：注入不同特异性的候选声明，读回实算值')
  for (const w of controls.winner) console.log(`    ${w}`)
  console.log('  关键令牌实算值：')
  for (const t of controls.tokenRows) console.log(`    ${t}`)
  console.log(`  样式表顺序（共 ${controls.sheets.length} 张）：`)
  for (const s of controls.sheets.slice(0, 6)) console.log(`    ${s}`)
  if (logs.length > 0) {
    console.log(`  运行时日志 ${logs.length} 条：`)
    for (const l of logs.slice(0, 20)) console.log(`    ${l}`)
  }

  /* 主题持久化方式排查：需要知道「应用自己怎么记住明暗模式」。因为直接改 DOM 上的
     data-ds-dark-theme 切模式不会让应用重渲染，某些元素的上色是渲染时烘进注入样式
     表的，于是滞后一次切换 —— 那会让审计报出并不存在的低对比。 */
  const themeStore = await page.evaluate(() => {
    const out = {}
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      out[k] = (localStorage.getItem(k) ?? '').slice(0, 70)
    }
    return out
  })
  console.log(`  本地存储：${JSON.stringify(themeStore).slice(0, 700)}`)

  /* 「对话/轨迹/审批」三个按钮的真实锚点排查。
     曾经按 [role="tab"] 写规则，实测该角色在 DOM 里根本不存在 —— 规则写对了却
     一条都没命中。这里改成按文字找最内层元素，把标签名、role、类名、data 属性、
     内边距以及父容器的 display/gap 全打出来，据此再写选择器。 */
  const tabs = await page.evaluate(() => {
    const words = ['对话', '轨迹', '审批']
    const hits = []
    const push = (el, why) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const p = el.parentElement
      const pcs = p ? getComputedStyle(p) : null
      hits.push({
        why,
        text: (el.textContent ?? '').trim().slice(0, 14),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') ?? '-',
        cls: typeof el.className === 'string' ? el.className.slice(0, 40) : '-',
        dataAttrs: [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).join(',') || '-',
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        at: `${Math.round(r.left)},${Math.round(r.top)}`,
        pad: `${cs.paddingLeft}/${cs.paddingRight}`,
        fs: cs.fontSize,
        radius: cs.borderRadius,
        parent: p ? `${p.tagName.toLowerCase()}[role=${p.getAttribute('role') ?? '-'}] display=${pcs.display} gap=${pcs.gap}` : '-',
        parentCls: p && typeof p.className === 'string' ? p.className.slice(0, 40) : '-',
      })
    }
    const seen = new Set()
    // 1) 文字命中：包含这三个词、且整体很短（避免命中整段正文）
    for (const el of document.querySelectorAll('*')) {
      const t = (el.textContent ?? '').trim()
      if (t.length > 12) continue
      if (!words.some((w) => t.includes(w))) continue
      const key = `t|${t}|${el.tagName}|${el.className}`
      if (seen.has(key)) continue
      seen.add(key)
      push(el, '文字命中')
    }
    // 2) 内容区顶部的控件：不管它叫什么，先把这一段有哪些可点元素列出来
    for (const el of document.querySelectorAll('button,[role="button"],[role="tab"],[role="radio"],[role="menuitemradio"],[aria-pressed]')) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      if (r.left < 260 || r.top > innerHeight * 0.35) continue
      const key = `b|${el.tagName}|${el.className}|${Math.round(r.left)}`
      if (seen.has(key)) continue
      seen.add(key)
      push(el, '顶部控件')
    }
    return hits.slice(0, 14)
  })
  if (tabs.length === 0) {
    console.log('  内容区顶部没有找到可点控件（当前状态可能不显示这三个按钮）')
  } else {
    for (const t of tabs) {
      console.log(`      [${t.why}] 「${t.text}」 <${t.tag} role=${t.role}> ${t.size}@${t.at} 内边距=${t.pad} 圆角=${t.radius} 字号=${t.fs}`)
      console.log(`           类名=${t.cls}  data=${t.dataAttrs}`)
      console.log(`           父=${t.parent}  父类名=${t.parentCls}`)
    }
  }

  const outDir = join(root, 'preview-src', shotId)
  mkdirSync(outDir, { recursive: true })

  const shoot = async (mode, name) => {
    const label = name ?? mode
    await page.evaluate((want) => {
      const dark = want === 'dark'
      if (dark) document.body.setAttribute('data-ds-dark-theme', '')
      else document.body.removeAttribute('data-ds-dark-theme')
      document.documentElement.style.colorScheme = want
    }, mode)
    await sleep(700)

    /* 对比度审计：白底白字这类问题在整屏截图里肉眼极易漏掉，也正因如此最容易被
       带到成品里。这里逐个元素实算：把文字色与「逐级合成后的有效背景」都还原成
       不透明色，再算 WCAG 对比度，低于 3:1 的直接点名。 */
    const { low, white } = await page.evaluate(() => {
      const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c)
        if (!m) return null
        const p = m[1].split(',').map(Number)
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
      }
      const over = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      })
      const rel = (c) => {
        const f = (v) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
      }
      const ratio = (a, b) => {
        const la = rel(a)
        const lb = rel(b)
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
      }
      const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
      /** 自下而上收集所有非透明背景，再从根往下逐级合成，得到真实的有效背景 */
      const bgOf = (el) => {
        const stack = []
        let node = el
        while (node) {
          const c = parse(getComputedStyle(node).backgroundColor)
          if (c && c.a > 0) stack.push(c)
          node = node.parentElement
        }
        stack.reverse()
        let acc = parse(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
        if (acc.a < 1) acc = over(acc, { r: 255, g: 255, b: 255, a: 1 })
        for (const c of stack) acc = over(c, acc)
        return acc
      }
      const desc = (el) => {
        const d = el.dataset ?? {}
        return (
          el.tagName.toLowerCase() +
          (d.dshPart ? `[part=${d.dshPart}]` : '') +
          (d.tone ? `[tone=${d.tone}]` : '') +
          (d.dshSurface ? `[surface=${d.dshSurface}]` : '') +
          (el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : '') +
          (typeof el.className === 'string' && el.className ? `.${el.className.split(' ').filter(Boolean).slice(0, 2).join('.')}` : '')
        )
      }
      const out = []
      const white = []
      const seen = new Set()
      // 当前页面整体算亮色还是暗色。用来识别「切模式残留」：工具是直接改 DOM 属性
      // 切模式的，有些元素的上色在渲染时就烘进了注入样式表、不会重算，于是亮色页面
      // 里会读到一整块暗色的面 —— 那是工具假阳性，不是皮肤的真实问题。
      const pageDark = rel(bgOf(document.body)) < 0.5
      for (const el of document.querySelectorAll('*')) {
        // 只看「自己直接扛着文字」的元素，纯容器不算
        let text = ''
        for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue
        text = text.trim().replace(/\s+/g, ' ')
        if (!text) continue
        // 纯装饰性单字符（间隔点、竖线之类）不参与正文对比度门槛：它们本来就是靠
        // 「几乎看不见」起分隔作用，官方拿最淡的描边色去画，硬拉到 4.5:1 是改错了
        // 东西。这里点名排除，避免它淹掉真正该修的文字。
        if (text.length === 1 && !/[\p{L}\p{N}]/u.test(text)) continue
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue
        if (cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)' && cs.color === 'rgba(0, 0, 0, 0)') continue
        const fgRaw = parse(cs.color)
        if (!fgRaw) continue
        const bg = bgOf(el)
        // 元素自身的 opacity 会把文字整体往背景上拉，必须算进去，否则「被淡化到
        // 看不清」的文字会被判成合格。
        const op = Number(cs.opacity)
        const fgA = fgRaw.a * (Number.isFinite(op) ? op : 1)
        const fg = fgA < 1 ? over({ ...fgRaw, a: fgA }, bg) : fgRaw
        const cr = ratio(fg, bg)
        // 4.5:1 是 WCAG AA 对正文字号的要求。初版写 3:1（那是大号文字的线），于是
        // 亮色下发灰的文字全被判合格 —— 用户看到的「白底白字」正是落在这个区间。
        if (cr >= 4.5) continue
        const key = `${desc(el)}|${hex(fg)}|${hex(bg)}`
        if (seen.has(key)) continue
        seen.add(key)
        const entry = {
          ratio: Math.round(cr * 100) / 100,
          color: hex(fg),
          bg: hex(bg),
          bgLum: Math.round(rel(bg) * 100) / 100,
          size: cs.fontSize,
          tag: desc(el).slice(0, 58),
          text: text.slice(0, 26),
          // 判据：底色与文字都落在「页面整体明暗」的反面 —— 页面是亮色时出现一整块
          // 深底 + 深字，或页面是暗色时出现浅底 + 浅字，就是上一模式残留。
          // （合法的反色卡片文字是浅色的，不会被误判。）
          suspect: (rel(bg) < 0.5) !== pageDark && (rel(fg) < 0.5) !== pageDark,
        }
        // 近白色文字单独拎出来点名。真白底白字算出来的对比度接近 1，混在低对比
        // 清单里根本认不出；按背景亮度排序，谁把白字配了浅底就一眼可见。
        if (rel(fg) >= 0.6 && cr < 7) white.push(entry)
        if (cr >= 4.5) continue
        out.push(entry)
      }
      return {
        low: out.sort((a, b) => a.ratio - b.ratio).slice(0, 30),
        white: white.sort((a, b) => b.bgLum - a.bgLum).slice(0, 10),
      }
    })
    const real = low.filter((r) => !r.suspect)
    const stale = low.filter((r) => r.suspect)
    if (real.length === 0) {
      console.log(`  ✓ ${label} 对比度审计：无低于 4.5:1 的真实问题`)
    } else {
      console.log(`  ⚠ ${label} 对比度审计：${real.length} 处真实低于 4.5:1`)
      for (const r of real) console.log(`      ${String(r.ratio).padStart(5)}:1  ${r.color} 于 ${r.bg}  ${r.size}  <${r.tag}>  「${r.text}」`)
    }
    if (stale.length > 0) {
      console.log(`  ℹ ${label} 另有 ${stale.length} 处「切模式残留」（工具在改 DOM 属性切模式，应用未重算，不计入）`)
      for (const r of stale) console.log(`      ${r.ratio}:1  ${r.color} 于 ${r.bg}  <${r.tag}>`)
    }
    if (white.length > 0) {
      console.log(`  ⚠ ${label} 白字普查：${white.length} 处近白色文字没有落在深底上`)
      for (const r of white) console.log(`      背景亮度 ${r.bgLum}  对比 ${r.ratio}:1  ${r.color} 于 ${r.bg}  <${r.tag}>  「${r.text}」`)
    }

    /* 字号普查：把所有「自己直接扛着文字」的元素按 字体族 | 字号 | 字重 聚合。
       用途是回答「正文、侧栏导航按钮、工作区文件夹名各是多大」这类问题 —— 之前
       字号是全局一刀切调的，正文与按钮的落差只有靠这种聚合才看得出来。 */
    const fontCensus = await page.evaluate(() => {
      const map = new Map()
      for (const el of document.querySelectorAll('*')) {
        let text = ''
        for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue
        text = text.trim().replace(/\s+/g, ' ')
        if (!text) continue
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        const cs = getComputedStyle(el)
        const d = el.dataset ?? {}
        const key = `${cs.fontFamily.split(',')[0].replace(/"/g, '')} | ${cs.fontSize} | ${cs.fontWeight}`
        if (!map.has(key)) map.set(key, { key, n: 0, samples: [] })
        const g = map.get(key)
        g.n += 1
        if (g.samples.length < 4) {
          const desc =
            el.tagName.toLowerCase() +
            (d.dshPart ? `[part=${d.dshPart}]` : '') +
            (d.dshSurface ? `[surface=${d.dshSurface}]` : '') +
            (el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : '') +
            (typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0].slice(0, 26)}` : '')
          g.samples.push(`${desc} 「${text.slice(0, 20)}」`)
        }
      }
      // 关键锚点：正文、侧栏工作区/会话名、侧栏导航按钮分别挂在哪一层，
      // 以及各层的字号与字体族是谁在起作用。要改字号必须先知道挂载点。
      const want = ['任务看板', '未分组', '工作区', '新会话', '你好']
      const anchors = []
      const chainOf = (el, label) => {
        const chain = []
        let node = el
        for (let i = 0; node && i < 5; i += 1) {
          const cs = getComputedStyle(node)
          const d = node.dataset ?? {}
          const resp = Object.keys(d)
            .filter((k) => k.toLowerCase().includes('responsive'))
            .map((k) => `[${k}=${d[k]}]`)
            .join('')
          chain.push(
            `${node.tagName.toLowerCase()}${d.dshPart ? `[part=${d.dshPart}]` : ''}${d.dshSurface ? `[surf=${d.dshSurface}]` : ''}${node.getAttribute('role') ? `[role=${node.getAttribute('role')}]` : ''}${resp}${typeof node.className === 'string' && node.className ? `.${node.className.split(' ')[0].slice(0, 24)}` : ''} ${cs.fontSize}/${cs.fontFamily.split(',')[0].replace(/"/g, '')}`,
          )
          node = node.parentElement
        }
        anchors.push(`${label}: ${chain.join('  <  ')}`)
      }
      for (const w of want) {
        const el = [...document.querySelectorAll('span,p,div,button,a,h2')].find(
          (n) => (n.textContent ?? '').trim() === w,
        )
        if (!el) {
          anchors.push(`${w}: 未找到`)
          continue
        }
        chainOf(el, w)
      }
      // 底部状态栏（用户画红框指出「有点大」的就是这一条）：按内容特征找最内层元素
      for (const re of [/tok\/s/, /缓存命中/, /\d+\s*轮/, /Default/]) {
        const all = [...document.querySelectorAll('span,div,button,p')].filter((n) => re.test(n.textContent ?? ''))
        const inner = all.filter((n) => ![...n.children].some((c) => re.test(c.textContent ?? '')))
        const el = inner[inner.length - 1] ?? all[all.length - 1]
        if (!el) {
          anchors.push(`状态栏 ${re}: 未找到`)
          continue
        }
        chainOf(el, `状态栏 ${re} 「${(el.textContent ?? '').trim().slice(0, 16)}」`)
      }
      // 正文段落：看它是否落在 message-body 里
      const p = [...document.querySelectorAll('p')].find((n) => (n.textContent ?? '').trim().length > 20)
      if (p) {
        const cs = getComputedStyle(p)
        const par = p.closest('[data-dsh-part]')
        anchors.push(
          `正文段落: <p> ${cs.fontSize}/${cs.fontFamily.split(',')[0].replace(/"/g, '')} lh=${cs.lineHeight}  最近的 part=${par ? par.dataset.dshPart : '无'}`,
        )
      }
      return {
        census: [...map.values()].sort((a, b) => b.n - a.n).slice(0, 16),
        anchors,
      }
    })
    console.log(`  字号普查（${label}）：`)
    for (const g of fontCensus.census) {
      console.log(`      ${String(g.n).padStart(4)} 处   ${g.key}`)
      for (const s of g.samples) console.log(`                 ${s}`)
    }
    console.log('  字号锚点：')
    for (const a of fontCensus.anchors) console.log(`      ${a}`)

    /* 「思考」折叠块的底色来源排查：明暗两模下它都拿到「另一个模式」的面色，
       于是文字几乎看不见。把祖先链每一层的实算背景与渐变打出来，定位到具体哪一层、
       以及它是不是被渐变盖住（对比度审计只读 background-color，读不到渐变）。 */
    const thinkChain = await page.evaluate(() => {
      /* 顺带量一下内容区里用 tab 角色实现的切换按钮（「对话/轨迹/审批」就是这个），
         确认「加大内边距 + 加大最小高度 + 收紧间距」真的落在了它们身上。 */
      const tabInfo = [...document.querySelectorAll('[role="tab"]')].map((t) => {
        const cs = getComputedStyle(t)
        const r = t.getBoundingClientRect()
        const p = t.parentElement
        const pcs = p ? getComputedStyle(p) : null
        /* 选中态怎么标记必须实测：皮肤的选中样式挂在 [aria-selected="true"] 上，
           如果官方改用类名（wSkVaW_tabActive）标记，那条规则就是死规则 —— 页签会
           三个长得一模一样、看不出选中了哪个。这里把三种可能的标记都打出来。 */
        const attrs = [...t.attributes]
          .filter((a) => a.name !== 'style' && a.name !== 'class')
          .map((a) => `${a.name}=${a.value}`)
          .join(' ')
        const cls = typeof t.className === 'string' ? t.className : ''
        const mark = [
          `aria-selected=${t.getAttribute('aria-selected') ?? '-'}`,
          `data-state=${t.getAttribute('data-state') ?? '-'}`,
          `cls含Active=${/active/i.test(cls) ? '是' : '否'}`,
        ].join(' ')
        return `「${(t.textContent ?? '').trim().slice(0, 6)}」 ${Math.round(r.width)}x${Math.round(r.height)}@x${Math.round(r.left)} 内边距=${cs.paddingLeft}/${cs.paddingRight} 圆角=${cs.borderRadius} 字号=${cs.fontSize} 父gap=${pcs ? pcs.gap : '-'} 底色=${cs.backgroundColor} 阴影=${cs.boxShadow.slice(0, 28)} ｜ ${mark}${attrs ? ` ｜ ${attrs}` : ''}`
      })
      const el = [...document.querySelectorAll('span,div')].find(
        (n) => (n.textContent ?? '').trim() === '思考' && n.children.length === 0,
      )
      if (!el) return { chain: '(当前状态没有「思考」元素)', tabs: tabInfo }
      const lines = []
      let node = el
      for (let i = 0; node && i < 9; i += 1) {
        const cs = getComputedStyle(node)
        const cls = typeof node.className === 'string' && node.className ? `.${node.className.split(' ')[0].slice(0, 30)}` : ''
        lines.push(
          `${'  '.repeat(i)}${node.tagName.toLowerCase()}${cls} bg=${cs.backgroundColor} color=${cs.color} img=${cs.backgroundImage.slice(0, 46)} inline=${node.getAttribute('style') ?? '-'}`,
        )
        node = node.parentElement
      }
      return { chain: lines.join('\n           '), tabs: tabInfo }
    })
    console.log(`  「思考」祖先链（${label}）：\n           ${thinkChain.chain}`)
    if (thinkChain.tabs.length === 0) {
      console.log('  内容区没有 [role=tab] 按钮（当前状态未渲染「对话/轨迹/审批」）')
    } else {
      for (const t of thinkChain.tabs) console.log(`      [role=tab] ${t}`)
    }

    const file = join(outDir, `${label}.jpg`)
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 })
    // 同时留一份无损 PNG 供 tools/inspect-shot.mjs 逐像素核对
    await page.screenshot({ path: join(outDir, `${label}.png`), type: 'png' })
    console.log(`  ✓ ${label} -> ${file}`)
    return file
  }

  // 进入一个真实会话：空态 hero 只能验证底色与字体，验证不了消息、代码块、工具调用
  // 这些真正吃层次的地方。所以预览与核对都必须基于真实会话。
  // 这一步曾经不稳：有时停在 hero 却照样截图，于是「验证」的是一张空页面（页签、
  // 消息、代码块全都不存在，自然找不到、也测不出问题）。改成依次尝试前几行会话、
  // 每行多点几次、进不去就换下一行，并明确报出成功还是失败。
  const rowSel = '[role="treeitem"][data-dsh-responsive-part="sidebar-entry"]'
  let entered = false
  for (let r = 0; r < 4 && !entered; r += 1) {
    // 每次点击前重新取行：切工作区会让列表重渲染，旧句柄与旧坐标都会失效
    const rows = await page.$$(rowSel)
    if (r >= rows.length) break
    for (let i = 0; i < 4; i += 1) {
      const fresh = await page.$$(rowSel)
      const box = fresh[r] ? await fresh[r].boundingBox() : null
      if (!box) break
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await sleep(2000)
      const ph = await page.evaluate(() => document.querySelector('.wSkVaW_root')?.getAttribute('data-phase') ?? '?')
      const ch = await page.evaluate(() => document.body.innerText.trim().length)
      if (ph !== 'hero' && ch > 400) {
        entered = true
        console.log(`  已进入会话：第 ${r + 1} 行，第 ${i + 1} 次点击生效`)
        break
      }
    }
  }
  {
    const phase = await page.evaluate(() => document.querySelector('.wSkVaW_root')?.getAttribute('data-phase') ?? '?')
    const chars = await page.evaluate(() => document.body.innerText.trim().length)
    const here = await page.evaluate(() => `${location.pathname}${location.search}${location.hash}`)
    if (entered) {
      console.log(`  ✓ 会话就绪：phase=${phase} 正文 ${chars} 字符  地址=${here}`)
    } else {
      console.log(`  ⚠ 仍是空态：phase=${phase} 正文 ${chars} 字符  地址=${here}`)
      console.log('     消息、代码块、页签相关的核对在这一轮不成立，别把它当成通过。')
    }
  }

  await shoot('dark')
  await shoot('light')

  // 设置面板单独留一张仅用于核对（不进入皮肤预览）
  const settingsBtn = await page.evaluateHandle(() => {
    const hit = [...document.querySelectorAll('button, [role="button"], [tabindex]')].find(
      (el) => (el.innerText ?? '').trim() === '设置' && el.getBoundingClientRect().width > 40,
    )
    return hit ?? null
  })
  const settingsEl = settingsBtn.asElement()
  if (settingsEl) {
    await settingsEl.click()
    await sleep(1200)
    const dlg = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      if (!d) return '无 [role=dialog]'
      const cs = getComputedStyle(d)
      const r = d.getBoundingClientRect()
      const chain = []
      let el = d
      while (el && chain.length < 8) {
        chain.push(
          `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.hasAttribute('data-ds-dark-theme') ? '·DARK' : ''}${el.dataset?.dshSurface ? `·surface=${el.dataset.dshSurface}` : ''}`,
        )
        el = el.parentElement
      }
      return [
        `rect=${Math.round(r.width)}x${Math.round(r.height)}`,
        `bg=${cs.backgroundColor}`,
        `shadow=${cs.boxShadow.slice(0, 48)}`,
        `dialog 的 --dsw-alias-bg-overlay=${getComputedStyle(d).getPropertyValue('--dsw-alias-bg-overlay').trim()}`,
        `body 的 --dsw-alias-bg-overlay=${getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-overlay').trim()}`,
        `body·DARK=${document.body.hasAttribute('data-ds-dark-theme')} html·DARK=${document.documentElement.hasAttribute('data-ds-dark-theme')}`,
        `在 body 内=${document.body.contains(d)}`,
        `祖先链=${chain.join(' < ')}`,
      ].join('\n           ')
    })
    console.log(`  设置面板：${dlg}`)
    await shoot('dark', 'settings')
  } else {
    console.log('  未找到「设置」入口，跳过设置面板核对')
  }

  console.log('\n完成。重跑 node src/build.mjs 即可把预览纳入产物。')
} finally {
  await browser.close()
}