'use strict'

/**
 * codexWatch.cjs — a Codex CLI session, told to spawn from Codex's own
 * session log.
 *
 * Codex has no hooks or status line spawn can attach to, but it writes
 * every session to ~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread id>.jsonl
 * as it goes: the session's folder, each turn's start and end, the user's
 * prompts, the tool calls, the model, and token counts with the context
 * window and the plan's usage limits. Tailing that file gives a Codex tab
 * what a Claude Code tab gets from its hooks and status line:
 *
 *   session_prompt     a prompt the user typed (Codex's own context messages are not)
 *   agent_working      a tool call: a step for the session's Pokémon
 *   session_turn_end   the turn is over (its last answer)
 *   session_model      the model in use
 *   status             context used and Codex's usage limits (codexLimits)
 *   onThread           the thread id, which reopening the tab resumes (`codex resume <id>`)
 *
 * Only the fields named above are read from the log a tab follows. Finding
 * it reads the first line (the session header: id, time, folder) of the
 * Codex logs started that day and the day before:
 *   - a new tab: the log Codex started in the tab's folder after the tab
 *     opened. Tabs opened in one folder at once take those logs in the order
 *     they started (one shared matcher, not each tab for itself).
 *   - a reopened tab: its thread's own log, wherever its date folder is,
 *     from its end (the old turns are not told again).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { StringDecoder } = require('string_decoder')

const PROMPT_MAX = 2000
const REPLY_MAX = 2000
/** A log's header may be stamped a little before the tab's own start time */
const SLACK_MS = 2000
/**
 * A log's header is stamped when that Codex started, which is when its tab
 * opened (give or take its start-up); the file itself appears only at the
 * first prompt, maybe much later. A log stamped later than this after a tab
 * opened belongs to another tab.
 */
const MAX_START_GAP_MS = 5 * 60_000
/** Tabs opened this close together cannot be told apart by when their Codex started */
const TOGETHER_MS = 10_000
/** A thread to resume not found this long: its log is gone, so the tab takes the new log Codex starts */
const RESUME_WAIT_MS = 10_000
/** A session header holds the instructions too: read up to this much for it */
const HEADER_MAX = 32 * 1024 * 1024
/** Still nothing found this long after the tab opened (Codex never started, or ran elsewhere): look less often */
const SLOW_AFTER_MS = 60_000
const SLOW_EVERY = 5

/** A tool's command line runs Codex CLI (`codex`, `codex.cmd`, `…\codex.exe`, with any arguments) */
function codexTool(tool) {
  const line = String(tool?.command ?? '').trim()
  const program = line.startsWith('"') ? line.slice(1, line.indexOf('"', 1) > 0 ? line.indexOf('"', 1) : undefined) : line.split(/\s+/)[0]
  return /^codex(\.(cmd|exe|ps1))?$/i.test(path.basename(program ?? ''))
}

const normPath = (p) => path.resolve(String(p ?? '')).replace(/[\\/]+$/, '').toLowerCase()

/** The date folders a session started at `t` can be in (that day and the day before, local time) */
function dayDirs(root, t) {
  const out = []
  for (const back of [0, 1]) {
    const d = new Date(t - back * 86_400_000)
    out.push(path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')))
  }
  return out
}

/** The log of thread `id`, in whichever date folder it lives (newest first) */
function findThreadFile(root, id) {
  const desc = (dir) => { try { return fs.readdirSync(dir).filter(n => /^\d+$/.test(n)).sort((a, b) => Number(b) - Number(a)) } catch { return [] } }
  for (const y of desc(root)) for (const m of desc(path.join(root, y))) for (const d of desc(path.join(root, y, m))) {
    const dir = path.join(root, y, m, d)
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    const hit = names.find(n => n.endsWith('.jsonl') && n.includes(id))
    if (hit) return path.join(dir, hit)
  }
  return null
}

/**
 * A log's session header ({ id, at, cwd }), read up to its first newline;
 * null when it is not one; undefined while the line is still being written.
 * Headers never change, so they are kept by path.
 */
const headers = new Map()
function headerOf(f) {
  if (headers.has(f)) return headers.get(f)
  let fd
  try {
    fd = fs.openSync(f, 'r')
    const chunks = []
    let pos = 0
    for (;;) {
      const buf = Buffer.alloc(64 * 1024)
      const n = fs.readSync(fd, buf, 0, buf.length, pos)
      if (n <= 0) return undefined // no newline yet: Codex is still writing it (not kept: read again later)
      const nl = buf.subarray(0, n).indexOf(0x0a)
      chunks.push(buf.subarray(0, nl >= 0 ? nl : n))
      pos += n
      if (nl >= 0) break
      if (pos > HEADER_MAX) { headers.set(f, null); return null }
    }
    let rec = null
    try { rec = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* not a session log */ }
    const meta = rec?.type === 'session_meta' ? rec.payload : null
    const at = Date.parse(meta?.timestamp ?? rec?.timestamp ?? '')
    const out = meta && meta.cwd && Number.isFinite(at) ? { id: String(meta.id ?? ''), at, cwd: normPath(meta.cwd) } : null
    headers.set(f, out)
    return out
  } catch {
    return undefined // busy or gone right now: not kept, tried again at the next look
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch {}
  }
}

/** Codex's tool names as the game's terrains know them */
function gameTool(name) {
  const n = String(name ?? '')
  if (/^(exec|exec_command|shell|local_shell|container\.exec|unified_exec)$/i.test(n)) return 'Bash'
  if (/^apply_patch$/i.test(n)) return 'Edit'
  if (/^(web_search|web\.run)$/i.test(n)) return 'WebSearch'
  if (/^(read_file|view_image)$/i.test(n)) return 'Read'
  return n || 'tool'
}

/** The command of an exec-style call, for the catch story (first line, as Claude Code's Bash shows it) */
function commandOf(p) {
  let input = p.input
  if (input === undefined && typeof p.arguments === 'string') {
    try { const a = JSON.parse(p.arguments); input = Array.isArray(a.command) ? a.command.join(' ') : a.command ?? a.cmd } catch { input = '' }
  }
  if (p.type === 'local_shell_call') input = Array.isArray(p.action?.command) ? p.action.command.join(' ') : ''
  return String(input ?? '').split(/\r?\n/)[0].trim().slice(0, 60)
}

const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter(c => c && (c.type === 'input_text' || c.type === 'output_text' || c.type === 'text'))
  .map(c => String(c.text ?? '')).join('\n').trim()

/** Codex's own context it sends as user messages: not something the user typed */
const INJECTED = /^(<[a-z_]+>|# AGENTS\.md instructions)/i

const limit = (w) => (w && typeof w === 'object' && typeof w.used_percent === 'number'
  ? { usedPercent: w.used_percent, windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : null, resetsAt: typeof w.resets_at === 'number' ? w.resets_at : null }
  : null)

// ---- One matcher for every tab still looking for its log ----

/** Logs some open tab follows */
const claimed = new Set()
/** Logs a closed tab followed: never handed to a new tab (it would replay them), but a tab may resume one */
const retired = new Set()
/** Tabs still looking: { root, cwd, startedAt, take(file) } */
const waiting = new Set()

/**
 * Hand new logs to the tabs waiting for them: per folder, the logs in the
 * order they started go to the tabs in the order they opened, each log to
 * the first tab that opened before it (less the slack).
 */
function match() {
  const byFolder = new Map()
  for (const w of waiting) {
    const key = `${w.root}|${w.cwd}`
    if (!byFolder.has(key)) byFolder.set(key, [])
    byFolder.get(key).push(w)
  }
  for (const tabs of byFolder.values()) {
    tabs.sort((a, b) => a.startedAt - b.startedAt)
    const earliest = tabs[0].startedAt
    const logs = []
    for (const dir of new Set(tabs.flatMap(w => dayDirs(w.root, w.startedAt)))) {
      let names = []
      try { names = fs.readdirSync(dir) } catch { continue }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue
        const f = path.join(dir, name)
        if (claimed.has(f) || retired.has(f)) continue
        const h = headerOf(f)
        if (!h || h.cwd !== tabs[0].cwd || h.at < earliest - SLACK_MS) continue
        logs.push({ f, h })
      }
    }
    logs.sort((a, b) => a.h.at - b.h.at)
    for (const log of logs) {
      // The tab opened last before that Codex started; tabs opened within moments of each other
      // cannot be told apart by time, and take their logs in the order they opened
      const fits = tabs.filter(w => waiting.has(w) && log.h.at >= w.startedAt - SLACK_MS && log.h.at <= w.startedAt + MAX_START_GAP_MS)
      if (!fits.length) continue
      const latest = fits[fits.length - 1].startedAt
      const tab = fits.find(w => w.startedAt >= latest - TOGETHER_MS)
      if (!tab) continue
      claimed.add(log.f)
      waiting.delete(tab)
      tab.take(log.f)
    }
  }
}

function createCodexWatch({ sessionId, cwd, startedAt, resumeThread: resumeAsked = null, emit, status, onThread = () => {}, sessionsDir = path.join(os.homedir(), '.codex', 'sessions'), pollMs = 1000, now = () => Date.now() }) {
  let file = null
  let offset = 0
  let decoder = new StringDecoder('utf8')
  let partial = ''
  let model = null
  let stopped = false
  let polls = 0
  let resumeThread = resumeAsked

  const me = {
    root: sessionsDir,
    cwd: normPath(cwd),
    startedAt,
    take(f) { file = f; offset = 0 },
  }
  if (!resumeThread) waiting.add(me)

  function findResumed() {
    const f = findThreadFile(sessionsDir, resumeThread)
    if (!f || claimed.has(f)) return
    retired.delete(f)
    claimed.add(f)
    file = f
    // Resuming: the past is the old turns; only what Codex adds from now on is told
    try { offset = fs.statSync(f).size } catch { offset = 0 }
    onThread(resumeThread)
  }

  function handle(rec) {
    const p = rec?.payload ?? {}
    if (rec?.type === 'session_meta') {
      if (p.id) onThread(String(p.id))
      return
    }
    if (rec?.type === 'turn_context') {
      if (p.model && p.model !== model) { model = String(p.model); emit({ type: 'session_model', sessionId, model }) }
      return
    }
    if (rec?.type === 'response_item') {
      if (p.type === 'message' && p.role === 'user') {
        const text = textOf(p.content)
        if (text && !INJECTED.test(text)) emit({ type: 'session_prompt', sessionId, text: text.slice(0, PROMPT_MAX) })
        return
      }
      if (p.type === 'custom_tool_call' || p.type === 'function_call' || p.type === 'local_shell_call') {
        const tool = p.type === 'local_shell_call' ? 'Bash' : gameTool(p.name)
        const command = tool === 'Bash' ? commandOf(p) : ''
        const status = tool === 'Bash' ? (command ? `running: ${command}` : 'running') : tool === 'Edit' ? 'editing' : `using ${p.name ?? tool}`
        emit({ type: 'agent_working', sessionId, tool, status })
      }
      return
    }
    if (rec?.type === 'event_msg') {
      if (p.type === 'task_complete') {
        emit({ type: 'session_turn_end', sessionId, text: String(p.last_agent_message ?? '').slice(0, REPLY_MAX), backgroundTasks: [], crons: 0 })
        return
      }
      if (p.type === 'token_count') {
        const primary = limit(p.rate_limits?.primary)
        const secondary = limit(p.rate_limits?.secondary)
        const limits = primary || secondary ? { codexLimits: { primary, secondary } } : {}
        if (p.info) {
          const last = p.info.last_token_usage ?? {}
          const size = typeof p.info.model_context_window === 'number' ? p.info.model_context_window : null
          const total = typeof last.total_tokens === 'number' ? last.total_tokens : null
          const used = size && total !== null ? Math.min(100, Math.round((total / size) * 1000) / 10) : null
          status({ type: 'session_status', sessionId, ...(model ? { model } : {}), context: { used, size, input: last.input_tokens ?? 0, output: last.output_tokens ?? 0 }, ...limits })
        } else if (primary || secondary) {
          status({ type: 'session_status', sessionId, ...(model ? { model } : {}), ...limits })
        }
      }
    }
  }

  function poll() {
    if (stopped) return
    if (!file) {
      polls++
      if (now() - startedAt > SLOW_AFTER_MS && polls % SLOW_EVERY !== 0) return
      if (resumeThread) {
        findResumed()
        if (!file && now() - startedAt > RESUME_WAIT_MS) { resumeThread = null; waiting.add(me) }
      }
      if (!resumeThread && !file) match()
      if (!file) return
    }
    let size
    try { size = fs.statSync(file).size } catch { return }
    if (size < offset) { offset = 0; partial = ''; decoder = new StringDecoder('utf8') } // rewritten from the start
    if (size === offset) return
    const fd = fs.openSync(file, 'r')
    let text = ''
    try {
      const buf = Buffer.alloc(size - offset)
      fs.readSync(fd, buf, 0, buf.length, offset)
      // A character split across two reads waits in the decoder for its last bytes
      text = partial + decoder.write(buf)
    } finally { fs.closeSync(fd) }
    offset = size
    const lines = text.split('\n')
    partial = lines.pop() ?? ''
    for (const l of lines) {
      if (!l.trim()) continue
      let rec
      try { rec = JSON.parse(l) } catch { continue }
      try { handle(rec) } catch { /* one odd record must not stop the rest */ }
    }
  }

  const timer = pollMs > 0 ? setInterval(() => { try { poll() } catch { /* the log moved or vanished: try again */ } }, pollMs) : null
  timer?.unref?.()

  function stop() {
    stopped = true
    if (timer) clearInterval(timer)
    waiting.delete(me)
    // Handed to a tab still waiting, the log would replay this tab's session as its own: retired, not freed
    if (file) { claimed.delete(file); retired.add(file) }
  }

  return { poll, stop, found: () => !!file }
}

module.exports = { createCodexWatch, codexTool, gameTool }
