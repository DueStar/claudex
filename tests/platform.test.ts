import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMac, modKey, modLabel, setPlatformForTest } from '../src/platform'

const require = createRequire(import.meta.url)
const main = require('../electron/platform.cjs')

describe('electron/platform.cjs', () => {
  it('detects the platform from the argument', () => {
    expect(main.isMac('darwin')).toBe(true)
    expect(main.isMac('win32')).toBe(false)
    expect(main.isWin('win32')).toBe(true)
    expect(main.isWin('darwin')).toBe(false)
  })

  it('appSupportDir follows each platform convention', () => {
    expect(main.appSupportDir('/Users/a', 'darwin')).toBe('/Users/a/Library/Application Support/spawn')
    const w = (...p: string[]) => p.join(String.fromCharCode(92))
    expect(main.appSupportDir(w('C:', 'Users', 'a'), 'win32', { APPDATA: w('C:', 'x') })).toBe(w('C:', 'x', 'spawn'))
    expect(main.appSupportDir(w('C:', 'Users', 'a'), 'win32', {})).toBe(w('C:', 'Users', 'a', 'AppData', 'Roaming', 'spawn'))
    expect(main.appSupportDir('/home/a', 'linux', {})).toBe('/home/a/.config/spawn')
  })
})

describe('src/platform.ts', () => {
  // Node has a navigator of its own (on a Mac its platform is MacIntel): each case sets one
  afterEach(() => { setPlatformForTest(null); vi.unstubAllGlobals() })

  it('isMac does not throw without navigator and defaults to false', () => {
    setPlatformForTest(null)
    vi.stubGlobal('navigator', undefined)
    expect(isMac()).toBe(false)
  })

  it('isMac reads the navigator: platform, or userAgentData.platform first', () => {
    setPlatformForTest(null)
    vi.stubGlobal('navigator', { platform: 'Win32' })
    expect(isMac()).toBe(false)
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(isMac()).toBe(true)
    vi.stubGlobal('navigator', { platform: '', userAgentData: { platform: 'macOS' } })
    expect(isMac()).toBe(true)
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgentData: { platform: 'Windows' } })
    expect(isMac()).toBe(false)
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' })
    expect(isMac()).toBe(false)
  })

  it('modKey uses Cmd on mac and Ctrl elsewhere', () => {
    const e = (meta: boolean, ctrl: boolean) => ({ metaKey: meta, ctrlKey: ctrl }) as KeyboardEvent
    setPlatformForTest('mac')
    expect(modKey(e(true, false))).toBe(true)
    expect(modKey(e(false, true))).toBe(false)
    setPlatformForTest('win')
    expect(modKey(e(true, false))).toBe(false)
    expect(modKey(e(false, true))).toBe(true)
  })

  it('modLabel per platform', () => {
    setPlatformForTest('mac')
    expect(modLabel()).toBe('⌘')
    setPlatformForTest('win')
    expect(modLabel()).toBe('Ctrl')
  })
})
