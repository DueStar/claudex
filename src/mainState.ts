/**
 * mainState.ts — pure helpers for a session's main-thread state (what the
 * session's own Claude is doing). No React, no DOM, no clock.
 *
 * The states are the server's `main.state` values: working (a turn is
 * running), waiting (the turn ended but background workers are still out),
 * idle (turn over, nothing pending), needs-you (a permission dialog, an idle
 * prompt, a quota pause or a worker asking for input), error (StopFailure)
 * and compacting (PreCompact → PostCompact).
 */

import type { NeedsYou, NeedsYouKind } from './types'

/**
 * Kinds that need a person at the keyboard right now — `registry` included:
 * Claude Code marks an unhooked session "waiting" exactly while a dialog or a
 * question is on its screen. The other two are soft: `idle` is Claude Code
 * nudging an absent user, `quota` is a usage pause nobody can shorten.
 */
export const HARD_NEEDS_YOU: ReadonlySet<NeedsYouKind> = new Set<NeedsYouKind>(['permission', 'agent-input', 'registry'])

export function isHardNeedsYou(needsYou: NeedsYou | undefined): boolean {
  return !!needsYou && HARD_NEEDS_YOU.has(needsYou.kind)
}

/** Last path segment of a cwd ("/Users/me/src/claudex/" → "claudex") */
export function projectFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const seg = trimmed.split(/[\\/]/).pop()
  return seg || trimmed || undefined
}
