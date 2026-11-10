'use strict'

/**
 * adapters.cjs — the AI coding tools a session can run, and how Claudex
 * learns what each one is doing.
 *
 *   claude   Claude Code: `claude --session-id <uuid> --settings <hooks>`.
 *            Its hooks (hooks/claudex-hook.cjs) send every event to the
 *            server; it resumes by id.
 *   shell    A plain shell (PowerShell on Windows), no AI and no Pokémon: the
 *            game never hears of it. It cannot be resumed.
 *   <tool>   Any other terminal program the trainer lists in 설정 › 세션
 *            (Codex CLI, Gemini CLI, a shell…). Nothing reports from inside
 *            it, so the terminal's own output stands in: output that keeps
 *            coming is work (a step every STEP_MS), a quiet spell ends the
 *            turn, and a yes/no style prompt on screen is "waiting on you".
 *            It cannot be resumed.
 *
 * The game only needs "session started / a step (tool name) / turn over /
 * ended", so a tool without hooks still walks with its Pokémon.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

/** Claude Code asking something it cannot go on without (folder trust, a permission, a numbered choice) */
const CLAUDE_ASKING = /Do you trust|trust (the files in )?this folder|Do you want to (proceed|make this edit|create|allow|run)|Yes, (proceed|I trust)|[❯>]\s*1\.\s+Yes/i
/**
 * Another tool asking for a yes / no or an approval: the common shapes of TUI
 * prompts, plus Codex CLI's ("Would you like to run the following command?",
 * "… needs your approval") and Gemini CLI's ("Apply this change?", "Allow
 * once", "Allow execution of …?") as their sources word them (2026-11)
 */
const GENERIC_ASKING = /\[y\/n\]|\(y\/n\)|\[Y\/n\]|\[y\/N\]|Would you like to (run|make|grant|approve)|needs your approval|Do you want to (approve|proceed|allow)|Apply this change\?|Allow (once|always|for this session|execution of)|Yes, proceed|Proceed\?|press enter to confirm/i

function claudeCommand() {
  if (process.platform !== 'win32') return 'claude'
  const local = path.join(os.homedir(), '.local', 'bin', 'claude.exe')
  return fs.existsSync(local) ? local : 'claude.exe'
}

/**
 * A command line split into program and arguments: spaces separate, double
 * quotes keep a part whole ("C:\Program Files\x\x.exe" --flag).
 */
function splitCommand(line) {
  const parts = []
  let cur = ''
  let quoted = false
  let any = false
  for (const ch of String(line ?? '').trim()) {
    if (ch === '"') { quoted = !quoted; any = true; continue }
    if (!quoted && /\s/.test(ch)) { if (any) { parts.push(cur); cur = ''; any = false } continue }
    cur += ch
    any = true
  }
  if (any) parts.push(cur)
  return parts
}

/**
 * On Windows a bare name like `codex` or `gemini` is usually an npm shim
 * (codex.cmd), which ConPTY cannot start directly: it goes through cmd.exe.
 * A path to an .exe, or a name found as an .exe on PATH, starts as it is.
 */
function spawnable(program, args, env = process.env) {
  if (process.platform !== 'win32') return { file: program, args }
  if (/\.(exe|com)$/i.test(program) && (path.isAbsolute(program) || onPath(program, env))) return { file: program, args }
  if (!path.extname(program) && onPath(`${program}.exe`, env)) return { file: `${program}.exe`, args }
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', program, ...args] }
}

function onPath(name, env) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  return dirs.some(d => { try { return fs.statSync(path.join(d, name)).isFile() } catch { return false } })
}

/** Claude Code: hooks report everything, the session id is chosen up front, it resumes */
const CLAUDE = Object.freeze({
  id: 'claude',
  name: 'Claude Code',
  events: 'hooks',
  canResume: true,
  asking: CLAUDE_ASKING,
  launch({ sessionId, resume, settingsFile, extraArgs = [] }) {
    const args = resume ? ['--resume', resume] : ['--session-id', sessionId]
    args.push('--settings', settingsFile, ...extraArgs)
    return { file: claudeCommand(), args }
  },
})

/** A plain shell: nothing reported, so no Pokémon goes with it */
const SHELL = Object.freeze({
  id: 'shell',
  name: process.platform === 'win32' ? 'PowerShell' : 'Shell',
  events: 'none',
  canResume: false,
  asking: /(?!)/,
  launch() {
    if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] }
    return { file: process.env.SHELL || '/bin/bash', args: ['-l'] }
  },
})

const ID = /^[a-z0-9][a-z0-9-]{0,23}$/

/** A tool the trainer listed: { id, name, command } checked */
function validTool(t) {
  return !!t && typeof t === 'object'
    && typeof t.id === 'string' && ID.test(t.id) && t.id !== 'claude' && t.id !== 'shell'
    && typeof t.name === 'string' && t.name.trim().length > 0 && t.name.length <= 30
    && typeof t.command === 'string' && splitCommand(t.command).length > 0 && t.command.length <= 300
}

/** An adapter for a listed terminal tool: its own output is the only event source */
function terminalAdapter(tool) {
  return Object.freeze({
    id: tool.id,
    name: tool.name.trim(),
    events: 'pty',
    canResume: false,
    asking: GENERIC_ASKING,
    launch() {
      const [program, ...args] = splitCommand(tool.command)
      return spawnable(program, args)
    },
  })
}

/** The adapter for a tool id: Claude Code, or one from the list (unknown ids fall back to Claude Code) */
function adapterFor(id, tools = []) {
  if (!id || id === 'claude') return CLAUDE
  if (id === 'shell') return SHELL
  const tool = (Array.isArray(tools) ? tools : []).find(t => validTool(t) && t.id === id)
  return tool ? terminalAdapter(tool) : CLAUDE
}

/**
 * Output as work, for a tool without hooks. Fed every chunk of output and
 * every keystroke; calls `emit` with the server events:
 *   agent_working     when output starts after a quiet spell, then every STEP_MS while it keeps coming
 *   session_turn_end  after QUIET_MS without output
 *   session_cwd       every HEARTBEAT_MS, so a session left alone is not taken for gone
 * Output right after the trainer typed is the echo of their own keys, not work.
 */
const STEP_MS = 15_000
const QUIET_MS = 8_000
const ECHO_MS = 250
/** A session quiet this long still says it is there (the server ends sessions unheard of for 2 hours) */
const HEARTBEAT_MS = 10 * 60_000
function createActivity({ sessionId, tool, cwd, emit, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, every = setInterval, stopEvery = clearInterval }) {
  const heartbeat = every(() => emit({ type: 'session_cwd', sessionId, cwd }), HEARTBEAT_MS)
  heartbeat?.unref?.()
  let lastKey = -Infinity
  let lastStep = -Infinity
  let working = false
  let quietTimer = null
  function output(chunk) {
    const t = now()
    if (t - lastKey < ECHO_MS && String(chunk).length < 64) return
    if (!working || t - lastStep >= STEP_MS) {
      working = true
      lastStep = t
      emit({ type: 'agent_working', sessionId, tool, status: `${tool} at work` })
    }
    if (quietTimer) clearTimer(quietTimer)
    quietTimer = setTimer(() => {
      quietTimer = null
      if (!working) return
      working = false
      emit({ type: 'session_turn_end', sessionId })
    }, QUIET_MS)
  }
  function input() { lastKey = now() }
  function stop() { if (quietTimer) clearTimer(quietTimer); quietTimer = null; stopEvery(heartbeat) }
  return { output, input, stop }
}

module.exports = { CLAUDE, adapterFor, validTool, terminalAdapter, splitCommand, spawnable, createActivity, STEP_MS, QUIET_MS, CLAUDE_ASKING, GENERIC_ASKING }
