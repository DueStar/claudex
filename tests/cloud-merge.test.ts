/**
 * server/merge.js — the cloud sync's union of two saved games: nothing caught
 * on either PC is lost, the party stays valid, the box keeps its limit, and
 * merging again changes nothing.
 */

import { describe, expect, it } from 'vitest'
import { mergeGames, sameGame } from '../server/merge.js'
import { BOX_LIMIT, PARTY_SIZE, monKey } from '../server/pokedex.js'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 1)

/** An individual as pokedex.js saves it */
function mon(uid: string, dex: number, at: number, extra: Record<string, any> = {}) {
  return { uid, dex, steps: 0, evos: 0, shiny: false, how: 'wild', place: '숲', at, gender: 'male', nature: 1, via: null, ball: 'poke-ball', metLevel: 10, workMs: 0, ...extra }
}

/** A saved game: party first, then box; caught/seen filled from the individuals */
function game(party: any[], box: any[] = [], extra: Record<string, any> = {}) {
  const mons: Record<string, any> = {}
  const caught: Record<string, any> = {}
  const seen: Record<string, number> = {}
  for (const m of [...party, ...box]) {
    mons[m.uid] = m
    const c = caught[m.dex]
    if (c) { c.count++; c.lastAt = Math.max(c.lastAt, m.at) } else caught[m.dex] = { count: 1, firstAt: m.at, lastAt: m.at, place: m.place, how: m.how, shiny: m.shiny, ball: m.ball }
    seen[m.dex] = (seen[m.dex] ?? 0) + 1
  }
  const nums = Object.keys(mons).map(u => Number(u.slice(1)))
  return {
    version: 2,
    caught, seen,
    trainer: { starter: 1, since: T0 },
    mons,
    party: party.map(m => m.uid),
    box: box.map(m => m.uid),
    assign: {}, projects: {},
    nextUid: (nums.length ? Math.max(...nums) : 0) + 1,
    encounters: 0, sinceLegend: 0, sinceMythical: 0,
    attendedOn: null,
    log: [],
    ...extra,
  }
}

/** The individuals as a set of comparable facts (uids can be renamed) */
const individuals = (g: any) => Object.values(g.mons).map((m: any) => `${m.dex}@${m.at}`).sort()

/** The invariants every merge result keeps */
function expectValid(g: any) {
  expect(g.party.length).toBeLessThanOrEqual(PARTY_SIZE)
  expect(new Set(g.party).size).toBe(g.party.length)
  for (const u of g.party) expect(g.mons[u]).toBeTruthy()
  expect(new Set(g.box).size).toBe(g.box.length)
  for (const u of g.box) { expect(g.mons[u]).toBeTruthy(); expect(g.party).not.toContain(u) }
  // every individual is in exactly one place
  expect([...g.party, ...g.box].sort()).toEqual(Object.keys(g.mons).sort())
  expect(g.box.length).toBeLessThanOrEqual(BOX_LIMIT)
  for (const [u, m] of Object.entries<any>(g.mons)) expect(m.uid).toBe(u)
  for (const u of Object.values(g.assign)) expect(g.mons[u as string]).toBeTruthy()
  const n = Math.max(0, ...Object.keys(g.mons).map(u => Number(u.slice(1))))
  expect(g.nextUid).toBeGreaterThan(n)
}

// Two PCs of one trainer: they shared m1..m3 at the last sync, then each
// caught different Pokémon under the same next uids (m4, m5).
const shared = [mon('m1', 1, T0, { how: 'starter', steps: 50, workMs: 3_600_000 }), mon('m2', 10, T0 + 1), mon('m3', 16, T0 + 2)]
function twoPCs() {
  const a = game(shared.slice(0, 2), [shared[2], mon('m4', 19, T0 + DAY), mon('m5', 21, T0 + DAY + 5)], { encounters: 40, sinceLegend: 30 })
  const b = game(shared.slice(0, 2), [shared[2], mon('m4', 23, T0 + 2 * DAY)], { encounters: 55, sinceLegend: 3, attendedOn: '2026-01-03' })
  return { a: structuredClone(a), b: structuredClone(b) }
}

describe('mergeGames: individuals', () => {
  it('unions both PCs\' individuals; a uid both PCs used for different catches is kept by the earlier one, the other gets a fresh uid', () => {
    const { a, b } = twoPCs()
    const m = mergeGames(a, b)
    expectValid(m)
    expect(individuals(m)).toEqual([...individuals(a), '23@' + (T0 + 2 * DAY)].sort())
    // m4 was caught first on A: A's keeps it; B's m4 is renamed past both counters
    expect(m.mons.m4.dex).toBe(19)
    const renamed = Object.values<any>(m.mons).find(x => x.dex === 23)
    expect(renamed.uid).toBe('m6')
    expect(renamed.originUid).toBe('m4')
    expect(m.nextUid).toBe(7)
    expect(m.box).toContain('m6')
  })

  it('gives the same individuals and Pokédex whichever side is passed first, and leaves its inputs alone', () => {
    const { a, b } = twoPCs()
    const before = structuredClone([a, b])
    const ab = mergeGames(a, b)
    const ba = mergeGames(b, a)
    expect(ab.mons).toEqual(ba.mons)
    expect(ab.caught).toEqual(ba.caught)
    expect(ab.seen).toEqual(ba.seen)
    expect(ab.nextUid).toBe(ba.nextUid)
    expect([a, b]).toEqual(before)
  })

  it('the same individual on both sides keeps its furthest progress: higher level (work time), more steps, its evolution', () => {
    const base = mon('m1', 4, T0, { how: 'starter' })
    const a = game([{ ...base, steps: 300, workMs: 9 * 3_600_000 }])
    const b = game([{ ...base, dex: 5, evos: 1, steps: 200, workMs: 5 * 3_600_000, gender: null }])
    for (const m of [mergeGames(a, b), mergeGames(b, a)]) {
      expect(Object.keys(m.mons)).toEqual(['m1'])
      expect(m.mons.m1).toMatchObject({ dex: 5, evos: 1, steps: 300, workMs: 9 * 3_600_000, gender: 'male', at: T0 })
      expect(m.mons.m1.originUid).toBeUndefined()
    }
  })

  it('recognises an individual renamed by an earlier merge on the PC that still has it under its old uid', () => {
    const { a, b } = twoPCs()
    const cloud = mergeGames(a, b) // A synced: B's m4 is m6 in the cloud
    const onB = mergeGames(b, cloud) // B syncs later
    expectValid(onB)
    expect(individuals(onB)).toEqual(individuals(cloud))
    expect(onB.mons).toEqual(cloud.mons)
    // B's party and box now point at the merged uids
    expect(onB.party).toEqual(['m1', 'm2'])
    expect(onB.box).toContain('m6')
    expect(onB.box).not.toContain(undefined)
  })
})

describe('mergeGames: party', () => {
  it('keeps this PC\'s party; the other PC\'s party members live on in the box', () => {
    const a = game([mon('m1', 1, T0), mon('m2', 10, T0 + 1)], [mon('m3', 16, T0 + 2)])
    const b = game([mon('m3', 16, T0 + 2), mon('m1', 1, T0)], [mon('m2', 10, T0 + 1), mon('m4', 19, T0 + 3)])
    const m = mergeGames(a, b)
    expectValid(m)
    expect(m.party).toEqual(['m1', 'm2'])
    expect(m.box).toEqual(expect.arrayContaining(['m3', 'm4']))
  })

  it('a broken local party is cleaned: no repeats, no missing uids, never more than six', () => {
    const mons = Array.from({ length: 8 }, (_, i) => mon(`m${i + 1}`, 10 + i, T0 + i))
    const a = game(mons.slice(0, 6), mons.slice(6))
    a.party = ['m1', 'm1', 'm99', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']
    a.box = ['m8']
    const m = mergeGames(a, game([mons[0]]))
    expectValid(m)
    expect(m.party).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6'])
    expect(m.box).toEqual(expect.arrayContaining(['m7', 'm8']))
  })

  it('this PC\'s session assignments follow renamed uids and never point at nothing', () => {
    const { a, b } = twoPCs()
    b.party = ['m1', 'm4']
    b.box = ['m2', 'm3']
    b.assign = { s1: 'm4', s2: 'm77' }
    b.projects = { s1: 'proj' }
    const m = mergeGames(b, a)
    expectValid(m)
    expect(m.party).toEqual(['m1', 'm6'])
    expect(m.assign).toEqual({ s1: 'm6' })
    expect(m.projects).toEqual({ s1: 'proj' })
  })

  it('a new PC signing in (fresh trainer, party never used) gets the old trainer and team; its fresh six join the box', () => {
    const old = game([mon('m1', 7, T0, { how: 'starter', steps: 900, workMs: 50 * 3_600_000 }), mon('m2', 10, T0, { how: 'gift', steps: 20 })], [mon('m3', 16, T0 + DAY)])
    const freshSix = Array.from({ length: 6 }, (_, i) => mon(`m${i + 1}`, 19 + 2 * i, T0 + 30 * DAY, { how: i ? 'gift' : 'starter', place: '여행의 시작' }))
    const fresh = game(freshSix, [], { trainer: { starter: 19, since: T0 + 30 * DAY } })
    const m = mergeGames(fresh, old)
    expectValid(m)
    expect(m.trainer).toEqual(old.trainer)
    expect(m.party.map((u: string) => m.mons[u].dex)).toEqual([7, 10])
    expect(Object.keys(m.mons)).toHaveLength(9) // 3 old + the fresh six, all kept
    // and the old PC keeps its own party when it merges the new PC's upload
    const back = mergeGames(old, m)
    expect(back.party).toEqual(['m1', 'm2'])
    expect(back.mons).toEqual(m.mons)
  })
})

describe('mergeGames: box limit', () => {
  it('past BOX_LIMIT the newest catches go to the professor: kept in the Pokédex and the log, never in either party', () => {
    const party = [mon('m1', 1, T0)]
    const boxA = Array.from({ length: BOX_LIMIT - 2 }, (_, i) => mon(`m${i + 2}`, 10, T0 + 10 + i))
    const a = game(party, boxA)
    // B shares m1..m3, and has five newer catches of its own (uids A also used)
    // plus a party member that is the very newest
    const newer = Array.from({ length: 5 }, (_, i) => mon(`m${i + 4}`, 151, T0 + 10 * DAY + i))
    const bParty = mon('m9', 150, T0 + 20 * DAY)
    const b = game([party[0], bParty], [boxA[0], boxA[1], ...newer])
    const m = mergeGames(a, b)
    expectValid(m)
    expect(m.box).toHaveLength(BOX_LIMIT)
    // 1 + 1198 + 5 + 1 = 1205 individuals, party of 1: box would be 1204, four go
    expect(Object.keys(m.mons)).toHaveLength(BOX_LIMIT + 1)
    const gone = m.log.filter((e: any) => e.kind === 'professor')
    expect(gone).toHaveLength(4)
    expect(gone.every((e: any) => e.id === 151 && e.toProfessor)).toBe(true)
    // B's party member stays (in A's box), though it is the newest of all
    expect(Object.values<any>(m.mons).some(x => x.dex === 150)).toBe(true)
    // the species stays caught, its first catch kept
    expect(m.caught[151]).toMatchObject({ count: 5, firstAt: T0 + 10 * DAY })
    // and merging again sends no one else away
    const again = mergeGames(a, m)
    expect(again).toEqual(m)
  })
})

describe('mergeGames: Pokédex', () => {
  it('seen and caught are either side\'s; first catch is the earlier one (with its place), last the later; counts take the larger side; shiny is either', () => {
    const a = game([mon('m1', 1, T0)])
    const b = game([mon('m1', 1, T0)])
    a.caught = { 1: { count: 3, firstAt: T0 + 100, lastAt: T0 + 500, place: 'A숲', how: 'wild', shiny: false }, 4: { count: 1, firstAt: T0, lastAt: T0, place: 'A', shiny: false } }
    b.caught = { 1: { count: 2, firstAt: T0 + 50, lastAt: T0 + 900, place: 'B동굴', how: 'pity', shiny: true }, 7: { count: 1, firstAt: T0, lastAt: T0, place: 'B', shiny: false } }
    a.seen = { 1: 5, 4: 1, 25: 2 }
    b.seen = { 1: 3, 7: 1, 25: 4 }
    for (const m of [mergeGames(a, b), mergeGames(b, a)]) {
      expect(Object.keys(m.caught).sort()).toEqual(['1', '4', '7'])
      expect(m.caught[1]).toEqual({ count: 3, firstAt: T0 + 50, lastAt: T0 + 900, place: 'B동굴', how: 'pity', shiny: true })
      expect(m.seen).toEqual({ 1: 5, 4: 1, 7: 1, 25: 4 })
    }
  })

  it('counts are not added up: syncing the same catches again does not count them twice', () => {
    const { a, b } = twoPCs()
    const m1 = mergeGames(a, b)
    const m2 = mergeGames(m1, mergeGames(b, m1))
    expect(m2.caught).toEqual(m1.caught)
    expect(m2.seen).toEqual(m1.seen)
  })
})

describe('mergeGames: the other fields', () => {
  it('monotonic counters take the larger side; luck, projects and today\'s count stay this PC\'s; unknown fields keep this PC\'s value', () => {
    const { a, b } = twoPCs()
    Object.assign(a, { daily: { day: '2026-01-02', catches: 4 }, thrownAt: { s: 1 }, futureA: 'mine', both: 'local' })
    Object.assign(b, { daily: { day: '2026-01-03', catches: 9 }, futureB: 'theirs', both: 'remote', version: 2 })
    const m = mergeGames(a, b)
    expect(m.encounters).toBe(55)
    expect(m.attendedOn).toBe('2026-01-03')
    expect(m.sinceLegend).toBe(30)
    expect(m.daily).toEqual({ day: '2026-01-02', catches: 4 })
    expect(m.thrownAt).toEqual({ s: 1 })
    expect(m.futureA).toBe('mine')
    expect(m.futureB).toBe('theirs')
    expect(m.both).toBe('local')
    expect(m.version).toBe(2)
  })

  it('the log keeps both PCs\' events once, oldest first, with renamed uids', () => {
    const { a, b } = twoPCs()
    const common = { kind: 'catch', id: 16, uid: 'm3', at: T0 + 2 }
    a.log = [common, { kind: 'catch', id: 19, uid: 'm4', at: T0 + DAY }]
    b.log = [common, { kind: 'catch', id: 23, uid: 'm4', at: T0 + 2 * DAY }]
    const m = mergeGames(a, b)
    expect(m.log).toEqual([common, { kind: 'catch', id: 19, uid: 'm4', at: T0 + DAY }, { kind: 'catch', id: 23, uid: 'm6', at: T0 + 2 * DAY }])
  })

  it('ignores a side that is not a version-2 game', () => {
    const { a } = twoPCs()
    expect(mergeGames(a, null)).toEqual(a)
    expect(mergeGames(a, { version: 1, caught: { 999: {} } })).toEqual(a)
    expect(mergeGames(undefined, a)).toEqual(a)
  })
})

describe('mergeGames: idempotence', () => {
  it('merge(a, merge(a, b)) equals merge(a, b), and merging the result with either side again changes nothing', () => {
    const { a, b } = twoPCs()
    a.log = [{ kind: 'catch', id: 19, uid: 'm4', at: T0 + DAY }]
    b.log = [{ kind: 'catch', id: 23, uid: 'm4', at: T0 + 2 * DAY }]
    a.assign = { s: 'm2' }
    const ab = mergeGames(a, b)
    expect(mergeGames(a, ab)).toEqual(ab)
    expect(sameGame(mergeGames(ab, b), ab)).toBe(true)
    expect(sameGame(mergeGames(ab, ab), ab)).toBe(true)
    const ba = mergeGames(b, a)
    expect(mergeGames(b, ba)).toEqual(ba)
    // the two PCs converge on the same individuals after each syncs once
    expect(mergeGames(b, ab).mons).toEqual(ab.mons)
  })
})

describe('released individuals', () => {
  const p = [mon('m1', 4, T0), mon('m2', 7, T0 + 1)]
  const kept = mon('m3', 25, T0 + DAY)
  const letGo = mon('m4', 16, T0 + 2 * DAY)
  const before = game(p, [kept, letGo])
  // This PC let m4 go after the last upload: the cloud copy still has it
  const after = game(p, [kept], { released: { [monKey(letGo)]: T0 + 3 * DAY } })

  it('a release sticks: the copy uploaded before it does not bring the Pokémon back', () => {
    const merged = mergeGames(after, before)
    expectValid(merged)
    expect(individuals(merged)).toEqual(individuals(after))
    expect(merged.released).toEqual(after.released)
  })

  it('the other PC drops it too on its next sync, and the release is remembered on both', () => {
    const cloud = mergeGames(after, before) // what this PC uploads
    const other = mergeGames(before, cloud) // the other PC still had m4
    expectValid(other)
    expect(Object.values(other.mons).some((m: any) => m.dex === 16)).toBe(false)
    expect(other.released).toEqual(after.released)
  })

  it('stays idempotent and order-free with releases', () => {
    const once = mergeGames(after, before)
    expect(sameGame(mergeGames(after, once), once)).toBe(true)
    expect(individuals(mergeGames(before, after))).toEqual(individuals(once))
  })
})
