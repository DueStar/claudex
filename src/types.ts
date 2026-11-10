import type { SessionStatus, MeterTotals, SavedLimits, CodexLimits } from './meters'

/** What a session's main thread (its Claude) is doing — the server's `main.state` */
export type MainState = 'working' | 'waiting' | 'idle' | 'needs-you' | 'error' | 'compacting'

/** `registry`: an unhooked session whose registry status is "waiting" (a dialog or question in its terminal) */
export type NeedsYouKind = 'permission' | 'idle' | 'quota' | 'agent-input' | 'registry'

/** Why a session is waiting on a person (session_needs_you / main.needsYou) */
export interface NeedsYou {
  kind: NeedsYouKind
  toolName?: string
  summary?: string
  message?: string
  notificationType?: string
  promptId?: string
  since?: number
}

/**
 * The server's per-session main-thread record. Travels as `main` on the WS
 * snapshot's sessions, GET /sessions and every session_* broadcast.
 */
export interface SessionMain {
  state: MainState
  since?: number
  lastPrompt?: string
  lastPromptAt?: number
  lastReply?: string
  lastReplyAt?: number
  waitingOn?: number
  crons?: number
  needsYou?: NeedsYou
  error?: { error: string; detail?: string; since?: number }
  promptId?: string
}

/**
 * A Claude Code session the server knows about — one per terminal. Mirrors
 * the server's GET /sessions entries and session_started/session_ended events.
 */
export interface SessionInfo {
  id: string
  project?: string
  cwd?: string
  title?: string
  model?: string
  source?: string           // startup | resume | compact | clear | fork | implicit
  state: 'active' | 'ended'
  reason?: string           // why it ended
  startedAt?: number
  lastActivityAt?: number
  /** The server's main-thread record, once it sends one */
  main?: SessionMain
  /** false: known only from Claude Code's session registry (no hook has reported yet) */
  hooked?: boolean
  /** Its entry in Claude Code's session registry, while its process runs */
  registry?: SessionRegistry
}

/**
 * What the server keeps of a ~/.claude/sessions/<pid>.json entry (server/
 * sessions.js): presence and status only. `status` is Claude Code's own word
 * (busy | shell | idle | waiting).
 */
export interface SessionRegistry {
  pid: number
  name?: string
  nameSource?: string
  status?: string
  kind?: string
  version?: string
  startedAt?: number
  statusUpdatedAt?: number
}

/** A message from the server's WebSocket that the app acts on */
export interface ServerEvent {
  type:
    | 'session_started' | 'session_ended' | 'session_registry'
    // The turn events (UserPromptSubmit, Stop, PermissionRequest/Notification, StopFailure,
    // Pre/PostCompact, CwdChanged, PostModelSwitch), session_main (a server-side change)
    // and session_tool_done (main-thread PostToolUse, the input that lowers a hand)
    | 'session_prompt' | 'session_turn_end' | 'session_needs_you' | 'session_error' | 'session_compact'
    | 'session_cwd' | 'session_model' | 'session_main' | 'session_tool_done'
    // The status line's numbers (src/meters.ts)
    | 'session_status'
    // The game (src/pokedexStore.ts) and the cloud sign-in (src/cloudStore.ts)
    | 'pokedex' | 'cloud'
  /** The Claude Code session the event came from */
  sessionId?: string
  project?: string
  // session_started / session_ended / session_registry: the whole session record
  cwd?: string
  source?: string
  model?: string
  title?: string
  state?: 'active' | 'ended'
  reason?: string
  startedAt?: number
  lastActivityAt?: number
  hooked?: boolean
  registry?: SessionRegistry
  // Every session_* broadcast carries the session's main-thread record
  main?: SessionMain
  // session_status: one session's numbers, or the snapshot's whole store (`statuses`)
  session?: SessionStatus
  statuses?: SessionStatus[]
  /** session_status: the last usage limits any session reported (server/status.js) */
  rateLimits?: SavedLimits
  /** session_status: Codex CLI's usage limits, kept apart from Claude's (electron/codexWatch.cjs) */
  codexLimits?: CodexLimits
  totals?: MeterTotals
  removed?: boolean
  timestamp?: number
}
