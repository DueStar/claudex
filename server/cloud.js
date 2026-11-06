/**
 * cloud.js — Google sign-in (through Supabase Auth) and syncing the game to
 * the cloud.
 *
 * Sign-in is the OAuth PKCE flow with a loopback redirect:
 *   1. the desktop app asks POST /auth/start (office token) for a sign-in URL
 *      and opens it in the user's browser;
 *   2. Google -> Supabase -> GET /auth/callback?code=...&state=... here;
 *   3. this server trades the code (with the verifier it kept) for a session.
 * The session is kept in <runtime dir>/cloud-session.json and refreshed before
 * it expires. Tokens never reach the page; the page only learns who is signed
 * in and when the game last synced (`cloud` broadcasts, the snapshot).
 *
 * Sync: the whole game state is upserted to public.trainers (one row per user,
 * protected by row-level security: each user reads and writes only their own).
 * See supabase/schema.sql.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from 'fs'
import { createHash, randomBytes } from 'crypto'

const PENDING_TTL_MS = 10 * 60 * 1000
const SYNC_DEBOUNCE_MS = 30 * 1000

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createCloud({ config, sessionFile, callbackUrl, broadcast, getGame, replaceGame, now = () => Date.now(), fetchImpl = fetch }) {
  const enabled = !!(config?.supabaseUrl && config?.publishableKey)
  const base = enabled ? config.supabaseUrl.replace(/\/+$/, '') : ''
  const pending = new Map() // state -> { verifier, at }
  let session = loadSession()
  let lastSyncAt = null
  let lastError = null
  let syncTimer = null

  function loadSession() {
    try { return existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, 'utf8')) : null } catch { return null }
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

  /** GET /auth/callback: trade the code for a session, then pull or push the game */
  async function finishSignIn({ code, state }) {
    const p = state && pending.get(state)
    if (!enabled || !code || !p) return { ok: false, reason: 'unknown-sign-in' }
    pending.delete(state)
    try {
      saveSession(toSession(await authRequest('pkce', { auth_code: code, code_verifier: p.verifier })))
      lastError = null
      await reconcile()
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

  async function push() {
    if (!session) return
    const game = getGame()
    const row = {
      user_id: session.user.id,
      display_name: session.user.user_metadata?.full_name ?? session.user.email ?? null,
      ...summary(game),
      state: game,
      updated_at: new Date(now()).toISOString(),
    }
    await rest('trainers?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) })
    lastSyncAt = now()
    lastError = null
  }

  /**
   * After sign-in: the cloud copy wins when it has caught more species than
   * this PC (signing in on a new PC brings the dex along); otherwise this PC's
   * game is uploaded.
   */
  async function reconcile() {
    const rows = await rest(`trainers?select=state,caught_count&user_id=eq.${session.user.id}`)
    const remote = rows?.[0]
    const local = summary(getGame())
    if (remote && remote.caught_count > local.caught_count && remote.state) {
      replaceGame(remote.state)
      lastSyncAt = now()
    } else {
      await push()
    }
  }

  /** The game changed: upload it, at most every SYNC_DEBOUNCE_MS */
  function noteGameChanged() {
    if (!session || syncTimer) return
    syncTimer = setTimeout(async () => {
      syncTimer = null
      try { await push() } catch (err) { lastError = err.message === 'signed-out' ? null : `동기화 실패: ${err.message}` }
      publish()
    }, SYNC_DEBOUNCE_MS)
    syncTimer.unref?.()
  }

  async function signOut() {
    const token = session?.access_token
    saveSession(null)
    lastSyncAt = null
    lastError = null
    publish()
    if (token && enabled) {
      fetchImpl(`${base}/auth/v1/logout`, { method: 'POST', headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` } }).catch(() => {})
    }
    return { ok: true }
  }

  return { enabled, startSignIn, finishSignIn, noteGameChanged, signOut, publicState, syncNow: push }
}
