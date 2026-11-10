/**
 * server/auth.js writePrivate — agents.json goes through it on every saved
 * session change, so a write cut short must never leave a half file behind
 * (the next start would find no sessions).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writePrivate } from '../server/auth.js'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('writePrivate', () => {
  it('never leaves a half-written file: a write that fails keeps the old content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudex-private-'))
    dirs.push(dir)
    const file = join(dir, 'agents.json')
    writePrivate(file, 'a')
    // A directory where the temporary file goes makes the write fail before the file is touched
    mkdirSync(`${file}.tmp`)
    expect(() => writePrivate(file, 'b')).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('a')
    rmSync(`${file}.tmp`, { recursive: true })
    writePrivate(file, 'b')
    expect(readFileSync(file, 'utf8')).toBe('b')
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})
