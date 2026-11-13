/* toastQueue.ts — the line of notification cards waiting behind the one on screen (Toast.tsx) */

/**
 * A new event arrives: it joins the line, and when no card is on screen the first in line is
 * shown. `waiting` counts only the ones still behind the card on screen (the "+n" on it).
 * (Before 1.3.49 the count was taken before the card left the line, so a lone card said "+1".)
 */
export function admit<T>(queue: T[], shown: T | null, e: T): { shown: T | null; waiting: number } {
  queue.push(e)
  const now = shown ?? queue.shift() ?? null
  return { shown: now, waiting: queue.length }
}
