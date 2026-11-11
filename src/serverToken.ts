/**
 * serverToken.ts — the server token, as the page gets and keeps it.
 *
 * The server's WebSocket hands conversation text, and the UI token that
 * answers a permission dialog, only to a connection that presents the token
 * in ~/.spawn/auth-token — the 0600 file only this OS user can read. The
 * page cannot read files, so it gets the token through a link only its own
 * user sees:
 *
 *   http://127.0.0.1:3334/#token=<64 hex digits>
 *
 * which the desktop app opens (the server also prints it when it starts). A
 * browser never sends a fragment to a server, so the token is in no request
 * line and no server log.
 *
 * On load (main.tsx) captureServerToken takes the token out of the address,
 * keeps it in localStorage — per browser profile, which in practice means
 * per OS user — and puts the address back without it (history.replaceState),
 * so it is not left in the address bar, the history or a bookmark. The
 * server reuses the token across restarts, so a page that has it keeps
 * working; after the token file is deleted (a new token) the page drops to
 * read-only until the new link is opened.
 *
 * The WebSocket presents it at every (re)connect as a subprotocol value
 * (serverWsProtocols): browsers cannot set headers on a WebSocket, and a
 * protocol value, unlike a query parameter, never becomes part of a URL.
 * The server's side is in server/index.js ("The WebSocket").
 *
 * Storage can be missing or throw (a private window, blocked site data, a
 * sandboxed preview): localStorage first, then sessionStorage, then memory
 * for this page's life. The helpers take the location, history and storages
 * as arguments so tests pass fakes; nothing runs at import time.
 */

export const SERVER_TOKEN_KEY = 'spawn.token'
/** The server's token: 32 random bytes as 64 lowercase hex digits. */
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/
/** The subprotocol the server agrees to (server/index.js WS_PROTOCOL). */
export const WS_PROTOCOL = 'spawn'
/** The subprotocol that carries the token (server/index.js WS_TOKEN_PROTOCOL_PREFIX). */
export const WS_TOKEN_PROTOCOL_PREFIX = 'spawn.token.'

/** The parts of Storage the helpers use. */
export interface TokenStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** The parts of window.location captureServerToken reads. */
export interface HashLocation {
  hash: string
  pathname: string
  search: string
}

/** The part of window.history captureServerToken uses. */
export interface ReplaceHistory {
  state: unknown
  replaceState(data: unknown, unused: string, url?: string | null): void
}

export function isServerToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

/**
 * The `token=` parameter of a location hash and the hash without it.
 * `found` says whether there was one at all (even a malformed one, which is
 * stripped all the same); the other parameters are kept verbatim.
 */
export function splitTokenFromHash(hash: string): { found: boolean; token: string | null; rest: string } {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  if (!body) return { found: false, token: null, rest: '' }
  let found = false
  let token: string | null = null
  const kept: string[] = []
  for (const part of body.split('&')) {
    if (part.startsWith('token=')) {
      found = true
      const value = part.slice('token='.length)
      if (isServerToken(value)) token = value
    } else if (part) {
      kept.push(part)
    }
  }
  return { found, token, rest: found ? kept.join('&') : body }
}

// The token when no storage would take it
let memoryToken: string | null = null

/** localStorage, then sessionStorage — whichever this page may use; touching either can throw. */
function pageStorages(): TokenStorage[] {
  const out: TokenStorage[] = []
  if (typeof window === 'undefined') return out
  for (const pick of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const storage = pick()
      if (storage) out.push(storage)
    } catch { /* blocked: skip it */ }
  }
  return out
}

/**
 * The kept token: the first storage holding a well-formed one, else the
 * in-memory copy, else null. Storage is read every time, so a token another
 * tab captured (after a rotation, say) is used at this tab's next reconnect.
 */
export function getServerToken(storages: TokenStorage[] = pageStorages()): string | null {
  for (const storage of storages) {
    try {
      const value = storage.getItem(SERVER_TOKEN_KEY)
      if (isServerToken(value)) return value
    } catch { /* unreadable: try the next */ }
  }
  return memoryToken
}

/**
 * Keep a token: in the first storage that takes it (a storage that refuses
 * it drops its older copy, so that cannot shadow the new one), and in memory
 * either way.
 */
export function setServerToken(token: string, storages: TokenStorage[] = pageStorages()): void {
  if (!isServerToken(token)) return
  memoryToken = token
  for (const storage of storages) {
    try {
      storage.setItem(SERVER_TOKEN_KEY, token)
      return
    } catch {
      try { storage.removeItem(SERVER_TOKEN_KEY) } catch { /* nothing to do */ }
    }
  }
}

/** Forget the token everywhere it was kept. */
export function clearServerToken(storages: TokenStorage[] = pageStorages()): void {
  memoryToken = null
  for (const storage of storages) {
    try { storage.removeItem(SERVER_TOKEN_KEY) } catch { /* nothing to do */ }
  }
}

/**
 * Take `#token=` out of the address: keep a well-formed token (it replaces
 * any older one, e.g. after a rotation), and replace the address with the
 * same path, query and other fragment parameters without it. Returns the
 * token the page now has (the new one, or the one it kept before).
 */
export function captureServerToken(
  location: HashLocation = window.location,
  history: ReplaceHistory = window.history,
  storages: TokenStorage[] = pageStorages(),
): string | null {
  const { found, token, rest } = splitTokenFromHash(location.hash)
  if (!found) return getServerToken(storages)
  if (token) setServerToken(token, storages)
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`)
  } catch { /* an address we may not rewrite: the token is kept either way */ }
  return getServerToken(storages)
}

/**
 * The subprotocols the page's WebSocket offers: the server's own, plus the
 * token when the page has one. The server answers with `spawn` alone.
 */
export function serverWsProtocols(token: string | null | undefined = getServerToken()): string[] {
  return isServerToken(token) ? [WS_PROTOCOL, `${WS_TOKEN_PROTOCOL_PREFIX}${token}`] : [WS_PROTOCOL]
}

/** Tests: forget the in-memory copy. */
export function resetServerTokenMemory(): void {
  memoryToken = null
}
