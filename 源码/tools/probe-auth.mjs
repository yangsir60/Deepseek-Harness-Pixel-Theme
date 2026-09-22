/**
 * 诊断：确认本地签发的会话 cookie 是否被 web 网关接受。
 *
 * 用法: node tools/probe-auth.mjs [origin]
 *
 * 皮肤中心的预览截图依赖这条通路。若此诊断失败，说明 web 服务的鉴权方式变了
 * （例如 cookie 算法、authority 形式或凭据记录名变更），预览截图会一并失效。
 * 本诊断只读取凭据库中 client-connection/browser-session 这一条记录。
 */

import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ORIGIN = process.argv[2] ?? 'http://127.0.0.1:43120'
const host = new URL(ORIGIN).host
const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE, '.dsh')

const b64url = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

const yaml = readFileSync(join(dshHome, '.credentials.yaml'), 'utf8')
const block = yaml.match(/client-connection\/browser-session:([\s\S]{0,400})/)
if (!block) throw new Error('凭据库里没有 client-connection/browser-session 记录')
const raw = block[1].match(/^\s*secret:\s*([A-Za-z0-9_-]{43})\s*$/m)
if (!raw) throw new Error('该记录中没有可用的 secret')
const secret = Buffer.from(raw[1].replaceAll('-', '+').replaceAll('_', '/') + '=', 'base64')
console.log(`凭据密钥: 已装载 (${secret.byteLength} 字节)`)

const authorities = [host, ...(host.startsWith('127.0.0.1') ? [`localhost:${new URL(ORIGIN).port}`] : ['127.0.0.1:' + new URL(ORIGIN).port])]

for (const authority of [...new Set(authorities)]) {
  const name = `dsh-auth-${b64url(createHash('sha256').update(authority).digest())}`
  const now = Date.now()
  const body = b64url(
    Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 864e5 }), 'utf8'),
  )
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  const cookie = `${name}=v1.${body}.${sig}`

  const plain = await fetch(`${ORIGIN}/`)
  const authed = await fetch(`${ORIGIN}/`, { headers: { cookie } })
  const authedText = await authed.text()
  const attrs = authedText.match(/<html[^>]*>/i)?.[0] ?? ''
  console.log(
    `authority=${authority}\n` +
      `  无 cookie : ${plain.status} ${await plain.text()}\n` +
      `  带 cookie : ${authed.status} len=${authedText.length}\n` +
      `  <html> 标签: ${attrs.slice(0, 160) || '(无)'}`,
  )

  if (authed.status === 200) {
    const cat = await fetch(`${ORIGIN}/api/skin-center/v2/catalog`, { headers: { cookie } })
    console.log(`  catalog   : ${cat.status}`)
    if (cat.status === 200) {
      const json = await cat.json()
      console.log(`  已装皮肤  : ${(json.skins ?? []).map((s) => s.manifest.id).join(', ') || '(none)'}`)
      console.log(`  目录诊断  : ${(json.diagnostics ?? []).length} 条`)
      for (const d of json.diagnostics ?? []) console.log(`    ${JSON.stringify(d)}`)
    }
  }
}