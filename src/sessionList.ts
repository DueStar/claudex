/**
 * sessionList.ts — the left list's pure helpers (unit-tested in plain Node).
 */

export type HpTone = 'hp-full' | 'hp-green' | 'hp-yellow' | 'hp-red'

/**
 * A session's context bar, drawn as the share of the window that is left (a Pokémon's HP):
 * nothing reported yet is the full, dimmed bar; green above half, amber at half and under,
 * red at a fifth and under.
 */
export function hpTone(left: number | null): HpTone {
  if (left === null) return 'hp-full'
  if (left <= 20) return 'hp-red'
  if (left <= 50) return 'hp-yellow'
  return 'hp-green'
}
