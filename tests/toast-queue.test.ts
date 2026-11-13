import { describe, it, expect } from 'vitest'
import { admit } from '../src/toastQueue'

describe('admit: a notification arrives', () => {
  it('a lone card is shown with nothing waiting (no "+1")', () => {
    const q: string[] = []
    expect(admit(q, null, 'a')).toEqual({ shown: 'a', waiting: 0 })
    expect(q).toEqual([])
  })
  it('the same holds for every later lone card, not only the first of a run', () => {
    const q: string[] = []
    admit(q, null, 'a')
    // 'a' has left the screen: nothing shown, nothing in line
    expect(admit(q, null, 'b')).toEqual({ shown: 'b', waiting: 0 })
  })
  it('cards arriving while one is on screen wait behind it and are counted', () => {
    const q: string[] = []
    expect(admit(q, 'a', 'b')).toEqual({ shown: 'a', waiting: 1 })
    expect(admit(q, 'a', 'c')).toEqual({ shown: 'a', waiting: 2 })
    expect(q).toEqual(['b', 'c'])
  })
})
