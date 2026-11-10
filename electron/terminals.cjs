'use strict'

/**
 * terminals.cjs — the AI coding sessions that live inside the app.
 *
 * Every terminal is a real pseudo-console (node-pty / ConPTY) running one
 * tool's adapter (adapters.cjs). Claude Code runs as
 * `claude --session-id <uuid>`, so the session id is known before Claude even
 * starts and the server can tie the terminal, the session and its Pokémon
 * together. Claudex's hooks are attached to these sessions only, through
 * `--settings` (a generated file) — ~/.claude/settings.json is never touched.
 * Another tool (설정 › 세션 › AI 도구) reports nothing itself: its output is
 * turned into the same server events here (adapters.createActivity).
 *
 * Input reaches a terminal from two places, both inside the app over IPC: the
 * keyboard in the terminal tab, and an instruction sent from the widget. No
 * HTTP route can write to a terminal.
 */

const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { adapterFor, createActivity } = require('./adapters.cjs')

const MAX_BUFFER = 200_000 // characters of scrollback kept for a tab opened later

function loadPty() {
  // Loaded lazily: a missing native module must not stop the app window
  return require('node-pty')
}

/**
 * End a session's whole process tree at once (Claude Code and whatever it
 * started); resolves when taskkill is done. node-pty's own kill finds the
 * console's processes later, in a forked helper.
 */
function killTreeNow(pid) {
  return new Promise((resolve) => {
    if (!Number.isInteger(pid) || pid <= 0) return resolve()
    try {
      require('child_process').execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, () => resolve())
    } catch { resolve() /* the process is gone already */ }
  })
}

/**
 * The Claude Code events the hook forwards (hooks/claudex-hook.cjs). No
 * matchers: every tool call is a step for the session's Pokémon, and the
 * other events either have no matcher support or are wanted every time.
 */
const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStop', 'SessionStart', 'SessionEnd',
  'UserPromptSubmit', 'Stop', 'PermissionRequest', 'Notification', 'StopFailure', 'PreCompact',
  'PostCompact', 'PostToolBatch', 'CwdChanged', 'PostModelSwitch',
]

/**
 * A command that runs one of hooks/*.cjs with this very app in Node mode
 * (ELECTRON_RUN_AS_NODE), so a session needs nothing installed besides
 * Claude Code: no Python, no curl. Claude Code runs hook commands in its
 * shell (Git Bash on Windows), hence the POSIX form and forward slashes.
 */
function nodeCommand(runtime, script) {
  const slash = (p) => p.split(path.sep).join('/')
  return `ELECTRON_RUN_AS_NODE=1 "${slash(runtime)}" "${slash(script)}"`
}

/** The hooks + status line for app sessions, written to userData once per start. */
function writeSessionSettings(repoRoot, dir, runtime = process.execPath) {
  const hook = nodeCommand(runtime, path.join(repoRoot, 'hooks', 'claudex-hook.cjs'))
  const settings = {
    hooks: Object.fromEntries(HOOK_EVENTS.map(e => [e, [{ hooks: [{ type: 'command', command: hook }] }]])),
    statusLine: { type: 'command', command: nodeCommand(runtime, path.join(repoRoot, 'hooks', 'status-line.cjs')) },
  }
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'session-settings.json')
  fs.writeFileSync(file, JSON.stringify(settings, null, 2))
  return file
}

/**
 * The environment for a new session, without another Claude Code's markers:
 * an app started from inside a Claude Code session would otherwise make every
 * session it opens a "child" of that one (no transcript, no hooks).
 * Claude Code also sets NO_COLOR=1 for the commands it runs; inherited, it
 * turns off every colour and background in the app's sessions, so it goes
 * too when the app was started from inside Claude Code (a NO_COLOR the user
 * set themselves, with no Claude Code around, is kept).
 */
function cleanEnv(env) {
  const out = {}
  const fromClaude = 'CLAUDECODE' in env
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k.startsWith('CLAUDE_CODE_')) continue
    // another app terminal's identity (the app started from inside one of its own sessions)
    if (k === 'CLAUDEX_SESSION_ID' || k === 'CLAUDEX_LINK_FILE') continue
    if (fromClaude && k === 'NO_COLOR') continue
    out[k] = v
  }
  return out
}

/**
 * A session asking the user something it cannot go on without (each adapter's
 * `asking` pattern: for Claude Code the folder-trust question at start, a
 * permission prompt, any numbered choice) is read from the terminal's own
 * output (the trust question comes before any hook runs), escape codes out.
 */
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g
function plainText(data) { return String(data).replace(ANSI, ' ') }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** open-sessions.json, checked: [{ sessionId, cwd, tool }] with real ids and folders that still exist (tool 'claude' when an older file has none) */
function readOpenSessions(file) {
  let raw
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return [] }
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  return raw.filter(s => s && typeof s.sessionId === 'string' && UUID.test(s.sessionId) && typeof s.cwd === 'string'
    && !seen.has(s.sessionId) && seen.add(s.sessionId) && fs.existsSync(s.cwd)).slice(0, 12)
    .map(s => ({ sessionId: s.sessionId, cwd: s.cwd, tool: typeof s.tool === 'string' && /^[a-z0-9-]{1,24}$/.test(s.tool) ? s.tool : 'claude' }))
}

/** Claude Code keeps a session's transcript at ~/.claude/projects/<project>/<id>.jsonl */
function hasTranscript(sessionId, claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) {
  let projects = []
  try { projects = fs.readdirSync(path.join(claudeDir, 'projects')) } catch { return false }
  return projects.some(p => fs.existsSync(path.join(claudeDir, 'projects', p, `${sessionId}.jsonl`)))
}

/**
 * The git branch of the repository `dir` is in (walking up to its .git), the
 * short commit when HEAD is detached, else null. Reads files only: no git run.
 * A worktree's or submodule's `.git` file points at its real git dir.
 */
function gitBranch(dir) {
  let at = path.resolve(String(dir || ''))
  for (let i = 0; i < 40 && at; i++) {
    const dotGit = path.join(at, '.git')
    try {
      let gitDir = dotGit
      if (fs.statSync(dotGit).isFile()) {
        const m = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m)
        if (!m) return null
        gitDir = path.resolve(at, m[1].trim())
      }
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
      const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/)
      if (ref) return ref[1]
      return /^[0-9a-f]{40}$/i.test(head) ? head.slice(0, 7) : null
    } catch { /* no .git here: one folder up */ }
    const up = path.dirname(at)
    if (up === at) break
    at = up
  }
  return null
}

/**
 * The conversation an app terminal last had (its hook writes it at every
 * SessionStart; /clear starts another one in the same terminal): what reopening
 * the terminal resumes. Else '' (never cleared, or an older session).
 */
function linkFile(userDataDir, sessionId) { return path.join(userDataDir, 'session-links', sessionId) }
function linkedConversation(userDataDir, sessionId) {
  try {
    const id = fs.readFileSync(linkFile(userDataDir, sessionId), 'utf8').trim()
    return UUID.test(id) ? id : ''
  } catch { return '' }
}

/**
 * `tools()`: the trainer's other AI tools (설정 › 세션). `emit(event)`: a server
 * event for a session whose tool has no hooks (main posts it to /event).
 */
function createTerminalManager({ repoRoot, userDataDir, send, onExit, defaultCwd, extraArgs = () => [], titles = { get: () => null, set: () => {} }, tools = () => [], emit = () => {}, pty: ptyModule = null, killTree = killTreeNow }) {
  const terms = new Map() // id -> { id, sessionId, cwd, pty, buffer, status, createdAt, exitCode }
  let settingsFile = null
  // The sessions open when the app last closed (open-sessions.json): what the
  // next start may reopen. Read once at start, before this run writes over it.
  const openFile = path.join(userDataDir, 'open-sessions.json')
  let restorable = readOpenSessions(openFile)
  let frozen = false // quitting: the sessions killed on the way out stay listed

  try { fs.mkdirSync(path.join(userDataDir, 'session-links'), { recursive: true }) } catch {}

  function settings() {
    if (!settingsFile) settingsFile = writeSessionSettings(repoRoot, userDataDir)
    return settingsFile
  }

  function info(t) {
    return {
      id: t.id, sessionId: t.sessionId, cwd: t.cwd, project: path.basename(t.cwd),
      status: t.status, createdAt: t.createdAt, exitCode: t.exitCode ?? null,
      asking: !!t.asking,
      tool: t.adapter.id, toolName: t.adapter.name, canResume: t.adapter.canResume,
      title: titles.get(t.sessionId) ?? null,
    }
  }

  function broadcastList() { rememberOpen(); send('terminals:list', list()) }

  /** The running sessions, written on every change (a crash or a kill leaves the last list) */
  function rememberOpen() {
    if (frozen) return
    const open = [...terms.values()].filter(t => t.status !== 'exited').map(t => ({ sessionId: t.sessionId, cwd: t.cwd, tool: t.adapter.id }))
    try { fs.writeFileSync(openFile, JSON.stringify(open)) } catch {}
  }

  /**
   * The sessions to reopen, once per run (a window swap reloads the page and
   * must not reopen them again). A Claude Code one only with a transcript: one
   * that never got a prompt has nothing to resume. Another tool's opens anew
   * in its folder (it cannot resume). None while some are open already.
   */
  function takeRestorable() {
    const out = terms.size ? [] : restorable.filter(s => s.tool !== 'claude' || hasTranscript(linkedConversation(userDataDir, s.sessionId) || s.sessionId))
    restorable = []
    return out
  }

  function list() { return [...terms.values()].map(info) }

  function create({ cwd, resume, sessionId: wanted, tool } = {}) {
    const adapter = adapterFor(tool, tools())
    if (!adapter.canResume) resume = undefined
    // No folder picked: the default one (설정, else Documents), else home
    const def = typeof defaultCwd === 'function' ? defaultCwd() : defaultCwd
    const fallback = def && fs.existsSync(def) ? def : os.homedir()
    const dir = cwd && fs.existsSync(cwd) ? cwd : fallback
    // The widget may pick the id itself, so it can dress the session in its Pokémon before the tab shows
    const sessionId = resume || (typeof wanted === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wanted) ? wanted : crypto.randomUUID())
    // A terminal reopened resumes the conversation it last had (after a /clear, not the one it began with)
    const conversation = resume ? linkedConversation(userDataDir, resume) || resume : undefined
    let { file: command, args } = adapter.launch({ sessionId, resume: conversation, settingsFile: adapter.id === 'claude' ? settings() : null, extraArgs: adapter.id === 'claude' ? extraArgs() : [] })
    // Debug only: CLAUDEX_CLAUDE runs another program in place of claude (tests the terminal plumbing for free)
    if (process.env.CLAUDEX_CLAUDE && adapter.id === 'claude') { command = process.env.CLAUDEX_CLAUDE; args = [] }
    const pty = (ptyModule ?? loadPty()).spawn(command, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: dir,
      // Claude Code's hooks report under the terminal's id, whatever conversation runs in it
      env: adapter.id === 'claude' ? { ...cleanEnv(process.env), CLAUDEX_SESSION_ID: sessionId, CLAUDEX_LINK_FILE: linkFile(userDataDir, sessionId) } : cleanEnv(process.env),
      useConpty: true,
    })
    const t = { id: sessionId, sessionId, cwd: dir, pty, buffer: '', status: 'running', createdAt: Date.now(), adapter }
    t.exited = new Promise((resolve) => { t.markExited = resolve })
    terms.set(t.id, t)
    t.scan = ''
    // A tool without hooks: the server hears of it from here, its output standing in for its events
    if (adapter.events === 'pty') {
      t.activity = createActivity({ sessionId, tool: adapter.name, cwd: dir, emit })
      emit({ type: 'session_started', sessionId, cwd: dir, project: path.basename(dir), source: 'startup', model: adapter.name })
    }
    pty.onData((data) => {
      t.buffer = (t.buffer + data).slice(-MAX_BUFFER)
      send('terminals:data', { id: t.id, data })
      // Only output since the user last answered counts
      t.scan = (t.scan + plainText(data)).slice(-4000)
      if (!t.asking && adapter.asking.test(t.scan)) { t.asking = true; broadcastList() }
      t.activity?.output(data)
    })
    pty.onExit(({ exitCode }) => {
      t.activity?.stop()
      t.status = 'exited'
      t.exitCode = exitCode
      t.markExited()
      broadcastList()
      // Claude killed with its terminal never runs SessionEnd: say it ourselves
      if (onExit) { try { onExit(t.sessionId, exitCode) } catch {} }
    })
    broadcastList()
    return info(t)
  }

  /** The trainer's own name for a session (kept across resumes); empty clears it */
  function rename(id, title) {
    const t = terms.get(id)
    if (!t) return false
    const clean = String(title ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40)
    titles.set(t.sessionId, clean || null)
    broadcastList()
    return true
  }

  function write(id, data) {
    const t = terms.get(id)
    if (!t || t.status === 'exited' || typeof data !== 'string') return false
    t.pty.write(data)
    t.activity?.input()
    // An answer (Enter, or Esc to dismiss) clears the question
    if (/[\r\x1b]/.test(data)) {
      t.scan = ''
      if (t.asking) { t.asking = false; broadcastList() }
    }
    return true
  }

  /**
   * An instruction from the widget: typed into the session as if at the
   * keyboard, then Enter. A multi-line instruction is sent as one paste
   * (bracketed paste) so Claude Code keeps it as a single prompt.
   */
  function sendInstruction(id, text) {
    const t = terms.get(id)
    if (!t || t.status === 'exited') return { ok: false, reason: 'no-session' }
    const clean = String(text ?? '').replace(/\r\n?/g, '\n').trim()
    if (!clean) return { ok: false, reason: 'empty' }
    if (clean.length > 20_000) return { ok: false, reason: 'too-long' }
    t.activity?.input()
    if (clean.includes('\n')) t.pty.write(`\x1b[200~${clean}\x1b[201~`)
    else t.pty.write(clean)
    // Enter a beat later, so the TUI has taken the text in first
    setTimeout(() => { if (t.status !== 'exited') t.pty.write('\r') }, 120)
    return { ok: true }
  }

  function resize(id, cols, rows) {
    const t = terms.get(id)
    if (!t || t.status === 'exited') return
    const c = Math.max(20, Math.min(400, cols | 0))
    const r = Math.max(5, Math.min(200, rows | 0))
    try { t.pty.resize(c, r) } catch {}
    if (process.env.CLAUDEX_DEBUG_RESIZE) console.log(`[terminals] resize ${id.slice(0, 8)} ${c}x${r}`)
  }

  function buffer(id) { return terms.get(id)?.buffer ?? '' }

  function close(id) {
    const t = terms.get(id)
    if (!t) return
    if (t.status !== 'exited') { try { t.pty.kill() } catch {} }
    terms.delete(id)
    broadcastList()
  }

  /** Put a tab at `index` (the tab bar's order, also the order reopened at the next start) */
  function move(id, index) {
    if (!terms.has(id) || !Number.isInteger(index)) return false
    const order = [...terms.values()].filter(t => t.id !== id)
    order.splice(Math.max(0, Math.min(order.length, index)), 0, terms.get(id))
    terms.clear()
    for (const t of order) terms.set(t.id, t)
    broadcastList()
    return true
  }

  /**
   * Quitting: leave nothing of node-pty running when the app tears down (a
   * main quit while it was still busy hung in its native teardown, threads
   * blocked in pipe reads). Each running session's process tree is ended and
   * its exit waited for (at most timeoutMs). Then every pty is killed, which
   * closes its pseudo-console: that ends the read the output worker thread is
   * blocked in (node-pty never stops that worker when the process just exits),
   * and drainMs leaves time for the worker's own drain-then-terminate (1 s).
   * The sessions stay listed as open (frozen), for the next start to reopen.
   */
  async function shutdown(timeoutMs = 3000, drainMs = 1200) {
    frozen = true
    const all = [...terms.values()]
    const running = all.filter(t => t.status !== 'exited')
    if (!all.length) return { exited: 0, stuck: 0 }
    const sleep = (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.() })
    await Promise.race([Promise.all(running.map(t => Promise.resolve().then(() => killTree(t.pty.pid)).catch(() => {}))), sleep(timeoutMs)])
    await Promise.race([Promise.all(running.map(t => t.exited)), sleep(timeoutMs)])
    const stuck = running.filter(t => t.status !== 'exited').length
    for (const t of all) { try { t.pty.kill() } catch {} }
    await sleep(drainMs)
    return { exited: running.length - stuck, stuck }
  }

  return { create, write, sendInstruction, resize, buffer, list, rename, close, move, shutdown, takeRestorable }
}

module.exports = { createTerminalManager, writeSessionSettings, cleanEnv, readOpenSessions, hasTranscript, linkedConversation, gitBranch, HOOK_EVENTS }
