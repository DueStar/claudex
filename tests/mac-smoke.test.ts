/**
 * The Mac CI's smoke launch (electron/smoke.cjs, run by scripts/smoke-mac.mjs
 * with --smoke-test): its own folders, a shell session that must print
 * spawn-42, a picture of each mode, then a quit; smoke.json says how far it
 * got. The run is driven here with a fake app and window, so its steps are
 * tested on any OS. main.cjs loads the file only behind the flag.
 */

import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const smoke = require('../electron/smoke.cjs')
const { isSmokeRun, smokeDirs, sawEcho, shellEnvFrom, newResult, recordStep, verdict, prepare, fontVerdict, sameRect, STEPS, ECHO, ECHO_SEEN, ENV_ECHO } = smoke
const ROOT = join(__dirname, '..')

describe('the flag', () => {
  it('is on only with --smoke-test', () => {
    expect(isSmokeRun(['/Applications/spawn.app/Contents/MacOS/spawn', '--smoke-test'])).toBe(true)
    expect(isSmokeRun(['spawn.exe'])).toBe(false)
    expect(isSmokeRun(['spawn.exe', '--smoke-tests'])).toBe(false)
  })

  it('main.cjs loads smoke.cjs only behind the flag (a run without it never requires the file)', () => {
    const src = readFileSync(join(ROOT, 'electron', 'main.cjs'), 'utf8')
    const lines = src.split('\n').filter(l => l.includes("require('./smoke.cjs')"))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/process\.argv\.includes\('--smoke-test'\)\s*\?\s*require\('\.\/smoke\.cjs'\)/)
    // the rest of main only ever touches it through `smoke?.` or a `!smoke` test
    expect(src).not.toMatch(/\bsmoke\.(?!cjs)/)
  })
})

describe('helpers', () => {
  it('folders: from the environment, else under the temp dir', () => {
    expect(smokeDirs({ SPAWN_SMOKE_DIR: '/s', SPAWN_SMOKE_USERDATA: '/u', SPAWN_HOME: '/h' }, '/tmp')).toEqual({ out: '/s', userData: '/u', home: '/h' })
    const d = smokeDirs({}, tmpdir())
    for (const p of [d.out, d.userData, d.home]) expect(p.startsWith(tmpdir())).toBe(true)
  })

  it('the echo: spawn-42 only once the shell has worked out $((40+2)) (the typed line never matches)', () => {
    expect(ECHO).toBe('echo spawn-$((40+2))\n')
    expect(ECHO_SEEN).toBe('spawn-42')
    expect(sawEcho('% echo spawn-$((40+2))\r\n')).toBe(false)
    expect(sawEcho('% echo spawn-$((40+2))\r\n\x1b[0mspawn-42\r\n% ')).toBe(true)
  })

  it('the shell\'s PATH and LANG, read from its output (the typed line never matches)', () => {
    expect(ENV_ECHO).toContain('$((1+1))')
    expect(shellEnvFrom(`% ${ENV_ECHO}`)).toBe(null)
    const out = `% ${ENV_ECHO}\r\nspawn-path-2=/opt/homebrew/bin:/usr/bin:/bin\r\nspawn-lang-2=en_US.UTF-8\r\n% `
    expect(shellEnvFrom(out)).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8' })
    expect(shellEnvFrom('spawn-path-2=/usr/bin\r\nspawn-lang-2=\r\n')).toEqual({ PATH: '/usr/bin', LANG: '' })
  })

  it('the result: platform, arch, electron, steps with timings; passes when every required step did', () => {
    const r = newResult({ platform: 'darwin', arch: 'arm64', electron: '33.4.11', version: '1.3.48', now: 0 })
    expect(r).toMatchObject({ platform: 'darwin', arch: 'arm64', electron: '33.4.11', version: '1.3.48', ok: false, steps: [], passed: [] })
    for (const s of STEPS) if (s !== 'shell-env') recordStep(r, s, true, { ms: 5 })
    expect(r.steps[0]).toEqual({ name: 'start', ok: true, ms: 5 })
    // shell-env is optional: a readout that failed does not fail the run
    recordStep(r, 'shell-env', false, { detail: 'no output' })
    expect(verdict(r)).toEqual({ ok: true, reason: null })
    const missing = newResult({ now: 0 })
    recordStep(missing, 'start', true)
    expect(verdict(missing).ok).toBe(false)
    expect(verdict(missing).reason).toContain('shell-echo')
    const failed = newResult({ now: 0 })
    failed.failure = 'window: timed out'
    expect(verdict(failed)).toEqual({ ok: false, reason: 'window: timed out' })
  })

  it('the timeout: SPAWN_SMOKE_TIMEOUT_MS when it is a positive number, else 60 s', () => {
    expect(smoke.smokeTimeoutMs({})).toBe(60_000)
    expect(smoke.smokeTimeoutMs({ SPAWN_SMOKE_TIMEOUT_MS: '120000' })).toBe(120_000)
    for (const bad of ['', 'abc', '-5', '0', 'Infinity']) expect(smoke.smokeTimeoutMs({ SPAWN_SMOKE_TIMEOUT_MS: bad })).toBe(60_000)
    expect(smoke.QUIT_TIMEOUT_MS).toBe(20_000)
  })

  it('the steps, in order', () => {
    expect(STEPS).toEqual(['start', 'window', 'shell-open', 'shell-echo', 'shell-env', 'capture-window', 'terminal-font', 'capture-widget', 'capture-fullscreen', 'restore-window', 'quit'])
  })

  it("the terminal's font: a monospace cell (0.5–0.7 em) and the shell's output on screen", () => {
    const m = { fontSize: 13, cellWidth: 7.83, text: 'spawn-42', faces: [{ face: 'Monaspace Neon Var', present: false }, { face: 'Menlo', present: true }] }
    expect(fontVerdict(m)).toEqual({ ok: true, ratio: 0.602, reason: null })
    // CI run 2: Apple SD Gothic Neo first, a cell as wide as its W
    const wide = fontVerdict({ ...m, cellWidth: 12.4, faces: [{ face: 'Apple SD Gothic Neo', present: true }] })
    expect(wide.ok).toBe(false)
    expect(wide.reason).toMatch(/0\.954 of the font size .*first face there: Apple SD Gothic Neo/)
    expect(fontVerdict({ ...m, cellWidth: 5 }).ok).toBe(false)
    expect(fontVerdict({ ...m, cellWidth: null }).reason).toMatch(/no cell size/)
    expect(fontVerdict(null).ok).toBe(false)
    expect(fontVerdict({ ...m, text: '' }).reason).toMatch(/not replayed/)
  })

  it('sameRect: edge for edge', () => {
    expect(sameRect({ x: 0, y: 25, width: 1024, height: 681 }, { x: 0, y: 25, width: 1024, height: 681 })).toBe(true)
    expect(sameRect({ x: 0, y: 25, width: 1024, height: 681 }, { x: 0, y: 25, width: 1024, height: 684 })).toBe(false)
    expect(sameRect(null, { x: 0, y: 0, width: 1, height: 1 })).toBe(false)
  })
})

// A fake Electron: the app (paths, quit), one window per mode, terminals whose
// output says spawn-42 once the echo is typed
function fakeElectron({ shellError = null as string | null, windowShows = true, cellWidth = 7.8, fullscreenFilled = true, restoreTo = null as null | { x: number, y: number, width: number, height: number } } = {}) {
  const app = Object.assign(new EventEmitter(), {
    setPath: vi.fn(),
    getPath: vi.fn(() => '/fake/userData'),
    getVersion: () => '1.3.48',
    exit: vi.fn(),
    quit: vi.fn(),
  })
  // app.quit runs the app's own quit sequence, which ends in will-quit
  app.quit.mockImplementation(() => { setTimeout(() => app.emit('will-quit'), 0) })
  const dialog = { showErrorBox: vi.fn() }
  let output = ''
  const terms = {
    buffer: vi.fn(() => ({ data: output, seq: 1 })),
  }
  const exec = vi.fn(async (js: string) => {
    if (js.includes('terminals.create')) {
      if (shellError) return { error: shellError }
      output = 'user@mac ~ % '
      return { id: 'term-1', tool: 'shell', toolName: 'zsh', cwd: '/Users/runner' }
    }
    if (js.includes('spawnTermMetrics')) {
      return [{ id: 'term-1', fontFamily: "'Monaspace Neon Var', Menlo, monospace", fontSize: 13, cellWidth, cellHeight: 15, cols: 100, rows: 30, faces: [{ face: 'Monaspace Neon Var', check: true, present: false }, { face: 'Menlo', check: true, present: true }], text: output }]
    }
    if (js.includes('terminals.write')) {
      if (js.includes('40+2')) output += 'echo spawn-$((40+2))\r\nspawn-42\r\nuser@mac ~ % '
      if (js.includes('1+1')) output += 'spawn-path-2=/opt/homebrew/bin:/usr/bin\r\nspawn-lang-2=en_US.UTF-8\r\n'
      return undefined
    }
    return undefined
  })
  let mode = 'widget'
  let windowsMade = 0
  const makeWindow = (m: string) => ({
    spawnKind: m === 'widget' ? 'widget' : 'window',
    isDestroyed: () => false,
    isVisible: () => windowShows,
    getBounds: () => (m === 'fullscreen' ? { x: 0, y: 25, width: 1440, height: 875 } : (m === 'window' && windowsMade > 2 && restoreTo) ? restoreTo : { x: 100, y: 100, width: 800, height: 600 }),
    webContents: {
      isLoading: () => false,
      executeJavaScript: exec,
      capturePage: vi.fn(async () => ({ isEmpty: () => false, toPNG: () => Buffer.from(`png-${m}`), getSize: () => ({ width: 800, height: 600 }) })),
    },
  })
  let win = makeWindow(mode)
  const hooks = {
    getWindow: () => win,
    mode: () => mode,
    setMode: vi.fn(async (m: string) => { mode = m; windowsMade += 1; win = makeWindow(m) }),
    terminals: () => terms,
    workArea: () => ({ x: 0, y: 25, width: 1440, height: 875 }),
    isFilled: () => mode === 'fullscreen' && fullscreenFilled,
    // the app's own quit sequence ends in will-quit
    quit: vi.fn(() => { setTimeout(() => app.emit('will-quit'), 0) }),
  }
  return { app, dialog, hooks, terms, exec }
}

describe('a smoke run (fake app)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'spawn-smoke-test-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const envFor = () => ({ SPAWN_SMOKE_DIR: join(dir, 'out'), SPAWN_SMOKE_USERDATA: join(dir, 'ud'), SPAWN_HOME: join(dir, 'home'), PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } as Record<string, string>)
  const readResult = () => JSON.parse(readFileSync(join(dir, 'out', 'smoke.json'), 'utf8'))
  const exited = (app: { exit: ReturnType<typeof vi.fn> }) => vi.waitFor(() => expect(app.exit).toHaveBeenCalled(), { timeout: 5000 })
  const quiet = { log: vi.fn(), error: vi.fn() }

  it('prepare: its own userData and SPAWN_HOME; a dialog would wait forever, so it fails the run instead', async () => {
    const f = fakeElectron()
    const env = envFor()
    delete env.SPAWN_HOME
    const s = prepare({ app: f.app, dialog: f.dialog, env, tmp: dir, log: quiet, timeoutMs: 10_000 })
    expect(f.app.setPath).toHaveBeenCalledWith('userData', join(dir, 'ud'))
    expect(env.SPAWN_HOME).toBe(s.dirs.home)
    expect(existsSync(s.dirs.home)).toBe(true)
    f.dialog.showErrorBox('spawn', 'The server did not start')
    await exited(f.app)
    expect(f.app.exit).toHaveBeenCalledWith(1)
    expect(readResult().failure).toContain('The server did not start')
    s.stop()
  })

  it('all steps: a shell prints spawn-42, three pictures, the PATH and LANG it saw, then quits with 0', async () => {
    const f = fakeElectron()
    const s = prepare({ app: f.app, dialog: f.dialog, env: envFor(), tmp: dir, log: quiet, timeoutMs: 10_000, settleMs: 0, typeDelayMs: 0 })
    await s.run(f.hooks)
    await exited(f.app)
    expect(f.app.exit).toHaveBeenCalledWith(0)
    expect(f.hooks.setMode.mock.calls.map(c => c[0])).toEqual(['window', 'widget', 'fullscreen', 'window'])
    // the shell opens through the page's own bridge, in the run's folder (not Documents, which macOS guards)
    const js = f.exec.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(js.some((c: string) => c.includes("window.spawn.terminals.create({ tool: 'shell', cwd: ") && c.includes(JSON.stringify(join(dir, 'home'))))).toBe(true)
    const r = readResult()
    expect(r.ok).toBe(true)
    expect(r.done).toBe(true)
    expect(r.passed).toEqual(STEPS)
    expect(r.env.shell).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', LANG: 'en_US.UTF-8' })
    expect(r.env.handed).toMatchObject({ PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' })
    for (const m of ['window', 'widget', 'fullscreen']) {
      expect(readFileSync(join(dir, 'out', `${m}.png`), 'utf8')).toBe(`png-${m}`)
    }
    expect(r.steps.find((x: { name: string }) => x.name === 'capture-fullscreen').detail).toMatchObject({ filled: true, fitsWorkArea: true, replayed: true })
    expect(r.steps.find((x: { name: string }) => x.name === 'capture-window').detail.replayed).toBe(true)
    expect(r.terminalFont).toMatchObject({ ratio: 0.6, fontSize: 13, cellWidth: 7.8, firstPresent: 'Menlo' })
    expect(r.steps.find((x: { name: string }) => x.name === 'restore-window').detail).toEqual({ bounds: { x: 100, y: 100, width: 800, height: 600 }, filled: false })
    expect(typeof r.totalMs).toBe('number')
    s.stop()
  })

  it('a shell that cannot start: the run stops at shell-open and exits 1, the reason in smoke.json', async () => {
    const f = fakeElectron({ shellError: 'posix_spawnp failed.' })
    const s = prepare({ app: f.app, dialog: f.dialog, env: envFor(), tmp: dir, log: quiet, timeoutMs: 10_000, settleMs: 0, typeDelayMs: 0 })
    await s.run(f.hooks)
    await exited(f.app)
    expect(f.app.exit).toHaveBeenCalledWith(1)
    const r = readResult()
    expect(r.ok).toBe(false)
    expect(r.failure).toMatch(/^shell-open: .*posix_spawnp failed/)
    expect(r.steps.find((x: { name: string }) => x.name === 'shell-open').ok).toBe(false)
    expect(quiet.error).toHaveBeenCalled()
    s.stop()
  })

  it('a terminal drawn with a proportional face (CI run 2): the run fails at terminal-font with the ratio', async () => {
    const f = fakeElectron({ cellWidth: 12.4 })
    const s = prepare({ app: f.app, dialog: f.dialog, env: envFor(), tmp: dir, log: quiet, timeoutMs: 30_000, settleMs: 0, typeDelayMs: 0 })
    await s.run(f.hooks)
    await vi.waitFor(() => expect(f.app.exit).toHaveBeenCalled(), { timeout: 15_000 })
    expect(f.app.exit).toHaveBeenCalledWith(1)
    const r = readResult()
    expect(r.failure).toMatch(/^terminal-font: the cell is 0\.954 of the font size/)
    expect(r.terminalFont.ratio).toBe(0.954)
    s.stop()
  }, 20_000)

  it('full screen not registered as filled: the run fails at capture-fullscreen', async () => {
    const f = fakeElectron({ fullscreenFilled: false })
    const s = prepare({ app: f.app, dialog: f.dialog, env: envFor(), tmp: dir, log: quiet, timeoutMs: 30_000, settleMs: 0, typeDelayMs: 0 })
    await s.run(f.hooks)
    await vi.waitFor(() => expect(f.app.exit).toHaveBeenCalled(), { timeout: 15_000 })
    expect(f.app.exit).toHaveBeenCalledWith(1)
    expect(readResult().failure).toMatch(/^capture-fullscreen: full screen is not the work area filled: filled false/)
    s.stop()
  }, 20_000)

  it('back to the window mode somewhere else: the run fails at restore-window', async () => {
    const f = fakeElectron({ restoreTo: { x: 0, y: 25, width: 1440, height: 875 } })
    const s = prepare({ app: f.app, dialog: f.dialog, env: envFor(), tmp: dir, log: quiet, timeoutMs: 30_000, settleMs: 0, typeDelayMs: 0 })
    await s.run(f.hooks)
    await vi.waitFor(() => expect(f.app.exit).toHaveBeenCalled(), { timeout: 15_000 })
    expect(f.app.exit).toHaveBeenCalledWith(1)
    expect(readResult().failure).toMatch(/^restore-window: back in the window mode at/)
    s.stop()
  }, 20_000)

  it('the overall timeout: a window that never shows fails the run with the step it stopped at', async () => {
    const f = fakeElectron({ windowShows: false })
    const s = prepare({ app: f.app, dialog: f.dialog, env: envFor(), tmp: dir, log: quiet, timeoutMs: 300, settleMs: 0, typeDelayMs: 0 })
    void s.run(f.hooks)
    await exited(f.app)
    expect(f.app.exit).toHaveBeenCalledWith(1)
    expect(readResult().failure).toMatch(/timed out after 300 ms at window/)
    s.stop()
  })

  it('a quit that never ends: recorded, and the run exits 1', async () => {
    const f = fakeElectron()
    f.hooks.quit = vi.fn()
    const s = prepare({ app: f.app, dialog: f.dialog, env: envFor(), tmp: dir, log: quiet, timeoutMs: 10_000, settleMs: 0, typeDelayMs: 0, quitTimeoutMs: 100 })
    await s.run(f.hooks)
    await exited(f.app)
    expect(f.app.exit).toHaveBeenCalledWith(1)
    const r = readResult()
    expect(r.steps.find((x: { name: string }) => x.name === 'quit').ok).toBe(false)
    s.stop()
  })
})
