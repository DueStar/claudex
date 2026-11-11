/**
 * post.cjs — what the hook and the status line share: where the server is,
 * the token, the request signature and the POST itself.
 *
 * Both run as `ELECTRON_RUN_AS_NODE=1 "<spawn.exe>" hooks/<script>.cjs`
 * (electron/terminals.cjs writes the commands), so they need nothing but the
 * app: no Python, no curl.
 */

const fs = require('fs')
const http = require('http')
const path = require('path')
const { createHmac } = require('crypto')
// The env names (SPAWN_*, or AGENT_OFFICE_*) and the data folder, as the server reads them
const { envVar, runtimeDir } = require('../server/runtime-dir.cjs')

/**
 * Where to POST: <KIND>_URL when set, else 127.0.0.1 on SPAWN_PORT (3334).
 * 127.0.0.1, not 'localhost': that can resolve to ::1 first, where a squatter
 * could listen while the real server runs on 127.0.0.1.
 */
function serverUrl(kind, env = process.env) {
  const given = envVar(`${kind.toUpperCase()}_URL`, env)
  if (given) return given
  const raw = envVar('PORT', env).trim()
  const port = /^\d{1,5}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 65535 ? Number(raw) : 3334
  return `http://127.0.0.1:${port}/${kind}`
}

function readToken(env = process.env) {
  try { return fs.readFileSync(path.join(runtimeDir(env), 'auth-token'), 'utf8').trim() } catch { return '' }
}

/** The request path and query of a URL: http://127.0.0.1:3334/event?x -> /event?x */
function urlPath(url) {
  try { const u = new URL(url); return `${u.pathname}${u.search}` } catch { return '/' }
}

/**
 * The headers that sign a POST: HMAC-SHA256(token, "POST\n<path>\n<ts>\n<body>").
 * The token never leaves this process (never argv, never a header).
 */
function signatureHeaders(token, url, body, now = Date.now()) {
  if (!token) return {}
  const ts = String(now)
  const sig = createHmac('sha256', token).update(`POST\n${urlPath(url)}\n${ts}\n`).update(body).digest('hex')
  return { 'X-spawn-Timestamp': ts, 'X-spawn-Signature': sig }
}

/**
 * POST a JSON body, signed when there is a token; resolves when the server
 * answered, refused or took longer than timeoutMs. Never rejects: a stopped
 * server must never slow a session down or print anything.
 */
function postJson(url, json, { token = readToken(), timeoutMs = 1000 } = {}) {
  const body = Buffer.from(json, 'utf8')
  return new Promise((resolve) => {
    let req
    try {
      req = http.request(url, {
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...signatureHeaders(token, url, body) },
        timeout: timeoutMs,
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); res.on('error', () => resolve(0)) })
    } catch { resolve(0); return }
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(0))
    req.end(body)
  })
}

/** All of stdin, as UTF-8 */
function readStdin() {
  return new Promise((resolve) => {
    const chunks = []
    process.stdin.on('data', (c) => chunks.push(c))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', () => resolve(''))
  })
}

module.exports = { envVar, runtimeDir, serverUrl, readToken, urlPath, signatureHeaders, postJson, readStdin }
