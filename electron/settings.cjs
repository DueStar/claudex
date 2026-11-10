/**
 * settings.cjs — the app's settings (the 설정 screen): one JSON file in the
 * app's data folder, read and written by the main process only. Every window
 * gets the same copy (settings:get, and settings:changed on each change), so
 * the widget, the window and the notification window never disagree.
 *
 * Everything that comes in is checked against DEFAULTS: unknown keys are
 * dropped, a wrong type falls back to the default.
 */

const fs = require('fs')
const path = require('path')
const { validTool } = require('./adapters.cjs')

const MODELS = ['', 'opus', 'sonnet', 'haiku']                 // '' = Claude Code's own default
const PERMISSION_MODES = ['', 'default', 'acceptEdits', 'plan', 'auto'] // Claude Code's names; never bypassPermissions from a menu
const DURATIONS = { short: 0.6, normal: 1, long: 1.6 }
const SCROLLBACKS = [1000, 5000, 10000, 50000]                 // lines a terminal keeps above the screen
const TERMINAL_FONTS = ['default', 'consolas', 'cascadia', 'd2coding'] // the stacks are in src/termFont.ts

const DEFAULTS = Object.freeze({
  notify: {
    catch: true, flee: true, evolve: true, levelup: true,
    rareOnly: false,          // catches and escapes: rare and above, or shiny
    duration: 'normal',       // short | normal | long
    quiet: false, quietFrom: '23:00', quietTo: '08:00', // no notifications in these hours
    sound: true,              // a short sound with each card (src/sounds.ts)
    sessions: true,           // a Windows notification when a session finishes or needs you while the app is behind
  },
  privacy: { hidePrompts: false }, // the catch story without the request text
  // restoreOnStart: reopen the sessions open at the last close. tools: other AI tools a session can run
  // ({ id, name, command }, Claude Code is always there), defaultTool: the one + opens with
  session: { defaultCwd: '', model: '', permissionMode: '', confirmClose: true, restoreOnStart: true, tools: [], defaultTool: 'claude' },
  app: { openAtLogin: false, startHidden: false, widgetOnTop: true, language: 'auto' }, // auto: the system's language
  // the terminals' look, applied to open terminals at once (the text size stays per PC: src/termFont.ts)
  terminal: { scrollback: 5000, font: 'default' },
})

const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const CHECKS = {
  'notify.duration': (v) => Object.hasOwn(DURATIONS, v),
  'notify.quietFrom': isTime,
  'notify.quietTo': isTime,
  'session.model': (v) => MODELS.includes(v),
  'session.permissionMode': (v) => PERMISSION_MODES.includes(v),
  'session.defaultCwd': (v) => typeof v === 'string' && v.length < 1024,
  'session.tools': (v) => Array.isArray(v) && v.length <= 12 && v.every(validTool) && new Set(v.map(t => t.id)).size === v.length,
  'session.defaultTool': (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,23}$/.test(v),
  'app.language': (v) => ['auto', 'ko', 'en', 'ja'].includes(v),
  'terminal.scrollback': (v) => SCROLLBACKS.includes(v),
  'terminal.font': (v) => TERMINAL_FONTS.includes(v),
}

/** `input` made safe: the shape and types of DEFAULTS, `base` for what it leaves out */
function sanitize(input, base = DEFAULTS) {
  const out = {}
  for (const [group, fields] of Object.entries(DEFAULTS)) {
    out[group] = {}
    for (const [key, def] of Object.entries(fields)) {
      const v = input?.[group]?.[key]
      const check = CHECKS[`${group}.${key}`]
      const ok = v !== undefined && typeof v === typeof def && (!check || check(v))
      // (the one list, session.tools, is kept to its three fields)
      out[group][key] = ok ? (Array.isArray(v) ? v.map(x => ({ id: x.id, name: x.name.trim(), command: x.command.trim() })) : v) : (base?.[group]?.[key] ?? def)
    }
  }
  return out
}

/** `patch` laid over `current` ({ notify: { flee: false } } changes only that) */
function applyPatch(current, patch) {
  const merged = {}
  for (const group of Object.keys(DEFAULTS)) merged[group] = { ...current[group], ...(patch?.[group] ?? {}) }
  return sanitize(merged, current)
}

const minutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/** Inside the quiet hours (they may wrap past midnight: 23:00 → 08:00) */
function inQuietHours(notify, date = new Date()) {
  if (!notify.quiet) return false
  const now = date.getHours() * 60 + date.getMinutes()
  const from = minutesOf(notify.quietFrom)
  const to = minutesOf(notify.quietTo)
  if (from === to) return false
  return from < to ? now >= from && now < to : now >= from || now < to
}

const RARE = new Set(['rare', 'sub', 'legendary', 'mythical'])

/** Whether a game event pops up as a notification under these settings */
function toastAllowed(event, settings, date = new Date()) {
  const n = settings.notify
  const kind = event?.kind
  if (!['catch', 'flee', 'evolve', 'levelup'].includes(kind) || !n[kind]) return false
  if (n.rareOnly && (kind === 'catch' || kind === 'flee') && !RARE.has(event.tier) && !event.shiny) return false
  return !inQuietHours(n, date)
}

/** The extra claude arguments the session settings ask for */
function claudeArgs(session) {
  const args = []
  if (session.model) args.push('--model', session.model)
  if (session.permissionMode) args.push('--permission-mode', session.permissionMode)
  return args
}

/** The settings file: read once, written on each change */
function createSettingsStore(file) {
  let current = sanitize(null)
  try { current = sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch { /* first run, or a broken file: the defaults */ }
  return {
    get: () => current,
    set(patch) {
      current = applyPatch(current, patch)
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(current, null, 2))
      } catch (err) { console.error('[settings] could not save:', err.message) }
      return current
    },
  }
}

module.exports = { DEFAULTS, DURATIONS, MODELS, PERMISSION_MODES, SCROLLBACKS, TERMINAL_FONTS, sanitize, applyPatch, inQuietHours, toastAllowed, claudeArgs, createSettingsStore }
