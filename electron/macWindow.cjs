'use strict'

/**
 * electron/macWindow.cjs — the app window on macOS.
 *
 * The app is two windows, never both (main.cjs): the widget and an ordinary window for
 * the window and fullscreen modes. Moving between them builds the other one, so each
 * gets its own title bar at creation: the window the native traffic lights (inset, in
 * the room the page leaves at its top-left), the widget none (it has its own buttons).
 *
 * Fullscreen is the display's work area filled, not macOS's own full screen (a Space of
 * its own) and not its zoom (which toggles to a frame macOS keeps itself): the bounds
 * before are remembered here and put back for the window mode.
 *
 * The platform is a parameter so both sides can be tested on any OS; on Windows none of
 * these does anything.
 */

const { isMac } = require('./platform.cjs')

/** The BrowserWindow options a window of `mode` gets on macOS ({} elsewhere). */
function macWindowOptions(mode, platform = process.platform) {
  if (!isMac(platform)) return {}
  if (mode === 'widget') return { frame: false }
  return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }
}

// Each filled window's bounds from before the fill
const before = new WeakMap()

/** Fill the work area of the window's display; the bounds before are kept for restore. */
function fillWorkArea(win, screen, platform = process.platform) {
  if (!isMac(platform)) return false
  const b = win.getBounds()
  const { workArea } = screen.getDisplayMatching(b)
  if (!before.has(win)) before.set(win, b)
  win.setBounds({ x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height })
  return true
}

/** Put a filled window back where it was before the fill. */
function restore(win, platform = process.platform) {
  if (!isMac(platform)) return false
  const b = before.get(win)
  if (!b) return false
  before.delete(win)
  win.setBounds(b)
  return true
}

/** Filled by fillWorkArea and not restored since */
const isFilled = (win) => before.has(win)

/**
 * Switch one window between the fullscreen and the window mode. macOS's own full screen
 * (the green button) already is the fullscreen mode; the window mode leaves it. A window
 * zoomed by macOS (a double-click on the title area, Window › Zoom) is unzoomed.
 */
function applyMode(win, mode, screen, platform = process.platform) {
  if (!isMac(platform)) return false
  if (mode === 'fullscreen') {
    if (!win.isFullScreen() && !isFilled(win)) fillWorkArea(win, screen, platform)
  } else if (win.isFullScreen()) {
    win.setFullScreen(false)
  } else if (isFilled(win)) {
    restore(win, platform)
  } else if (win.isMaximized()) {
    win.unmaximize()
  }
  return true
}

/** The Dock icon: hidden while the app is the widget, shown in the other modes. */
function dockFor(mode, dock, platform = process.platform) {
  if (!isMac(platform) || !dock) return
  if (mode === 'widget') dock.hide()
  else Promise.resolve(dock.show()).catch(() => {})
}

module.exports = { macWindowOptions, fillWorkArea, restore, isFilled, applyMode, dockFor }
