/**
 * src/storageMigration.ts: the page's claudex-… keys are copied to spawn-…
 * once, never over a value that is already there.
 */
import { describe, expect, it } from 'vitest'
import { carryOldKeys } from '../src/storageMigration'

function memoryStorage(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  }
}

describe('carryOldKeys', () => {
  it('copies claudex-… and claudex.… keys to their spawn names, keeping the old ones', () => {
    const s = memoryStorage({ 'claudex-seen-version': '1.3.35', 'claudex.boxLook': 'icon', other: 'x' })
    expect(carryOldKeys(s)).toBe(2)
    expect(s.getItem('spawn-seen-version')).toBe('1.3.35')
    expect(s.getItem('spawn.boxLook')).toBe('icon')
    expect(s.getItem('claudex-seen-version')).toBe('1.3.35')
    expect(s.getItem('spawnother')).toBeNull()
  })

  it('never overwrites a value saved under the new name, and is a no-op the second time', () => {
    const s = memoryStorage({ 'claudex-term-font': 'small', 'spawn-term-font': 'large' })
    expect(carryOldKeys(s)).toBe(0)
    expect(s.getItem('spawn-term-font')).toBe('large')
  })

  it('blocked storage is fine', () => {
    const broken = { get length(): number { throw new Error('denied') } } as unknown as Storage
    expect(carryOldKeys(broken)).toBe(0)
    expect(carryOldKeys(null)).toBe(0)
  })
})
