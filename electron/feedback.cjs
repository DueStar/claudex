'use strict'

// Feedback from inside the app: a pin on the screen, a line of text, and a new
// GitHub issue on our own repo with it filled in. The page only hands over what
// the trainer wrote and where the pin went; the link itself is built here, so a
// page can never make the app open any other address. A picture of the spot
// goes on the clipboard (a new-issue link cannot carry one) for a Ctrl+V.

const REPO = 'DueStar/spawn'
const KINDS = { fix: 'Please fix', add: 'Please add', direction: 'A direction', like: 'What I liked' }
const VIEWS = ['terminal', 'dex', 'box', 'today', 'rank', 'widget']
const MAX_TEXT = 2000

const clip = (s, n) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim()
  return v.length > n ? `${v.slice(0, n)}…` : v
}
const cell = (s) => String(s).replace(/\|/g, '\\|')

/** Title and body of the issue; anything unknown or too long is dropped or cut */
function composeIssue({ kind, text, context } = {}, app = {}) {
  const k = KINDS[kind] ? kind : 'fix'
  const body = String(text ?? '').trim().slice(0, MAX_TEXT)
  if (!body) return null
  const first = body.split('\n')[0]
  const title = `[feedback] ${KINDS[k]}: ${first.length > 60 ? `${first.slice(0, 60)}…` : first}`
  const c = context && typeof context === 'object' ? context : {}
  const rows = [
    ['Kind', KINDS[k]],
    ['From', 'app'],
    VIEWS.includes(c.view) ? ['Screen', c.view] : null,
    c.element ? ['Element', `\`${clip(c.element, 160).replace(/`/g, '')}\``] : null,
    c.text ? ['Text there', clip(c.text, 80)] : null,
    Number.isFinite(c.width) && Number.isFinite(c.height) ? ['Window', `${Math.round(c.width)}×${Math.round(c.height)}`] : null,
    ['Language', ['ko', 'en', 'ja'].includes(c.lang) ? c.lang : '?'],
    app.version ? ['App version', app.version] : null,
    app.os ? ['System', app.os] : null,
  ].filter(Boolean)
  const table = `| | |\n|---|---|\n${rows.map(([a, b]) => `| ${a} | ${cell(b)} |`).join('\n')}\n`
  const paste = c.attach ? '\n<!-- The picture of this spot is on your clipboard: press Ctrl+V here to add it. -->\n' : ''
  return { title, body: `${body}\n${paste}\n---\n\n${table}` }
}

function issueUrl(issue) {
  return `https://github.com/${REPO}/issues/new?labels=feedback&title=${encodeURIComponent(issue.title)}&body=${encodeURIComponent(issue.body)}`
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

/**
 * feedback:capture (rect) → a small picture of the spot for the preview, kept
 * for feedback:send; feedback:send / feedback:copy ({ kind, text, context }).
 */
function registerFeedbackIpc({ ipcMain, guard, shell, clipboard, appInfo }) {
  const shots = new WeakMap() // webContents → the last picture taken there
  ipcMain.handle('feedback:capture', guard(async (rect, event) => {
    const wc = event.sender
    const [w, h] = wc.getOwnerBrowserWindow?.()?.getContentSize?.() ?? [0, 0]
    const image = await wc.capturePage(clampRect(rect, { width: w, height: h }))
    if (!image || image.isEmpty()) { shots.delete(wc); return null }
    shots.set(wc, image)
    return image.toDataURL()
  }))
  ipcMain.handle('feedback:send', guard((arg = {}, event) => {
    const shot = arg.attach ? shots.get(event.sender) : null
    const issue = composeIssue({ ...arg, context: { ...(arg.context ?? {}), attach: !!shot } }, appInfo())
    if (!issue) return { ok: false, reason: 'empty' }
    if (shot) clipboard.writeImage(shot)
    shell.openExternal(issueUrl(issue))
    return { ok: true, attached: !!shot }
  }))
  ipcMain.handle('feedback:copy', guard((arg = {}) => {
    const issue = composeIssue({ ...arg, context: { ...(arg.context ?? {}), attach: false } }, appInfo())
    if (!issue) return { ok: false, reason: 'empty' }
    clipboard.writeText(`${issue.title}\n\n${issue.body}`)
    return { ok: true }
  }))
}

module.exports = { REPO, KINDS, composeIssue, issueUrl, clampRect, registerFeedbackIpc }
