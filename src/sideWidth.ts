/**
 * The left panel's width (window and full screen): dragged by its right edge between
 * 240 and 420px (300 and 420 on a Mac: sideMin), one remembered width for both modes, kept per PC in page storage.
 * Double-click the edge (or Home on it) for the 300px default.
 */

export const SIDE_MIN = 240
export const SIDE_MAX = 420
export const SIDE_DEFAULT = 300
export const SIDE_KEY = 'spawn-side-w'
/** The terminal keeps at least this much of the window */
export const TERM_MIN = 320

/**
 * A Mac's narrowest panel: its header starts 78px in (clear of the traffic lights) instead of 18,
 * so the logo, the connection dot, 로그인, 설정 and the fold button need these 60px more
 */
export const SIDE_MIN_MAC = 300
export const sideMin = (mac: boolean): number => (mac ? SIDE_MIN_MAC : SIDE_MIN)

/** A width the panel may take in a window this wide: min–420, leaving the terminal 320px, never under min (240; a Mac 300) */
export function clampSideWidth(px: number, windowWidth: number, min: number = SIDE_MIN): number {
  return Math.round(Math.max(min, Math.min(px, SIDE_MAX, windowWidth - TERM_MIN)))
}

/** The remembered width: a number 240–420, else the default (on a Mac the caller's clamp lifts 240–299 to 300) */
export function readSideWidth(store: Pick<Storage, 'getItem'> | null | undefined): number {
  try {
    const raw = store?.getItem(SIDE_KEY)
    if (raw == null || raw.trim() === '') return SIDE_DEFAULT
    const v = Number(raw)
    return Number.isFinite(v) && v >= SIDE_MIN && v <= SIDE_MAX ? v : SIDE_DEFAULT
  } catch {
    return SIDE_DEFAULT
  }
}

/** Remembers a width; null forgets it (back to the default) */
export function writeSideWidth(px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(SIDE_KEY)
    else localStorage.setItem(SIDE_KEY, String(Math.round(px)))
  } catch { /* no storage: the width lasts until the window closes */ }
}
