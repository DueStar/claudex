/**
 * meters.ts — each session's numbers from Claude Code's status line, through
 * the server (server/status.js: POST /status → session_status broadcasts,
 * plus `statuses` in the WS snapshot): the context window in use and the
 * subscription's 5-hour / weekly limits.
 *
 * A tiny external store — module state, listeners, useSyncExternalStore.
 * `reduceMeters` is pure and unit-tested in plain Node.
 */

import { useSyncExternalStore } from 'react'
import type { ServerEvent } from './types'

export interface ContextStatus {
  /** Percent of the context window in use (null early in a session) */
  used: number | null
  /** Context window size in tokens (200k, or 1M for extended-context models) */
  size: number | null
  /** Tokens in the window after the last API response (input + cache) */
  input: number
  /** Output tokens of the last API response */
  output: number
}

export interface RateLimitStatus {
  fiveHour?: number
  sevenDay?: number
  spendLimit?: number
  fiveHourResetsAt?: number
  sevenDayResetsAt?: number
  spendLimitResetsAt?: number
}

/** Mirrors server/status.js's public session record (the fields the app reads) */
export interface SessionStatus {
  sessionId: string
  project?: string
  model?: string
  modelId?: string
  context: ContextStatus
  rateLimits?: RateLimitStatus
  updatedAt?: number
}

/** The server's running totals (sent along, not shown) */
export type MeterTotals = Record<string, number>

/** The last usage limits heard, kept when their session is gone (`at`: when) */
export type SavedLimits = RateLimitStatus & { at?: number }

/** One of Codex CLI's usage windows: used %, its length, when it resets (epoch seconds) */
export interface CodexWindow { usedPercent: number; windowMinutes: number | null; resetsAt: number | null }
/** Codex CLI's usage limits (a 5-hour and a weekly window on today's plans) */
export interface CodexLimits { primary: CodexWindow | null; secondary: CodexWindow | null; at?: number }

export interface MetersState {
  /** Most recently updated first */
  sessions: SessionStatus[]
  limits?: SavedLimits
  codexLimits?: CodexLimits
}

export type Tone = 'ok' | 'warn' | 'danger'

const EMPTY: MetersState = { sessions: [] }

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let state: MetersState = EMPTY
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function getMeters(): MetersState {
  return state
}

export function resetMeters() {
  state = EMPTY
  emit()
}

export function subscribeMeters(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useMeters(): MetersState {
  return useSyncExternalStore(subscribeMeters, getMeters, getMeters)
}

/** Forward a session_status event from the socket. */
export function dispatchMeters(event: ServerEvent) {
  const next = reduceMeters(state, event)
  if (next !== state) {
    state = next
    emit()
  }
}

// ---------------------------------------------------------------------------
// Reducer (pure)
// ---------------------------------------------------------------------------

function byRecency(a: SessionStatus, b: SessionStatus) {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
}

/** Alike but for their times (updatedAt, firstSeenAt, a limit's `at`) */
function sameExceptTime(a: unknown, b: unknown): boolean {
  const strip = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'updatedAt' || k === 'firstSeenAt' || k === 'at' ? undefined : x))
  return strip(a) === strip(b)
}

export function reduceMeters(prev: MetersState, event: ServerEvent): MetersState {
  if (event.type !== 'session_status') return prev
  // Snapshot form: the server's whole store replaces ours (a reconnect
  // after a server restart must not keep rows the server forgot)
  if (event.statuses) {
    return { sessions: event.statuses.filter(s => s?.sessionId).slice().sort(byRecency), limits: event.rateLimits, codexLimits: event.codexLimits }
  }
  if (!event.sessionId) return prev
  if (event.removed) {
    if (!prev.sessions.some(s => s.sessionId === event.sessionId)) return prev
    return { ...prev, sessions: prev.sessions.filter(s => s.sessionId !== event.sessionId) }
  }
  if (!event.session) return prev
  const next: SessionStatus = { ...event.session, sessionId: event.sessionId }
  // Only its time moved: the same state, so nothing re-renders
  const limits = event.rateLimits ?? prev.limits
  const codexLimits = event.codexLimits ?? prev.codexLimits
  const old = prev.sessions.find(s => s.sessionId === event.sessionId)
  if (old && sameExceptTime(old, next) && sameExceptTime(prev.limits, limits) && sameExceptTime(prev.codexLimits, codexLimits)) return prev
  return { sessions: [...prev.sessions.filter(s => s.sessionId !== event.sessionId), next].sort(byRecency), limits, codexLimits }
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/**
 * A saved limit as it stands now: once its window has reset (resetsAt, in
 * seconds, is past) nothing of it is used yet.
 */
export function limitNow(pct: number | undefined, resetsAt: number | undefined, now = Date.now()): number | undefined {
  if (typeof pct !== 'number') return undefined
  return typeof resetsAt === 'number' && resetsAt * 1000 <= now ? 0 : pct
}

/**
 * The usage limits' bars: grey until they matter, amber from 80 %, red from 90 % (the limit is
 * about to hit)
 */
export function usageTone(pct: number | null | undefined): Tone {
  if (pct == null) return 'ok'
  if (pct >= 90) return 'danger'
  if (pct >= 80) return 'warn'
  return 'ok'
}

/** A reset time (epoch seconds) as HH:MM, local time */
export function formatClockTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * When a longer limit (weekly) resets, short: on the day it resets only the time (HH:MM),
 * on any other day only the date (M/D). The full "M/D HH:MM" stays in the tooltip.
 */
export function formatResetDay(epochSeconds: number, now = Date.now()): string {
  const d = new Date(epochSeconds * 1000)
  const n = new Date(now)
  const today = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return today ? formatClockTime(epochSeconds) : `${d.getMonth() + 1}/${d.getDate()}`
}

/** The whole moment of a reset, for a tooltip: M/D HH:MM */
export function formatResetFull(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${formatClockTime(epochSeconds)}`
}
