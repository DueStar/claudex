/**
 * carry — what the page should still show when the app swaps its window
 * (widget <-> window builds a new one) or starts again: the open tab, the
 * chosen session, an unsent instruction and where the Pokédex was scrolled.
 * Per PC, in localStorage.
 */

export interface Carried { view?: 'terminal' | 'dex' | 'box' | 'today'; target?: string | null; text?: string; dexScroll?: number }

const KEY = 'claudex-carry'

export function readCarry(): Carried {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

export function writeCarry(patch: Carried) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readCarry(), ...patch })) } catch { /* not kept */ }
}

/** The mode the window was built for (?mode=), so the first paint is already right. */
export function modeFromUrl(): 'widget' | 'window' | 'fullscreen' {
  const m = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mode') : null
  return m === 'window' || m === 'fullscreen' ? m : 'widget'
}
