/**
 * src/terminalReplay.ts — opening a tab while its session prints writes
 * each piece of output once, in order.
 */

import { describe, expect, it } from 'vitest'
import { createReplayGate } from '../src/terminalReplay'

const gate = () => { const out: string[] = []; return { out, g: createReplayGate(d => out.push(d)) } }

describe('terminal replay', () => {
  it('a batch that arrived before the replay and is inside it is written once', () => {
    const { out, g } = gate()
    g.live('b', 2)          // sent before main answered: in the replay already
    g.replay('ab', 2)
    g.live('c', 3)
    expect(out.join('')).toBe('abc')
  })

  it('a batch newer than the replay that arrived before it is written after it', () => {
    const { out, g } = gate()
    g.live('c', 3)          // the reply came later than this batch
    g.replay('ab', 2)
    expect(out.join('')).toBe('abc')
  })

  it('no replay: what was held is written and output goes live', () => {
    const { out, g } = gate()
    g.live('x', 1)
    g.fail()
    g.live('y', 2)
    expect(out.join('')).toBe('xy')
  })
})
