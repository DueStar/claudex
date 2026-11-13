/**
 * server/cloud.js with 설정 › 프롬프트 숨기기 on: the cloud copy of the game
 * keeps the catch stories' tool but not the request text or the tool's
 * argument, so neither leaves this PC.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cloudCopy, defaultSettingsFile, readHidePrompts } from '../server/cloud.js'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const via = { tool: 'Bash', label: 'Bash(npm test -- --secret-flag)', prompt: '고객사 계약서 정리해줘' }
const game = {
  version: 2,
  caught: { 25: { count: 1, via, place: 'spawn 숲' } },
  mons: { u1: { uid: 'u1', dex: 25, via } },
  log: [{ kind: 'catch', id: 25, via, at: 1 }, { kind: 'levelup', id: 25, at: 2 }],
}

describe('cloud copy and 프롬프트 숨기기', () => {
  it('off: the catch stories go as they are', () => {
    expect(cloudCopy(game).log[0].via).toEqual(via)
  })

  it('on: no request text and no tool argument anywhere in the copy; the tool stays', () => {
    const copy = cloudCopy(game, { hidePrompts: true })
    const text = JSON.stringify(copy)
    expect(text).not.toContain('고객사')
    expect(text).not.toContain('secret-flag')
    expect(copy.log[0].via).toEqual({ tool: 'Bash', label: 'Bash', prompt: null })
    expect(copy.caught[25].via).toEqual({ tool: 'Bash', label: 'Bash', prompt: null })
    expect(copy.mons.u1.via).toEqual({ tool: 'Bash', label: 'Bash', prompt: null })
    expect(copy.log[1]).toEqual({ kind: 'levelup', id: 25, at: 2 })
    // the game itself is not changed
    expect(game.log[0].via).toEqual(via)
  })

  it('reads the setting from the app settings file (missing or broken: off)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spawn-privacy-'))
    dirs.push(dir)
    const file = join(dir, 'settings.json')
    expect(readHidePrompts(file)).toBe(false)
    writeFileSync(file, JSON.stringify({ privacy: { hidePrompts: true } }))
    expect(readHidePrompts(file)).toBe(true)
    writeFileSync(file, '{broken')
    expect(readHidePrompts(file)).toBe(false)
    expect(readHidePrompts(null)).toBe(false)
  })
})

describe('default settings file location', () => {
  it('darwin: under Application Support', () => {
    expect(defaultSettingsFile({}, '/Users/a', 'darwin')).toBe('/Users/a/Library/Application Support/spawn/settings.json')
  })

  it('win32: under APPDATA, as before', () => {
    expect(defaultSettingsFile({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a', 'win32'))
      .toBe(win32.join('C:\\Users\\a\\AppData\\Roaming', 'spawn', 'settings.json'))
  })

  it('darwin: a settings file with hidePrompts on is found and hides the prompts', () => {
    const home = mkdtempSync(join(tmpdir(), 'spawn-home-'))
    dirs.push(home)
    const dir = join(home, 'Library', 'Application Support', 'spawn')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ privacy: { hidePrompts: true } }))
    const hide = readHidePrompts(defaultSettingsFile({}, home, 'darwin'))
    expect(hide).toBe(true)
    expect(JSON.stringify(cloudCopy(game, { hidePrompts: hide }))).not.toContain('고객사')
  })
})
