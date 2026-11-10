/**
 * server/cloud.js while the network is unreliable: a refresh that cannot
 * reach the auth server keeps the trainer signed in (only the auth server
 * saying no signs them out), and syncs never pile up on a hung request.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createCloud } from '../server/cloud.js'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
afterEach(() => { vi.useRealTimers() })

const CONFIG = { supabaseUrl: 'https://abc.supabase.co', publishableKey: 'sb_publishable_x' }
const NOW = 1_800_000_000_000

function signedIn(fetchImpl: (url: string, init?: any) => Promise<any>, expiresIn = 10_000) {
  const dir = mkdtempSync(join(tmpdir(), 'cloud-offline-'))
  dirs.push(dir)
  const sessionFile = join(dir, 'cloud-session.json')
  writeFileSync(sessionFile, JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_at: NOW + expiresIn, user: { id: 'u1', email: 'a@b.c', user_metadata: {} } }))
  let game: any = { version: 2, caught: {}, seen: {}, log: [] }
  const cloud = createCloud({
    config: CONFIG, sessionFile, callbackUrl: 'http://127.0.0.1:3334/auth/callback',
    broadcast: () => {}, getGame: () => game, replaceGame: (g: any) => { game = g }, now: () => NOW, fetchImpl: fetchImpl as any,
  })
  return { cloud, sessionFile, setGame: (g: any) => { game = g } }
}

describe('cloud offline', () => {
  it('a refresh that fails on the network keeps the session and reports offline', async () => {
    const { cloud, sessionFile } = signedIn(async () => { throw new TypeError('fetch failed') })
    await expect(cloud.syncNow()).rejects.toThrow()
    expect(cloud.publicState().user).not.toBeNull()
    expect(cloud.publicState().error).toMatchObject({ code: 'offline' })
    expect(existsSync(sessionFile)).toBe(true)
  })

  it('a refresh the auth server rejects (400) signs out', async () => {
    const { cloud, sessionFile } = signedIn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }))
    await expect(cloud.syncNow()).rejects.toThrow()
    expect(cloud.publicState().user).toBeNull()
    expect(cloud.publicState().error).toMatchObject({ code: 'session-expired' })
    expect(existsSync(sessionFile)).toBe(false)
  })

  it('every request carries a timeout', async () => {
    const seen: any[] = []
    const { cloud } = signedIn(async (_url, init) => { seen.push(init); return { ok: true, status: 200, json: async () => ({}), text: async () => '[]' } }, 3_600_000)
    await cloud.syncNow().catch(() => {})
    expect(seen.length).toBeGreaterThan(0)
    for (const init of seen) expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('syncs never overlap: a change during a hung sync waits for it', async () => {
    vi.useFakeTimers()
    let heads = 0
    let release: () => void = () => {}
    const { cloud, setGame } = signedIn(async (url) => {
      if (url.includes('select=updated_at')) {
        heads++
        await new Promise<void>(r => { release = r })
        return { ok: true, status: 200, json: async () => [], text: async () => '[]' }
      }
      return { ok: true, status: 201, json: async () => null, text: async () => '' }
    }, 3_600_000)
    const game = (n: number) => ({ version: 2, caught: {}, seen: {}, log: Array.from({ length: n }, (_, i) => ({ kind: 'catch', at: i })) })
    setGame(game(1)); cloud.noteGameChanged(game(1))
    await vi.advanceTimersByTimeAsync(31_000)
    expect(heads).toBe(1)
    setGame(game(2)); cloud.noteGameChanged(game(2))
    await vi.advanceTimersByTimeAsync(31_000)
    expect(heads).toBe(1)
    release()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(heads).toBe(2)
    release()
    await vi.advanceTimersByTimeAsync(1)
  })
})
