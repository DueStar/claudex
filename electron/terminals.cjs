'use strict'

/**
 * terminals.cjs — Claude Code sessions that live inside the app.
 *
 * Every terminal is a real pseudo-console (node-pty / ConPTY) running
 * `claude --session-id <uuid>`, so the session id is known before Claude even
 * starts and the office can tie the terminal, the session and its Pokémon
 * together. The office hooks are attached to these sessions only, through
 * `--settings` (a generated file) — ~/.claude/settings.json is never touched.
 *
 * Input reaches a terminal from two places, both inside the app over IPC: the
 * keyboard in the terminal tab, and an instruction sent from the widget. No
 * HTTP route can write to a terminal.
 */

const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const MAX_BUFFER = 200_000 // characters of scrollback kept for a tab opened later
const DEX_SIZE = 151

function loadPty() {
  // Loaded lazily: a missing native module must not stop the office window
  return require('node-pty')
}

/** The hooks + status line for app sessions, written to userData once per start. */
function writeSessionSettings(repoRoot, dir) {
  const hooksFile = path.join(repoRoot, 'hooks', 'hooks.json')
  const root = repoRoot.split(path.sep).join('/')
  const raw = fs.readFileSync(hooksFile, 'utf8').split('${CLAUDE_PLUGIN_ROOT}').join(root)
  const { hooks } = JSON.parse(raw)
  const settings = {
    hooks,
    statusLine: { type: 'command', command: `bash "${root}/hooks/status-line.sh"` },
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
 */
function cleanEnv(env) {
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k.startsWith('CLAUDE_CODE_')) continue
    out[k] = v
  }
  return out
}

function claudeCommand() {
  if (process.platform !== 'win32') return 'claude'
  const local = path.join(os.homedir(), '.local', 'bin', 'claude.exe')
  return fs.existsSync(local) ? local : 'claude.exe'
}

/**
 * Claude Code is asking the user something it cannot go on without: the
 * folder-trust question at start, a permission prompt, any numbered choice.
 * Read from the terminal's own output (the trust question comes before any
 * hook runs), with the escape codes taken out.
 */
const ASKING = /Do you trust|trust (the files in )?this folder|Do you want to (proceed|make this edit|create|allow|run)|Yes, (proceed|I trust)|[❯>]\s*1\.\s+Yes/i
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g
function plainText(data) { return String(data).replace(ANSI, ' ') }

function createTerminalManager({ repoRoot, userDataDir, send, onExit, defaultCwd, titles = { get: () => null, set: () => {} } }) {
  const terms = new Map() // id -> { id, sessionId, cwd, dex, pty, buffer, status, createdAt, exitCode }
  let settingsFile = null

  function settings() {
    if (!settingsFile) settingsFile = writeSessionSettings(repoRoot, userDataDir)
    return settingsFile
  }

  function info(t) {
    return {
      id: t.id, sessionId: t.sessionId, cwd: t.cwd, project: path.basename(t.cwd),
      dex: t.dex, status: t.status, createdAt: t.createdAt, exitCode: t.exitCode ?? null,
      asking: !!t.asking,
      title: titles.get(t.sessionId) ?? null,
    }
  }

  function broadcastList() { send('terminals:list', list()) }

  function list() { return [...terms.values()].map(info) }

  /** A Pokémon no other open terminal has, else any. */
  function pickDex() {
    const used = new Set([...terms.values()].filter(t => t.status !== 'exited').map(t => t.dex))
    const free = []
    for (let i = 1; i <= DEX_SIZE; i++) if (!used.has(i) && i !== 25) free.push(i) // 25 = the boss
    const pool = free.length ? free : Array.from({ length: DEX_SIZE }, (_, i) => i + 1)
    return pool[crypto.randomInt(pool.length)]
  }

  function create({ cwd, resume, sessionId: wanted } = {}) {
    // No folder picked: the default one (Documents), else home
    const fallback = defaultCwd && fs.existsSync(defaultCwd) ? defaultCwd : os.homedir()
    const dir = cwd && fs.existsSync(cwd) ? cwd : fallback
    // The widget may pick the id itself, so it can dress the session in its Pokémon before the tab shows
    const sessionId = resume || (typeof wanted === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wanted) ? wanted : crypto.randomUUID())
    let command = claudeCommand()
    let args = resume ? ['--resume', resume] : ['--session-id', sessionId]
    args.push('--settings', settings())
    // Debug only: POKEMON_OFFICE_CLAUDE runs another program in place of claude (tests the terminal plumbing for free)
    if (process.env.POKEMON_OFFICE_CLAUDE) { command = process.env.POKEMON_OFFICE_CLAUDE; args = [] }
    const pty = loadPty().spawn(command, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: dir,
      env: { ...cleanEnv(process.env), POKEMON_OFFICE_TERMINAL: sessionId },
      useConpty: true,
    })
    const t = { id: sessionId, sessionId, cwd: dir, dex: pickDex(), pty, buffer: '', status: 'running', createdAt: Date.now() }
    terms.set(t.id, t)
    t.scan = ''
    pty.onData((data) => {
      t.buffer = (t.buffer + data).slice(-MAX_BUFFER)
      send('terminals:data', { id: t.id, data })
      // Only output since the user last answered counts
      t.scan = (t.scan + plainText(data)).slice(-4000)
      if (!t.asking && ASKING.test(t.scan)) { t.asking = true; broadcastList() }
    })
    pty.onExit(({ exitCode }) => {
      t.status = 'exited'
      t.exitCode = exitCode
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

  function setDex(id, dex) {
    const t = terms.get(id)
    if (!t || !Number.isInteger(dex) || dex < 1 || dex > DEX_SIZE) return false
    t.dex = dex
    broadcastList()
    return true
  }

  function close(id) {
    const t = terms.get(id)
    if (!t) return
    if (t.status !== 'exited') { try { t.pty.kill() } catch {} }
    terms.delete(id)
    broadcastList()
  }

  function killAll() {
    for (const t of terms.values()) if (t.status !== 'exited') { try { t.pty.kill() } catch {} }
  }

  return { create, write, sendInstruction, resize, buffer, list, setDex, rename, close, killAll }
}

module.exports = { createTerminalManager, writeSessionSettings, cleanEnv }
