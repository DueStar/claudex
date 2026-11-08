/**
 * pokedex.js — the game, trainer style.
 *
 * The trainer starts with a party of six: a starter (이상해씨 / 파이리 / 꼬부기, at
 * random) and five base-form Pokémon. Each Claude Code session takes a party
 * Pokémon that is not working (the starter first); with all six out, there is
 * no one left to send. Growth belongs to the Pokémon, not the session: every
 * tool call is a step for it; it levels up with work time and evolves at the
 * games' evolution level. A fully
 * evolved Pokémon can be swapped out of its session for another one the
 * trainer owns, so a busy session can raise someone new.
 *
 * Every step is also a step through tall grass: it may meet a wild Pokémon,
 * rolled on a gacha-style table with pities, and the caught ones go to the box.
 * Everything is kept in <runtime dir>/pokedex.json.
 *
 *   createPokedex({ file, species, broadcast, isActive?, now?, random? })
 *     .noteEvent(event, session)    after the server processed a hook event
 *     .swap(sessionId, uid)         put another party Pokémon (a resting one) on a session
 *     .publicState()                the whole game for the snapshot / GET /pokedex
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'

export const STARTERS = [1, 4, 7]
export const PARTY_SIZE = 6
/**
 * The PC box holds this many Pokémon (the party's six are separate). It keeps
 * one trainer's saved game bounded (about 0.4 MB of individuals at ~360 bytes
 * each) so the free cloud tier lasts. When it is full, a new catch still fills
 * the Pokédex, but the individual is sent to the professor instead of the box.
 */
export const BOX_LIMIT = 1200

/**
 * The rarity table, per encounter (rarest first when rolled). Tuned by
 * simulation so a heavy Max user completes the 1025-species dex in about a
 * year; the top tiers stay painful, with a pity for each.
 */
export const RATES = Object.freeze({
  common: 0.74,
  rare: 0.21,
  sub: 0.036,       // 준전설
  legendary: 0.010, // 전설
  mythical: 0.004,  // 환상
})
export const TIER_ORDER = ['mythical', 'legendary', 'sub', 'rare', 'common']
/** The tiers the daily attendance encounter never brings */
const LEGENDS = new Set(['legendary', 'mythical'])
/** Chance the Poké Ball holds, by tier (a fled one is still "seen"); pities always hold */
export const CATCH = Object.freeze({ common: 0.9, rare: 0.75, sub: 0.5, legendary: 0.35, mythical: 0.3 })
/**
 * Chance a step meets a wild Pokémon. Kept low on purpose: the daily
 * attendance encounter (below) carries a light user, so a heavy Max user still
 * needs about a year while a Pro user needs about two (simulated, 1025 species).
 */
export const ENCOUNTER_PER_STEP = 0.03
export const SHINY_ODDS = 1 / 4096
/** Species not caught yet are this many times likelier to show up (a gentle dex assist) */
export const NEW_SPECIES_BOOST = 8
/** Encounters without a legendary (or mythical) before the next is a sure legendary */
export const PITY = 150
/** Encounters without a mythical before the next is a sure mythical */
export const PITY_MYTHICAL = 300
/**
 * A species already caught comes back less within its tier: its weight × this,
 * once per catch (0.9, 0.81, …), never below RECATCH_FLOOR. The tiers' own
 * chances (RATES) stay fixed.
 */
export const RECATCH_DECAY = 0.9
/** The least a caught species' weight falls to (0.9^11 ≈ 0.31: reached after about 11 catches) */
export const RECATCH_FLOOR = 0.3
/** A legendary or mythical catch comes in a Master Ball this often */
export const MASTER_FOR_LEGENDS = 0.01
/** Working with no tool call for this long is a step too (Claude thinking or writing) */
export const THINK_STEP_MS = 60 * 1000
/** A session's waiting steps are taken this far apart at most (the server's setting) */
export const STEP_SPACING_MS = 8 * 1000
const MAX_PENDING_STEPS = 300
/** The saved log keeps this many events */
export const LOG_LIMIT = 600

// ---------------------------------------------------------------------------
// Levels: 1 to 100 like the games. A wild Pokémon is met at level 1–55 (by
// how far it has evolved); every 30 minutes of real work with a trainer adds a
// level. Work time is the time between a session's tool calls, gaps over five
// minutes left out.
// ---------------------------------------------------------------------------
export const MAX_LEVEL = 100
/** Levels a trainer raises a Pokémon to max its friendship (friendship evolutions, Luxury/Friend Balls) */
export const BOND_LEVELS = 20
const EEVEE = 133
const isNight = (t) => { const h = new Date(t).getHours(); return h >= 20 || h < 5 }
export const WILD_MAX_LEVEL = 55
/**
 * Minutes of work from level L to L+1: 20 at the start, rising on a curve to
 * 60 near the top (level 1 → 100 is about 55 hours of work)
 */
export const MIN_MINUTES_PER_LEVEL = 20
export const MAX_MINUTES_PER_LEVEL = 60
export function minutesForLevel(L) {
  const x = Math.max(0, Math.min(1, (L - 1) / (MAX_LEVEL - 2)))
  return MIN_MINUTES_PER_LEVEL + (MAX_MINUTES_PER_LEVEL - MIN_MINUTES_PER_LEVEL) * x * x
}
/** The level reached from `metLevel` after `workMs` of work (and minutes into the next one) */
export function levelFrom(metLevel, workMs) {
  let level = Math.max(1, Math.min(MAX_LEVEL, metLevel ?? 5))
  let left = (workMs ?? 0) / 60000
  while (level < MAX_LEVEL && left >= minutesForLevel(level)) { left -= minutesForLevel(level); level++ }
  return { level, into: left, need: level < MAX_LEVEL ? minutesForLevel(level) : null }
}
const WORK_GAP_MS = 5 * 60 * 1000
export const STARTER_LEVEL = 5
/** Ultra Beasts (Beast Ball): Nihilego … Blacephalon */
export const ULTRA_BEASTS = new Set([793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806])
/** Session time over which the Timer Ball grows (and the Quick Ball fades) */
const TIMER_FULL_MIN = 120

/** The moon is full (±1 day) on this date: 29.53-day cycle from the new moon of 2000-01-06 18:14 UTC */
export function isFullMoon(t) {
  const age = (((t - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % 29.530588853 + 29.530588853) % 29.530588853
  return Math.abs(age - 14.765) <= 1
}

/**
 * How much more likely each ball is in this situation (a multiplier on its
 * weight; missing = ×1). ctx: wild (species), level (wild level), tier,
 * partner (the working Pokémon, with its level), minutes (since the session
 * opened), first (the session's first encounter), tool, terrain, night, at,
 * caughtBefore, catchNo (today's catch count including this one).
 */
export function ballBoosts(ctx) {
  const b = {}
  const types = ctx.wild?.types ?? []
  const t = Math.min(ctx.minutes ?? 0, TIMER_FULL_MIN) / TIMER_FULL_MIN
  if (types.includes('bug') || types.includes('water')) b['net-ball'] = 3
  if (types.includes('water')) b['dive-ball'] = 3
  // Nest Ball: ×3 at level 1 down to ×0.5 at the wild maximum
  const L = Math.max(1, Math.min(WILD_MAX_LEVEL, ctx.level ?? 1))
  b['nest-ball'] = 3 - 2.5 * (L - 1) / (WILD_MAX_LEVEL - 1)
  if (ctx.caughtBefore) b['repeat-ball'] = 3
  // Timer Ball ×0.5 → ×3 over two hours of session; Quick Ball the other way, ×3 on the first encounter
  b['timer-ball'] = 0.5 + 2.5 * t
  b['quick-ball'] = ctx.first ? 3 : 3 - 2.5 * t
  if (ctx.night || ctx.terrain === '동굴') b['dusk-ball'] = 3
  if (ctx.catchNo && ctx.catchNo % 10 === 0) b['premier-ball'] = 3
  const p = ctx.partner
  if (p) {
    // Luxury and Friend Balls: levels the trainer has raised the working Pokémon
    const raised = (p.level ?? 0) - (p.metLevel ?? p.level ?? 0)
    const bond = raised >= BOND_LEVELS ? 2 : raised >= BOND_LEVELS / 2 ? 1.5 : 1
    b['luxury-ball'] = bond
    b['friend-ball'] = bond
    // Level Ball: the working Pokémon out-levels the wild one
    if (p.level >= 4 * L) b['level-ball'] = 3
    else if (p.level >= 2 * L) b['level-ball'] = 2
    else if (p.level > L) b['level-ball'] = 1.5
    // Love Ball: same species, the other gender
    if (p.dex === ctx.wild?.id && p.gender && ctx.gender && p.gender !== 'none' && ctx.gender !== 'none' && p.gender !== ctx.gender) b['love-ball'] = 3
  }
  if (ctx.night && isFullMoon(ctx.at)) b['moon-ball'] = 3
  if (ctx.terrain === '사파리존') b['safari-ball'] = 3
  if (/^(Grep|Glob)$/.test(ctx.tool ?? '')) b['lure-ball'] = 3
  if ((ctx.wild?.speed ?? 0) >= 100) b['fast-ball'] = 3
  const kg = ctx.wild?.weightKg ?? 0
  if (kg >= 300) b['heavy-ball'] = 3
  else if (kg >= 200) b['heavy-ball'] = 2
  else if (kg >= 100) b['heavy-ball'] = 1.5
  if (ULTRA_BEASTS.has(ctx.wild?.id)) b['beast-ball'] = 50
  return b
}

/** Where the step was taken: the tool decides the terrain, and the terrain favours some types */
const TERRAIN = [
  { test: t => /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t), name: '풀숲', types: ['grass', 'bug', 'normal'] },
  { test: t => /^(Bash|PowerShell)$/.test(t), name: '동굴', types: ['rock', 'ground', 'poison', 'steel'] },
  { test: t => /^(Read|Grep|Glob|LS)$/.test(t), name: '숲', types: ['bug', 'grass', 'psychic', 'fairy'] },
  { test: t => /^(WebFetch|WebSearch)$/.test(t), name: '하늘길', types: ['flying', 'dragon'] },
  { test: t => /^(Agent|Task)$/.test(t), name: '사파리존', types: ['normal', 'fighting', 'ground'] },
  { test: t => /^mcp__/.test(t), name: '발전소', types: ['electric', 'steel'] },
]
const DEFAULT_TERRAIN = { name: '도로', types: ['normal', 'flying'] }
const NIGHT_TYPES = ['ghost', 'dark', 'psychic']

/**
 * What brought a Pokémon out: the tool call (a readable label from the hook's
 * status line) and the request the session was working on (its first 40
 * characters, only as much as the server's logPrompts setting keeps).
 */
export function catchSource(ev, session) {
  const tool = String(ev?.tool ?? '')
  const status = String(ev?.status ?? '')
  const after = (prefix) => (status.startsWith(prefix) ? status.slice(prefix.length).trim() : '')
  let label
  if (tool === 'Skill') label = `${after('using /') || '스킬'} 스킬`
  else if (tool === 'Bash' || tool === 'PowerShell') label = `${tool}(${(after('running:') || '명령').slice(0, 32)})`
  else if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) label = `${tool}(${(after('editing') || after('writing') || '파일').slice(0, 32)})`
  else if (tool === 'Read') label = `Read(${(after('reading') || '파일').slice(0, 32)})`
  else if (tool === 'Grep' || tool === 'Glob') label = `${tool} 검색`
  else if (/^mcp__/.test(tool)) label = `MCP ${tool.split('__')[1] ?? ''}`.trim()
  else if (tool === 'Agent' || tool === 'Task') label = '서브에이전트'
  else label = tool || '세션 시작'
  const prompt = String(session?.main?.lastPrompt ?? '').replace(/\s+/g, ' ').trim()
  return { tool: tool || null, label, prompt: prompt ? (prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt) : null }
}

function terrainFor(tool) {
  return TERRAIN.find(t => tool && t.test(tool)) ?? DEFAULT_TERRAIN
}

function routeNumber(project) {
  let h = 0
  for (const c of String(project || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (h % 30) + 1
}

function localDay(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Who an individual is across PCs (server/merge.js): uids come from each PC's
 * own counter, so the first uid it was given plus the facts fixed at the
 * catch (time to the ms, how, where, ball, met level, shiny).
 */
export function monKey(m) {
  const fixed = [m.at ?? null, m.how ?? null, m.place ?? null, m.ball ?? 'poke-ball', m.metLevel ?? STARTER_LEVEL, !!m.shiny]
  return `${m.originUid ?? m.uid}|${JSON.stringify(fixed)}`
}

/** How many released individuals the save remembers (the oldest are forgotten past this) */
export const RELEASED_LIMIT = 5000

function emptyState() {
  return {
    version: 2,
    caught: {}, seen: {},
    trainer: null,          // { starter, since }
    mons: {},               // uid -> { uid, dex, steps, evos, shiny, how, place, at }
    party: [],              // up to PARTY_SIZE uids
    box: [],                // uids
    assign: {},             // sessionId -> uid
    projects: {},           // sessionId -> project (for places)
    nextUid: 1,
    encounters: 0, sinceLegend: 0, sinceMythical: 0,
    attendedOn: null,       // local date (YYYY-MM-DD) of the last attendance encounter
    log: [],
    released: {},           // monKey -> when: individuals let go, so a cloud copy cannot bring them back
  }
}

export function createPokedex({ file, species, natures = [], balls = [], stepSpacingMs = 0, sessionOf = () => null, broadcast, isActive = () => true, onChange = () => {}, now = () => Date.now(), random = Math.random }) {
  const byId = new Map(species.map(s => [s.id, s]))
  const byTier = {}
  for (const s of species) (byTier[s.tier] ??= []).push(s)
  const nextOf = new Map()
  for (const s of species) if (s.evolvesFrom) (nextOf.get(s.evolvesFrom) ?? nextOf.set(s.evolvesFrom, []).get(s.evolvesFrom)).push(s.id)

  let state = load()
  /** Individuals saved by older versions get the fields added since (on load and on a synced game) */
  function upgradeMons() {
    for (const m of Object.values(state.mons ?? {})) {
      if (m.gender === undefined) m.gender = null
      if (m.nature === undefined) m.nature = null
      if (m.ball === undefined) m.ball = 'poke-ball' // caught before balls were kept
      if (m.metLevel === undefined) { m.metLevel = STARTER_LEVEL; m.workMs = 0 } // before levels
    }
  }
  upgradeMons()
  let traitsBackfilled = false
  function backfillTraits() {
    if (traitsBackfilled) return
    traitsBackfilled = true
    for (const m of Object.values(state.mons)) {
      if (m.gender === null) m.gender = rollGender(m.dex)
      if (m.nature === null) m.nature = rollNature()
    }
  }

  function load() {
    try {
      if (!existsSync(file)) return emptyState()
      const s = JSON.parse(readFileSync(file, 'utf8'))
      if (s.version === 2) return { ...emptyState(), ...s }
      // v1 (one starter per session): keep the dex and the luck, start the trainer fresh
      return { ...emptyState(), caught: s.caught ?? {}, seen: s.seen ?? {}, encounters: s.encounters ?? 0, sinceLegend: s.sinceLegend ?? 0, log: s.log ?? [] }
    } catch {
      return emptyState()
    }
  }

  let saveTimer = null
  function save() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      try {
        const tmp = `${file}.tmp`
        writeFileSync(tmp, JSON.stringify(state))
        renameSync(tmp, file)
        onChange(state)
      } catch (err) {
        console.error('[pokedex] could not save:', err.message)
      }
    }, 300)
    saveTimer.unref?.()
  }

  function publish(event) {
    broadcast({ type: 'pokedex', state: publicState(), ...(event ? { event } : {}) })
  }

  /** Sessions holding a Pokémon right now (ended ones have handed theirs back) */
  /** A throw holds its Pokémon this long while the session starts up (before its first hook event) */
  const THROW_HOLD_MS = 10 * 60 * 1000

  function busyUids() {
    const busy = new Map()
    for (const [sid, uid] of Object.entries(state.assign)) {
      const thrown = state.thrownAt?.[sid]
      if (isActive(sid) || (thrown && now() - thrown < THROW_HOLD_MS)) busy.set(uid, sid)
    }
    return busy
  }

  function publicState() {
    ensureTrainer()
    backfillTraits()
    const busy = busyUids()
    const assign = {}
    for (const [uid, sid] of busy) assign[sid] = uid
    return {
      caught: state.caught,
      seen: state.seen,
      trainer: state.trainer,
      mons: state.mons,
      party: state.party,
      box: state.box,
      assign,
      remembered: state.assign,
      partySize: PARTY_SIZE,
      boxLimit: BOX_LIMIT,
      encounters: state.encounters,
      sinceLegend: state.sinceLegend,
      sinceMythical: state.sinceMythical,
      pity: PITY,
      pityMythical: PITY_MYTHICAL,
      total: species.length,
      log: state.log.slice(-30),
      // Today's story (local day): catches, flees, evolutions, level-ups, releases
      today: state.log.filter(e => localDay(e.at) === localDay(now())),
    }
  }

  function markSeen(id) {
    state.seen[id] = (state.seen[id] ?? 0) + 1
  }

  function recordSpecies(id, info) {
    const at = now()
    const c = state.caught[id]
    if (c) {
      c.count += 1
      c.lastAt = at
      if (info.shiny) c.shiny = true
    } else {
      state.caught[id] = { count: 1, firstAt: at, lastAt: at, place: info.place, sessionId: info.sessionId, project: info.project, how: info.how, shiny: !!info.shiny, via: info.via ?? null, ball: info.ball ?? 'poke-ball' }
    }
  }

  /** Gender by the species' official rate (eighths female; -1 genderless) */
  function rollGender(dex) {
    const rate = byId.get(dex)?.genderRate
    if (rate === undefined || rate === null) return null
    if (rate < 0) return 'none'
    return random() * 8 < rate ? 'female' : 'male'
  }
  /** The ball a catch comes in, by the balls' weights (server/balls.json) */
  // Event balls (catch: false) never come from a wild catch
  const wildBalls = balls.filter(b => b.catch !== false && b.weight > 0)
  function pickBall(list) {
    const total = list.reduce((a, b) => a + b.weight, 0)
    if (!total) return 'poke-ball'
    let r = random() * total
    for (const b of list) { r -= b.weight; if (r < 0) return b.id }
    return list[list.length - 1].id
  }
  const notMaster = wildBalls.filter(b => b.id !== 'master-ball')
  /**
   * The ball of a catch: the balls' weights × the situation's boosts (ballBoosts).
   * A legendary or mythical comes in a Master Ball MASTER_FOR_LEGENDS of the time.
   */
  function rollBall(tier, ctx = {}) {
    const boost = ballBoosts(ctx)
    const weigh = (list) => list.map(b => ({ id: b.id, weight: b.weight * (boost[b.id] ?? 1) }))
    if (tier === 'legendary' || tier === 'mythical') {
      return random() < MASTER_FOR_LEGENDS ? 'master-ball' : pickBall(weigh(notMaster))
    }
    return pickBall(weigh(wildBalls))
  }

  /** A Pokémon's level: its met level grown by its work time on the 20 → 60 minute curve */
  function levelOf(m) {
    return levelFrom(m.metLevel ?? STARTER_LEVEL, m.workMs ?? 0).level
  }
  /** A wild Pokémon's level by how far it has evolved (legends and single-stage ones meet higher) */
  function wildLevel(sp, tier) {
    let stage = 0
    for (let s = sp; s?.evolvesFrom; s = byId.get(s.evolvesFrom)) stage++
    const [lo, hi] = tier === 'legendary' || tier === 'mythical' || tier === 'sub' ? [40, WILD_MAX_LEVEL]
      : stage >= 2 ? [30, WILD_MAX_LEVEL]
        : stage === 1 ? [16, 40]
          : nextOf.has(sp.id) ? [2, 25] : [10, 45]
    return lo + Math.floor(random() * (hi - lo + 1))
  }
  function rollNature() {
    return natures.length ? natures[Math.floor(random() * natures.length)].id : null
  }

  function newMon(dex, info) {
    const uid = `m${state.nextUid++}`
    state.mons[uid] = {
      uid, dex, steps: 0, evos: 0, shiny: !!info.shiny, how: info.how, place: info.place, at: now(),
      gender: info.gender !== undefined ? info.gender : rollGender(dex), nature: rollNature(), via: info.via ?? null, ball: info.ball ?? 'poke-ball',
      metLevel: info.level ?? STARTER_LEVEL, workMs: 0,
    }
    markSeen(dex)
    recordSpecies(dex, info)
    return uid
  }

  /** The very first run: a random starter and five base-form companions */
  function ensureTrainer() {
    if (state.trainer || species.length === 0) return false
    const starter = STARTERS[Math.floor(random() * STARTERS.length)]
    state.trainer = { starter, since: now() }
    const place = '여행의 시작'
    state.party = [newMon(starter, { how: 'starter', place })]
    // Companions: common base forms that can evolve, so every one has somewhere to grow
    const pool = species.filter(s => s.tier === 'common' && !s.evolvesFrom && nextOf.has(s.id) && !STARTERS.includes(s.id))
    // Draw without replacement (a partial shuffle), so it always ends
    const deck = pool.slice()
    for (let i = 0; i < deck.length && state.party.length < PARTY_SIZE; i++) {
      const j = i + Math.floor(random() * (deck.length - i))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
      state.party.push(newMon(deck[i].id, { how: 'gift', place }))
    }
    return true
  }

  /** A session's Pokémon, sent out on its first event: the first party member not working */
  function ensureAssigned(sessionId) {
    const have = state.assign[sessionId]
    if (have && state.mons[have]) return { uid: have, isNew: false }
    const busy = busyUids()
    const uid = state.party.find(u => !busy.has(u))
    if (!uid) return { uid: null, isNew: false }
    state.assign[sessionId] = uid
    return { uid, isNew: true }
  }

  /**
   * The encounter's tier. The daily attendance encounter (a sure uncaught
   * species) never brings a legendary or mythical: those are met in the wild
   * only, and a pity that falls due waits for the next wild encounter.
   */
  function rollTier(attendance = false) {
    if (!attendance && state.sinceMythical + 1 >= PITY_MYTHICAL) return { tier: 'mythical', pity: true }
    if (!attendance && state.sinceLegend + 1 >= PITY) return { tier: 'legendary', pity: true }
    const order = attendance ? TIER_ORDER.filter(t => !LEGENDS.has(t)) : TIER_ORDER
    let r = random() * (attendance ? order.reduce((a, t) => a + RATES[t], 0) : 1)
    for (const tier of order) {
      r -= RATES[tier]
      if (r < 0) return { tier, pity: false }
    }
    return { tier: 'common', pity: false }
  }

  /** A species' own weight in its tier before any catch (commons by capture rate) */
  function baseWeight(s, tier) {
    return tier === 'common' ? Math.max(1, s.captureRate ?? 45) : 1
  }


  /**
   * A species of the tier: uncaught ones boosted, each earlier catch of a species
   * ×RECATCH_DECAY down to RECATCH_FLOOR (the rest of the tier shares what it gives up), the terrain's
   * types ×3, commons by capture rate
   */
  function pickSpecies(tier, favoured) {
    const pool = byTier[tier]?.length ? byTier[tier] : byTier.common
    const weights = pool.map(s => {
      let w = baseWeight(s, tier)
      const caughtBefore = state.caught[s.id]?.count ?? 0
      if (!caughtBefore) w *= NEW_SPECIES_BOOST
      else w *= Math.max(RECATCH_FLOOR, RECATCH_DECAY ** caughtBefore)
      if (s.types?.some(t => favoured.includes(t))) w *= 3
      return w
    })
    let r = random() * weights.reduce((a, b) => a + b, 0)
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i]
      if (r < 0) return pool[i]
    }
    return pool[pool.length - 1]
  }

  function placeName(project, terrain, night) {
    return `${project || '이름 없는 마을'} ${terrain.name === '도로' ? `${routeNumber(project)}번도로` : terrain.name}${night ? ' (밤)' : ''}`
  }

  /** An uncaught species of the tier, else of the nearest other non-legendary tier that still has one (null when none) */
  function uncaughtSpecies(tier) {
    const order = [tier, ...TIER_ORDER.slice().reverse().filter(t => t !== tier && !LEGENDS.has(t))]
    for (const t of order) {
      const pool = (byTier[t] ?? []).filter(s => !state.caught[s.id])
      if (pool.length) return { tier: t, sp: pool[Math.floor(random() * pool.length)] }
    }
    return null
  }

  function encounter(sessionId, mon, tool, attendance = false, via = null) {
    const project = state.projects[sessionId] ?? ''
    const terrain = terrainFor(tool)
    const hour = new Date(now()).getHours()
    const night = hour >= 20 || hour < 5
    const favoured = night ? [...terrain.types, ...NIGHT_TYPES] : terrain.types
    let { tier, pity } = rollTier(attendance)
    let sp
    if (attendance) {
      const pick = uncaughtSpecies(tier)
      if (!pick) return null // only legendaries and mythicals left: those come from the wild
      tier = pick.tier
      sp = pick.sp
    } else {
      sp = pickSpecies(tier, favoured)
    }
    const shiny = random() < SHINY_ODDS
    state.encounters += 1
    state.sinceMythical = tier === 'mythical' ? 0 : state.sinceMythical + 1
    state.sinceLegend = tier === 'legendary' || tier === 'mythical' ? 0 : state.sinceLegend + 1
    markSeen(sp.id)
    const caught = pity || random() < CATCH[tier]
    const place = attendance ? `${project || '이름 없는 마을'} (오늘의 출석)` : placeName(project, terrain, night)
    const level = wildLevel(sp, tier)
    // The session's first encounter (Quick Ball), counted even when it flees
    const first = !attendance && !encounteredIn.has(sessionId)
    if (!attendance) encounteredIn.add(sessionId)
    let uid = null
    let toProfessor = false
    let ball = null
    if (caught) {
      const day = localDay(now())
      if (state.daily?.day !== day) state.daily = { day, catches: 0 }
      state.daily.catches += 1
      const gender = rollGender(sp.id)
      const caughtBefore = (state.caught[sp.id]?.count ?? 0) > 0
      ball = rollBall(tier, {
        wild: sp, level, tier, gender, first, tool, terrain: terrain.name, night, at: now(), caughtBefore,
        catchNo: state.daily.catches,
        minutes: sessionOpenedAt.has(sessionId) ? (now() - sessionOpenedAt.get(sessionId)) / 60000 : 0,
        partner: mon ? { dex: mon.dex, gender: mon.gender, level: levelOf(mon), metLevel: mon.metLevel ?? STARTER_LEVEL } : null,
      })
      const info = { place, sessionId, project, how: pity ? 'pity' : attendance ? 'attendance' : 'wild', shiny, via, ball, level, gender }
      if (state.box.length >= BOX_LIMIT) {
        // A full box: the Pokédex still counts it, the individual goes to the professor
        toProfessor = true
        recordSpecies(sp.id, info)
      } else {
        // newMon marks it seen again; keep the seen count honest
        state.seen[sp.id] -= 1
        uid = newMon(sp.id, info)
        state.box.push(uid)
      }
    }
    const fresh = uid ? state.mons[uid] : null
    const event = { kind: caught ? 'catch' : 'flee', id: sp.id, name: sp.ko, tier, shiny, place, via, gender: fresh?.gender ?? null, nature: fresh?.nature ?? null, ball, level, newSpecies: caught && (state.caught[sp.id]?.count ?? 0) === 1, sessionId, partner: mon?.dex, pity, attendance, uid, toProfessor, at: now() }
    pushLog(event)
    return event
  }

  // Per run: when each session was first seen, its last tool call, and whether it has met anything yet
  const sessionOpenedAt = new Map()
  const lastWorkAt = new Map()
  const encounteredIn = new Set()
  // Steps: each session's queue, when its last step was taken, and its last activity (tool call or thinking step)
  const pendingSteps = new Map()
  const lastStepAt = new Map()
  const lastActivityAt = new Map()

  /** A step's growth: work time since the last one (a break over 5 minutes is left out), level-up, evolution */
  function workStep(sessionId, mon, tool) {
    if (!mon) return null
    let grown = null
    const last = lastWorkAt.get(sessionId)
    if (last !== undefined && now() - last <= WORK_GAP_MS && now() > last) {
      const before = levelOf(mon)
      mon.workMs = (mon.workMs ?? 0) + (now() - last)
      if (levelOf(mon) > before) grown = pushLog({ kind: 'levelup', id: mon.dex, name: byId.get(mon.dex)?.ko, level: levelOf(mon), sessionId, uid: mon.uid, shiny: mon.shiny, at: now() })
    }
    lastWorkAt.set(sessionId, now())
    mon.steps += 1
    // Evolution comes with a level-up, at the games' level for it
    if (grown) {
      const evo = evolveIfDue(sessionId, mon, { terrain: terrainFor(tool).name, night: isNight(now()) })
      if (evo) { publish(grown); grown = evo }
    }
    return grown
  }

  function queueStep(sessionId, step) {
    const q = pendingSteps.get(sessionId) ?? []
    if (q.length < MAX_PENDING_STEPS) q.push(step)
    pendingSteps.set(sessionId, q)
  }

  /** Take the session's next waiting step, if STEP_SPACING has passed since its last: maybe a wild encounter */
  function drainStep(sessionId) {
    const q = pendingSteps.get(sessionId)
    if (!q?.length) return null
    const last = lastStepAt.get(sessionId)
    if (last !== undefined && now() - last < stepSpacingMs) return null
    const step = q.shift()
    if (!q.length) pendingSteps.delete(sessionId)
    lastStepAt.set(sessionId, now())
    if (random() >= ENCOUNTER_PER_STEP) return null
    const uid = state.assign[sessionId]
    return encounter(sessionId, uid ? state.mons[uid] : null, step.tool, false, step.via)
  }

  /**
   * The server calls this every couple of seconds: a session that is working
   * (Claude thinking or writing) with no tool call for THINK_STEP_MS takes a
   * thinking step, and every session's waiting steps are taken in turn.
   */
  function tick() {
    if (species.length === 0) return
    let changed = false
    for (const sessionId of new Set([...pendingSteps.keys(), ...lastActivityAt.keys()])) {
      const session = sessionOf(sessionId)
      if (session?.main?.state === 'working' && now() - (lastActivityAt.get(sessionId) ?? now()) >= THINK_STEP_MS) {
        lastActivityAt.set(sessionId, now())
        const uid = state.assign[sessionId]
        const grown = workStep(sessionId, uid ? state.mons[uid] : null, null)
        if (grown) { publish(grown); changed = true }
        const prompt = String(session?.main?.lastPrompt ?? '').replace(/\s+/g, ' ').trim()
        queueStep(sessionId, { tool: null, via: { tool: null, label: '생각하는 중', prompt: prompt ? (prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt) : null } })
        changed = true
      }
      const met = drainStep(sessionId)
      if (met) { publish(met); changed = true }
    }
    if (changed) save()
  }

  function pushLog(event) {
    state.log.push(event)
    if (state.log.length > LOG_LIMIT) state.log = state.log.slice(-LOG_LIMIT)
    return event
  }

  function isFinal(dex) {
    return !nextOf.has(dex)
  }

  /**
   * Which form a Pokémon evolves into at this level-up, if any. Like the games,
   * kept simple:
   *  - level evolutions at their level (Charmander 16)
   *  - friendship and other level-up conditions: once the trainer has raised it
   *    BOND_LEVELS levels ("friendship maxed"), at the next level-up
   *  - trade evolutions: after it was traded (a swap onto a session, or a
   *    box ↔ party exchange), at the next level-up
   *  - stones and the rest: level 30 (first evolution) / 40 (second)
   *  - Eevee from level 30: friendship maxed → Espeon by day, Umbreon at night;
   *    working in the forest (Read) → Leafeon; in a cave (Bash) at night →
   *    Glaceon; otherwise one of the three stone forms
   */
  function evolutionFor(mon, where) {
    const level = levelOf(mon)
    const raised = level - (mon.metLevel ?? STARTER_LEVEL)
    const bonded = raised >= BOND_LEVELS
    if (mon.dex === EEVEE) {
      if (level < 30) return null
      if (bonded) return where.night ? 197 : 196
      if (where.terrain === '숲') return 470
      if (where.terrain === '동굴' && where.night) return 471
      return [134, 135, 136][Math.floor(random() * 3)]
    }
    const ok = (nextOf.get(mon.dex) ?? []).filter((id) => {
      const sp = byId.get(id)
      const at = sp?.evolveLevel ?? 30
      switch (sp?.evolveHow) {
        case 'level': return level >= at
        case 'level-up': return bonded
        case 'trade': return !!mon.traded
        default: return level >= at
      }
    })
    if (!ok.length) return null
    return ok[Math.floor(random() * ok.length)]
  }

  /**
   * Evolve at the games' level: the next forms whose evolveLevel (from PokeAPI;
   * stone, trade and friendship evolutions get 30 / 40) the Pokémon has reached.
   * A branch (Eevee) picks one of the forms it qualifies for.
   */
  function evolveIfDue(sessionId, mon, where = {}) {
    if (isFinal(mon.dex)) return null
    const next = evolutionFor(mon, where)
    if (!next) return null
    const from = mon.dex
    mon.dex = next
    mon.evos += 1
    delete mon.traded
    markSeen(next)
    recordSpecies(next, { place: `${state.projects[sessionId] || '어딘가'} (진화)`, sessionId, project: state.projects[sessionId], how: 'evolve', shiny: mon.shiny })
    const event = { kind: 'evolve', id: next, from, name: byId.get(next)?.ko, fromName: byId.get(from)?.ko, sessionId, uid: mon.uid, shiny: mon.shiny, at: now() }
    pushLog(event)
    return event
  }

  /**
   * A hook event the server just processed. A session's first event sends a
   * party Pokémon out with it; a tool call is a step for that Pokémon.
   */
  function noteEvent(ev, session) {
    const sessionId = ev?.sessionId
    if (!sessionId || species.length === 0) return
    const fresh = ensureTrainer()
    if (session?.project) state.projects[sessionId] = session.project
    else if (ev.project && !state.projects[sessionId]) state.projects[sessionId] = ev.project
    if (ev.type === 'session_ended') { if (state.thrownAt) delete state.thrownAt[sessionId]; save(); publish(null); return }
    const { uid, isNew } = ensureAssigned(sessionId)
    const mon = uid ? state.mons[uid] : null
    let event = null
    if (isNew && mon) event = { kind: 'sendout', id: mon.dex, name: byId.get(mon.dex)?.ko, sessionId, uid, shiny: mon.shiny, at: now() }
    // Attendance: the day's first session event meets an uncaught species
    const today = localDay(now())
    if (state.attendedOn !== today) {
      state.attendedOn = today
      if (event) { publish(event); event = null }
      const att = encounter(sessionId, mon, ev.tool, true, catchSource(ev, session))
      if (att) { save(); publish(att) }
    }
    if (!sessionOpenedAt.has(sessionId)) sessionOpenedAt.set(sessionId, now())
    if (ev.type === 'agent_working' && !ev.failed) {
      lastActivityAt.set(sessionId, now())
      const grown = workStep(sessionId, mon, ev.tool)
      if (grown) { if (event) publish(event); event = grown }
      // The step waits its turn: a burst of tool calls is met one step at a time
      queueStep(sessionId, { tool: ev.tool, via: catchSource(ev, session) })
      const met = drainStep(sessionId)
      if (met) { if (event) publish(event); event = met }
    }
    if (fresh || event) {
      save()
      publish(event)
    } else if (ev.type === 'agent_working') {
      save() // a step only: no broadcast for every call
    }
  }

  /** Put another party Pokémon (not working elsewhere) on a session; a box one comes into the party first (exchange) */
  function swap(sessionId, uid) {
    const current = state.assign[sessionId]
    const cur = current && state.mons[current]
    const next = state.mons[uid]
    if (!cur) return { ok: false, reason: 'no-pokemon' }
    if (!next) return { ok: false, reason: 'unknown-pokemon' }
    if (uid === current) return { ok: false, reason: 'same' }
    if (!state.party.includes(uid)) return { ok: false, reason: 'not-in-party' }
    const busy = busyUids()
    if (busy.has(uid)) return { ok: false, reason: 'busy' }
    state.assign[sessionId] = uid
    next.traded = true // a trade: trade evolutions happen at its next level-up
    const event = { kind: 'swap', id: next.dex, from: cur.dex, name: byId.get(next.dex)?.ko, fromName: byId.get(cur.dex)?.ko, sessionId, uid, shiny: next.shiny, at: now() }
    pushLog(event)
    save()
    publish(event)
    return { ok: true }
  }

  /**
   * The trainer throws a Poké Ball: `uid` (a party Pokémon that is not working)
   * goes out with `sessionId`. The app calls this as it opens or resumes the
   * session, before Claude Code's first hook event arrives.
   */
  function throwBall(sessionId, uid) {
    ensureTrainer()
    const mon = state.mons[uid]
    if (!mon) return { ok: false, reason: 'unknown-pokemon' }
    if (!state.party.includes(uid)) return { ok: false, reason: 'not-in-party' }
    const busy = busyUids()
    const holder = busy.get(uid)
    if (holder && holder !== sessionId) return { ok: false, reason: 'busy' }
    state.assign[sessionId] = uid
    ;(state.thrownAt ??= {})[sessionId] = now()
    const event = { kind: 'sendout', id: mon.dex, name: byId.get(mon.dex)?.ko, sessionId, uid, shiny: mon.shiny, at: now() }
    pushLog(event)
    save()
    publish(event)
    return { ok: true }
  }

  /**
   * The PC: a box Pokémon trades places with a resting party Pokémon (no
   * session involved). Neither may be working.
   */
  function exchange(boxUid, partyUid) {
    if (!state.mons[boxUid] || !state.mons[partyUid]) return { ok: false, reason: 'unknown-pokemon' }
    const b = state.box.indexOf(boxUid)
    const p = state.party.indexOf(partyUid)
    if (b === -1 || p === -1) return { ok: false, reason: 'bad-request' }
    if (busyUids().has(partyUid)) return { ok: false, reason: 'busy' }
    state.box.splice(b, 1)
    state.party[p] = boxUid
    state.mons[boxUid].traded = true
    state.box.push(partyUid)
    const mon = state.mons[boxUid]
    const event = { kind: 'exchange', id: mon.dex, name: byId.get(mon.dex)?.ko, uid: boxUid, from: state.mons[partyUid].dex, at: now() }
    pushLog(event)
    save()
    publish(event)
    return { ok: true }
  }

  /** Let a box Pokémon go (never one in the party or working a session) */
  function release(uid) {
    const mon = state.mons[uid]
    if (!mon) return { ok: false, reason: 'unknown-pokemon' }
    if (state.party.includes(uid)) return { ok: false, reason: 'in-party' }
    if (busyUids().has(uid)) return { ok: false, reason: 'busy' }
    const at = state.box.indexOf(uid)
    if (at !== -1) state.box.splice(at, 1)
    delete state.mons[uid]
    for (const [sid, u] of Object.entries(state.assign)) if (u === uid) delete state.assign[sid]
    // Remembered, so the next cloud sync does not bring it back from the copy uploaded before
    state.released = { ...(state.released ?? {}), [monKey(mon)]: now() }
    const event = { kind: 'release', id: mon.dex, name: byId.get(mon.dex)?.ko, uid, at: now() }
    pushLog(event)
    save()
    publish(event)
    return { ok: true }
  }

  /** The whole saved game (for the cloud copy) */
  function exportState() { return state }

  /**
   * Take a synced game: this PC's game merged with the cloud's (server/merge.js),
   * which already carries this PC's own session assignments and party. The
   * game as it was is copied to pokedex.json.before-sync first, so a bad merge
   * can be undone by hand; without that copy nothing is replaced.
   */
  function importState(next) {
    if (!next || next.version !== 2) return false
    try {
      writeFileSync(`${file}.before-sync`, JSON.stringify(state))
    } catch (err) {
      console.error('[pokedex] could not back up before a sync, keeping this game:', err.message)
      return false
    }
    state = { ...emptyState(), ...next }
    upgradeMons()
    traitsBackfilled = false
    save()
    publish(null)
    return true
  }

  return { noteEvent, tick, swap, throwBall, release, exchange, publicState, exportState, importState, _state: () => state }
}
