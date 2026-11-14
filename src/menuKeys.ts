/**
 * menuKeys.ts — the arrow keys in a small menu (the text-size menu, TextSizeControl): which item
 * the focus moves to. Unit-tested in plain Node.
 */

/**
 * The item to focus after `key` in a menu of `n` items whose focused item is `at` (−1: none):
 * ↓ / ↑ step and wrap around, Home / End go to the first / last. null: not a key the menu moves on.
 */
export function menuKeyIndex(key: string, at: number, n: number): number | null {
  if (n <= 0) return null
  if (key === 'ArrowDown') return at < 0 ? 0 : (at + 1) % n
  if (key === 'ArrowUp') return at < 0 ? n - 1 : (at - 1 + n) % n
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  return null
}
