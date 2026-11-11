/**
 * The page's saved choices (open view, terminal font, last seen version, box
 * sort, …) were kept under claudex-… / claudex.… keys until 1.3.35, when the
 * app was called Claudex. On the first start under the new name each one is
 * copied to its spawn-… / spawn.… key, once: a key that already has a value
 * is never overwritten, and the old keys stay as they were.
 *
 * Imported first in main.tsx, so it runs before any module reads storage.
 */

export function carryOldKeys(store: Storage | undefined | null): number {
  if (!store) return 0
  let copied = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && /^claudex[-.]/.test(k)) keys.push(k)
    }
    for (const k of keys) {
      const next = `spawn${k.slice('claudex'.length)}`
      if (store.getItem(next) !== null) continue
      const v = store.getItem(k)
      if (v === null) continue
      store.setItem(next, v)
      copied++
    }
  } catch { /* storage blocked or full: the page works without it */ }
  return copied
}

if (typeof window !== 'undefined') {
  try { carryOldKeys(window.localStorage) } catch { /* blocked */ }
  try { carryOldKeys(window.sessionStorage) } catch { /* blocked */ }
}
