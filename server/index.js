/**
 * Claudex server — the local HTTP + WebSocket server behind the app.
 *
 * Runs on 127.0.0.1:3334, or AGENT_OFFICE_PORT (server/config.js).
 * - The app's page connects via ws://127.0.0.1:<port>/ws
 * - The Claude Code hook (hooks/agent-tracker.sh) POSTs to /event, the status
 *   line (hooks/status-line.sh) to /status
 * - GET /sessions lists the Claude Code sessions, hooked ones and the ones only
 *   Claude Code's session registry knows about (server/sessions.js)
 * - The game (server/pokedex.js), the Pokémon artwork (server/sprites.js) and
 *   the cloud copy of the game (server/cloud.js)
 */

import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { readFileSync, existsSync, writeFileSync, mkdirSync, realpathSync, chmodSync, unlinkSync, openSync, fstatSync, closeSync, constants as fsConstants } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { randomBytes, timingSafeEqual, createHmac } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { mountStatus } from './status.js'
import { mountRegistry, pidAlive } from './sessions.js'
import { mountSprites } from './sprites.js'
import { createPokedex, STEP_SPACING_MS } from './pokedex.js'
import { createCloud } from './cloud.js'
import { mountHealth, readVersion } from './health.js'
import { readPort, readUiPort, readHost } from './config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// The port and the Vite dev port come from AGENT_OFFICE_PORT /
// AGENT_OFFICE_UI_PORT (server/config.js); the bind host is read in start().
const PORT = readPort()
const UI_DEV_PORT = readUiPort()

// ---------------------------------------------------------------------------
// Runtime dir + auth token
//
// Everything the server writes (auth token, agents.json, pokedex.json, the
// cloud session) lives in ~/.agent-office, or AGENT_OFFICE_HOME when set
// (tests point it at a temp dir). The token is read or generated here but
// only written to disk by start(), once the port is bound, so importing this
// module has no side effects outside RUNTIME_DIR and a second instance that
// loses the port race never clobbers the running instance's token.
//
// Threat model. The server only listens on loopback (127.0.0.1;
// AGENT_OFFICE_HOST may spell it 127.0.0.1 or localhost, anything else is
// refused by readHost, with the reason, and 127.0.0.1 is bound). Browsers on other
// origins are kept out by the origin allowlist below (every other origin
// gets 403 / a 1008 close) and by the JSON content type, which makes
// cross-site POSTs preflight. What is left is any other process on this
// machine — another local user's included — which can reach the port freely
// and send any Origin it likes (Origin only binds browsers). So the one
// secret that separates this user from the rest is the bearer token in
// ~/.agent-office/auth-token, the 0600 file only this user can read: the
// hook, the status line and the desktop app send it (the hook signs with it,
// see "Request signing"), and the app's page gets it in its URL fragment and
// presents it when it opens the WebSocket. Everything that reports a session,
// changes the game or signs in needs it, and so does conversation text.
//
//   token required   POST /event, /status, /pokedex/*, /auth/start|signout|sync
//   open             every GET; the WebSocket without the token (no
//                    conversation text, see below)
//
// The token is stable across restarts: a start reuses the one in the file
// when the file is still safe to trust (readTokenFile), so a page that
// remembered it keeps working after the server restarts. `npm run
// rotate-token` deletes the file, and the next start writes a new one.
// ---------------------------------------------------------------------------

const RUNTIME_DIR = process.env.AGENT_OFFICE_HOME || join(homedir(), '.agent-office')
try { mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 }) } catch {}
// mkdirSync's mode is ignored when the dir already exists, so a dir an older
// build left group/world-readable keeps those bits. Tighten it to 0700.
try { chmodSync(RUNTIME_DIR, 0o700) } catch {}
const TOKEN_FILE = join(RUNTIME_DIR, 'auth-token')
// What the server writes: 32 random bytes as 64 lowercase hex digits
const TOKEN_PATTERN = /^[0-9a-f]{64}$/

/**
 * The token a previous start left in `file`, if it is still safe to keep
 * using: a regular file (a symlink is not followed), owned by this user,
 * with no group or other permission bits, holding a well-formed token.
 * Anything else — missing, malformed, readable by others, someone else's —
 * is null, and the server mints a new token instead. The file is opened
 * once and checked through that descriptor, so it cannot be swapped between
 * the check and the read. Windows has no uid or mode bits to check.
 */
function readTokenFile(file = TOKEN_FILE) {
  let fd
  try {
    fd = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    const st = fstatSync(fd)
    if (!st.isFile()) return null
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return null
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) return null
    const token = readFileSync(fd, 'utf8').trim()
    return TOKEN_PATTERN.test(token) ? token : null
  } catch {
    return null
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch {}
  }
}

const REUSED_TOKEN = readTokenFile()
const AUTH_TOKEN = REUSED_TOKEN ?? randomBytes(32).toString('hex')

/**
 * Write a file only this user can read. The mode applies when the file is
 * created, so a file an older version left world-readable is fixed as well.
 */
function writePrivate(path, data) {
  writeFileSync(path, data, { mode: 0o600 })
  try { chmodSync(path, 0o600) } catch {}
}

/**
 * Repair the runtime dir so another local user cannot read it: mkdirSync's
 * mode applies only when it creates the dir. No-op on Windows.
 */
function repairPrivateModes() {
  if (process.platform === 'win32') return
  try { chmodSync(RUNTIME_DIR, 0o700) } catch {}
}

/**
 * Put AUTH_TOKEN in the token file (after listen). A reused token is already
 * there. A new one replaces whatever the file was — unlinked first and then
 * created exclusively, so a symlink or a file owned by someone else is
 * replaced rather than written through.
 */
function writeTokenFile() {
  if (readTokenFile() === AUTH_TOKEN) return
  try {
    try { unlinkSync(TOKEN_FILE) } catch (err) { if (err.code !== 'ENOENT') throw err }
    writeFileSync(TOKEN_FILE, AUTH_TOKEN, { mode: 0o600, flag: 'wx' })
    try { chmodSync(TOKEN_FILE, 0o600) } catch {}
  } catch (err) {
    console.warn('[auth] Could not write token file:', err.message)
  }
}

/**
 * The server's answer to an opener's /health challenge: HMAC-SHA256 of the
 * token over 'office-health:' + challenge. Only a holder of the token can
 * make it, so an opener knows it is about to hand the token to this office
 * and not to a process that took the port while the office was down.
 */
function officeProof(token, challenge) {
  return createHmac('sha256', token).update(`office-health:${challenge}`).digest('hex')
}

/** Constant-time comparison of a supplied token with ours. */
function tokenMatches(supplied) {
  if (typeof supplied !== 'string' || supplied.length === 0) return false
  const a = Buffer.from(supplied, 'utf8')
  const b = Buffer.from(AUTH_TOKEN, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearerToken(req) {
  const header = req.headers['authorization'] ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

// ---------------------------------------------------------------------------
// Request signing — how the hook proves it holds the token without ever
// putting it on a command line
//
// The hook (and status line) run as short-lived processes whose argv every
// local user can read in `ps` / /proc/<pid>/cmdline. A bearer token on that
// argv leaks to anyone on the machine, and since the token is stable across
// restarts (#41) the leak stays useful — a port squatter that answered the
// first POST while the office was down would own the token for good. So the
// hook no longer sends the token at all: it signs each request with
// HMAC-SHA256(token, method\npath\ntimestamp\nbody) and sends the timestamp
// and the signature as headers. A reader of the argv sees only a signature
// bound to one method, path, body and minute — useless beyond replaying that
// exact request inside the window, which is the victim's own event. The
// token stays in the 0600 file (and, for the hook, in its own process memory
// / environment, which only its owner can read), never on a command line.
//
// The server accepts a request to a token-guarded route when it carries
// either a valid bearer token (the app sends it from its own memory, not
// argv) or a valid signature whose timestamp is within SIGNATURE_WINDOW_MS.
// Both checks are constant-time.
// ---------------------------------------------------------------------------

/** ±1 minute: wide enough for clock skew, narrow enough that a leaked signature expires fast. */
const SIGNATURE_WINDOW_MS = 60_000

/** HMAC-SHA256(token, canonical request) as the hook computes it. The key is the token string's bytes. */
function requestSignature(method, path, timestamp, rawBody) {
  const h = createHmac('sha256', AUTH_TOKEN)
  h.update(`${method}\n${path}\n${timestamp}\n`)
  h.update(rawBody && rawBody.length ? rawBody : Buffer.alloc(0))
  return h.digest()
}

/**
 * True when the request carries a signature this server's token would
 * produce over the raw body, for a timestamp within the window. `req.rawBody`
 * is captured by express.json's verify hook (the exact bytes the hook signed);
 * it is empty for a GET, which signs an empty body.
 */
function signatureValid(req) {
  const ts = req.headers['x-office-timestamp']
  const sig = req.headers['x-office-signature']
  if (typeof ts !== 'string' || typeof sig !== 'string' || !/^[0-9a-f]+$/.test(sig)) return false
  const tnum = Number(ts)
  if (!Number.isFinite(tnum) || Math.abs(Date.now() - tnum) > SIGNATURE_WINDOW_MS) return false
  const given = Buffer.from(sig, 'hex')
  const expected = requestSignature(req.method, req.originalUrl, ts, req.rawBody)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** A caller proved it holds the token: a valid bearer token, or a valid request signature. */
function tokenAuthed(req) {
  return tokenMatches(bearerToken(req)) || signatureValid(req)
}

function unauthorized(res, body) {
  res.setHeader('WWW-Authenticate', 'Bearer realm="agent-office"')
  return res.status(401).json(body)
}

/** Express middleware: the route needs the office's token (bearer or a valid signature). */
function requireToken(req, res, next) {
  if (tokenAuthed(req)) return next()
  unauthorized(res, { error: 'Unauthorized' })
}

/** Same, answering in the JSON-RPC envelope for the A2A endpoint. */
// ---------------------------------------------------------------------------
// Allowed origins
//
// The office UI is served from this server (PORT, 3334 by default: `npm run
// build`, the packaged desktop app) or from the Vite dev server (UI_DEV_PORT,
// 3333 by default), and browsers reach either as localhost, 127.0.0.1 or ::1
// — the Origin header spells it whichever way the page was opened, so match
// the loopback host rather than a fixed string. Anything else (other ports,
// `null`, `file://`) is refused. 3333 stays allowed next to a configured
// AGENT_OFFICE_UI_PORT: `npm run dev` ignores that variable and still opens
// Vite on 3333 (vite.config.ts).
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const ALLOWED_ORIGIN_PORTS = new Set([String(UI_DEV_PORT), '3333', String(PORT)])

function isAllowedOrigin(origin) {
  if (!origin) return true  // no Origin header: curl, the hook script, same-origin GETs
  try {
    const { protocol, hostname, port } = new URL(origin)
    return protocol === 'http:' && LOOPBACK_HOSTS.has(hostname) && ALLOWED_ORIGIN_PORTS.has(port)
  } catch {
    return false  // not a URL (`null`)
  }
}

// ---------------------------------------------------------------------------
// Host-header guard — defeats DNS rebinding
//
// The origin allowlist keeps cross-origin browser requests out, but a
// same-origin GET from a page the browser rebound to 127.0.0.1 carries no
// Origin header (the Fetch spec adds Origin only to CORS-tainted or
// non-GET/HEAD requests). Such a request would otherwise read every open GET
// — the pending command lines on GET /permissions, cwds and titles on
// GET /sessions, agent tasks on GET /agents. What it cannot forge is the Host
// header the browser sends: a rebinding page's Host is still its own domain.
// So every request must name a loopback host (any port: Vite proxies as
// localhost:3333, Electron loads 127.0.0.1:<port>); anything else is 421.
// ---------------------------------------------------------------------------

/** The host name of a Host header, port stripped, brackets kept for IPv6 ([::1]:3334 -> [::1]). */
function hostName(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return ''
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']')
    return end === -1 ? hostHeader : hostHeader.slice(0, end + 1)
  }
  const colon = hostHeader.indexOf(':')
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon)
}

/** A request is served only when its Host names a loopback host; guards against DNS rebinding. */
function isAllowedHost(hostHeader) {
  return LOOPBACK_HOSTS.has(hostName(hostHeader))
}

// ---------------------------------------------------------------------------
// Built UI
//
// `vite build` writes the React app, plus everything in public/, to dist/.
// When that directory exists the server serves it from its root, so
// http://127.0.0.1:<PORT>/ is the whole app on one port: the packaged
// Electron app loads this URL, and `npm run build && npm run server` works in
// a plain browser. `npm run dev` keeps using Vite on 3333 instead. Tests point
// AGENT_OFFICE_UI_DIR at a temp dir.
// ---------------------------------------------------------------------------

const UI_DIR = process.env.AGENT_OFFICE_UI_DIR || join(__dirname, '..', 'dist')
const UI_AVAILABLE = existsSync(join(UI_DIR, 'index.html'))

const VERSION = readVersion()

// Sessions nothing has been heard from for this long are assumed gone (a
// missed SessionEnd, Claude Code killed) and are ended by the stale sweep.
const STALE_SESSION_MS = (Number(process.env.AGENT_OFFICE_STALE_MINUTES) || 120) * 60_000

// ---------------------------------------------------------------------------
// Session tracking — one Claude Code session (terminal) per session_id
//
// Every hook payload carries session_id / cwd / transcript_path, which the
// tracker forwards as sessionId / project / cwd / transcriptPath on every
// event. A session the server has not seen is created implicitly by its
// first event (hooks installed mid-session, server restarted).
//
// Sessions without hooks. Claude Code's own session registry
// (~/.claude/sessions/<pid>.json, server/sessions.js) lists every running
// CLI process, so a session shows up here before (or without) the hooks
// being installed: `hooked: false`, `registry: { pid, name, status, ... }`
// and a `main` mapped from the registry status. Such a record is not
// persisted (the registry rebuilds it) and never swept as stale while its
// process is alive; the first hook event from it flips it to hooked
// (hookSession), same id, and from then on the hooks are the truth. A
// hooked session with a live registry entry carries `registry` too, as
// presence only.
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} sessionId -> session record */
const sessions = new Map()

// Claude Code's config dir (CLAUDE_CONFIG_DIR moves it) holds the registry;
// tests point AGENT_OFFICE_REGISTRY_DIR at a temp dir
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const REGISTRY_DIR = process.env.AGENT_OFFICE_REGISTRY_DIR || join(CLAUDE_DIR, 'sessions')

/** @type {Map<string, ReturnType<typeof setTimeout>>} sessionId -> timer that forgets an ended session */
const sessionTimers = new Map()

// An ended session stays listed (state 'ended') this long so UIs can show it leaving
const SESSION_FORGET_MS = 60_000

// ---------------------------------------------------------------------------
// The session's own Claude — `main` on every session record
//
// Each session has the Claude the trainer talks to. The tracker reports its turn from the main-thread hooks (UserPromptSubmit,
// PreToolUse, Stop, PermissionRequest, Notification, StopFailure,
// Pre/PostCompact) and the server keeps one record per session:
//
//   main: {
//     state:       'working' | 'waiting' | 'idle' | 'needs-you' | 'error' | 'compacting',
//     since:       when it entered that state,
//     lastPrompt,  lastPromptAt,     the trainer's last prompt (PROMPT_TEXT_MAX chars)
//     lastReply,   lastReplyAt,      Claude's last reply (Stop.last_assistant_message, as clamped)
//     waitingOn:   background tasks still running when the turn ended,
//     needsYou?:   { kind, toolName?, summary?, message?, notificationType?, since, promptId? },
//     error?:      { error, detail, since },
//     promptId?:   the current prompt (Claude Code's prompt_id)
//   }
//
// Transitions: session_prompt -> working (clears needs-you); a main-thread
// agent_working -> working; session_needs_you -> needs-you; session_turn_end
// -> waiting when a background task is still running, else idle;
// session_error -> error; session_compact pre -> compacting, post -> the
// state before; session_ended and a resume reset it. Each change logs one
// `[main]` line. The record travels on GET /sessions, the WS snapshot and
// every session_* broadcast, and persists with the session.
// ---------------------------------------------------------------------------

const MAIN_STATES = new Set(['working', 'waiting', 'idle', 'needs-you', 'error', 'compacting'])
const NEEDS_YOU_KINDS = new Set(['permission', 'idle', 'quota', 'agent-input'])
// Needs-you timing:
// - a wait is applied and announced only after NEEDS_YOU_DEBOUNCE_MS: in a
//   headless (-p) session a PermissionRequest is auto-denied and its
//   PostToolBatch follows ~60 ms later, which would make the hand flap
// - PermissionRequest fires at once and Notification{permission_prompt} ~6 s
//   later for the same dialog: a repeat within NEEDS_YOU_DEDUPE_MS is the same wait
// - PreToolUse fires ~70 ms before the PermissionRequest of the same call and
//   the hook's POSTs are backgrounded, so the two can arrive in either order:
//   a working event does not lower a hand raised less than PERMISSION_RACE_MS ago
// - a hand nobody answers comes down by itself after NEEDS_YOU_TIMEOUT_MS
//   (re-armed for what is left of it when a hand is restored from agents.json)
//
// Which call a permission wait belongs to. A PermissionRequest carries no
// tool_use_id, so the hook sends a `callKey` instead — a hash of the call's
// tool name and tool input, which its PostToolUse carries too — and the
// subagent's agent_id when a worker asked. A wait is answered only by its own
// thread (the worker that asked, or the main thread) and, for a single call,
// only by that call: tool name and callKey alike. Another call of the same
// tool finishing beside it (`git status` next to the `git push` that asked,
// a parallel read) says nothing about the dialog. A batch ending answers
// every wait of its thread; a worker's next tool call past the race window,
// or its completion, answers the ones it raised; main-thread activity never
// answers a worker's. A turn boundary (Stop, a prompt, an API error, the
// session ending) still answers everything.
const NEEDS_YOU_DEBOUNCE_MS = 300
const NEEDS_YOU_DEDUPE_MS = 10_000
const PERMISSION_RACE_MS = 1_000
const NEEDS_YOU_TIMEOUT_MS = 10 * 60_000
// Stop.background_tasks statuses that mean the task is still in flight
const TASK_IN_FLIGHT = /^(running|pending)$/i

/** @type {Map<string, {wait: object, agentId?: string, timer: ReturnType<typeof setTimeout>}>} sessionId -> needs-you waiting out the debounce */
const pendingNeedsYou = new Map()
/** @type {Map<string, ReturnType<typeof setTimeout>>} sessionId -> timer that lowers a hand nobody answered */
const needsYouTimers = new Map()
/**
 * A wait (parked, or main.needsYou) -> the call behind it: { agentId?, callKey?,
 * before? } — the raw subagent id that asked, the hook's callKey, and the main
 * state the hand went up from. Kept off the wait itself, which is broadcast and
 * persisted; a hand restored from agents.json has none and is matched by tool
 * name alone, as before.
 * @type {WeakMap<object, {agentId?: string, callKey?: string, before?: string}>}
 */
const waitCalls = new WeakMap()

const callOf = wait => (wait && waitCalls.get(wait)) || {}

/** Whether two raw thread ids name the same thread: both absent is the main thread. */
function sameThread(a, b) {
  if (!a && !b) return true
  return a === b
}

/** The same call by callKey, when both sides have one (an older hook sends none). */
function sameCallKey(a, b) {
  return !a || !b || a === b
}

function cancelPendingNeedsYou(sessionId) {
  const pending = pendingNeedsYou.get(sessionId)
  if (!pending) return null
  clearTimeout(pending.timer)
  pendingNeedsYou.delete(sessionId)
  return pending
}

function clearNeedsYouTimer(sessionId) {
  const timer = needsYouTimers.get(sessionId)
  if (!timer) return
  clearTimeout(timer)
  needsYouTimers.delete(sessionId)
}

function newMain(now = Date.now()) {
  return { state: 'idle', since: now, waitingOn: 0 }
}

/** A session's main record, created on first use (sessions restored from an older agents.json). */
function mainOf(session, now = Date.now()) {
  if (!session.main) session.main = newMain(now)
  return session.main
}

/** A persisted main record, or a fresh one when the file predates it or holds junk. */
function restoredMain(main) {
  if (!main || typeof main !== 'object' || !MAIN_STATES.has(main.state)) return newMain()
  return { ...main, waitingOn: Number.isInteger(main.waitingOn) ? main.waitingOn : 0 }
}

function sessionName(session) {
  return session.project ?? session.id
}

/**
 * Move a session's Claude to `state`. Stamps `since` and logs one line only
 * on a change; returns whether the state changed.
 */
function setMainState(session, state, reason, now = Date.now()) {
  const main = mainOf(session, now)
  if (main.state === state) return false
  if (main.state === 'needs-you') clearNeedsYouTimer(session.id)
  console.log(`[main] ${sessionName(session)}: ${main.state} -> ${state}${reason ? ` (${reason})` : ''}`)
  main.state = state
  main.since = now
  return true
}

/** The label a needs-you wait gets in the log. */
function needsYouLabel(wait) {
  if (wait.kind === 'permission') return `permission: ${[wait.toolName, wait.summary].filter(Boolean).join(' ') || wait.message || 'tool call'}`
  return `${wait.kind}${wait.notificationType ? ` / ${wait.notificationType}` : ''}${wait.message ? `: ${wait.message}` : ''}`
}

/** A server-side change to main (a hand lowered by a tool result or a timeout) as a broadcast. */
function mainEvent(session, reason, now = Date.now()) {
  return { type: 'session_main', sessionId: session.id, project: session.project, reason, main: { ...session.main }, timestamp: now }
}

/** Lower a hand nobody answered within NEEDS_YOU_TIMEOUT_MS (`delayMs`: what is left of it, for a restored hand). */
function armNeedsYouTimeout(session, delayMs = NEEDS_YOU_TIMEOUT_MS) {
  clearNeedsYouTimer(session.id)
  const since = session.main.needsYou?.since
  const timer = setTimeout(() => {
    needsYouTimers.delete(session.id)
    const current = sessions.get(session.id)
    if (!current || current.main?.state !== 'needs-you' || current.main.needsYou?.since !== since) return
    delete current.main.needsYou
    setMainState(current, 'idle', `needs-you unanswered for ${NEEDS_YOU_TIMEOUT_MS / 60_000} min`)
    saveSessions()
    broadcast(mainEvent(current, 'needs-you timed out'))
  }, Math.max(0, delayMs))
  timer.unref?.()
  needsYouTimers.set(session.id, timer)
}

/**
 * The debounce ran out: the wait parked by session_needs_you is still
 * unanswered, so it becomes the session's state and is announced.
 */
function applyNeedsYou(sessionId) {
  const pending = cancelPendingNeedsYou(sessionId)
  const session = sessions.get(sessionId)
  if (!pending || !session || session.state === 'ended') return
  const now = Date.now()
  const main = mainOf(session, now)
  const wait = pending.wait
  // The state to go back to when the worker that asked moves on (a hand raised over a hand keeps the first one's)
  const before = main.state === 'needs-you' ? callOf(main.needsYou).before : main.state
  main.needsYou = { ...wait }
  waitCalls.set(main.needsYou, { ...callOf(wait), before })
  if (wait.promptId) main.promptId = wait.promptId
  delete main.error
  delete main.beforeCompact
  const label = needsYouLabel(wait)
  if (!setMainState(session, 'needs-you', label, now)) console.log(`[main] ${sessionName(session)}: needs-you again (${label})`)
  armNeedsYouTimeout(session)
  saveSessions()
  // A request raised inside a subagent names it
  const agentId = pending.agentId
  broadcast({
    type: 'session_needs_you',
    sessionId: session.id,
    project: session.project,
    kind: wait.kind,
    ...(wait.promptId ? { promptId: wait.promptId } : {}),
    ...(wait.toolName ? { toolName: wait.toolName } : {}),
    ...(wait.summary ? { summary: wait.summary } : {}),
    ...(wait.message ? { message: wait.message } : {}),
    ...(wait.notificationType ? { notificationType: wait.notificationType } : {}),
    ...(agentId ? { agentId } : {}),
    needsYou: { ...main.needsYou },
    main: { ...main },
    timestamp: now,
  })
}

/**
 * A tool call on the main thread: Claude is working — unless a permission hand
 * just went up (see PERMISSION_RACE_MS), or a worker raised it (that worker's
 * own activity lowers it, see threadMovedOn).
 */
function mainWorking(session, status, now = Date.now()) {
  const main = mainOf(session, now)
  if (main.state === 'needs-you' && main.needsYou?.kind === 'permission') {
    if (now - main.needsYou.since < PERMISSION_RACE_MS || callOf(main.needsYou).agentId) return false
  }
  delete main.needsYou
  delete main.error
  delete main.beforeCompact
  return setMainState(session, 'working', status ? `tool call: ${status}` : 'tool call', now)
}

/**
 * Lower the permission hand `answers(wait, call)` accepts, and withdraw a
 * parked one it accepts, logging `what` as the reason. The hand goes to `to`,
 * or, without one, back to the state it went up from (a worker's dialog
 * answered while Claude itself waits on that worker is waiting again).
 * Returns the session_main broadcast when the raised hand came down, else null.
 */
function lowerPermissionHand(session, answers, what, to) {
  const pending = pendingNeedsYou.get(session.id)
  if (pending && pending.wait.kind === 'permission' && answers(pending.wait, callOf(pending.wait))) {
    cancelPendingNeedsYou(session.id)
    console.log(`[main] ${sessionName(session)}: needs-you withdrawn before it was shown (${needsYouLabel(pending.wait)}; ${what} ${Date.now() - pending.wait.since} ms later)`)
  }
  const main = mainOf(session)
  if (main.state !== 'needs-you' || main.needsYou?.kind !== 'permission') return null
  const call = callOf(main.needsYou)
  if (!answers(main.needsYou, call)) return null
  const back = to ?? (['working', 'waiting', 'idle'].includes(call.before) ? call.before : 'working')
  delete main.needsYou
  setMainState(session, back, what)
  saveSessions()
  return mainEvent(session, 'permission answered')
}

/**
 * One tool call of a thread finished (PostToolUse; an MCP call's mcp_done) or
 * a whole batch of its calls did (PostToolBatch): the permission waits it
 * answers come down — a parked wait, the hand (see
 * "Which call a permission wait belongs to" above). `done` is { toolName?,
 * callKey?, agentId?, batch?, count? }. Returns the session_main broadcast
 * when the hand came down, else null.
 */
function toolDone(session, done) {
  const answers = (toolName, agentId, callKey) => sameThread(agentId, done.agentId)
    && (done.batch === true || (!!done.toolName && toolName === done.toolName && sameCallKey(callKey, done.callKey)))
  const what = done.batch === true ? `tool batch of ${done.count ?? '?'} done` : `${done.toolName ?? 'tool'} ran`
  // The main thread goes back to work; a worker's hand returns to where it was raised from
  return lowerPermissionHand(session, (w, call) => answers(w.toolName, call.agentId, call.callKey), what, done.agentId ? undefined : 'working')
}

/**
 * A worker made a tool call (PreToolUse, PostToolUseFailure) or finished: a
 * permission it asked for was answered in the terminal. A tool call counts
 * past PERMISSION_RACE_MS only, like the main thread's (it may be the late
 * PreToolUse of the very call that asked); a completion (`finished`) always.
 * `agentId` is the raw id the event carried. Returns the session_main
 * broadcast when the hand came down, else null.
 */
function threadMovedOn(session, agentId, what, { finished = false, now = Date.now() } = {}) {
  const settled = since => finished || now - since >= PERMISSION_RACE_MS
  const main = mainOf(session, now)
  if (main.state !== 'needs-you' || main.needsYou?.kind !== 'permission') return null
  const call = callOf(main.needsYou)
  if (!call.agentId || !sameThread(call.agentId, agentId) || !settled(main.needsYou.since)) return null
  return lowerPermissionHand(session, w => w === main.needsYou, what)
}

/** One line of text for a log line. */
function logText(text, max = 60) {
  return String(text ?? '').replace(/\s+/g, ' ').slice(0, max)
}

/** Display name of a session: the tracker's project, else the last path segment of cwd. */
function projectName(project, cwd) {
  if (project) return project
  if (!cwd) return undefined
  return basename(cwd.replace(/\/+$/, '')) || cwd
}

/** Session record -> persistable object. */
function sessionToRecord(session) {
  return { ...session }
}

/**
 * Session record -> API/WS shape. Without `withText` the prompt and reply
 * text is left out of `main` (GET /sessions and the WebSocket without the
 * token; with it, they carry it).
 */
function sessionToJSON(session, { withText = true } = {}) {
  const record = sessionToRecord(session)
  if (!withText && record.main) {
    const { lastPrompt, lastReply, ...rest } = record.main
    record.main = rest
  }
  // Sessions restored from an older agents.json predate the flag: hooks made them
  return { ...record, hooked: session.hooked !== false }
}

/** Broadcast shape of a session lifecycle event. */
function sessionEvent(session, type = 'session_started') {
  const { id, ...json } = sessionToJSON(session)
  return { type, sessionId: id, ...json, timestamp: Date.now() }
}

function createSession({ id, project, cwd, source, model, title, transcriptPath, now = Date.now() }) {
  const session = {
    id,
    hooked: true,
    project: projectName(project, cwd),
    cwd,
    source: source || 'implicit',
    state: 'active',
    startedAt: now,
    lastActivityAt: now,
    main: newMain(now),
  }
  if (model) session.model = model
  if (title) session.title = title
  if (transcriptPath) session.transcriptPath = transcriptPath
  sessions.set(id, session)
  console.log(`[session] ${session.source}: ${session.project ?? id} (${id})`)
  return session
}

/**
 * A session the registry put here (hooked: false) has sent its first hook
 * event — hooks installed mid-session, or the server only now hearing them:
 * from here on the hooks are the truth. The registry-derived main state is
 * dropped for a fresh one (the event about to be applied sets it), the
 * registry entry stays attached as presence. Returns whether it flipped; the
 * caller announces it (session_started with hooked: true).
 */
function hookSession(session, source, now = Date.now()) {
  if (session.hooked !== false) return false
  session.hooked = true
  session.source = source
  session.main = newMain(now)
  session.lastActivityAt = now
  console.log(`[session] hooked now (${source}): ${sessionName(session)} (${session.id})`)
  return true
}

/**
 * The session an event belongs to, created on the fly (source 'implicit')
 * when the server has not seen it. Bumps the session's activity clock. A
 * straggling event does not revive an ended session — only session_started
 * (a resume) does that.
 */
function touchSession(body, now = Date.now()) {
  const id = body.sessionId
  if (!id) return null
  let session = sessions.get(id)
  if (!session) {
    session = createSession({ id, project: body.project, cwd: body.cwd, source: 'implicit', transcriptPath: body.transcriptPath, now })
    saveSessions()
    broadcast(sessionEvent(session))
    return session
  }
  if (hookSession(session, 'implicit', now)) {
    saveSessions()
    broadcast(sessionEvent(session))
  }
  if (session.state === 'active') session.lastActivityAt = now
  if (!session.project) session.project = projectName(body.project, body.cwd)
  if (!session.cwd && body.cwd) session.cwd = body.cwd
  if (body.transcriptPath && session.transcriptPath !== body.transcriptPath) session.transcriptPath = body.transcriptPath
  return session
}

function clearSessionTimer(id) {
  const timer = sessionTimers.get(id)
  if (!timer) return
  clearTimeout(timer)
  sessionTimers.delete(id)
}

function forgetSession(id) {
  clearSessionTimer(id)
  cancelPendingNeedsYou(id)
  clearNeedsYouTimer(id)
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  saveSessions()
  console.log(`[session] forgot ${session.project ?? id} (${id})`)
}

/**
 * Mark a session ended (SessionEnd hook, or no events for STALE_SESSION_MS):
 * it is forgotten after SESSION_FORGET_MS.
 */
function endSession(session, reason, now = Date.now()) {
  session.state = 'ended'
  session.endedAt = now
  session.reason = reason
  session.lastActivityAt = now
  cancelPendingNeedsYou(session.id)
  clearNeedsYouTimer(session.id)
  if (session.main?.state !== 'idle') console.log(`[main] ${sessionName(session)}: ${session.main?.state ?? 'idle'} -> idle (session ended)`)
  session.main = newMain(now)
  saveSessions()
  clearSessionTimer(session.id)
  const timer = setTimeout(() => forgetSession(session.id), SESSION_FORGET_MS)
  timer.unref?.()
  sessionTimers.set(session.id, timer)
  console.log(`[session] ended (${reason}): ${session.project ?? session.id} (${session.id})`)
}

// ---------------------------------------------------------------------------
// Session persistence — survive a server restart while sessions run.
// agents.json holds { sessions } (an older file also has `agents`, ignored).
// ---------------------------------------------------------------------------

const AGENTS_FILE = join(RUNTIME_DIR, 'agents.json')

function saveSessions() {
  try {
    // Ended sessions are on their way out and are not kept, nor are
    // registry-only sessions (the registry rebuilds them on the next start)
    const saved = Array.from(sessions.values()).filter(s => s.state === 'active' && s.hooked !== false).map(sessionToRecord)
    writePrivate(AGENTS_FILE, JSON.stringify({ sessions: saved }))
  } catch (err) {
    console.warn('[sessions] Could not save the sessions:', err.message)
  }
}

function loadSessions() {
  if (!existsSync(AGENTS_FILE)) return
  try {
    const { sessions: saved = [] } = JSON.parse(readFileSync(AGENTS_FILE, 'utf8'))
    const cutoff = Date.now() - STALE_SESSION_MS
    for (const session of Array.isArray(saved) ? saved : []) {
      if (!session?.id || session.state === 'ended' || session.hooked === false) continue
      if ((session.lastActivityAt ?? session.startedAt ?? 0) < cutoff) continue
      // Its Claude Code process is gone (the app was closed or killed without a
      // session_ended): never bring it back, or its Pokémon stays "busy" forever
      if (session.registry?.pid && !pidAlive(session.registry.pid)) continue
      const { agentIds, ...record } = session
      sessions.set(session.id, { ...record, state: 'active', main: restoredMain(session.main) })
    }
    if (sessions.size > 0) console.log(`[sessions] Restored ${sessions.size} session(s) from ${AGENTS_FILE}`)

    // A hand that was up when the server stopped gets what is left of its ten
    // minutes, counted from when it went up: the dialog may well have been
    // answered while nothing was listening, and nothing else would lower it
    const now = Date.now()
    for (const session of sessions.values()) {
      const main = session.main
      if (main?.state !== 'needs-you') continue
      const since = main.needsYou?.since ?? main.since ?? now
      const left = NEEDS_YOU_TIMEOUT_MS - (now - since)
      if (left > 0) {
        armNeedsYouTimeout(session, left)
        continue
      }
      delete main.needsYou
      setMainState(session, 'idle', `needs-you unanswered for ${NEEDS_YOU_TIMEOUT_MS / 60_000} min, across a restart`, now)
    }
  } catch (err) {
    console.warn('[sessions] Could not restore the sessions:', err.message)
  }
}

loadSessions()

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

const KNOWN_EVENT_TYPES = new Set([
  'agent_working',   // a tool call: the main thread's, or a subagent's (agentId)
  'agent_completed', // a subagent finished (agentId)
  'mcp_call',
  'mcp_done',
  'session_started',
  'session_ended',
  // The session's own Claude (see `main` above)
  'session_prompt',
  'session_turn_end',
  'session_needs_you',
  'session_tool_done',
  'session_error',
  'session_compact',
  'session_cwd',
  'session_model',
])

const MAX_STRING_LEN = 200
// A prompt or a reply as the hook sends it
const MAX_TEXT_LEN = 2000
// How much of a prompt or reply the server keeps (the catch log quotes the prompt)
const PROMPT_TEXT_MAX = 200

function clampString(val, max = MAX_STRING_LEN) {
  if (typeof val !== 'string') return undefined
  return val.slice(0, max)
}

/** A count from a hook payload: a non-negative integer, else undefined. */
function clampCount(val, max = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(val) && val >= 0 ? Math.min(val, max) : undefined
}

/** Prompt / reply text as kept: its first PROMPT_TEXT_MAX characters. */
function transcriptText(text) {
  return String(text ?? '').slice(0, PROMPT_TEXT_MAX)
}

/** Stop.background_tasks as forwarded by the tracker: at most 10, four clamped strings each. */
function sanitiseTasks(list) {
  if (!Array.isArray(list)) return undefined
  return list.slice(0, 10).filter(t => t && typeof t === 'object').map(t => ({
    id:          clampString(t.id, 64) ?? '',
    type:        clampString(t.type, 40) ?? '',
    status:      clampString(t.status, 40) ?? '',
    description: clampString(t.description, 120) ?? '',
  }))
}

function validateEvent(body) {
  if (!body || typeof body !== 'object') return 'Missing body'
  if (!body.type || typeof body.type !== 'string') return 'Missing event type'
  if (!KNOWN_EVENT_TYPES.has(body.type)) return `Unknown event type: ${body.type}`
  return null
}

// ---------------------------------------------------------------------------
// Express + HTTP server
// ---------------------------------------------------------------------------

const app = express()

// JSON bodies: 10 KiB is plenty for a tool event or a status line, but a
// session_prompt / session_turn_end carries up to MAX_TEXT_LEN characters of
// text (JSON-escaped, several bytes each) plus the background-task list, so
// /event alone takes more. Its sanitiser clamps every field it keeps.
const JSON_LIMIT = '10kb'
const EVENT_JSON_LIMIT = '64kb'
// Capture the exact request bytes so a signed request (the hook) can be
// verified over the body it actually sent (requestSignature / signatureValid).
const captureRaw = (req, _res, buf) => { req.rawBody = buf }
const jsonBody = express.json({ limit: JSON_LIMIT, verify: captureRaw })
const eventJsonBody = express.json({ limit: EVENT_JSON_LIMIT, verify: captureRaw })

// Host-header guard: the first thing every request passes, before the body
// parsers and CORS. A non-loopback (or missing) Host is a DNS-rebinding page
// or a cross-host request and is refused outright.
app.use((req, res, next) => {
  if (!isAllowedHost(req.headers.host)) {
    return res.status(421).json({ error: 'Forbidden host' })
  }
  next()
})

app.use((req, res, next) => (req.path === '/event' ? eventJsonBody : jsonBody)(req, res, next))

// CORS for local dev — only allow known localhost origins
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Forbidden origin' })
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  next()
})

app.options('*', (_req, res) => res.sendStatus(204))

// Each session's context window and the usage limits: POST /status + GET /status
// (server/status.js), fed by the Claude Code status line, keyed like `sessions`
const status = mountStatus(app, { requireToken, broadcast, staleMs: STALE_SESSION_MS })

// Pipeline health: GET /health (server/health.js); POST /event stamps it, the desktop
// app and `npm run doctor` read it. `sessions` counts every active session, registry-only
// ones included: "2 sessions, 0 hooks seen" is the picture the doctor needs when the
// hooks are not installed.
const health = mountHealth(app, { broadcast, uiAvailable: UI_AVAILABLE, prove: challenge => officeProof(AUTH_TOKEN, challenge), counts: () => ({ clients: wss?.clients.size ?? 0, sessions: Array.from(sessions.values()).filter(s => s.state === 'active').length }) })

// The registry roster (server/sessions.js): Claude Code's own session registry
// adds the sessions nothing has hooks for, and ends them when their process
// goes. Nothing is read until start() — importing the module stays side-effect
// free and the tests point AGENT_OFFICE_REGISTRY_DIR at a temp dir.
const registry = mountRegistry(app, {
  sessions,
  broadcast,
  registryDir: REGISTRY_DIR,
  toEvent: sessionEvent,
  endSession,
  forgetSession,
  onStatusChange: registryStatusChanged,
})

/**
 * A hooked session's registry entry left "waiting": the permission dialog
 * that was on screen is gone — answered Yes (busy), rejected with Esc (idle;
 * no hook fires for that at all), or the process exited. A permission hand
 * from before the dialog closed (the entry's statusUpdatedAt) comes down; the
 * next dialog's request, already in, stays. The one time the registry
 * touches a hooked session's main state.
 */
function registryStatusChanged(session, before, after, entry, t) {
  if (before !== 'waiting' || after === 'waiting' || session.hooked === false || session.state !== 'active') return
  const closedAt = entry?.statusUpdatedAt ?? t
  const what = `the dialog closed in the terminal (registry: waiting -> ${after ?? 'gone'})`
  const lowered = lowerPermissionHand(session, w => w.since <= closedAt, what, after === 'busy' || after === 'shell' ? 'working' : 'idle')
  if (lowered) broadcast({ ...lowered, reason: 'answered in the terminal' })
}

// The Pokémon game (server/pokedex.js): partners, encounters, the Pokédex.
// Species data comes from tools/fetch-pokemon.py; GET /pokedex is open (no secrets in it).
const POKEMON_DATA = join(dirname(fileURLToPath(import.meta.url)), 'pokemon-data.json')
const pokedex = createPokedex({
  file: join(RUNTIME_DIR, 'pokedex.json'),
  species: existsSync(POKEMON_DATA) ? JSON.parse(readFileSync(POKEMON_DATA, 'utf8')) : [],
  balls: (() => { const f = join(dirname(fileURLToPath(import.meta.url)), 'balls.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).balls : [] })(),
  natures: (() => { const f = join(dirname(fileURLToPath(import.meta.url)), 'natures.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [] })(),
  broadcast,
  // A session that ended hands its Pokémon back to the party
  isActive: (sessionId) => { const s = sessions.get(sessionId); return !!s && s.state !== 'ended' },
  onChange: () => cloud?.noteGameChanged(),
  // Steps wait their turn (a burst of tool calls is met one step at a time), and
  // a working session with no tool call for a minute takes a thinking step
  stepSpacingMs: STEP_SPACING_MS,
  sessionOf: (sessionId) => sessions.get(sessionId),
})
setInterval(() => { try { pokedex.tick() } catch (err) { console.error('[pokedex] tick:', err.message) } }, 2000).unref()

// Google sign-in (Supabase Auth) and the cloud copy of the game (server/cloud.js)
const CLOUD_CONFIG = join(dirname(fileURLToPath(import.meta.url)), 'cloud-config.json')
const cloud = createCloud({
  config: existsSync(CLOUD_CONFIG) ? JSON.parse(readFileSync(CLOUD_CONFIG, 'utf8')) : null,
  sessionFile: join(RUNTIME_DIR, 'cloud-session.json'),
  callbackUrl: `http://127.0.0.1:${PORT}/auth/callback`,
  broadcast,
  getGame: () => pokedex.exportState(),
  replaceGame: (game) => pokedex.importState(game),
})
app.get('/cloud', (_req, res) => res.json(cloud.publicState()))
// The desktop app asks for a sign-in URL and opens it in the browser
app.post('/auth/start', requireToken, (_req, res) => res.json(cloud.startSignIn()))
app.post('/auth/signout', requireToken, async (_req, res) => res.json(await cloud.signOut()))
app.post('/auth/sync', requireToken, async (_req, res) => {
  try { await cloud.syncNow(); res.json({ ok: true }) } catch (err) { res.json({ ok: false, reason: err.message }) }
})
// Where Supabase sends the browser back after Google: trade the code, then say so in the tab
app.get('/auth/callback', async (req, res) => {
  const result = await cloud.finishSignIn({ code: String(req.query.code ?? ''), state: String(req.query.state ?? '') })
  const ok = result.ok
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Claudex</title>
<body style="font-family:system-ui,'Malgun Gothic';background:#14161c;color:#f1f2f5;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:42px">${ok ? '✅' : '⚠️'}</div>
<h2>${ok ? '로그인됐어요' : '로그인하지 못했어요'}</h2>
<p style="color:#a4a9b6">${ok ? '이 탭을 닫고 Claudex로 돌아가세요.' : '앱에서 다시 시도해주세요.'}</p></div></body>`)
})
app.get('/pokedex', (_req, res) => res.json(pokedex.publicState()))
// Throw a party Pokémon out with a session the app is opening (the desktop app sends it, with the token)
app.post('/pokedex/throw', requireToken, (req, res) => {
  const { sessionId, uid } = req.body ?? {}
  if (typeof sessionId !== 'string' || typeof uid !== 'string') return res.status(400).json({ ok: false, reason: 'bad-request' })
  res.json(pokedex.throwBall(sessionId.slice(0, 80), uid.slice(0, 40)))
})
// The PC: a box Pokémon and a resting party Pokémon trade places
app.post('/pokedex/exchange', requireToken, (req, res) => {
  const { boxUid, partyUid } = req.body ?? {}
  if (typeof boxUid !== 'string' || typeof partyUid !== 'string') return res.status(400).json({ ok: false, reason: 'bad-request' })
  res.json(pokedex.exchange(boxUid.slice(0, 40), partyUid.slice(0, 40)))
})
// Let a box Pokémon go (the desktop app sends it, with the token)
app.post('/pokedex/release', requireToken, (req, res) => {
  const { uid } = req.body ?? {}
  if (typeof uid !== 'string') return res.status(400).json({ ok: false, reason: 'bad-request' })
  res.json(pokedex.release(uid.slice(0, 40)))
})
// Put another Pokémon on a session (the desktop app sends it, with the token)
app.post('/pokedex/swap', requireToken, (req, res) => {
  const { sessionId, uid } = req.body ?? {}
  if (typeof sessionId !== 'string' || typeof uid !== 'string') return res.status(400).json({ ok: false, reason: 'bad-request' })
  res.json(pokedex.swap(sessionId.slice(0, 80), uid.slice(0, 40)))
})

/**
 * POST /event — receives hook events from hooks/agent-tracker.sh
 *
 * Requires the token (a bearer token, or the hook's request signature).
 * Answers { ok: true }.
 *
 *   { type: "agent_working",     status, tool?, agentId?, agentType?, failed? }  (PreToolUse, PostToolUseFailure)
 *   { type: "agent_completed",   agentId, result }                               (SubagentStop)
 *   { type: "mcp_call",          server, tool, agentId? }
 *   { type: "mcp_done",          server, tool?, callKey?, agentId? }
 *   { type: "session_started",   sessionId, project, cwd, source, model?, title? } (SessionStart)
 *   { type: "session_ended",     sessionId, reason }                              (SessionEnd)
 *
 * The session's own Claude (its `main` record; all carry sessionId, promptId?):
 *   { type: "session_prompt",    text, isWakeup, wakeupAgentId?, wakeupStatus? }  (UserPromptSubmit)
 *   { type: "session_turn_end",  text, backgroundTasks[], crons, stopHookActive } (Stop)
 *   { type: "session_needs_you", kind, toolName?, summary?, message?, notificationType?, agentId?, callKey? }
 *                                                           (PermissionRequest, Notification)
 *   { type: "session_error",     error, detail }                                   (StopFailure)
 *   { type: "session_compact",   phase: "pre" | "post", trigger }                  (Pre/PostCompact)
 *   { type: "session_tool_done", toolName?, callKey? | batch: true, count; agentId? }
 *                                                           (PostToolUse / PostToolBatch; agentId inside a subagent)
 *   { type: "session_cwd",       cwd, project, oldCwd? }                           (CwdChanged)
 *   { type: "session_model",     model, fromModel?, switchSource? }                (PostModelSwitch)
 *
 * agentId is Claude Code's subagent id (the hook payload's agent_id): a call
 * made inside a subagent. Every event may carry sessionId, project, cwd and
 * transcriptPath — the Claude Code session the hook fired in.
 */
app.post('/event', requireToken, (req, res) => {
  const body = req.body

  const validationError = validateEvent(body)
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }

  // Clamp the fields kept, so nothing oversized reaches the page or agents.json
  const sanitised = {
    type: body.type,
    agentId:  clampString(body.agentId),
    failed:   body.failed === true || undefined,
    status:   clampString(body.status),
    result:   clampString(body.result),
    server:   clampString(body.server),
    tool:     clampString(body.tool),
    // Session identity (on every event) + session lifecycle fields
    sessionId:      clampString(body.sessionId),
    project:        clampString(body.project),
    cwd:            clampString(body.cwd, 400),
    transcriptPath: clampString(body.transcriptPath, 400),
    source:  clampString(body.source),
    model:   clampString(body.model),
    title:   clampString(body.title),
    reason:  clampString(body.reason),
    // The session's own Claude
    promptId:         clampString(body.promptId, 80),
    text:             clampString(body.text, MAX_TEXT_LEN),
    isWakeup:         body.isWakeup === true || undefined,
    wakeupAgentId:    clampString(body.wakeupAgentId, 80),
    wakeupStatus:     clampString(body.wakeupStatus, 40),
    kind:             NEEDS_YOU_KINDS.has(body.kind) ? body.kind : undefined,
    toolName:         clampString(body.toolName, 80),
    // Which call a PermissionRequest / PostToolUse is (a hash of its input, see needs-you timing)
    callKey:          clampString(body.callKey, 64),
    summary:          clampString(body.summary),
    message:          clampString(body.message),
    notificationType: clampString(body.notificationType, 40),
    error:            clampString(body.error, 40),
    detail:           clampString(body.detail),
    phase:            body.phase === 'pre' || body.phase === 'post' ? body.phase : undefined,
    trigger:          clampString(body.trigger, 20),
    backgroundTasks:  sanitiseTasks(body.backgroundTasks),
    crons:            clampCount(body.crons, 1000),
    stopHookActive:   body.stopHookActive === true || undefined,
    batch:            body.batch === true || undefined,
    count:            clampCount(body.count, 1000),
    oldCwd:           clampString(body.oldCwd, 400),
    fromModel:        clampString(body.fromModel, 80),
    switchSource:     clampString(body.switchSource, 20),
  }

  const event = processEvent(sanitised)
  if (event) broadcast(event)
  // The game: a session's partner, and a step through tall grass per tool call
  try { pokedex.noteEvent(sanitised, sanitised.sessionId ? sessions.get(sanitised.sessionId) : undefined) } catch (err) { console.error('[pokedex]', err.message) }
  health.markHook()  // a hook reached us (after the event, so its counts include it)
  res.json({ ok: true })
})

/**
 * GET /sessions — the Claude Code sessions (one per terminal) the server knows
 * about: project, cwd, how it started and `main` — what the session's own
 * Claude is doing (state, last prompt and reply, what it waits on). Ended
 * sessions stay listed for SESSION_FORGET_MS.
 */
app.get('/sessions', (req, res) => {
  // The prompt / reply text in `main` only for a caller with the token
  const withText = tokenMatches(bearerToken(req))
  res.json({ sessions: Array.from(sessions.values()).map(s => sessionToJSON(s, { withText })) })
})

// ---------------------------------------------------------------------------
// Event processing — a hook event moves its session and its Claude
// ---------------------------------------------------------------------------

function processEvent(body) {
  switch (body.type) {
    case 'agent_working': {
      // A tool call (PreToolUse, PostToolUseFailure). Inside a subagent
      // (agentId): a dialog that subagent raised has been answered in the
      // terminal, past the race window. On the main thread: Claude is
      // working, and the broadcast names the session.
      const session = touchSession(body)
      if (!session) return null
      const now = Date.now()
      if (body.agentId) {
        const lowered = threadMovedOn(session, body.agentId, `subagent: ${logText(body.status)}`, { now })
        if (lowered) saveSessions()
        return lowered
      }
      mainWorking(session, body.status, now)
      saveSessions()
      return {
        type: 'agent_working',
        status: body.status,
        ...(body.failed ? { failed: true } : {}),
        sessionId: session.id,
        project: session.project,
        main: { ...session.main },
        timestamp: now,
      }
    }

    case 'agent_completed': {
      // SubagentStop: whatever that subagent was waiting on in the terminal is over
      const session = touchSession(body)
      if (!session || !body.agentId) return null
      return threadMovedOn(session, body.agentId, `subagent finished: ${logText(body.result ?? 'done')}`, { finished: true })
    }

    case 'mcp_call':
      // An MCP tool call of the session's Claude: the session is alive
      touchSession(body)
      return null

    case 'mcp_done': {
      // The MCP call's own PostToolUse: the permission it asked for (as
      // mcp__<server>__<tool>) was granted, exactly as for any other tool
      const session = touchSession(body)
      if (!session || !body.tool) return null
      return toolDone(session, { toolName: `mcp__${body.server}__${body.tool}`, callKey: body.callKey, agentId: body.agentId })
    }

    case 'session_started': {
      // SessionStart hook: startup | resume | compact | clear | fork. The same
      // session_id comes back on a resume, so an ended session is revived.
      const id = body.sessionId
      if (!id) return null
      const now = Date.now()
      const source = body.source || 'startup'
      let session = sessions.get(id)
      if (!session) {
        session = createSession({ id, project: body.project, cwd: body.cwd, source, model: body.model, title: body.title, transcriptPath: body.transcriptPath, now })
      } else {
        if (session.state === 'ended') {
          clearSessionTimer(id)
          session.state = 'active'
          delete session.endedAt
          delete session.reason
          session.main = newMain(now)
          console.log(`[session] back (${source}): ${session.project ?? id} (${id})`)
        }
        // A registry-only session's first SessionStart: hooked from now on
        hookSession(session, source === 'compact' ? 'implicit' : source, now)
        session.lastActivityAt = now
        // Compaction fires SessionStart too, but it is not how the session started
        if (source !== 'compact') session.source = source
        const project = projectName(body.project, body.cwd)
        if (project) session.project = project
        if (body.cwd) session.cwd = body.cwd
        if (body.model) session.model = body.model
        if (body.title) session.title = body.title
        if (body.transcriptPath) session.transcriptPath = body.transcriptPath
      }
      saveSessions()
      return sessionEvent(session)
    }

    case 'session_ended': {
      // SessionEnd hook (reason: other | prompt_input_exit | ...), or the
      // stale sweep below
      const id = body.sessionId
      if (!id) return null
      const reason = body.reason || 'other'
      const session = sessions.get(id)
      if (!session) return { type: 'session_ended', sessionId: id, reason, timestamp: Date.now() }
      if (session.state !== 'ended') endSession(session, reason)
      return sessionEvent(session, 'session_ended')
    }

    // ── The session's own Claude (see `main` near the session tracking) ────

    case 'session_prompt': {
      // UserPromptSubmit: the trainer spoke (or a background task woke Claude
      // up — isWakeup, with its subagent id in wakeupAgentId)
      const session = touchSession(body)
      if (!session) return null
      const now = Date.now()
      const main = mainOf(session, now)
      const text = transcriptText(body.text)
      const wakeup = body.isWakeup === true
      main.lastPrompt = text
      main.lastPromptAt = now
      if (body.promptId) main.promptId = body.promptId
      cancelPendingNeedsYou(session.id)
      delete main.needsYou
      delete main.error
      delete main.beforeCompact
      setMainState(session, 'working', wakeup ? `woken by ${body.wakeupAgentId ?? 'a background task'}` : 'prompt', now)
      console.log(`[main] ${sessionName(session)}: ${wakeup ? 'wake-up' : 'prompt'}: ${logText(text)}`)
      saveSessions()
      return {
        type: 'session_prompt',
        sessionId: session.id,
        project: session.project,
        ...(body.promptId ? { promptId: body.promptId } : {}),
        text,
        isWakeup: wakeup,
        ...(body.wakeupAgentId ? { wakeupAgentId: body.wakeupAgentId } : {}),
        ...(body.wakeupStatus ? { wakeupStatus: body.wakeupStatus } : {}),
        main: { ...main },
        timestamp: now,
      }
    }

    case 'session_turn_end': {
      // Stop: Claude replied. Still-running background tasks mean it is
      // waiting to be woken, otherwise it is idle until the next prompt.
      const session = touchSession(body)
      if (!session) return null
      const now = Date.now()
      const main = mainOf(session, now)
      const text = transcriptText(body.text)
      const tasks = Array.isArray(body.backgroundTasks) ? body.backgroundTasks : []
      const inFlight = tasks.filter(t => TASK_IN_FLIGHT.test(t.status ?? ''))
      main.lastReply = text
      main.lastReplyAt = now
      main.waitingOn = inFlight.length
      main.crons = body.crons ?? 0
      if (body.promptId) main.promptId = body.promptId
      cancelPendingNeedsYou(session.id)
      delete main.needsYou
      delete main.error
      delete main.beforeCompact
      if (inFlight.length) setMainState(session, 'waiting', `turn ended, ${inFlight.length} background task(s) still running`, now)
      else setMainState(session, 'idle', 'turn ended', now)
      console.log(`[main] ${sessionName(session)}: reply: ${logText(text)}`)
      saveSessions()
      return {
        type: 'session_turn_end',
        sessionId: session.id,
        project: session.project,
        ...(body.promptId ? { promptId: body.promptId } : {}),
        text,
        backgroundTasks: tasks.map(t => ({ ...t })),
        crons: main.crons,
        stopHookActive: body.stopHookActive === true,
        main: { ...main },
        timestamp: now,
      }
    }

    case 'session_needs_you': {
      // PermissionRequest / Notification: the session is waiting on a person.
      // The wait is parked for NEEDS_YOU_DEBOUNCE_MS (see applyNeedsYou) so a
      // headless auto-deny, answered by its PostToolBatch within ~60 ms,
      // never shows; nothing is broadcast here.
      if (!NEEDS_YOU_KINDS.has(body.kind)) return null
      const session = touchSession(body)
      if (!session) return null
      const now = Date.now()
      const main = mainOf(session, now)
      // A Notification names no tool: it is the dialog already waited on. A
      // PermissionRequest is the same wait only from the same thread for the
      // same call (another call of that tool is another dialog)
      const sameWait = w => w && w.kind === body.kind
        && (w.promptId ?? null) === (body.promptId ?? null)
        && (!body.toolName || (w.toolName === body.toolName && sameThread(callOf(w).agentId, body.agentId) && sameCallKey(callOf(w).callKey, body.callKey)))
      // One wait, several hooks (PermissionRequest, then Notification
      // {permission_prompt} ~6 s later): a repeat for the same prompt within
      // NEEDS_YOU_DEDUPE_MS changes nothing
      const current = main.state === 'needs-you' ? main.needsYou : null
      if (sameWait(current) && now - current.since < NEEDS_YOU_DEDUPE_MS) {
        console.log(`[main] ${sessionName(session)}: needs-you (${body.kind}) repeated within ${NEEDS_YOU_DEDUPE_MS / 1000}s — ignored`)
        return null
      }
      const pending = pendingNeedsYou.get(session.id)
      if (pending && sameWait(pending.wait)) return null
      cancelPendingNeedsYou(session.id)
      const wait = {
        kind: body.kind,
        since: now,
        ...(body.promptId ? { promptId: body.promptId } : {}),
        ...(body.toolName ? { toolName: body.toolName } : {}),
        ...(body.summary ? { summary: body.summary } : {}),
        ...(body.message ? { message: body.message } : {}),
        ...(body.notificationType ? { notificationType: body.notificationType } : {}),
      }
      // Which call asked (see "Which call a permission wait belongs to")
      if (body.agentId || body.callKey) waitCalls.set(wait, { ...(body.agentId ? { agentId: body.agentId } : {}), ...(body.callKey ? { callKey: body.callKey } : {}) })
      console.log(`[main] ${sessionName(session)}: needs-you requested (${needsYouLabel(wait)})`)
      const timer = setTimeout(() => applyNeedsYou(session.id), NEEDS_YOU_DEBOUNCE_MS)
      timer.unref?.()
      pendingNeedsYou.set(session.id, { wait, agentId: body.agentId, timer })
      return null
    }

    case 'session_tool_done': {
      // A tool call ran (PostToolUse) or a whole batch of them was answered
      // (PostToolBatch), on the main thread or inside the worker agentId
      // names: the permission it answers — that call's own, or every one of
      // the thread's for a batch — was granted or settled in the terminal
      // (toolDone). Another call of the same tool says nothing about it.
      const session = touchSession(body)
      if (!session) return null
      return toolDone(session, { toolName: body.toolName, callKey: body.callKey, agentId: body.agentId, batch: body.batch, count: body.count })
    }

    case 'session_cwd': {
      // CwdChanged: the session moved; its project tag follows
      const session = touchSession(body)
      if (!session || !body.cwd) return null
      const oldCwd = body.oldCwd ?? session.cwd
      session.cwd = body.cwd
      session.project = projectName(body.project, body.cwd)
      saveSessions()
      console.log(`[session] cwd: ${oldCwd ?? '?'} -> ${body.cwd} (${session.project ?? session.id})`)
      return { ...sessionEvent(session, 'session_cwd'), ...(oldCwd ? { oldCwd } : {}) }
    }

    case 'session_model': {
      // PostModelSwitch: the session runs another model from here on
      const session = touchSession(body)
      if (!session || !body.model) return null
      const fromModel = body.fromModel ?? session.model
      session.model = body.model
      saveSessions()
      console.log(`[session] model: ${fromModel ?? '?'} -> ${body.model}${body.switchSource ? ` (${body.switchSource})` : ''} (${session.project ?? session.id})`)
      return {
        ...sessionEvent(session, 'session_model'),
        ...(fromModel ? { fromModel } : {}),
        ...(body.switchSource ? { switchSource: body.switchSource } : {}),
      }
    }

    case 'session_error': {
      // StopFailure: the turn ended on an API error (rate_limit, overloaded, ...)
      const session = touchSession(body)
      if (!session) return null
      const now = Date.now()
      const main = mainOf(session, now)
      main.error = { error: body.error || 'unknown', detail: body.detail ?? '', since: now }
      if (body.promptId) main.promptId = body.promptId
      cancelPendingNeedsYou(session.id)
      delete main.needsYou
      delete main.beforeCompact
      setMainState(session, 'error', `${main.error.error}${main.error.detail ? `: ${logText(main.error.detail, 80)}` : ''}`, now)
      saveSessions()
      return {
        type: 'session_error',
        sessionId: session.id,
        project: session.project,
        ...(body.promptId ? { promptId: body.promptId } : {}),
        error: main.error.error,
        detail: main.error.detail,
        main: { ...main },
        timestamp: now,
      }
    }

    case 'session_compact': {
      // PreCompact / PostCompact: Claude is rewriting its memory. A `pre`
      // may have no `post` (compaction refused), so any later event moves on.
      if (body.phase !== 'pre' && body.phase !== 'post') return null
      const session = touchSession(body)
      if (!session) return null
      const now = Date.now()
      const main = mainOf(session, now)
      const trigger = body.trigger || 'manual'
      if (body.phase === 'pre') {
        if (main.state !== 'compacting') main.beforeCompact = main.state
        setMainState(session, 'compacting', `${trigger} compaction`, now)
      } else if (main.state === 'compacting') {
        // Back to what Claude was doing; idle when the pre was never seen
        const back = MAIN_STATES.has(main.beforeCompact) && main.beforeCompact !== 'compacting' ? main.beforeCompact : 'idle'
        delete main.beforeCompact
        setMainState(session, back, 'compaction done', now)
      }
      saveSessions()
      return {
        type: 'session_compact',
        sessionId: session.id,
        project: session.project,
        ...(body.promptId ? { promptId: body.promptId } : {}),
        phase: body.phase,
        trigger,
        main: { ...main },
        timestamp: now,
      }
    }

    default:
      console.warn(`[?] Unknown event type: ${body.type}`)
      return null
  }
}

/**
 * End the sessions nothing has been heard from for STALE_SESSION_MS (a
 * missed SessionEnd). Runs every five minutes; `now` is a parameter so tests
 * can sweep a future.
 */
function sweepStale(now = Date.now()) {
  const cutoff = now - STALE_SESSION_MS
  for (const session of Array.from(sessions.values())) {
    // A session with a live registry entry has a running process, however
    // quiet it is; the registry ends it when the process goes
    if (session.registry) continue
    if (session.state === 'active' && session.lastActivityAt < cutoff) {
      broadcast(processEvent({ type: 'session_ended', sessionId: session.id, reason: 'stale' }))
    }
  }
}

setInterval(() => sweepStale(), 5 * 60_000).unref()

// ---------------------------------------------------------------------------
// Static UI — registered after every API route so /health, /sessions, ... win
// ---------------------------------------------------------------------------

// Pokémon artwork: fetched from PokeAPI on first use, then a local file (server/sprites.js)
mountSprites(app, { runtimeDir: RUNTIME_DIR, uiDir: UI_DIR })

if (UI_AVAILABLE) {
  app.use(express.static(UI_DIR))
} else {
  app.get('/', (_req, res) => {
    res.status(404).json({
      error: 'UI not built. Run `npm run build` to serve it from here, or `npm run dev` for the Vite dev server on port 3333.',
    })
  })
}

// ---------------------------------------------------------------------------
// Errors — registered last, after every route and the static UI (a route
// added below this line is not covered). Only errors come here: a request
// nothing matched still falls through to Express's plain 404.
// ---------------------------------------------------------------------------

const BODY_ERROR_MESSAGES = {
  'entity.parse.failed': 'Malformed JSON body',
  'entity.too.large': 'Request body too large',
}

/**
 * Every error becomes a small JSON body. Without this Express answers an
 * uncaught exception with its stack trace — absolute install paths and all —
 * whenever NODE_ENV is unset. body-parser's errors carry a status and a type;
 * anything else is a 500, logged here and nowhere else.
 */
function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err)
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500
  const error = BODY_ERROR_MESSAGES[err?.type] ?? (status < 500 ? 'Bad request' : 'Internal error')
  if (status >= 500) console.error(`[error] ${req.method} ${req.path}:`, err)
  res.status(status).json({ error })
}

app.use(jsonErrorHandler)

// ---------------------------------------------------------------------------
// The WebSocket — trusted with the file token, read-only without it
//
// The Origin check keeps web pages on other origins out, but it cannot tell
// the app's page from another local process: anything on this machine can
// open ws://127.0.0.1:<port>/ws and send any Origin. So each connection is
// authenticated at the handshake with the file token. Browsers cannot set
// headers on a WebSocket, so the page sends it as a subprotocol value:
//
//   Sec-WebSocket-Protocol: agent-office, agent-office.token.<token>
//
// (a header, never part of a URL, so it stays out of history and access
// logs). The server answers with plain `agent-office`, so the token is not
// echoed back. src/officeToken.ts builds the same list.
//
// A connection that presents the token is trusted: the full snapshot and
// every broadcast as is. Any other connection is not refused, but gets no
// conversation text (redactForReadOnly). Each connection is told which it
// is, first thing: { type: 'auth', trusted }.
// ---------------------------------------------------------------------------

const WS_PROTOCOL = 'agent-office'
const WS_TOKEN_PROTOCOL_PREFIX = 'agent-office.token.'

/** The token a WebSocket handshake offered as a subprotocol, or ''. */
function wsTokenFrom(req) {
  const header = req.headers['sec-websocket-protocol']
  if (typeof header !== 'string') return ''
  for (const part of header.split(',')) {
    const value = part.trim()
    if (value.startsWith(WS_TOKEN_PROTOCOL_PREFIX)) return value.slice(WS_TOKEN_PROTOCOL_PREFIX.length)
  }
  return ''
}

/** The subprotocol the server agrees to: `agent-office` when offered, never the token. */
function handleProtocols(protocols) {
  return protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false
}

/** A copy of `obj` without `keys`. */
function omit(obj, keys) {
  const out = { ...obj }
  for (const key of keys) delete out[key]
  return out
}

/** An event's `main` without the last prompt and reply text (what GET /sessions shows without the token). */
function withoutMainText(event) {
  const main = event.main
  if (!main || typeof main !== 'object' || !('lastPrompt' in main || 'lastReply' in main)) return event
  return { ...event, main: omit(event.main, ['lastPrompt', 'lastReply']) }
}

/**
 * What a read-only connection gets of a broadcast: the payload itself when it
 * carries no conversation text, else a copy without it.
 *
 *   session_prompt, session_turn_end   `text` (the prompt, the reply)
 *   every event with `main`            main.lastPrompt / main.lastReply
 */
function redactForReadOnly(payload) {
  switch (payload.type) {
    case 'session_prompt':
    case 'session_turn_end':
      return withoutMainText(omit(payload, ['text']))
    default:
      return withoutMainText(payload)
  }
}

/** Connections that presented the file token (membership dies with the socket). */
const trustedClients = new WeakSet()

const httpServer = createServer(app)

const wss = new WebSocketServer({ server: httpServer, path: '/ws', handleProtocols })

wss.on('connection', (ws, req) => {
  // Host validation — loopback hosts only (see isAllowedHost): defence in
  // depth against a DNS-rebinding page that opens the WebSocket
  if (!isAllowedHost(req.headers.host)) {
    console.warn(`[ws] Rejected connection from disallowed host: ${req.headers.host}`)
    ws.close(1008, 'Forbidden host')
    return
  }
  // Origin validation — loopback origins only (see isAllowedOrigin)
  const origin = req.headers.origin
  if (origin && !isAllowedOrigin(origin)) {
    console.warn(`[ws] Rejected connection from disallowed origin: ${origin}`)
    ws.close(1008, 'Forbidden origin')
    return
  }

  const trusted = tokenMatches(wsTokenFrom(req))
  if (trusted) trustedClients.add(ws)
  const ip = req.socket.remoteAddress ?? 'unknown'
  console.log(`[ws] Client connected from ${ip}, ${trusted ? 'trusted' : 'read-only (no token)'} (total: ${wss.clients.size})`)

  // First: what this connection may see, so the page can say so
  ws.send(JSON.stringify({ type: 'auth', trusted }))

  // Then the current state: the sessions, their status-line numbers, the game
  // and the cloud sign-in. A read-only connection gets the sessions without
  // the conversation text.
  const snapshot = {
    type: 'snapshot',
    sessions: Array.from(sessions.values()).map(s => sessionToJSON(s, { withText: trusted })),
    statuses: status.summary(),
    health: health.snapshot(),
    pokedex: pokedex.publicState(),
    cloud: cloud.publicState(),
    timestamp: Date.now(),
  }
  ws.send(JSON.stringify(snapshot))

  ws.on('close', () => {
    console.log(`[ws] Client disconnected (remaining: ${wss.clients.size})`)
  })

  ws.on('error', (err) => {
    console.error(`[ws] Client error:`, err.message)
  })
})

/**
 * Broadcast a JSON message to all connected WebSocket clients: trusted ones
 * get the payload as is, read-only ones what redactForReadOnly leaves of it.
 * Each variant is serialised once, the read-only one only when a read-only
 * client is connected. A null payload (processEvent had nothing to say) is
 * skipped rather than sent as "null".
 */
function broadcast(payload) {
  if (!payload) return
  const full = JSON.stringify(payload)
  let readOnly  // undefined: not built yet; null: withheld from read-only clients
  let sent = 0
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue
    let msg = full
    if (!trustedClients.has(client)) {
      if (readOnly === undefined) {
        const redacted = redactForReadOnly(payload)
        readOnly = redacted === payload ? full : redacted ? JSON.stringify(redacted) : null
      }
      msg = readOnly
    }
    if (!msg) continue
    client.send(msg)
    sent++
  }
  if (sent > 0) {
    console.log(`[broadcast] ${payload.type} -> ${sent} client(s)`)
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Bind the port, then write the auth token and print the banner.
 *
 * The token is written only once the port is ours: a second instance started
 * while the first is running (`npm run server` twice, Electron plus the CLI)
 * used to overwrite the file with its own token and then die on EADDRINUSE,
 * so every hook event to the surviving server was a 401 until it was
 * restarted. Now the loser exits without touching the file.
 * The host comes from AGENT_OFFICE_HOST here, at start, so a refused value
 * is logged next to the banner: whatever it says, 127.0.0.1 is bound
 * (readHost in server/config.js has the reasons).
 * @param {{ port?: number, host?: string }} [opts] — tests bind an ephemeral port
 */
export function start({ port = PORT, host = readHost() } = {}) {
  // A listen failure (EADDRINUSE: another instance already holds the port)
  // surfaces on the http server, but ws re-emits it on the WebSocketServer —
  // and an unhandled 'error' there throws. Handle it in one place, once,
  // whichever object delivers it, so the banner prints and we exit cleanly
  // without having written the token (writeTokenFile runs only on success).
  let fatal = false
  const onFatal = (err) => {
    if (fatal) return
    fatal = true
    if (err?.code === 'EADDRINUSE') {
      console.error(`[error] Port ${port} is already in use. Is the server already running? (its token in ${TOKEN_FILE} is left as it was)`)
    } else {
      console.error('[error]', err)
    }
    process.exit(1)
  }
  httpServer.on('error', onFatal)
  wss.on('error', onFatal)

  httpServer.listen(port, host, () => {
    writeTokenFile()
    repairPrivateModes()
    // The registry roster runs with the server (and stops with it, so a
    // test's closed server leaves no poll behind)
    registry.start()
    httpServer.once('close', () => registry.stop())
    const bound = httpServer.address()?.port ?? port
    console.log(`[server] Claudex ${VERSION} on http://127.0.0.1:${bound} (WebSocket /ws, hooks POST /event)`)
    console.log(`  Auth token ${REUSED_TOKEN ? 'reused from' : 'written to'}: ${TOKEN_FILE}`)
    console.log(`  Session registry read from: ${REGISTRY_DIR}`)
    if (UI_AVAILABLE) {
      console.log(`  UI served from: ${UI_DIR}`)
    } else {
      console.log(`  UI not built (npm run build) — use the Vite dev server on port ${UI_DEV_PORT}`)
    }
    // The page link. Only whoever started the server sees this output;
    // the page reads the token from the fragment, which a browser never
    // sends to a server, keeps it and strips it from the address bar.
    const address = httpServer.address()
    const linkHost = address && typeof address === 'object' && address.family === 'IPv6' ? `[${address.address}]` : '127.0.0.1'
    const base = UI_AVAILABLE ? `http://${linkHost}:${bound}` : `http://127.0.0.1:${UI_DEV_PORT}`
    console.log(`  Page: ${officeLink(base)}${UI_AVAILABLE ? '' : '  (the Vite dev server)'}`)
    console.log()
  })
}

/** The page URL with the token in its fragment, the one way the page learns it. */
function officeLink(base) {
  return `${base.replace(/\/+$/, '')}/#token=${AUTH_TOKEN}`
}

// Only bind the port when run directly (`node server/index.js`, `npm run
// server`, the Electron child process). Importing the module — e.g. from the
// tests — builds the app without listening or writing the token file.
function isMainModule() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename)
  } catch {
    return false
  }
}

if (isMainModule()) start()

export {
  app,
  httpServer,
  wss,
  AUTH_TOKEN,
  REUSED_TOKEN,
  RUNTIME_DIR,
  TOKEN_FILE,
  TOKEN_PATTERN,
  readTokenFile,
  WS_PROTOCOL,
  WS_TOKEN_PROTOCOL_PREFIX,
  redactForReadOnly,
  officeLink,
  PORT,
  UI_DEV_PORT,
  isAllowedOrigin,
  UI_DIR,
  UI_AVAILABLE,
  sessions,
  registry,
  REGISTRY_DIR,
  pendingNeedsYou,
  processEvent,
  sweepStale,
  broadcast,
}
