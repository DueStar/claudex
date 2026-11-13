import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { parseEnv, mergeLoginEnv } = require('../electron/shellEnv.cjs')

const home = '/Users/me'
const count = (path: string, dir: string) => path.split(':').filter(d => d === dir).length

describe('shellEnv.cjs', () => {
  it('parseEnv reads NUL separated NAME=value pairs', () => {
    expect(parseEnv('A=1\0PATH=/x\0')).toEqual({ A: '1', PATH: '/x' })
    expect(parseEnv('A=a=b\0\0')).toEqual({ A: 'a=b' })
  })

  it('a failing login shell falls back to the usual dirs once, and sets LANG', async () => {
    const env = { PATH: '/usr/bin:/bin:/usr/local/bin' }
    const out = await mergeLoginEnv({ env, home, platform: 'darwin', run: () => Promise.reject(new Error('boom')) })
    expect(count(out.PATH, '/opt/homebrew/bin')).toBe(1)
    expect(count(out.PATH, '/usr/local/bin')).toBe(1)
    expect(out.PATH).toContain('/Users/me/.local/bin')
    expect(out.PATH.startsWith('/usr/bin:/bin')).toBe(true)
    expect(out.LANG).toBe('en_US.UTF-8')
  })

  it('a login shell that never answers is given up on after timeoutMs', async () => {
    const t0 = Date.now()
    const out = await mergeLoginEnv({ env: { PATH: '/usr/bin' }, home, platform: 'darwin', timeoutMs: 50, run: () => new Promise(() => {}) })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(out.PATH).toContain('/opt/homebrew/bin')
  })

  it('the login shell PATH comes first, LANG is taken only when unset, other variables are not copied', async () => {
    const run = async () => 'PATH=/opt/homebrew/bin:/Users/me/bin\0LANG=ko_KR.UTF-8\0SECRET=x\0'
    const out = await mergeLoginEnv({ env: { PATH: '/usr/bin' }, home, platform: 'darwin', run })
    expect(out.PATH.split(':').slice(0, 3)).toEqual(['/opt/homebrew/bin', '/Users/me/bin', '/usr/bin'])
    expect(count(out.PATH, '/opt/homebrew/bin')).toBe(1)
    expect(out.LANG).toBe('ko_KR.UTF-8')
    expect(out.SECRET).toBeUndefined()
    const kept = await mergeLoginEnv({ env: { PATH: '/usr/bin', LANG: 'ja_JP.UTF-8' }, home, platform: 'darwin', run })
    expect(kept.LANG).toBe('ja_JP.UTF-8')
  })

  it('asks the shell for a login, interactive env dump', async () => {
    const calls: unknown[][] = []
    await mergeLoginEnv({ env: { SHELL: '/bin/bash' }, home, platform: 'darwin', run: async (...a: unknown[]) => { calls.push(a); return '' } })
    expect(calls[0].slice(0, 2)).toEqual(['/bin/bash', ['-ilc', 'env -0']])
    const dflt: unknown[][] = []
    await mergeLoginEnv({ env: {}, home, platform: 'darwin', run: async (...a: unknown[]) => { dflt.push(a); return '' } })
    expect(dflt[0][0]).toBe('/bin/zsh')
  })

  it('does nothing off the Mac', async () => {
    const env = { PATH: 'C://x' }
    expect(await mergeLoginEnv({ env, home, platform: 'win32', run: () => Promise.reject(new Error('no')) })).toBe(env)
    expect(await mergeLoginEnv({ env, home, platform: 'linux' })).toBe(env)
  })
})
