'use strict'

// Feedback from inside the app: a line of text, a pin on the screen if wanted, and a
// picture of that spot if ticked. It goes to our Supabase as one row of a table anyone
// may add to but nobody can read through the API (supabase/feedback.sql); the picture
// goes to a private bucket next to it. Nothing is public, no account is needed. The page
// only hands over what the trainer wrote and where the pin went; the row is built here,
// so a page can never send anything else, or anywhere else.

const VIEWS = ['terminal', 'dex', 'box', 'today', 'rank', 'widget']
const LANGS = ['ko', 'en', 'ja']
const MAX_TEXT = 2000
const PICTURE_WIDTH = 1200 // wider pictures are scaled down before they go
const REQUEST_TIMEOUT_MS = 12_000

const clip = (s, n) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim()
  return v.length > n ? `${v.slice(0, n)}…` : v
}

/** The row for the feedback table; null when nothing was written. Unknown or long values are dropped or cut */
function composeFeedback({ text, context } = {}, app = {}) {
  const body = String(text ?? '').trim().slice(0, MAX_TEXT)
  if (!body) return null
  const c = context && typeof context === 'object' ? context : {}
  const ctx = {}
  if (VIEWS.includes(c.view)) ctx.view = c.view
  if (c.element) ctx.element = clip(c.element, 160)
  if (c.text) ctx.text = clip(c.text, 80)
  if (Number.isFinite(c.width) && Number.isFinite(c.height)) ctx.window = `${Math.round(c.width)}×${Math.round(c.height)}`
  return {
    source: 'app',
    body,
    lang: LANGS.includes(c.lang) ? c.lang : null,
    context: ctx,
    app_version: app.version ? clip(app.version, 32) : null,
    system: app.os ? clip(app.os, 120) : null,
  }
}

/** The same note as plain text, for the clipboard when sending did not work */
function feedbackText(row) {
  const lines = [row.body, '', '---', `From: app${row.app_version ? ` ${row.app_version}` : ''}`]
  if (row.context?.view) lines.push(`Screen: ${row.context.view}`)
  if (row.context?.element) lines.push(`Element: ${row.context.element}`)
  if (row.system) lines.push(`System: ${row.system}`)
  return lines.join('\n')
}

/**
 * Sends a row (and a JPEG picture) to Supabase with the public key. The picture goes
 * first; if it fails the text still goes, without it.
 * → { ok: true, attached } | { ok: false, reason: 'offline' | 'refused' | 'not-set-up' }
 */
function createFeedbackSender({ config, fetchImpl = globalThis.fetch, randomId = () => require('crypto').randomUUID() } = {}) {
  const base = String(config?.supabaseUrl ?? '').replace(/\/+$/, '')
  const key = config?.publishableKey
  return async function send(row, jpeg) {
    if (!base || !key) return { ok: false, reason: 'not-set-up' }
    const headers = { apikey: key, Authorization: `Bearer ${key}` }
    let imagePath = null
    if (jpeg && jpeg.length) {
      const name = `${new Date().toISOString().slice(0, 10)}/${randomId()}.jpg`
      try {
        const res = await fetchImpl(`${base}/storage/v1/object/feedback/${name}`, {
          method: 'POST',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { ...headers, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
          body: jpeg,
        })
        if (res.ok) imagePath = `feedback/${name}`
      } catch {}
    }
    try {
      const res = await fetchImpl(`${base}/rest/v1/feedback`, {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ ...row, image_path: imagePath }),
      })
      if (!res.ok) return { ok: false, reason: 'refused' }
      return { ok: true, attached: !!imagePath }
    } catch {
      return { ok: false, reason: 'offline' }
    }
  }
}

/** The part of the page to picture: whole pixels, inside the page, never empty */
function clampRect(rect, size) {
  const r = rect && typeof rect === 'object' ? rect : {}
  const W = Math.max(1, Math.floor(size?.width ?? 0))
  const H = Math.max(1, Math.floor(size?.height ?? 0))
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : 0)
  const x = Math.min(Math.max(0, n(r.x)), W - 1)
  const y = Math.min(Math.max(0, n(r.y)), H - 1)
  const width = Math.max(1, Math.min(n(r.width), W - x))
  const height = Math.max(1, Math.min(n(r.height), H - y))
  return { x, y, width, height }
}

/** The picture as a JPEG small enough for the bucket */
function pictureBytes(image) {
  if (!image || image.isEmpty?.()) return null
  const { width } = image.getSize?.() ?? { width: 0 }
  const fitted = width > PICTURE_WIDTH ? image.resize({ width: PICTURE_WIDTH, quality: 'good' }) : image
  return fitted.toJPEG(82)
}

/**
 * feedback:capture (rect) → a small picture of the spot for the preview, kept for
 * feedback:send ({ text, context, attach }) → the row (and picture) to Supabase;
 * feedback:copy ({ text, context }) → the note on the clipboard, when sending fails.
 */
function registerFeedbackIpc({ ipcMain, guard, clipboard, appInfo, send }) {
  const shots = new WeakMap() // webContents → the last picture taken there
  ipcMain.handle('feedback:capture', guard(async (rect, event) => {
    const wc = event.sender
    const [w, h] = wc.getOwnerBrowserWindow?.()?.getContentSize?.() ?? [0, 0]
    const image = await wc.capturePage(clampRect(rect, { width: w, height: h }))
    if (!image || image.isEmpty()) { shots.delete(wc); return null }
    shots.set(wc, image)
    return image.toDataURL()
  }))
  ipcMain.handle('feedback:send', guard(async (arg = {}, event) => {
    const row = composeFeedback(arg, appInfo())
    if (!row) return { ok: false, reason: 'empty' }
    const shot = arg.attach ? shots.get(event.sender) : null
    return send(row, shot ? pictureBytes(shot) : null)
  }))
  ipcMain.handle('feedback:copy', guard((arg = {}) => {
    const row = composeFeedback(arg, appInfo())
    if (!row) return { ok: false, reason: 'empty' }
    clipboard.writeText(feedbackText(row))
    return { ok: true }
  }))
}

module.exports = { composeFeedback, feedbackText, createFeedbackSender, clampRect, pictureBytes, registerFeedbackIpc }
