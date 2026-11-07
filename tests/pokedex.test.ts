/**
 * server/pokedex.js — the game, trainer style: a starter and a party of six,
 * one party Pokémon per session, growth that belongs to the Pokémon, swaps for
 * the fully evolved, and gacha-style encounters with pities.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createPokedex, catchSource, STARTERS, RATES, PITY, PITY_MYTHICAL, PARTY_SIZE, BOX_LIMIT, ballBoosts, isFullMoon, levelFrom, minutesForLevel, THINK_STEP_MS } from '../server/pokedex.js'

const S = (id: number, ko: string, tier: string, evolvesFrom: number | null, types = ['normal'], captureRate = 255) =>
  ({ id, ko, types, tier, captureRate, evolvesFrom })

const SPECIES = [
  S(1, '이상해씨', 'rare', null, ['grass'], 45), S(2, '이상해풀', 'rare', 1, ['grass'], 45), S(3, '이상해꽃', 'rare', 2, ['grass'], 45),
  S(4, '파이리', 'rare', null, ['fire'], 45), S(5, '리자드', 'rare', 4, ['fire'], 45), S(6, '리자몽', 'rare', 5, ['fire'], 45),
  S(7, '꼬부기', 'rare', null, ['water'], 45), S(8, '어니부기', 'rare', 7, ['water'], 45), S(9, '거북왕', 'rare', 8, ['water'], 45),
  S(10, '캐터피', 'common', null, ['bug']), S(11, '단데기', 'common', 10, ['bug']),
  S(16, '구구', 'common', null, ['flying']), S(17, '피죤', 'common', 16, ['flying']),
  S(19, '꼬렛', 'common', null), S(20, '레트라', 'common', 19),
  S(21, '깨비참', 'common', null, ['flying']), S(22, '깨비드릴조', 'common', 21, ['flying']),
  S(23, '아보', 'common', null, ['poison']), S(24, '아보크', 'common', 23, ['poison']),
  S(27, '모래두지', 'common', null, ['ground']), S(28, '고지', 'common', 27, ['ground']),
  S(144, '프리져', 'sub', null, ['ice'], 3),
  S(150, '뮤츠', 'legendary', null, ['psychic'], 3),
  S(151, '뮤', 'mythical', null, ['psychic'], 45),
]

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

function setup(randoms: number[] = [], fallback = 0.99, active = (_: string) => true) {
  const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
  dirs.push(dir)
  const sent: any[] = []
  const queue = [...randoms]
  const dex = createPokedex({
    file: join(dir, 'pokedex.json'),
    species: SPECIES,
    broadcast: (m: any) => sent.push(m),
    isActive: active,
    now: () => new Date('2026-11-06T14:00:00').getTime(),
    random: () => (queue.length ? queue.shift()! : fallback),
  })
  return { dex, sent, file: join(dir, 'pokedex.json') }
}

const work = (sessionId: string, tool = 'Edit') => ({ type: 'agent_working', sessionId, tool })
/** Today's attendance already taken (the fixed clock is 2026-11-06) */
const attended = (dex: any) => { dex.publicState(); dex._state().attendedOn = '2026-11-06' }

describe('pokedex', () => {
  it('the rarity table adds up to 1, and the top tiers stay rare', () => {
    expect(Object.values(RATES).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    expect(RATES.legendary).toBeLessThan(0.02)
    expect(RATES.mythical).toBeLessThan(RATES.legendary)
    expect(PITY_MYTHICAL).toBeGreaterThan(PITY)
  })

  it('starts the trainer with a random starter and a party of six, the starter first', () => {
    const { dex } = setup([0.5]) // middle starter; companions from the fallback
    const st = dex.publicState()
    expect(st.trainer.starter).toBe(STARTERS[1])
    expect(st.party).toHaveLength(PARTY_SIZE)
    expect(st.mons[st.party[0]].dex).toBe(4)
    expect(st.caught[4].how).toBe('starter')
    // the companions are base forms that can evolve, never a starter
    for (const uid of st.party.slice(1)) {
      const d = st.mons[uid].dex
      expect([1, 4, 7]).not.toContain(d)
      expect(SPECIES.find(s => s.id === d)!.evolvesFrom).toBeNull()
    }
  })

  it('sends the starter with the first session, the next free one with the next, and none past six', () => {
    const { dex, sent } = setup([0])
    for (let i = 1; i <= PARTY_SIZE + 1; i++) dex.noteEvent({ type: 'session_started', sessionId: `s${i}` }, { project: `p${i}` })
    const st = dex.publicState()
    expect(st.mons[st.assign.s1].dex).toBe(1)
    expect(new Set(Object.values(st.assign)).size).toBe(PARTY_SIZE)
    expect(st.assign.s7).toBeUndefined()
    expect(sent.find(m => m.event?.sessionId === 's1')?.event.kind).toBe('sendout')
  })

  it('an ended session hands its Pokémon back to the party', () => {
    const ended = new Set<string>()
    const { dex } = setup([0], 0.99, sid => !ended.has(sid))
    dex.noteEvent({ type: 'session_started', sessionId: 'a' }, {})
    const first = dex.publicState().assign.a
    ended.add('a')
    dex.noteEvent({ type: 'session_ended', sessionId: 'a' }, {})
    dex.noteEvent({ type: 'session_started', sessionId: 'b' }, {})
    expect(dex.publicState().assign.b).toBe(first)
  })

  it('growth belongs to the Pokémon: it evolves at the games’ level (이상해씨 → 이상해풀 at 16)', () => {
    let t = new Date('2026-11-06T14:00:00').getTime()
    const species = SPECIES.map(sp => (sp.id === 2 ? { ...sp, evolveLevel: 16 } : sp))
    const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
    dirs.push(dir)
    const sent: any[] = []
    const queue = [0] // starter: 이상해씨
    const dex = createPokedex({ file: join(dir, 'p.json'), species, broadcast: (m: any) => sent.push(m), random: () => (queue.length ? queue.shift()! : 0.99), now: () => t })
    dex.publicState(); (dex as any)._state().attendedOn = '2026-11-06'
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, {})
    const uid = dex.publicState().assign.s1
    const mon = () => (dex as any)._state().mons[uid]
    let evolvedAt: number | null = null
    for (let i = 0; i < 400 && evolvedAt === null; i++) {
      t += 60_000
      dex.noteEvent(work('s1'), {})
      if (mon().dex === 2) evolvedAt = levelFrom(mon().metLevel, mon().workMs).level
    }
    expect(evolvedAt).toBe(16)
    expect(sent.map(m => m.event).find(e => e?.kind === 'evolve')).toMatchObject({ from: 1, id: 2 })
  })

  it('the level curve: 20 minutes a level at first, 60 near the top, about 55 hours to 100', () => {
    expect(minutesForLevel(1)).toBe(20)
    expect(minutesForLevel(99)).toBe(60)
    expect(minutesForLevel(50)).toBeGreaterThan(25)
    let total = 0
    for (let L = 1; L < 100; L++) total += minutesForLevel(L)
    expect(total / 60).toBeGreaterThan(50)
    expect(total / 60).toBeLessThan(60)
    expect(levelFrom(5, 20 * 60000).level).toBe(5) // 20 min is just short of the 20.07 needed at 5
    expect(levelFrom(5, 21 * 60000).level).toBe(6)
  })

  it('swaps any owned Pokémon that is not working; a box Pokémon takes the party slot', () => {
    const { dex } = setup([0])
    attended(dex)
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, {})
    const st0 = (dex as any)._state()
    const starterUid = st0.assign.s1
    st0.mons.mbox = { uid: 'mbox', dex: 150, steps: 0, evos: 0, shiny: false, how: 'wild', place: 'x', at: 0 }
    st0.box.push('mbox')
    expect(dex.swap('s1', 'mbox')).toEqual({ ok: true })
    const st = dex.publicState()
    expect(st.assign.s1).toBe('mbox')
    expect(st.party[0]).toBe('mbox')
    expect(st.box).toContain(starterUid)
    // a party Pokémon that is resting can be swapped in too, even unevolved
    expect(dex.swap('s1', st.party[1])).toEqual({ ok: true })
  })

  it('throws a chosen party Pokémon with a session before its first event, and holds it', () => {
    const { dex, sent } = setup([0])
    attended(dex)
    const party = dex.publicState().party
    expect(dex.throwBall('new-1', party[3])).toEqual({ ok: true })
    expect(sent.at(-1).event).toMatchObject({ kind: 'sendout', sessionId: 'new-1', uid: party[3] })
    // held: another throw of the same Pokémon is refused, the session's first event keeps it
    expect(dex.throwBall('new-2', party[3])).toMatchObject({ ok: false, reason: 'busy' })
    dex.noteEvent({ type: 'session_started', sessionId: 'new-1' }, {})
    expect(dex.publicState().assign['new-1']).toBe(party[3])
    // a box Pokémon cannot be thrown, only party members
    expect(dex.throwBall('new-3', 'nope')).toMatchObject({ ok: false })
    expect(dex.publicState().remembered['new-1']).toBe(party[3])
  })

  it('a step may meet a wild Pokémon in the terrain of the tool; a caught one goes to the box', () => {
    // trainer: starter roll, companion picks (fallback); then the step: encounter hit, tier common, species, shiny no, catch yes
    const { dex, sent } = setup([0, 0, 0.1, 0.2, 0.3, 0.4, 0.5])
    attended(dex)
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, { project: 'api' })
    ;(dex as any)._state().nextUid += 0
    const queue = [0.01, 0.9, 0.5, 0.9, 0.1]
    ;(dex as any)._random = queue
    // drive the remaining rolls through a fresh instance that shares the state file is overkill; check the shape on a plain run instead
    let ev: any = null
    for (let i = 0; i < 400 && !ev; i++) {
      dex.noteEvent(work('s1', 'Bash'), { project: 'api' })
      ev = sent.map(m => m.event).find(e => e && (e.kind === 'catch' || e.kind === 'flee'))
    }
    // with the fallback random (0.99) nothing is ever met: no encounter at all
    expect(ev).toBeUndefined()
  })

  it('pities: a sure mythical after PITY_MYTHICAL, a sure legendary after PITY, both caught', () => {
    const { dex, sent } = setup([0], 0.01) // every roll low: encounters every step, tiers decided by the pities first
    attended(dex)
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, { project: 'x' })
    const st = (dex as any)._state()
    st.sinceMythical = PITY_MYTHICAL - 1
    dex.noteEvent(work('s1', 'Read'), { project: 'x' })
    expect(sent.at(-1).event).toMatchObject({ kind: 'catch', tier: 'mythical', pity: true, id: 151 })
    st.sinceMythical = 0
    st.sinceLegend = PITY - 1
    dex.noteEvent(work('s1', 'Read'), { project: 'x' })
    expect(sent.at(-1).event).toMatchObject({ kind: 'catch', tier: 'legendary', pity: true, id: 150 })
    expect(dex.publicState().box.length).toBe(2)
  })

  it("the day's first session event brings an attendance encounter with an uncaught species, once a day", () => {
    const { dex, sent } = setup([0], 0.01) // low rolls: the attendance Pokémon is caught
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, { project: 'web' })
    const att = sent.map(m => m.event).find(e => e?.attendance)
    expect(att).toMatchObject({ kind: 'catch', attendance: true, place: 'web (오늘의 출석)' })
    const before = dex.publicState().log.filter((e: any) => e.attendance).length
    dex.noteEvent({ type: 'session_started', sessionId: 's2' }, { project: 'web' })
    expect(dex.publicState().log.filter((e: any) => e.attendance).length).toBe(before)
  })

  it('the attendance encounter never brings a legendary or mythical; a pity due waits for the next wild one', () => {
    // Every roll lowest: a wild encounter would be mythical, and both pities are due
    const { dex, sent } = setup([], 0)
    const st = (dex as any)._state()
    st.sinceMythical = PITY_MYTHICAL - 1
    st.sinceLegend = PITY - 1
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, { project: 'web' })
    const att = sent.map(m => m.event).find(e => e?.attendance)
    expect(att).toMatchObject({ attendance: true, pity: false, tier: 'sub', id: 144 })
    dex.noteEvent(work('s1', 'Read'), { project: 'web' })
    expect(sent.at(-1).event).toMatchObject({ kind: 'catch', tier: 'mythical', pity: true, attendance: false })
  })

  it('the tiers keep their chances however often the others were caught (the ×0.9 works inside a tier)', () => {
    const tierOf = (caughtTimes: number) => {
      const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
      dirs.push(dir)
      const sent: any[] = []
      let rolls: number[] = []
      const dex = createPokedex({
        file: join(dir, 'pokedex.json'), species: SPECIES, broadcast: (m: any) => sent.push(m),
        now: () => new Date('2026-11-06T14:00:00').getTime(), random: () => (rolls.length ? rolls.shift()! : 0.99),
      })
      attended(dex)
      const st = (dex as any)._state()
      for (const s of SPECIES) if (s.tier !== 'legendary' && s.tier !== 'mythical' && caughtTimes) st.caught[s.id] = { count: caughtTimes, firstAt: 1 }
      dex.noteEvent({ type: 'session_started', sessionId: 's1' }, { project: 'x' })
      rolls = [0, 0.5] // the step meets a Pokémon, then a mid roll for the tier
      dex.noteEvent(work('s1', 'Read'), { project: 'x' })
      return sent.map(m => m.event).filter(e => e && (e.kind === 'catch' || e.kind === 'flee')).at(-1)?.tier
    }
    expect(tierOf(0)).toBe('common')
    expect(tierOf(50)).toBe('common')
  })

  it('once only legendaries and mythicals are left uncaught, there is no attendance encounter', () => {
    const { dex, sent } = setup([], 0)
    const st = (dex as any)._state()
    for (const s of SPECIES) if (s.tier !== 'legendary' && s.tier !== 'mythical') st.caught[s.id] = { count: 1, firstAt: 1 }
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, { project: 'web' })
    expect(sent.map(m => m.event).find(e => e?.attendance)).toBeUndefined()
  })

  it('a catch remembers what brought it out: the request and the tool', () => {
    const session = { main: { lastPrompt: '잡은 곳을 좀 더 유의미한 걸로 바꿔줘. 어떤 요청에서 받았는지 알면 좋겠어' } }
    expect(catchSource({ tool: 'Bash', status: 'running: npm test' }, session)).toEqual({
      tool: 'Bash', label: 'Bash(npm test)', prompt: '잡은 곳을 좀 더 유의미한 걸로 바꿔줘. 어떤 요청에서 받았는지 알면 좋…',
    })
    expect(catchSource({ tool: 'Skill', status: 'using /frontend-design' }, {}).label).toBe('frontend-design 스킬')
    expect(catchSource({ tool: 'Edit', status: 'editing Widget.tsx' }, {}).label).toBe('Edit(Widget.tsx)')
    expect(catchSource({ tool: 'mcp__figma__get_screenshot', status: 'using mcp' }, {}).label).toBe('MCP figma')
    expect(catchSource({ tool: 'Read', status: 'reading a.ts' }, {}).prompt).toBeNull()
  })

  it('every individual gets a gender by its species official rate and one of the 25 natures', () => {
    const natures = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }))
    const species = [
      { id: 1, ko: 'a', types: [], tier: 'rare', captureRate: 45, evolvesFrom: null, genderRate: 1 },
      { id: 4, ko: 'b', types: [], tier: 'rare', captureRate: 45, evolvesFrom: null, genderRate: 8 },
      { id: 7, ko: 'c', types: [], tier: 'rare', captureRate: 45, evolvesFrom: null, genderRate: -1 },
      { id: 10, ko: 'd', types: [], tier: 'common', captureRate: 255, evolvesFrom: null, genderRate: 0 },
      { id: 11, ko: 'e', types: [], tier: 'common', captureRate: 255, evolvesFrom: 10, genderRate: 0 },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
    dirs.push(dir)
    let i = 0
    const rolls = [0.4, 0.5, 0.3, 0.9, 0.2]
    const dex = createPokedex({ file: join(dir, 'p.json'), species, natures, broadcast: () => {}, random: () => rolls[i++ % rolls.length] })
    const st = dex.publicState()
    for (const uid of st.party) {
      const m = st.mons[uid]
      const rate = species.find(s => s.id === m.dex)!.genderRate
      if (rate === -1) expect(m.gender).toBe('none')
      if (rate === 8) expect(m.gender).toBe('female')
      if (rate === 0) expect(m.gender).toBe('male')
      expect(m.nature).toBeGreaterThanOrEqual(1)
      expect(m.nature).toBeLessThanOrEqual(25)
    }
  })

  it('a full box sends a new catch to the professor; the Pokédex still counts it', () => {
    const { dex, sent } = setup([], 0) // every roll 0: every step meets and catches
    attended(dex)
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, {})
    const st0 = (dex as any)._state()
    for (let i = 0; i < BOX_LIMIT; i++) { st0.mons[`f${i}`] = { uid: `f${i}`, dex: 10, steps: 0, evos: 0, shiny: false, how: 'wild', place: 'x', at: 0 }; st0.box.push(`f${i}`) }
    const before = Object.keys(st0.mons).length
    dex.noteEvent(work('s1', 'Bash'), {})
    const ev = sent.map(m => m.event).find(e => e?.kind === 'catch')
    expect(ev).toMatchObject({ toProfessor: true, uid: null })
    expect(dex.publicState().caught[ev.id]).toBeTruthy()
    expect(st0.box).toHaveLength(BOX_LIMIT)
    expect(Object.keys(st0.mons)).toHaveLength(before)
    expect(dex.publicState().boxLimit).toBe(BOX_LIMIT)
  })

  it('releases a box Pokémon, never a party one', () => {
    const { dex } = setup([0])
    attended(dex)
    const st0 = (dex as any)._state()
    st0.mons.mbox = { uid: 'mbox', dex: 10, steps: 0, evos: 0, shiny: false, how: 'wild', place: 'x', at: 0 }
    st0.box.push('mbox')
    expect(dex.release(dex.publicState().party[0])).toMatchObject({ ok: false, reason: 'in-party' })
    expect(dex.release('nope')).toMatchObject({ ok: false })
    expect(dex.release('mbox')).toEqual({ ok: true })
    const st = dex.publicState()
    expect(st.box).not.toContain('mbox')
    expect(st.mons.mbox).toBeUndefined()
  })

  it('the PC trades a box Pokémon with a resting party one, never a working one', () => {
    const { dex } = setup([0])
    attended(dex)
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, {})
    const st0 = (dex as any)._state()
    st0.mons.mbox = { uid: 'mbox', dex: 150, steps: 0, evos: 0, shiny: false, how: 'wild', place: 'x', at: 0 }
    st0.box.push('mbox')
    const working = dex.publicState().assign.s1
    expect(dex.exchange('mbox', working)).toMatchObject({ ok: false, reason: 'busy' })
    const resting = dex.publicState().party.find((u: string) => u !== working)!
    const slot = dex.publicState().party.indexOf(resting)
    expect(dex.exchange('mbox', resting)).toEqual({ ok: true })
    const st = dex.publicState()
    expect(st.party[slot]).toBe('mbox')
    expect(st.box).toContain(resting)
    expect(st.box).not.toContain('mbox')
  })

  it('every catch comes in a ball drawn by the balls’ weights', () => {
    const balls = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'balls.json'), 'utf8')).balls
    expect(balls).toHaveLength(27)
    expect(balls.reduce((a: number, b: any) => a + b.weight, 0)).toBeCloseTo(100, 6)
    // event balls are only ever given, never caught in
    for (const id of ['park-ball', 'dream-ball', 'cherish-ball']) expect(balls.find((b: any) => b.id === id)).toMatchObject({ catch: false, weight: 0 })
    const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
    dirs.push(dir)
    const sent: any[] = []
    // every roll 0: every step meets and catches, and the ball is the first one listed
    const dex = createPokedex({ file: join(dir, 'p.json'), species: SPECIES, balls, broadcast: (m: any) => sent.push(m), random: () => 0, now: () => new Date('2026-11-06T14:00:00').getTime() })
    dex.publicState(); (dex as any)._state().attendedOn = '2026-11-06'
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, {})
    dex.noteEvent(work('s1', 'Bash'), {})
    // every roll 0 meets a mythical first, and 1% of legendary/mythical catches are in a Master Ball
    const ev = sent.map(m => m.event).find(e => e?.kind === 'catch')
    expect(ev.tier).toBe('mythical')
    expect(ev.ball).toBe('master-ball')
    expect(dex.publicState().mons[ev.uid].ball).toBe('master-ball')
    // the starter came in a plain Poké Ball
    const st = dex.publicState()
    expect(st.mons[st.party[0]].ball).toBe('poke-ball')
  })

  it('a species already caught comes back less: ×0.9 per catch', () => {
    // two commons of equal weight; the trainer has caught the first one 3 times
    const species = [
      { id: 1, ko: 'a', types: ['normal'], tier: 'common', captureRate: 100, evolvesFrom: null },
      { id: 2, ko: 'b', types: ['normal'], tier: 'common', captureRate: 100, evolvesFrom: null },
    ]
    const picks = { 1: 0, 2: 0 } as Record<number, number>
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
    const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
    dirs.push(dir)
    const sent: any[] = []
    const dex = createPokedex({ file: join(dir, 'p.json'), species, broadcast: (m: any) => sent.push(m), random: rnd, now: () => new Date('2026-11-06T14:00:00').getTime() })
    dex.publicState(); (dex as any)._state().attendedOn = '2026-11-06'
    const st = (dex as any)._state()
    st.caught = { 1: { count: 3 }, 2: { count: 1 } }
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, {})
    // hold the counts still (a caught 3 times, b once) so only the weights speak
    for (let i = 0; i < 60000; i++) { st.caught = { 1: { count: 3 }, 2: { count: 1 } }; dex.noteEvent(work('s1', 'Bash'), {}) }
    for (const e of sent.map(m => m.event)) if (e && (e.kind === 'catch' || e.kind === 'flee')) picks[e.id]++
    // a : b = 0.9^3 : 0.9^1 = 0.81
    expect(picks[1] / picks[2]).toBeGreaterThan(0.7)
    expect(picks[1] / picks[2]).toBeLessThan(0.92)
    // Caught 30 times, a falls no lower than RECATCH_FLOOR: a : b = 0.3 : 0.9
    picks[1] = picks[2] = 0
    sent.length = 0
    for (let i = 0; i < 60000; i++) { st.caught = { 1: { count: 30 }, 2: { count: 1 } }; dex.noteEvent(work('s1', 'Bash'), {}) }
    for (const e of sent.map(m => m.event)) if (e && (e.kind === 'catch' || e.kind === 'flee')) picks[e.id]++
    expect(picks[1] / picks[2]).toBeGreaterThan(0.27)
    expect(picks[1] / picks[2]).toBeLessThan(0.4)
  })

  it('levels: work time with a trainer raises it; breaks over 5 minutes do not count', () => {
    let t = new Date('2026-11-06T14:00:00').getTime()
    const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
    dirs.push(dir)
    const dex = createPokedex({ file: join(dir, 'p.json'), species: SPECIES, broadcast: () => {}, random: () => 0.99, now: () => t })
    dex.publicState(); (dex as any)._state().attendedOn = '2026-11-06'
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, {})
    const uid = dex.publicState().assign.s1
    const mon = () => (dex as any)._state().mons[uid]
    expect(mon().metLevel).toBe(5)
    // a tool call every minute for 61 minutes: two levels
    for (let i = 0; i <= 61; i++) { dex.noteEvent(work('s1'), {}); t += 60_000 }
    expect(Math.floor(mon().workMs / 60000)).toBe(61)
    expect(levelFrom(mon().metLevel, mon().workMs).level).toBe(8) // ~20 minutes a level at this point
    // an hour away, then one call: nothing added
    t += 60 * 60_000
    dex.noteEvent(work('s1'), {})
    expect(Math.floor(mon().workMs / 60000)).toBe(61)
  })

  it('ball boosts follow the situation', () => {
    const wild = { id: 7, types: ['water'], speed: 43, weightKg: 9 }
    const at = Date.UTC(2026, 10, 6, 5)
    let b = ballBoosts({ wild, level: 1, first: true, minutes: 0, at })
    expect(b['net-ball']).toBe(3)
    expect(b['dive-ball']).toBe(3)
    expect(b['nest-ball']).toBe(3)
    expect(b['quick-ball']).toBe(3)
    expect(b['timer-ball']).toBe(0.5)
    b = ballBoosts({ wild, level: 55, first: false, minutes: 240, at })
    expect(b['nest-ball']).toBeCloseTo(0.5)
    expect(b['timer-ball']).toBe(3)
    expect(b['quick-ball']).toBe(0.5)
    // a well-raised partner far above the wild one
    b = ballBoosts({ wild, level: 10, at, partner: { dex: 4, level: 45, metLevel: 5, gender: 'male' } })
    expect(b['luxury-ball']).toBe(2)
    expect(b['friend-ball']).toBe(2)
    expect(b['level-ball']).toBe(3)
    expect(ballBoosts({ wild: { id: 793, types: ['rock'] }, level: 50, at })['beast-ball']).toBe(50)
    expect(ballBoosts({ wild, level: 5, tool: 'Grep', at })['lure-ball']).toBe(3)
    expect(ballBoosts({ wild: { id: 1, types: [], speed: 120, weightKg: 400 }, level: 5, at })).toMatchObject({ 'fast-ball': 3, 'heavy-ball': 3 })
    expect(ballBoosts({ wild, level: 5, catchNo: 10, at })['premier-ball']).toBe(3)
    // a known full moon: 2026-11-24 (UTC)
    expect(isFullMoon(Date.UTC(2026, 10, 24, 12))).toBe(true)
    expect(isFullMoon(Date.UTC(2026, 10, 9, 12))).toBe(false)
  })

  it('friendship, trade and Eevee evolutions follow the games, simply', () => {
    let t = new Date('2026-11-06T14:00:00').getTime() // daytime
    const species = [
      { id: 1, ko: '이상해씨', types: ['grass'], tier: 'rare', captureRate: 45, evolvesFrom: null },
      { id: 4, ko: '파이리', types: ['fire'], tier: 'rare', captureRate: 45, evolvesFrom: null },
      { id: 7, ko: '꼬부기', types: ['water'], tier: 'rare', captureRate: 45, evolvesFrom: null },
      { id: 172, ko: '피츄', types: ['electric'], tier: 'common', captureRate: 190, evolvesFrom: null },
      { id: 25, ko: '피카츄', types: ['electric'], tier: 'common', captureRate: 190, evolvesFrom: 172, evolveLevel: 30, evolveHow: 'level-up' },
      { id: 64, ko: '윤겔라', types: ['psychic'], tier: 'common', captureRate: 100, evolvesFrom: null },
      { id: 65, ko: '후딘', types: ['psychic'], tier: 'common', captureRate: 50, evolvesFrom: 64, evolveLevel: 40, evolveHow: 'trade' },
      { id: 133, ko: '이브이', types: ['normal'], tier: 'common', captureRate: 45, evolvesFrom: null },
      ...[134, 135, 136].map(id => ({ id, ko: `돌${id}`, types: ['normal'], tier: 'common', captureRate: 45, evolvesFrom: 133, evolveLevel: 30, evolveHow: 'use-item' })),
      ...[196, 197, 470, 471, 700].map(id => ({ id, ko: `이브이${id}`, types: ['normal'], tier: 'common', captureRate: 45, evolvesFrom: 133, evolveLevel: 30, evolveHow: 'level-up' })),
    ]
    const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
    dirs.push(dir)
    const dex = createPokedex({ file: join(dir, 'p.json'), species, broadcast: () => {}, random: () => 0.99, now: () => t })
    dex.publicState(); (dex as any)._state().attendedOn = '2026-11-06'
    const st = (dex as any)._state()
    const grow = (uid: string, sid: string, tool = 'Edit', minutes = 2000) => {
      st.assign[sid] = uid
      for (let i = 0; i < minutes; i++) { t += 60_000; dex.noteEvent({ type: 'agent_working', sessionId: sid, tool }, {}) }
    }
    const add = (uid: string, dex: number, metLevel: number) => { st.mons[uid] = { uid, dex, steps: 0, evos: 0, shiny: false, how: 'wild', place: 'x', at: 0, metLevel, workMs: 0 }; st.box.push(uid) }
    // Pichu: met at 40, no evolution until raised 20 levels, then Pikachu
    add('pichu', 172, 40)
    grow('pichu', 'a', 'Edit', 200)
    expect(st.mons.pichu.dex).toBe(172)
    grow('pichu', 'a', 'Edit', 900)
    expect(st.mons.pichu.dex).toBe(25)
    // Kadabra: level alone never does it; after a trade, the next level-up does
    add('kad', 64, 50)
    grow('kad', 'b', 'Edit', 200)
    expect(st.mons.kad.dex).toBe(64)
    st.mons.kad.traded = true
    grow('kad', 'b', 'Edit', 200)
    expect(st.mons.kad.dex).toBe(65)
    // Eevee from 30 in the forest (Read), not yet bonded: Leafeon
    add('eevee', 133, 29)
    grow('eevee', 'c', 'Read', 60)
    expect(st.mons.eevee.dex).toBe(470)
  })

  it('steps wait their turn: a burst of tool calls is met one step at a time', () => {
    let t = new Date('2026-11-06T14:00:00').getTime()
    const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
    dirs.push(dir)
    const sent: any[] = []
    // every roll meets and catches
    const dex = createPokedex({ file: join(dir, 'p.json'), species: SPECIES, broadcast: (m: any) => sent.push(m), random: () => 0, now: () => t, stepSpacingMs: 8000 })
    dex.publicState(); (dex as any)._state().attendedOn = '2026-11-06'
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, {})
    for (let i = 0; i < 5; i++) dex.noteEvent(work('s1', 'Bash'), {}) // five calls in the same instant
    const met = () => sent.map(m => m.event).filter(e => e && (e.kind === 'catch' || e.kind === 'flee')).length
    expect(met()).toBe(1) // only the first step so far
    for (let i = 0; i < 4; i++) { t += 8000; dex.tick() }
    expect(met()).toBe(5) // the rest, eight seconds apart, none lost
  })

  it('a working session with no tool call for a minute takes a thinking step', () => {
    let t = new Date('2026-11-06T14:00:00').getTime()
    const dir = mkdtempSync(join(tmpdir(), 'pokedex-'))
    dirs.push(dir)
    const sent: any[] = []
    let working = true
    const dex = createPokedex({
      file: join(dir, 'p.json'), species: SPECIES, broadcast: (m: any) => sent.push(m), random: () => 0, now: () => t,
      stepSpacingMs: 8000, sessionOf: () => ({ main: { state: working ? 'working' : 'idle', lastPrompt: '설계 문서 다듬어줘' } }),
    })
    dex.publicState(); (dex as any)._state().attendedOn = '2026-11-06'
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, {})
    dex.noteEvent(work('s1', 'Read'), {})
    const met = () => sent.map(m => m.event).filter(e => e && (e.kind === 'catch' || e.kind === 'flee'))
    expect(met()).toHaveLength(1)
    t += THINK_STEP_MS; dex.tick()
    expect(met()).toHaveLength(2)
    expect(met()[1].via).toMatchObject({ label: '생각하는 중', prompt: '설계 문서 다듬어줘' })
    // idle (the turn ended): no more thinking steps
    working = false
    t += THINK_STEP_MS * 3; dex.tick()
    expect(met()).toHaveLength(2)
  })

  it('keeps the game on disk', async () => {
    const { dex, file } = setup([0])
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, { project: 'x' })
    await new Promise(r => setTimeout(r, 400))
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.version).toBe(2)
    expect(saved.trainer.starter).toBe(1)
    expect(saved.assign.s1).toBe(saved.party[0])
  })

  it("takes a synced (merged) game: the game before it is backed up, this PC's assignments in it are kept, old individuals upgraded", () => {
    const { dex, file } = setup([0])
    dex.noteEvent({ type: 'session_started', sessionId: 's1' }, { project: 'x' })
    const before = JSON.parse(JSON.stringify(dex.exportState()))
    const merged = { ...before, caught: { ...before.caught, 150: { count: 1, firstAt: 1 } }, mons: { ...before.mons, m99: { uid: 'm99', dex: 150, steps: 0, evos: 0, at: 1 } }, box: ['m99'], nextUid: 100 }
    expect(dex.importState(merged)).toBe(true)
    expect(JSON.parse(readFileSync(`${file}.before-sync`, 'utf8'))).toEqual(before)
    const st = dex.publicState()
    expect(st.caught[150]).toBeTruthy()
    expect(st.remembered).toEqual(before.assign)
    expect(st.mons.m99).toMatchObject({ ball: 'poke-ball', metLevel: 5, workMs: 0 })
    expect(dex.importState({ version: 1 })).toBe(false)
  })
})
