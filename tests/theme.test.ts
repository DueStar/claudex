/**
 * src/theme.ts — who each character is drawn as: a session is the party
 * Pokémon the server sent out with it (a Poké Ball until then), the boss is
 * 피카츄, and workers borrow from the trainer's own Pokémon.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeStorage {
  private map = new Map<string, string>()
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string) { this.map.set(k, String(v)) }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
}

describe('theme.ts casting', () => {
  beforeEach(() => {
    ;(globalThis as any).localStorage = new FakeStorage()
    vi.resetModules()
  })
  afterEach(() => {
    delete (globalThis as any).localStorage
  })

  it('a session is a Poké Ball until the server sends its Pokémon out, then that Pokémon', async () => {
    const t = await import('../src/theme')
    expect(t.getPokemonFor('assistant', 'main-aaa').id).toBe(0)
    expect(t.getSpritePath('main-aaa', 'assistant')).toBe('/sprites/ball.svg')
    // no Pokémon yet: the name is the session's own, never "몬스터볼"
    expect(t.themedDisplayName('assistant', 'Claude', 'main-aaa')).toBe('Claude')
    t.assignPokemonToRole('session:aaa', 7)
    expect(t.getPokemonFor('assistant', 'main-aaa').id).toBe(7)
    expect(t.getSpritePath('main-aaa', 'assistant')).toBe('/sprites/pokemon/art/7.png')
    t.assignPokemonToRole('session:aaa', 9, true)
    expect(t.getAvatarPath('assistant', 'main-aaa')).toBe('/sprites/pokemon/art-shiny/9.png')
    expect(t.themedDisplayName('assistant', 'Claude', 'main-aaa')).toBe('✨거북왕')
  })

  it('the boss is 피카츄 and keeps the configured name', async () => {
    const t = await import('../src/theme')
    expect(t.getPokemonIdForRole('boss')).toBe(25)
    expect(t.themedDisplayName('boss', 'Trainer')).toBe('Trainer')
  })

  it('workers borrow from the trainer\'s own Pokémon, and keep it across a reload', async () => {
    const t1 = await import('../src/theme')
    t1.setOwnedSpecies([10, 16, 19])
    const a = t1.getPokemonIdForRole('Explore')
    const b = t1.getPokemonIdForRole('debugger')
    expect([10, 16, 19]).toContain(a)
    expect([10, 16, 19]).toContain(b)
    expect(a).not.toBe(b)
    vi.resetModules()
    const t2 = await import('../src/theme')
    expect(t2.getPokemonIdForRole('Explore')).toBe(a)
  })

  it('draws the real height, softened, within the map', async () => {
    const t = await import('../src/theme')
    const caterpie = t.displayHeight(t.pokemonById(10))
    const onix = t.displayHeight(t.pokemonById(95))
    expect(caterpie).toBeLessThan(onix)
    expect(onix).toBeLessThanOrEqual(118)
    expect(caterpie).toBeGreaterThanOrEqual(34)
  })

  it('ignores a corrupt saved cast', async () => {
    ;(globalThis as any).localStorage.setItem('pokemon-office-cast-v2', '{"castByRole":{"boss":"pikachu","x":99999}}')
    const t = await import('../src/theme')
    expect(t.getPokemonIdForRole('boss')).toBe(25)
  })
})
