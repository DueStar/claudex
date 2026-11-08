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
const { DEFAULTS, sanitize, applyPatch, toastAllowed, inQuietHours, claudeArgs, createSettingsStore } = require('../electron/settings.cjs')

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
  })

  it('reads and writes its file; a broken file means the defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudex-settings-'))
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
