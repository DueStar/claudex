/**
 * File paths in terminal output that open in the editor (src/fileRef.ts), and the link the
 * main process opens them with (electron/links.cjs). Windows exactly as before; macOS adds
 * absolute paths (/Users/me/a.ts) and home paths (~/proj/a.ts).
 */

import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { FILE_REF, fileRefPattern } from '../src/fileRef'
import { setPlatformForTest } from '../src/platform'

const require = createRequire(import.meta.url)
const { vscodeUrl, resolveRef } = require('../electron/links.cjs')

// The pattern as it stood in TerminalPanel.tsx before the move
const BEFORE = /(?<![\w/\:.@-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\w@.-]+[\\/])[\w@.\-\\/]*\.[A-Za-z0-9]{1,8}|[\w@.-]+\.[A-Za-z0-9]{1,8}(?=:\d))(?::(\d+))?(?::(\d+))?/g

const refs = (re: RegExp, text: string) => [...text.matchAll(re)].map(m => [m.index, m[0], m[1], m[2], m[3]])
const first = (text: string) => {
  const m = [...text.matchAll(fileRefPattern())][0]
  return m ? [m[1], m[2], m[3]] : null
}

const SAMPLES = [
  'src/app.ts:42:7',
  'C:\\x\\y.py:3',
  'C:/x/y.py',
  'c:\\Users\\me\\proj\\main.go:12:1',
  './x.js',
  '../a/b.tsx:10',
  '.\\run.ps1',
  'app.ts:12',
  'app.ts',
  'see (src/a.ts:3) and [lib/b.rs:4:2]',
  'Edit src/components/TerminalPanel.tsx and src/fileRef.ts',
  'node_modules/@xterm/xterm/lib/xterm.js:1',
  '"docs/plan.md"',
  'https://example.com/a/b.html',
  'http://localhost:5173/index.html',
  'file:///C:/x/y.ts',
  'version 1.2.3 released',
  'example.com:443',
  'email@host.com',
  'foo/bar',
  'a.b.c/d.e.f:9',
  '/c/Users/me/a.ts:12',
  '/Users/me/a.ts:12',
  '/etc/hosts.conf',
  '~/proj/a.ts',
  '~/proj/a.ts:3:4',
  'x~/y.ts',
  '한글 경로 src/한글.ts:3 그리고 src/b.ts',
  'Wrote 12 lines to src\\util\\fs.ts',
  '',
]

afterEach(() => setPlatformForTest(null))

describe('FILE_REF on Windows: the same matches as before', () => {
  it.each(SAMPLES)('%s', (text) => {
    setPlatformForTest('win')
    expect(refs(fileRefPattern(), text)).toEqual(refs(BEFORE, text))
  })

  it('links what it always linked, and not POSIX or home paths', () => {
    setPlatformForTest('win')
    expect(first('src/app.ts:42:7')).toEqual(['src/app.ts', '42', '7'])
    expect(first('C:\\x\\y.py:3')).toEqual(['C:\\x\\y.py', '3', undefined])
    expect(first('app.ts:12')).toEqual(['app.ts', '12', undefined])
    expect(first('app.ts')).toBe(null)
    expect(first('https://example.com/a/b.html')).toBe(null)
    expect(first('/Users/me/a.ts:12')).toBe(null)
    expect(first('~/proj/a.ts')).toBe(null)
  })
})

describe('FILE_REF on macOS', () => {
  it('links absolute and home paths, with :line and :column', () => {
    setPlatformForTest('mac')
    expect(first('/Users/me/a.ts:12')).toEqual(['/Users/me/a.ts', '12', undefined])
    expect(first('Edited /Users/me/proj/src/a.ts:12:5.')).toEqual(['/Users/me/proj/src/a.ts', '12', '5'])
    expect(first('~/proj/a.ts')).toEqual(['~/proj/a.ts', undefined, undefined])
    expect(first('(~/proj/a.ts:3:4)')).toEqual(['~/proj/a.ts', '3', '4'])
    expect(first('/etc/hosts.conf')).toEqual(['/etc/hosts.conf', undefined, undefined])
  })

  it('still links relative paths and bare names with a line', () => {
    setPlatformForTest('mac')
    expect(first('src/app.ts:42:7')).toEqual(['src/app.ts', '42', '7'])
    expect(first('./x.js')).toEqual(['./x.js', undefined, undefined])
    expect(first('app.ts:12')).toEqual(['app.ts', '12', undefined])
  })

  it('does not link inside URLs or after a word', () => {
    setPlatformForTest('mac')
    expect(first('https://example.com/a/b.html')).toBe(null)
    expect(first('file:///Users/a.ts')).toBe(null)
    expect(first('x~/y.ts')).toBe(null)
    expect(first('app.ts')).toBe(null)
    expect(first('/usr/bin/env')).toBe(null)
  })

  it('FILE_REF itself is the pattern that knows both', () => {
    expect([...'/Users/me/a.ts:12'.matchAll(FILE_REF)][0][1]).toBe('/Users/me/a.ts')
    expect([...'~/proj/a.ts'.matchAll(FILE_REF)][0][1]).toBe('~/proj/a.ts')
    expect([...'C:\\x\\y.py:3'.matchAll(FILE_REF)][0][1]).toBe('C:\\x\\y.py')
  })
})

describe('vscodeUrl', () => {
  // Today's expression in main.cjs, with path.sep = \ on Windows
  const before = (abs: string) => `vscode://file/${abs.split('\\').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')}`

  it('Windows paths as before', () => {
    for (const abs of ['C:\\a\\x.ts', 'c:\\Users\\me\\my proj\\a b.ts', 'D:\\한글\\x.py', '\\\\server\\share\\x.ts']) {
      expect(vscodeUrl(abs, { platform: 'win32' })).toBe(before(abs))
    }
    expect(vscodeUrl('C:\\a\\x.ts')).toBe('vscode://file/C:/a/x.ts')
    expect(vscodeUrl('C:\\a\\x.ts', { scheme: 'cursor', platform: 'win32' })).toBe('cursor://file/C:/a/x.ts')
  })

  it('macOS paths: forward slashes, no double slash', () => {
    expect(vscodeUrl('/Users/a/x.ts')).toBe('vscode://file/Users/a/x.ts')
    expect(vscodeUrl('/Users/a/x.ts', { platform: 'darwin' })).toBe('vscode://file/Users/a/x.ts')
    expect(vscodeUrl('/Users/a/my proj/x.ts', { platform: 'darwin' })).toBe('vscode://file/Users/a/my%20proj/x.ts')
    expect(vscodeUrl('/Users/a/x.ts', { scheme: 'cursor', platform: 'darwin' })).toBe('cursor://file/Users/a/x.ts')
  })
})

describe('resolveRef: where a clicked path is', () => {
  it('Windows: against the session folder, as before', () => {
    expect(resolveRef('C:\\proj', 'src/a.ts', { platform: 'win32' })).toBe('C:\\proj\\src\\a.ts')
    expect(resolveRef('C:\\proj', 'D:\\x\\y.py', { platform: 'win32' })).toBe('D:\\x\\y.py')
    expect(resolveRef('C:\\proj', '..\\b.ts', { platform: 'win32' })).toBe('C:\\b.ts')
    expect(resolveRef('C:\\proj', '~/a.ts', { platform: 'win32', home: 'C:\\Users\\me' })).toBe('C:\\proj\\~\\a.ts')
  })

  it('macOS: absolute paths as they are, ~/ in the home folder', () => {
    const mac = { platform: 'darwin', home: '/Users/me' }
    expect(resolveRef('/Users/me/proj', 'src/a.ts', mac)).toBe('/Users/me/proj/src/a.ts')
    expect(resolveRef('/Users/me/proj', '/etc/hosts.conf', mac)).toBe('/etc/hosts.conf')
    expect(resolveRef('/Users/me/proj', '~/notes/a.md', mac)).toBe('/Users/me/notes/a.md')
    expect(resolveRef('/Users/me/proj', '../b.ts', mac)).toBe('/Users/me/b.ts')
  })
})
