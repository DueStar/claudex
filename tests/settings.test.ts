/**
 * electron/settings.cjs — the 설정 values: checked on the way in, the
 * notification filter, claude's extra arguments, the file.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { DEFAULTS, SCROLLBACKS, sanitize, applyPatch, toastAllowed, inQuietHours, claudeArgs, createSettingsStore } = require('../electron/settings.cjs')

const at = (hh: number, mm = 0) => new Date(2026, 10, 8, hh, mm)

describe('settings', () => {
  it('keeps the shape of the defaults: unknown keys dropped, wrong types and values fall back', () => {
    const s = sanitize({ notify: { flee: 'no', duration: 'forever', quietFrom: '25:00', extra: 1 }, session: { model: 'gpt', permissionMode: 'bypassPermissions' }, hacker: {} })
    expect(s).toEqual(DEFAULTS)
    expect(sanitize(null)).toEqual(DEFAULTS)
  })

  it('a patch changes only what it names', () => {
    const s = applyPatch(sanitize(null), { notify: { flee: false }, session: { model: 'sonnet' } })
    expect(s.notify.flee).toBe(false)
    expect(s.notify.catch).toBe(true)
    expect(s.session.model).toBe('sonnet')
    // a bad value in a later patch keeps the current one, not the default
    expect(applyPatch(s, { session: { model: 'nope' } }).session.model).toBe('sonnet')
  })

  it('filters notifications by kind, rarity and quiet hours', () => {
    const s = sanitize(null)
    const common = { kind: 'catch', tier: 'common', shiny: false }
    expect(toastAllowed(common, s, at(12))).toBe(true)
    expect(toastAllowed({ kind: 'sendout' }, s, at(12))).toBe(false)
    expect(toastAllowed({ kind: 'flee', tier: 'common' }, applyPatch(s, { notify: { flee: false } }), at(12))).toBe(false)
    const rare = applyPatch(s, { notify: { rareOnly: true } })
    expect(toastAllowed(common, rare, at(12))).toBe(false)
    expect(toastAllowed({ ...common, shiny: true }, rare, at(12))).toBe(true)
    expect(toastAllowed({ ...common, tier: 'rare' }, rare, at(12))).toBe(true)
    expect(toastAllowed({ kind: 'levelup' }, rare, at(12))).toBe(true) // rarity is for catches and escapes
    const quiet = applyPatch(s, { notify: { quiet: true, quietFrom: '23:00', quietTo: '08:00' } })
    expect(toastAllowed(common, quiet, at(23, 30))).toBe(false)
    expect(toastAllowed(common, quiet, at(7, 59))).toBe(false)
    expect(toastAllowed(common, quiet, at(8, 0))).toBe(true)
    expect(inQuietHours({ ...quiet.notify, quietFrom: '13:00', quietTo: '14:00' }, at(13, 30))).toBe(true)
    expect(inQuietHours({ ...quiet.notify, quietFrom: '13:00', quietTo: '14:00' }, at(14, 0))).toBe(false)
  })

  it('turns the session settings into claude arguments', () => {
    expect(claudeArgs(DEFAULTS.session)).toEqual([])
    expect(claudeArgs({ ...DEFAULTS.session, model: 'opus', permissionMode: 'plan' })).toEqual(['--model', 'opus', '--permission-mode', 'plan'])
    expect(applyPatch(sanitize(null), { session: { permissionMode: 'auto' } }).session.permissionMode).toBe('auto')
  })

  it('a saved 50000-line scrollback (the choice before 10000 became the most) becomes 10000', () => {
    expect(sanitize({ terminal: { scrollback: 50000, font: 'default' } }).terminal.scrollback).toBe(10000)
  })

  it('checks the terminal settings: scrollback from its list, a known font', () => {
    expect(DEFAULTS.terminal).toEqual({ scrollback: 5000, font: 'default' })
    const s = applyPatch(sanitize(null), { terminal: { scrollback: 10000, font: 'd2coding' } })
    expect(s.terminal).toEqual({ scrollback: 10000, font: 'd2coding' })
    expect(applyPatch(s, { terminal: { font: 'cascadia' } }).terminal).toEqual({ scrollback: 10000, font: 'cascadia' })
    // a number off the list, a string number, a negative, an unknown or CSS font: the current value stays
    for (const bad of [{ scrollback: 1234 }, { scrollback: '10000' }, { scrollback: -1 }, { scrollback: Infinity }, { font: 'Comic Sans' }, { font: "x'; }" }, { font: 3 }]) {
      expect(applyPatch(s, { terminal: bad }).terminal).toEqual(s.terminal)
    }
    expect(sanitize({ terminal: { scrollback: 999999, font: 'Arial', extra: true } }).terminal).toEqual(DEFAULTS.terminal)
    for (const n of [1000, 5000, 10000]) expect(applyPatch(s, { terminal: { scrollback: n } }).terminal.scrollback).toBe(n)
    expect(SCROLLBACKS).toEqual([1000, 5000, 10000])
    for (const f of ['default', 'consolas', 'cascadia', 'd2coding']) expect(applyPatch(s, { terminal: { font: f } }).terminal.font).toBe(f)
  })

  it('reads and writes its file; a broken file means the defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spawn-settings-'))
    const file = join(dir, 'settings.json')
    const store = createSettingsStore(file)
    expect(store.get()).toEqual(DEFAULTS)
    store.set({ app: { startHidden: true } })
    expect(JSON.parse(readFileSync(file, 'utf8')).app.startHidden).toBe(true)
    expect(createSettingsStore(file).get().app.startHidden).toBe(true)
    writeFileSync(file, '{ broken')
    expect(createSettingsStore(file).get()).toEqual(DEFAULTS)
  })
})

describe('terminal font per platform', () => {
  it('keeps the stored value consolas but shows and renders Menlo on a Mac', async () => {
    const { termFontStack, termFontLabel, TERM_FONT_STACKS } = await import('../src/termFont')
    expect(termFontLabel('consolas', true)).toBe('Menlo')
    expect(termFontLabel('consolas', false)).toBe('Consolas')
    expect(termFontStack('consolas', true).startsWith("Menlo, 'SF Mono', ")).toBe(true)
    expect(termFontStack('consolas', true)).not.toContain('Consolas')
    // Windows: unchanged choice, still led by Consolas
    expect(termFontStack('consolas', false)).toBe(TERM_FONT_STACKS.consolas)
    expect(TERM_FONT_STACKS.consolas.startsWith("Consolas, 'Pretendard Variable', 'Malgun Gothic', ")).toBe(true)
    // the other fonts are the same on both platforms
    for (const f of ['default', 'cascadia', 'd2coding'] as const) {
      expect(termFontStack(f, true)).toBe(termFontStack(f, false))
      expect(termFontLabel(f, true)).toBe(termFontLabel(f, false))
    }
  })

  it('appends the macOS faces after the Windows ones, never before', async () => {
    const { TERM_FONT_STACKS } = await import('../src/termFont')
    for (const s of Object.values(TERM_FONT_STACKS)) {
      expect(s.indexOf("'Apple SD Gothic Neo'")).toBeGreaterThan(s.indexOf("'Malgun Gothic'"))
      expect(s.endsWith(", monospace")).toBe(true)
    }
  })
})
