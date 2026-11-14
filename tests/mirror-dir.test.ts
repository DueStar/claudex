/**
 * mirrorDir (electron/mirrorDir.cjs): how a Mac lays a staged update over
 * Contents/Resources/app. Everything is copied first; only then does anything
 * in the target go, so a copy that fails leaves the target as it was.
 */
import * as fs from 'node:fs'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { mirrorDir } = require('../electron/mirrorDir.cjs')

let root: string
let from: string
let to: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cx-mirror-'))
  from = join(root, 'staged'); to = join(root, 'app')
  mkdirSync(join(from, 'lib', 'deep'), { recursive: true })
  writeFileSync(join(from, 'package.json'), '{"v":2}')
  writeFileSync(join(from, 'lib', 'same.js'), 'same')
  writeFileSync(join(from, 'lib', 'deep', 'new.js'), 'new')
  mkdirSync(join(to, 'lib'), { recursive: true })
  mkdirSync(join(to, 'gone', 'inner'), { recursive: true })
  writeFileSync(join(to, 'package.json'), '{"v":1}')
  writeFileSync(join(to, 'lib', 'same.js'), 'same')
  writeFileSync(join(to, 'lib', 'old.js'), 'old')
  writeFileSync(join(to, 'gone', 'inner', 'x.js'), 'x')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Every file under `dir` with its contents, and every folder */
function snapshot(dir: string) {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      const rel = relative(dir, full).replace(/\\/g, '/')
      if (e.isDirectory()) { out[`${rel}/`] = ''; walk(full) } else out[rel] = readFileSync(full, 'utf8')
    }
  }
  walk(dir)
  return out
}

describe('mirrorDir', () => {
  it('copies new files, replaces changed ones, removes what the update no longer has', () => {
    mirrorDir(from, to)
    expect(snapshot(to)).toEqual(snapshot(from))
    expect(snapshot(to)).toEqual({ 'package.json': '{"v":2}', 'lib/': '', 'lib/same.js': 'same', 'lib/deep/': '', 'lib/deep/new.js': 'new' })
  })

  it('leaves the staged folder as it is', () => {
    const before = snapshot(from)
    mirrorDir(from, to)
    expect(snapshot(from)).toEqual(before)
  })

  it.skipIf(process.platform === 'win32')('keeps the exec bit', () => {
    const bin = join(from, 'lib', 'spawn-helper')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    writeFileSync(join(to, 'lib', 'spawn-helper'), 'old')
    chmodSync(join(to, 'lib', 'spawn-helper'), 0o644)
    mirrorDir(from, to)
    expect(statSync(join(to, 'lib', 'spawn-helper')).mode & 0o777).toBe(0o755)
  })

  it('a copy that fails leaves the target untouched', () => {
    const before = snapshot(to)
    let n = 0
    const fsx = { ...fs, copyFileSync: (a: fs.PathLike, b: fs.PathLike) => {
      if (++n === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      fs.copyFileSync(a, b)
    } }
    expect(() => mirrorDir(from, to, fsx)).toThrow('disk full')
    expect(snapshot(to)).toEqual(before)
  })

  it('a folder where the target has a file (or the other way) stops it before anything changes', () => {
    writeFileSync(join(to, 'lib', 'deep'), 'a file where the update has a folder')
    const before = snapshot(to)
    expect(() => mirrorDir(from, to)).toThrow()
    expect(snapshot(to)).toEqual(before)
  })

  it('makes the target when it is missing', () => {
    rmSync(to, { recursive: true })
    mirrorDir(from, to)
    expect(snapshot(to)).toEqual(snapshot(from))
  })

  it('needs a source folder', () => {
    const before = snapshot(to)
    expect(() => mirrorDir(join(root, 'nothing'), to)).toThrow()
    expect(snapshot(to)).toEqual(before)
    expect(existsSync(to)).toBe(true)
  })
})
