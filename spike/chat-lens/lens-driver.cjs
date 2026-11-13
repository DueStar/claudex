'use strict'
/**
 * lens-driver.cjs — THROWAWAY spike harness (not product code).
 *
 * Runs the user's real interactive `claude` in a node-pty pseudo-console, the
 * way spawn does, and records three streams with one clock (Date.now()):
 *   pty   raw TUI output (runs/<name>/pty.jsonl) + an off-screen @xterm/headless
 *         copy of the screen (GET /screen)
 *   hook  every hook event, delivered as an HTTP hook (type "http") to this
 *         process, full JSON body logged; a hook can be held open until an
 *         answer is posted (permission buttons experiment)
 *   tx    every line appended to any .jsonl in the session's project folder
 *         under ~/.claude/projects (transcript tailer, polls every 50 ms)
 * Everything lands in runs/<name>/events.jsonl.
 *
 * Control (curl from another shell), all on 127.0.0.1:<port>:
 *   POST /type    {"text":"…","enter":true,"paste":false}   type into the pty
 *   POST /keys    {"data":"\u001b"}                         raw keys (Esc, Shift+Tab "\u001b[Z", …)
 *   GET  /screen                                            the headless screen as text
 *   POST /policy  {"event":"PermissionRequest","mode":"hold"|"pass"|"respond","body":{…}}
 *   GET  /pending                                           held hooks
 *   POST /answer  {"id":1,"body":{…}}                       release a held hook with this JSON
 *   POST /watch   {"token":"ZEBRA"}                          log when a token first shows per source
 *   POST /resize  {"cols":80,"rows":24}
 *   POST /quit
 *
 * Usage: node lens-driver.cjs --name run1 --cwd <dir> [--port 47811] [--cols 100 --rows 30]
 *        [--session-id <uuid> | --resume <uuid>] [-- <extra claude args>]
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const pty = require('node-pty') // from the repo's node_modules (junction to spawn's)
const { Terminal } = require('@xterm/headless') // installed only under spike/chat-lens

// ── args
const argv = process.argv.slice(2)
const dashdash = argv.indexOf('--')
const extra = dashdash >= 0 ? argv.slice(dashdash + 1) : []
const opts = {}
for (let i = 0; i < (dashdash >= 0 ? dashdash : argv.length); i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1]
const name = opts.name || `run-${Date.now()}`
const cwd = path.resolve(opts.cwd || process.cwd())
const port = Number(opts.port || 47811)
let cols = Number(opts.cols || 100)
let rows = Number(opts.rows || 30)
const sessionId = opts['session-id'] || crypto.randomUUID()
const resume = opts.resume || null

const outDir = path.join(__dirname, 'runs', name)
fs.mkdirSync(outDir, { recursive: true })
const evLog = fs.createWriteStream(path.join(outDir, 'events.jsonl'), { flags: 'a' })
const ptyLog = fs.createWriteStream(path.join(outDir, 'pty.jsonl'), { flags: 'a' })
const T0 = Date.now()
function log(rec) { evLog.write(JSON.stringify({ t: Date.now(), dt: Date.now() - T0, ...rec }) + '\n') }

// ── settings: every hook event as an HTTP hook to this process (MessageDisplay included)
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'UserPromptExpansion', 'MessageDisplay', 'PreToolUse',
  'PermissionRequest', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'SubagentStart',
  'SubagentStop', 'Stop', 'StopFailure', 'Notification', 'PreCompact', 'PostCompact', 'PostModelSwitch', 'CwdChanged',
  'TaskCreated', 'TaskCompleted']
const hookTimeout = Number(opts['hook-timeout'] || 600)
// --timeouts PermissionRequest=15,PreToolUse=60   per-event hook timeout (s);  --skip MessageDisplay,Notification
const perEvent = Object.fromEntries(String(opts.timeouts || '').split(',').filter(Boolean).map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)]))
const skip = new Set(String(opts.skip || '').split(',').filter(Boolean))
const settings = {
  hooks: Object.fromEntries(EVENTS.filter(e => !skip.has(e)).map(e => [e, [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hook/${e}`, timeout: perEvent[e] ?? (e === 'MessageDisplay' ? 10 : hookTimeout) }] }]])),
}
// SessionStart / SessionEnd accept only command hooks: forwarded by hook-forward.cjs (exec form, no shell)
const fwd = (e) => [{ hooks: [{ type: 'command', command: 'node', args: [path.join(__dirname, 'hook-forward.cjs'), `http://127.0.0.1:${port}/hook/${e}`] }] }]
settings.hooks.SessionStart = fwd('SessionStart')
settings.hooks.SessionEnd = fwd('SessionEnd')
const settingsFile = path.join(outDir, 'settings.json')
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))

// ── headless screen
const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 2000 })
function screenText() {
  const b = term.buffer.active
  const out = []
  for (let i = 0; i < term.rows; i++) out.push((b.getLine(b.viewportY + i)?.translateToString(true)) ?? '')
  return out.join('\n')
}

// ── token watch: first time a token shows in each source
const watches = new Map() // token -> {source: t}
function seen(source, text) {
  for (const [tok, rec] of watches) if (!rec[source] && text.includes(tok)) { rec[source] = Date.now(); log({ src: 'watch', token: tok, source }) }
}

// ── the pty
const ANSI = /\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78NOMDEc]/g
let ptyTail = ''
const claudeExe = path.join(os.homedir(), '.local', 'bin', 'claude.exe')
const args = [...(resume ? ['--resume', resume] : ['--session-id', sessionId]), '--settings', settingsFile, ...extra]
const env = { ...process.env }
for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_PID') delete env[k]
if ('NO_COLOR' in env) delete env.NO_COLOR
const p = pty.spawn(fs.existsSync(claudeExe) ? claudeExe : 'claude.exe', args, { name: 'xterm-256color', cols, rows, cwd, env, useConpty: true })
log({ src: 'ctl', what: 'spawn', args, cwd, sessionId: resume || sessionId, pid: p.pid })
let screenTimer = null
p.onData((data) => {
  ptyLog.write(JSON.stringify({ t: Date.now(), data }) + '\n')
  ptyTail = (ptyTail + data.replace(ANSI, '')).slice(-4000)
  seen('ptyStream', ptyTail)
  term.write(data, () => {
    if (!screenTimer) screenTimer = setTimeout(() => { screenTimer = null; seen('screen', screenText()) }, 30)
  })
})
p.onExit(({ exitCode }) => { log({ src: 'ctl', what: 'exit', exitCode }); setTimeout(() => process.exit(0), 500) })

// ── transcript tailer: every .jsonl in the project folder (sub-agent files live in a subfolder)
const projectsDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
const projDir = path.join(projectsDir, cwd.replace(/[^a-zA-Z0-9]/g, '-'))
log({ src: 'ctl', what: 'projDir', projDir, expected: path.join(projDir, `${resume || sessionId}.jsonl`) })
const files = new Map() // path -> {size, prefix(hash), lines}
function walk(dir, out = []) {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) walk(f, out)
    else if (e.name.endsWith('.jsonl') || e.name.endsWith('.json')) out.push(f)
  }
  return out
}
// files already there before this run are tracked from their current end (not replayed)
for (const f of walk(projDir)) { try { const buf = fs.readFileSync(f); files.set(f, { size: buf.length, head: hash(buf), lines: 0, pre: true }) } catch {} }
function hash(buf) { return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) }
function summarize(o) {
  const s = { type: o.type, subtype: o.subtype, uuid: o.uuid?.slice(0, 8), parent: o.parentUuid?.slice(0, 8), sidechain: o.isSidechain || undefined, meta: o.isMeta || undefined }
  const m = o.message
  if (m) {
    s.role = m.role; s.msgId = m.id; s.stop = m.stop_reason
    const c = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || [])
    s.blocks = c.map(b => b.type === 'text' ? `text:${JSON.stringify(b.text.slice(0, 60))}` : b.type === 'tool_use' ? `tool_use:${b.name}:${b.id?.slice(-6)}` : b.type === 'tool_result' ? `tool_result:${b.tool_use_id?.slice(-6)}${b.is_error ? ':ERR' : ''}` : b.type)
  }
  if (o.toolUseResult) s.toolUseResultKeys = typeof o.toolUseResult === 'object' ? Object.keys(o.toolUseResult) : typeof o.toolUseResult
  if (o.attachment) s.attachment = o.attachment.type
  if (o.content && !m) s.content = String(o.content).slice(0, 80)
  return s
}
setInterval(() => {
  for (const f of walk(projDir)) {
    let st
    try { st = fs.statSync(f) } catch { continue }
    const prev = files.get(f)
    if (!prev) { files.set(f, { size: 0, head: '', lines: 0 }); log({ src: 'tx', what: 'new-file', file: path.relative(projDir, f) }) }
    const rec = files.get(f)
    if (st.size === rec.size) continue
    const buf = fs.readFileSync(f)
    if (buf.length < rec.size || (rec.size && hash(buf.subarray(0, rec.size)) !== rec.head)) {
      log({ src: 'tx', what: 'REWRITE', file: path.relative(projDir, f), oldSize: rec.size, newSize: buf.length })
      rec.size = 0; rec.lines = 0
    }
    const chunk = buf.subarray(rec.size).toString('utf8')
    const lastNl = chunk.lastIndexOf('\n')
    if (lastNl < 0) continue // partial line: wait
    const complete = chunk.slice(0, lastNl + 1)
    rec.size += Buffer.byteLength(complete)
    rec.head = hash(buf.subarray(0, rec.size))
    for (const line of complete.split('\n').filter(Boolean)) {
      rec.lines++
      let o = null
      try { o = JSON.parse(line) } catch { log({ src: 'tx', file: path.relative(projDir, f), bad: line.slice(0, 120) }); continue }
      seen('tx', line)
      log({ src: 'tx', file: path.relative(projDir, f), n: rec.lines, bytes: line.length, ...summarize(o) })
    }
  }
}, 50)

// ── HTTP: hooks + control
let nextId = 1
const pending = new Map()
const policy = {} // event -> {mode, body}
function body(req) { return new Promise((res) => { let s = ''; req.on('data', d => { s += d }); req.on('end', () => res(s)) }) }
function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const raw = await body(req)
  let b = {}
  try { b = raw ? JSON.parse(raw) : {} } catch {}
  if (url.pathname.startsWith('/hook/')) {
    const ev = url.pathname.slice(6)
    const id = nextId++
    log({ src: 'hook', id, event: ev, body: b })
    if (ev === 'MessageDisplay') seen('messageDisplay', String(b.delta || ''))
    if (ev === 'Stop') seen('stopHook', String(b.last_assistant_message || ''))
    const polKey = policy[`${ev}:${b.tool_name}`] ? `${ev}:${b.tool_name}` : ev // e.g. PreToolUse:AskUserQuestion
    const pol = policy[polKey] || { mode: 'pass' }
    if (pol.mode === 'hold') {
      pending.set(id, { ev, res, b, at: Date.now() })
      // the connection closing before we answered = Claude Code gave up on the hook (timeout / dialog answered elsewhere)
      res.on('close', () => { if (pending.has(id) && !res.writableEnded) { log({ src: 'hook', id, what: 'client-closed (timeout/cancel)', heldMs: Date.now() - pending.get(id).at }); pending.delete(id) } })
      return
    }
    if (pol.mode === 'respond') { log({ src: 'hook', id, what: 'auto-respond', reply: pol.body }); if (pol.once) delete policy[polKey]; return json(res, 200, pol.body) }
    return json(res, 200)
  }
  switch (url.pathname) {
    case '/type': {
      const text = String(b.text ?? '')
      log({ src: 'ctl', what: 'type', text, paste: !!b.paste, enter: b.enter !== false })
      p.write(b.paste ? `\x1b[200~${text}\x1b[201~` : text)
      if (b.enter !== false) setTimeout(() => { p.write('\r'); log({ src: 'ctl', what: 'enter' }) }, Number(b.delay ?? 150))
      return json(res, 200, { ok: true })
    }
    case '/keys': log({ src: 'ctl', what: 'keys', data: b.data }); p.write(String(b.data)); return json(res, 200, { ok: true })
    case '/screen': { const s = screenText(); log({ src: 'ctl', what: 'screen', screen: s }); res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(s) }
    case '/policy': policy[b.event] = { mode: b.mode, body: b.body, once: b.once }; log({ src: 'ctl', what: 'policy', ...b }); return json(res, 200, policy)
    case '/pending': return json(res, 200, [...pending].map(([id, v]) => ({ id, ev: v.ev, heldMs: Date.now() - v.at, tool: v.b.tool_name, input: v.b.tool_input })))
    case '/answer': {
      const h = pending.get(Number(b.id))
      if (!h) return json(res, 404, { error: 'no such pending hook' })
      pending.delete(Number(b.id))
      log({ src: 'hook', id: Number(b.id), what: 'answered', heldMs: Date.now() - h.at, reply: b.body })
      json(h.res, 200, b.body)
      return json(res, 200, { ok: true })
    }
    case '/watch': watches.set(String(b.token), {}); log({ src: 'ctl', what: 'watch', token: b.token }); return json(res, 200, { ok: true })
    case '/watches': return json(res, 200, Object.fromEntries(watches))
    case '/resize': cols = b.cols | 0; rows = b.rows | 0; p.resize(cols, rows); term.resize(cols, rows); log({ src: 'ctl', what: 'resize', cols, rows }); return json(res, 200, { ok: true })
    case '/quit': json(res, 200, { ok: true }); log({ src: 'ctl', what: 'quit' }); try { p.kill() } catch {} setTimeout(() => process.exit(0), 800); return
    default: return json(res, 404, { error: 'unknown' })
  }
}).listen(port, '127.0.0.1', () => log({ src: 'ctl', what: 'listening', port }))
