/**
 * server/runtime-dir.cjs: ~/.agent-office (up to 1.3.7) is copied to ~/.spawn
 * once, never moved or deleted, and the old folder stays in use while the
 * copy has not happened, so the Pokédex can never go missing.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { runtimeDir, migrateRuntimeDir, envVar, adoptLegacyEnv } = require('../server/runtime-dir.cjs')

const homes: string[] = []
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }) })
const home = () => { const h = mkdtempSync(join(tmpdir(), 'spawn-home-')); homes.push(h); return h }
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
  it('copies ~/.agent-office to ~/.spawn once, keeping the old folder with a note', () => {
    const h = home()
    const old = legacyGame(h)
    expect(runtimeDir(noEnv, h)).toBe(old) // before the copy, the old folder is the one in use
    expect(migrateRuntimeDir({ env: noEnv, home: h, log: quiet })).toBe('copied')
    const now = join(h, '.spawn')
    expect(runtimeDir(noEnv, h)).toBe(now)
    expect(JSON.parse(readFileSync(join(now, 'pokedex.json'), 'utf8')).caught[25].count).toBe(3)
    expect(readFileSync(join(now, 'auth-token'), 'utf8')).toBe('a'.repeat(64))
    expect(existsSync(join(now, 'sprites', 'icon', '25.png'))).toBe(true)
    // Nothing moved or deleted
    expect(existsSync(join(old, 'pokedex.json'))).toBe(true)
    expect(readFileSync(join(old, 'MOVED-TO-SPAWN.txt'), 'utf8')).toContain(now)
    // Once is enough: a later start leaves both alone
    writeFileSync(join(now, 'pokedex.json'), '{"version":2,"newer":true}')
    expect(migrateRuntimeDir({ env: noEnv, home: h, log: quiet })).toBe('present')
    expect(readFileSync(join(now, 'pokedex.json'), 'utf8')).toContain('newer')
  })

  it('does nothing on a new PC, and uses ~/.spawn', () => {
    const h = home()
    expect(migrateRuntimeDir({ env: noEnv, home: h, log: quiet })).toBe('nothing')
    expect(runtimeDir(noEnv, h)).toBe(join(h, '.spawn'))
  })

  it('leaves a folder the user chose alone (SPAWN_HOME)', () => {
    const h = home()
    legacyGame(h)
    expect(migrateRuntimeDir({ env: { SPAWN_HOME: '/x' }, home: h, log: quiet })).toBe('custom')
    expect(existsSync(join(h, '.spawn'))).toBe(false)
    expect(runtimeDir({ SPAWN_HOME: '/x' }, h)).toBe('/x')
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
    expect(existsSync(join(h, '.spawn'))).toBe(false)
    expect(runtimeDir(noEnv, h)).toBe(join(h, '.agent-office'))
  })

  it('reads SPAWN_<name>, else the older CLAUDEX_<name> (the AGENT_OFFICE_ names are gone)', () => {
    expect(envVar('PORT', { SPAWN_PORT: '1' })).toBe('1')
    expect(envVar('PORT', { CLAUDEX_PORT: '3' })).toBe('3')
    expect(envVar('PORT', { SPAWN_PORT: '1', CLAUDEX_PORT: '3' })).toBe('1')
    expect(envVar('PORT', { AGENT_OFFICE_PORT: '2' })).toBe('')
    expect(envVar('PORT', {})).toBe('')
  })

  it('an old CLAUDEX_ setting is carried over to its SPAWN_ name, a SPAWN_ one is never overwritten', () => {
    const env: Record<string, string> = { CLAUDEX_PORT: '4000', CLAUDEX_HOME: '/old', SPAWN_HOME: '/new', OTHER: 'x' }
    adoptLegacyEnv(env)
    expect(env.SPAWN_PORT).toBe('4000')
    expect(env.SPAWN_HOME).toBe('/new')
    expect(env.OTHER).toBe('x')
  })

  it('copies ~/.claudex (the folder until 1.3.35) to ~/.spawn, ahead of an even older ~/.agent-office', () => {
    const h = home()
    legacyGame(h) // ~/.agent-office with 3 Pikachu
    const claudex = join(h, '.claudex')
    mkdirSync(claudex)
    writeFileSync(join(claudex, 'pokedex.json'), JSON.stringify({ version: 2, caught: { 25: { count: 9 } } }))
    expect(runtimeDir(noEnv, h)).toBe(claudex)
    expect(migrateRuntimeDir({ env: noEnv, home: h, log: quiet })).toBe('copied')
    expect(JSON.parse(readFileSync(join(h, '.spawn', 'pokedex.json'), 'utf8')).caught[25].count).toBe(9)
    expect(existsSync(join(claudex, 'MOVED-TO-SPAWN.txt'))).toBe(true)
    expect(runtimeDir(noEnv, h)).toBe(join(h, '.spawn'))
  })

  it('a folder chosen with the old CLAUDEX_HOME is still the one used', () => {
    expect(runtimeDir({ CLAUDEX_HOME: '/x' }, home())).toBe('/x')
  })
})
