/**
 * src/meters.ts — the store behind the widget's usage limits and each
 * session's context bar: the pure reducer and the helpers, in plain Node.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  contextTone, dispatchMeters, formatClockTime, getMeters, reduceMeters, resetMeters, subscribeMeters,
  type MetersState, type SessionStatus,
} from '../src/meters'

function session(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: 'sess-1', project: 'spawn', model: 'Haiku 5.5', modelId: 'claude-haiku-5-5',
    context: { used: 4.4, size: 1000000, input: 44051, output: 358 },
    rateLimits: { fiveHour: 12, sevenDay: 40 },
    updatedAt: 1000,
    ...overrides,
  }
}

const EMPTY: MetersState = { sessions: [] }

describe('reduceMeters', () => {
  it('upserts a session_status, most recent first', () => {
    const one = reduceMeters(EMPTY, { type: 'session_status', sessionId: 'sess-1', session: session() })
    expect(one.sessions.map(s => s.sessionId)).toEqual(['sess-1'])

    const two = reduceMeters(one, { type: 'session_status', sessionId: 'sess-2', session: session({ sessionId: 'sess-2', updatedAt: 2000 }) })
    expect(two.sessions.map(s => s.sessionId)).toEqual(['sess-2', 'sess-1'])

    const updated = reduceMeters(two, { type: 'session_status', sessionId: 'sess-1', session: session({ context: { used: 50, size: 200000, input: 1, output: 1 }, updatedAt: 3000 }) })
    expect(updated.sessions.map(s => s.sessionId)).toEqual(['sess-1', 'sess-2'])
    expect(updated.sessions[0].context.used).toBe(50)
  })

  it('the same status again (only its time moved) leaves the state as it is', () => {
    const one = reduceMeters(EMPTY, { type: 'session_status', sessionId: 'sess-1', session: session(), rateLimits: { fiveHour: 12 } })
    const again = reduceMeters(one, { type: 'session_status', sessionId: 'sess-1', session: session({ updatedAt: 5000 }), rateLimits: { fiveHour: 12 } })
    expect(again).toBe(one)
    const moved = reduceMeters(one, { type: 'session_status', sessionId: 'sess-1', session: session({ updatedAt: 5000 }), rateLimits: { fiveHour: 13 } })
    expect(moved).not.toBe(one)
  })

  it("keeps Codex's usage limits apart, from events and from the snapshot", () => {
    const cx = { primary: { usedPercent: 12, windowMinutes: 300, resetsAt: 1 }, secondary: null, at: 5 }
    const one = reduceMeters(EMPTY, { type: 'session_status', sessionId: 'cx', session: session({ sessionId: 'cx' }), rateLimits: { fiveHour: 3 }, codexLimits: cx } as any)
    expect(one.codexLimits).toEqual(cx)
    expect(one.limits).toEqual({ fiveHour: 3 })
    const next = reduceMeters(one, { type: 'session_status', sessionId: 'sess-1', session: session() } as any)
    expect(next.codexLimits).toEqual(cx)
    const snap = reduceMeters(EMPTY, { type: 'session_status', statuses: [], rateLimits: undefined, codexLimits: cx } as any)
    expect(snap.codexLimits).toEqual(cx)
  })

  it('the snapshot form replaces everything', () => {
    const prev = reduceMeters(EMPTY, { type: 'session_status', sessionId: 'gone', session: session({ sessionId: 'gone' }) })
    const next = reduceMeters(prev, { type: 'session_status', statuses: [session({ sessionId: 'a', updatedAt: 1 }), session({ sessionId: 'b', updatedAt: 2 })] })
    expect(next.sessions.map(s => s.sessionId)).toEqual(['b', 'a'])
    expect(reduceMeters(next, { type: 'session_status', statuses: [] }).sessions).toEqual([])
  })

  it('removes an expired session and ignores removals of unknown ones', () => {
    const prev = reduceMeters(EMPTY, { type: 'session_status', sessionId: 'sess-1', session: session() })
    expect(reduceMeters(prev, { type: 'session_status', sessionId: 'nope', removed: true })).toBe(prev)
    expect(reduceMeters(prev, { type: 'session_status', sessionId: 'sess-1', removed: true }).sessions).toEqual([])
  })

  it('leaves other events alone', () => {
    const prev = reduceMeters(EMPTY, { type: 'session_status', sessionId: 'sess-1', session: session() })
    expect(reduceMeters(prev, { type: 'session_main', sessionId: 'sess-1' })).toBe(prev)
    expect(reduceMeters(prev, { type: 'session_status' })).toBe(prev)
  })
})

describe('store', () => {
  beforeEach(() => resetMeters())

  it('dispatch updates the state and notifies subscribers once per change', () => {
    let calls = 0
    const unsubscribe = subscribeMeters(() => { calls++ })
    dispatchMeters({ type: 'session_status', sessionId: 'sess-1', session: session() })
    dispatchMeters({ type: 'pokedex' })
    expect(calls).toBe(1)
    expect(getMeters().sessions).toHaveLength(1)
    unsubscribe()
    dispatchMeters({ type: 'session_status', sessionId: 'sess-1', removed: true })
    expect(calls).toBe(1)
    expect(getMeters().sessions).toHaveLength(0)
  })
})

describe('presentation', () => {
  it('context tone: amber above 70 %, red above 90 %', () => {
    expect(contextTone(null)).toBe('ok')
    expect(contextTone(70)).toBe('ok')
    expect(contextTone(70.1)).toBe('warn')
    expect(contextTone(90)).toBe('warn')
    expect(contextTone(90.1)).toBe('danger')
  })

  it('reset times read as local HH:MM', () => {
    const at = new Date(2026, 10, 6, 9, 5).getTime() / 1000
    expect(formatClockTime(at)).toBe('09:05')
  })
})

describe('formatResetDay: when a weekly limit resets', () => {
  it('shows only the date on any other day, only the time on the day itself', async () => {
    const { formatResetDay, formatResetFull } = await import('../src/meters')
    const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()
    const reset = at(2026, 11, 17, 17, 0) / 1000
    expect(formatResetDay(reset, at(2026, 11, 13, 9, 0))).toBe('11/17')
    expect(formatResetDay(reset, at(2026, 11, 16, 23, 59))).toBe('11/17')
    expect(formatResetDay(reset, at(2026, 11, 17, 0, 0))).toBe('17:00')
    expect(formatResetDay(reset, at(2026, 11, 17, 16, 59))).toBe('17:00')
    // the same day number in another month is not "today"
    expect(formatResetDay(reset, at(2026, 10, 17, 12, 0))).toBe('11/17')
    expect(formatResetFull(reset)).toBe('11/17 17:00')
  })
})
