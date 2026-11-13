/**
 * src/termMetrics.ts: what the Mac CI's smoke launch reads from the page about
 * each open terminal (its font stack, size and measured cell), read only.
 */

import { describe, expect, it } from 'vitest'
import { facePresent, stackFaces, termMetrics, trackTermMetrics, type TermMetrics } from '../src/termMetrics'

const m = (id: string): TermMetrics => ({ id, fontFamily: 'Menlo, monospace', fontSize: 13, cellWidth: 7.8, cellHeight: 15, cols: 80, rows: 24, faces: [], text: '' })

describe('termMetrics', () => {
  it('the faces of a stack, quotes off', () => {
    expect(stackFaces("'Monaspace Neon Var', \"Monaspace Neon\", Menlo, 'SF Mono', monospace")).toEqual(['Monaspace Neon Var', 'Monaspace Neon', 'Menlo', 'SF Mono', 'monospace'])
    expect(stackFaces('')).toEqual([])
  })

  it('terminals register and leave; a reader that throws is skipped', () => {
    const off1 = trackTermMetrics('a', () => m('a'))
    const off2 = trackTermMetrics('b', () => { throw new Error('gone') })
    expect(termMetrics().map(x => x.id)).toEqual(['a'])
    off1(); off2()
    expect(termMetrics()).toEqual([])
  })

  it('a generic family is always there; without a page nothing else is', () => {
    expect(facePresent('monospace')).toBe(true)
    expect(facePresent('Menlo')).toBe(false) // no document here
  })
})
