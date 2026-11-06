/** theme.ts — Pokémon theme: who is cast as which Pokémon, the map art, and the chatter */

import { useSyncExternalStore } from 'react'
import { getVariant, pickIncidentLine, type IncidentLineKind } from './incident'
import POKEDEX from './pokemon/pokedex.json'

export type ThemeName = 'pokemon'

export interface PokemonEntry {
  id: number
  slug: string
  ko: string
  en: string
  types: string[]
  evolvesFrom: number | null
  /** Height in decimetres (PokeAPI) — what the on-screen size follows */
  heightDm?: number
  w: number
  h: number
  bbox: number[]
}

/** Stand-in while a session waits for the server to send its Pokémon out */
const BALL: PokemonEntry = { id: 0, slug: 'poke-ball', ko: '몬스터볼', en: 'Poké Ball', types: [], evolvesFrom: null, heightDm: 2, w: 0, h: 0, bbox: [] }

export const POKEMON: readonly PokemonEntry[] = POKEDEX as PokemonEntry[]
const BY_ID = new Map(POKEMON.map(p => [p.id, p]))
export function pokemonById(id: number): PokemonEntry | undefined { return id === 0 ? BALL : BY_ID.get(id) }

/** The Pokémon HOME artwork of a species (trimmed, fits 128 px); 0 is the Poké Ball */
export function spriteUrl(id: number, shiny = false): string {
  if (!id) return '/sprites/pokemon/ball.png'
  return `/sprites/pokemon/${shiny ? 'art-shiny' : 'art'}/${id}.png`
}

/**
 * How tall a Pokémon is drawn, in map pixels (the map is 640 px wide): it
 * follows the real height, softened (square root) so 캐터피 and 롱스톤 both fit.
 */
export function displayHeight(p: PokemonEntry | undefined): number {
  if (!p || !p.id) return 26
  const m = (p.heightDm ?? 10) / 10
  return Math.round(Math.max(34, Math.min(118, 26 + 30 * Math.sqrt(m))))
}

// The boss (you) is 피카츄; a Claude with no session (sim mode) is 뮤
const FIXED_ROLE_CASTING: Record<string, number> = {
  boss: 25,
  assistant: 151,
}

interface ThemeState {
  castByRole: Record<string, number>
  shinyRoles: Record<string, boolean>
}

// v2: casting comes from the trainer's own Pokémon now; older random casts are dropped
const CAST_KEY = 'pokemon-office-cast-v2'
let state: ThemeState = loadInitial()
const listeners = new Set<() => void>()

function loadInitial(): ThemeState {
  const base: ThemeState = { castByRole: {}, shinyRoles: {} }
  try {
    const saved = JSON.parse(localStorage.getItem(CAST_KEY) ?? 'null')
    if (saved && typeof saved === 'object') {
      for (const [role, id] of Object.entries(saved.castByRole ?? {})) {
        if (typeof id === 'number' && BY_ID.has(id)) base.castByRole[role] = id
      }
      for (const [role, s] of Object.entries(saved.shinyRoles ?? {})) {
        if (s === true && base.castByRole[role]) base.shinyRoles[role] = true
      }
    }
  } catch {}
  return base
}

function persist() {
  try { localStorage.setItem(CAST_KEY, JSON.stringify(state)) } catch {}
}

function emit() { listeners.forEach(l => l()) }

// Another window (the widget or the office) changed the cast: pick it up
try {
  window.addEventListener('storage', (e) => {
    if (e.key !== CAST_KEY) return
    state = loadInitial()
    version++
    emit()
  })
} catch {}

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

export function getTheme(): ThemeName { return 'pokemon' }

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let version = 0
/** Re-renders when the cast changes (a role dealt a new Pokémon). */
export function useTheme(): number {
  return useSyncExternalStore(subscribeTheme, () => version, () => 0)
}

function changed() { version++; persist(); emit() }

/** Species the trainer owns (src/pokedexStore.ts keeps it current): what workers are drawn from */
let owned: number[] = []
export function setOwnedSpecies(ids: number[]) { owned = ids }

/**
 * The Pokémon dex id for a role. A session's is whichever party Pokémon the
 * server sent out with it (0 = the Poké Ball until then); the boss and a
 * sessionless Claude are fixed; a worker borrows one of the trainer's own.
 */
export function getPokemonIdForRole(role: string): number {
  const have = state.castByRole[role]
  if (have) return have
  if (role.startsWith('session:')) return 0
  const fixed = FIXED_ROLE_CASTING[role]
  if (!fixed && owned.length === 0) return 0
  const used = new Set(Object.values(state.castByRole))
  const free = owned.filter(id => !used.has(id))
  const id = fixed ?? pick(free.length ? free : owned)
  state.castByRole[role] = id
  // Why: dealt during render — persist, but don't notify subscribers mid-render
  persist()
  return id
}

export function getPokemonForRole(role: string): PokemonEntry {
  return pokemonById(getPokemonIdForRole(role)) ?? BALL
}

export function isShinyRole(role: string): boolean { return !!state.shinyRoles[role] }

/**
 * Who a character is cast by. Each Claude Code session's own Claude (agent id
 * `main-<sessionId>`) is the party Pokémon working that session; everyone
 * else (the boss, subagents) is cast by role.
 */
export function castKey(role: string, agentId?: string): string {
  return agentId && agentId.startsWith('main-') ? `session:${agentId.slice(5)}` : role
}

export function getPokemonFor(role: string, agentId?: string): PokemonEntry {
  return getPokemonForRole(castKey(role, agentId))
}

export function getSpritePath(agentId: string | undefined, role: string, _defaultBase?: string, _direction?: string): string {
  const key = castKey(role, agentId)
  return spriteUrl(getPokemonIdForRole(key), isShinyRole(key))
}

/** The same artwork, for chat avatars */
export function getAvatarPath(role: string, agentId?: string): string {
  const key = castKey(role, agentId)
  return spriteUrl(getPokemonIdForRole(key), isShinyRole(key))
}

export function getRoomImage(phase: 'day' | 'night'): string {
  return phase === 'night' ? '/rooms/pokemon-night.png' : '/rooms/pokemon-day.png'
}

/** Name shown for a role: the boss keeps the configured name, everyone else is their Pokémon. */
export function themedDisplayName(role: string, fallback: string, agentId?: string): string {
  if (role === 'boss') return fallback
  const key = castKey(role, agentId)
  const p = getPokemonForRole(key)
  // Nobody cast yet (the ball is only a picture): the name stays the session's own
  if (p.id === 0) return fallback
  return isShinyRole(key) ? `✨${p.ko}` : p.ko
}

/** Assign a specific Pokémon to a role (sim mode). */
export function assignPokemonToRole(role: string, id: number, shiny = false) {
  if (!BY_ID.has(id) || (state.castByRole[role] === id && !!state.shinyRoles[role] === shiny)) return
  state.castByRole[role] = id
  if (shiny) state.shinyRoles[role] = true
  else delete state.shinyRoles[role]
  changed()
}

/** Free a role's Pokémon so a later agent can be dealt it. */
export function releaseRole(role: string) {
  if (!(role in state.castByRole) || FIXED_ROLE_CASTING[role]) return
  delete state.castByRole[role]
  delete state.shinyRoles[role]
  changed()
}

/** The next form, if this Pokémon evolves within Gen 1 (one is picked at random for branches). */
export function nextEvolution(id: number): number | null {
  const next = POKEMON.filter(p => p.evolvesFrom === id)
  return next.length ? pick(next).id : null
}

/** Evolve a role's Pokémon in place. Returns the new entry, or null if it cannot evolve. */
export function evolveRole(role: string): PokemonEntry | null {
  const cur = state.castByRole[role]
  if (!cur) return null
  const next = nextEvolution(cur)
  if (!next) return null
  state.castByRole[role] = next
  changed()
  return BY_ID.get(next) ?? null
}

// ===== CHATTER POOLS =====

const SPAWN = [
  '몬스터볼에서 나왔다!', '야생의 개발자가 나타났다!', '가랏! 출근 완료!',
  '오늘도 힘내자!', '레포를 클론했다!', '체육관 관장 대신 버그에 도전!',
]
const WORK = [
  '열심히 코드를 짜고 있다', '몸통박치기로 버그 처리 중', '기술머신으로 학습 중',
  '도감을 뒤져보는 중', '집중하고 있다…!', '테스트를 돌리는 중', '스택 트레이스 추적 중',
]
const DONE = [
  '효과는 굉장했다!', '경험치를 얻었다!', '레벨이 올랐다!', '작업 완료!',
  'PR을 열었다!', '배틀에서 이겼다!', '급소에 맞았다! (버그에)',
]
const COFFEE = ['나무열매 먹으러 간다', '오랭열매 냠냠', '잠깐 휴식!', '열매 따는 중']
const WATER = ['연못에서 물 한 모금', '물 마시는 중', '연못가에서 쉬는 중', '수분 보충!']

function variantLine(kind: IncidentLineKind): string | null {
  if (getVariant() !== 'incident') return null
  return pickIncidentLine(kind)
}

export function themedSpawn(): string  { return variantLine('spawn')  ?? pick(SPAWN) }
export function themedWork(): string   { return variantLine('work')   ?? pick(WORK) }
export function themedDone(): string   { return variantLine('done')   ?? pick(DONE) }
export function themedCoffee(): string { return variantLine('coffee') ?? pick(COFFEE) }
export function themedWater(): string  { return variantLine('water')  ?? pick(WATER) }
