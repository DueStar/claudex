'use strict'

const { app, BrowserWindow, Menu, Notification, clipboard, dialog, screen, shell, ipcMain, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
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
const { createTerminalManager, gitBranch } = require('./terminals.cjs')
const { listHistory } = require('./history.cjs')
const { checkPrereqs, LINKS: PREREQ_LINKS } = require('./prereqs.cjs')
const { mergeLoginEnv } = require('./shellEnv.cjs')
const { createStartGate } = require('./startGate.cjs')
const { createUpdater } = require('./updater.cjs')
const { isUpdatedRun, hasPendingUpdate, runPendingUpdate, cleanupStaleUpdates } = require('./updateRunner.cjs')
const { openStatusCard, cardLang } = require('./statusCard.cjs')
const { createStepTimer } = require('./updateTiming.cjs')
const { registerFeedbackIpc, createFeedbackSender } = require('./feedback.cjs')
const { startQuitWatchdog } = require('./quitWatchdog.cjs')
const { createSettingsStore, toastAllowed, claudeArgs } = require('./settings.cjs')
const { createLog, teeConsole } = require('./logs.cjs')
const { t, useLanguage } = require('./i18n.cjs')
const { menuTemplate } = require('./menu.cjs')
const { resolveRef, vscodeUrl } = require('./links.cjs')
const { envVar, adoptLegacyEnv, migrateRuntimeDir } = require('../server/runtime-dir.cjs')
const { migrateUserData } = require('./userDataMigration.cjs')
const { refreshShortcutIcons } = require('./shortcutIcon.cjs')
const { macWindowOptions, fillWorkArea, isFilled, restore: restoreFilled, applyMode: applyMacMode, noteMode, dockFor, quitCapMs, refillOnWorkAreaChange } = require('./macWindow.cjs')
// Settings made under the old name (CLAUDEX_PORT=…) keep working; the server and terminals inherit them
adoptLegacyEnv(process.env)
// A dev run (`electron .`) keeps its own window state, session names and page
// storage, so trying a change never touches the installed app's
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'spawn-dev'))
// The Mac CI's smoke launch (scripts/smoke-mac.mjs): --smoke-test on a Mac with SPAWN_SMOKE_DIR set
// gives the run its own userData and SPAWN_HOME and drives it from electron/smoke.cjs; anywhere
// else the flag is ignored (isSmokeRun)
const { isSmokeRun, prepare: prepareSmoke } = require('./smoke.cjs')
const smoke = isSmokeRun() ? prepareSmoke({ app, dialog }) : null
// The app was called Claudex until 1.3.35: its folder (%APPDATA%/Claudex, or Claudex-dev)
// is copied to the new name once, before anything reads it (userDataMigration.cjs)
const userDataCopy = migrateUserData({ from: path.join(app.getPath('appData'), app.isPackaged ? 'Claudex' : 'Claudex-dev'), to: app.getPath('userData') })
// An update staged by the last run goes in before anything else loads, behind the
// "updating" card; then the app starts again on the new code (updateRunner.cjs).
// Nothing else of the app runs in this process: the top-level return below.
if (app.isPackaged && hasPendingUpdate(app.getPath('userData'))) {
  const userData = app.getPath('userData')
  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(path.join(userData, file), 'utf8')) } catch { return null } }
  // The card closing must not end this run halfway through the copy
  app.on('window-all-closed', () => {})
  runPendingUpdate({
    app,
    isPackaged: true,
    resourcesPath: process.resourcesPath,
    userData,
    readNear: () => readJson('window-state.json')?.widgetBounds ?? null,
    // called once Electron is ready (app.getLocale() is empty before)
    getLang: () => cardLang(readJson('settings.json')?.app?.language, app.getLocale()),
    openCard: (opts) => openStatusCard({ BrowserWindow, screen, ...opts }),
  }).catch(() => {
    // Start again only if the marker is gone: with it still there, a start would come back here
    if (!hasPendingUpdate(userData)) app.relaunch()
    app.exit(0)
  })
  return
}

// userData/logs/spawn.log: the console of this process and of the server
const log = createLog(path.join(app.getPath('userData'), 'logs'))
teeConsole(log)
if (userDataCopy.status === 'copied' || userDataCopy.status === 'partial') {
  console.log(`[main] settings folder copied from the Claudex one: ${userDataCopy.status}, ${userDataCopy.copied.length} copied${userDataCopy.failed.length ? `, left for the next start: ${userDataCopy.failed.join('; ')}` : ''}`)
}
console.log(`[main] spawn ${app.getVersion()} starting (electron ${process.versions.electron}${app.isPackaged ? '' : ', dev'})`)
// How long the start takes, step by step: in spawn.log always, and in update.log
// with the restart's other steps when this run follows an update (updateTiming.cjs)
const startupT0 = Date.now()
const startupTimer = isUpdatedRun(process.argv) ? createStepTimer({ file: path.join(app.getPath('userData'), 'update.log'), label: 'p3' }) : null
function startupMark(step, extra = '') {
  startupTimer?.mark(step, extra)
  console.log(`[main] startup: ${step} +${Date.now() - startupT0}ms${extra ? ` ${extra}` : ''}`)
}
// How long Windows took to start this process before its code ran (the gap an update
// restart's previous step cannot see)
startupMark('start', `boot=${Math.max(0, Date.now() - Math.round(process.getCreationTime?.() ?? Date.now()))}ms`)
// ~/.agent-office (versions up to 1.3.7) -> ~/.spawn, once, before anything
// reads the token or starts the server (server/runtime-dir.cjs)
migrateRuntimeDir()
process.on('uncaughtException', (err) => { console.error('[main] uncaught:', err?.stack || err) })
process.on('unhandledRejection', (err) => { console.error('[main] unhandled rejection:', err?.stack || err) })
let updater = null

const PRELOAD = path.join(__dirname, 'preload.cjs')
// Windows gets the .ico (16–256 px, each size drawn separately), so the taskbar and the
// tray pick a sharp size for the display's scale instead of shrinking or blowing up one
const APP_ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
const REPO_ROOT = path.join(__dirname, '..')

// The server's port: SPAWN_PORT, default 3334 (helpers.cjs mirrors
// server/config.js). The same number goes to the server child's environment,
// the window's load URL, the navigation allowlist and the tray's poller, so
// `SPAWN_PORT=4000 electron .` — or the variable in the environment a
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
// The 설정 screen's values (electron/settings.cjs), read on first use
let settingsStore = null
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const appSettings = () => (settingsStore ??= createSettingsStore(settingsFile())).get()
useLanguage(() => appSettings().app.language, () => app.getLocale()) // 설정 › 앱 › 언어
// 업무 모드 for a page's preload, synchronously, so the page's first paint already hides the
// Pokémon (src/workMode.ts). Registered here, before any window exists, and always answered:
// an unanswered sendSync would hang the page. Only a yes/no, so no window check is needed.
ipcMain.on('settings:work-mode', (event) => {
  try { event.returnValue = appSettings().app.workMode === true } catch { event.returnValue = false }
})
let toastWin = null  // catch notifications (?toast)
// The toast page says when it listens (toast:ready); events before that wait here.
// Sent at did-finish-load they were lost (the page loads its code after that), and
// the window showed with nothing drawn: a black box on Windows.
let toastReady = false
let toastPending = []
let qaWin = null     // the design QA page (?qa)
let terminals = null
let pageUrl = null // the page URL the windows load (with the token fragment)
let tray = null
// The server child this app spawned (helpers.cjs childSlot): the one stopServer stops
const server = childSlot()
let quitting = false
// macOS is shutting down or logging out (powerMonitor): the quit then has 2 s at most
let macSystemEnding = false

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
  // SPAWN_PORT falls back to 3334 on both sides alike.
  // The settings file: the server reads 설정 › 프롬프트 숨기기 from it before a cloud upload
  const env = { ...process.env, SPAWN_PORT: String(SERVER_PORT), SPAWN_SETTINGS_FILE: settingsFile() }
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
// Debug aid: SPAWN_SCREENSHOT=<file.png> captures the app a moment
// after its page has loaded (SPAWN_SCREENSHOT_DELAY_MS, default 3000),
// then quits; an open notification goes to <file>-toast.png.
// ---------------------------------------------------------------------------

function maybeCaptureScreenshot() {
  const file = envVar('SCREENSHOT')
  if (!file) return
  const delay = Number(envVar('SCREENSHOT_DELAY_MS')) || 3000
  // Debug: SPAWN_AUTOTEST="<cwd>|<instruction>" opens a terminal and sends the instruction as the widget would
  const auto = process.env.SPAWN_AUTOTEST
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
    // SPAWN_AUTOTEST_KEYS: raw keys typed 5 s in; the words DOWN and ENTER stand for those keys
    const keys = process.env.SPAWN_AUTOTEST_KEYS
    if (keys) setTimeout(() => terminals.write(t.id, keys.split('DOWN').join(String.fromCharCode(27) + '[B').split('ENTER').join(String.fromCharCode(13))), 5000)
  }
  // Debug: SPAWN_AUTOTEST_EXPAND=1|0 forces the widget's mode for the capture
  if (process.env.SPAWN_AUTOTEST_EXPAND) setTimeout(() => setWidgetExpanded(process.env.SPAWN_AUTOTEST_EXPAND === '1'), 1500)
  // Debug: SPAWN_AUTOTEST_WIDGET_JS runs in the app a second before the capture
  const wjs = process.env.SPAWN_AUTOTEST_WIDGET_JS
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
  const body = st.status === 'current' ? t('최신 버전이에요 ({version})', { version: st.current }) : `${t('업데이트를 확인하지 못했어요')}${st.error ? ` (${st.error})` : ''}`
  if (Notification.isSupported()) new Notification({ title: APP_NAME, body, silent: true }).show()
}

const openLogs = () => { shell.openPath(log.dir).catch(() => {}) }
// The design QA page is for development: a dev run, or SPAWN_QA=1 on a packaged one
const showQa = !app.isPackaged || envVar('QA') === '1'
/** 설정: the app window comes forward and opens its settings */
function openSettings() {
  const w = createWidgetWindow()
  if (!w) return
  if (!w.isVisible()) { state.widgetHidden = false; saveState() }
  w.show()
  w.focus()
  w.webContents.send('settings:open')
}

/** A settings change: save it, apply what the main process owns, tell every window */
function changeSettings(patch) {
  const before = appSettings()
  const next = settingsStore.set(patch)
  if (next.app.openAtLogin !== before.app.openAtLogin && app.isPackaged) {
    try { app.setLoginItemSettings({ openAtLogin: next.app.openAtLogin }) } catch (err) { console.error('[main] login item:', err.message) }
  }
  if (next.app.widgetOnTop !== before.app.widgetOnTop && widgetWin && !widgetWin.isDestroyed() && widgetWin.spawnKind === 'widget') {
    widgetWin.setAlwaysOnTop(next.app.widgetOnTop, 'floating')
  }
  if (next.app.language !== before.app.language) refreshMenus()
  // 업무 모드 on: a catch card on screen, and those waiting for the card page, go now (never replayed)
  if (next.app.workMode && !before.app.workMode) { toastPending = []; hideToast() }
  for (const w of [widgetWin, toastWin]) if (w && !w.isDestroyed()) w.webContents.send('settings:changed', next)
  return next
}

/** 설정 › 데이터: a copy of the game file where the user picks */
async function exportBackup() {
  const src = path.join(runtimeDirFromEnv(process.env), 'pokedex.json')
  if (!fs.existsSync(src)) return { ok: false, reason: 'no-data' }
  const day = new Date().toISOString().slice(0, 10)
  const opts = { title: t('도감 백업 저장'), defaultPath: path.join(app.getPath('documents'), `spawn-backup-${day}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] }
  const r = widgetWin && !widgetWin.isDestroyed() ? await dialog.showSaveDialog(widgetWin, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return { ok: false, reason: 'canceled' }
  // Steps are saved in batches (up to 30 s): write them first, so the copy has them
  await serverPost('/flush', {}, 1500)
  try { fs.copyFileSync(src, r.filePath); return { ok: true, path: r.filePath } } catch (err) { return { ok: false, reason: err.message } }
}

const menuActions = { toggleWidget, openSettings, quit: quitApp, ...(showQa ? { openQa } : {}), checkUpdate: checkUpdateNow, openLogs }

function applicationMenuTemplate() {
  return menuTemplate({ appName: APP_NAME, t, toggleWidget })
}

function refreshMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()))
  if (tray) tray.refresh()
}

// ---------------------------------------------------------------------------
// Startup: the server, then the app window
// ---------------------------------------------------------------------------

async function startApp() {
  // The tray before the server (which can take seconds, ~9 s right after Windows
  // starts), so the launch shows at once in the tray
  state = readWindowState(stateFile())
  refreshMenus()
  createTrayIcon()
  const startHidden = appSettings().app.startHidden
  // Until 1.3.35 "open at login" was saved under the old name (Windows' Run entry
  // electron.app.Claudex): drop that one and keep the setting under the new name
  if (app.isPackaged && process.platform === 'win32') {
    try {
      app.setLoginItemSettings({ openAtLogin: false, name: 'electron.app.Claudex' })
      if (appSettings().app.openAtLogin) app.setLoginItemSettings({ openAtLogin: true })
    } catch (err) { console.error('[main] login item:', err.message) }
  }

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
    startupMark('server-spawned')
    const ready = await waitForServer()
    if (ready) {
      console.log(`[main] Server is ready on ${SERVER_URL}`)
      startupMark('server-ready')
    } else if (app.isPackaged) {
      // The packaged app has nothing to show without its server — say so
      // instead of opening a blank window.
      console.error('[main] Server did not become ready in time')
      dialog.showErrorBox(
        APP_NAME,
        `The ${APP_NAME} server did not start on port ${SERVER_PORT}.\n\n` +
        `If something else is using that port, stop it and open ${APP_NAME} again, ` +
        `or launch it with SPAWN_PORT set to a free port.`,
      )
      quitApp()
      return
    } else {
      console.error('[main] Server did not become ready in time — continuing anyway (start it with `npm run server`)')
    }
  }

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

  // 설정 › 앱: start in the tray (the tray's Poké Ball brings the window back)
  if (startHidden) { state.widgetHidden = true; saveState() }
  createWidgetWindow({ hidden: startHidden })
}

/** The first app page loaded: time it, then remove what past updates left in the temp folder. */
let firstWindowLoaded = false
function onAppWindowLoaded() {
  if (firstWindowLoaded) return
  firstWindowLoaded = true
  startupMark('window-loaded')
  // Only the installed app cleans: a development run shares %TEMP% and would take
  // away an update the installed app has downloaded or is unpacking
  if (app.isPackaged) setTimeout(() => {
    cleanupStaleUpdates({ tmpdir: os.tmpdir(), keep: updater?.workDir?.() ?? null })
      .then((n) => { if (n) console.log(`[main] removed ${n} old update folder(s)`) })
      .catch(() => {})
  }, 10_000).unref?.()
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

// Windows shutting down, restarting or logging off ends the sessions' processes before
// it kills the app, and the app's own quit never runs: keep the reopen list as it is now
// (macOS: its shutdown and logout, from powerMonitor, come here too)
const keepSessions = () => {
  try {
    terminals?.freeze?.()
    if (process.platform === 'darwin') console.log('[main] the system is ending the session: open sessions kept for the next start')
    else console.log('[main] Windows is ending the session: open sessions kept for the next start')
  } catch {}
}

/** Build the app's window for `mode`; it shows itself once painted unless `hidden`. */
function buildAppWindow(mode, { hidden = false, near = null } = {}) {
  // (a smoke run's page also offers its terminal and font readings: src/termMetrics.ts)
  const url = pageWith(`widget&mode=${mode}${smoke ? '&smoke' : ''}`)
  if (!url) return null
  const kind = kindOf(mode)
  const isWidget = kind === 'widget'
  const win = new BrowserWindow({
    ...boundsFor(kind, near),
    minWidth: (isWidget ? WIDGET_MIN : WINDOW_MIN).width,
    minHeight: (isWidget ? WIDGET_MIN : WINDOW_MIN).height,
    title: 'spawn',
    // The window's own icon (the Poké Ball), so the taskbar shows it whatever exe runs the app
    icon: APP_ICON,
    // macOS: the window gets the traffic lights, the widget none (macWindow.cjs)
    ...(process.platform === 'darwin' ? macWindowOptions(mode) : { frame: false }),
    transparent: isWidget,
    hasShadow: !isWidget,
    resizable: true,
    maximizable: !isWidget,
    alwaysOnTop: isWidget && appSettings().app.widgetOnTop,
    skipTaskbar: isWidget,
    backgroundColor: isWidget ? '#00000000' : WINDOW_BACKGROUND,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: PRELOAD },
  })
  win.spawnKind = kind
  // A window pinned to the taskbar keeps this icon and reopens the app, not the exe's icon
  if (process.platform === 'win32' && app.isPackaged) {
    try { win.setAppDetails({ appIconPath: APP_ICON, appIconIndex: 0, relaunchCommand: `"${process.execPath}"`, relaunchDisplayName: 'spawn' }) } catch {}
  }
  if (isWidget && appSettings().app.widgetOnTop) win.setAlwaysOnTop(true, 'floating')
  // macOS: the widget stays in view on every Space (the Dock icon is left to dockFor)
  if (process.platform === 'darwin' && isWidget) win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })
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
    onAppWindowLoaded()
    maybeCaptureScreenshot()
  })
  win.on('show', refreshMenus)
  win.on('query-session-end', keepSessions)
  win.on('session-end', keepSessions)
  win.on('hide', refreshMenus)
  const remember = () => {
    // macOS: a window filling the work area (fullscreen) keeps the place it had before
    if (process.platform === 'darwin' && isFilled(win)) return
    if (win.isDestroyed() || win !== widgetWin || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return
    const b = win.getBounds()
    if (win.spawnKind === 'window') {
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
  if (process.platform === 'darwin' && !isWidget) {
    // The green traffic light's own full screen is the fullscreen mode too; leaving it is
    // the window mode (a window that filled the work area before goes back to its place)
    win.on('enter-full-screen', () => { if (win === widgetWin) setModeQuietly('fullscreen') })
    win.on('leave-full-screen', () => {
      if (win !== widgetWin) return
      if (isFilled(win)) restoreFilled(win)
      setModeQuietly('window')
    })
  }
  win.on('close', (event) => {
    if (quitting || win !== widgetWin) return
    event.preventDefault()
    win.hide()
    state.widgetHidden = true
    saveState()
  })
  win.on('closed', () => { if (widgetWin === win) widgetWin = null })
  win.once('ready-to-show', () => { win.spawnPainted = true; win.emit('spawn-painted') })
  if (!hidden) {
    win.once('ready-to-show', () => {
      if (win.isDestroyed() || win !== widgetWin) return
      if (mode === 'fullscreen') {
        if (process.platform === 'darwin') fillWorkArea(win, screen)
        else win.maximize()
      }
      win.show()
    })
  }
  win.loadURL(url)
  return win
}

function createWidgetWindow({ hidden = false } = {}) {
  // Quitting: the windows went at the start of the quit; one shown (or built) now could be
  // closed halfway through it (tray, toast and update clicks all come through here)
  if (quitting) return null
  if (widgetWin && !widgetWin.isDestroyed()) return widgetWin
  widgetWin = buildAppWindow(modeNow(), { hidden })
  // macOS: no Dock icon while the app is the widget
  if (process.platform === 'darwin' && widgetWin) dockFor(modeNow(), app.dock)
  return widgetWin
}

/** The page shows `mode`; the window is already right (moved by hand, maximized). */
function setModeQuietly(mode) {
  // macOS: the window mode reached without restore (a zoom toggled off) ends a fill
  if (process.platform === 'darwin' && widgetWin && !widgetWin.isDestroyed()) noteMode(widgetWin, mode)
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
    if (win.spawnPainted) return resolve()
    const done = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(done, ms)
    win.once('spawn-painted', done)
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
    if (quitting) return // queued before the quit: no new window now
    const old = widgetWin && !widgetWin.isDestroyed() ? widgetWin : null
    if (old && old.spawnKind === kindOf(mode)) { setWidgetMode(mode); return }
    const wasVisible = !old || old.isVisible()
    state.widgetMode = mode
    state.widgetExpanded = mode !== 'widget'
    saveState()
    const next = buildAppWindow(mode, { hidden: true, near: old ? old.getBounds() : null })
    if (!next) return
    widgetWin = next
    // macOS: the Dock icon goes with the widget and comes back with the window, before
    // the new one is shown and focused
    if (process.platform === 'darwin') dockFor(mode, app.dock)
    await painted(next)
    // A moment for the terminals' scrollback to land in the new page
    await new Promise((r) => setTimeout(r, 120))
    if (next.isDestroyed()) return
    if (!wasVisible) { if (old && !old.isDestroyed()) old.destroy(); return }
    next.setOpacity(0)
    if (mode === 'fullscreen') {
      if (process.platform === 'darwin') fillWorkArea(next, screen)
      else next.maximize()
    }
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
  if (!WIDGET_MODES.has(mode) || quitting) return modeNow()
  const w = widgetWin && !widgetWin.isDestroyed() ? widgetWin : null
  if (!w || w.spawnKind !== kindOf(mode)) {
    swapAppWindow(mode)
    return mode
  }
  // The same window: maximize or restore it (its events tell the page too)
  state.widgetMode = mode
  state.widgetExpanded = mode !== 'widget'
  if (process.platform === 'darwin') {
    // macOS: fill the work area or go back (macWindow.cjs); macOS's own maximize is a zoom
    applyMacMode(w, mode, screen)
  } else {
    if (mode === 'fullscreen' && !w.isMaximized()) w.maximize()
    if (mode === 'window' && w.isMaximized()) w.unmaximize()
  }
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
  if (!widgetWin || widgetWin.isDestroyed() || widgetWin.spawnKind !== 'widget') return
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

const TOAST_SIZE = Object.freeze({ width: 400, height: 172 })

function toastBounds() {
  const { workArea } = screen.getPrimaryDisplay()
  return { x: workArea.x + workArea.width - TOAST_SIZE.width - 12, y: workArea.y + workArea.height - TOAST_SIZE.height - 12, ...TOAST_SIZE }
}

function ensureToastWindow() {
  if (toastWin && !toastWin.isDestroyed()) return Promise.resolve(toastWin)
  if (quitting) return Promise.resolve(null)
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
    // A card plays its short sound as it appears, with no click first (src/sounds.ts)
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: PRELOAD, autoplayPolicy: 'no-user-gesture-required' },
  })
  toastWin.setAlwaysOnTop(true, 'screen-saver')
  // macOS: on every Space, over full-screen apps too, without touching the Dock icon
  if (process.platform === 'darwin') toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  else toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  toastWin.webContents.on('will-navigate', (event) => event.preventDefault())
  toastWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  toastWin.on('closed', () => { toastWin = null; toastReady = false })
  toastWin.webContents.on('did-start-loading', () => { toastReady = false })
  toastReady = false
  toastWin.loadURL(url)
  return Promise.resolve(toastWin)
}

function revealToast(w) {
  if (quitting) return
  w.setBounds(toastBounds())
  if (!w.isVisible()) w.showInactive()
  w.setAlwaysOnTop(true, 'screen-saver')
}

/** The toast page listens now: hand it what waited, then show it */
function toastPageReady() {
  const w = toastWin
  if (!w || w.isDestroyed()) return
  toastReady = true
  const waiting = toastPending
  toastPending = []
  for (const event of waiting) w.webContents.send('toast:event', event)
  if (waiting.length) revealToast(w)
}

/** Hand an event to the notification window and show it without stealing the focus */
async function showToast(event) {
  const w = await ensureToastWindow()
  if (!w || w.isDestroyed()) return
  if (!toastAllowed(event, appSettings())) return // 설정 › 알림
  if (!toastReady) { toastPending = [...toastPending, event].slice(-20); return }
  w.webContents.send('toast:event', event)
  revealToast(w)
}

// The design QA page (?qa): every moment-only design at once, from the tray menu
function openQa() {
  if (qaWin && !qaWin.isDestroyed()) { qaWin.show(); qaWin.focus(); return }
  const url = pageWith('qa')
  if (!url) return
  qaWin = new BrowserWindow({
    width: 1100, height: 860, icon: APP_ICON, title: t('spawn 디자인 QA'), backgroundColor: '#0b0c10', autoHideMenuBar: true,
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
  if (quitting) return // the windows went at the start of the quit; showing one now could close it halfway
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
  if (!token) return Promise.resolve()
  return new Promise((resolve) => {
    const body = JSON.stringify({ type: 'session_ended', sessionId, reason: 'terminal closed' })
    const req = http.request(`${SERVER_URL}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${token}` },
      timeout: 1500,
    }, (res) => { res.resume(); res.on('end', resolve); res.on('error', resolve) })
    req.on('error', resolve)
    req.on('timeout', () => { req.destroy(); resolve() })
    req.end(body)
  })
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
function serverPost(pathname, body = {}, timeoutMs = 15000) {
  const token = readServerToken(TOKEN_FILE)
  if (!token) return Promise.resolve({ ok: false, reason: 'no-token' })
  const data = JSON.stringify(body)
  return new Promise((resolve) => {
    const req = http.request(`${SERVER_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: `Bearer ${token}` },
      timeout: timeoutMs,
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
  terminals = createTerminalManager({
    repoRoot: REPO_ROOT, userDataDir: app.getPath('userData'), send: sendToWindows, onExit: postSessionEnded, titles,
    // 설정 › 세션: the folder a session opens in when none is picked, and claude's model / permission mode
    defaultCwd: () => appSettings().session.defaultCwd || app.getPath('documents'),
    extraArgs: () => claudeArgs(appSettings().session),
    // 설정 › 세션 › AI 도구: the other tools, whose sessions report through their terminal's output
    tools: () => appSettings().session.tools,
    emit: (event) => { void serverPost('/event', event) },
    // A Codex tab's context and usage limits (from its session log), as a status line would
    postStatus: (body) => { void serverPost('/status', body) },
  })
  const guard = (fn) => (event, arg) => (fromOurWindow(event) ? fn(arg, event) : undefined)
  ipcMain.handle('settings:get', guard(() => appSettings()))
  ipcMain.handle('settings:set', guard((patch) => (patch && typeof patch === 'object' ? changeSettings(patch) : appSettings())))
  ipcMain.handle('data:export', guard(() => exportBackup()))
  ipcMain.handle('data:open-folder', guard(() => shell.openPath(runtimeDirFromEnv(process.env)).then(() => true).catch(() => false)))
  // Feedback (a pin on the screen if wanted): one row in our Supabase feedback table, which anyone
  // may add to and nobody can read through the API; the spot's picture in a private bucket
  let cloudConfig = null
  try { cloudConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'server', 'cloud-config.json'), 'utf8')) } catch {}
  registerFeedbackIpc({
    ipcMain, guard, clipboard,
    send: createFeedbackSender({ config: cloudConfig }),
    appInfo: () => ({ version: app.getVersion(), os: `${{ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] ?? process.platform} ${os.release()}` }),
  })
  ipcMain.handle('terminals:list', guard(() => terminals.list()))
  // The git branch of each session's folder (files read only; at most 24 folders a call)
  ipcMain.handle('terminals:branches', guard((dirs) => Object.fromEntries((Array.isArray(dirs) ? dirs : []).filter(d => typeof d === 'string' && d).slice(0, 24).map(d => [d, gitBranch(d)]))))
  // Taken either way, so turning the setting on later does not reopen an old list
  ipcMain.handle('terminals:restorable', guard(() => { const open = terminals.takeRestorable(); return appSettings().session.restoreOnStart ? open : [] }))
  ipcMain.handle('terminals:create', guard((opts) => {
    try {
      return terminals.create({ cwd: typeof opts?.cwd === 'string' ? opts.cwd : undefined, resume: typeof opts?.resume === 'string' ? opts.resume : undefined, sessionId: typeof opts?.sessionId === 'string' ? opts.sessionId : undefined, tool: typeof opts?.tool === 'string' ? opts.tool : undefined })
    } catch (err) {
      console.error('[main] Could not start a terminal:', err.message)
      return { error: err.message }
    }
  }))
  ipcMain.handle('terminals:pick-folder', guard(async () => {
    const parent = widgetWin && !widgetWin.isDestroyed() ? widgetWin : undefined
    const title = appSettings().app.workMode ? t('세션 폴더 선택') : t('포켓몬이 일할 폴더 선택') // 업무 모드: no Pokémon words
    const r = await dialog.showOpenDialog(parent, { title, defaultPath: app.getPath('documents'), properties: ['openDirectory'] })
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
  // A file named in a session's output (Ctrl+click): resolved against that session's folder (on
  // macOS ~/ is the home folder: electron/links.cjs), and
  // only a file that exists. It opens at its line in VS Code or Cursor through their own
  // vscode:// / cursor:// links (no command line, so nothing in the path is ever run), else
  // with the file's default app. A page, PDF or picture named without a line goes to its
  // default app (the browser, the image viewer): that is what Ctrl+click on one means.
  const VIEW_IN_DEFAULT_APP = new Set(['.html', '.htm', '.xhtml', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])
  ipcMain.handle('terminals:open-path', guard(async ({ id, file, line, col } = {}) => {
    const term = terminals.list().find(t => t.id === String(id))
    if (!term || typeof file !== 'string' || file.length > 1024) return false
    const abs = resolveRef(term.cwd, file)
    try { if (!fs.statSync(abs).isFile()) return false } catch { return false }
    if (!(Number(line) > 0) && VIEW_IN_DEFAULT_APP.has(path.extname(abs).toLowerCase())) {
      return (await shell.openPath(abs)) === ''
    }
    const at = `${Number(line) > 0 ? `:${Math.floor(Number(line))}` : ''}${Number(line) > 0 && Number(col) > 0 ? `:${Math.floor(Number(col))}` : ''}`
    for (const scheme of ['vscode', 'cursor']) {
      if (app.getApplicationNameForProtocol(`${scheme}://`)) {
        await shell.openExternal(`${vscodeUrl(abs, { scheme })}${at}`)
        return true
      }
    }
    return (await shell.openPath(abs)) === ''
  }))
  ipcMain.handle('terminals:rename', guard(({ id, title } = {}) => terminals.rename(String(id), String(title ?? ''))))
  ipcMain.handle('terminals:move', guard(({ id, index } = {}) => terminals.move(String(id), Number(index))))
  ipcMain.handle('terminals:close', guard((id) => terminals.close(String(id))))
  // What a session needs on this PC (Claude Code, Git, Python), and their install pages
  ipcMain.handle('env:check', guard(() => checkPrereqs()))
  ipcMain.handle('env:open-link', guard((key) => {
    const url = key === 'release' ? 'https://github.com/DueStar/spawn/releases/latest' : PREREQ_LINKS[key]
    if (url) shell.openExternal(url) // only the known install pages, never a page-supplied URL
  }))
  ipcMain.handle('cloud:signin', guard(() => cloudSignIn()))
  ipcMain.handle('cloud:signout', guard(() => serverPost('/auth/signout')))
  ipcMain.handle('cloud:sync', guard(() => serverPost('/auth/sync')))
  ipcMain.handle('board:get', guard((board) => serverPost('/leaderboard', { board: String(board) })))
  ipcMain.handle('board:profile', guard(() => serverPost('/leaderboard/profile')))
  ipcMain.handle('board:set-profile', guard((p) => serverPost('/leaderboard/profile/set', { nickname: String(p?.nickname ?? ''), isPublic: p?.isPublic === true, partner: Number.isInteger(p?.partner) ? p.partner : null })))
  ipcMain.handle('game:throw', guard(({ sessionId, uid } = {}) => serverPost('/pokedex/throw', { sessionId: String(sessionId), uid: String(uid) })))
  ipcMain.on('toast:show', guard((event) => { if (event && typeof event === 'object') showToast(event) }))
  ipcMain.on('toast:done', guard(() => hideToast()))
  ipcMain.on('toast:ready', guard((_arg, event) => { if (toastWin && event.sender === toastWin.webContents) toastPageReady() }))
  ipcMain.on('toast:open', guard((id) => openDexAt(Number(id))))
  ipcMain.handle('game:exchange', guard((o) => serverPost('/pokedex/exchange', { boxUid: String(o?.boxUid), partyUid: String(o?.partyUid) })))
  ipcMain.handle('game:arrange', guard((order) => serverPost('/pokedex/arrange', { order: Array.isArray(order) ? order.slice(0, 5000).map(String) : [] })))
  ipcMain.handle('game:release', guard((uid) => serverPost('/pokedex/release', { uid: String(uid) })))
  ipcMain.handle('game:swap', guard(({ sessionId, uid } = {}) => swapPokemon(String(sessionId), String(uid))))
  ipcMain.handle('update:get', guard(() => updater?.getState() ?? null))
  ipcMain.handle('update:install', guard(() => updater?.install() ?? null))
  ipcMain.handle('update:restart', guard(() => updater?.restart() ?? false))
  // A session finished or needs the trainer while the app is not in front: a Windows
  // notification (clicking it brings the app up) and the taskbar button flashes until it is
  ipcMain.on('widget:alert', guard(({ title, body } = {}) => {
    const win = widgetWin && !widgetWin.isDestroyed() ? widgetWin : null
    if (!win || (win.isVisible() && win.isFocused())) return
    if (Notification.isSupported()) {
      const n = new Notification({ title: String(title ?? APP_NAME).slice(0, 80), body: String(body ?? '').slice(0, 200), silent: true })
      n.on('click', () => { if (!quitting && !win.isDestroyed()) { win.show(); win.focus() } })
      n.show()
    }
    if (win.isVisible()) {
      win.flashFrame(true)
      win.once('focus', () => { if (!win.isDestroyed()) win.flashFrame(false) })
    }
  }))
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
    if (app.requestSingleInstanceLock()) return i // how many 250 ms waits it took
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  }
  return -1
}

// (a smoke run has its own userData, so the installed app's lock is not its to wait for)
const lockWaits = app.isPackaged && !smoke ? takeInstanceLock() : 0
if (lockWaits < 0) {
  app.quit()
} else {
  startupMark('lock', `waits=${lockWaits}`)
  // Startup (probe the port, start the server, wait for it, open the window)
  // takes seconds; one run at a time, so a Dock click or a second launch in
  // the meantime cannot spawn a second server and open a second window
  const startOnce = singleFlight(startApp)
  // macOS: nothing opens before the login shell's PATH and LANG are in (a Dock click or a second
  // launch during that read waits for it too); Windows: the start runs at once, as before
  const envGate = createStartGate()
  const open = () => envGate.run(() => startOnce()).catch((err) => console.error('[main] Could not start the app:', err))

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

  app.whenReady().then(async () => {
    // Started from Finder the app has launchd's bare PATH: take the login shell's PATH and
    // LANG once, before the server and the terminals are started (both read process.env)
    if (process.platform === 'darwin') {
      // A shutdown, restart or logout ends the sessions as Windows' does: keep the reopen list
      // (required here: powerMonitor is usable only once the app is ready)
      require('electron').powerMonitor.on('shutdown', () => { macSystemEnding = true; console.log('[main] macOS is shutting down or logging out'); keepSessions() })
      // Full screen is the work area filled: when the work area changes (the Dock shown again on
      // leaving the widget, moved, resized), the filled window follows it (macWindow.cjs)
      screen.on('display-metrics-changed', (_event, _display, changed) => { refillOnWorkAreaChange(widgetWin, changed, screen) })
      try {
        const merged = await mergeLoginEnv({ env: process.env })
        process.env.PATH = merged.PATH
        if (merged.LANG) process.env.LANG = merged.LANG
        for (const k of ['LC_ALL', 'LC_CTYPE']) if (merged[k]) process.env[k] = merged[k]
      } finally {
        envGate.open()
      }
    }
    registerTerminalIpc()
    // Updates: a look at GitHub Releases shortly after start, then every 30 minutes
    // (a small file: latest.json is a plain download, no API rate limit). The app
    // stays open for days, so 6 hours meant a release went unseen until the next morning.
    updater = createUpdater({ app, isPackaged: app.isPackaged, send: (channel, payload) => sendToWindows(channel, payload) })
    // (a smoke run never looks for an update)
    if (!smoke) {
      setTimeout(() => updater.check(), 15_000)
      setInterval(() => updater.check(), 30 * 60 * 1000).unref?.()
      // A local build folder (the developer's own PC) is looked at every minute
      setInterval(() => { if (updater.usesLocal()) updater.check() }, 60 * 1000).unref?.()
    }
    // The Desktop / Start menu shortcuts show the icon that comes with updates (spawn.exe's
    // own icon never changes after the first install); a moment after start, off the start path
    setTimeout(() => { try { refreshShortcutIcons({ app, shell }) } catch (err) { console.error('[main] Shortcut icon:', err.message) } }, 5000).unref?.()
    // A smoke run: its steps wait for the window open() makes (electron/smoke.cjs)
    smoke?.run({
      getWindow: () => widgetWin,
      mode: modeNow,
      setMode: (mode) => { setWidgetMode(mode); return swapping },
      terminals: () => terminals,
      workArea: (win) => screen.getDisplayMatching(win.getBounds()).workArea,
      isFilled: (win) => isFilled(win),
      quit: quitApp,
    })
    return open()
  })

  app.on('window-all-closed', () => {
    // Quitting: the quit sequence stops the server itself, after telling it the
    // sessions ended (the card closing at the start of a quit lands here)
    if (quitting) return
    stopServer()
    app.quit()
  })

  // Quitting (and an update restart, which quits too) runs one sequence before the app
  // goes. Two things at once: the server hears the open sessions are over (posted and
  // stopped at once, it was gone before they arrived and kept them working) and saves
  // what it holds; the sessions' processes are ended and node-pty is let go of
  // (terminals.shutdown). Then the server stops. Quitting while node-pty was still busy
  // once left the main process hung in its native teardown, so a watchdog process ends
  // the main if the quit has not finished 10 s on. The windows go at once, so nothing
  // can be closed (and the server stopped by window-all-closed) halfway through.
  let quitSequence = null
  app.on('before-quit', (e) => {
    quitting = true
    if (quitSequence === 'done') return
    e.preventDefault()
    if (quitSequence) return
    // An update restart (the updater left its marker): the "updating" card stands
    // where the app window was while this quits, and each step is timed
    const updating = app.isPackaged && hasPendingUpdate(app.getPath('userData'))
    if (app.isPackaged) { try { startQuitWatchdog(process.pid, 10_000, process.execPath, updating ? path.join(app.getPath('userData'), 'update.log') : null) } catch {} }
    const timer = updating ? createStepTimer({ file: path.join(app.getPath('userData'), 'update.log'), label: 'p1' }) : { mark() {} }
    timer.mark('quit-start')
    const near = widgetWin && !widgetWin.isDestroyed() ? widgetWin.getBounds() : (state.widgetBounds ?? null)
    for (const w of BrowserWindow.getAllWindows()) { try { w.hide() } catch {} }
    if (updating) {
      const lang = cardLang(appSettings().app.language, app.getLocale())
      try { openStatusCard({ BrowserWindow, screen, near, step: 'updating', lang }) } catch {}
      // The copy run after this shows its card in the same place and language
      try {
        const marker = path.join(app.getPath('userData'), 'pending-update.json')
        const pending = JSON.parse(fs.readFileSync(marker, 'utf8'))
        fs.writeFileSync(marker, JSON.stringify({ ...pending, card: { near, lang } }))
      } catch {}
    }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    const running = terminals ? terminals.list().filter(t => t.status === 'running') : []
    const tellServer = (async () => {
      if (running.length) await Promise.race([Promise.all(running.map(t => postSessionEnded(t.sessionId))), sleep(2000)])
      timer.mark('sessions-posted', `n=${running.length}`)
      // The server is ended right after this, so a flush that timed out (a busy server)
      // gets one longer try: what it holds is up to 30 s of steps and the sessions' list
      let flushed = await serverPost('/flush', {}, 1500)
      if (!flushed?.ok && flushed?.reason !== 'no-token') flushed = await serverPost('/flush', {}, 3000)
      timer.mark('flushed', flushed?.ok ? '' : `failed=${flushed?.reason ?? 'unknown'}`)
      if (!flushed?.ok) console.warn('[main] quit: the server did not flush', flushed?.reason)
    })()
    const endSessions = (async () => {
      if (!terminals) return
      const { stuck } = await terminals.shutdown(3000)
      timer.mark('sessions-ended', `stuck=${stuck ?? 0}`)
      if (stuck) console.warn(`[main] quit: ${stuck} session(s) did not exit`)
    })()
    const ending = Promise.all([tellServer, endSessions])
    // macOS shutting down or logging out gives up on an app whose quit takes long (the
    // logout is cancelled): 2 s at most then, and the server is stopped anyway. Any other
    // quit, on a Mac too, waits for the whole sequence (quitCapMs)
    const cap = quitCapMs({ platform: process.platform, systemShutdown: macSystemEnding })
    quitSequence = (cap ? Promise.race([ending, sleep(cap)]) : ending)
      .catch((err) => console.error('[main] quit sequence:', err?.message ?? err))
      .finally(() => {
        try { if (tray) { tray.dispose(); tray = null } } catch {}
        try { stopServer() } catch {}
        timer.mark('server-stopped')
        quitSequence = 'done'
        // An update restart: everything worth keeping is saved by now (the server flushed
        // and stopped, the sessions' list frozen), so this process ends here. Left to
        // app.quit(), Electron's own teardown took 0.8–17 s before the next step could
        // start (it waits for this process to be gone). A normal quit is left as it was.
        if (updating) {
          try { saveState() } catch {}
          try { session.defaultSession.flushStorageData() } catch {}
          timer.mark('exit')
          app.exit(0)
          return
        }
        app.quit()
      })
  })

  app.on('activate', reopen)
}
