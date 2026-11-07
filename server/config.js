/**
 * config.js — the server's runtime configuration: the port and host it binds,
 * from the environment.
 *
 *   CLAUDEX_PORT     the port, default 3334. The hook, the status line, the
 *                    Vite dev server and the desktop app all read the same
 *                    variable, so one export in a shell moves everything.
 *   CLAUDEX_UI_PORT  the Vite dev server's port, default 3333 — only the
 *                    origin allowlist needs it.
 *   CLAUDEX_HOST     the bind address: IPv4 loopback only (see readHost).
 *
 * The AGENT_OFFICE_* names older setups used are still read when the
 * CLAUDEX_* one is unset.
 *
 * Everything here is pure (the environment comes in as an argument) so
 * tests/config.test.ts covers it without starting a server.
 */

export const DEFAULT_PORT = 3334
export const DEFAULT_UI_PORT = 3333
export const DEFAULT_HOST = '127.0.0.1'

/**
 * The spellings of CLAUDEX_HOST the server accepts; both bind 127.0.0.1.
 * `localhost` is mapped rather than passed to listen(): the resolver may
 * answer ::1 first (macOS does), and an IPv6-only socket refuses the
 * 127.0.0.1 every client dials.
 */
export const LOOPBACK_BIND_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** IPv6 loopback, refused with its own reason (see readHost). */
const IPV6_LOOPBACK = new Set(['::1', '0:0:0:0:0:0:0:1'])

/** A TCP port from an env string, or null when it is not one. */
function parsePort(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!/^\d{1,5}$/.test(text)) return null
  const port = Number(text)
  return port >= 1 && port <= 65535 ? port : null
}

/**
 * The port to bind: CLAUDEX_PORT, or 3334 when it is unset. A value
 * that is not a port (letters, 0, 70000) falls back to 3334 with a warning
 * rather than failing: the hook and the scripts parse the same variable
 * with the same fallback, so everything still meets on one port.
 */
export function readPort(env = process.env, log = console) {
  return readPortVar(env, 'PORT', DEFAULT_PORT, log)
}

/** The Vite dev server's port, CLAUDEX_UI_PORT, default 3333. */
export function readUiPort(env = process.env, log = console) {
  return readPortVar(env, 'UI_PORT', DEFAULT_UI_PORT, log)
}

/** CLAUDEX_<name>, or AGENT_OFFICE_<name> (older setups): the value and the name it came from */
function readVar(env, name) {
  for (const full of [`CLAUDEX_${name}`, `AGENT_OFFICE_${name}`]) {
    const raw = env?.[full]
    if (raw !== undefined && raw !== '') return { raw, name: full }
  }
  return { raw: undefined, name: `CLAUDEX_${name}` }
}

function readPortVar(env, key, fallback, log) {
  const { raw, name } = readVar(env, key)
  if (raw === undefined || raw === '') return fallback
  const port = parsePort(raw)
  if (port === null) {
    log?.warn?.(`[config] ${name}=${JSON.stringify(raw)} is not a port (1-65535); using ${fallback}`)
    return fallback
  }
  return port
}

/**
 * The address to bind: always 127.0.0.1. CLAUDEX_HOST may say
 * 127.0.0.1 or localhost; anything else is logged as refused, with the
 * reason, and 127.0.0.1 is bound.
 *
 * ::1 is loopback too, but every client of the server dials IPv4: the hook,
 * the status line, the desktop app and its tray. A server bound to [::1]
 * alone refuses all of them, so binding IPv4 loopback for it keeps every
 * client working.
 *
 * Anything else is refused on purpose: every GET and the WebSocket are open
 * on loopback (the token guards only what changes state and the
 * conversation), and on a LAN address those routes would show your sessions
 * to anyone on the network.
 */
export function readHost(env = process.env, log = console) {
  const { raw, name } = readVar(env, 'HOST')
  if (raw === undefined || typeof raw !== 'string' || raw.trim() === '') return DEFAULT_HOST
  const host = raw.trim().replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (LOOPBACK_BIND_HOSTS.has(host)) return DEFAULT_HOST
  if (IPV6_LOOPBACK.has(host)) {
    log?.error?.(
      `[config] ${name}=${JSON.stringify(raw)} refused: the server binds IPv4 loopback only. ` +
      `The hook and the desktop app both dial 127.0.0.1, ` +
      `and a server on [::1] alone would refuse them. Binding ${DEFAULT_HOST}, which is loopback too.`,
    )
    return DEFAULT_HOST
  }
  log?.error?.(
    `[config] ${name}=${JSON.stringify(raw)} refused: the server binds loopback only ` +
    `(127.0.0.1 or localhost). Every GET and the WebSocket are open on loopback by design, so a ` +
    `non-loopback bind would show your sessions to the network. Binding ${DEFAULT_HOST}.`,
  )
  return DEFAULT_HOST
}
