'use strict'

/**
 * electron/smoke.cjs — the smoke launch the Mac CI runs on the built app
 * (scripts/smoke-mac.mjs starts it with --smoke-test). main.cjs loads this
 * file only when that flag is given: without it nothing here runs.
 *
 * A smoke run keeps to its own folders (SPAWN_SMOKE_USERDATA for userData,
 * SPAWN_HOME for the game data, SPAWN_SMOKE_DIR for what it leaves behind)
 * and needs no Claude login. Its steps, each logged as a "[smoke] …" line on
 * stdout so the CI log shows where it stopped:
 *
 *   start               the app is ready
 *   window              the app window has loaded and shows
 *   shell-open          a shell tab, opened as the page's >_ button opens one
 *                       (window.spawn.terminals.create over IPC), in SPAWN_HOME
 *   shell-echo          `echo spawn-$((40+2))` typed in; spawn-42 must come
 *                       back in the pty's output (the shell worked it out)
 *   shell-env           the PATH and LANG the shell sees (optional: a
 *                       readout that fails does not fail the run)
 *   capture-window      a PNG of each mode (webContents.capturePage)
 *   capture-widget
 *   capture-fullscreen
 *   quit                the app's own quit sequence, to the end
 *
 * smoke.json in SPAWN_SMOKE_DIR is written after every step, so a run killed
 * from outside still says how far it got. Any failure, a dialog (it would wait
 * for a click nobody gives) or the overall timeout (60 s) ends the run with
 * the reason in smoke.json and on stderr, and the app exits 1; a run that
 * passed every step exits 0.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const SMOKE_FLAG = '--smoke-test'
const STEPS = Object.freeze(['start', 'window', 'shell-open', 'shell-echo', 'shell-env', 'capture-window', 'capture-widget', 'capture-fullscreen', 'quit'])
const OPTIONAL = new Set(['shell-env'])
/** [step, mode, picture] */
const CAPTURES = Object.freeze([['capture-window', 'window', 'window.png'], ['capture-widget', 'widget', 'widget.png'], ['capture-fullscreen', 'fullscreen', 'fullscreen.png']])
// The typed line never holds what the output is checked for: the shell has to work it out
const ECHO = 'echo spawn-$((40+2))\n'
const ECHO_SEEN = 'spawn-42'
const ENV_ECHO = 'echo "spawn-path-$((1+1))=$PATH"; echo "spawn-lang-$((1+1))=$LANG"\n'
const DEFAULT_TIMEOUT_MS = 60_000

function isSmokeRun(argv = process.argv) {
  return Array.isArray(argv) && argv.includes(SMOKE_FLAG)
}

/** Where the run writes: the environment's folders, else ones under the temp dir */
function smokeDirs(env = process.env, tmp = os.tmpdir()) {
  const base = path.join(tmp, `spawn-smoke-${process.pid}`)
  return {
    out: env.SPAWN_SMOKE_DIR || path.join(base, 'out'),
    userData: env.SPAWN_SMOKE_USERDATA || path.join(base, 'userData'),
    home: env.SPAWN_HOME || path.join(base, 'home'),
  }
}

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g
const plain = (s) => String(s ?? '').replace(ANSI, '')

/** The echo came back worked out */
function sawEcho(output) {
  return plain(output).includes(ECHO_SEEN)
}

/** { PATH, LANG } as the shell printed them for ENV_ECHO, or null before both lines are there */
function shellEnvFrom(output) {
  const text = plain(output)
  const p = /spawn-path-2=([^\r\n]*)/.exec(text)
  const l = /spawn-lang-2=([^\r\n]*)/.exec(text)
  return p && l ? { PATH: p[1], LANG: l[1] } : null
}

function newResult({ platform = process.platform, arch = process.arch, electron = process.versions.electron ?? null, version = null, now = Date.now() } = {}) {
  return {
    ok: false, done: false, platform, arch, electron, version,
    startedAt: new Date(now).toISOString(), totalMs: 0,
    steps: [], passed: [], failure: null, env: null, screenshots: {},
  }
}

function recordStep(result, name, ok, { ms = 0, detail = null } = {}) {
  result.steps.push({ name, ok: !!ok, ms, ...(detail != null ? { detail } : {}) })
  result.passed = result.steps.filter(s => s.ok).map(s => s.name)
  return result
}

/** Passed: every step but the optional ones, and nothing failed on the way */
function verdict(result) {
  if (result.failure) return { ok: false, reason: result.failure }
  const missing = STEPS.filter(s => !OPTIONAL.has(s) && !result.passed.includes(s))
  if (missing.length) return { ok: false, reason: `not passed: ${missing.join(', ')}` }
  return { ok: true, reason: null }
}

/** The window when it has loaded and shows, else null */
function readyWindow(w) {
  return w && !w.isDestroyed() && w.isVisible() && !w.webContents.isLoading() ? w : null
}

/**
 * Called by main.cjs at the top, before anything reads userData or SPAWN_HOME:
 * moves both to the smoke run's folders, turns a dialog into a failure and
 * starts the overall timeout. Returns { dirs, result, run(hooks), stop() }.
 *
 * hooks (from main.cjs, once the app is ready): getWindow(), mode(),
 * setMode(mode) → a promise settled when the window for it is in place,
 * terminals() (the terminal manager), workArea(win), quit() (the app's own).
 */
function prepare({ app, dialog, env = process.env, tmp = os.tmpdir(), log = console, now = Date.now, timeoutMs = Number(env.SPAWN_SMOKE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, quitTimeoutMs = 20_000, settleMs = 1500, typeDelayMs = 300 }) {
  const dirs = smokeDirs(env, tmp)
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
  // The server, the terminals and the hooks all take the game folder from SPAWN_HOME
  env.SPAWN_HOME = dirs.home
  app.setPath('userData', dirs.userData)

  const t0 = now()
  const result = newResult({ version: typeof app.getVersion === 'function' ? app.getVersion() : null, now: t0 })
  let hooks = null
  let current = 'start'
  let ended = false // failed or finished: the steps still waiting give up
  let quitT0 = null
  let quitTimer = null
  let overall = null

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  function save() {
    result.totalMs = now() - t0
    try { fs.writeFileSync(path.join(dirs.out, 'smoke.json'), JSON.stringify(result, null, 2)) } catch (err) { log.error(`[smoke] could not write smoke.json: ${err.message}`) }
  }
  async function waitFor(check, ms, what, every = 100) {
    const end = now() + ms
    for (;;) {
      if (ended) throw new Error('the run has ended')
      let v = null
      try { v = await check() } catch { v = null }
      if (v) return v
      if (now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
      await sleep(every)
    }
  }

  function finish() {
    if (overall) clearTimeout(overall)
    if (quitTimer) clearTimeout(quitTimer)
    const v = verdict(result)
    result.ok = v.ok
    if (!v.ok && !result.failure) result.failure = v.reason
    result.done = true
    save()
    log.log(`[smoke] ${result.ok ? 'PASSED' : `FAILED: ${result.failure}`} (${result.totalMs} ms)`)
    return result.ok ? 0 : 1
  }

  /** The app's own quit sequence; it ends in will-quit (below), else the run exits 1 after quitTimeoutMs */
  function beginQuit() {
    if (quitT0 !== null) return
    quitT0 = now()
    quitTimer = setTimeout(() => {
      recordStep(result, 'quit', false, { ms: now() - quitT0, detail: `the app had not quit after ${quitTimeoutMs} ms` })
      if (!result.failure) result.failure = 'quit: the app did not quit'
      finish()
      app.exit(1)
    }, quitTimeoutMs)
    try { (hooks?.quit ?? (() => app.quit()))() } catch (err) { log.error(`[smoke] quit: ${err.message}`); app.exit(1) }
  }

  function fail(reason) {
    if (ended) return
    ended = true
    result.failure = `${current}: ${reason}`
    if (!result.steps.some(s => s.name === current)) recordStep(result, current, false, { detail: reason })
    log.error(`[smoke] FAILED at ${current}: ${reason}`)
    save()
    beginQuit()
  }

  const onWillQuit = () => {
    ended = true
    if (!result.steps.some(s => s.name === 'quit')) recordStep(result, 'quit', true, { ms: quitT0 === null ? 0 : now() - quitT0 })
    app.exit(finish())
  }
  app.on('will-quit', onWillQuit)

  // A dialog would sit there until the job is killed: say what it said and end the run
  try {
    dialog.showErrorBox = (title, content) => fail(`a dialog came up: ${title}: ${content}`)
  } catch (err) {
    log.error(`[smoke] could not take over dialogs: ${err.message}`)
  }
  overall = setTimeout(() => fail(`timed out after ${timeoutMs} ms at ${current}`), timeoutMs)
  log.log(`[smoke] smoke run: userData ${dirs.userData}, SPAWN_HOME ${dirs.home}, output ${dirs.out}`)
  save()

  async function step(name, fn) {
    if (ended) throw new Error('the run has ended')
    current = name
    const s0 = now()
    log.log(`[smoke] ${name} …`)
    const detail = await fn()
    if (ended) throw new Error('the run has ended')
    recordStep(result, name, true, { ms: now() - s0, detail: detail ?? null })
    log.log(`[smoke] ${name}: ok (${now() - s0} ms)`)
    save()
  }

  async function run(h) {
    hooks = h
    const win = () => h.getWindow()
    try {
      await step('start', () => ({ pid: process.pid, userData: dirs.userData, home: dirs.home }))
      await step('window', async () => {
        const w = await waitFor(() => readyWindow(win()), 40_000, 'the app window to load and show')
        return { mode: h.mode(), bounds: w.getBounds() }
      })

      let term = null
      await step('shell-open', async () => {
        // In the run's own folder: the default (Documents) is one macOS guards with a
        // permission prompt, which nobody answers on a CI runner
        term = await win().webContents.executeJavaScript(`window.spawn.terminals.create({ tool: 'shell', cwd: ${JSON.stringify(dirs.home)} })`, true)
        if (!term || term.error || !term.id) throw new Error(`the shell did not start: ${term?.error ?? 'no reply'}`)
        return { id: term.id, tool: term.tool, toolName: term.toolName, cwd: term.cwd }
      })
      const output = () => h.terminals()?.buffer(term.id)?.data ?? ''
      // As the keyboard types: the page's write over IPC
      const type = (text) => win().webContents.executeJavaScript(`window.spawn.terminals.write(${JSON.stringify(term.id)}, ${JSON.stringify(text)})`, true)

      await step('shell-echo', async () => {
        try {
          await waitFor(() => output().length > 0, 10_000, 'the shell to print its prompt')
          await sleep(typeDelayMs)
          await type(ECHO)
          await waitFor(() => sawEcho(output()), 15_000, `${ECHO_SEEN} in the shell's output`)
        } catch (err) {
          throw new Error(`${err.message}; output so far: ${JSON.stringify(plain(output()).slice(-600))}`)
        }
        return { typed: ECHO.trim(), seen: ECHO_SEEN }
      })

      // The PATH and LANG handed to the pty (this process's, as terminals.cjs passes them on)
      // and the ones the shell itself sees after its login files
      result.env = { handed: { PATH: env.PATH ?? null, LANG: env.LANG ?? null, LC_ALL: env.LC_ALL ?? null, LC_CTYPE: env.LC_CTYPE ?? null }, shell: null }
      try {
        await step('shell-env', async () => {
          await type(ENV_ECHO)
          const seen = await waitFor(() => shellEnvFrom(output()), 5_000, "the shell's PATH and LANG")
          result.env.shell = seen
          return seen
        })
      } catch (err) {
        if (ended) throw err
        recordStep(result, 'shell-env', false, { detail: err.message })
        log.log(`[smoke] shell-env: not read (${err.message}), going on`)
        save()
      }

      for (const [name, mode, file] of CAPTURES) {
        await step(name, async () => {
          await h.setMode(mode)
          const w = await waitFor(() => (h.mode() === mode ? readyWindow(win()) : null), 15_000, `the ${mode} window`)
          // The page lays the mode out and the cross-fade ends
          await sleep(settleMs)
          const image = await w.webContents.capturePage()
          if (!image || image.isEmpty()) throw new Error('the capture came back empty')
          fs.writeFileSync(path.join(dirs.out, file), image.toPNG())
          result.screenshots[mode] = file
          const bounds = w.getBounds()
          const workArea = h.workArea ? h.workArea(w) : null
          const filled = !!workArea && ['x', 'y', 'width', 'height'].every(k => bounds[k] === workArea[k])
          return { file, size: image.getSize(), bounds, workArea, filled, kind: w.spawnKind ?? null }
        })
      }

      current = 'quit'
      log.log('[smoke] quit …')
      save()
      beginQuit()
    } catch (err) {
      fail(err?.message ?? String(err))
    }
  }

  /** Timers off and the quit handler gone (tests) */
  function stop() {
    ended = true
    clearTimeout(overall)
    if (quitTimer) clearTimeout(quitTimer)
    app.removeListener?.('will-quit', onWillQuit)
  }

  return { dirs, result, run, fail, stop }
}

module.exports = { SMOKE_FLAG, STEPS, CAPTURES, ECHO, ECHO_SEEN, ENV_ECHO, isSmokeRun, smokeDirs, sawEcho, shellEnvFrom, newResult, recordStep, verdict, readyWindow, prepare }
