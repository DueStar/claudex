/**
 * pokedexStore.ts — the game state from the server (server/pokedex.js): the
 * trainer's party and box, which Pokémon works which session, the Pokédex, and
 * the latest event for the toast.
 */

import { useSyncExternalStore } from 'react'
import { assignPokemonToRole, setOwnedSpecies, POKEMON } from './theme'

import NATURES from './pokemon/natures.json'
import BALL_DATA from './pokemon/balls.json'

export type Tier = 'common' | 'rare' | 'sub' | 'legendary' | 'mythical'

/** What brought a Pokémon out: the tool call and the request the session was on */
export interface CatchSource { tool: string | null; label: string; prompt: string | null }

export type Gender = 'male' | 'female' | 'none' | null

export interface Nature { id: number; en: string; ko: string; up: string | null; down: string | null }
export const NATURE_BY_ID = new Map((NATURES as Nature[]).map(n => [n.id, n]))

export function genderMark(g: Gender | undefined): string {
  return g === 'male' ? '♂' : g === 'female' ? '♀' : ''
}

/** "‘요청…’ 하다가 Bash(npm test)로 포획" */
export function sourceText(v: CatchSource | null | undefined): string {
  if (!v) return ''
  return v.prompt ? `‘${v.prompt}’ 요청 중 ${v.label}로` : `${v.label}로`
}

export interface CaughtInfo {
  count: number
  firstAt: number
  lastAt: number
  place: string
  sessionId?: string
  project?: string
  how: 'starter' | 'gift' | 'wild' | 'evolve' | 'pity' | 'attendance'
  shiny: boolean
  via?: CatchSource | null
  /** The ball it was caught in (server/balls.json id) */
  ball?: string | null
  /** Level when met, and the work time since (one level per 30 minutes) */
  metLevel?: number
  workMs?: number
  level?: number
}

/** One Pokémon the trainer owns */
export interface Mon {
  uid: string
  dex: number
  steps: number
  evos: number
  shiny: boolean
  how: CaughtInfo['how']
  place: string
  at: number
  gender?: Gender
  nature?: number | null
  via?: CatchSource | null
  /** The ball it was caught in (server/balls.json id) */
  ball?: string | null
  /** Level when met, and the work time since (one level per 30 minutes) */
  metLevel?: number
  workMs?: number
  level?: number
}

export interface DexEvent {
  kind: 'catch' | 'flee' | 'evolve' | 'sendout' | 'swap' | 'release' | 'exchange' | 'levelup'
  id: number
  name?: string
  tier?: Tier
  shiny?: boolean
  place?: string
  sessionId?: string
  pity?: boolean
  /** The day's attendance encounter (an uncaught species) */
  attendance?: boolean
  /** The box was full: the Pokédex counts it, the individual went to the professor */
  toProfessor?: boolean
  level?: number
  via?: CatchSource | null
  /** The ball it was caught in (server/balls.json id) */
  ball?: string | null
  gender?: Gender
  nature?: number | null
  from?: number
  fromName?: string
  uid?: string
  at: number
}

export interface DexState {
  caught: Record<string, CaughtInfo>
  seen: Record<string, number>
  trainer: { starter: number; since: number } | null
  mons: Record<string, Mon>
  party: string[]
  box: string[]
  /** sessionId -> uid, active sessions only */
  assign: Record<string, string>
  /** sessionId -> uid for every session that ever had a Pokémon (resume brings it back) */
  remembered?: Record<string, string>
  partySize: number
  boxLimit?: number
  encounters: number
  sinceLegend: number
  sinceMythical: number
  pity: number
  pityMythical: number
  total: number
  log: DexEvent[]
}

export const TIER_LABEL: Record<Tier, string> = {
  common: '일반', rare: '희귀', sub: '준전설', legendary: '전설', mythical: '환상',
}

/** The encounter odds the server rolls (server/pokedex.js RATES), for the dex's rate table */
export const TIER_RATE: Record<Tier, string> = {
  common: '74%', rare: '21%', sub: '3.6%', legendary: '1.0%', mythical: '0.4%',
}

export const TYPE_KO: Record<string, string> = {
  normal: '노말', fire: '불꽃', water: '물', grass: '풀', electric: '전기', ice: '얼음', fighting: '격투',
  poison: '독', ground: '땅', flying: '비행', psychic: '에스퍼', bug: '벌레', rock: '바위', ghost: '고스트',
  dragon: '드래곤', dark: '악', steel: '강철', fairy: '페어리',
}

const EVOLVES = new Set(POKEMON.filter(p => p.evolvesFrom).map(p => p.evolvesFrom as number))
/** A species with nowhere left to evolve (only these may be swapped off a session) */
export function isFullyEvolved(dex: number): boolean { return !EVOLVES.has(dex) }

let state: DexState | null = null
let lastEvent: DexEvent | null = null
let version = 0
const listeners = new Set<() => void>()

function emit() { version++; listeners.forEach(l => l()) }

/** Feed every socket message through here (the office and the widget both do). */
export function dispatchPokedex(msg: { type?: string; state?: DexState; event?: DexEvent } | null | undefined) {
  if (!msg || msg.type !== 'pokedex' || !msg.state) return
  state = msg.state
  // Each session is drawn as the party Pokémon working it
  for (const [sessionId, uid] of Object.entries(state.assign ?? {})) {
    const mon = state.mons?.[uid]
    if (mon) assignPokemonToRole(`session:${sessionId}`, mon.dex, mon.shiny)
  }
  // Workers borrow from the trainer's own Pokémon
  setOwnedSpecies([...new Set(Object.values(state.mons ?? {}).map(m => m.dex))])
  if (msg.event) lastEvent = msg.event
  emit()
}

export function usePokedex(): { state: DexState | null; lastEvent: DexEvent | null } {
  useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => version,
    () => version,
  )
  return { state, lastEvent }
}

/** Party Pokémon not working a session right now */
export function freePartyCount(s: DexState | null): number {
  if (!s) return Infinity
  const busy = new Set(Object.values(s.assign ?? {}))
  return s.party.filter(uid => !busy.has(uid)).length
}

// ---------------------------------------------------------------------------
// Pokédex entries the trainer has opened: a caught species whose entry was
// never looked at wears a red "new" dot. Kept per PC (localStorage).
// ---------------------------------------------------------------------------
const VIEWED_KEY = 'claudex-dex-viewed'
let viewed: Set<number> = (() => {
  try { return new Set<number>(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '[]')) } catch { return new Set<number>() }
})()
let viewedVersion = 0
const viewedListeners = new Set<() => void>()

export function markViewed(id: number) {
  if (viewed.has(id)) return
  viewed = new Set(viewed).add(id)
  try { localStorage.setItem(VIEWED_KEY, JSON.stringify([...viewed])) } catch {}
  viewedVersion++
  for (const l of viewedListeners) l()
}

/** The set of opened entries, and whether a caught species is still unseen */
export function useViewed(): { viewed: Set<number>; isNew: (id: number) => boolean } {
  useSyncExternalStore(
    (cb) => { viewedListeners.add(cb); return () => viewedListeners.delete(cb) },
    () => viewedVersion,
    () => viewedVersion,
  )
  return { viewed, isNew: (id) => !!state?.caught?.[id] && !viewed.has(id) }
}

// ---------------------------------------------------------------------------
// Poké Balls: which ball a catch came in (the server rolls it by weight)
// ---------------------------------------------------------------------------
export interface Ball { id: string; ko: string; en: string; tier: string; weight: number }
export const BALLS: Ball[] = (BALL_DATA as { balls: Ball[] }).balls
export const BALL_BY_ID = new Map(BALLS.map(b => [b.id, b]))
export const BALL_TIER_LABEL: Record<string, string> = (BALL_DATA as { tiers: Record<string, string> }).tiers
export function ballName(id: string | null | undefined): string {
  return BALL_BY_ID.get(id ?? 'poke-ball')?.ko ?? '몬스터볼'
}
/** The ball's picture (shipped with the app; Claudex's own ball when it is missing) */
export function ballUrl(id: string | null | undefined): string {
  return `/sprites/balls/${BALL_BY_ID.has(id ?? '') ? id : 'poke-ball'}.png`
}

/** Levels: met level + one per 30 minutes of work, up to 100 (server/pokedex.js) */
export const MINUTES_PER_LEVEL = 30
export function levelOf(m: { metLevel?: number; workMs?: number } | null | undefined): number {
  if (!m) return 1
  return Math.min(100, (m.metLevel ?? 5) + Math.floor((m.workMs ?? 0) / (MINUTES_PER_LEVEL * 60000)))
}
/** Minutes of work left before the next level */
export function minutesToNext(m: { metLevel?: number; workMs?: number }): number | null {
  if (levelOf(m) >= 100) return null
  const into = ((m.workMs ?? 0) / 60000) % MINUTES_PER_LEVEL
  return Math.ceil(MINUTES_PER_LEVEL - into)
}
