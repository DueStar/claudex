'use strict'

/**
 * Pure helpers for the desktop app: the server's port and URLs, reusing a
 * server already on the port, the page link with the server token, window
 * bounds, the window-state file, and the tray's tooltip and menu. Nothing here
 * needs Electron, so tests/electron-helpers.test.ts runs it in plain Node;
 * main.cjs and tray.cjs supply the `screen`, `BrowserWindow` and `Tray` side.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const ko = require('./i18n.cjs').translator('ko')

const APP_NAME = 'Claudex'

// ---------------------------------------------------------------------------
// The server's port
// ---------------------------------------------------------------------------

const DEFAULT_SERVER_PORT = 3334
const VITE_DEV_PORT = 3333

/**
 * The server's port from CLAUDEX_PORT: the same parse as
 * server/config.js readPort (which this file cannot import: the server is
 * ESM and the Electron main process is CommonJS), so the app, the server it
 * spawns and the hooks always agree. Anything that is not a port is 3334.
 */
function serverPortFromEnv(env = process.env) {
  const raw = env && env.CLAUDEX_PORT
  if (typeof raw !== 'string' || raw === '') return DEFAULT_SERVER_PORT
  const text = raw.trim()
  if (!/^\d{1,5}$/.test(text)) return DEFAULT_SERVER_PORT
  const port = Number(text)
  return port >= 1 && port <= 65535 ? port : DEFAULT_SERVER_PORT
}

/**
 * Every URL the main process derives from the port: the server (what the
 * packaged app loads and the tray polls), its health route, the Vite dev
 * server (what `electron .` loads), and the origins the windows may load.
 */
function serverUrls(port = DEFAULT_SERVER_PORT, uiPort = VITE_DEV_PORT) {
  const serverUrl = `http://127.0.0.1:${port}`
  const viteUrl = `http://127.0.0.1:${uiPort}`
  return {
    port,
    serverUrl,
    healthUrl: `${serverUrl}/health`,
    viteUrl,
    allowedOrigins: [viteUrl, serverUrl],
  }
}

// ---------------------------------------------------------------------------
// Reusing a server that is already on the port
//
// The app first asks GET /health whether a server already answers on its
// port (`npm run server`, another copy of the app). The packaged app loads
// the page from that server, so a server with no built UI — a checkout run
// with the Vite dev server, which answers GET / with a 404 JSON body — is no
// use to it, and spawning a second server on the same port would only fail
// (and must not overwrite the token file the first one wrote). The dev app
// loads the page from Vite and reuses any server.
// ---------------------------------------------------------------------------

/**
 * What GET /health said: 'none' (no answer, or not a 200), 'usable' (it
 * serves the page: `uiAvailable: true`), 'no-ui' (`uiAvailable: false`, or a
 * 200 that is not the server's JSON), 'unknown' (too old to report
 * `uiAvailable`: ask GET / instead).
 */
function classifyHealth(statusCode, bodyText) {
  if (statusCode !== 200) return 'none'
  let body
  try { body = JSON.parse(String(bodyText)) } catch { return 'no-ui' }
  if (!body || typeof body !== 'object' || body.status !== 'ok') return 'no-ui'
  if (body.uiAvailable === true) return 'usable'
  if (body.uiAvailable === false) return 'no-ui'
  return 'unknown'
}

/** What GET / said, for a server whose /health did not tell: the page is a 200 HTML document. */
function classifyIndex(statusCode, contentType) {
  return statusCode === 200 && /^text\/html\b/i.test(String(contentType || '')) ? 'usable' : 'no-ui'
}

/**
 * What to do about the server found on the port: 'start' one (nothing is
 * there), 'reuse' it, or report a 'conflict' (the packaged app would show an
 * error body instead of the page).
 */
function serverPlan(found, packaged) {
  if (found === 'none') return 'start'
  if (found === 'usable' || !packaged) return 'reuse'
  return 'conflict'
}

/** The dialog for a 'conflict': what is on the port and the ways out. */
function serverConflictMessage(port) {
  return `Another Claudex server is already running on port ${port}, but it has no built page to show ` +
    '(a checkout started with `npm run server` before `npm run build`, say).\n\n' +
    `Stop that server, or run \`npm run build\` in its checkout, or launch ${APP_NAME} with CLAUDEX_PORT set to a free port.`
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

/**
 * Run `fn` at most once at a time: a call while one is in flight gets that
 * call's promise instead of a second run. The app's startup (probe the port,
 * spawn the server, wait for it, open the window) takes seconds, and a second
 * launch during it must not spawn a second server and open a second window.
 * `pending()` says whether a run is in flight.
 */
function singleFlight(fn) {
  let inFlight = null
  const run = (...args) => {
    if (inFlight) return inFlight
    inFlight = Promise.resolve()
      .then(() => fn(...args))
      .finally(() => { inFlight = null })
    return inFlight
  }
  run.pending = () => inFlight !== null
  return run
}

/**
 * What the app does when it is opened again (a second launch, macOS
 * 'activate'): nothing while it is still starting or on its way out, show the
 * window it has, or create one when there is none.
 */
function reopenAction({ quitting = false, starting, hasWindow, windowCount }) {
  if (quitting || starting) return 'none'
  if (hasWindow) return 'show'
  return windowCount === 0 ? 'create' : 'none'
}

/**
 * The server child this app owns. An 'exit' or 'error' from a child that is
 * no longer the current one — a duplicate that lost the port — leaves the
 * slot alone, so the app never loses track of the server it must stop.
 */
function childSlot() {
  let current = null
  return {
    get: () => current,
    adopt(child) { current = child; return child },
    release(child) { if (current === child) current = null },
    take() { const child = current; current = null; return child },
  }
}

// ---------------------------------------------------------------------------
// The page link
//
// The page receives conversation text and may change the game only once its
// WebSocket presents the server token, the contents of the 0600 auth-token
// file in the runtime dir (server/index.js, "The WebSocket"). The page cannot
// read files, so the app hands it the token in the URL fragment,
// http://127.0.0.1:3334/#token=<token>, which is never sent to a server; the
// page keeps it and strips it from the address bar (src/serverToken.ts).
// ---------------------------------------------------------------------------

// What the server writes: 32 random bytes as 64 lowercase hex digits
const SERVER_TOKEN_PATTERN = /^[0-9a-f]{64}$/

/** The runtime dir, as the server resolves it (server/runtime-dir.cjs): CLAUDEX_HOME, else ~/.claudex. */
function runtimeDirFromEnv(env = process.env, home = os.homedir()) {
  return require('../server/runtime-dir.cjs').runtimeDir(env, home)
}

/** The server token in `file`, or null when it is missing, unreadable or not a token. */
function readServerToken(file) {
  try {
    const token = fs.readFileSync(file, 'utf8').trim()
    return SERVER_TOKEN_PATTERN.test(token) ? token : null
  } catch {
    return null
  }
}

/**
 * Whether a /health answer proves it comes from the server holding `token`:
 * `proof` must be HMAC-SHA256(token, 'claudex-health:' + challenge), the
 * challenge being fresh random hex the caller sent (server/index.js
 * serverProof). Compared in constant time. The app checks it before it hands
 * the token to whatever answers on the port.
 */
function serverProofMatches(token, challenge, proof) {
  if (typeof token !== 'string' || !token || typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false
  const { createHmac, timingSafeEqual } = require('crypto')
  const expected = createHmac('sha256', token).update(`claudex-health:${challenge}`).digest()
  return timingSafeEqual(expected, Buffer.from(proof, 'hex'))
}

/** A fresh /health challenge: 16 random bytes as hex. */
function healthChallenge() {
  return require('crypto').randomBytes(16).toString('hex')
}

/** The page URL with the token in its fragment (the bare page without a token). */
function appLink(base, token) {
  const root = `${String(base).replace(/\/+$/, '')}/`
  return typeof token === 'string' && SERVER_TOKEN_PATTERN.test(token) ? `${root}#token=${token}` : root
}

/** A URL fit for a log line: a token in its fragment is masked. */
function redactLink(url) {
  return String(url).replace(/#token=[^&]*/, '#token=…')
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A {x, y, width, height} with four finite numbers and a positive size. */
function isRect(value) {
  return !!value && typeof value === 'object' &&
    ['x', 'y', 'width', 'height'].every(key => isFiniteNumber(value[key])) &&
    value.width > 0 && value.height > 0
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Fit `bounds` inside `workArea` (a display's area minus taskbar/dock):
 * never smaller than `min`, never larger than the work area, and moved so
 * every edge is on screen. A missing position centres the window. The
 * result is whole pixels.
 */
function clampBounds(bounds, workArea, min = { width: 1, height: 1 }) {
  const b = bounds && typeof bounds === 'object' ? bounds : {}
  const width = Math.round(clampNumber(isFiniteNumber(b.width) ? b.width : min.width, min.width, Math.max(min.width, workArea.width)))
  const height = Math.round(clampNumber(isFiniteNumber(b.height) ? b.height : min.height, min.height, Math.max(min.height, workArea.height)))
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height
  const x = isFiniteNumber(b.x)
    ? Math.round(clampNumber(b.x, workArea.x, Math.max(workArea.x, maxX)))
    : Math.round(workArea.x + (workArea.width - width) / 2)
  const y = isFiniteNumber(b.y)
    ? Math.round(clampNumber(b.y, workArea.y, Math.max(workArea.y, maxY)))
    : Math.round(workArea.y + (workArea.height - height) / 2)
  return { x, y, width, height }
}

// ---------------------------------------------------------------------------
// window-state.json
// ---------------------------------------------------------------------------

/**
 * Keep only what the file is meant to hold, with the right types; anything
 * else (an older format, a hand edit, a truncated write) is dropped rather
 * than trusted.
 */
function sanitizeWindowState(raw) {
  const state = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state
  // The app window: where it sits, its sizes and mode
  if (isRect(raw.widgetBounds)) state.widgetBounds = pickRect(raw.widgetBounds)
  for (const k of ['widgetCompactSize', 'widgetExpandedSize']) {
    const v = raw[k]
    if (v && Number.isFinite(v.width) && Number.isFinite(v.height) && v.width > 0 && v.height > 0) state[k] = { width: Math.round(v.width), height: Math.round(v.height) }
  }
  for (const k of ['widgetExpanded', 'widgetHidden']) if (typeof raw[k] === 'boolean') state[k] = raw[k]
  if (['widget', 'window', 'fullscreen'].includes(raw.widgetMode)) state.widgetMode = raw.widgetMode
  // The trainer's session names (session id -> name)
  if (raw.sessionTitles && typeof raw.sessionTitles === 'object' && !Array.isArray(raw.sessionTitles)) {
    const titles = {}
    for (const [id, t] of Object.entries(raw.sessionTitles).slice(-500)) {
      if (/^[0-9a-f-]{36}$/i.test(id) && typeof t === 'string' && t.trim()) titles[id] = t.trim().slice(0, 40)
    }
    state.sessionTitles = titles
  }
  return state
}

function pickRect({ x, y, width, height }) {
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/** Read the state file; a missing or unreadable file is an empty state. */
function readWindowState(file) {
  try {
    return sanitizeWindowState(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return {}
  }
}

/**
 * Write the state file (creating its directory), through a temp file and a
 * rename so a crash mid-write leaves the previous state intact. Returns
 * false, and logs nothing, when the directory cannot be written: window
 * state is a convenience, never a reason to fail.
 */
function writeWindowState(file, state) {
  const clean = sanitizeWindowState(state)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n')
    fs.renameSync(tmp, file)
    return true
  } catch {
    try { fs.unlinkSync(tmp) } catch {}
    return false
  }
}

// ---------------------------------------------------------------------------
// The tray
// ---------------------------------------------------------------------------

/**
 * What the tray shows, from `GET /sessions` ({ sessions: [...] }); null when
 * the request failed (server not reachable).
 *
 *   sessions  live Claude Code sessions
 *   working   sessions whose Claude is working
 *   needsYou  sessions whose Claude waits on the human (permission, question)
 */
function sessionSummary(body) {
  if (!body) return null
  const live = (Array.isArray(body.sessions) ? body.sessions : [])
    .filter(s => s && typeof s === 'object' && s.state !== 'ended')
  return {
    sessions: live.length,
    working: live.filter(s => s.main?.state === 'working').length,
    needsYou: live.filter(s => s.main?.state === 'needs-you').length,
  }
}

/** The tray's tooltip line. `t` is electron/i18n.cjs's; Korean by default. */
function statusText(summary, t = ko) {
  if (!summary) return t('서버에 연결할 수 없어요')
  if (summary.sessions === 0) return t('열린 세션 없음')
  const parts = [t('세션 {n}개', { n: summary.sessions })]
  if (summary.working > 0) parts.push(t('{n}개 일하는 중', { n: summary.working }))
  if (summary.needsYou > 0) parts.push(t('{n}개 확인 필요', { n: summary.needsYou }))
  return parts.join(' · ')
}

/**
 * The tray menu. `state` is { visible, status }; `actions` supplies
 * toggleWidget, openSettings, openQa, checkUpdate, openLogs and quit.
 */
function trayMenuTemplate(state, actions, t = ko) {
  return [
    { label: state.status ? `${APP_NAME} — ${state.status}` : APP_NAME, enabled: false },
    { type: 'separator' },
    { label: state.visible ? t('숨기기') : t('보이기'), click: () => actions.toggleWidget() },
    ...(actions.openSettings ? [{ label: t('설정'), click: () => actions.openSettings() }] : []),
    ...(actions.checkUpdate ? [{ label: t('업데이트 확인'), click: () => actions.checkUpdate() }] : []),
    ...(actions.openLogs ? [{ label: t('로그 폴더 열기'), click: () => actions.openLogs() }] : []),
    ...(actions.openQa ? [{ label: t('디자인 QA 페이지'), click: () => actions.openQa() }] : []),
    { type: 'separator' },
    { label: t('{app} 끝내기', { app: APP_NAME }), click: () => actions.quit() },
  ]
}

module.exports = {
  APP_NAME,
  DEFAULT_SERVER_PORT,
  VITE_DEV_PORT,
  serverPortFromEnv,
  serverUrls,
  classifyHealth,
  classifyIndex,
  serverPlan,
  serverConflictMessage,
  singleFlight,
  reopenAction,
  childSlot,
  SERVER_TOKEN_PATTERN,
  runtimeDirFromEnv,
  readServerToken,
  serverProofMatches,
  healthChallenge,
  appLink,
  redactLink,
  isRect,
  clampBounds,
  sanitizeWindowState,
  readWindowState,
  writeWindowState,
  sessionSummary,
  statusText,
  trayMenuTemplate,
}
