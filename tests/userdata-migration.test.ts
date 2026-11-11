/**
 * electron/userDataMigration.cjs: the app's own folder (%APPDATA%\Claudex) is
 * copied to its new name (%APPDATA%\spawn) until one copy has gone through,
 * caches and update markers left behind, nothing moved or deleted. A new
 * folder that is already there (a start whose copy failed made it) does not
 * count as done.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { migrateUserData, MARKER } = require('../electron/userDataMigration.cjs')
const realFs = require('node:fs')

const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

function oldFolder() {
  const root = mkdtempSync(join(tmpdir(), 'spawn-appdata-')); roots.push(root)
  const from = join(root, 'Claudex')
  mkdirSync(join(from, 'Local Storage', 'leveldb'), { recursive: true })
  mkdirSync(join(from, 'session-links'), { recursive: true })
  mkdirSync(join(from, 'Code Cache', 'js'), { recursive: true })
  mkdirSync(join(from, 'logs'), { recursive: true })
  writeFileSync(join(from, 'settings.json'), '{"app":{"language":"ko"}}')
  writeFileSync(join(from, 'window-state.json'), '{"sessionTitles":{"s1":"내 세션"}}')
  writeFileSync(join(from, 'open-sessions.json'), '[{"sessionId":"s1"}]')
  writeFileSync(join(from, 'session-links', 's1'), 'conv-1')
  writeFileSync(join(from, 'Local Storage', 'leveldb', '000003.log'), 'old-db')
  writeFileSync(join(from, 'Code Cache', 'js', 'x'), 'cache')
  writeFileSync(join(from, 'pending-update.json'), '{"staged":"x"}')
  writeFileSync(join(from, 'update.log'), 'p1 quit-start\np2 relaunch\n')
  writeFileSync(join(from, 'logs', 'claudex.log'), 'old log')
  return { root, from, to: join(root, 'spawn') }
}
const fast = { waitMs: 1, budgetMs: 20 }

describe('migrateUserData', () => {
  it('copies settings, window place, session names, open sessions and page storage; leaves caches, logs and the update marker', () => {
    const { from, to } = oldFolder()
    expect(migrateUserData({ from, to, ...fast }).status).toBe('copied')
    expect(readFileSync(join(to, 'settings.json'), 'utf8')).toContain('"ko"')
    expect(readFileSync(join(to, 'window-state.json'), 'utf8')).toContain('내 세션')
    expect(existsSync(join(to, 'open-sessions.json'))).toBe(true)
    expect(existsSync(join(to, 'session-links', 's1'))).toBe(true)
    expect(existsSync(join(to, 'Local Storage', 'leveldb', '000003.log'))).toBe(true)
    for (const left of ['Code Cache', 'pending-update.json', 'logs']) expect(existsSync(join(to, left))).toBe(false)
    expect(JSON.parse(readFileSync(join(to, MARKER), 'utf8')).done).toBe(true)
    // nothing moved or deleted, a note left behind
    expect(existsSync(join(from, 'settings.json'))).toBe(true)
    expect(readFileSync(join(from, 'MOVED-TO-SPAWN.txt'), 'utf8')).toContain(to)
  })

  it('a new folder made by a start whose copy failed is not "done": the old state wins over its empty one', () => {
    const { from, to } = oldFolder()
    // what the first 1.3.36 start left: its own logs, fresh window state with no names, a p3 timing line
    mkdirSync(join(to, 'logs'), { recursive: true })
    writeFileSync(join(to, 'logs', 'spawn.log'), 'new log')
    writeFileSync(join(to, 'window-state.json'), '{"sessionTitles":{}}')
    writeFileSync(join(to, 'update.log'), 'p3 start\n')
    mkdirSync(join(to, 'Local Storage', 'leveldb'), { recursive: true })
    writeFileSync(join(to, 'Local Storage', 'leveldb', '000009.log'), 'new-db')
    expect(migrateUserData({ from, to, ...fast }).status).toBe('copied')
    expect(readFileSync(join(to, 'window-state.json'), 'utf8')).toContain('내 세션')
    expect(readFileSync(join(to, 'update.log'), 'utf8')).toBe('p1 quit-start\np2 relaunch\np3 start\n')
    expect(readFileSync(join(to, 'logs', 'spawn.log'), 'utf8')).toBe('new log')
    // page storage is replaced whole, never mixed
    expect(existsSync(join(to, 'Local Storage', 'leveldb', '000009.log'))).toBe(false)
    expect(existsSync(join(to, 'Local Storage', 'leveldb', '000003.log'))).toBe(true)
  })

  it('a busy entry is left for the next start; the ones that went through are not copied again', () => {
    const { from, to } = oldFolder()
    const realCp = realFs.cpSync
    realFs.cpSync = (src: string, ...rest: any[]) => {
      if (String(src).endsWith('Local Storage')) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return realCp(src, ...rest)
    }
    let first: any
    try { first = migrateUserData({ from, to, ...fast }) } finally { realFs.cpSync = realCp }
    expect(first.status).toBe('partial')
    expect(first.failed.join()).toContain('Local Storage: EBUSY')
    expect(existsSync(join(from, 'MOVED-TO-SPAWN.txt'))).toBe(false)
    // the user changes a setting in between; the next start must not undo it
    writeFileSync(join(to, 'settings.json'), '{"app":{"language":"ja"}}')
    const second = migrateUserData({ from, to, ...fast })
    expect(second.status).toBe('copied')
    expect(second.copied).toEqual(['Local Storage'])
    expect(readFileSync(join(to, 'settings.json'), 'utf8')).toContain('"ja"')
    expect(existsSync(join(from, 'MOVED-TO-SPAWN.txt'))).toBe(true)
  })

  it('once done, later starts leave the new folder alone', () => {
    const { from, to } = oldFolder()
    migrateUserData({ from, to, ...fast })
    writeFileSync(join(to, 'window-state.json'), '{"newer":true}')
    expect(migrateUserData({ from, to, ...fast }).status).toBe('done')
    expect(readFileSync(join(to, 'window-state.json'), 'utf8')).toContain('newer')
  })

  it('a new PC has nothing to copy, and nothing is created', () => {
    const root = mkdtempSync(join(tmpdir(), 'spawn-appdata-')); roots.push(root)
    expect(migrateUserData({ from: join(root, 'Claudex'), to: join(root, 'spawn') }).status).toBe('nothing')
    expect(existsSync(join(root, 'spawn'))).toBe(false)
  })

  it('a busy folder costs the start at most the time budget, and never throws', () => {
    const { from, to } = oldFolder()
    const realCp = realFs.cpSync
    realFs.cpSync = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) }
    const t0 = Date.now()
    let r: any
    try { r = migrateUserData({ from, to, waitMs: 5, budgetMs: 60 }) } finally { realFs.cpSync = realCp }
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(r.status).toBe('partial')
  })
})
