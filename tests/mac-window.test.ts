/**
 * The app window on macOS (electron/macWindow.cjs): the traffic lights in the window
 * and fullscreen modes, fullscreen as the display's work area filled (our own maximize),
 * the Dock hidden in widget mode. Each takes the platform, so both sides are tested on
 * any OS; on win32 none of them does anything.
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { macWindowOptions, fillWorkArea, restore, isFilled, applyMode, noteMode, dockFor, quitCapMs } = require('../electron/macWindow.cjs')
const ROOT = join(__dirname, '..')

type Bounds = { x: number, y: number, width: number, height: number }
function fakeWindow(bounds: Bounds, { fullScreen = false, maximized = false } = {}) {
  let b = { ...bounds }
  let fs = fullScreen
  return {
    getBounds: () => ({ ...b }),
    setBounds: vi.fn((next: Bounds) => { b = { ...next } }),
    isFullScreen: () => fs,
    setFullScreen: vi.fn((on: boolean) => { fs = on }),
    isMaximized: () => maximized,
    unmaximize: vi.fn(),
  }
}
const WORK = { x: 0, y: 25, width: 1440, height: 875 }
const fakeScreen = () => ({ getDisplayMatching: vi.fn(() => ({ workArea: { ...WORK } })) })
const fakeDock = () => ({ hide: vi.fn(), show: vi.fn(() => Promise.resolve()) })

describe('macWindowOptions', () => {
  it('window and fullscreen: a hidden title bar with the traffic lights inset', () => {
    for (const mode of ['window', 'fullscreen']) {
      expect(macWindowOptions(mode, 'darwin')).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } })
    }
  })
  it('widget: frameless, no traffic lights (it has its own buttons)', () => {
    expect(macWindowOptions('widget', 'darwin')).toEqual({ frame: false })
  })
  it('win32: nothing (the window keeps its own options)', () => {
    for (const mode of ['widget', 'window', 'fullscreen']) expect(macWindowOptions(mode, 'win32')).toEqual({})
  })
})

describe('fillWorkArea / restore', () => {
  it('fills the display work area, and restore puts the original bounds back', () => {
    const win = fakeWindow({ x: 100, y: 120, width: 1200, height: 760 })
    const screen = fakeScreen()
    expect(fillWorkArea(win, screen, 'darwin')).toBe(true)
    expect(screen.getDisplayMatching).toHaveBeenCalledWith({ x: 100, y: 120, width: 1200, height: 760 })
    expect(win.getBounds()).toEqual(WORK)
    expect(isFilled(win)).toBe(true)
    expect(restore(win, 'darwin')).toBe(true)
    expect(win.getBounds()).toEqual({ x: 100, y: 120, width: 1200, height: 760 })
    expect(isFilled(win)).toBe(false)
  })
  it('filling twice keeps the bounds from before the first fill', () => {
    const win = fakeWindow({ x: 10, y: 40, width: 800, height: 600 })
    fillWorkArea(win, fakeScreen(), 'darwin')
    fillWorkArea(win, fakeScreen(), 'darwin')
    restore(win, 'darwin')
    expect(win.getBounds()).toEqual({ x: 10, y: 40, width: 800, height: 600 })
  })
  it('restore without a fill does nothing', () => {
    const win = fakeWindow({ x: 1, y: 2, width: 3, height: 4 })
    expect(restore(win, 'darwin')).toBe(false)
    expect(win.setBounds).not.toHaveBeenCalled()
  })
  it('win32: neither runs', () => {
    const win = fakeWindow({ x: 100, y: 120, width: 1200, height: 760 })
    const screen = fakeScreen()
    expect(fillWorkArea(win, screen, 'win32')).toBe(false)
    expect(restore(win, 'win32')).toBe(false)
    expect(screen.getDisplayMatching).not.toHaveBeenCalled()
    expect(win.setBounds).not.toHaveBeenCalled()
  })
})

describe('applyMode (the window ↔ fullscreen switch of one window)', () => {
  it('fullscreen fills, window restores', () => {
    const win = fakeWindow({ x: 100, y: 120, width: 1200, height: 760 })
    applyMode(win, 'fullscreen', fakeScreen(), 'darwin')
    expect(win.getBounds()).toEqual(WORK)
    applyMode(win, 'window', fakeScreen(), 'darwin')
    expect(win.getBounds()).toEqual({ x: 100, y: 120, width: 1200, height: 760 })
  })
  it('native full screen (the green button): fullscreen leaves it alone, window leaves it', () => {
    const win = fakeWindow({ x: 0, y: 0, width: 1440, height: 900 }, { fullScreen: true })
    applyMode(win, 'fullscreen', fakeScreen(), 'darwin')
    expect(win.setBounds).not.toHaveBeenCalled()
    expect(win.setFullScreen).not.toHaveBeenCalled()
    applyMode(win, 'window', fakeScreen(), 'darwin')
    expect(win.setFullScreen).toHaveBeenCalledWith(false)
  })
  it('window mode after a zoom (not our fill): unzoom', () => {
    const win = fakeWindow({ x: 0, y: 25, width: 1440, height: 875 }, { maximized: true })
    applyMode(win, 'window', fakeScreen(), 'darwin')
    expect(win.unmaximize).toHaveBeenCalled()
  })
  it('win32: nothing', () => {
    const win = fakeWindow({ x: 100, y: 120, width: 1200, height: 760 }, { maximized: true })
    expect(applyMode(win, 'fullscreen', fakeScreen(), 'win32')).toBe(false)
    expect(applyMode(win, 'window', fakeScreen(), 'win32')).toBe(false)
    expect(win.setBounds).not.toHaveBeenCalled()
    expect(win.unmaximize).not.toHaveBeenCalled()
  })
})

describe('a fill left by another route (macOS zoom toggled off → unmaximize → window mode)', () => {
  it('is forgotten, so the place is saved again and a later fullscreen fills again', () => {
    const win = fakeWindow({ x: 100, y: 120, width: 1200, height: 760 })
    applyMode(win, 'fullscreen', fakeScreen(), 'darwin')
    expect(win.getBounds()).toEqual(WORK)
    // macOS puts the window somewhere else by itself; main hears unmaximize → window mode
    win.setBounds({ x: 200, y: 150, width: 900, height: 600 })
    noteMode(win, 'window', 'darwin')
    expect(isFilled(win)).toBe(false) // remember() saves the place again
    applyMode(win, 'fullscreen', fakeScreen(), 'darwin')
    expect(win.getBounds()).toEqual(WORK) // filled again, not a no-op
    applyMode(win, 'window', fakeScreen(), 'darwin')
    expect(win.getBounds()).toEqual({ x: 200, y: 150, width: 900, height: 600 })
  })
  it('a fullscreen request on a filled window fills again and keeps the first bounds', () => {
    const win = fakeWindow({ x: 100, y: 120, width: 1200, height: 760 })
    applyMode(win, 'fullscreen', fakeScreen(), 'darwin')
    win.setBounds({ x: 300, y: 300, width: 700, height: 500 }) // moved by hand
    applyMode(win, 'fullscreen', fakeScreen(), 'darwin')
    expect(win.getBounds()).toEqual(WORK)
    applyMode(win, 'window', fakeScreen(), 'darwin')
    expect(win.getBounds()).toEqual({ x: 100, y: 120, width: 1200, height: 760 })
  })
  it('noteMode: only the window mode forgets; win32 does nothing', () => {
    const win = fakeWindow({ x: 1, y: 2, width: 800, height: 600 })
    fillWorkArea(win, fakeScreen(), 'darwin')
    noteMode(win, 'fullscreen', 'darwin')
    expect(isFilled(win)).toBe(true)
    noteMode(win, 'window', 'win32')
    expect(isFilled(win)).toBe(true)
    noteMode(win, 'window', 'darwin')
    expect(isFilled(win)).toBe(false)
  })
})

describe('quitCapMs', () => {
  it('2 s only while macOS shuts down or logs out', () => {
    expect(quitCapMs({ platform: 'darwin', systemShutdown: true })).toBe(2000)
    expect(quitCapMs({ platform: 'darwin', systemShutdown: false })).toBeNull()
    expect(quitCapMs({ platform: 'win32', systemShutdown: true })).toBeNull()
    expect(quitCapMs({ platform: 'win32', systemShutdown: false })).toBeNull()
  })
})

describe('dockFor', () => {
  it('hides the Dock icon in widget mode and shows it otherwise', () => {
    const dock = fakeDock()
    dockFor('widget', dock, 'darwin')
    expect(dock.hide).toHaveBeenCalledTimes(1)
    expect(dock.show).not.toHaveBeenCalled()
    dockFor('window', dock, 'darwin')
    dockFor('fullscreen', dock, 'darwin')
    expect(dock.show).toHaveBeenCalledTimes(2)
  })
  it('win32 (or no dock): nothing', () => {
    const dock = fakeDock()
    dockFor('widget', dock, 'win32')
    dockFor('window', dock, 'win32')
    expect(dock.hide).not.toHaveBeenCalled()
    expect(dock.show).not.toHaveBeenCalled()
    expect(() => dockFor('widget', undefined, 'darwin')).not.toThrow()
  })
})

describe('the wiring (main.cjs, the page)', () => {
  const main = readFileSync(join(ROOT, 'electron/main.cjs'), 'utf8')

  it('every Mac call is behind darwin; the Windows window keeps frame: false and its maximize', () => {
    expect(main).toContain("...(process.platform === 'darwin' ? macWindowOptions(mode) : { frame: false }),")
    expect(main).toContain("if (mode === 'fullscreen' && !w.isMaximized()) w.maximize()")
    expect(main).toContain("if (mode === 'window' && w.isMaximized()) w.unmaximize()")
    expect(main).toContain("win.on('query-session-end', keepSessions)")
    expect(main).toContain("win.on('session-end', keepSessions)")
    expect(main).toContain("toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })")
  })

  it('macOS: native full screen keeps the mode, the widget and toast on all Spaces, the Dock follows the mode', () => {
    expect(main).toContain("win.on('enter-full-screen'")
    expect(main).toContain("win.on('leave-full-screen'")
    expect(main).toContain("setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })")
    expect(main).toContain("setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })")
    expect(main).toContain('dockFor(')
    expect(main).toContain("if (process.platform === 'darwin' && widgetWin && !widgetWin.isDestroyed()) noteMode(widgetWin, mode)")
  })

  it('macOS: a shutdown keeps the open sessions, and the quit sequence waits 2 s at most', () => {
    expect(main).toMatch(/powerMonitor\.on\('shutdown', [^\n]*macSystemEnding = true[^\n]*keepSessions\(\)/)
    expect(main).toContain('const cap = quitCapMs({ platform: process.platform, systemShutdown: macSystemEnding })')
    expect(main).toContain('quitSequence = (cap ? Promise.race([ending, sleep(cap)]) : ending)')
    expect(main).not.toContain('sleep(2000)]) : ending')
  })

  it('the page marks a Mac with is-mac; the Mac rules live under .is-mac', () => {
    const entry = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')
    expect(entry).toContain("if (isMac()) document.documentElement.classList.add('is-mac')")
    const css = readFileSync(join(ROOT, 'src/styles/widget-expanded.css'), 'utf8')
    expect(css).toContain('.is-mac .w-win-controls { display: none; }')
    expect(css).toMatch(/\.is-mac \.widget\.mode-window \.w-side \.w-head, \.is-mac \.widget\.mode-fullscreen \.w-side \.w-head \{ padding-left: 78px; \}/)
  })
})
