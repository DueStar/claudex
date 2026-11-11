/**
 * The small status card shown while spawn updates or starts
 * (electron/statusCard.cjs): where it goes, its page link, its window.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { cardBounds, cardUrl, openStatusCard } = require('../electron/statusCard.cjs')

const workArea = { x: 0, y: 0, width: 1920, height: 1040 }

describe('cardBounds', () => {
  it('centres the card on the app window', () => {
    expect(cardBounds({ x: 100, y: 100, width: 1200, height: 760 }, workArea)).toEqual({ x: 550, y: 432, width: 300, height: 96 })
  })
  it('centres on the work area when there is no window to go by', () => {
    expect(cardBounds(null, workArea)).toEqual({ x: 810, y: 472, width: 300, height: 96 })
  })
  it('stays inside the work area', () => {
    const b = cardBounds({ x: 1800, y: 1000, width: 400, height: 300 }, workArea)
    expect(b.x + b.width).toBeLessThanOrEqual(workArea.x + workArea.width)
    expect(b.y + b.height).toBeLessThanOrEqual(workArea.y + workArea.height)
  })
})

describe('cardUrl', () => {
  it('is a file link with the step and language', () => {
    const url = cardUrl('C:\\a\\status-card.html', 'updating', 'ja')
    expect(url.startsWith('file:///')).toBe(true)
    expect(url.endsWith('?step=updating&lang=ja')).toBe(true)
  })
})

describe('cardLang', () => {
  it('uses the setting, else the system language, else English', () => {
    const { cardLang } = require('../electron/statusCard.cjs')
    expect(cardLang('ja', 'ko-KR')).toBe('ja')
    expect(cardLang('auto', 'ko-KR')).toBe('ko')
    expect(cardLang('auto', 'ja')).toBe('ja')
    expect(cardLang('auto', 'fr-FR')).toBe('en')
    expect(cardLang(undefined, '')).toBe('en')
  })
})

describe('openStatusCard', () => {
  function fakeWindowClass() {
    const made: any[] = []
    class FakeWindow {
      opts: any
      destroyed = false
      destroyCalls = 0
      loaded: string | null = null
      handlers: Record<string, () => void> = {}
      constructor(opts: any) { this.opts = opts; made.push(this) }
      loadURL(u: string) { this.loaded = u; return Promise.resolve() }
      once(ev: string, fn: () => void) { this.handlers[ev] = fn }
      on(ev: string, fn: () => void) { this.handlers[ev] = fn }
      show() {}
      showInactive() {}
      isDestroyed() { return this.destroyed }
      destroy() { this.destroyCalls++; this.destroyed = true }
    }
    return { FakeWindow, made }
  }
  const screen = { getPrimaryDisplay: () => ({ workArea }), getDisplayMatching: () => ({ workArea }) }

  it('opens a quiet frameless window: no taskbar entry, no focus, hidden until painted', () => {
    const { FakeWindow, made } = fakeWindowClass()
    openStatusCard({ BrowserWindow: FakeWindow, screen, near: null, step: 'starting', lang: 'ko' })
    expect(made).toHaveLength(1)
    expect(made[0].opts).toMatchObject({ skipTaskbar: true, focusable: false, frame: false, transparent: true, show: false, width: 300, height: 96 })
    expect(made[0].loaded).toContain('step=starting&lang=ko')
  })

  it('close() is safe to call twice and after the window is gone', () => {
    const { FakeWindow, made } = fakeWindowClass()
    const card = openStatusCard({ BrowserWindow: FakeWindow, screen, near: null, step: 'updating', lang: 'en' })
    card.close()
    card.close()
    expect(made[0].destroyCalls).toBe(1)
    const card2 = openStatusCard({ BrowserWindow: FakeWindow, screen, near: null, step: 'updating', lang: 'en' })
    made[1].destroyed = true
    card2.close()
    expect(made[1].destroyCalls).toBe(0)
  })
})
