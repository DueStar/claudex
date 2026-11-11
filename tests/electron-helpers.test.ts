/**
 * electron/helpers.cjs — the desktop app's pure helpers, run without Electron:
 * the server's port and reuse, window bounds clamped to a display's work area,
 * the window-state file, the tray's tooltip and menu, the app's startup.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadServer, removeServer } from './helpers'

const require = createRequire(import.meta.url)
const h = require('../electron/helpers.cjs')

const ROOT = join(__dirname, '..')

// A 1920×1080 display with a 40px taskbar at the bottom
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 }
// A second display to the right, with a 24px menu bar
const SECOND = { x: 1920, y: 24, width: 1440, height: 876 }

describe('clampBounds', () => {
  const min = { width: 300, height: 200 }

  it('leaves bounds that fit alone (rounded to whole pixels)', () => {
    expect(h.clampBounds({ x: 100.4, y: 50, width: 1056, height: 682 }, WORK_AREA, min))
      .toEqual({ x: 100, y: 50, width: 1056, height: 682 })
  })

  it('moves a window back on screen when it hangs off the right or bottom edge', () => {
    expect(h.clampBounds({ x: 1500, y: 900, width: 1056, height: 682 }, WORK_AREA, min))
      .toEqual({ x: 864, y: 358, width: 1056, height: 682 })
  })

  it('moves a window back when it is off the top-left, respecting the work-area origin', () => {
    expect(h.clampBounds({ x: -500, y: -300, width: 800, height: 600 }, SECOND, min))
      .toEqual({ x: 1920, y: 24, width: 800, height: 600 })
  })

  it('shrinks a window larger than the work area and pins it to the origin', () => {
    expect(h.clampBounds({ x: 10, y: 10, width: 3000, height: 2000 }, WORK_AREA, min))
      .toEqual({ x: 0, y: 0, width: 1920, height: 1040 })
  })

  it('raises a window below the minimum size', () => {
    expect(h.clampBounds({ x: 10, y: 10, width: 50, height: 50 }, WORK_AREA, min))
      .toEqual({ x: 10, y: 10, width: 300, height: 200 })
  })

  it('centres a window with no position, and falls back to the minimum size without one', () => {
    expect(h.clampBounds({ width: 1056, height: 682 }, WORK_AREA, min))
      .toEqual({ x: 432, y: 179, width: 1056, height: 682 })
    expect(h.clampBounds({}, WORK_AREA, min)).toEqual({ x: 810, y: 420, width: 300, height: 200 })
    expect(h.clampBounds(null, WORK_AREA, min)).toEqual({ x: 810, y: 420, width: 300, height: 200 })
    expect(h.clampBounds({ x: 'nope', y: NaN, width: Infinity, height: -5 }, WORK_AREA, min))
      .toEqual({ x: 810, y: 420, width: 300, height: 200 })
  })

  it('a display smaller than the minimum keeps the minimum (Electron enforces it anyway)', () => {
    expect(h.clampBounds({ x: 0, y: 0, width: 500, height: 400 }, { x: 0, y: 0, width: 200, height: 100 }, min))
      .toEqual({ x: 0, y: 0, width: 300, height: 200 })
  })
})

describe('window-state.json', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'claudex-window-state-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const SID = '0f8fad5b-d9cb-469f-a165-70867728950e'

  it('round-trips the app window and the session names, creating the directory', () => {
    const file = join(dir, 'nested', 'window-state.json')
    const state = {
      widgetBounds: { x: 1500, y: 12, width: 340, height: 1016 },
      widgetCompactSize: { width: 340, height: 680 },
      widgetExpandedSize: { width: 1200, height: 760 },
      widgetExpanded: true,
      widgetHidden: false,
      widgetMode: 'window',
      sessionTitles: { [SID]: '도감 작업' },
    }
    expect(h.writeWindowState(file, state)).toBe(true)
    expect(existsSync(file)).toBe(true)
    expect(h.readWindowState(file)).toEqual(state)
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false)
  })

  it('a missing file is an empty state', () => {
    expect(h.readWindowState(join(dir, 'none.json'))).toEqual({})
  })

  it('a malformed or foreign file is an empty state, and junk fields are dropped', () => {
    const file = join(dir, 'window-state.json')
    writeFileSync(file, '{ not json')
    expect(h.readWindowState(file)).toEqual({})
    writeFileSync(file, '[1, 2, 3]')
    expect(h.readWindowState(file)).toEqual({})
    writeFileSync(file, JSON.stringify({
      widgetBounds: { x: 1, y: 2, width: 0, height: 10 },          // zero width: not a rect
      widgetCompactSize: { width: 300.6, height: 200 },            // rounded
      widgetExpanded: 'yes',                                       // not a boolean
      widgetMode: 'compact',                                       // not a mode
      // what the old office window kept: dropped
      bounds: { x: 1, y: 2, width: 300, height: 200 },
      compact: true,
      alwaysOnTop: true,
      sessionTitles: { 'not-a-session': 'x', [SID]: '  다듬기  ' },
    }))
    expect(h.readWindowState(file)).toEqual({
      widgetCompactSize: { width: 301, height: 200 },
      sessionTitles: { [SID]: '다듬기' },
    })
  })

  it('an unwritable location is reported, not thrown', () => {
    const blocker = join(dir, 'file')
    writeFileSync(blocker, '')
    expect(h.writeWindowState(join(blocker, 'window-state.json'), { widgetHidden: true })).toBe(false)
  })
})

describe('the tray', () => {
  const sessions = {
    sessions: [
      { id: 's1', state: 'active', main: { state: 'working' } },
      { id: 's2', state: 'active', main: { state: 'needs-you' } },
      { id: 's3', state: 'ended', main: { state: 'idle' } },     // gone
      { id: 's4', state: 'active', main: { state: 'idle' } },
    ],
  }

  it('counts live sessions, the working ones and the ones that need you', () => {
    expect(h.sessionSummary(sessions)).toEqual({ sessions: 3, working: 1, needsYou: 1 })
    expect(h.sessionSummary({})).toEqual({ sessions: 0, working: 0, needsYou: 0 })
    expect(h.sessionSummary(null)).toBeNull()
  })

  it('statusText: one readable line per situation', () => {
    expect(h.statusText(null)).toBe('서버에 연결할 수 없어요')
    expect(h.statusText({ sessions: 0, working: 0, needsYou: 0 })).toBe('열린 세션 없음')
    expect(h.statusText({ sessions: 2, working: 0, needsYou: 0 })).toBe('세션 2개')
    expect(h.statusText({ sessions: 3, working: 1, needsYou: 1 })).toBe('세션 3개 · 1개 일하는 중 · 1개 확인 필요')
  })

  it('the menu: status, show or hide, check for an update, the QA page, quit', () => {
    const actions = { toggleWidget: vi.fn(), openQa: vi.fn(), checkUpdate: vi.fn(), quit: vi.fn() }
    const labels = (t: any[]) => t.filter(i => i.type !== 'separator').map(i => i.label)
    const shown = h.trayMenuTemplate({ visible: true, status: '세션 1개' }, actions)
    expect(labels(shown)).toEqual(['Claudex — 세션 1개', '숨기기', '업데이트 확인', '디자인 QA 페이지', 'Claudex 끝내기'])
    expect(shown[0].enabled).toBe(false)
    expect(labels(h.trayMenuTemplate({ visible: false, status: '' }, actions))).toContain('보이기')
    for (const item of shown.filter((i: any) => i.click)) item.click()
    expect(actions.toggleWidget).toHaveBeenCalledTimes(1)
    expect(actions.openQa).toHaveBeenCalledTimes(1)
    expect(actions.checkUpdate).toHaveBeenCalledTimes(1)
    expect(actions.quit).toHaveBeenCalledTimes(1)
    // No QA action: no QA item
    expect(labels(h.trayMenuTemplate({ visible: true, status: '' }, { toggleWidget() {}, quit() {} }))).not.toContain('디자인 QA 페이지')
  })

  it('the menu and status in English when the language is English (electron/i18n.cjs)', () => {
    const { translator, resolveLang } = require('../electron/i18n.cjs')
    const en = translator('en')
    const status = h.statusText({ sessions: 3, working: 1, needsYou: 1 }, en)
    expect(status).toBe('Sessions: 3 · Working: 1 · Needs you: 1')
    const menu = h.trayMenuTemplate({ visible: true, status }, { toggleWidget() {}, openSettings() {}, checkUpdate() {}, openLogs() {}, quit() {} }, en)
    expect(menu.filter((i: any) => i.type !== 'separator').map((i: any) => i.label))
      .toEqual(['Claudex — Sessions: 3 · Working: 1 · Needs you: 1', 'Hide', 'Settings', 'Check for updates', 'Open logs folder', 'Quit Claudex'])
    expect([resolveLang('auto', 'ko-KR'), resolveLang('auto', 'ja'), resolveLang('auto', 'fr-FR'), resolveLang('ja', 'ko-KR')]).toEqual(['ko', 'ja', 'en', 'ja'])
  })
})

describe('the server port (CLAUDEX_PORT)', () => {
  it('serverPortFromEnv is 3334 when unset or empty', () => {
    expect(h.serverPortFromEnv({})).toBe(3334)
    expect(h.serverPortFromEnv({ CLAUDEX_PORT: '' })).toBe(3334)
    expect(h.DEFAULT_SERVER_PORT).toBe(3334)
  })

  it('parses a port, tolerating whitespace', () => {
    expect(h.serverPortFromEnv({ CLAUDEX_PORT: '4000' })).toBe(4000)
    expect(h.serverPortFromEnv({ CLAUDEX_PORT: ' 4123 ' })).toBe(4123)
    expect(h.serverPortFromEnv({ CLAUDEX_PORT: '65535' })).toBe(65535)
  })

  it('falls back to 3334 for anything that is not a port, exactly as server/config.js readPort does', async () => {
    const { readPort } = await import('../server/config.js')
    const quiet = { warn: () => {} }
    for (const raw of ['abc', '0', '70000', '-1', '33.34', '3334abc', '0x3334', '4000', ' 4001 ', '']) {
      const env = { CLAUDEX_PORT: raw }
      expect(h.serverPortFromEnv(env), raw).toBe(readPort(env, quiet))
    }
  })

  it('serverUrls derives the load URL, health URL and allowed origins from the port', () => {
    expect(h.serverUrls(4000)).toEqual({
      port: 4000,
      serverUrl: 'http://127.0.0.1:4000',
      healthUrl: 'http://127.0.0.1:4000/health',
      viteUrl: 'http://127.0.0.1:3333',
      allowedOrigins: ['http://127.0.0.1:3333', 'http://127.0.0.1:4000'],
    })
    expect(h.serverUrls(h.serverPortFromEnv({})).serverUrl).toBe('http://127.0.0.1:3334')
  })

  it('main.cjs takes the port from the env, passes it to the server child and the tray, and hard-codes no port', () => {
    const main = readFileSync(join(ROOT, 'electron/main.cjs'), 'utf8')
    expect(main).toContain('serverPortFromEnv(process.env)')
    expect(main).toContain('CLAUDEX_PORT: String(SERVER_PORT)')
    expect(main).toContain('serverUrl: SERVER_URL')
    const code = main.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')
    expect(code).not.toMatch(/\b3334\b/)
  })
})

describe('reusing a server already on the port', () => {
  const health = (body: object) => JSON.stringify({ status: 'ok', agents: 0, clients: 0, ...body })

  it('classifyHealth: the page is there only when /health says uiAvailable: true', () => {
    expect(h.classifyHealth(200, health({ uiAvailable: true }))).toBe('usable')
    expect(h.classifyHealth(200, health({ uiAvailable: false }))).toBe('no-ui')
    // A server from before the field existed: ask it for its page instead
    expect(h.classifyHealth(200, health({}))).toBe('unknown')
    // Something else answers 200 on the port
    expect(h.classifyHealth(200, '<html>hello</html>')).toBe('no-ui')
    expect(h.classifyHealth(200, JSON.stringify({ ok: true }))).toBe('no-ui')
    expect(h.classifyHealth(200, 'null')).toBe('no-ui')
    // Nothing there
    expect(h.classifyHealth(404, health({ uiAvailable: true }))).toBe('none')
    expect(h.classifyHealth(500, '')).toBe('none')
  })

  it('classifyIndex: a 200 HTML page is the app; the "UI not built" 404 JSON is not', () => {
    expect(h.classifyIndex(200, 'text/html; charset=UTF-8')).toBe('usable')
    expect(h.classifyIndex(404, 'application/json; charset=utf-8')).toBe('no-ui')
    expect(h.classifyIndex(200, 'application/json')).toBe('no-ui')
    expect(h.classifyIndex(200, undefined)).toBe('no-ui')
  })

  it('serverPlan: start one when nothing is there; the packaged app refuses a server without the UI, dev reuses it (it loads Vite)', () => {
    expect(h.serverPlan('none', true)).toBe('start')
    expect(h.serverPlan('none', false)).toBe('start')
    expect(h.serverPlan('usable', true)).toBe('reuse')
    expect(h.serverPlan('usable', false)).toBe('reuse')
    expect(h.serverPlan('no-ui', true)).toBe('conflict')
    expect(h.serverPlan('no-ui', false)).toBe('reuse')
  })

  it('the conflict dialog names the port and the ways out', () => {
    const text = h.serverConflictMessage(4000)
    expect(text).toContain('port 4000')
    expect(text).toContain('npm run build')
    expect(text).toContain('CLAUDEX_PORT')
  })

  it('against the real server: a checkout without a build is a conflict for the packaged app, a built one is reused', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'claudex-no-ui-'))
    const built = mkdtempSync(join(tmpdir(), 'claudex-ui-'))
    writeFileSync(join(built, 'index.html'), '<!doctype html><title>Claudex</title>')
    try {
      const bare = await loadServer({ env: { CLAUDEX_UI_DIR: empty } })
      try {
        const res = await request(bare.server.app).get('/health')
        expect(h.classifyHealth(res.status, res.text)).toBe('no-ui')
        const index = await request(bare.server.app).get('/')
        expect(index.status).toBe(404)
        expect(h.classifyIndex(index.status, index.headers['content-type'])).toBe('no-ui')
        expect(h.serverPlan(h.classifyHealth(res.status, res.text), true)).toBe('conflict')
      } finally {
        removeServer(bare)
      }
      const office = await loadServer({ env: { CLAUDEX_UI_DIR: built } })
      try {
        const res = await request(office.server.app).get('/health')
        expect(h.classifyHealth(res.status, res.text)).toBe('usable')
        const index = await request(office.server.app).get('/')
        expect(h.classifyIndex(index.status, index.headers['content-type'])).toBe('usable')
      } finally {
        removeServer(office)
      }
    } finally {
      rmSync(empty, { recursive: true, force: true })
      rmSync(built, { recursive: true, force: true })
    }
  })
})

describe('app lifecycle', () => {
  it('singleFlight: a call while one is in flight gets the same run; the next call after it settles runs again', async () => {
    let release!: () => void
    const fn = vi.fn(() => new Promise<void>(r => { release = r }))
    const run = h.singleFlight(fn)
    expect(run.pending()).toBe(false)
    const a = run()
    const b = run()
    expect(b).toBe(a)
    expect(run.pending()).toBe(true)
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)
    release()
    await a
    expect(run.pending()).toBe(false)
    const c = run()
    expect(c).not.toBe(a)
    await Promise.resolve()
    release()
    await c
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('singleFlight: a failed run does not block the next one', async () => {
    const run = h.singleFlight(vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok'))
    await expect(run()).rejects.toThrow('boom')
    expect(run.pending()).toBe(false)
    await expect(run()).resolves.toBe('ok')
  })

  it('reopenAction: a second launch during startup does nothing, later it shows or creates the window', () => {
    expect(h.reopenAction({ starting: true, hasWindow: false, windowCount: 0 })).toBe('none')
    expect(h.reopenAction({ starting: true, hasWindow: true, windowCount: 1 })).toBe('none')
    expect(h.reopenAction({ starting: false, hasWindow: true, windowCount: 1 })).toBe('show')
    expect(h.reopenAction({ starting: false, hasWindow: false, windowCount: 0 })).toBe('create')
    expect(h.reopenAction({ starting: false, hasWindow: false, windowCount: 1 })).toBe('none')   // some other window (DevTools)
    // While the starting card is up, a second launch brings it forward
    expect(h.reopenAction({ starting: true, hasWindow: false, windowCount: 1, hasCard: true })).toBe('card')
    expect(h.reopenAction({ quitting: true, starting: true, hasWindow: false, windowCount: 1, hasCard: true })).toBe('none')
    // Quitting (after the error dialog of a failed startup): no second attempt
    expect(h.reopenAction({ quitting: true, starting: false, hasWindow: false, windowCount: 0 })).toBe('none')
  })

  it('childSlot: the exit of a duplicate that lost the port does not clear the server the app must stop', () => {
    const slot = h.childSlot()
    const live = { name: 'live' }
    const duplicate = { name: 'duplicate' }
    slot.adopt(live)
    slot.release(duplicate)
    expect(slot.get()).toBe(live)
    slot.adopt(duplicate)
    slot.release(live)                    // the old one's exit, after a newer one was adopted
    expect(slot.get()).toBe(duplicate)
    expect(slot.take()).toBe(duplicate)
    expect(slot.get()).toBeNull()
    expect(slot.take()).toBeNull()
  })

  it('main.cjs runs startup through singleFlight and routes activate and second-instance through reopenAction', () => {
    const main = readFileSync(join(ROOT, 'electron/main.cjs'), 'utf8')
    expect(main).toContain('singleFlight(startApp)')
    expect(main).toContain("app.on('activate', reopen)")
    expect(main).toContain("app.on('second-instance', reopen)")
    expect(main).not.toMatch(/(?<!function )\bstartApp\(\)/) // never called directly
    expect(main).toContain('server.release(child)')
  })

  it('the app window is the only page window: no hidden window loads the page without a query', () => {
    const main = readFileSync(join(ROOT, 'electron/main.cjs'), 'utf8')
    const loads = [...main.matchAll(/\.loadURL\(([^)]*)\)/g)].map(m => m[1])
    expect(loads).toEqual(['url', 'url', 'url'])
    expect(main).toContain("pageWith(`widget&mode=${mode}`)")
    expect(main).toContain("pageWith('toast')")
    expect(main).toContain("pageWith('qa')")
  })

  it('the widget is the only transparent window; the window and fullscreen modes are an ordinary window Windows can snap', () => {
    const main = readFileSync(join(ROOT, 'electron/main.cjs'), 'utf8')
    expect(main).toContain('transparent: isWidget')
    expect(main).toContain('maximizable: !isWidget')
    expect(main).toContain("const kindOf = (mode) => (mode === 'window' || mode === 'fullscreen' ? 'window' : 'widget')")
    // Fullscreen is the maximized window, kept in step with Windows' own maximize
    expect(main).toContain("win.on('maximize', () => { if (win === widgetWin) setModeQuietly('fullscreen') })")
    expect(main).toContain("win.on('unmaximize', () => { if (win === widgetWin) setModeQuietly('window') })")
  })
})
