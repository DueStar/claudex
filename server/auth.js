/**
 * auth.js — the server token and how a caller proves it holds it.
 *
 * The token lives in <runtime dir>/auth-token, a 0600 file only this OS user
 * can read (see "Threat model" in server/index.js). A caller proves it holds
 * the token one of two ways, both checked in constant time:
 *
 *   bearer      Authorization: Bearer <token> — the app sends it from its own
 *               memory, never from a command line
 *   signature   X-Claudex-Timestamp + X-Claudex-Signature =
 *               HMAC-SHA256(token, method\npath\ntimestamp\nbody) — the hook
 *               and the status line run as short-lived processes whose argv
 *               every local user can read, so they never send the token at
 *               all. A leaked signature is bound to one method, path, body and
 *               minute: replaying it can only repeat the victim's own event.
 */

import { readFileSync, writeFileSync, chmodSync, unlinkSync, openSync, fstatSync, closeSync, constants as fsConstants } from 'fs'
import { randomBytes, timingSafeEqual, createHmac } from 'crypto'

/** What the server writes: 32 random bytes as 64 lowercase hex digits */
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/

/** ±1 minute: wide enough for clock skew, narrow enough that a leaked signature expires fast. */
export const SIGNATURE_WINDOW_MS = 60_000

/**
 * The token a previous start left in `file`, if it is still safe to keep
 * using: a regular file (a symlink is not followed), owned by this user,
 * with no group or other permission bits, holding a well-formed token.
 * Anything else — missing, malformed, readable by others, someone else's —
 * is null, and the server mints a new token instead. The file is opened
 * once and checked through that descriptor, so it cannot be swapped between
 * the check and the read. Windows has no uid or mode bits to check.
 */
export function readTokenFile(file) {
  let fd
  try {
    fd = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    const st = fstatSync(fd)
    if (!st.isFile()) return null
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return null
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) return null
    const token = readFileSync(fd, 'utf8').trim()
    return TOKEN_PATTERN.test(token) ? token : null
  } catch {
    return null
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch {}
  }
}

/**
 * Write a file only this user can read. The mode applies when the file is
 * created, so a file an older version left world-readable is fixed as well.
 */
export function writePrivate(path, data) {
  writeFileSync(path, data, { mode: 0o600 })
  try { chmodSync(path, 0o600) } catch {}
}

/**
 * The server's answer to an opener's /health challenge: HMAC-SHA256 of the
 * token over 'claudex-health:' + challenge. Only a holder of the token can
 * make it, so an opener knows it is about to hand the token to this server
 * and not to a process that took the port while the server was down.
 */
export function serverProof(token, challenge) {
  return createHmac('sha256', token).update(`claudex-health:${challenge}`).digest('hex')
}

export function bearerToken(req) {
  const header = req.headers['authorization'] ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

export function unauthorized(res, body) {
  res.setHeader('WWW-Authenticate', 'Bearer realm="claudex"')
  return res.status(401).json(body)
}

/**
 * The token for this run (the one in `tokenFile` when it is safe to reuse,
 * else a new one) and the checks bound to it.
 */
export function createAuth({ tokenFile }) {
  const REUSED_TOKEN = readTokenFile(tokenFile)
  const AUTH_TOKEN = REUSED_TOKEN ?? randomBytes(32).toString('hex')

  /**
   * Put AUTH_TOKEN in the token file (after listen). A reused token is already
   * there. A new one replaces whatever the file was — unlinked first and then
   * created exclusively, so a symlink or a file owned by someone else is
   * replaced rather than written through.
   */
  function writeTokenFile() {
    if (readTokenFile(tokenFile) === AUTH_TOKEN) return
    try {
      try { unlinkSync(tokenFile) } catch (err) { if (err.code !== 'ENOENT') throw err }
      writeFileSync(tokenFile, AUTH_TOKEN, { mode: 0o600, flag: 'wx' })
      try { chmodSync(tokenFile, 0o600) } catch {}
    } catch (err) {
      console.warn('[auth] Could not write token file:', err.message)
    }
  }

  /** Constant-time comparison of a supplied token with ours. */
  function tokenMatches(supplied) {
    if (typeof supplied !== 'string' || supplied.length === 0) return false
    const a = Buffer.from(supplied, 'utf8')
    const b = Buffer.from(AUTH_TOKEN, 'utf8')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  /** HMAC-SHA256(token, canonical request) as the hook computes it. The key is the token string's bytes. */
  function requestSignature(method, path, timestamp, rawBody) {
    const h = createHmac('sha256', AUTH_TOKEN)
    h.update(`${method}\n${path}\n${timestamp}\n`)
    h.update(rawBody && rawBody.length ? rawBody : Buffer.alloc(0))
    return h.digest()
  }

  /**
   * True when the request carries a signature this server's token would
   * produce over the raw body, for a timestamp within the window. `req.rawBody`
   * is captured by express.json's verify hook (the exact bytes the hook
   * signed); it is empty for a GET, which signs an empty body.
   */
  function signatureValid(req) {
    const ts = req.headers['x-claudex-timestamp']
    const sig = req.headers['x-claudex-signature']
    if (typeof ts !== 'string' || typeof sig !== 'string' || !/^[0-9a-f]+$/.test(sig)) return false
    const tnum = Number(ts)
    if (!Number.isFinite(tnum) || Math.abs(Date.now() - tnum) > SIGNATURE_WINDOW_MS) return false
    const given = Buffer.from(sig, 'hex')
    const expected = requestSignature(req.method, req.originalUrl, ts, req.rawBody)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  /** A caller proved it holds the token: a valid bearer token, or a valid request signature. */
  function tokenAuthed(req) {
    return tokenMatches(bearerToken(req)) || signatureValid(req)
  }

  /** Express middleware: the route needs the server's token (bearer or a valid signature). */
  function requireToken(req, res, next) {
    if (tokenAuthed(req)) return next()
    unauthorized(res, { error: 'Unauthorized' })
  }

  return { AUTH_TOKEN, REUSED_TOKEN, writeTokenFile, tokenMatches, signatureValid, tokenAuthed, requireToken }
}
