/**
 * cloud.js — Google sign-in (through Supabase Auth) and syncing the game to
 * the cloud.
 *
 * Sign-in is the OAuth PKCE flow with a loopback redirect:
 *   1. the desktop app asks POST /auth/start (server token) for a sign-in URL
 *      and opens it in the user's browser;
 *   2. Google -> Supabase -> GET /auth/callback?code=...&state=... here;
 *   3. this server trades the code (with the verifier it kept) for a session.
 * The session is kept in <runtime dir>/cloud-session.json and refreshed before
 * it expires. Tokens never reach the page; the page only learns who is signed
 * in and when the game last synced (`cloud` broadcasts, the snapshot).
 *
 * Sync: the game is kept in public.trainers (one row per user, protected by
 * row-level security: each user reads and writes only their own; see
 * supabase/schema.sql). Every sync reads the cloud copy, merges it with this
 * PC's game (server/merge.js: a union, so catches made on another PC are never
 * lost), takes the merged game here and uploads it.
 *
 * Kept small for the free plan's egress (downloads count, uploads do not):
 *  - a sync follows only a change worth keeping (something in the log: a catch,
 *    an evolution, a level-up, a release, a swap...), never a step alone;
 *  - it first asks only for the row's updated_at, and downloads the whole game
 *    only when another PC wrote since this one last did (`syncedAt`, kept in
 *    <session file>.synced so a restart does not download it again).
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from 'fs'
import { createHash, randomBytes } from 'crypto'
import { mergeGames, sameGame } from './merge.js'

const PENDING_TTL_MS = 10 * 60 * 1000
const SYNC_DEBOUNCE_MS = 30 * 1000

/** How many of the newest log events the cloud copy keeps (each PC keeps its own LOG_LIMIT) */
export const CLOUD_LOG = 200

/**
 * What the cloud keeps of a game: not the fields only this PC uses (merge.js
 * always takes them from the local side: session assignments, the projects,
 * today's catch number, session starts), and only the newest CLOUD_LOG events.
 */
export function cloudCopy(game) {
  const { assign, projects, daily, thrownAt, ...rest } = game ?? {}
  return Array.isArray(rest.log) ? { ...rest, log: rest.log.slice(-CLOUD_LOG) } : rest
}

/** What a sync is worth doing for: the log's newest event, the box, the party, the released (not steps or work time) */
export function syncMark(game) {
  const last = game?.log?.[game.log.length - 1]
  return [game?.log?.length ?? 0, last?.at ?? 0, last?.kind ?? '', game?.box?.length ?? 0, (game?.party ?? []).join(','), Object.keys(game?.released ?? {}).length].join('|')
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createCloud({ config, sessionFile, callbackUrl, broadcast, getGame, replaceGame, now = () => Date.now(), fetchImpl = fetch }) {
  const enabled = !!(config?.supabaseUrl && config?.publishableKey)
  const base = enabled ? config.supabaseUrl.replace(/\/+$/, '') : ''
  const pending = new Map() // state -> { verifier, at }
  let session = loadSession()
  const syncedFile = `${sessionFile}.synced`
  /** The row's updated_at after this PC's last sync: equal in the cloud means nobody else wrote since */
  let syncedAt = loadSynced()
  /** syncMark of the game at the last change that scheduled a sync */
  let lastMark = null
  let lastSyncAt = null
  let lastError = null
  let syncTimer = null

  function loadSession() {
    try { return existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, 'utf8')) : null } catch { return null }
  }
  function loadSynced() {
    try { return existsSync(syncedFile) ? readFileSync(syncedFile, 'utf8').trim() || null : null } catch { return null }
  }
  function saveSynced(at) {
    syncedAt = at
    try {
      if (at) writeFileSync(syncedFile, at)
      else if (existsSync(syncedFile)) unlinkSync(syncedFile)
    } catch { /* only costs a download next time */ }
  }

  function saveSession(s) {
    session = s
    try {
      if (s) {
        writeFileSync(sessionFile, JSON.stringify(s), { mode: 0o600 })
        try { chmodSync(sessionFile, 0o600) } catch {}
      } else if (existsSync(sessionFile)) unlinkSync(sessionFile)
    } catch (err) {
      console.error('[cloud] could not store the session:', err.message)
    }
  }

  function publicState() {
    return {
      enabled,
      user: session ? { email: session.user?.email ?? null, name: session.user?.user_metadata?.full_name ?? session.user?.user_metadata?.name ?? null, avatar: session.user?.user_metadata?.avatar_url ?? null } : null,
      lastSyncAt,
      error: lastError,
    }
  }
  function publish() { broadcast({ type: 'cloud', cloud: publicState() }) }

  /** A fresh sign-in URL for the browser (PKCE), remembered by its state for the callback */
  function startSignIn() {
    if (!enabled) return { ok: false, reason: 'not-configured' }
    for (const [k, v] of pending) if (now() - v.at > PENDING_TTL_MS) pending.delete(k)
    const verifier = b64url(randomBytes(32))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const state = b64url(randomBytes(16))
    pending.set(state, { verifier, at: now() })
    const redirect = `${callbackUrl}?state=${state}`
    const url = `${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=s256`
    return { ok: true, url }
  }

  async function authRequest(grant, body) {
    const res = await fetchImpl(`${base}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error_description || data.msg || data.error || `HTTP ${res.status}`)
    return data
  }

  function toSession(data) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at ? data.expires_at * 1000 : now() + (data.expires_in ?? 3600) * 1000,
      user: data.user ? { id: data.user.id, email: data.user.email, user_metadata: data.user.user_metadata ?? {} } : session?.user,
    }
  }

  /** GET /auth/callback: trade the code for a session, then sync the game */
  async function finishSignIn({ code, state }) {
    const p = state && pending.get(state)
    if (!enabled || !code || !p) return { ok: false, reason: 'unknown-sign-in' }
    pending.delete(state)
    try {
      saveSession(toSession(await authRequest('pkce', { auth_code: code, code_verifier: p.verifier })))
      saveSynced(null) // a new sign-in (maybe another account) reads the whole cloud copy
      lastError = null
      await sync()
      publish()
      return { ok: true }
    } catch (err) {
      lastError = `로그인 실패: ${err.message}`
      publish()
      return { ok: false, reason: err.message }
    }
  }

  async function accessToken() {
    if (!session) return null
    if (session.expires_at - now() < 60_000) {
      try {
        saveSession(toSession(await authRequest('refresh_token', { refresh_token: session.refresh_token })))
      } catch (err) {
        lastError = '로그인이 만료됐어요. 다시 로그인해주세요.'
        saveSession(null)
        publish()
        return null
      }
    }
    return session.access_token
  }

  async function rest(path, init = {}) {
    const token = await accessToken()
    if (!token) throw new Error('signed-out')
    const res = await fetchImpl(`${base}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }

  function summary(game) {
    return {
      caught_count: Object.keys(game?.caught ?? {}).length,
      seen_count: Object.keys(game?.seen ?? {}).length,
    }
  }

  async function upload(game) {
    const row = {
      user_id: session.user.id,
      display_name: session.user.user_metadata?.full_name ?? session.user.email ?? null,
      ...summary(game),
      state: cloudCopy(game),
      updated_at: new Date(now()).toISOString(),
    }
    // Only updated_at comes back, so the upload costs no egress beyond a few bytes
    const back = await rest('trainers?on_conflict=user_id&select=updated_at', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) })
    saveSynced(back?.[0]?.updated_at ?? null)
    lastSyncAt = now()
    lastError = null
  }

  /**
   * Read the cloud copy, merge it with this PC's game, take the merged game
   * here (when it adds anything) and upload it. Neither side wins outright:
   * the merge is a union, so a PC that caught different Pokémon from another
   * keeps its catches and gains the other's. The read, merge and replace
   * happen with no await in between, so a catch made meanwhile is not lost;
   * if another PC uploads between our read and our upload, its catches are
   * still on that PC and come back with its next sync.
   */
  async function sync() {
    if (!session) return
    const id = session.user.id
    const head = (await rest(`trainers?select=updated_at&user_id=eq.${id}`))?.[0]
    const local = getGame()
    if (head && syncedAt && head.updated_at && Date.parse(head.updated_at) === Date.parse(syncedAt)) {
      // Nobody else wrote since our last upload: the cloud copy is already in this game
      await upload(local)
      return
    }
    const remote = head ? (await rest(`trainers?select=state&user_id=eq.${id}`))?.[0]?.state : undefined
    const merged = mergeGames(local, remote)
    let game = merged
    if (!sameGame(merged, local) && replaceGame(merged) !== false) game = getGame()
    await upload(game)
  }

  /** The game changed: sync it when the change is worth keeping (syncMark), at most every SYNC_DEBOUNCE_MS */
  function noteGameChanged(game) {
    if (!session) return
    if (game) {
      const mark = syncMark(game)
      if (mark === lastMark) return
      lastMark = mark
    }
    if (syncTimer) return
    syncTimer = setTimeout(async () => {
      syncTimer = null
      try { await sync() } catch (err) { lastError = err.message === 'signed-out' ? null : `동기화 실패: ${err.message}` }
      publish()
    }, SYNC_DEBOUNCE_MS)
    syncTimer.unref?.()
  }

  // ---- The leaderboard (supabase/leaderboard.sql): three functions, the numbers worked out in the database ----

  const BOARDS = ['caught', 'shiny', 'legends', 'week']
  const BOARD_TTL_MS = 60_000 // a board is asked for at most once a minute (egress)
  const boardCache = new Map()

  /** A database function; signed in it goes as the trainer, else anonymously (the publishable key alone) */
  async function rpc(name, args, { signedIn = true } = {}) {
    const token = signedIn ? await accessToken() : null
    if (signedIn && !token) throw new Error('signed-out')
    const res = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: config.publishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(args ?? {}),
    })
    const text = await res.text()
    if (res.status === 404) throw new Error('not-set-up') // leaderboard.sql was not run yet
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }

  /** The top 100 of a board and the trainer's own place: { ok, rows: [{ place, nickname, partner, value, me }] } */
  async function leaderboard(board) {
    if (!enabled) return { ok: false, reason: 'not-configured' }
    if (!BOARDS.includes(board)) return { ok: false, reason: 'bad-board' }
    const key = `${session?.user?.id ?? 'anon'}:${board}`
    const hit = boardCache.get(key)
    if (hit && now() - hit.at < BOARD_TTL_MS) return hit.result
    try {
      const rows = await rpc('leaderboard_board', { board }, { signedIn: !!session })
      const result = {
        ok: true,
        rows: (Array.isArray(rows) ? rows : []).map(r => ({ place: Number(r.place), rn: Number(r.rn ?? r.place), nickname: String(r.nickname ?? ''), partner: r.partner ?? null, value: Number(r.value ?? 0), me: r.is_me === true })),
      }
      boardCache.set(key, { at: now(), result })
      return result
    } catch (err) {
      return { ok: false, reason: err.message }
    }
  }

  /** The trainer's own entry: nickname, public flag, partner and numbers (null before the first sync) */
  async function leaderboardProfile() {
    if (!enabled) return { ok: false, reason: 'not-configured' }
    if (!session) return { ok: false, reason: 'signed-out' }
    try {
      const rows = await rpc('leaderboard_profile', {})
      const r = Array.isArray(rows) ? rows[0] : null
      return { ok: true, profile: r ? { nickname: r.nickname ?? '', isPublic: r.is_public === true, partner: r.partner ?? null, caught: r.caught ?? 0, shiny: r.shiny ?? 0, legends: r.legends ?? 0, week: r.week_catches ?? 0, flagged: r.flagged === true } : null }
    } catch (err) {
      return { ok: false, reason: err.message }
    }
  }

  /** Join, rename or leave: { nickname, isPublic, partner } */
  async function setLeaderboardProfile({ nickname, isPublic, partner } = {}) {
    if (!enabled) return { ok: false, reason: 'not-configured' }
    if (!session) return { ok: false, reason: 'signed-out' }
    try {
      // The database works the numbers out from the uploaded game: make sure there is one
      await sync().catch(() => {})
      const answer = await rpc('leaderboard_set_profile', { p_nickname: String(nickname ?? '').slice(0, 40), p_public: isPublic === true, p_partner: Number.isInteger(partner) ? partner : null })
      if (answer !== 'ok') return { ok: false, reason: String(answer) }
      boardCache.clear()
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err.message }
    }
  }

  async function signOut() {
    const token = session?.access_token
    saveSession(null)
    saveSynced(null)
    lastSyncAt = null
    lastError = null
    publish()
    if (token && enabled) {
      fetchImpl(`${base}/auth/v1/logout`, { method: 'POST', headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` } }).catch(() => {})
    }
    return { ok: true }
  }

  return { enabled, startSignIn, finishSignIn, noteGameChanged, signOut, publicState, syncNow: sync, leaderboard, leaderboardProfile, setLeaderboardProfile }
}
