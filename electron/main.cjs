'use strict'

const { app, BrowserWindow, Menu, Notification, dialog, screen, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const http = require('http')
const {
  APP_NAME,
  serverPortFromEnv,
  serverUrls,
  classifyHealth,
  classifyIndex,
  serverPlan,
  serverConflictMessage,
  singleFlight,
  reopenAction,
  childSlot,
  clampBounds,
  readWindowState,
  writeWindowState,
  runtimeDirFromEnv,
  readServerToken,
  appLink,
  redactLink,
  serverProofMatches,
  healthChallenge,
} = require('./helpers.cjs')
const { createTray } = require('./tray.cjs')
const { createTerminalManager } = require('./terminals.cjs')
const { listHistory } = require('./history.cjs')
const { checkPrereqs, LINKS: PREREQ_LINKS } = require('./prereqs.cjs')
const { createUpdater, applyPendingUpdate } = require('./updater.cjs')
const { createLog, teeConsole } = require('./logs.cjs')
const { envVar, migrateRuntimeDir } = require('../server/runtime-dir.cjs')
// A dev run (`electron .`) keeps its own window state, session names and page
// storage, so trying a change never touches the installed app's
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Claudex-dev'))
// An update staged by the last run goes in before anything else loads; then start again on the new code
if (applyPendingUpdate(app)) { app.relaunch(); app.exit(0) }

// userData/logs/claudex.log: the console of this process and of the server
const log = createLog(path.join(app.getPath('userData'), 'logs'))
teeConsole(log)
console.log(`[main] Claudex ${app.getVersion()} starting (electron ${process.versions.electron}${app.isPackaged ? '' : ', dev'})`)
// ~/.agent-office (versions up to 1.3.7) -> ~/.claudex, once, before anything
// reads the token or starts the server (server/runtime-dir.cjs)
migrateRuntimeDir()
process.on('uncaughtException', (err) => { console.error('[main] uncaught:', err?.stack || err) })
process.on('unhandledRejection', (err) => { console.error('[main] unhandled rejection:', err?.stack || err) })
let updater = null

const PRELOAD = path.join(__dirname, 'preload.cjs')
const REPO_ROOT = path.join(__dirname, '..')

// The server's port: CLAUDEX_PORT, default 3334 (helpers.cjs mirrors
// server/config.js). The same number goes to the server child's environment,
// the window's load URL, the navigation allowlist and the tray's poller, so
// `CLAUDEX_PORT=4000 electron .` — or the variable in the environment a
// packaged app is launched with — moves the whole desktop app at once.
const SERVER_PORT = serverPortFromEnv(process.env)
const { serverUrl: SERVER_URL, healthUrl: HEALTH_URL, viteUrl: VITE_URL, allowedOrigins } = serverUrls(SERVER_PORT)

// The origins the app's pages come from: the Vite dev server (3333) and the
// server (SERVER_PORT). Only they may use the IPC bridge.
const ALLOWED_ORIGINS = new Set(allowedOrigins)

// The server sits next to this file in both layouts: <repo>/server in dev and
// <app>/resources/app/server in a packaged build (asar is off — see the build
// section of package.json — so the server, dist/ and node_modules are plain
// files the server process can read).
const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'index.js')

// The server token: the server child inherits this environment, so it keeps
// its auth-token in the same runtime dir. The pages load with the token in
// the URL fragment (helpers.cjs, "The page link").
const TOKEN_FILE = path.join(runtimeDirFromEnv(process.env), 'auth-token')

let widgetWin = null // the app
let toastWin = null  // catch notifications (?toast)
let qaWin = null     // the design QA page (?qa)
let terminals = null
let pageUrl = null // the page URL the windows load (with the token fragment)
let tray = null
// The server child this app spawned (helpers.cjs childSlot): the one stopServer stops
const server = childSlot()
let quitting = false

// Window state: the app window's place, sizes and mode, and the trainer's
// session names, in userData/window-state.json.
let state = {}
let saveTimer = null

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

/**
 * GET a URL: { statusCode, contentType, body } (the body capped at 64 KB),
 * or null when nothing answers within `timeoutMs`.
 */
function httpGet(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { if (body.length < 65536) body += chunk })
      res.on('end', () => resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'], body }))
      res.on('error', () => resolve(null))
    })
    req.on('error', () => resolve(null))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(null)
    })
  })
}

/**
 * What is already on SERVER_PORT (helpers.cjs classifyHealth): 'none',
 * 'usable' (a server that serves the page) or 'no-ui'. A
 * server too old to say whether it has the UI is asked for its page.
 */
async function probeServer() {
  const health = await httpGet(HEALTH_URL)
  const found = health ? classifyHealth(health.statusCode, health.body) : 'none'
  if (found !== 'unknown') return found
  const index = await httpGet(`${SERVER_URL}/`)
  return index ? classifyIndex(index.statusCode, index.contentType) : 'no-ui'
}

/**
 * Poll /health until the server responds OK or we exhaust retries.
 * Returns a Promise<boolean> — true if ready, false if timed out.
 */
function waitForServer(retries = 30, intervalMs = 300) {
  return new Promise((resolve) => {
    let attempts = 0

    function attempt() {
      attempts++
      const req = http.get(HEALTH_URL, (res) => {
        if (res.statusCode === 200) {
          resolve(true)
        } else if (attempts < retries) {
          setTimeout(attempt, intervalMs)
        } else {
          resolve(false)
        }
      })
      req.on('error', () => {
        if (attempts < retries) {
          setTimeout(attempt, intervalMs)
        } else {
          resolve(false)
        }
      })
      req.setTimeout(1000, () => {
        req.destroy()
        if (attempts < retries) {
          setTimeout(attempt, intervalMs)
        } else {
          resolve(false)
        }
      })
    }

    attempt()
  })
}

/**
 * Start the Express/WebSocket server as a child process.
 *
 * Packaged: run it on the Node bundled inside Electron (ELECTRON_RUN_AS_NODE
 * turns this very binary into a plain Node), so it does not depend on a
 * `node` on the user's PATH.
 *
 * Dev: use the Node that runs npm (`npm_node_execpath`, set by `npm run ...`),
 * or `node` from PATH.
 */
function startServer() {
  const running = server.get()
  if (running && running.exitCode === null && running.signalCode === null) {
    console.log('[main] Server process already running — not spawning another')
    return
  }
  const packaged = app.isPackaged
  const command = packaged ? process.execPath : (process.env.npm_node_execpath || 'node')
  // The child binds the port this process resolved, so an unparsable
  // CLAUDEX_PORT falls back to 3334 on both sides alike.
  const env = { ...process.env, CLAUDEX_PORT: String(SERVER_PORT) }
  if (packaged) env.ELECTRON_RUN_AS_NODE = '1'

  console.log(`[main] Spawning server: ${command} ${SERVER_ENTRY} (port ${SERVER_PORT})`)

  const child = server.adopt(spawn(command, [SERVER_ENTRY], {
    stdio: 'pipe',
    env,
  }))

  child.stdout.on('data', (data) => {
    process.stdout.write(`[server] ${data}`)
    log.write(`[server] ${data}`)
  })

  child.stderr.on('data', (data) => {
    process.stderr.write(`[server] ${data}`)
    log.write(`[server] [stderr] ${data}`)
  })

  // Only this child's own end clears the slot: a duplicate that lost the
  // port must not make the app forget the server it has to stop on quit
  child.on('exit', (code, signal) => {
    console.log(`[main] Server process exited — code=${code} signal=${signal}`)
    server.release(child)
  })

  child.on('error', (err) => {
    console.error('[main] Failed to start server process:', err.message)
    server.release(child)
  })
}

/**
 * Kill the server child process if we own it.
 */
function stopServer() {
  const child = server.take()
  if (child) {
    console.log('[main] Stopping server process...')
    child.kill('SIGTERM')
  }
}

// ---------------------------------------------------------------------------
// Debug aid: CLAUDEX_SCREENSHOT=<file.png> captures the app a moment
// after its page has loaded (CLAUDEX_SCREENSHOT_DELAY_MS, default 3000),
// then quits; an open notification goes to <file>-toast.png.
// ---------------------------------------------------------------------------

function maybeCaptureScreenshot() {
  const file = envVar('SCREENSHOT')
  if (!file) return
  const delay = Number(envVar('SCREENSHOT_DELAY_MS')) || 3000
  // Debug: CLAUDEX_AUTOTEST="<cwd>|<instruction>" opens a terminal and sends the instruction as the widget would
  const auto = process.env.CLAUDEX_AUTOTEST
  if (auto && terminals) {
    const [cwd, instruction] = auto.split('|')
    const t = terminals.create({ cwd })
    // Like the widget: a resting party Pokémon is thrown with the session
    http.get(`${SERVER_URL}/pokedex`, (res) => {
      let out = ''
      res.on('data', (c) => { out += c })
      res.on('end', () => {
        try {
          const dex = JSON.parse(out)
          const busy = new Set(Object.values(dex.assign ?? {}))
          const uid = (dex.party ?? []).find((u) => !busy.has(u))
          if (uid) serverPost('/pokedex/throw', { sessionId: t.sessionId, uid })
        } catch {}
      })
    }).on('error', () => {})
    if (instruction) setTimeout(() => terminals.sendInstruction(t.id, instruction), Math.max(500, delay / 2))
    // CLAUDEX_AUTOTEST_KEYS: raw keys typed 5 s in; the words DOWN and ENTER stand for those keys
    const keys = process.env.CLAUDEX_AUTOTEST_KEYS
    if (keys) setTimeout(() => terminals.write(t.id, keys.split('DOWN').join(String.fromCharCode(27) + '[B').split('ENTER').join(String.fromCharCode(13))), 5000)
  }
  // Debug: CLAUDEX_AUTOTEST_EXPAND=1|0 forces the widget's mode for the capture
  if (process.env.CLAUDEX_AUTOTEST_EXPAND) setTimeout(() => setWidgetExpanded(process.env.CLAUDEX_AUTOTEST_EXPAND === '1'), 1500)
  // Debug: CLAUDEX_AUTOTEST_WIDGET_JS runs in the app a second before the capture
  const wjs = process.env.CLAUDEX_AUTOTEST_WIDGET_JS
  if (wjs) setTimeout(() => { widgetWin?.webContents.executeJavaScript(wjs).catch((e) => console.error('[main] autotest widget js:', e.message)) }, Math.max(0, delay - 1500))
  setTimeout(async () => {
    try {
      if (toastWin && !toastWin.isDestroyed() && toastWin.isVisible()) {
        const timg = await toastWin.webContents.capturePage()
        fs.writeFileSync(file.replace(/\.png$/, '-toast.png'), timg.toPNG())
      }
    } catch {}
    try {
      const image = await widgetWin.webContents.capturePage()
      fs.writeFileSync(file, image.toPNG())
      const { width, height } = image.getSize()
      console.log(`[main] Screenshot written to ${file} (${width}x${height}, mode=${state.widgetMode ?? 'widget'})`)
    } catch (err) {
      console.error('[main] Screenshot failed:', err.message)
    }
    quitApp()
  }, delay)
}

// ---------------------------------------------------------------------------
// Window state
// ---------------------------------------------------------------------------

function saveState() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (!writeWindowState(stateFile(), state)) {
    console.error(`[main] Could not write ${stateFile()}`)
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveState, 500)
}

/**
 * Whether the server answering on SERVER_PORT holds `token`: it must answer
 * a fresh /health challenge with the HMAC only the token's holder can make.
 * A process that took the port while the app was down cannot, and must never
 * be handed the token in a page URL.
 */
async function serverHoldsToken(token) {
  const challenge = healthChallenge()
  const res = await httpGet(`${HEALTH_URL}?challenge=${challenge}`)
  if (!res || res.statusCode !== 200) return false
  try {
    return serverProofMatches(token, challenge, JSON.parse(res.body).proof)
  } catch {
    return false
  }
}

function quitApp() {
  quitting = true
  app.quit()
}

// ---------------------------------------------------------------------------
// Menus: the application menu (its accelerators: copy/paste, reload, dev
// tools) and the tray menu
// ---------------------------------------------------------------------------

function menuState() {
  return { visible: !!widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible() }
}

/**
 * Tray → 업데이트 확인: look now instead of waiting for the next check. When there
 * is one, the widget opens on its 업데이트 button; otherwise a notification says why.
 */
async function checkUpdateNow() {
  if (!updater) return
  const st = await updater.check()
  if (st.status === 'available' || st.status === 'downloading' || st.status === 'ready') {
    const w = createWidgetWindow()
    if (w) { w.show(); w.focus() }
    return
  }
  const body = st.status === 'current' ? `최신 버전이에요 (${st.current})` : `업데이트를 확인하지 못했어요${st.error ? ` (${st.error})` : ''}`
  if (Notification.isSupported()) new Notification({ title: APP_NAME, body, silent: true }).show()
}

const openLogs = () => { shell.openPath(log.dir).catch(() => {}) }
// The design QA page is for development: a dev run, or CLAUDEX_QA=1 on a packaged one
const showQa = !app.isPackaged || envVar('QA') === '1'
const menuActions = { toggleWidget, quit: quitApp, ...(showQa ? { openQa } : {}), checkUpdate: checkUpdateNow, openLogs }

function applicationMenuTemplate() {
  const isMac = process.platform === 'darwin'
  return [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: APP_NAME,
      submenu: [
        { label: '보이기/숨기기', click: toggleWidget },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
  ]
}

function refreshMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()))
  if (tray) tray.refresh()
}

// ---------------------------------------------------------------------------
// Startup: the server, then the app window
// ---------------------------------------------------------------------------

async function startApp() {
  // Check if a server is already running (e.g. launched separately during dev)
  const found = await probeServer()
  const plan = serverPlan(found, app.isPackaged)

  if (plan === 'conflict') {
    // The packaged app would show that server's "UI not built" error body.
    // Starting a second server on the same port cannot help (it would fail to
    // bind), so say what is going on instead.
    console.error(`[main] The server on port ${SERVER_PORT} serves no page — not loading it`)
    dialog.showErrorBox(APP_NAME, serverConflictMessage(SERVER_PORT))
    quitApp()
    return
  } else if (plan === 'reuse') {
    console.log(`[main] Server already running on port ${SERVER_PORT} — skipping spawn${found === 'usable' ? '' : ' (it has no built UI; this window loads the Vite dev server)'}`)
  } else {
    startServer()
    const ready = await waitForServer()
    if (ready) {
      console.log(`[main] Server is ready on ${SERVER_URL}`)
    } else if (app.isPackaged) {
      // The packaged app has nothing to show without its server — say so
      // instead of opening a blank window.
      console.error('[main] Server did not become ready in time')
      dialog.showErrorBox(
        APP_NAME,
        `The ${APP_NAME} server did not start on port ${SERVER_PORT}.\n\n` +
        `If something else is using that port, stop it and open ${APP_NAME} again, ` +
        `or launch it with CLAUDEX_PORT set to a free port.`,
      )
      quitApp()
      return
    } else {
      console.error('[main] Server did not become ready in time — continuing anyway (start it with `npm run server`)')
    }
  }

  state = readWindowState(stateFile())

  // Dev: the Vite dev server. Packaged: the server, which serves the built UI
  // from its root — one port for the page, its assets and the WebSocket.
  // Either way with the server token in the fragment, read now that the server
  // has answered /health (it writes the file before it answers anything), and
  // only once the server on the port has proved it holds it (serverHoldsToken)
  let token = readServerToken(TOKEN_FILE)
  if (!token) console.warn(`[main] No server token in ${TOKEN_FILE}: the app cannot act on the game`)
  else if (!(await serverHoldsToken(token))) {
    console.warn(`[main] The server on port ${SERVER_PORT} could not prove it holds the server token: not handing it over`)
    token = null
  }
  pageUrl = appLink(app.isPackaged ? SERVER_URL : VITE_URL, token)
  console.log(`[main] Loading ${redactLink(pageUrl)}`)

  refreshMenus()
  createTrayIcon()
  createWidgetWindow()
}

// ---------------------------------------------------------------------------
// The app window (the page with ?widget): the widget, a window or full screen
// ---------------------------------------------------------------------------

/** The page URL with a query (?widget, ?toast, ?qa), the token fragment kept */
function pageWith(query) {
  if (!pageUrl) return null
  const [base, fragment] = pageUrl.split('#')
  return `${base}?${query}${fragment ? `#${fragment}` : ''}`
}

/**
 * The app is one of two windows, never both:
 *   widget   the compact bento: transparent (the desktop shows through its
 *            gaps), always on top, no taskbar button, its own resize grip
 *   window   an ordinary window for the window and fullscreen modes: opaque,
 *            in the taskbar, so Windows Snap (with its preview), the resize
 *            border and maximize all work; "fullscreen" is maximized
 * A window cannot stop or start being transparent, so moving between the two
 * builds the other window, waits for its first paint and cross-fades (the
 * terminals live here in the main process and replay into the new page).
 */
const kindOf = (mode) => (mode === 'window' || mode === 'fullscreen' ? 'window' : 'widget')
const modeNow = () => (WIDGET_MODES.has(state.widgetMode) ? state.widgetMode : (state.widgetExpanded ? 'window' : 'widget'))

const WIDGET_MIN = Object.freeze({ width: 300, height: 540 })
// A window can be smaller: Windows Snap puts it in a quarter of the screen
const WINDOW_MIN = Object.freeze({ width: 560, height: 400 })
const WIDGET_COMPACT = Object.freeze({ width: 340, height: 680 })
const WIDGET_EXPANDED = Object.freeze({ width: 1200, height: 760 })
const WINDOW_BACKGROUND = '#0b0c10' // .widget.mode-window in widget-expanded.css

// The widget is a sidebar: 1.3.6 could save a snapped window's size as the
// widget's, so anything wider than this is taken as that and not used
const WIDGET_MAX_WIDTH = 640
function widgetSize(expanded, workArea) {
  let want = expanded ? (state.widgetExpandedSize ?? WIDGET_EXPANDED) : (state.widgetCompactSize ?? WIDGET_COMPACT)
  if (!expanded && want.width > WIDGET_MAX_WIDTH) want = WIDGET_COMPACT
  const min = expanded ? WINDOW_MIN : WIDGET_MIN
  return {
    width: Math.max(min.width, Math.min(want.width, workArea.width - 32)),
    height: Math.max(min.height, Math.min(want.height, workArea.height - 32)),
  }
}

/** The widget's place: against the right edge, the full height of the work area, a small gap all round */
const WIDGET_GAP = 12
function widgetDockBounds(workArea, width) {
  const w = Math.max(WIDGET_MIN.width, Math.min(width, workArea.width - 2 * WIDGET_GAP))
  return { x: workArea.x + workArea.width - w - WIDGET_GAP, y: workArea.y + WIDGET_GAP, width: w, height: workArea.height - 2 * WIDGET_GAP }
}

/** Where a window of `kind` opens: the widget docked right, a window where it last was. */
function boundsFor(kind, near) {
  const { workArea } = near ? screen.getDisplayMatching(near) : screen.getPrimaryDisplay()
  if (kind === 'widget') return widgetDockBounds(workArea, widgetSize(false, workArea).width)
  const size = widgetSize(true, workArea)
  const saved = state.widgetBounds
  if (saved && saved.width >= WINDOW_MIN.width) return clampBounds({ ...saved, ...size }, workArea, WINDOW_MIN)
  // First time as a window: its right edge where the widget's was
  const right = near ? near.x + near.width : workArea.x + workArea.width - 16
  return clampBounds({ x: right - size.width, y: workArea.y + 16, ...size }, workArea, WINDOW_MIN)
}

/** Build the app's window for `mode`; it shows itself once painted unless `hidden`. */
function buildAppWindow(mode, { hidden = false, near = null } = {}) {
  const url = pageWith(`widget&mode=${mode}`)
  if (!url) return null
  const kind = kindOf(mode)
  const isWidget = kind === 'widget'
  const win = new BrowserWindow({
    ...boundsFor(kind, near),
    minWidth: (isWidget ? WIDGET_MIN : WINDOW_MIN).width,
    minHeight: (isWidget ? WIDGET_MIN : WINDOW_MIN).height,
    title: 'Claudex',
    frame: false,
    transparent: isWidget,
    hasShadow: !isWidget,
    resizable: true,
    maximizable: !isWidget,
    alwaysOnTop: isWidget,
    skipTaskbar: isWidget,
    backgroundColor: isWidget ? '#00000000' : WINDOW_BACKGROUND,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: PRELOAD },
  })
  win.claudexKind = kind
  if (isWidget) win.setAlwaysOnTop(true, 'floating')
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('did-fail-load', (_event, code, description, failedUrl) => {
    console.error(`[main] The app failed to load ${redactLink(failedUrl)}: ${description} (${code})`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[main] The page's process ended: ${details.reason} (exit ${details.exitCode})`)
  })
  // The page's own errors, so a broken screen leaves a trace in the log
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 3) log.write(`[page] [error] ${message} (${String(source).split('/').pop()}:${line})`)
  })
  win.webContents.once('did-finish-load', () => {
    console.log(`[main] App window loaded (${kind})`)
    maybeCaptureScreenshot()
  })
  win.on('show', refreshMenus)
  win.on('hide', refreshMenus)
  const remember = () => {
    if (win.isDestroyed() || win !== widgetWin || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return
    const b = win.getBounds()
    if (win.claudexKind === 'window') {
      state.widgetBounds = b
      state.widgetExpandedSize = { width: b.width, height: b.height }
    } else if (b.width <= WIDGET_MAX_WIDTH) {
      state.widgetCompactSize = { width: b.width, height: b.height }
    }
    scheduleSave()
  }
  win.on('move', remember)
  win.on('resize', remember)
  if (!isWidget) {
    // Maximized (the button, a double-click on the title bar, a drag to the top
    // edge) is the fullscreen mode; restored it is the window mode
    win.on('maximize', () => { if (win === widgetWin) setModeQuietly('fullscreen') })
    win.on('unmaximize', () => { if (win === widgetWin) setModeQuietly('window') })
  }
  win.on('close', (event) => {
    if (quitting || win !== widgetWin) return
    event.preventDefault()
    win.hide()
    state.widgetHidden = true
    saveState()
  })
  win.on('closed', () => { if (widgetWin === win) widgetWin = null })
  win.once('ready-to-show', () => { win.claudexPainted = true; win.emit('claudex-painted') })
  if (!hidden) {
    win.once('ready-to-show', () => {
      if (win.isDestroyed() || win !== widgetWin) return
      if (mode === 'fullscreen') win.maximize()
      win.show()
    })
  }
  win.loadURL(url)
  return win
}

function createWidgetWindow() {
  if (widgetWin && !widgetWin.isDestroyed()) return widgetWin
  widgetWin = buildAppWindow(modeNow())
  return widgetWin
}

/** The page shows `mode`; the window is already right (moved by hand, maximized). */
function setModeQuietly(mode) {
  if (state.widgetMode === mode) return
  state.widgetMode = mode
  state.widgetExpanded = mode !== 'widget'
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send('widget:mode', mode)
  saveState()
}

/** Ease a window's opacity from `from` to `to` over `ms`. */
function fadeWindow(win, from, to, ms) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve()
    const t0 = Date.now()
    const tick = () => {
      if (win.isDestroyed()) return resolve()
      const k = Math.min(1, (Date.now() - t0) / ms)
      win.setOpacity(from + (to - from) * (1 - Math.pow(1 - k, 3)))
      if (k < 1) setTimeout(tick, 16)
      else resolve()
    }
    tick()
  })
}

/** Wait for a window's first paint (or give up after `ms`). */
function painted(win, ms = 4000) {
  return new Promise((resolve) => {
    if (win.claudexPainted) return resolve()
    const done = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(done, ms)
    win.once('claudex-painted', done)
    win.once('closed', done)
  })
}

/**
 * Swap the widget for a window (or back): the new one is built hidden at its
 * place, painted with its terminals replayed, then the two cross-fade.
 */
let swapping = Promise.resolve()
function swapAppWindow(mode) {
  swapping = swapping.then(async () => {
    const old = widgetWin && !widgetWin.isDestroyed() ? widgetWin : null
    if (old && old.claudexKind === kindOf(mode)) { setWidgetMode(mode); return }
    const wasVisible = !old || old.isVisible()
    state.widgetMode = mode
    state.widgetExpanded = mode !== 'widget'
    saveState()
    const next = buildAppWindow(mode, { hidden: true, near: old ? old.getBounds() : null })
    if (!next) return
    widgetWin = next
    await painted(next)
    // A moment for the terminals' scrollback to land in the new page
    await new Promise((r) => setTimeout(r, 120))
    if (next.isDestroyed()) return
    if (!wasVisible) { if (old && !old.isDestroyed()) old.destroy(); return }
    next.setOpacity(0)
    if (mode === 'fullscreen') next.maximize()
    next.show()
    next.focus()
    await Promise.all([fadeWindow(old, 1, 0, 140), fadeWindow(next, 0, 1, 200)])
    if (old && !old.isDestroyed()) old.destroy()
    state.widgetHidden = false
    refreshMenus()
  }).catch((err) => console.error('[main] Could not swap the app window:', err))
  return swapping
}

/**
 * Three ways to show the app:
 *   widget      the compact bento, always on top, no taskbar button
 *   window      widened with the terminal, an ordinary window (not on top)
 *   fullscreen  the same window, maximized
 */
const WIDGET_MODES = new Set(['widget', 'window', 'fullscreen'])
function setWidgetMode(mode) {
  if (!WIDGET_MODES.has(mode)) return modeNow()
  const w = widgetWin && !widgetWin.isDestroyed() ? widgetWin : null
  if (!w || w.claudexKind !== kindOf(mode)) {
    swapAppWindow(mode)
    return mode
  }
  // The same window: maximize or restore it (its events tell the page too)
  state.widgetMode = mode
  state.widgetExpanded = mode !== 'widget'
  if (mode === 'fullscreen' && !w.isMaximized()) w.maximize()
  if (mode === 'window' && w.isMaximized()) w.unmaximize()
  if (!w.isVisible()) w.show()
  w.focus()
  w.webContents.send('widget:mode', mode)
  saveState()
  return mode
}

/** Fold the widget into a window (or back), for the tray and debug runs. */
function setWidgetExpanded(expanded) {
  const now = modeNow()
  setWidgetMode(expanded ? (now === 'widget' ? 'window' : now) : 'widget')
  return !!expanded
}

/** The widget's own resize grip (a transparent window has no resizable frame on Windows). */
function resizeWidget(width, height) {
  if (!widgetWin || widgetWin.isDestroyed() || widgetWin.claudexKind !== 'widget') return
  const b = widgetWin.getBounds()
  const { workArea } = screen.getDisplayMatching(b)
  const w = Math.max(WIDGET_MIN.width, Math.min(Math.round(width), workArea.width, WIDGET_MAX_WIDTH))
  const h = Math.max(WIDGET_MIN.height, Math.min(Math.round(height), workArea.height))
  widgetWin.setBounds({ x: b.x, y: b.y, width: w, height: h })
}

// ---------------------------------------------------------------------------
// Catch notifications: a small window above every other window, bottom-right,
// that never takes the focus (the page with ?toast)
// ---------------------------------------------------------------------------

const TOAST_SIZE = Object.freeze({ width: 400, height: 138 })

function toastBounds() {
  const { workArea } = screen.getPrimaryDisplay()
  return { x: workArea.x + workArea.width - TOAST_SIZE.width - 12, y: workArea.y + workArea.height - TOAST_SIZE.height - 12, ...TOAST_SIZE }
}

function ensureToastWindow() {
  if (toastWin && !toastWin.isDestroyed()) return Promise.resolve(toastWin)
  const url = pageWith('toast')
  if (!url) return Promise.resolve(null)
  toastWin = new BrowserWindow({
    ...toastBounds(),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: PRELOAD },
  })
  toastWin.setAlwaysOnTop(true, 'screen-saver')
  toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  toastWin.webContents.on('will-navigate', (event) => event.preventDefault())
  toastWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  toastWin.on('closed', () => { toastWin = null })
  const ready = new Promise((resolve) => toastWin.webContents.once('did-finish-load', () => resolve(toastWin)))
  toastWin.loadURL(url)
  return ready
}

/** Hand an event to the notification window and show it without stealing the focus */
async function showToast(event) {
  const w = await ensureToastWindow()
  if (!w || w.isDestroyed()) return
  w.setBounds(toastBounds())
  w.webContents.send('toast:event', event)
  if (!w.isVisible()) w.showInactive()
  w.setAlwaysOnTop(true, 'screen-saver')
}

// The design QA page (?qa): every moment-only design at once, from the tray menu
function openQa() {
  if (qaWin && !qaWin.isDestroyed()) { qaWin.show(); qaWin.focus(); return }
  const url = pageWith('qa')
  if (!url) return
  qaWin = new BrowserWindow({
    width: 1100, height: 860, title: 'Claudex 디자인 QA', backgroundColor: '#0b0c10', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: PRELOAD },
  })
  qaWin.webContents.on('will-navigate', (event) => event.preventDefault())
  qaWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  qaWin.on('closed', () => { qaWin = null })
  qaWin.loadURL(url)
}

function hideToast() {
  if (toastWin && !toastWin.isDestroyed()) toastWin.hide()
}

/** A clicked notification: show the app and open the Pokédex at that species */
function openDexAt(id) {
  if (!Number.isInteger(id) || id < 1 || id > 2000) return
  hideToast()
  const w = createWidgetWindow()
  if (!w) return
  if (!w.isVisible()) { state.widgetHidden = false; saveState(); refreshMenus() }
  w.show()
  w.focus()
  w.webContents.send('widget:open-dex', id)
}

function toggleWidget() {
  const w = createWidgetWindow()
  if (!w) return
  if (w.isVisible()) { w.hide(); state.widgetHidden = true }
  else { w.show(); w.focus(); state.widgetHidden = false }
  saveState()
  refreshMenus()
}

// ---------------------------------------------------------------------------
// Terminals over IPC — only from this app's own windows
// ---------------------------------------------------------------------------

function sendToWindows(channel, payload) {
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send(channel, payload)
}

function fromOurWindow(event) {
  const wc = event.sender
  const ours = [widgetWin, toastWin, qaWin].some(w => w && !w.isDestroyed() && wc === w.webContents)
  if (!ours) return false
  try {
    return ALLOWED_ORIGINS.has(new URL(event.senderFrame.url).origin)
  } catch {
    return false
  }
}

/**
 * Tell the server a terminal's session is over (the hook's own SessionEnd
 * never fires when the terminal is closed or the app quits under it).
 * Authenticated with the server token, like the hook.
 */
function postSessionEnded(sessionId) {
  const token = readServerToken(TOKEN_FILE)
  if (!token) return
  const body = JSON.stringify({ type: 'session_ended', sessionId, reason: 'terminal closed' })
  const req = http.request(`${SERVER_URL}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${token}` },
    timeout: 1500,
  }, (res) => res.resume())
  req.on('error', () => {})
  req.on('timeout', () => req.destroy())
  req.end(body)
}

/** Put another Pokémon on a session: the server checks the rules; this carries the server token */
function swapPokemon(sessionId, uid) {
  const token = readServerToken(TOKEN_FILE)
  if (!token) return Promise.resolve({ ok: false, reason: 'no-token' })
  const body = JSON.stringify({ sessionId, uid })
  return new Promise((resolve) => {
    const req = http.request(`${SERVER_URL}/pokedex/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${token}` },
      timeout: 3000,
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { data += c })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({ ok: false, reason: 'bad-reply' }) } })
    })
    req.on('error', () => resolve({ ok: false, reason: 'server' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }) })
    req.end(body)
  })
}

/** POST to the server with the server token; resolves to the JSON reply */
function serverPost(pathname, body = {}) {
  const token = readServerToken(TOKEN_FILE)
  if (!token) return Promise.resolve({ ok: false, reason: 'no-token' })
  const data = JSON.stringify(body)
  return new Promise((resolve) => {
    const req = http.request(`${SERVER_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: `Bearer ${token}` },
      timeout: 15000,
    }, (res) => {
      let out = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { out += c })
      res.on('end', () => { try { resolve(JSON.parse(out)) } catch { resolve({ ok: false, reason: 'bad-reply' }) } })
    })
    req.on('error', () => resolve({ ok: false, reason: 'server' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }) })
    req.end(data)
  })
}

/** Google sign-in: the server makes a PKCE sign-in URL; only our Supabase project's authorize page is opened */
async function cloudSignIn() {
  let base = ''
  try { base = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'server', 'cloud-config.json'), 'utf8')).supabaseUrl.replace(/\/+$/, '') } catch {}
  const r = await serverPost('/auth/start')
  if (!r.ok || typeof r.url !== 'string' || !base || !r.url.startsWith(`${base}/auth/v1/authorize?`)) return { ok: false, reason: r.reason ?? 'bad-url' }
  shell.openExternal(r.url)
  return { ok: true }
}

function registerTerminalIpc() {
  // Session names the trainer gave, kept with the window state so a resumed session keeps its name
  const titles = {
    get: (sid) => state.sessionTitles?.[sid] ?? null,
    set: (sid, title) => {
      state.sessionTitles = { ...(state.sessionTitles ?? {}) }
      if (title) state.sessionTitles[sid] = title
      else delete state.sessionTitles[sid]
      saveState()
    },
  }
  terminals = createTerminalManager({ repoRoot: REPO_ROOT, userDataDir: app.getPath('userData'), send: sendToWindows, onExit: postSessionEnded, defaultCwd: app.getPath('documents'), titles })
  const guard = (fn) => (event, arg) => (fromOurWindow(event) ? fn(arg, event) : undefined)
  ipcMain.handle('terminals:list', guard(() => terminals.list()))
  ipcMain.handle('terminals:create', guard((opts) => {
    try {
      return terminals.create({ cwd: typeof opts?.cwd === 'string' ? opts.cwd : undefined, resume: typeof opts?.resume === 'string' ? opts.resume : undefined, sessionId: typeof opts?.sessionId === 'string' ? opts.sessionId : undefined })
    } catch (err) {
      console.error('[main] Could not start a terminal:', err.message)
      return { error: err.message }
    }
  }))
  ipcMain.handle('terminals:pick-folder', guard(async () => {
    const parent = widgetWin && !widgetWin.isDestroyed() ? widgetWin : undefined
    const r = await dialog.showOpenDialog(parent, { title: '포켓몬이 일할 폴더 선택', defaultPath: app.getPath('documents'), properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  }))
  ipcMain.handle('sessions:history', guard(() => {
    try { return listHistory({ limit: 40 }).map(h => (state.sessionTitles?.[h.id] ? { ...h, title: state.sessionTitles[h.id], named: true } : h)) } catch (err) { console.error('[main] history:', err.message); return [] }
  }))
  ipcMain.handle('terminals:buffer', guard((id) => terminals.buffer(String(id))))
  ipcMain.on('terminals:write', guard(({ id, data } = {}) => terminals.write(String(id), data)))
  // Only a window on screen sizes a session: a hidden or minimized one must not win
  // over the terminal the user is looking at
  ipcMain.on('terminals:resize', guard(({ id, cols, rows } = {}, event) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (!w || !w.isVisible() || w.isMinimized()) return
    terminals.resize(String(id), Number(cols), Number(rows))
  }))
  ipcMain.handle('terminals:send', guard(({ id, text } = {}) => terminals.sendInstruction(String(id), text)))
  ipcMain.handle('terminals:open-url', guard((url) => {
    try {
      const u = new URL(String(url))
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.toString())
    } catch {}
  }))
  ipcMain.handle('terminals:rename', guard(({ id, title } = {}) => terminals.rename(String(id), String(title ?? ''))))
  ipcMain.handle('terminals:close', guard((id) => terminals.close(String(id))))
  // What a session needs on this PC (Claude Code, Git, Python), and their install pages
  ipcMain.handle('env:check', guard(() => checkPrereqs()))
  ipcMain.handle('env:open-link', guard((key) => {
    const url = key === 'release' ? 'https://github.com/DueStar/claudex/releases/latest' : PREREQ_LINKS[key]
    if (url) shell.openExternal(url) // only the known install pages, never a page-supplied URL
  }))
  ipcMain.handle('cloud:signin', guard(() => cloudSignIn()))
  ipcMain.handle('cloud:signout', guard(() => serverPost('/auth/signout')))
  ipcMain.handle('cloud:sync', guard(() => serverPost('/auth/sync')))
  ipcMain.handle('game:throw', guard(({ sessionId, uid } = {}) => serverPost('/pokedex/throw', { sessionId: String(sessionId), uid: String(uid) })))
  ipcMain.on('toast:show', guard((event) => { if (event && typeof event === 'object') showToast(event) }))
  ipcMain.on('toast:done', guard(() => hideToast()))
  ipcMain.on('toast:open', guard((id) => openDexAt(Number(id))))
  ipcMain.handle('game:exchange', guard((o) => serverPost('/pokedex/exchange', { boxUid: String(o?.boxUid), partyUid: String(o?.partyUid) })))
  ipcMain.handle('game:release', guard((uid) => serverPost('/pokedex/release', { uid: String(uid) })))
  ipcMain.handle('game:swap', guard(({ sessionId, uid } = {}) => swapPokemon(String(sessionId), String(uid))))
  ipcMain.handle('update:get', guard(() => updater?.getState() ?? null))
  ipcMain.handle('update:install', guard(() => updater?.install() ?? null))
  ipcMain.handle('update:restart', guard(() => updater?.restart() ?? false))
  ipcMain.handle('widget:minimize', guard(() => { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.minimize() }))
  ipcMain.handle('widget:get-mode', guard(() => modeNow()))
  ipcMain.handle('widget:set-mode', guard((mode) => setWidgetMode(String(mode))))
  ipcMain.on('widget:resize', guard(({ width, height } = {}) => resizeWidget(Number(width), Number(height))))
  ipcMain.handle('widget:hide', guard(() => { if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.hide(); state.widgetHidden = true; saveState() } }))
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTrayIcon() {
  // One icon, however many times a window is created
  if (tray) { tray.dispose(); tray = null }
  try {
    tray = createTray({ serverUrl: SERVER_URL, getState: menuState, actions: menuActions })
    console.log('[main] Tray created')
  } catch (err) {
    tray = null
    console.error('[main] Tray unavailable:', err.message)
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// One packaged instance: opening the app again (from the Dock, a launcher or
// the Start menu) brings the existing window back instead of fighting over
// the port. Dev runs (`electron .`) are not locked, so one can run beside a
// packaged app.
/**
 * The single-instance lock, waited for a little: right after an update
 * restart (app.relaunch) the old run may still be letting go of it.
 */
function takeInstanceLock() {
  for (let i = 0; i < 20; i++) {
    if (app.requestSingleInstanceLock()) return true
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  }
  return false
}

if (app.isPackaged && !takeInstanceLock()) {
  app.quit()
} else {
  // Startup (probe the port, start the server, wait for it, open the window)
  // takes seconds; one run at a time, so a Dock click or a second launch in
  // the meantime cannot spawn a second server and open a second window
  const startOnce = singleFlight(startApp)
  const open = () => startOnce().catch((err) => console.error('[main] Could not start the app:', err))

  // Opened again (a Dock click, a second launch): wait for a startup in
  // progress, else show the window, else make one
  const reopen = () => {
    const action = reopenAction({
      quitting,
      starting: startOnce.pending(),
      hasWindow: !!widgetWin && !widgetWin.isDestroyed(),
      windowCount: BrowserWindow.getAllWindows().length,
    })
    if (action === 'show') { const w = createWidgetWindow(); if (w) { w.show(); w.focus() } }
    else if (action === 'create') open()
  }

  app.on('second-instance', reopen)

  app.whenReady().then(() => {
    registerTerminalIpc()
    // Updates: a look at GitHub Releases shortly after start, then every 30 minutes
    // (a small file: latest.json is a plain download, no API rate limit). The app
    // stays open for days, so 6 hours meant a release went unseen until the next morning.
    updater = createUpdater({ app, isPackaged: app.isPackaged, send: (channel, payload) => sendToWindows(channel, payload) })
    setTimeout(() => updater.check(), 15_000)
    setInterval(() => updater.check(), 30 * 60 * 1000).unref?.()
    // A local build folder (the developer's own PC) is looked at every minute
    setInterval(() => { if (updater.usesLocal()) updater.check() }, 60 * 1000).unref?.()
    return open()
  })

  app.on('window-all-closed', () => {
    stopServer()
    app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    if (terminals) {
      for (const t of terminals.list()) if (t.status === 'running') postSessionEnded(t.sessionId)
      terminals.killAll()
    }
    if (tray) { tray.dispose(); tray = null }
    stopServer()
  })

  app.on('activate', reopen)
}
