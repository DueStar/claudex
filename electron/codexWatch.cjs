'use strict'

/**
 * codexWatch.cjs — a Codex CLI session, told to Claudex from Codex's own
 * session log.
 *
 * Codex has no hooks or status line Claudex can attach to, but it writes
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
 *   status             context used and Codex's 5-hour / weekly limits (codexLimits)
 *   onThread           the thread id, which reopening the tab resumes (`codex resume <id>`)
 *
 * Only the fields named above are read; nothing else in the log leaves it.
 * The log a tab follows: the one Codex started in the tab's folder after the
 * tab opened (or, resuming, the thread's own, from its end).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

/** Logs some tab already follows: two tabs in one folder never share one */
const claimed = new Set()

const PROMPT_MAX = 2000
const REPLY_MAX = 2000

/** A tool's command line runs Codex CLI (`codex`, `codex.cmd`, `…\codex.exe`, with any arguments) */
function codexTool(tool) {
  const line = String(tool?.command ?? '').trim()
  const program = line.startsWith('"') ? line.slice(1, line.indexOf('"', 1) > 0 ? line.indexOf('"', 1) : undefined) : line.split(/\s+/)[0]
  return /^codex(\.(cmd|exe|ps1))?$/i.test(path.basename(program ?? ''))
}

const samePath = (a, b) => path.resolve(String(a ?? '')).replace(/[\\/]+$/, '').toLowerCase()
  === path.resolve(String(b ?? '')).replace(/[\\/]+$/, '').toLowerCase()

/** The date folders a session started at `t` can be in (that day and the day before, local time) */
function dayDirs(root, t) {
  const out = []
  for (const back of [0, 1]) {
    const d = new Date(t - back * 86_400_000)
    out.push(path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')))
  }
  return out
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

const limit = (w) => (w && typeof w === 'object' && typeof w.used_percent === 'number'
  ? { usedPercent: w.used_percent, windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : null, resetsAt: typeof w.resets_at === 'number' ? w.resets_at : null }
  : null)

function createCodexWatch({ sessionId, cwd, startedAt, resumeThread = null, emit, status, onThread = () => {}, sessionsDir = path.join(os.homedir(), '.codex', 'sessions'), pollMs = 1000, now = () => Date.now() }) {
  let file = null
  let offset = 0
  let partial = ''
  let model = null
  let stopped = false

  function readFirstLine(f) {
    try {
      const fd = fs.openSync(f, 'r')
      try {
        const buf = Buffer.alloc(64 * 1024)
        const n = fs.readSync(fd, buf, 0, buf.length, 0)
        const text = buf.toString('utf8', 0, n)
        const end = text.indexOf('\n')
        return JSON.parse(end >= 0 ? text.slice(0, end) : text)
      } finally { fs.closeSync(fd) }
    } catch { return null }
  }

  function find() {
    const candidates = []
    for (const dir of dayDirs(sessionsDir, resumeThread ? now() : startedAt).concat(resumeThread ? dayDirs(sessionsDir, startedAt) : [])) {
      let names = []
      try { names = fs.readdirSync(dir) } catch { continue }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue
        const f = path.join(dir, name)
        if (claimed.has(f)) continue
        if (resumeThread) { if (name.includes(resumeThread)) candidates.push({ f, at: 0, resume: true }); continue }
        let st
        try { st = fs.statSync(f) } catch { continue }
        if (st.mtimeMs < startedAt - 5000) continue
        const first = readFirstLine(f)
        const meta = first?.type === 'session_meta' ? first.payload : null
        const at = Date.parse(meta?.timestamp ?? first?.timestamp ?? '')
        if (!meta || !samePath(meta.cwd, cwd) || !(at >= startedAt - 5000)) continue
        candidates.push({ f, at, meta })
      }
    }
    if (!candidates.length) return
    candidates.sort((a, b) => a.at - b.at)
    const pick = candidates[0]
    file = pick.f
    claimed.add(file)
    if (pick.resume) {
      // Resuming: the past is the old turns; only what Codex adds from now on is told
      try { offset = fs.statSync(file).size } catch { offset = 0 }
      onThread(resumeThread)
    } else {
      offset = 0
    }
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
        // Codex's own context (<environment_context>, <user_instructions>, …) is not a prompt
        if (text && !text.startsWith('<')) emit({ type: 'session_prompt', sessionId, text: text.slice(0, PROMPT_MAX) })
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
      if (p.type === 'token_count' && p.info) {
        const last = p.info.last_token_usage ?? {}
        const size = typeof p.info.model_context_window === 'number' ? p.info.model_context_window : null
        const total = typeof last.total_tokens === 'number' ? last.total_tokens : null
        const used = size && total !== null ? Math.min(100, Math.round((total / size) * 1000) / 10) : null
        const primary = limit(p.rate_limits?.primary)
        const secondary = limit(p.rate_limits?.secondary)
        status({
          type: 'session_status', sessionId, ...(model ? { model } : {}),
          context: { used, size, input: last.input_tokens ?? 0, output: last.output_tokens ?? 0 },
          ...(primary || secondary ? { codexLimits: { primary, secondary } } : {}),
        })
      }
    }
  }

  function poll() {
    if (stopped) return
    if (!file) { find(); if (!file) return }
    let size
    try { size = fs.statSync(file).size } catch { return }
    if (size < offset) { offset = 0; partial = '' } // rewritten from the start
    if (size === offset) return
    const fd = fs.openSync(file, 'r')
    let text = ''
    try {
      const buf = Buffer.alloc(size - offset)
      fs.readSync(fd, buf, 0, buf.length, offset)
      text = partial + buf.toString('utf8')
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
    if (file) claimed.delete(file)
  }

  return { poll, stop, found: () => !!file }
}

module.exports = { createCodexWatch, codexTool, gameTool }
