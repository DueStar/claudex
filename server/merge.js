/**
 * merge.js — combine two copies of the saved game (this PC's and the cloud's)
 * so that nothing caught on either side is lost.
 *
 * The cloud copy used to be all-or-nothing: whichever side had caught more
 * species replaced the other, so two PCs that caught different Pokémon lost
 * one PC's catches. mergeGames() is a union instead:
 *
 *   - individuals (state.mons) are unioned; the same individual on both sides
 *     keeps its furthest progress;
 *   - the Pokédex (caught / seen) is unioned per species;
 *   - the party stays this PC's own; every other member lives in the box;
 *   - counters take the larger side, device-local state stays local.
 *
 * It is pure (no I/O, no clock, inputs untouched), idempotent
 * (merge(a, merge(a, b)) equals merge(a, b)), and the individuals and the
 * Pokédex come out the same whichever side is passed first.
 *
 *   mergeGames(local, remote)  -> a new game
 *   sameGame(a, b)             -> deep equality, key order ignored
 */

import { BOX_LIMIT, PARTY_SIZE, STARTER_LEVEL, LOG_LIMIT } from './pokedex.js'

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const isGame = (g) => !!g && typeof g === 'object' && g.version === 2
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** JSON with object keys sorted, so equal data always gives the same string */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/** Deep equality of two saved games (or any JSON), key order ignored */
export function sameGame(a, b) {
  return stableStringify(a) === stableStringify(b)
}

/** uids are `m<n>` from a per-PC counter: order them by n, anything odd after */
function uidNumber(u) {
  const m = /^m(\d+)$/.exec(String(u))
  return m ? Number(m[1]) : null
}
function uidCompare(a, b) {
  const x = uidNumber(a), y = uidNumber(b)
  if (x !== null && y !== null) return x - y
  if (x !== null) return -1
  if (y !== null) return 1
  return cmp(String(a), String(b))
}

const without = (obj, keys) => {
  const out = { ...obj }
  for (const k of keys) delete out[k]
  return out
}

// ---------------------------------------------------------------------------
// Individuals
//
// A uid alone does not identify an individual across PCs: uids come from each
// PC's own counter (`m${nextUid++}`), so two PCs that started apart both have
// an m1 … m6 that are different Pokémon. An individual is therefore known by
// the uid it was first given plus the facts fixed when it was caught (catch
// time to the millisecond, how, where, ball, met level, shiny). When two
// different individuals want the same uid, the earlier catch keeps it and the
// other gets a fresh one, remembering its first uid in `originUid` so the next
// merge still recognises it on the PC that has it under the old uid.
// ---------------------------------------------------------------------------

/** The facts fixed at the catch (defaults as pokedex.js backfills old saves) */
function identity(m) {
  const fixed = [m.at ?? null, m.how ?? null, m.place ?? null, m.ball ?? 'poke-ball', m.metLevel ?? STARTER_LEVEL, !!m.shiny]
  return `${m.originUid ?? m.uid}|${JSON.stringify(fixed)}`
}

// Fields the merge sets itself; everything else comes whole from one copy
const MON_MERGED_FIELDS = ['uid', 'originUid', 'steps', 'workMs', 'gender', 'nature']

/**
 * One individual seen on both sides: the copy furthest along (more
 * evolutions, then more work time, then more steps) is the base, so its
 * species and evolution stay consistent; steps and work time take the larger
 * side (level comes from work time, so the higher level wins); a gender or
 * nature only one side has rolled is kept. Ties fall back to comparing the
 * remaining fields, which keeps the choice the same in either argument order.
 */
function mergeMon(copies) {
  const ordered = copies.slice().sort((x, y) =>
    num(y.evos) - num(x.evos) ||
    num(y.workMs) - num(x.workMs) ||
    num(y.steps) - num(x.steps) ||
    cmp(stableStringify(without(x, MON_MERGED_FIELDS)), stableStringify(without(y, MON_MERGED_FIELDS))))
  const out = clone(ordered[0])
  out.steps = Math.max(...copies.map(c => num(c.steps)))
  out.workMs = Math.max(...copies.map(c => num(c.workMs)))
  for (const k of ['gender', 'nature']) {
    if (out[k] === null || out[k] === undefined) {
      const other = ordered.find(c => c[k] !== null && c[k] !== undefined)
      if (other) out[k] = other[k]
    }
  }
  out.at = Math.min(...copies.map(c => (typeof c.at === 'number' ? c.at : Infinity)))
  if (!Number.isFinite(out.at)) out.at = ordered[0].at ?? null
  return out
}

/**
 * Union of the individuals. Returns the merged `mons`, the next free uid
 * number, and for each side a map from its uids to the merged uids.
 */
function mergeMons(L, R) {
  const groups = new Map() // identity -> { copies, uids: Set, at }
  const sides = [[L, 'l'], [R, 'r']]
  for (const [g, side] of sides) {
    for (const [key, m] of Object.entries(g.mons ?? {})) {
      if (!m || typeof m !== 'object') continue
      // The key is the uid the game uses (state.mons[uid]); trust it over the field
      const mon = { ...m, uid: key }
      const id = identity(mon)
      const grp = groups.get(id) ?? { id, copies: [], uids: new Set(), members: [] }
      grp.copies.push(mon)
      grp.uids.add(mon.uid)
      grp.members.push([side, mon.uid])
      groups.set(id, grp)
    }
  }
  // Earlier catches choose first, so an old individual keeps its uid
  const order = [...groups.values()].map(g => ({ ...g, merged: mergeMon(g.copies) }))
  order.sort((x, y) => num(x.merged.at) - num(y.merged.at) || cmp(x.id, y.id))

  let next = Math.max(num(L.nextUid) || 1, num(R.nextUid) || 1)
  for (const g of order) for (const u of g.uids) { const n = uidNumber(u); if (n !== null) next = Math.max(next, n + 1) }

  const taken = new Set()
  const fresh = []
  for (const g of order) {
    const pick = [...g.uids].sort(uidCompare).find(u => !taken.has(u))
    if (pick === undefined) { fresh.push(g); continue }
    g.final = pick
    taken.add(pick)
  }
  for (const g of fresh) { g.final = `m${next++}`; taken.add(g.final) }

  const mons = {}
  const map = { l: {}, r: {} }
  for (const g of order) {
    const m = g.merged
    const origin = m.originUid ?? m.uid
    m.uid = g.final
    if (origin !== g.final) m.originUid = origin
    else delete m.originUid
    mons[g.final] = m
    for (const [side, u] of g.members) map[side][u] = g.final
  }
  return { mons, nextUid: next, mapL: map.l, mapR: map.r }
}

/** A party list through a uid map: existing members only, no repeats, at most PARTY_SIZE */
function cleanParty(list, map, mons) {
  const out = []
  for (const u of Array.isArray(list) ? list : []) {
    const f = map[u]
    if (f && mons[f] && !out.includes(f)) out.push(f)
    if (out.length === PARTY_SIZE) break
  }
  return out
}

/**
 * A party nobody has used: a PC that just started its own trainer (every
 * first run makes a starter and five gifts) and never took a step with them.
 */
function untouchedParty(g, party) {
  return party.every(u => num(g.mons?.[u]?.steps) === 0)
}

// ---------------------------------------------------------------------------
// Pokédex
// ---------------------------------------------------------------------------

// Fields mergeCaught sets itself; the rest describe the first catch
const CAUGHT_MERGED_FIELDS = ['count', 'firstAt', 'lastAt', 'shiny']

/**
 * One species caught on both sides. The count is the larger side's, not the
 * sum: after any earlier sync both sides already hold the same catches, so a
 * sum would count them again on every sync. (Two PCs catching the same
 * species apart between syncs undercount a little; the count only weights
 * encounters and is shown, it never loses a Pokémon.) The first catch is the
 * earlier one, along with where and how it happened; the last catch is the
 * later one; shiny is either side's.
 */
function mergeCaught(x, y) {
  if (!x || typeof x !== 'object') return clone(y)
  if (!y || typeof y !== 'object') return clone(x)
  const fx = typeof x.firstAt === 'number' ? x.firstAt : Infinity
  const fy = typeof y.firstAt === 'number' ? y.firstAt : Infinity
  const xFirst = fx !== fy ? fx < fy
    : cmp(stableStringify(without(x, CAUGHT_MERGED_FIELDS)), stableStringify(without(y, CAUGHT_MERGED_FIELDS))) <= 0
  const [first, later] = xFirst ? [x, y] : [y, x]
  const out = { ...clone(later), ...clone(first) }
  out.count = Math.max(num(x.count), num(y.count))
  const firstAt = Math.min(fx, fy)
  if (Number.isFinite(firstAt)) out.firstAt = firstAt
  const lasts = [x.lastAt, y.lastAt].filter(t => typeof t === 'number')
  if (lasts.length) out.lastAt = Math.max(...lasts)
  out.shiny = !!x.shiny || !!y.shiny
  return out
}

function mergeCaughtMap(a = {}, b = {}) {
  const out = {}
  for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) out[id] = mergeCaught(a?.[id], b?.[id])
  return out
}

/** Seen counts: either side's species, the larger count (same reason as caught) */
function mergeSeen(a = {}, b = {}) {
  const out = {}
  for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) out[id] = Math.max(num(a?.[id]), num(b?.[id]))
  return out
}

// ---------------------------------------------------------------------------
// The rest
// ---------------------------------------------------------------------------

/** The log: both sides' events (uids renamed to the merged ones), oldest first, the newest LOG_LIMIT */
function mergeLog(L, R, mapL, mapR, extra) {
  const seen = new Map()
  const add = (e, map) => {
    if (!e || typeof e !== 'object') return
    const ev = clone(e)
    if (ev.uid && map[ev.uid]) ev.uid = map[ev.uid]
    const key = stableStringify(ev)
    if (!seen.has(key)) seen.set(key, ev)
  }
  for (const e of Array.isArray(L.log) ? L.log : []) add(e, mapL)
  for (const e of Array.isArray(R.log) ? R.log : []) add(e, mapR)
  for (const e of extra) add(e, {})
  return [...seen.entries()]
    .sort(([ka, a], [kb, b]) => num(a.at) - num(b.at) || cmp(ka, kb))
    .map(([, e]) => e)
    .slice(-LOG_LIMIT)
}

/** The trainer is the one who started first (a new PC's fresh trainer joins the old one) */
function mergeTrainer(a, b) {
  if (!a) return clone(b ?? null)
  if (!b) return clone(a)
  const sa = typeof a.since === 'number' ? a.since : Infinity
  const sb = typeof b.since === 'number' ? b.since : Infinity
  if (sa !== sb) return clone(sa < sb ? a : b)
  return clone(cmp(stableStringify(a), stableStringify(b)) <= 0 ? a : b)
}

const maxDay = (a, b) => (a && b ? (a > b ? a : b) : a || b || null)

/**
 * How every top-level field is combined. Anything not listed (a field a newer
 * version added) keeps this PC's value, or the other side's when this PC has
 * none, so a newer app's data survives a round trip through an older one.
 */
const HANDLED = new Set([
  'version', 'caught', 'seen', 'trainer', 'mons', 'party', 'box', 'assign', 'projects', 'nextUid',
  'encounters', 'sinceLegend', 'sinceMythical', 'attendedOn', 'log', 'daily', 'thrownAt',
])

/**
 * Merge this PC's game (`local`) with another copy (`remote`, the cloud's).
 * A side that is not a version-2 game is ignored.
 */
export function mergeGames(local, remote) {
  if (!isGame(remote)) return clone(local)
  if (!isGame(local)) return clone(remote)
  const L = clone(local)
  const R = clone(remote)

  const { mons, nextUid, mapL, mapR } = mergeMons(L, R)
  const trainer = mergeTrainer(L.trainer, R.trainer)

  // The party is this PC's own (what it shows and sends out), cleaned to be
  // valid. Exception: a PC whose trainer is newer than the other side's and
  // whose party never took a step (a fresh install signing in) gets the other
  // side's party, so signing in on a new PC brings your team along; its own
  // fresh six still join the box below.
  let party = cleanParty(L.party, mapL, mons)
  const remoteParty = cleanParty(R.party, mapR, mons)
  const localIsNew = L.trainer && R.trainer && num(L.trainer.since) > num(R.trainer.since)
  if (!party.length || (localIsNew && remoteParty.length && untouchedParty(L, (Array.isArray(L.party) ? L.party : []).filter(u => L.mons?.[u])))) party = remoteParty

  // Every individual not in the party is in the box (the other side's party
  // included): this PC's box order first, then the other side's, then the rest
  // by catch time.
  const inParty = new Set(party)
  const box = []
  const inBox = new Set()
  const put = (u) => { if (u && mons[u] && !inParty.has(u) && !inBox.has(u)) { inBox.add(u); box.push(u) } }
  for (const u of Array.isArray(L.box) ? L.box : []) put(mapL[u])
  for (const u of Array.isArray(R.box) ? R.box : []) put(mapR[u])
  Object.values(mons).sort((x, y) => num(x.at) - num(y.at) || uidCompare(x.uid, y.uid)).forEach(m => put(m.uid))

  // The box holds BOX_LIMIT. Past that, the newest catches go to the
  // professor, as a catch into a full box does in the game: the Pokédex keeps
  // them (their species stay caught) and the log says so. Anyone in either
  // side's party is kept.
  const professor = []
  if (box.length > BOX_LIMIT) {
    const kept = new Set([...party, ...remoteParty])
    const victims = box
      .filter(u => !kept.has(u))
      .sort((x, y) => num(mons[y].at) - num(mons[x].at) || uidCompare(y, x))
      .slice(0, box.length - BOX_LIMIT)
    const gone = new Set(victims)
    for (const u of victims) {
      const m = mons[u]
      // `at` is the catch time, not now: the merge stays pure and repeatable
      professor.push({ kind: 'professor', id: m.dex, uid: u, shiny: !!m.shiny, at: m.at ?? 0, toProfessor: true })
      delete mons[u]
    }
    for (let i = box.length - 1; i >= 0; i--) if (gone.has(box[i])) box.splice(i, 1)
  }

  // Session assignments are this PC's (its own sessions), renamed and still pointing somewhere
  const assign = {}
  for (const [sid, u] of Object.entries(L.assign ?? {})) if (mapL[u] && mons[mapL[u]]) assign[sid] = mapL[u]

  const out = {}
  // Unknown fields first, so the handled ones below always win
  for (const k of Object.keys(R)) if (!HANDLED.has(k)) out[k] = R[k]
  for (const k of Object.keys(L)) if (!HANDLED.has(k)) out[k] = L[k]
  Object.assign(out, {
    version: 2,
    caught: mergeCaughtMap(L.caught, R.caught),
    seen: mergeSeen(L.seen, R.seen),
    trainer,
    mons,
    party,
    box,
    assign,
    projects: L.projects ?? {},             // device-local: which session ran in which project
    nextUid,
    encounters: Math.max(num(L.encounters), num(R.encounters)), // monotonic counter
    sinceLegend: num(L.sinceLegend),        // pity counters reset on a hit, so neither side is "newer": keep this PC's luck
    sinceMythical: num(L.sinceMythical),
    attendedOn: maxDay(L.attendedOn, R.attendedOn), // one attendance a day per trainer, whichever PC took it
    log: mergeLog(L, R, mapL, mapR, professor),
  })
  if (L.daily !== undefined) out.daily = L.daily          // device-local: today's catch number (Premier Ball)
  if (L.thrownAt !== undefined) out.thrownAt = L.thrownAt // device-local: this PC's session starts
  return out
}
