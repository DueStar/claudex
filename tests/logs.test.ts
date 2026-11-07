/**
 * electron/logs.cjs: lines are stamped, and the file rolls over to
 * claudex.old.log past its size limit so the folder stays small.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createLog } = require('../electron/logs.cjs')

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'claudex-logs-')); dirs.push(d); return join(d, 'logs') }

describe('the app log', () => {
  it('stamps every line, including each line of a multi-line chunk', () => {
    const log = createLog(tempDir())
    log.write('[server] one\ntwo\n')
    const lines = readFileSync(log.file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z \[server\] one$/)
    expect(lines[1]).toMatch(/Z two$/)
  })

  it('rolls over past the limit, keeping one old file', () => {
    const dir = tempDir()
    const log = createLog(dir, { maxBytes: 200 })
    for (let i = 0; i < 20; i++) log.write(`line ${i} ${'x'.repeat(20)}`)
    expect(existsSync(join(dir, 'claudex.old.log'))).toBe(true)
    expect(statSync(log.file).size).toBeLessThanOrEqual(200)
    expect(readFileSync(log.file, 'utf8')).toContain('line 19')
  })

  it('picks up the size of a log left by the last run', () => {
    const dir = tempDir()
    createLog(dir, { maxBytes: 120 }).write('a'.repeat(80))
    createLog(dir, { maxBytes: 120 }).write('b'.repeat(80))
    expect(readFileSync(join(dir, 'claudex.old.log'), 'utf8')).toContain('aaa')
    expect(readFileSync(join(dir, 'claudex.log'), 'utf8')).not.toContain('aaa')
  })
})
