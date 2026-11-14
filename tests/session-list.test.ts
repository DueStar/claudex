/**
 * src/sessionList.ts — the left list's pure helpers. hpTone: the colour of a session's
 * context bar (what is left of the window, drained like a Pokémon's HP).
 */

import { describe, expect, it } from 'vitest'
import { hpTone } from '../src/sessionList'

describe('hpTone', () => {
  it('nothing reported yet: the full, dimmed bar', () => {
    expect(hpTone(null)).toBe('hp-full')
  })

  it('green above half, amber at half and under, red at a fifth and under', () => {
    expect(hpTone(100)).toBe('hp-green')
    expect(hpTone(51)).toBe('hp-green')
    expect(hpTone(50)).toBe('hp-yellow')
    expect(hpTone(21)).toBe('hp-yellow')
    expect(hpTone(20)).toBe('hp-red')
    expect(hpTone(0)).toBe('hp-red')
  })
})
