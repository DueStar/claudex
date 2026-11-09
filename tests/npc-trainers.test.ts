/**
 * src/npcTrainers.ts — the board's NPC trainers: seeded, moving by the hour,
 * stepping aside as real trainers join.
 */

import { describe, expect, it } from 'vitest'
import { NPC_COUNT, NPC_TRAINERS, npcsFor } from '../src/npcTrainers'

const at = (days: number) => Date.UTC(2026, 10, 8, 15) + days * 86_400_000 + 3 * 3_600_000

describe('npcTrainers', () => {
  it('108 trainers, about 70% Korean, Pokédex counts within 180 at the start', () => {
    expect(NPC_TRAINERS).toHaveLength(NPC_COUNT)
    expect(NPC_COUNT).toBe(108)
    const ko = NPC_TRAINERS.filter(n => /[가-힣]/.test(n.nickname)).length
    expect(ko / NPC_COUNT).toBeGreaterThan(0.6)
    expect(ko / NPC_COUNT).toBeLessThan(0.8)
    const now = npcsFor(0, at(0))
    expect(Math.max(...now.map(n => n.caught))).toBeLessThanOrEqual(180)
    expect(now.filter(n => n.caught > 90).length).toBeGreaterThan(20)
  })

  it('they keep catching: numbers only grow, slower as the Pokédex fills, and stay below the whole dex', () => {
    const d0 = npcsFor(0, at(0)), d7 = npcsFor(0, at(7)), d90 = npcsFor(0, at(90)), d900 = npcsFor(0, at(900))
    for (let i = 0; i < d0.length; i++) {
      expect(d7[i].caught).toBeGreaterThanOrEqual(d0[i].caught)
      expect(d90[i].caught).toBeGreaterThanOrEqual(d7[i].caught)
      expect(d90[i].shiny).toBeGreaterThanOrEqual(d0[i].shiny)
      expect(d900[i].caught).toBeLessThan(1025)
    }
    expect(d7.reduce((a, n) => a + n.caught, 0)).toBeGreaterThan(d0.reduce((a, n) => a + n.caught, 0))
  })

  it('the week starts over on Monday (KST)', () => {
    // 2026-11-16 is a Monday: just after midnight KST nobody has caught much yet this week
    const monday = Date.UTC(2026, 10, 15, 15, 30)
    const sunday = monday - 3_600_000
    const sum = (t: number) => npcsFor(0, t).reduce((a, n) => a + n.week, 0)
    expect(sum(monday)).toBeLessThan(sum(sunday))
  })

  it('one steps aside for every three real trainers, none left at 324', () => {
    expect(npcsFor(0)).toHaveLength(108)
    expect(npcsFor(2)).toHaveLength(108)
    expect(npcsFor(3)).toHaveLength(107)
    expect(npcsFor(30)).toHaveLength(98)
    expect(npcsFor(324)).toHaveLength(0)
  })
})
