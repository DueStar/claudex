'use strict'

/**
 * electron/smoke.cjs — the smoke launch the Mac CI runs on the built app
 * (scripts/smoke-mac.mjs starts it with --smoke-test and SPAWN_SMOKE_DIR).
 * Loading it does nothing; main.cjs calls prepare() only when isSmokeRun()
 * says so (the flag, on a Mac, with SPAWN_SMOKE_DIR set).
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
 *   capture-window      a PNG of each mode (webContents.capturePage), once the
 *                       terminal in the page shows the shell's output again
 *   terminal-font       the terminal draws with the bundled Monaspace Neon (its
 *                       @font-face loaded, public/fonts/fonts.css), its cell is
 *                       0.55–0.68 of the font size (Monaspace about 0.615; a
 *                       proportional or CJK face first made it far wider, CI
 *                       run 2; Menlo measured 0.538 in run 3), and the new
 *                       window replayed the shell's output. The page's other
 *                       bundled faces (W Uncut, W Pretendard) are recorded
 *   capture-widget
 *   capture-fullscreen  the window fills the work area (macWindow.cjs's fill,
 *                       and the bounds equal the work area as it is now)
 *   restore-window      back to the window mode: the bounds from before
 *   work-mode           업무 모드 (src/workMode.ts) switched on by ⌘⇧H as the page's own
 *                       key handler takes it (src/keys.ts → Widget): the run's settings
 *                       start with it off; on, the root has the work-mode class, no
 *                       Pokémon or ball picture (/sprites/) and no logo is drawn, and
 *                       the header's first item sits right of the traffic lights (78px
 *                       room); work-mode.png; ⌘⇧H again switches it off
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
const STEPS = Object.freeze(['start', 'window', 'shell-open', 'shell-echo', 'shell-env', 'capture-window', 'terminal-font', 'capture-widget', 'capture-fullscreen', 'restore-window', 'work-mode', 'quit'])
/** Monaspace Neon's cell is about 0.615 em (Menlo's measured 0.538 on the runner): outside this it is not the face drawing */
const CELL_RATIO = Object.freeze({ min: 0.55, max: 0.68 })
/** The terminal's face, shipped with the app */
const TERMINAL_FACE = 'Monaspace Neon Var'
const OPTIONAL = new Set(['shell-env'])
/** [step, mode, picture] */
const CAPTURES = Object.freeze([['capture-window', 'window', 'window.png'], ['capture-widget', 'widget', 'widget.png'], ['capture-fullscreen', 'fullscreen', 'fullscreen.png']])
// The typed line never holds what the output is checked for: the shell has to work it out
const ECHO = 'echo spawn-$((40+2))\n'
const ECHO_SEEN = 'spawn-42'
const ENV_ECHO = 'echo "spawn-path-$((1+1))=$PATH"; echo "spawn-lang-$((1+1))=$LANG"\n'
const DEFAULT_TIMEOUT_MS = 60_000
/**
 * ⌘⇧H as the keyboard hands it to the page: a keydown at the focused element, which the
 * page's capture-phase handler (src/keys.ts appShortcut → 'workMode', Widget.tsx) takes and
 * turns into the same settings change the shortcut makes
 */
const WORK_MODE_KEY_JS = `/* spawn-smoke:work-mode-key */ (() => {
  const target = document.activeElement || document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', code: 'KeyH', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }))
  return true
})()`
/** What the page shows of 업무 모드 (read in the window mode) */
const WORK_MODE_READ_JS = `/* spawn-smoke:work-mode-read */ (() => {
  const root = document.documentElement
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const head = document.querySelector('.w-side .w-head')
  const items = head ? Array.from(head.children).filter(shown) : []
  const rail = document.querySelector('.w-rail')
  const railFirst = rail ? Array.from(rail.children).find(shown) : null
  return {
    workMode: root.classList.contains('work-mode'),
    mac: root.classList.contains('is-mac'),
    atLoad: (window.spawn && window.spawn.settings) ? window.spawn.settings.workModeAtLoad === true : null,
    pokemonImages: Array.from(document.querySelectorAll('img')).filter((i) => (i.getAttribute('src') || '').includes('/sprites/')).length,
    logo: !!document.querySelector('.w-brand, .w-rail-brand'),
    folded: !!document.querySelector('.widget.side-hidden'),
    headLeft: items.length ? Math.round(Math.min(...items.map((el) => el.getBoundingClientRect().left))) : null,
    railTop: railFirst ? Math.round(railFirst.getBoundingClientRect().top) : null,
  }
})()`
/** The macOS traffic lights end left of this (widget-expanded.css .is-mac: the header starts 78px in) */
const TRAFFIC_LIGHTS_ROOM = 78
/** ...and the folded rail starts below them (padding-top 30px) */
const TRAFFIC_LIGHTS_DROP = 30
// How long the app's own quit sequence may take before the run gives up on it
const QUIT_TIMEOUT_MS = 20_000

/**
 * The overall timeout: SPAWN_SMOKE_TIMEOUT_MS when it is a positive number, else 60 s.
 * scripts/smoke-mac.mjs kills the app only after this plus QUIT_TIMEOUT_MS and a margin
 * (mac-build.mjs smokeKillMs), so a run out of time still writes why.
 */
function smokeTimeoutMs(env = process.env) {
  const n = Number(env.SPAWN_SMOKE_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

/**
 * A smoke run only when all three hold: the flag, a Mac, and SPAWN_SMOKE_DIR (which
 * scripts/smoke-mac.mjs sets). Otherwise the flag is ignored completely and the app
 * starts as it always does (its lock, its updater, its real userData).
 */
function isSmokeRun(argv = process.argv, platform = process.platform, env = process.env) {
  return Array.isArray(argv) && argv.includes(SMOKE_FLAG) && platform === 'darwin' && !!env?.SPAWN_SMOKE_DIR
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

/**
 * The terminal's font, as the page measured it (src/termMetrics.ts): ok when its cell
 * is CELL_RATIO of the font size and the page shows the shell's output again.
 */
function fontVerdict(m, seen = ECHO_SEEN) {
  if (!m) return { ok: false, ratio: null, reason: 'the page has no metrics for the terminal (not on screen?)' }
  const ratio = m.cellWidth > 0 && m.fontSize > 0 ? Math.round((m.cellWidth / m.fontSize) * 1000) / 1000 : null
  const mono = (m.faces ?? []).find(f => f.face === TERMINAL_FACE)
  if (!mono) return { ok: false, ratio, reason: `${TERMINAL_FACE} is not in the terminal's stack (${m.fontFamily})` }
  if (mono.status !== 'loaded') return { ok: false, ratio, reason: `the bundled ${TERMINAL_FACE} is not loaded (status ${mono.status})` }
  if (ratio === null) return { ok: false, ratio, reason: `no cell size measured (cellWidth ${m.cellWidth}, fontSize ${m.fontSize})` }
  if (ratio < CELL_RATIO.min || ratio > CELL_RATIO.max) {
    const firstPresent = (m.faces ?? []).find(f => f.present)?.face ?? null
    return { ok: false, ratio, reason: `the cell is ${ratio} of the font size (monospace: ${CELL_RATIO.min}–${CELL_RATIO.max}); first face there: ${firstPresent}` }
  }
  if (!String(m.text ?? '').includes(seen)) return { ok: false, ratio, reason: `the terminal in this window does not show ${seen} (its output was not replayed)` }
  return { ok: true, ratio, reason: null }
}

/**
 * The page's 업무 모드 reading (WORK_MODE_READ_JS) against what it should show: off, the
 * Pokémon as always (at least the logo's ball, so the picture check finds what it is for);
 * on, the class, no picture from /sprites/, no logo, nothing under the traffic lights
 */
function workModeVerdict(r, on) {
  if (!r) return { ok: false, reason: 'the page gave no reading' }
  if (!on) {
    if (r.workMode) return { ok: false, reason: 'the root still has the work-mode class' }
    if (!(r.pokemonImages > 0)) return { ok: false, reason: `with work mode off no picture from /sprites/ was found (${r.pokemonImages}): the check would see nothing` }
    return { ok: true, reason: null }
  }
  if (!r.workMode) return { ok: false, reason: 'the root has no work-mode class' }
  if (r.pokemonImages !== 0) return { ok: false, reason: `${r.pokemonImages} picture(s) from /sprites/ still drawn` }
  if (r.logo) return { ok: false, reason: 'the logo is still drawn' }
  if (r.mac) {
    if (r.folded ? !(r.railTop >= TRAFFIC_LIGHTS_DROP) : !(r.headLeft >= TRAFFIC_LIGHTS_ROOM)) {
      return { ok: false, reason: r.folded ? `the folded rail starts at y ${r.railTop}, under the traffic lights` : `the header's first item starts at x ${r.headLeft}, under the traffic lights` }
    }
  }
  return { ok: true, reason: null }
}

/** Bounds equal to the work area, edge for edge */
const sameRect = (a, b) => !!a && !!b && ['x', 'y', 'width', 'height'].every(k => a[k] === b[k])

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
 * terminals() (the terminal manager), workArea(win), isFilled(win)
 * (macWindow.cjs), quit() (the app's own).
 */
function prepare({ app, dialog, env = process.env, tmp = os.tmpdir(), log = console, now = Date.now, timeoutMs = smokeTimeoutMs(env), quitTimeoutMs = QUIT_TIMEOUT_MS, settleMs = 1500, typeDelayMs = 300 }) {
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

      // The open terminal's metrics from the page (src/termMetrics.ts), or null
      const pageMetrics = async () => {
        const all = await win().webContents.executeJavaScript('window.spawnTermMetrics ? window.spawnTermMetrics() : null', true)
        return Array.isArray(all) ? all.find(m => m && m.id === term.id) ?? null : null
      }
      const windowShows = (mode) => waitFor(() => (h.mode() === mode ? readyWindow(win()) : null), 15_000, `the ${mode} window`)
      let windowBounds = null

      for (const [name, mode, file] of CAPTURES) {
        await step(name, async () => {
          await h.setMode(mode)
          let w = await windowShows(mode)
          // The page lays the mode out and the cross-fade ends
          await sleep(settleMs)
          // A window with the terminal: its output replayed before the picture (soft: the
          // terminal-font step is the check)
          let replayed = null
          if (mode !== 'widget') {
            try {
              await waitFor(async () => String((await pageMetrics())?.text ?? '').includes(ECHO_SEEN), 8_000, `${ECHO_SEEN} in the page's terminal`)
              replayed = true
            } catch (err) { if (ended) throw err; replayed = false }
          }
          let filled = null
          let fitsWorkArea = null
          if (mode === 'fullscreen') {
            // Filled (macWindow.cjs) and edge to edge with the work area as it is now: the Dock shown
            // again on leaving the widget changes it after the fill (refillOnWorkAreaChange)
            try {
              await waitFor(() => {
                const cur = readyWindow(win())
                return cur && h.isFilled?.(cur) && sameRect(cur.getBounds(), h.workArea?.(cur)) ? cur : null
              }, 3_000, 'the window to fill the work area')
            } catch (err) { if (ended) throw err }
            w = readyWindow(win()) ?? w
            filled = h.isFilled ? !!h.isFilled(w) : null
            fitsWorkArea = sameRect(w.getBounds(), h.workArea ? h.workArea(w) : null)
          }
          const image = await w.webContents.capturePage()
          if (!image || image.isEmpty()) throw new Error('the capture came back empty')
          fs.writeFileSync(path.join(dirs.out, file), image.toPNG())
          result.screenshots[mode] = file
          const bounds = w.getBounds()
          const workArea = h.workArea ? h.workArea(w) : null
          if (mode === 'window') windowBounds = bounds
          const detail = { file, size: image.getSize(), bounds, workArea, kind: w.spawnKind ?? null, ...(replayed === null ? {} : { replayed }), ...(mode === 'fullscreen' ? { filled, fitsWorkArea } : {}) }
          if (mode === 'fullscreen' && (!filled || !fitsWorkArea)) {
            throw new Error(`full screen is not the work area filled: filled ${filled}, bounds ${JSON.stringify(bounds)}, work area ${JSON.stringify(workArea)}`)
          }
          return detail
        })

        if (mode === 'window') {
          await step('terminal-font', async () => {
            let m = null
            try {
              await waitFor(async () => { m = await pageMetrics(); return fontVerdict(m).ok }, 8_000, "the terminal's font")
            } catch (err) { if (ended) throw err }
            const v = fontVerdict(m)
            // The page's bundled faces: loaded, and each drawing its own sample (é of Pokédex in Uncut Sans)
            let fonts = null
            try { fonts = await win().webContents.executeJavaScript('window.spawnFontStatus ? window.spawnFontStatus() : null', true) } catch { fonts = null }
            result.fonts = fonts
            const measured = (m?.faces ?? []).find(f => f.status === 'loaded' || f.present)?.face ?? null
            const detail = m ? { ratio: v.ratio, measured, fontFamily: m.fontFamily, fontSize: m.fontSize, cellWidth: m.cellWidth, cellHeight: m.cellHeight, cols: m.cols, rows: m.rows, faces: m.faces, firstPresent: (m.faces ?? []).find(f => f.present)?.face ?? null, pageFonts: fonts } : null
            result.terminalFont = detail
            if (!v.ok) throw new Error(v.reason)
            return detail
          })
        }
      }

      await step('restore-window', async () => {
        await h.setMode('window')
        const w = await windowShows('window')
        await sleep(settleMs)
        const bounds = w.getBounds()
        const filled = h.isFilled ? !!h.isFilled(w) : null
        if (!sameRect(bounds, windowBounds)) throw new Error(`back in the window mode at ${JSON.stringify(bounds)}, not where the window was (${JSON.stringify(windowBounds)})`)
        if (filled) throw new Error('the window still counts as filled')
        return { bounds, filled }
      })

      // 업무 모드 on and off by its shortcut (⌘⇧H), in the window mode
      await step('work-mode', async () => {
        const read = () => win().webContents.executeJavaScript(WORK_MODE_READ_JS, true)
        const press = () => win().webContents.executeJavaScript(WORK_MODE_KEY_JS, true)
        const until = async (on, what) => {
          let r = null
          try {
            await waitFor(async () => { r = await read(); return workModeVerdict(r, on).ok }, 5_000, what)
          } catch (err) {
            if (ended) throw err
            throw new Error(`${what}: ${workModeVerdict(r, on).reason} (${JSON.stringify(r)})`)
          }
          return r
        }
        const before = await read()
        // The run's own userData starts with the defaults: work mode off, also for the preload
        if (!before || before.atLoad !== false) throw new Error(`the page did not start with work mode off (${JSON.stringify(before)})`)
        await until(false, 'work mode off at the start')
        await press()
        const on = await until(true, 'work mode on (⌘⇧H)')
        await sleep(settleMs)
        const image = await win().webContents.capturePage()
        if (!image || image.isEmpty()) throw new Error('the capture came back empty')
        fs.writeFileSync(path.join(dirs.out, 'work-mode.png'), image.toPNG())
        result.screenshots['work-mode'] = 'work-mode.png'
        await press()
        const off = await until(false, 'work mode off again (⌘⇧H)')
        result.workMode = { before, on, off }
        return { file: 'work-mode.png', size: image.getSize(), on, off }
      })

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

module.exports = { WORK_MODE_KEY_JS, WORK_MODE_READ_JS, TRAFFIC_LIGHTS_ROOM, TRAFFIC_LIGHTS_DROP, workModeVerdict, SMOKE_FLAG, DEFAULT_TIMEOUT_MS, QUIT_TIMEOUT_MS, smokeTimeoutMs, CELL_RATIO, TERMINAL_FACE, fontVerdict, sameRect, STEPS, CAPTURES, ECHO, ECHO_SEEN, ENV_ECHO, isSmokeRun, smokeDirs, sawEcho, shellEnvFrom, newResult, recordStep, verdict, readyWindow, prepare }
