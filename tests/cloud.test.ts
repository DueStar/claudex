/**
 * server/cloud.js — Google sign-in through Supabase (PKCE + loopback) and the
 * cloud copy of the game, with a fake fetch standing in for Supabase.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createCloud, syncMark, cloudCopy, CLOUD_LOG } from '../server/cloud.js'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const CONFIG = { supabaseUrl: 'https://abc.supabase.co', publishableKey: 'sb_publishable_x' }

function setup(remote: any = null, onReplace: () => void = () => {}, opts: { uploadedAt?: () => string } = {}) {
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
    if (url.includes('/rest/v1/trainers?on_conflict=')) {
      if (opts.uploadedAt) { const at = opts.uploadedAt(); remote = { ...(remote ?? {}), updated_at: at }; return json([{ updated_at: at }], 201) }
      return { ok: true, status: 201, json: async () => null, text: async () => '' }
    }
    return json({}, 404)
  }
  const sent: any[] = []
  const cloud = createCloud({
    config: CONFIG,
    sessionFile: join(dir, 'cloud-session.json'),
    callbackUrl: 'http://127.0.0.1:3334/auth/callback',
    broadcast: (m: any) => sent.push(m),
    getGame: () => game,
    replaceGame: (g: any) => { onReplace(); game = g },
    fetchImpl: fetchImpl as any,
  })
  return { cloud, calls, sent, dir, getGame: () => game, setGame: (g: any) => { game = g }, setRemote: (r: any) => { remote = r } }
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

  it("on sign-in the cloud copy is merged with this PC's game, not swapped in: both sides' catches are kept and the merged game is uploaded", async () => {
    const mon = (uid: string, dex: number, at: number) => ({ uid, dex, steps: 0, evos: 0, shiny: false, how: 'wild', place: '숲', at, ball: 'poke-ball', metLevel: 10, workMs: 0 })
    // The cloud has caught more species, but this PC has a catch the cloud lacks
    const remoteGame = { version: 2, caught: { 1: { count: 1, firstAt: 10 }, 2: { count: 1, firstAt: 20 }, 3: { count: 1, firstAt: 30 } }, seen: { 1: 1, 2: 1, 3: 1 }, mons: { m1: mon('m1', 1, 10), m2: mon('m2', 2, 20), m3: mon('m3', 3, 30) }, party: ['m1'], box: ['m2', 'm3'], nextUid: 4, encounters: 9 }
    const { cloud, calls, getGame, setGame } = setup({ state: remoteGame, caught_count: 3 })
    setGame({ version: 2, caught: { 1: { count: 1, firstAt: 10 }, 25: { count: 1, firstAt: 40 } }, seen: { 1: 1, 25: 1 }, mons: { m1: mon('m1', 1, 10), m2: mon('m2', 25, 40) }, party: ['m1'], box: ['m2'], nextUid: 3, encounters: 4, assign: { s1: 'm1' } })
    const state = new URL(new URL(cloud.startSignIn().url!).searchParams.get('redirect_to')!).searchParams.get('state')!
    await cloud.finishSignIn({ code: 'x', state })
    const game = getGame()
    expect(Object.keys(game.caught).sort()).toEqual(['1', '2', '25', '3'])
    expect(Object.values<any>(game.mons).map(m => m.dex).sort((a, b) => a - b)).toEqual([1, 2, 3, 25])
    expect(game.party).toEqual(['m1'])
    expect(game.assign).toEqual({ s1: 'm1' }) // this PC's sessions keep their Pokémon
    expect(game.encounters).toBe(9)
    const upload = calls.find(c => c.url.includes('on_conflict=user_id'))
    const row = JSON.parse(upload.init.body)
    expect(row).toMatchObject({ caught_count: 4, seen_count: 4 })
    expect(row.state).toEqual(cloudCopy(game))
    expect(row.state.assign).toBeUndefined() // this PC's sessions stay on this PC
  })

  it("a later sync pulls and merges before it uploads, so another PC's newer catches are not overwritten", async () => {
    const { cloud, calls, getGame, setRemote } = setup()
    const state = new URL(new URL(cloud.startSignIn().url!).searchParams.get('redirect_to')!).searchParams.get('state')!
    await cloud.finishSignIn({ code: 'x', state })
    // Another PC uploaded a catch meanwhile
    setRemote({ state: { version: 2, caught: { 1: {}, 150: { count: 1, firstAt: 5 } }, seen: { 1: 1, 150: 1 } } })
    calls.length = 0
    await cloud.syncNow()
    expect(calls.findIndex(c => c.url.includes('trainers?select='))).toBeLessThan(calls.findIndex(c => c.url.includes('on_conflict=user_id')))
    expect(Object.keys(getGame().caught).sort()).toEqual(['1', '150'])
    const row = JSON.parse(calls.find(c => c.url.includes('on_conflict=user_id')).init.body)
    expect(row.caught_count).toBe(2)
  })

  it("with nothing new in the cloud, this PC's game is left as it is (no replace) and uploaded", async () => {
    let replaced = 0
    const { cloud, calls, getGame } = setup(null, () => { replaced++ })
    const before = getGame()
    const state = new URL(new URL(cloud.startSignIn().url!).searchParams.get('redirect_to')!).searchParams.get('state')!
    await cloud.finishSignIn({ code: 'x', state })
    expect(replaced).toBe(0)
    expect(getGame()).toBe(before)
    expect(JSON.parse(calls.find(c => c.url.includes('on_conflict=user_id')).init.body).state).toEqual(cloudCopy(before))
  })

  it('downloads the whole game only when another PC wrote since this one last did', async () => {
    let n = 0
    const { cloud, calls, setRemote, getGame } = setup(null, () => {}, { uploadedAt: () => `2026-11-08T00:00:0${n++}.000+00:00` })
    const state = new URL(new URL(cloud.startSignIn().url!).searchParams.get('redirect_to')!).searchParams.get('state')!
    await cloud.finishSignIn({ code: 'x', state })
    // Nobody else wrote: only updated_at is read, then the upload
    calls.length = 0
    await cloud.syncNow()
    expect(calls.some(c => c.url.includes('select=state'))).toBe(false)
    expect(calls.some(c => c.url.includes('select=updated_at&user_id='))).toBe(true)
    expect(calls.some(c => c.url.includes('on_conflict=user_id'))).toBe(true)
    // Another PC wrote (a newer updated_at): the whole copy is read and merged
    setRemote({ updated_at: '2026-11-08T09:00:00.000+00:00', state: { version: 2, caught: { 1: {}, 150: { count: 1, firstAt: 5 } }, seen: { 1: 1, 150: 1 } } })
    calls.length = 0
    await cloud.syncNow()
    expect(calls.some(c => c.url.includes('select=state'))).toBe(true)
    expect(Object.keys(getGame().caught).sort()).toEqual(['1', '150'])
  })

  it('the cloud copy leaves out the fields only this PC uses and keeps the newest CLOUD_LOG events', () => {
    const log = Array.from({ length: CLOUD_LOG + 50 }, (_, i) => ({ kind: 'catch', id: 1, at: i }))
    const game = { version: 2, caught: { 1: {} }, assign: { s: 'm1' }, projects: { s: 'web' }, daily: { day: 'd', catches: 1 }, thrownAt: { s: 1 }, log }
    const copy = cloudCopy(game)
    expect(Object.keys(copy).sort()).toEqual(['caught', 'log', 'version'])
    expect(copy.log).toHaveLength(CLOUD_LOG)
    expect(copy.log[0].at).toBe(50)
    expect(game.log).toHaveLength(CLOUD_LOG + 50) // the game itself is untouched
  })

  it('a step alone is not worth a sync; a logged event, the box, the party or a release is', () => {
    const g: any = { log: [{ kind: 'catch', at: 1 }], box: ['a'], party: ['p'], released: {}, mons: { a: { steps: 1 } } }
    const base = syncMark(g)
    expect(syncMark({ ...g, mons: { a: { steps: 99, workMs: 5000 } } })).toBe(base)
    expect(syncMark({ ...g, log: [...g.log, { kind: 'levelup', at: 2 }] })).not.toBe(base)
    expect(syncMark({ ...g, box: ['a', 'b'] })).not.toBe(base)
    expect(syncMark({ ...g, party: ['q'] })).not.toBe(base)
    expect(syncMark({ ...g, released: { k: 1 } })).not.toBe(base)
  })

  it('refuses a callback it did not start, and signs out cleanly', async () => {
    const { cloud, dir } = setup()
    expect(await cloud.finishSignIn({ code: 'x', state: 'forged' })).toMatchObject({ ok: false })
    const state = new URL(new URL(cloud.startSignIn().url!).searchParams.get('redirect_to')!).searchParams.get('state')!
    await cloud.finishSignIn({ code: 'x', state })
    await cloud.signOut()
    expect(cloud.publicState().user).toBeNull()
    expect(existsSync(join(dir, 'cloud-session.json'))).toBe(false)
    expect(existsSync(join(dir, 'cloud-session.json.synced'))).toBe(false)
  })
})
