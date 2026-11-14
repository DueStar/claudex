/**
 * src/termMetrics.ts: what the Mac CI's smoke launch reads from the page about
 * each open terminal (its font stack, size and measured cell), read only.
 */

import { describe, expect, it, vi } from 'vitest'
import { BUNDLED_CHECKS, facePresent, faceStatus, faceSupplies, fontStatus, registerSmokeGlobals, stackFaces, termMetrics, trackTermMetrics, type TermMetrics } from '../src/termMetrics'

const m = (id: string): TermMetrics => ({ id, fontFamily: 'Menlo, monospace', fontSize: 13, cellWidth: 7.8, cellHeight: 15, cols: 80, rows: 24, faces: [], text: '' })

describe('termMetrics', () => {
  it('the page globals exist only once registered (a smoke run); loading the module adds none', async () => {
    const fakeWindow: Record<string, unknown> = {}
    vi.stubGlobal('window', fakeWindow)
    vi.resetModules()
    await import('../src/termMetrics')
    expect(fakeWindow.spawnTermMetrics).toBeUndefined()
    expect(fakeWindow.spawnFontStatus).toBeUndefined()
    const target: Record<string, unknown> = {}
    registerSmokeGlobals(target)
    expect(typeof target.spawnTermMetrics).toBe('function')
    expect(typeof target.spawnFontStatus).toBe('function')
    vi.unstubAllGlobals()
  })

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
    expect(faceStatus('W Uncut')).toBe(null)
    expect(faceSupplies('W Uncut', 'é')).toBe(false)
  })

  it('the page font status covers the three bundled faces, each with a sample of its own script', () => {
    expect(BUNDLED_CHECKS.map(c => c.face)).toEqual(['Monaspace Neon Var', 'W Uncut', 'W Pretendard'])
    expect(BUNDLED_CHECKS.find(c => c.face === 'W Uncut')!.text).toContain('é')
    expect(fontStatus().map(f => [f.face, f.status, f.supplied])).toEqual([['Monaspace Neon Var', null, false], ['W Uncut', null, false], ['W Pretendard', null, false]])
  })
})
