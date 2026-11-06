/**
 * server/cloud.js — Google sign-in through Supabase (PKCE + loopback) and the
 * cloud copy of the game, with a fake fetch standing in for Supabase.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createCloud } from '../server/cloud.js'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const CONFIG = { supabaseUrl: 'https://abc.supabase.co', publishableKey: 'sb_publishable_x' }

function setup(remote: any = null) {
  const dir = mkdtempSync(join(tmpdir(), 'cloud-'))
  dirs.push(dir)
  const calls: any[] = []
  let game: any = { version: 2, caught: { 1: {} }, seen: { 1: 1 } }
  const fetchImpl = async (url: string, init: any = {}) => {
    calls.push({ url, init })
    const json = (data: any, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) })
    if (url.includes('/auth/v1/token?grant_type=pkce')) {
      return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, user: { id: 'u1', email: 'a@b.c', user_metadata: { full_name: 'Ash' } } })
    }
    if (url.includes('/rest/v1/trainers?select=')) return json(remote ? [remote] : [])
    if (url.includes('/rest/v1/trainers?on_conflict=')) return { ok: true, status: 201, json: async () => null, text: async () => '' }
    return json({}, 404)
  }
  const sent: any[] = []
  const cloud = createCloud({
    config: CONFIG,
    sessionFile: join(dir, 'cloud-session.json'),
    callbackUrl: 'http://127.0.0.1:3334/auth/callback',
    broadcast: (m: any) => sent.push(m),
    getGame: () => game,
    replaceGame: (g: any) => { game = g },
    fetchImpl: fetchImpl as any,
  })
  return { cloud, calls, sent, dir, getGame: () => game }
}

describe('cloud', () => {
  it('builds a PKCE sign-in URL for Google that comes back to the loopback callback', () => {
    const { cloud } = setup()
    const r = cloud.startSignIn()
    expect(r.ok).toBe(true)
    const u = new URL(r.url!)
    expect(u.origin + u.pathname).toBe('https://abc.supabase.co/auth/v1/authorize')
    expect(u.searchParams.get('provider')).toBe('google')
    expect(u.searchParams.get('code_challenge_method')).toBe('s256')
    expect(u.searchParams.get('redirect_to')).toMatch(/^http:\/\/127\.0\.0\.1:3334\/auth\/callback\?state=/)
  })

  it('trades the code with the verifier it kept, then uploads this PC\'s game; tokens never reach the page', async () => {
    const { cloud, calls, sent, dir } = setup()
    const state = new URL(new URL(cloud.startSignIn().url!).searchParams.get('redirect_to')!).searchParams.get('state')!
    expect(await cloud.finishSignIn({ code: 'c0de', state })).toEqual({ ok: true })
    const token = calls.find(c => c.url.includes('grant_type=pkce'))
    const body = JSON.parse(token.init.body)
    expect(body.auth_code).toBe('c0de')
    // the verifier matches the challenge sent to the browser
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBeTruthy()
    const upload = calls.find(c => c.url.includes('on_conflict=user_id'))
    expect(JSON.parse(upload.init.body)).toMatchObject({ user_id: 'u1', caught_count: 1, display_name: 'Ash' })
    expect(upload.init.headers.Authorization).toBe('Bearer at')
    expect(JSON.stringify(sent)).not.toContain('"at"')
    expect(cloud.publicState().user).toMatchObject({ email: 'a@b.c', name: 'Ash' })
    expect(existsSync(join(dir, 'cloud-session.json'))).toBe(true)
  })

  it('a cloud copy with more species wins on sign-in (a new PC brings the dex along)', async () => {
    const remoteGame = { version: 2, caught: { 1: {}, 2: {}, 3: {} } }
    const { cloud, getGame } = setup({ state: remoteGame, caught_count: 3 })
    const state = new URL(new URL(cloud.startSignIn().url!).searchParams.get('redirect_to')!).searchParams.get('state')!
    await cloud.finishSignIn({ code: 'x', state })
    expect(getGame()).toEqual(remoteGame)
  })

  it('refuses a callback it did not start, and signs out cleanly', async () => {
    const { cloud, dir } = setup()
    expect(await cloud.finishSignIn({ code: 'x', state: 'forged' })).toMatchObject({ ok: false })
    const state = new URL(new URL(cloud.startSignIn().url!).searchParams.get('redirect_to')!).searchParams.get('state')!
    await cloud.finishSignIn({ code: 'x', state })
    await cloud.signOut()
    expect(cloud.publicState().user).toBeNull()
    expect(existsSync(join(dir, 'cloud-session.json'))).toBe(false)
  })
})
