/**
 * The update restart's step timer (electron/updateTiming.cjs): one line per
 * step in update.log, with the time since the step before and since the first.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createStepTimer } = require('../electron/updateTiming.cjs')

let dir: string
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('createStepTimer', () => {
  it('writes one line per step with the gap and the running total', () => {
    dir = mkdtempSync(join(tmpdir(), 'cx-timing-'))
    const file = join(dir, 'update.log')
    const times = [1000, 1250, 1900]
    const timer = createStepTimer({ file, label: 'quit', pid: 42, now: () => times.shift()! })
    timer.mark('start')
    timer.mark('sessions-ended')
    timer.mark('server-stopped', 'code=0')
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('pid=42 quit start +0ms total=0ms')
    expect(lines[1]).toContain('pid=42 quit sessions-ended +250ms total=250ms')
    expect(lines[2]).toContain('pid=42 quit server-stopped +650ms total=900ms code=0')
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('never throws, even when the log cannot be written', () => {
    const timer = createStepTimer({ file: join(tmpdir(), 'no-such-folder-cx', 'deeper', 'update.log'), label: 'p2' })
    expect(() => timer.mark('start')).not.toThrow()
  })
})
