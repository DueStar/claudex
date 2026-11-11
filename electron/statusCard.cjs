'use strict'

/**
 * statusCard.cjs — the small card on screen while Claudex updates or starts.
 *
 * An update restart goes through three processes (the old app quitting, a
 * short run that copies the new files, the new app starting), and a cold start
 * waits seconds for the server. Without this the screen is empty the whole
 * time. Each process shows the same card in the same place, centred where the
 * app window is, so the hand-overs read as one window.
 *
 * The card is a local page (status-card.html, no server needed), not in the
 * taskbar, never focused, and has nothing to click: closing it only closes it.
 */

const path = require('path')
const { pathToFileURL } = require('url')

const CARD = Object.freeze({ width: 300, height: 96 })
const PAGE = path.join(__dirname, 'status-card.html')

/** The card's bounds: centred on `near` (the app window) or the work area, kept inside the work area. */
function cardBounds(near, workArea) {
  const box = near ?? workArea
  let x = Math.round(box.x + box.width / 2 - CARD.width / 2)
  let y = Math.round(box.y + box.height / 2 - CARD.height / 2)
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - CARD.width))
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - CARD.height))
  return { x, y, width: CARD.width, height: CARD.height }
}

/** The card page's link for `step` ('updating' | 'starting') in `lang` ('ko' | 'en' | 'ja'). */
function cardUrl(htmlPath, step, lang) {
  return `${pathToFileURL(htmlPath).href}?step=${encodeURIComponent(step)}&lang=${encodeURIComponent(lang)}`
}

/**
 * Open the card. Returns { win, setStep, show, close }; close() can be called
 * any number of times, also after the window has gone.
 */
function openStatusCard({ BrowserWindow, screen, near = null, step = 'starting', lang = 'ko', htmlPath = PAGE }) {
  const { workArea } = near ? screen.getDisplayMatching(near) : screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    ...cardBounds(near, workArea),
    title: 'Claudex',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  let closed = false
  win.once('ready-to-show', () => { if (!closed && !win.isDestroyed()) win.showInactive() })
  win.on('closed', () => { closed = true })
  win.loadURL(cardUrl(htmlPath, step, lang)).catch(() => {})
  return {
    win,
    // Shown again (a second launch, the tray): also above windows that cover it
    show() { if (!closed && !win.isDestroyed()) { win.showInactive(); win.moveTop() } },
    setStep(next) {
      if (closed || win.isDestroyed()) return
      win.loadURL(cardUrl(htmlPath, next, lang)).catch(() => {})
    },
    close() {
      if (closed) return
      closed = true
      if (!win.isDestroyed()) win.destroy()
    },
  }
}

/** The card's language from 설정 › 앱 › 언어 ('auto' follows the system's). */
function cardLang(setting, locale = '') {
  if (setting === 'ko' || setting === 'en' || setting === 'ja') return setting
  const l = String(locale).toLowerCase()
  if (l.startsWith('ko')) return 'ko'
  if (l.startsWith('ja')) return 'ja'
  return 'en'
}

module.exports = { CARD, cardBounds, cardUrl, cardLang, openStatusCard }
