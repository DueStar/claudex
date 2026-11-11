/**
 * guards.js — the two checks every request passes before anything else: the
 * Origin allowlist (browsers on other sites) and the Host guard (DNS
 * rebinding). server/index.js applies them to HTTP and the WebSocket alike.
 */

// ---------------------------------------------------------------------------
// Allowed origins
//
// The server UI is served from this server (PORT, 3334 by default: `npm run
// build`, the packaged desktop app) or from the Vite dev server (UI_DEV_PORT,
// 3333 by default), and browsers reach either as localhost, 127.0.0.1 or ::1
// — the Origin header spells it whichever way the page was opened, so match
// the loopback host rather than a fixed string. Anything else (other ports,
// `null`, `file://`) is refused. 3333 stays allowed next to a configured
// SPAWN_UI_PORT: `npm run dev` ignores that variable and still opens
// Vite on 3333 (vite.config.ts).
// ---------------------------------------------------------------------------

export const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Bound to the server's port and the Vite dev port */
export function createGuards({ port: PORT, uiDevPort: UI_DEV_PORT }) {
  const ALLOWED_ORIGIN_PORTS = new Set([String(UI_DEV_PORT), '3333', String(PORT)])
  const isAllowedOrigin = (origin) => allowedOrigin(origin, ALLOWED_ORIGIN_PORTS)
  return { isAllowedOrigin, isAllowedHost }
}

function allowedOrigin(origin, ALLOWED_ORIGIN_PORTS) {
  if (!origin) return true  // no Origin header: curl, the hook script, same-origin GETs
  try {
    const { protocol, hostname, port } = new URL(origin)
    return protocol === 'http:' && LOOPBACK_HOSTS.has(hostname) && ALLOWED_ORIGIN_PORTS.has(port)
  } catch {
    return false  // not a URL (`null`)
  }
}

// ---------------------------------------------------------------------------
// Host-header guard — defeats DNS rebinding
//
// The origin allowlist keeps cross-origin browser requests out, but a
// same-origin GET from a page the browser rebound to 127.0.0.1 carries no
// Origin header (the Fetch spec adds Origin only to CORS-tainted or
// non-GET/HEAD requests). Such a request would otherwise read every open GET
// — the pending command lines on GET /permissions, cwds and titles on
// GET /sessions, agent tasks on GET /agents. What it cannot forge is the Host
// header the browser sends: a rebinding page's Host is still its own domain.
// So every request must name a loopback host (any port: Vite proxies as
// localhost:3333, Electron loads 127.0.0.1:<port>); anything else is 421.
// ---------------------------------------------------------------------------

/** The host name of a Host header, port stripped, brackets kept for IPv6 ([::1]:3334 -> [::1]). */
export function hostName(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return ''
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']')
    return end === -1 ? hostHeader : hostHeader.slice(0, end + 1)
  }
  const colon = hostHeader.indexOf(':')
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon)
}

/** A request is served only when its Host names a loopback host; guards against DNS rebinding. */
export function isAllowedHost(hostHeader) {
  return LOOPBACK_HOSTS.has(hostName(hostHeader))
}
