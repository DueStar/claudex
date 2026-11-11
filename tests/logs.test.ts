/**
 * electron/logs.cjs: lines are stamped, and the file rolls over to
 * spawn.old.log past its size limit so the folder stays small.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createLog, scrubSecrets } = require('../electron/logs.cjs')

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'spawn-logs-')); dirs.push(d); return join(d, 'logs') }

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
    expect(existsSync(join(dir, 'spawn.old.log'))).toBe(true)
    expect(statSync(log.file).size).toBeLessThanOrEqual(200)
    expect(readFileSync(log.file, 'utf8')).toContain('line 19')
  })

  it('picks up the size of a log left by the last run', () => {
    const dir = tempDir()
    createLog(dir, { maxBytes: 120 }).write('a'.repeat(80))
    createLog(dir, { maxBytes: 120 }).write('b'.repeat(80))
    expect(readFileSync(join(dir, 'spawn.old.log'), 'utf8')).toContain('aaa')
    expect(readFileSync(join(dir, 'spawn.log'), 'utf8')).not.toContain('aaa')
  })
})

describe('secrets in the log', () => {
  it('never writes the server token: it is scrubbed from each line', () => {
    expect(scrubSecrets('Page: http://127.0.0.1:3334/#token=abc123 x')).toBe('Page: http://127.0.0.1:3334/#token=… x')
    expect(scrubSecrets('no secret here')).toBe('no secret here')
    const log = createLog(tempDir())
    log.write('[server]   Page: http://127.0.0.1:3334/#token=s3cr3t-T0KEN_value\n')
    expect(readFileSync(log.file, 'utf8')).not.toContain('s3cr3t')
  })

  it('scrubs a token that logs from an older version still hold', () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'spawn.log'), 'x Page: http://127.0.0.1:3334/#token=oldtoken1\n')
    writeFileSync(join(dir, 'spawn.old.log'), 'y Page: http://127.0.0.1:3334/#token=oldtoken2\n')
    createLog(dir)
    expect(readFileSync(join(dir, 'spawn.log'), 'utf8')).toBe('x Page: http://127.0.0.1:3334/#token=…\n')
    expect(readFileSync(join(dir, 'spawn.old.log'), 'utf8')).not.toContain('oldtoken2')
  })
})
