/**
 * electron/userDataMigration.cjs: the app's own folder (%APPDATA%\Claudex) is
 * copied to its new name (%APPDATA%\spawn) once, caches and update markers
 * left behind, nothing moved or deleted.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { migrateUserData } = require('../electron/userDataMigration.cjs')

const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
const quiet = { log: () => {}, error: () => {} }

function oldFolder() {
  const root = mkdtempSync(join(tmpdir(), 'spawn-appdata-')); roots.push(root)
  const from = join(root, 'Claudex')
  mkdirSync(join(from, 'Local Storage', 'leveldb'), { recursive: true })
  mkdirSync(join(from, 'session-links'), { recursive: true })
  mkdirSync(join(from, 'Code Cache', 'js'), { recursive: true })
  mkdirSync(join(from, 'GPUCache'), { recursive: true })
  writeFileSync(join(from, 'settings.json'), '{"app":{"language":"ko"}}')
  writeFileSync(join(from, 'window-state.json'), '{"widgetBounds":{"x":1}}')
  writeFileSync(join(from, 'session-links', 'a.json'), '{}')
  writeFileSync(join(from, 'Local Storage', 'leveldb', '000003.log'), 'spawn-carry')
  writeFileSync(join(from, 'Code Cache', 'js', 'x'), 'cache')
  writeFileSync(join(from, 'pending-update.json'), '{"staged":"x"}')
  return { root, from, to: join(root, 'spawn') }
}

describe('migrateUserData', () => {
  it('copies settings, window place, sessions and page storage; leaves caches and the update marker', () => {
    const { from, to } = oldFolder()
    expect(migrateUserData({ from, to, log: quiet })).toBe('copied')
    expect(readFileSync(join(to, 'settings.json'), 'utf8')).toContain('"ko"')
    expect(existsSync(join(to, 'window-state.json'))).toBe(true)
    expect(existsSync(join(to, 'session-links', 'a.json'))).toBe(true)
    expect(existsSync(join(to, 'Local Storage', 'leveldb', '000003.log'))).toBe(true)
    expect(existsSync(join(to, 'Code Cache'))).toBe(false)
    expect(existsSync(join(to, 'GPUCache'))).toBe(false)
    expect(existsSync(join(to, 'pending-update.json'))).toBe(false)
    // nothing moved or deleted, a note left behind
    expect(existsSync(join(from, 'settings.json'))).toBe(true)
    expect(readFileSync(join(from, 'MOVED-TO-SPAWN.txt'), 'utf8')).toContain(to)
  })

  it('only once: an existing new folder is never touched', () => {
    const { from, to } = oldFolder()
    mkdirSync(to)
    writeFileSync(join(to, 'settings.json'), '{"newer":true}')
    expect(migrateUserData({ from, to, log: quiet })).toBe('present')
    expect(readFileSync(join(to, 'settings.json'), 'utf8')).toContain('newer')
  })

  it('a new PC has nothing to copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'spawn-appdata-')); roots.push(root)
    expect(migrateUserData({ from: join(root, 'Claudex'), to: join(root, 'spawn'), log: quiet })).toBe('nothing')
  })

  it('a failed copy leaves no half folder and never throws', () => {
    const { from, to } = oldFolder()
    const fs = require('node:fs')
    const real = fs.cpSync
    fs.cpSync = () => { throw new Error('disk full') }
    try {
      expect(migrateUserData({ from, to, log: quiet })).toBe('failed')
    } finally {
      fs.cpSync = real
    }
    expect(existsSync(to)).toBe(false)
  })
})
