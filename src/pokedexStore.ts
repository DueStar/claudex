/**
 * pokedexStore.ts — the game state from the server (server/pokedex.js): the
 * trainer's party and box, which Pokémon works which session, the Pokédex, and
 * the latest event for the toast.
 */

import { useSyncExternalStore } from 'react'
import { castSession, POKEMON } from './theme'
import { getSettings } from './settingsStore'
import { t, lang, josa, nameOf, typeName, tierName, ballTierName } from './i18n'
import { placeIn, sourceLabelIn } from './gameText'

import NATURES from '../server/natures.json'
import BALL_DATA from '../server/balls.json'

export type Tier = 'common' | 'rare' | 'sub' | 'legendary' | 'mythical'

/** What brought a Pokémon out: the tool call and the request the session was on */
export interface CatchSource { tool: string | null; label: string; prompt: string | null }

export type Gender = 'male' | 'female' | 'none' | null

export interface Nature { id: number; en: string; ko: string; ja?: string; up: string | null; down: string | null }
export const NATURE_BY_ID = new Map((NATURES as Nature[]).map(n => [n.id, n]))

export function genderMark(g: Gender | undefined): string {
  return g === 'male' ? '♂' : g === 'female' ? '♀' : ''
}

/** "‘요청…’ 하다가 Bash(npm test)로 포획" */
/** The catch source's label in the language in use (src/gameText.ts) */
export const sourceLabel = (label: string): string => sourceLabelIn(label, lang())
/** A saved place name in the language in use: codes and the Korean names of older saves alike (src/gameText.ts) */
export const placeText = (place: string | null | undefined): string => placeIn(place, lang())

export function sourceText(v: CatchSource | null | undefined): string {
  if (!v) return ''
  // 설정 › 개인정보: the request text stays off the screen (shared screens, meetings)
  const label = sourceLabel(v.label)
  const ro = josa(label, '으로')
  return v.prompt && !getSettings().privacy.hidePrompts ? t('‘{prompt}’ 요청 중 {label}{ro}', { prompt: v.prompt, label, ro }) : t('{label}{ro}', { label, ro })
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
  kind: 'catch' | 'flee' | 'evolve' | 'sendout' | 'swap' | 'release' | 'exchange' | 'levelup' | 'professor'
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
  /** The first catch of its species */
  newSpecies?: boolean
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
  /** Today's events (local day) */
  today?: DexEvent[]
}

/** Tier names in the language in use (read like a map, worked out on each read) */
export const TIER_LABEL = new Proxy({} as Record<Tier, string>, { get: (_t, k) => tierName(String(k)) })

/** The encounter odds the server rolls (server/pokedex.js RATES), for the dex's rate table */
export const TIER_RATE: Record<Tier, string> = {
  common: '74%', rare: '21%', sub: '3.6%', legendary: '1.0%', mythical: '0.4%',
}

/** Official type names in the language in use (the name says Korean; it is the type's display name) */
export const TYPE_KO = new Proxy({} as Record<string, string>, { get: (_t, k) => typeName(String(k)) })

const EVOLVES = new Set(POKEMON.filter(p => p.evolvesFrom).map(p => p.evolvesFrom as number))
/** A species with nowhere left to evolve (only these may be swapped off a session) */
export function isFullyEvolved(dex: number): boolean { return !EVOLVES.has(dex) }

let state: DexState | null = null
let lastEvent: DexEvent | null = null
let version = 0
const listeners = new Set<() => void>()

function emit() { version++; listeners.forEach(l => l()) }

/** Feed every socket message through here. */
export function dispatchPokedex(msg: { type?: string; state?: DexState; event?: DexEvent } | null | undefined) {
  if (!msg || msg.type !== 'pokedex' || !msg.state) return
  state = msg.state
  // Each session is drawn as the party Pokémon working it
  for (const [sessionId, uid] of Object.entries(state.assign ?? {})) {
    const mon = state.mons?.[uid]
    if (mon) castSession(sessionId, mon.dex, mon.shiny)
  }
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
export interface Ball { id: string; ko: string; en: string; ja?: string; tier: string; weight: number }
export const BALLS: Ball[] = (BALL_DATA as { balls: Ball[] }).balls
export const BALL_BY_ID = new Map(BALLS.map(b => [b.id, b]))
const BALL_TIER_KO: Record<string, string> = (BALL_DATA as { tiers: Record<string, string> }).tiers
export const BALL_TIER_LABEL = new Proxy({} as Record<string, string>, { get: (_t, k) => ballTierName(String(k), BALL_TIER_KO[String(k)] ?? String(k)) })
export function ballName(id: string | null | undefined): string {
  return nameOf(BALL_BY_ID.get(id ?? 'poke-ball')) || nameOf({ ko: '몬스터볼', en: 'Poké Ball', ja: 'モンスターボール' })
}
/** The ball's picture (shipped with the app; Claudex's own ball when it is missing) */
export function ballUrl(id: string | null | undefined): string {
  return `/sprites/balls/${BALL_BY_ID.has(id ?? '') ? id : 'poke-ball'}.png`
}

/**
 * Levels (the same curve as server/pokedex.js): from level L to L+1 takes
 * 20 minutes of work at the start, rising to 60 near the top; up to 100.
 */
export function minutesForLevel(L: number): number {
  const x = Math.max(0, Math.min(1, (L - 1) / 98))
  return 20 + 40 * x * x
}
function levelFrom(metLevel: number, workMs: number): { level: number; into: number } {
  let level = Math.max(1, Math.min(100, metLevel))
  let left = workMs / 60000
  while (level < 100 && left >= minutesForLevel(level)) { left -= minutesForLevel(level); level++ }
  return { level, into: left }
}
export function levelOf(m: { metLevel?: number; workMs?: number } | null | undefined): number {
  if (!m) return 1
  return levelFrom(m.metLevel ?? 5, m.workMs ?? 0).level
}
/** Minutes of work left before the next level */
export function minutesToNext(m: { metLevel?: number; workMs?: number }): number | null {
  const { level, into } = levelFrom(m.metLevel ?? 5, m.workMs ?? 0)
  return level >= 100 ? null : Math.ceil(minutesForLevel(level) - into)
}
