'use strict'

const { app, BrowserWindow, Menu, dialog, screen, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const http = require('http')
const { pathToFileURL } = require('url')
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
  acceleratorFor,
  shortcutFor,
  viewportFor,
  minSizeFor,
  defaultSizeFor,
  fitZoom,
  compactCss,
  clampBounds,
  placeInWorkArea,
  readWindowState,
  writeWindowState,
  statusText,
  windowTitle,
  trayMenuTemplate,
  runtimeDirFromEnv,
  readOfficeToken,
  officeLink,
  redactLink,
  officeProofMatches,
  healthChallenge,
  writeRedirectPage,
} = require('./helpers.cjs')
const { createTray } = require('./tray.cjs')
const { createTerminalManager } = require('./terminals.cjs')
const { listHistory } = require('./history.cjs')
const { checkPrereqs, LINKS: PREREQ_LINKS } = require('./prereqs.cjs')
const { createUpdater, applyPendingUpdate } = require('./updater.cjs')
// An update staged by the last run goes in before anything else loads; then start again on the new code
if (applyPendingUpdate(app)) { app.relaunch(); app.exit(0) }
let updater = null

const PRELOAD = path.join(__dirname, 'preload.cjs')
const REPO_ROOT = path.join(__dirname, '..')

// The server's port: AGENT_OFFICE_PORT, default 3334 (helpers.cjs mirrors
// server/config.js). The same number goes to the server child's environment,
// the window's load URL, the navigation allowlist and the tray's poller, so
// `AGENT_OFFICE_PORT=4000 electron .` — or the variable in the environment a
// packaged app is launched with — moves the whole desktop app at once.
const SERVER_PORT = serverPortFromEnv(process.env)
const { serverUrl: SERVER_URL, healthUrl: HEALTH_URL, viteUrl: VITE_URL, allowedOrigins } = serverUrls(SERVER_PORT)

// Allowed origins for navigation and new-window events: the Vite dev server
// (3333) and the office server (SERVER_PORT), by name or loopback IP.
const ALLOWED_ORIGINS = new Set(allowedOrigins)

// The server sits next to this file in both layouts: <repo>/server in dev and
// <app>/resources/app/server in a packaged build (asar is off — see the build
// section of package.json — so the server, dist/ and node_modules are plain
// files the server process can read).
const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'index.js')

// The office token: the server child inherits this environment, so it keeps
// its auth-token in the same runtime dir. The window loads the office with
// the token in the URL fragment (helpers.cjs, "The office link"); without it
// the page would show the office read-only.
const TOKEN_FILE = path.join(runtimeDirFromEnv(process.env), 'auth-token')
const REDIRECT_FILE = path.join(runtimeDirFromEnv(process.env), 'open-office.html')

// Window icon for Linux (macOS and Windows take it from the bundle / the exe).
const WINDOW_ICON = path.join(__dirname, 'assets', 'icon.png')

// Closing the window keeps the app in the tray on macOS (the Dock icon brings
// it back) and Windows. Linux desktops do not all show a tray, so there a
// close is a quit — nothing is left running invisibly.
const HIDE_ON_CLOSE = process.platform !== 'linux'

let win = null
let widgetWin = null
let toastWin = null
let terminals = null
let officeUrl = null // the page URL the windows load (with the token fragment)
let tray = null
// The server child this app spawned (helpers.cjs childSlot): the one stopServer stops
const server = childSlot()
let quitting = false

// Window state: the full window's bounds, the compact widget's bounds, which
// mode is on and the always-on-top preference, in userData/window-state.json.
let state = {}
let compact = false
let compactCssKey = null
let saveTimer = null
let lastStatus = '' // the tray's last status line, for the right-click menu

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
 * 'usable' (an office server that serves the office page) or 'no-ui'. A
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
 * turns this very binary into a plain Node). That is the ABI the packaged
 * better-sqlite3 is built for (see electron/after-pack.cjs), and it does not
 * depend on a `node` on the user's PATH — apps opened from Finder, the Dock or
 * a launcher get a bare system PATH without Homebrew/nvm.
 *
 * Dev: node_modules are built for the system Node, so use the Node that runs
 * npm (`npm_node_execpath`, set by `npm run ...`), or `node` from PATH.
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
  // AGENT_OFFICE_PORT falls back to 3334 on both sides alike.
  const env = { ...process.env, AGENT_OFFICE_PORT: String(SERVER_PORT) }
  if (packaged) env.ELECTRON_RUN_AS_NODE = '1'

  console.log(`[main] Spawning server: ${command} ${SERVER_ENTRY} (port ${SERVER_PORT})`)

  const child = server.adopt(spawn(command, [SERVER_ENTRY], {
    stdio: 'pipe',
    env,
  }))

  child.stdout.on('data', (data) => {
    process.stdout.write(`[server] ${data}`)
  })

  child.stderr.on('data', (data) => {
    process.stderr.write(`[server] ${data}`)
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
// Debug aid: AGENT_OFFICE_SCREENSHOT=<file.png> captures the window a moment
// after the page has loaded (AGENT_OFFICE_SCREENSHOT_DELAY_MS, default 3000),
// then quits. Used to verify a packaged build headlessly (xvfb); with
// --compact it captures the compact widget.
// ---------------------------------------------------------------------------

function maybeCaptureScreenshot() {
  const file = process.env.AGENT_OFFICE_SCREENSHOT
  if (!file) return
  const delay = Number(process.env.AGENT_OFFICE_SCREENSHOT_DELAY_MS) || 3000
  // Debug: POKEMON_OFFICE_AUTOTEST="<cwd>|<instruction>" opens a terminal and sends the instruction as the widget would
  const auto = process.env.POKEMON_OFFICE_AUTOTEST
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
    // POKEMON_OFFICE_AUTOTEST_KEYS: raw keys typed 5 s in; the words DOWN and ENTER stand for those keys
    const keys = process.env.POKEMON_OFFICE_AUTOTEST_KEYS
    if (keys) setTimeout(() => terminals.write(t.id, keys.split('DOWN').join(String.fromCharCode(27) + '[B').split('ENTER').join(String.fromCharCode(13))), 5000)
  }
  // Debug: POKEMON_OFFICE_AUTOTEST_EXPAND=1|0 forces the widget's mode for the capture
  if (process.env.POKEMON_OFFICE_AUTOTEST_EXPAND) setTimeout(() => setWidgetExpanded(process.env.POKEMON_OFFICE_AUTOTEST_EXPAND === '1'), 1500)
  // Debug: POKEMON_OFFICE_AUTOTEST_JS runs in the office page a second before the capture
  // Debug: POKEMON_OFFICE_AUTOTEST_WIDGET_JS runs in the widget a second before the capture
  const wjs = process.env.POKEMON_OFFICE_AUTOTEST_WIDGET_JS
  if (wjs) setTimeout(() => { widgetWin?.webContents.executeJavaScript(wjs).catch((e) => console.error('[main] autotest widget js:', e.message)) }, Math.max(0, delay - 1500))
  const js = process.env.POKEMON_OFFICE_AUTOTEST_JS
  if (js) setTimeout(() => { win.webContents.executeJavaScript(js).catch((e) => console.error('[main] autotest js:', e.message)) }, Math.max(0, delay - 1500))
  setTimeout(async () => {
    try {
      if (toastWin && !toastWin.isDestroyed() && toastWin.isVisible()) {
        const timg = await toastWin.webContents.capturePage()
        fs.writeFileSync(file.replace(/\.png$/, '-toast.png'), timg.toPNG())
      }
    } catch {}
    try {
      if (widgetWin && !widgetWin.isDestroyed()) {
        const wimg = await widgetWin.webContents.capturePage()
        fs.writeFileSync(file.replace(/\.png$/, '-widget.png'), wimg.toPNG())
      }
    } catch (err) {
      console.error('[main] Widget screenshot failed:', err.message)
    }
    try {
      const image = await win.webContents.capturePage()
      fs.writeFileSync(file, image.toPNG())
      const { width, height } = image.getSize()
      const [cw, ch] = win.getContentSize()
      console.log(`[main] Screenshot written to ${file} (${width}x${height}; content ${cw}x${ch}, zoom ${win.webContents.getZoomFactor().toFixed(3)}, compact=${compact})`)
    } catch (err) {
      console.error('[main] Screenshot failed:', err.message)
    }
    quitApp()
  }, delay)
}

// ---------------------------------------------------------------------------
// Window state and modes
// ---------------------------------------------------------------------------

/** Bounds for a mode: the saved ones, else the defaults, clamped on screen. */
function boundsFor(isCompact, near) {
  const saved = isCompact ? state.compactBounds : state.bounds
  const display = saved ? screen.getDisplayMatching(saved) : near ? screen.getDisplayMatching(near) : screen.getPrimaryDisplay()
  const { workArea } = display
  // The desktop layout (map | terminals | chat) wants room: most of the screen by default
  const size = isCompact ? defaultSizeFor(true) : { width: Math.min(1480, workArea.width - 40), height: Math.min(900, workArea.height - 40) }
  const wanted = saved ?? placeInWorkArea(size, workArea, isCompact ? 'top-right' : 'center')
  return clampBounds(wanted, workArea, minSizeFor(isCompact))
}

/** Record the current bounds for the current mode (not while minimized etc.). */
function rememberBounds() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return
  const bounds = win.getBounds()
  if (compact) state.compactBounds = bounds
  else state.bounds = bounds
}

function saveState() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  state.compact = compact
  if (!writeWindowState(stateFile(), state)) {
    console.error(`[main] Could not write ${stateFile()}`)
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { rememberBounds(); saveState() }, 500)
}

/** Zoom the page so the mode's viewport fits the window content area. */
function applyZoom() {
  if (!win || win.isDestroyed()) return
  if (!compact) { win.webContents.setZoomFactor(1); return }
  const [width, height] = win.getContentSize()
  win.webContents.setZoomFactor(fitZoom({ width, height }, viewportFor(compact)))
}

/** Insert (compact) or remove (full) the CSS that centres the room column. */
async function applyCompactCss() {
  if (!win || win.isDestroyed()) return
  const contents = win.webContents
  if (compactCssKey) {
    const key = compactCssKey
    compactCssKey = null
    try { await contents.removeInsertedCSS(key) } catch {}
  }
  if (compact) {
    try { compactCssKey = await contents.insertCSS(compactCss()) } catch (err) {
      console.error('[main] Could not apply compact CSS:', err.message)
    }
  }
}

function isAlwaysOnTop() {
  return compact || state.alwaysOnTop === true
}

/** Switch between the full office and the compact widget. */
function setCompact(next) {
  next = !!next
  if (!win || win.isDestroyed() || next === compact) return
  rememberBounds()
  const near = win.getBounds()
  compact = next
  const min = minSizeFor(compact)
  win.setMinimumSize(min.width, min.height)
  win.setBounds(boundsFor(compact, near))
  win.setAlwaysOnTop(isAlwaysOnTop(), 'floating')
  win.setVisibleOnAllWorkspaces(compact, { visibleOnFullScreen: compact })
  applyCompactCss()
  applyZoom()
  console.log(`[main] ${compact ? 'Compact widget' : 'Full office'} (${win.getContentSize().join('x')})`)
  saveState()
  refreshMenus()
}

function setAlwaysOnTop(flag) {
  state.alwaysOnTop = !!flag
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(isAlwaysOnTop(), 'floating')
  saveState()
  refreshMenus()
}

/** Back to the mode's default size and spot. */
function resetBounds() {
  if (!win || win.isDestroyed()) return
  if (compact) delete state.compactBounds
  else delete state.bounds
  win.setBounds(boundsFor(compact, win.getBounds()))
  applyZoom()
  saveState()
}

function showWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && !win.isMinimized()) win.hide()
  else showWindow()
  refreshMenus()
}

/**
 * The same office in the default browser, with the token: through the
 * redirect page in the runtime dir, so the token is never on an opener's
 * command line (helpers.cjs). Without a token, the bare (read-only) page.
 */
/**
 * Whether the server answering on SERVER_PORT holds `token`: it must answer
 * a fresh /health challenge with the HMAC only the token's holder can make.
 * A process that took the port while the office was down cannot, and must
 * never be handed the token (in a page URL or the redirect page).
 */
async function serverHoldsToken(token) {
  const challenge = healthChallenge()
  const res = await httpGet(`${HEALTH_URL}?challenge=${challenge}`)
  if (!res || res.statusCode !== 200) return false
  try {
    return officeProofMatches(token, challenge, JSON.parse(res.body).proof)
  } catch {
    return false
  }
}

async function openInBrowser() {
  let token = readOfficeToken(TOKEN_FILE)
  if (token && !(await serverHoldsToken(token))) {
    console.warn(`[main] The server on port ${SERVER_PORT} could not prove it holds the office token: opening the read-only page`)
    token = null
  }
  if (!token) {
    shell.openExternal(`${SERVER_URL}/`)
    return
  }
  try {
    writeRedirectPage(REDIRECT_FILE, officeLink(SERVER_URL, token))
    shell.openExternal(pathToFileURL(REDIRECT_FILE).href)
  } catch (err) {
    console.error('[main] Could not write the redirect page:', err.message)
    shell.openExternal(`${SERVER_URL}/`)
  }
}

function quitApp() {
  quitting = true
  app.quit()
}

// ---------------------------------------------------------------------------
// Menus: the application menu (menu bar on macOS, accelerators everywhere),
// the tray menu and the window's right-click menu, which mirrors the tray.
// ---------------------------------------------------------------------------

function menuState() {
  return {
    visible: !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized(),
    compact,
    alwaysOnTop: state.alwaysOnTop === true,
  }
}

const menuActions = { toggleWindow, toggleWidget, toggleMain: toggleWidget, setCompact, setAlwaysOnTop, resetBounds, openInBrowser, quit: quitApp, openQa }

/** A keyboard shortcut (helpers.cjs SHORTCUTS), the same as its menu item. */
function runShortcut(action) {
  switch (action) {
    case 'toggleCompact': toggleWidget(); break
    case 'toggleAlwaysOnTop': if (!compact) setAlwaysOnTop(!state.alwaysOnTop); break
    case 'openInBrowser': openInBrowser(); break
    case 'resetBounds': resetBounds(); break
  }
}

function applicationMenuTemplate() {
  const isMac = process.platform === 'darwin'
  return [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Office',
      submenu: [
        { label: '위젯 보이기/숨기기', click: toggleWidget },
        { label: 'Always on top', type: 'checkbox', checked: isAlwaysOnTop(), enabled: !compact, accelerator: acceleratorFor('toggleAlwaysOnTop'), click: () => setAlwaysOnTop(!state.alwaysOnTop) },
        { label: 'Reset window size', accelerator: acceleratorFor('resetBounds'), click: resetBounds },
        { type: 'separator' },
        { label: 'Open in browser', accelerator: acceleratorFor('openInBrowser'), click: openInBrowser },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
}

function refreshMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()))
  if (tray) tray.refresh()
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

async function createWindow() {
  // Check if a server is already running (e.g. launched separately during dev)
  const found = await probeServer()
  const plan = serverPlan(found, app.isPackaged)

  if (plan === 'conflict') {
    // The packaged window would show that server's "UI not built" error body.
    // Starting a second server on the same port cannot help (it would fail to
    // bind), so say what is going on instead.
    console.error(`[main] The server on port ${SERVER_PORT} serves no office page — not loading it`)
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
        `The office server did not start on port ${SERVER_PORT}.\n\n` +
        `If something else is using that port, stop it and open ${APP_NAME} again, ` +
        `or launch it with AGENT_OFFICE_PORT set to a free port.`,
      )
      quitApp()
      return
    } else {
      console.error('[main] Server did not become ready in time — continuing anyway (start it with `npm run server`)')
    }
  }

  state = readWindowState(stateFile())
  compact = app.commandLine.hasSwitch('compact') || state.compact === true
  const bounds = boundsFor(compact)
  const min = minSizeFor(compact)
  console.log(`[main] Window ${compact ? 'compact' : 'full'} at ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height} (state: ${stateFile()})`)

  win = new BrowserWindow({
    ...bounds,
    useContentSize: true,
    minWidth: min.width,
    minHeight: min.height,
    title: APP_NAME,
    icon: process.platform === 'linux' ? WINDOW_ICON : undefined,
    alwaysOnTop: isAlwaysOnTop(),
    // The widget is the app; the office map opens from the tray when wanted
    show: false,
    // The office draws its own title bar (the drag region is in office.css)
    frame: false,
    transparent: false,
    resizable: true,
    minimizable: true,
    skipTaskbar: false,
    backgroundColor: '#0a0a0f',
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD,
      zoomFactor: compact ? fitZoom(bounds, viewportFor(compact)) : 1,
    },
  })

  // Prevent navigation away from the app origin
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const origin = new URL(url).origin
      if (!ALLOWED_ORIGINS.has(origin)) {
        event.preventDefault()
      }
    } catch {
      event.preventDefault()
    }
  })

  // Prevent opening new windows (links, window.open, etc.)
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  // Inserted CSS and the zoom do not survive a reload: apply them per load.
  win.webContents.on('dom-ready', applyZoom)
  win.webContents.on('did-finish-load', () => {
    console.log(`[main] Window loaded ${redactLink(win.webContents.getURL())}`)
    compactCssKey = null
    applyCompactCss()
    applyZoom()
    maybeCaptureScreenshot()
  })

  win.webContents.on('did-fail-load', (_event, code, description, failedUrl) => {
    console.error(`[main] Window failed to load ${failedUrl}: ${description} (${code})`)
  })

  // The window's shortcuts, handled before the page or a menu sees the keys:
  // on Windows and Linux the frameless window has no menu bar to carry them
  // (helpers.cjs, "Keyboard shortcuts"). Consuming the key also keeps a menu
  // accelerator for the same keys from firing a second time.
  win.webContents.on('before-input-event', (event, input) => {
    const action = shortcutFor(input)
    if (!action) return
    event.preventDefault()
    runShortcut(action)
  })

  // Right-click anywhere that is not a text field: the tray menu, so the
  // frameless window has its controls on every platform.
  win.webContents.on('context-menu', (event, params) => {
    if (params.isEditable) return
    event.preventDefault()
    Menu.buildFromTemplate(trayMenuTemplate({ ...menuState(), status: lastStatus }, menuActions)).popup({ window: win })
  })

  win.on('resize', () => { applyZoom(); scheduleSave() })
  win.on('move', scheduleSave)
  win.on('show', refreshMenus)
  win.on('hide', refreshMenus)
  win.on('minimize', refreshMenus)
  win.on('restore', refreshMenus)

  win.on('close', (event) => {
    rememberBounds()
    saveState()
    if (!quitting && HIDE_ON_CLOSE) {
      event.preventDefault()
      win.hide()
      refreshMenus()
    }
  })

  win.on('closed', () => { win = null })

  if (compact) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Dev: the Vite dev server. Packaged: the office server, which serves the
  // built UI from its root — one port for the page, its assets and the
  // WebSocket, with an http:// origin the server's allowlist accepts. Either
  // way with the office token in the fragment, read now that the server has
  // answered /health (it writes the file before it answers anything).
  // The token goes into the page only once the server on the port has
  // proved it holds it (serverHoldsToken): otherwise read-only
  let token = readOfficeToken(TOKEN_FILE)
  if (!token) console.warn(`[main] No office token in ${TOKEN_FILE}: the office is shown read-only`)
  else if (!(await serverHoldsToken(token))) {
    console.warn(`[main] The server on port ${SERVER_PORT} could not prove it holds the office token: the office is shown read-only`)
    token = null
  }
  if (!win || win.isDestroyed()) return
  const url = officeLink(app.isPackaged ? SERVER_URL : VITE_URL, token)
  officeUrl = url
  console.log(`[main] Loading ${redactLink(url)}`)
  win.loadURL(url)

  refreshMenus()
  createTrayIcon()
  createWidgetWindow()
}

// ---------------------------------------------------------------------------
// The widget: a small always-on-top window (the page with ?widget)
// ---------------------------------------------------------------------------

function widgetUrl() {
  if (!officeUrl) return null
  const [base, fragment] = officeUrl.split('#')
  return `${base}?widget${fragment ? `#${fragment}` : ''}`
}

function createWidgetWindow() {
  if (widgetWin && !widgetWin.isDestroyed()) return widgetWin
  const url = widgetUrl()
  if (!url) return null
  const { workArea } = screen.getPrimaryDisplay()
  const saved = state.widgetBounds
  const size = widgetSize(state.widgetExpanded === true, workArea)
  // The widget opens docked to the right edge, top to bottom; a window opens where it was
  const bounds = state.widgetExpanded !== true ? widgetDockBounds(workArea, size.width)
    : saved ? clampBounds({ ...saved, ...size }, workArea, WIDGET_MIN)
      : { x: workArea.x + workArea.width - size.width - 16, y: workArea.y + 16, ...size }
  widgetWin = new BrowserWindow({
    ...bounds,
    minWidth: WIDGET_MIN.width,
    minHeight: WIDGET_MIN.height,
    title: 'Claudex',
    frame: false,
    // Transparent: the Pokémon float in the open above the cards, and the
    // desktop shows through the gaps of the bento
    transparent: true,
    hasShadow: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    show: true, // the widget is the app: it always opens
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: PRELOAD },
  })
  // A window or fullscreen app is an ordinary window; only the widget floats on top
  if (state.widgetMode === 'window' || state.widgetMode === 'fullscreen') {
    widgetWin.setAlwaysOnTop(false)
    widgetWin.setSkipTaskbar(false)
    if (state.widgetMode === 'fullscreen') widgetWin.setBounds(screen.getDisplayMatching(widgetWin.getBounds()).workArea)
  } else {
    widgetWin.setAlwaysOnTop(true, 'floating')
  }
  widgetWin.webContents.on('will-navigate', (event) => event.preventDefault())
  widgetWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const remember = () => {
    if (!widgetWin || widgetWin.isDestroyed() || widgetWin.isFullScreen() || state.widgetMode === 'fullscreen') return
    const b = widgetWin.getBounds()
    state.widgetBounds = b
    if (state.widgetExpanded) state.widgetExpandedSize = { width: b.width, height: b.height }
    else state.widgetCompactSize = { width: b.width, height: b.height }
    scheduleSave()
  }
  widgetWin.on('move', remember)
  widgetWin.on('resize', remember)
  widgetWin.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    widgetWin.hide()
    state.widgetHidden = true
    saveState()
  })
  widgetWin.on('closed', () => { widgetWin = null })
  widgetWin.loadURL(url)
  return widgetWin
}

const WIDGET_MIN = Object.freeze({ width: 300, height: 540 })
const WIDGET_COMPACT = Object.freeze({ width: 340, height: 680 })
const WIDGET_EXPANDED = Object.freeze({ width: 1200, height: 760 })

function widgetSize(expanded, workArea) {
  const want = expanded ? (state.widgetExpandedSize ?? WIDGET_EXPANDED) : (state.widgetCompactSize ?? WIDGET_COMPACT)
  return {
    width: Math.max(WIDGET_MIN.width, Math.min(want.width, workArea.width - 32)),
    height: Math.max(WIDGET_MIN.height, Math.min(want.height, workArea.height - 32)),
  }
}

/** The widget's place: against the right edge, the full height of the work area, a small gap all round */
const WIDGET_GAP = 12
function widgetDockBounds(workArea, width) {
  const w = Math.max(WIDGET_MIN.width, Math.min(width, workArea.width - 2 * WIDGET_GAP))
  return { x: workArea.x + workArea.width - w - WIDGET_GAP, y: workArea.y + WIDGET_GAP, width: w, height: workArea.height - 2 * WIDGET_GAP }
}

/** Fold the widget into a terminal (or back), keeping its right edge where it is. */
function setWidgetExpanded(expanded) {
  const w = createWidgetWindow()
  if (!w) return false
  state.widgetExpanded = !!expanded
  const b = w.getBounds()
  const { workArea } = screen.getDisplayMatching(b)
  const size = widgetSize(state.widgetExpanded, workArea)
  const right = b.x + b.width
  // Folded back to the widget: docked to the right edge, top to bottom
  const next = state.widgetExpanded
    ? clampBounds({ x: right - size.width, y: b.y, ...size }, workArea, WIDGET_MIN)
    : widgetDockBounds(workArea, size.width)
  w.setBounds(next)
  w.webContents.send('widget:expanded', state.widgetExpanded)
  // Keep the mode in step for callers that only fold or unfold (the tray, debug runs)
  if (!state.widgetExpanded) state.widgetMode = 'widget'
  else if (!state.widgetMode || state.widgetMode === 'widget') state.widgetMode = 'window'
  w.webContents.send('widget:mode', state.widgetMode)
  if (!w.isVisible()) w.show()
  w.focus()
  saveState()
  return state.widgetExpanded
}

/**
 * Three ways to show the app:
 *   widget      the compact bento, always on top, no taskbar button
 *   window      widened with the terminal, an ordinary window (not on top)
 *   fullscreen  the same, filling the screen
 */
const WIDGET_MODES = new Set(['widget', 'window', 'fullscreen'])
function setWidgetMode(mode) {
  if (!WIDGET_MODES.has(mode)) return state.widgetMode ?? 'widget'
  const w = createWidgetWindow()
  if (!w) return state.widgetMode ?? 'widget'
  if (w.isFullScreen() && mode !== 'fullscreen') w.setFullScreen(false)
  state.widgetMode = mode
  if (mode === 'widget') {
    setWidgetExpanded(false)
    w.setAlwaysOnTop(true, 'floating')
    w.setSkipTaskbar(true)
  } else {
    if (mode === 'window' || !state.widgetExpanded) setWidgetExpanded(true)
    w.setAlwaysOnTop(false)
    w.setSkipTaskbar(false)
    // "Fullscreen" fills the screen's work area: the taskbar stays visible and nothing is cut off under it
    if (mode === 'fullscreen') w.setBounds(screen.getDisplayMatching(w.getBounds()).workArea)
  }
  w.webContents.send('widget:mode', mode)
  saveState()
  return mode
}

/** The widget's own resize grip (a transparent window has no resizable frame on Windows). */
function resizeWidget(width, height) {
  if (!widgetWin || widgetWin.isDestroyed()) return
  const b = widgetWin.getBounds()
  const { workArea } = screen.getDisplayMatching(b)
  const w = Math.max(WIDGET_MIN.width, Math.min(Math.round(width), workArea.width))
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
  if (!officeUrl) return Promise.resolve(null)
  const [base, fragment] = officeUrl.split('#')
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
  toastWin.loadURL(`${base}?toast${fragment ? `#${fragment}` : ''}`)
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
let qaWin = null
function openQa() {
  if (qaWin && !qaWin.isDestroyed()) { qaWin.show(); qaWin.focus(); return }
  if (!officeUrl) return
  const [base, fragment] = officeUrl.split('#')
  qaWin = new BrowserWindow({
    width: 1100, height: 860, title: 'Claudex 디자인 QA', backgroundColor: '#0b0c10', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: PRELOAD },
  })
  qaWin.webContents.on('will-navigate', (event) => event.preventDefault())
  qaWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  qaWin.on('closed', () => { qaWin = null })
  qaWin.loadURL(`${base}?qa${fragment ? `#${fragment}` : ''}`)
}

function hideToast() {
  if (toastWin && !toastWin.isDestroyed()) toastWin.hide()
}

function toggleWidget() {
  const w = createWidgetWindow()
  if (!w) return
  if (w.isVisible()) { w.hide(); state.widgetHidden = true }
  else { w.showInactive(); state.widgetHidden = false }
  saveState()
}

// ---------------------------------------------------------------------------
// Terminals over IPC — only from this app's own windows
// ---------------------------------------------------------------------------

function sendToWindows(channel, payload) {
  for (const w of [win, widgetWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function fromOurWindow(event) {
  const wc = event.sender
  const ours = [win, widgetWin, toastWin, qaWin].some(w => w && !w.isDestroyed() && wc === w.webContents)
  if (!ours) return false
  try {
    return ALLOWED_ORIGINS.has(new URL(event.senderFrame.url).origin)
  } catch {
    return false
  }
}

/**
 * Tell the office a terminal's session is over (the hook's own SessionEnd
 * never fires when the terminal is closed or the app quits under it).
 * Authenticated with the office token, like the hook.
 */
function postSessionEnded(sessionId) {
  const token = readOfficeToken(TOKEN_FILE)
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

/** Put another Pokémon on a session: the server checks the rules; this carries the office token */
function swapPokemon(sessionId, uid) {
  const token = readOfficeToken(TOKEN_FILE)
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

/** POST to the office server with the office token; resolves to the JSON reply */
function serverPost(pathname, body = {}) {
  const token = readOfficeToken(TOKEN_FILE)
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
    const parent = win && !win.isDestroyed() ? win : undefined
    const r = await dialog.showOpenDialog(parent, { title: '포켓몬이 일할 폴더 선택', defaultPath: app.getPath('documents'), properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  }))
  ipcMain.handle('sessions:history', guard(() => {
    try { return listHistory({ limit: 40 }).map(h => (state.sessionTitles?.[h.id] ? { ...h, title: state.sessionTitles[h.id], named: true } : h)) } catch (err) { console.error('[main] history:', err.message); return [] }
  }))
  ipcMain.handle('terminals:buffer', guard((id) => terminals.buffer(String(id))))
  ipcMain.on('terminals:write', guard(({ id, data } = {}) => terminals.write(String(id), data)))
  // Only a window on screen sizes a session: the hidden office window keeps its own
  // terminal views, and their size must not win over the one the user is looking at
  ipcMain.on('terminals:resize', guard(({ id, cols, rows } = {}, event) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (!w || !w.isVisible() || w.isMinimized()) return
    terminals.resize(String(id), Number(cols), Number(rows))
  }))
  ipcMain.handle('terminals:send', guard(({ id, text } = {}) => terminals.sendInstruction(String(id), text)))
  ipcMain.handle('terminals:set-dex', guard(({ id, dex } = {}) => terminals.setDex(String(id), Number(dex))))
  ipcMain.handle('terminals:open-url', guard((url) => {
    try {
      const u = new URL(String(url))
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.toString())
    } catch {}
  }))
  ipcMain.handle('terminals:rename', guard(({ id, title } = {}) => terminals.rename(String(id), String(title ?? ''))))
  ipcMain.handle('terminals:close', guard((id) => terminals.close(String(id))))
  ipcMain.handle('widget:toggle', guard(() => toggleWidget()))
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
  ipcMain.handle('game:exchange', guard((o) => serverPost('/pokedex/exchange', { boxUid: String(o?.boxUid), partyUid: String(o?.partyUid) })))
  ipcMain.handle('game:release', guard((uid) => serverPost('/pokedex/release', { uid: String(uid) })))
  ipcMain.handle('game:swap', guard(({ sessionId, uid } = {}) => swapPokemon(String(sessionId), String(uid))))
  ipcMain.handle('update:get', guard(() => updater?.getState() ?? null))
  ipcMain.handle('update:check', guard(() => updater?.check() ?? null))
  ipcMain.handle('update:install', guard(() => updater?.install() ?? null))
  ipcMain.handle('update:restart', guard(() => updater?.restart() ?? false))
  ipcMain.handle('widget:minimize', guard(() => { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.minimize() }))
  ipcMain.handle('widget:get-mode', guard(() => state.widgetMode ?? (state.widgetExpanded ? 'window' : 'widget')))
  ipcMain.handle('widget:set-mode', guard((mode) => setWidgetMode(String(mode))))
  ipcMain.handle('widget:get-expanded', guard(() => state.widgetExpanded === true))
  ipcMain.handle('widget:set-expanded', guard((flag) => setWidgetMode(flag ? 'window' : 'widget') !== 'widget'))
  ipcMain.on('widget:resize', guard(({ width, height } = {}) => resizeWidget(Number(width), Number(height))))
  ipcMain.handle('widget:hide', guard(() => { if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.hide(); state.widgetHidden = true; saveState() } }))
  ipcMain.handle('widget:show-office', guard((terminalId) => {
    showWindow()
    if (terminalId && win && !win.isDestroyed()) win.webContents.send('terminals:focus', String(terminalId))
  }))
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTrayIcon() {
  // One icon, however many times a window is created
  if (tray) { tray.dispose(); tray = null }
  try {
    tray = createTray({
      serverUrl: SERVER_URL,
      getState: menuState,
      actions: {
        ...menuActions,
        onSummary(summary) {
          lastStatus = statusText(summary)
          const title = windowTitle(summary)
          if (win && !win.isDestroyed() && win.getTitle() !== title) win.setTitle(title)
        },
      },
    })
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
  const startOffice = singleFlight(createWindow)
  const openOffice = () => startOffice().catch((err) => console.error('[main] Could not open the office:', err))

  // Opened again (a Dock click, a second launch): wait for a startup in
  // progress, else show the window, else make one
  const reopen = () => {
    const action = reopenAction({
      quitting,
      starting: startOffice.pending(),
      hasWindow: !!win && !win.isDestroyed(),
      windowCount: BrowserWindow.getAllWindows().length,
    })
    if (action === 'show') { const w = createWidgetWindow(); if (w) { w.show(); w.focus() } }
    else if (action === 'create') openOffice()
  }

  app.on('second-instance', reopen)

  app.whenReady().then(() => {
    registerTerminalIpc()
    // Updates: a look at GitHub Releases shortly after start, then every 6 hours
    updater = createUpdater({ app, isPackaged: app.isPackaged, send: (channel, payload) => sendToWindows(channel, payload) })
    setTimeout(() => updater.check(), 15_000)
    setInterval(() => updater.check(), 6 * 60 * 60 * 1000).unref?.()
    // A local build folder (the developer's own PC) is looked at every minute
    setInterval(() => { if (updater.usesLocal()) updater.check() }, 60 * 1000).unref?.()
    return openOffice()
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
