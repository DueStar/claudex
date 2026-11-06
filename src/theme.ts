/**
 * theme.ts — the Pokédex data and who each session is drawn as: the party
 * Pokémon the server sent out with it (src/pokedexStore.ts casts it), a Poké
 * Ball until then. The cast is kept in localStorage so a reload does not
 * flash a ball, and shared between the app's windows through the storage event.
 */

import { useSyncExternalStore } from 'react'
import POKEDEX from './pokemon/pokedex.json'

export interface PokemonEntry {
  id: number
  slug: string
  ko: string
  en: string
  types: string[]
  evolvesFrom: number | null
  /** Height in decimetres (PokeAPI) */
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
  if (!id) return '/sprites/claudex-ball.png'
  return `/sprites/pokemon/${shiny ? 'art-shiny' : 'art'}/${id}.png`
}

// ---------------------------------------------------------------------------
// Session cast
// ---------------------------------------------------------------------------

interface Cast { dex: number; shiny: boolean }

const CAST_KEY = 'claudex-session-cast'
let cast: Record<string, Cast> = loadCast()
let version = 0
const listeners = new Set<() => void>()

function loadCast(): Record<string, Cast> {
  const out: Record<string, Cast> = {}
  try {
    const saved = JSON.parse(localStorage.getItem(CAST_KEY) ?? 'null')
    if (saved && typeof saved === 'object') {
      for (const [sessionId, c] of Object.entries(saved as Record<string, Partial<Cast>>)) {
        if (c && typeof c.dex === 'number' && BY_ID.has(c.dex)) out[sessionId] = { dex: c.dex, shiny: c.shiny === true }
      }
    }
  } catch {}
  return out
}

function changed() {
  version++
  try { localStorage.setItem(CAST_KEY, JSON.stringify(cast)) } catch {}
  listeners.forEach(l => l())
}

// Another window of the app changed the cast: pick it up
try {
  window.addEventListener('storage', (e) => {
    if (e.key !== CAST_KEY) return
    cast = loadCast()
    version++
    listeners.forEach(l => l())
  })
} catch {}

/** Re-renders when the cast changes (a session sent a new Pokémon). */
export function useTheme(): number {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    () => version,
    () => 0,
  )
}

/** Draw a session as this Pokémon. */
export function castSession(sessionId: string, dex: number, shiny = false) {
  const prev = cast[sessionId]
  if (!BY_ID.has(dex) || (prev && prev.dex === dex && prev.shiny === shiny)) return
  cast = { ...cast, [sessionId]: { dex, shiny } }
  changed()
}

/** The session's Pokémon artwork. */
export function sessionSprite(sessionId: string): string {
  const c = cast[sessionId]
  return spriteUrl(c?.dex ?? 0, c?.shiny ?? false)
}

/** The name a session goes by: its Pokémon's (✨ when shiny), or `fallback` while it is a ball. */
export function sessionName(sessionId: string, fallback: string): string {
  const c = cast[sessionId]
  const p = c && BY_ID.get(c.dex)
  if (!p) return fallback
  return c.shiny ? `✨${p.ko}` : p.ko
}
