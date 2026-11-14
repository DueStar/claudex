/**
 * src/sideWidth.ts — the left panel's width: clamped to 240–420 and to what leaves the
 * terminal 320px, read back from page storage (anything odd gives the 300px default).
 */

import { describe, expect, it } from 'vitest'
import { clampSideWidth, readSideWidth, sideMin, SIDE_DEFAULT, SIDE_KEY, SIDE_MAX, SIDE_MIN, SIDE_MIN_MAC, TERM_MIN } from '../src/sideWidth'

describe('clampSideWidth', () => {
  it('the limits', () => {
    expect([SIDE_MIN, SIDE_MAX, SIDE_DEFAULT, TERM_MIN, SIDE_KEY]).toEqual([240, 420, 300, 320, 'spawn-side-w'])
  })

  it('keeps a width in range, and pulls one outside it to the nearest end', () => {
    expect(clampSideWidth(300, 1440)).toBe(300)
    expect(clampSideWidth(100, 1440)).toBe(240)
    expect(clampSideWidth(900, 1440)).toBe(420)
  })

  it('leaves the terminal at least 320px', () => {
    expect(clampSideWidth(420, 700)).toBe(380)
  })

  it('never goes under 240, even in the narrowest window', () => {
    expect(clampSideWidth(300, 560)).toBe(240)
  })

  it('rounds to whole pixels', () => {
    expect(clampSideWidth(300.6, 1440)).toBe(301)
  })

  it('a Mac: never under 300 (its header starts 78px in, clear of the traffic lights; at 240 it does not fit)', () => {
    expect(SIDE_MIN_MAC).toBe(300)
    expect(sideMin(true)).toBe(300)
    expect(sideMin(false)).toBe(SIDE_MIN)
    expect(clampSideWidth(240, 1440, sideMin(true))).toBe(300)
    expect(clampSideWidth(360, 1440, sideMin(true))).toBe(360)
    expect(clampSideWidth(420, 560, sideMin(true))).toBe(300)
    // Windows as before
    expect(clampSideWidth(240, 1440, sideMin(false))).toBe(240)
  })
})

describe('readSideWidth', () => {
  const store = (v: string | null) => ({ getItem: (k: string) => (k === SIDE_KEY ? v : null) })

  it('nothing stored: the default', () => {
    expect(readSideWidth(null)).toBe(300)
    expect(readSideWidth(undefined)).toBe(300)
    expect(readSideWidth(store(null))).toBe(300)
  })

  it('a stored width in range', () => {
    expect(readSideWidth(store('360'))).toBe(360)
    expect(readSideWidth(store('240'))).toBe(240)
    expect(readSideWidth(store('420'))).toBe(420)
  })

  it('garbage or out of range: the default', () => {
    expect(readSideWidth(store('abc'))).toBe(300)
    expect(readSideWidth(store('9999'))).toBe(300)
    expect(readSideWidth(store('100'))).toBe(300)
    expect(readSideWidth(store(''))).toBe(300)
  })

  it('a storage that throws: the default', () => {
    expect(readSideWidth({ getItem: () => { throw new Error('denied') } })).toBe(300)
  })
})
