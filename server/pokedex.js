/**
 * pokedex.js — the game, trainer style.
 *
 * The trainer starts with a party of six: a starter (이상해씨 / 파이리 / 꼬부기, at
 * random) and five base-form Pokémon. Each Claude Code session takes a party
 * Pokémon that is not working (the starter first); with all six out, there is
 * no one left to send. Growth belongs to the Pokémon, not the session: every
 * tool call is a step for it, and it evolves at EVOLVE_AT steps. A fully
 * evolved Pokémon can be swapped out of its session for another one the
 * trainer owns, so a busy session can raise someone new.
 *
 * Every step is also a step through tall grass: it may meet a wild Pokémon,
 * rolled on a gacha-style table with pities, and the caught ones go to the box.
 * Everything is kept in <runtime dir>/pokedex.json.
 *
 *   createPokedex({ file, species, broadcast, isActive?, now?, random? })
 *     .noteEvent(event, session)    after the server processed a hook event
 *     .swap(sessionId, uid)         put another Pokémon on a session (fully evolved only)
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
/** Steps a Pokémon walks before each evolution (its 1st, then its 2nd) */
export const EVOLVE_AT = [120, 360]

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
 * characters, only as much as the office's logPrompts setting keeps).
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
  }
}

export function createPokedex({ file, species, natures = [], balls = [], broadcast, isActive = () => true, onChange = () => {}, now = () => Date.now(), random = Math.random }) {
  const byId = new Map(species.map(s => [s.id, s]))
  const byTier = {}
  for (const s of species) (byTier[s.tier] ??= []).push(s)
  const nextOf = new Map()
  for (const s of species) if (s.evolvesFrom) (nextOf.get(s.evolvesFrom) ?? nextOf.set(s.evolvesFrom, []).get(s.evolvesFrom)).push(s.id)

  let state = load()
  for (const m of Object.values(state.mons ?? {})) {
    if (m.gender === undefined) m.gender = null
    if (m.nature === undefined) m.nature = null
    if (m.ball === undefined) m.ball = 'poke-ball' // caught before balls were kept
  }
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
  const ballTotal = balls.reduce((a, b) => a + (b.weight || 0), 0)
  function rollBall() {
    if (!ballTotal) return 'poke-ball'
    let r = random() * ballTotal
    for (const b of balls) { r -= b.weight || 0; if (r < 0) return b.id }
    return balls[balls.length - 1].id
  }
  function rollNature() {
    return natures.length ? natures[Math.floor(random() * natures.length)].id : null
  }

  function newMon(dex, info) {
    const uid = `m${state.nextUid++}`
    state.mons[uid] = {
      uid, dex, steps: 0, evos: 0, shiny: !!info.shiny, how: info.how, place: info.place, at: now(),
      gender: rollGender(dex), nature: rollNature(), via: info.via ?? null, ball: info.ball ?? 'poke-ball',
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

  function rollTier() {
    if (state.sinceMythical + 1 >= PITY_MYTHICAL) return { tier: 'mythical', pity: true }
    if (state.sinceLegend + 1 >= PITY) return { tier: 'legendary', pity: true }
    let r = random()
    for (const tier of TIER_ORDER) {
      r -= RATES[tier]
      if (r < 0) return { tier, pity: false }
    }
    return { tier: 'common', pity: false }
  }

  /** A species of the tier: uncaught ones boosted, the terrain's types ×3, commons by capture rate */
  function pickSpecies(tier, favoured) {
    const pool = byTier[tier]?.length ? byTier[tier] : byTier.common
    const weights = pool.map(s => {
      let w = tier === 'common' ? Math.max(1, s.captureRate ?? 45) : 1
      if (!state.caught[s.id]) w *= NEW_SPECIES_BOOST
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

  /** An uncaught species of the tier, else of the nearest tier that still has one (null once the dex is full) */
  function uncaughtSpecies(tier) {
    const order = [tier, ...TIER_ORDER.slice().reverse().filter(t => t !== tier)]
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
    let { tier, pity } = rollTier()
    let sp
    if (attendance) {
      const pick = uncaughtSpecies(tier)
      if (!pick) return null
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
    let uid = null
    let toProfessor = false
    let ball = null
    if (caught) {
      ball = rollBall()
      const info = { place, sessionId, project, how: pity ? 'pity' : attendance ? 'attendance' : 'wild', shiny, via, ball }
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
    const event = { kind: caught ? 'catch' : 'flee', id: sp.id, name: sp.ko, tier, shiny, place, via, gender: fresh?.gender ?? null, nature: fresh?.nature ?? null, ball, sessionId, partner: mon?.dex, pity, attendance, uid, toProfessor, at: now() }
    pushLog(event)
    return event
  }

  function pushLog(event) {
    state.log.push(event)
    if (state.log.length > 200) state.log = state.log.slice(-200)
  }

  function isFinal(dex) {
    return !nextOf.has(dex)
  }

  function evolveIfDue(sessionId, mon) {
    const need = EVOLVE_AT[Math.min(mon.evos, EVOLVE_AT.length - 1)]
    if (mon.evos >= EVOLVE_AT.length || mon.steps < need || isFinal(mon.dex)) return null
    const options = nextOf.get(mon.dex)
    const next = options[Math.floor(random() * options.length)]
    const from = mon.dex
    mon.dex = next
    mon.evos += 1
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
    if (ev.type === 'agent_working' && !ev.failed) {
      if (mon) {
        mon.steps += 1
        const evo = evolveIfDue(sessionId, mon)
        if (evo) event = evo
      }
      if ((!event || event.kind === 'sendout') && random() < ENCOUNTER_PER_STEP) event = encounter(sessionId, mon, ev.tool, false, catchSource(ev, session))
    }
    if (fresh || event) {
      save()
      publish(event)
    } else if (ev.type === 'agent_working') {
      save() // a step only: no broadcast for every call
    }
  }

  /** Put another owned Pokémon (party or box, not working elsewhere) on a session */
  function swap(sessionId, uid) {
    const current = state.assign[sessionId]
    const cur = current && state.mons[current]
    const next = state.mons[uid]
    if (!cur) return { ok: false, reason: 'no-pokemon' }
    if (!next) return { ok: false, reason: 'unknown-pokemon' }
    if (uid === current) return { ok: false, reason: 'same' }
    const busy = busyUids()
    if (busy.has(uid)) return { ok: false, reason: 'busy' }
    const boxAt = state.box.indexOf(uid)
    if (boxAt !== -1) {
      // From the box: it takes the party slot, the old one goes to the box
      const slot = state.party.indexOf(current)
      state.box.splice(boxAt, 1)
      if (slot !== -1) state.party[slot] = uid
      else state.party.push(uid)
      state.box.push(current)
    }
    state.assign[sessionId] = uid
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
    const event = { kind: 'release', id: mon.dex, name: byId.get(mon.dex)?.ko, uid, at: now() }
    pushLog(event)
    save()
    publish(event)
    return { ok: true }
  }

  /** The whole saved game (for the cloud copy) */
  function exportState() { return state }

  /** Take a game from the cloud: keep this PC's live session assignments out of it */
  function importState(next) {
    if (!next || next.version !== 2) return false
    state = { ...emptyState(), ...next, assign: {}, projects: {} }
    save()
    publish(null)
    return true
  }

  return { noteEvent, swap, throwBall, release, exchange, publicState, exportState, importState, _state: () => state }
}
