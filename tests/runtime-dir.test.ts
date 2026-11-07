/**
 * server/runtime-dir.cjs: ~/.agent-office (up to 1.3.7) is copied to ~/.claudex
 * once, never moved or deleted, and the old folder stays in use while the
 * copy has not happened, so the Pokédex can never go missing.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { runtimeDir, migrateRuntimeDir, envVar } = require('../server/runtime-dir.cjs')

const homes: string[] = []
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }) })
const home = () => { const h = mkdtempSync(join(tmpdir(), 'claudex-home-')); homes.push(h); return h }
const quiet = { log: () => {}, error: () => {} }
const noEnv = {}

function legacyGame(h: string) {
  const old = join(h, '.agent-office')
  mkdirSync(join(old, 'sprites', 'icon'), { recursive: true })
  writeFileSync(join(old, 'pokedex.json'), JSON.stringify({ version: 2, caught: { 25: { count: 3 } } }))
  writeFileSync(join(old, 'auth-token'), 'a'.repeat(64))
  writeFileSync(join(old, 'sprites', 'icon', '25.png'), 'png')
  return old
}

describe('the data folder', () => {
  it('copies ~/.agent-office to ~/.claudex once, keeping the old folder with a note', () => {
    const h = home()
    const old = legacyGame(h)
    expect(runtimeDir(noEnv, h)).toBe(old) // before the copy, the old folder is the one in use
    expect(migrateRuntimeDir({ env: noEnv, home: h, log: quiet })).toBe('copied')
    const now = join(h, '.claudex')
    expect(runtimeDir(noEnv, h)).toBe(now)
    expect(JSON.parse(readFileSync(join(now, 'pokedex.json'), 'utf8')).caught[25].count).toBe(3)
    expect(readFileSync(join(now, 'auth-token'), 'utf8')).toBe('a'.repeat(64))
    expect(existsSync(join(now, 'sprites', 'icon', '25.png'))).toBe(true)
    // Nothing moved or deleted
    expect(existsSync(join(old, 'pokedex.json'))).toBe(true)
    expect(readFileSync(join(old, 'MOVED-TO-CLAUDEX.txt'), 'utf8')).toContain(now)
    // Once is enough: a later start leaves both alone
    writeFileSync(join(now, 'pokedex.json'), '{"version":2,"newer":true}')
    expect(migrateRuntimeDir({ env: noEnv, home: h, log: quiet })).toBe('present')
    expect(readFileSync(join(now, 'pokedex.json'), 'utf8')).toContain('newer')
  })

  it('does nothing on a new PC, and uses ~/.claudex', () => {
    const h = home()
    expect(migrateRuntimeDir({ env: noEnv, home: h, log: quiet })).toBe('nothing')
    expect(runtimeDir(noEnv, h)).toBe(join(h, '.claudex'))
  })

  it('leaves a folder the user chose alone (CLAUDEX_HOME, or AGENT_OFFICE_HOME from older setups)', () => {
    const h = home()
    legacyGame(h)
    expect(migrateRuntimeDir({ env: { CLAUDEX_HOME: '/x' }, home: h, log: quiet })).toBe('custom')
    expect(existsSync(join(h, '.claudex'))).toBe(false)
    expect(runtimeDir({ CLAUDEX_HOME: '/x', AGENT_OFFICE_HOME: '/y' }, h)).toBe('/x')
    expect(runtimeDir({ AGENT_OFFICE_HOME: '/y' }, h)).toBe('/y')
  })

  it('a failed copy leaves no half folder, and the old one stays in use', () => {
    const h = home()
    legacyGame(h)
    const errors: string[] = []
    const real = require('node:fs').cpSync
    require('node:fs').cpSync = () => { throw new Error('disk full') }
    try {
      expect(migrateRuntimeDir({ env: noEnv, home: h, log: { log: () => {}, error: (m: string) => errors.push(m) } })).toBe('failed')
    } finally {
      require('node:fs').cpSync = real
    }
    expect(errors[0]).toContain('disk full')
    expect(existsSync(join(h, '.claudex'))).toBe(false)
    expect(runtimeDir(noEnv, h)).toBe(join(h, '.agent-office'))
  })

  it('reads CLAUDEX_* first, then AGENT_OFFICE_*', () => {
    expect(envVar('PORT', { CLAUDEX_PORT: '1', AGENT_OFFICE_PORT: '2' })).toBe('1')
    expect(envVar('PORT', { AGENT_OFFICE_PORT: '2' })).toBe('2')
    expect(envVar('PORT', {})).toBe('')
  })
})
