/**
 * src/theme.ts — who each session is drawn as: the party Pokémon the server
 * sent out with it, a Poké Ball until then; kept across a reload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeStorage {
  private map = new Map<string, string>()
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string) { this.map.set(k, String(v)) }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
}

describe('theme.ts session cast', () => {
  beforeEach(() => {
    ;(globalThis as any).localStorage = new FakeStorage()
    vi.resetModules()
  })
  afterEach(() => {
    delete (globalThis as any).localStorage
  })

  it('a session is a Poké Ball until the server sends its Pokémon out, then that Pokémon', async () => {
    const t = await import('../src/theme')
    expect(t.sessionSprite('aaa')).toBe('/sprites/claudex-ball.png')
    // no Pokémon yet: the name is the session's own, never "몬스터볼"
    expect(t.sessionName('aaa', 'Claude')).toBe('Claude')
    t.castSession('aaa', 7)
    expect(t.sessionSprite('aaa')).toBe('/sprites/pokemon/art/7.png')
    expect(t.sessionName('aaa', 'Claude')).toBe('꼬부기')
    t.castSession('aaa', 9, true)
    expect(t.sessionSprite('aaa')).toBe('/sprites/pokemon/art-shiny/9.png')
    expect(t.sessionName('aaa', 'Claude')).toBe('✨거북왕')
  })

  it('keeps the cast across a reload', async () => {
    const t1 = await import('../src/theme')
    t1.castSession('bbb', 25)
    vi.resetModules()
    const t2 = await import('../src/theme')
    expect(t2.sessionSprite('bbb')).toBe('/sprites/pokemon/art/25.png')
  })

  it('ignores an unknown species and a corrupt saved cast', async () => {
    ;(globalThis as any).localStorage.setItem('claudex-session-cast', '{"x":{"dex":99999},"y":"pikachu","z":{"dex":4}}')
    const t = await import('../src/theme')
    expect(t.sessionSprite('x')).toBe('/sprites/claudex-ball.png')
    expect(t.sessionSprite('y')).toBe('/sprites/claudex-ball.png')
    expect(t.sessionSprite('z')).toBe('/sprites/pokemon/art/4.png')
    t.castSession('w', 99999)
    expect(t.sessionSprite('w')).toBe('/sprites/claudex-ball.png')
  })

  it('looks up species, with 0 as the ball', async () => {
    const t = await import('../src/theme')
    expect(t.pokemonById(0)?.ko).toBe('몬스터볼')
    expect(t.pokemonById(1)?.ko).toBe('이상해씨')
    expect(t.POKEMON.length).toBe(1025)
  })
})
