/**
 * ws-protocol.js — the WebSocket handshake's subprotocols (the page offers
 * `spawn` and `spawn.token.<token>`, src/serverToken.ts) and what a
 * connection without the token may see of a broadcast. See "The WebSocket"
 * in server/index.js.
 */

export const WS_PROTOCOL = 'spawn'
export const WS_TOKEN_PROTOCOL_PREFIX = 'spawn.token.'

/** The token a WebSocket handshake offered as a subprotocol, or ''. */
export function wsTokenFrom(req) {
  const header = req.headers['sec-websocket-protocol']
  if (typeof header !== 'string') return ''
  for (const part of header.split(',')) {
    const value = part.trim()
    if (value.startsWith(WS_TOKEN_PROTOCOL_PREFIX)) return value.slice(WS_TOKEN_PROTOCOL_PREFIX.length)
  }
  return ''
}

/** The subprotocol the server agrees to: `spawn` when offered, never the token. */
export function handleProtocols(protocols) {
  return protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false
}

/** A copy of `obj` without `keys`. */
function omit(obj, keys) {
  const out = { ...obj }
  for (const key of keys) delete out[key]
  return out
}

/** An event's `main` without the last prompt and reply text (what GET /sessions shows without the token). */
export function withoutMainText(event) {
  const main = event.main
  if (!main || typeof main !== 'object' || !('lastPrompt' in main || 'lastReply' in main)) return event
  return { ...event, main: omit(event.main, ['lastPrompt', 'lastReply']) }
}

/**
 * What a read-only connection gets of a broadcast: the payload itself when it
 * carries no conversation text, else a copy without it.
 *
 *   session_prompt, session_turn_end   `text` (the prompt, the reply)
 *   every event with `main`            main.lastPrompt / main.lastReply
 */
export function redactForReadOnly(payload) {
  switch (payload.type) {
    case 'session_prompt':
    case 'session_turn_end':
      return withoutMainText(omit(payload, ['text']))
    default:
      return withoutMainText(payload)
  }
}
