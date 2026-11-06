/**
 * useAgentSocket — the app's WebSocket to the local server.
 *
 * Connects to the server's /ws (officeWsUrl: the page's own origin when the
 * server serves the page, the configured port under Vite), presenting the
 * server token (src/officeToken.ts) as a subprotocol at every (re)connect.
 *
 *  - Auto-reconnect with exponential back-off (capped at 30 s)
 *  - Tracks the Claude Code sessions (one per terminal) from the snapshot and
 *    the session_* events, exposed as `sessions`
 *  - Hands every event to `onEvent`; the snapshot's parts arrive the same way
 *    (session_status for the meters, pokedex for the game, cloud for sign-in)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import type { ServerEvent, SessionInfo, SessionRegistry } from '../types'
import type { SessionStatus } from '../meters'
import { projectFromCwd } from '../mainState'
import { officeWsUrl } from '../serverUrl'
import { officeWsProtocols } from '../officeToken'

export interface AgentSocketOptions {
  /** Called for every incoming event. Stable reference recommended (useCallback). */
  onEvent?: (event: ServerEvent) => void
  /** WebSocket URL — defaults to officeWsUrl() (src/serverUrl.ts) */
  url?: string
}

export interface AgentSocketResult {
  /** Whether the WebSocket is currently open */
  connected: boolean
  /** Claude Code sessions the server knows about (ended ones linger briefly) */
  sessions: SessionInfo[]
}

/** The first message on every connection (server/index.js) */
interface SnapshotMessage {
  type: 'snapshot'
  sessions?: Array<SessionInfo>
  /** The status line's numbers (server/status.js) */
  statuses?: { sessions: SessionStatus[] }
  /** The game state (server/pokedex.js) */
  pokedex?: unknown
  /** Who is signed in to the cloud (server/cloud.js) */
  cloud?: unknown
}

const BACKOFF_INITIAL = 500   // ms
const BACKOFF_MAX    = 30_000 // ms
const BACKOFF_FACTOR = 2
// A connection counts as healthy (back-off resets) once it has delivered the
// server's snapshot, or has simply stayed open this long. A server that
// completes the handshake and closes straight away (origin rejected, 1008)
// therefore keeps backing off instead of being hammered every 500 ms.
const STABLE_OPEN_MS = 5_000
// An ended session lingers this long before it is dropped
const ENDED_SESSION_LINGER_MS = 10_000

/**
 * The session fields of an event or snapshot entry. session_started /
 * session_ended / session_registry carry the whole record, so a missing
 * `registry` there means the entry is gone: the caller passes `registry: null`
 * to clear it, while a partial update (undefined) keeps what we had.
 */
type SessionPatch = Omit<Partial<SessionInfo>, 'registry'> & { registry?: SessionRegistry | null }

function toSessionInfo(id: string, src: SessionPatch, prev?: SessionInfo): SessionInfo {
  return {
    ...prev,
    id,
    project:        src.project        ?? prev?.project,
    cwd:            src.cwd            ?? prev?.cwd,
    title:          src.title          ?? prev?.title,
    model:          src.model          ?? prev?.model,
    source:         src.source         ?? prev?.source,
    state:          src.state          ?? prev?.state ?? 'active',
    reason:         src.reason         ?? prev?.reason,
    startedAt:      src.startedAt      ?? prev?.startedAt,
    lastActivityAt: src.lastActivityAt ?? prev?.lastActivityAt,
    main:           src.main           ?? prev?.main,
    hooked:         src.hooked         ?? prev?.hooked,
    registry:       src.registry === null ? undefined : (src.registry ?? prev?.registry),
  }
}

/** A full-record event as a patch: a `registry` the server left out is one that has gone. */
function fullRecord(msg: ServerEvent, sessionId: string): SessionPatch {
  const { type: _type, ...rest } = msg
  return { ...rest, id: sessionId, registry: msg.registry ?? null } as SessionPatch
}

export function useAgentSocket(options: AgentSocketOptions = {}): AgentSocketResult {
  const { onEvent, url = officeWsUrl() } = options

  const [connected, setConnected] = useState(false)
  const [sessions, setSessions]   = useState<SessionInfo[]>([])

  const wsRef          = useRef<WebSocket | null>(null)
  const retryCountRef  = useRef(0)
  const retryTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef     = useRef(true)
  const onEventRef     = useRef(onEvent)

  const clearStableTimer = () => {
    if (stableTimerRef.current) {
      clearTimeout(stableTimerRef.current)
      stableTimerRef.current = null
    }
  }

  useEffect(() => { onEventRef.current = onEvent }, [onEvent])

  const emit = useCallback((event: ServerEvent) => { onEventRef.current?.(event) }, [])

  // ---------------------------------------------------------------------------
  // Session bookkeeping — one entry per Claude Code terminal
  // ---------------------------------------------------------------------------
  const upsertSession = useCallback((id: string, src: SessionPatch) => {
    setSessions(prev => {
      const existing = prev.find(s => s.id === id)
      const next = toSessionInfo(id, src, existing)
      return existing ? prev.map(s => (s.id === id ? next : s)) : [...prev, next]
    })
  }, [])

  const dropSessionLater = useCallback((id: string) => {
    setTimeout(() => {
      if (!mountedRef.current) return
      // Only drop it if it is still ended (a resume brings the same id back)
      setSessions(prev => prev.filter(s => s.id !== id || s.state !== 'ended'))
    }, ENDED_SESSION_LINGER_MS)
  }, [])

  const trackSession = useCallback((msg: ServerEvent) => {
    const id = msg.sessionId
    if (!id) return
    switch (msg.type) {
      case 'session_started':
        upsertSession(id, { ...fullRecord(msg, id), state: 'active', reason: undefined })
        return
      case 'session_ended':
        upsertSession(id, { ...fullRecord(msg, id), state: 'ended' })
        dropSessionLater(id)
        return
      // The registry entry changed: status, name, attached to a hooked session, or gone
      case 'session_registry':
        upsertSession(id, fullRecord(msg, id))
        return
      case 'session_prompt':
        upsertSession(id, { project: msg.project, title: msg.title, main: msg.main })
        return
      case 'session_cwd':
        upsertSession(id, { cwd: msg.cwd, project: msg.project ?? projectFromCwd(msg.cwd), main: msg.main })
        return
      case 'session_model':
        upsertSession(id, { model: msg.model, main: msg.main })
        return
      case 'session_turn_end':
      case 'session_needs_you':
      case 'session_error':
      case 'session_compact':
      case 'session_main':
      case 'session_tool_done':
        if (msg.main) upsertSession(id, { main: msg.main })
        return
      default:
        return
    }
  }, [upsertSession, dropSessionLater])

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------
  const handleMessage = useCallback((raw: string) => {
    let msg: ServerEvent | SnapshotMessage | { type: 'auth' }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object' || msg.type === 'auth') return

    if (msg.type === 'snapshot') {
      const snap = msg as SnapshotMessage
      // The session is healthy: the next drop starts the back-off from scratch
      retryCountRef.current = 0
      clearStableTimer()
      // The server's session list replaces ours (a reconnect may have missed ends)
      const snapSessions = (snap.sessions ?? []).filter(s => s?.id)
      setSessions(snapSessions.map(s => toSessionInfo(s.id, { ...s, registry: s.registry ?? null })))
      for (const s of snapSessions) if (s.state === 'ended') dropSessionLater(s.id)
      // The server's status store replaces ours too (a restart forgets sessions)
      if (snap.statuses) emit({ type: 'session_status', statuses: snap.statuses.sessions ?? [] })
      if (snap.cloud) emit({ type: 'cloud', cloud: snap.cloud } as unknown as ServerEvent)
      if (snap.pokedex) emit({ type: 'pokedex', state: snap.pokedex } as unknown as ServerEvent)
      return
    }

    trackSession(msg as ServerEvent)
    emit(msg as ServerEvent)
  }, [emit, trackSession, dropSessionLater])

  // ---------------------------------------------------------------------------
  // Connect / reconnect
  // ---------------------------------------------------------------------------
  const connect = useCallback(() => {
    if (!mountedRef.current) return

    if (wsRef.current) {
      wsRef.current.onopen    = null
      wsRef.current.onmessage = null
      wsRef.current.onclose   = null
      wsRef.current.onerror   = null
      try { wsRef.current.close() } catch { /* ignore */ }
      wsRef.current = null
    }

    let ws: WebSocket
    try {
      // The token is read at each attempt: one captured since the last try is used at once
      ws = new WebSocket(url, officeWsProtocols())
    } catch {
      scheduleReconnect()
      return
    }

    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      // Not a reset yet: an accept-then-close server must keep backing off
      clearStableTimer()
      stableTimerRef.current = setTimeout(() => {
        stableTimerRef.current = null
        if (mountedRef.current && wsRef.current === ws) retryCountRef.current = 0
      }, STABLE_OPEN_MS)
      setConnected(true)
    }

    ws.onmessage = (evt) => {
      if (!mountedRef.current) return
      handleMessage(evt.data)
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      clearStableTimer()
      setConnected(false)
      scheduleReconnect()
    }
  }, [url, handleMessage])

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    const delay = Math.min(BACKOFF_INITIAL * Math.pow(BACKOFF_FACTOR, retryCountRef.current), BACKOFF_MAX)
    retryCountRef.current += 1
    retryTimerRef.current = setTimeout(() => {
      if (mountedRef.current) connect()
    }, delay)
  }, [connect])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      clearStableTimer()
      if (wsRef.current) {
        wsRef.current.onopen    = null
        wsRef.current.onmessage = null
        wsRef.current.onclose   = null
        wsRef.current.onerror   = null
        try { wsRef.current.close() } catch { /* ignore */ }
        wsRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { connected, sessions }
}
