/**
 * Each open terminal's font and cell size, for the Mac CI's smoke launch
 * (electron/smoke.cjs reads window.spawnTermMetrics() from the page). xterm
 * measures one cell for every character from the first face of its stack that
 * is there; a proportional face first gives cells far too wide (spaced-out
 * text, CI run 2), which a cell width to font size ratio shows: a monospace
 * Latin cell is about 0.6 em.
 *
 * Read only, nothing here changes a terminal.
 */

export type TermMetrics = {
  id: string
  fontFamily: string
  fontSize: number
  cellWidth: number | null
  cellHeight: number | null
  cols: number
  rows: number
  /**
   * each face of the stack: document.fonts.check (true for any face nothing has to load),
   * whether it draws differently from the generic fallbacks (installed or loaded), and the
   * status of its @font-face (public/fonts/fonts.css) when it has one: 'loaded' is the bundled file in use
   */
  faces: { face: string; check: boolean; present: boolean; status: string | null }[]
  /** the last lines of the terminal's buffer, as text */
  text: string
}

const readers = new Map<string, () => TermMetrics>()

/** A terminal on screen registers how to read it; the returned function takes it off */
export function trackTermMetrics(id: string, read: () => TermMetrics): () => void {
  readers.set(id, read)
  return () => { if (readers.get(id) === read) readers.delete(id) }
}

export function termMetrics(): TermMetrics[] {
  const out: TermMetrics[] = []
  for (const read of readers.values()) { try { out.push(read()) } catch { /* a terminal going away */ } }
  return out
}

/** The faces of a CSS font stack, quotes off */
export function stackFaces(stack: string): string[] {
  return String(stack ?? '').split(',').map(f => f.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean)
}

/** The status of the page's @font-face for `family` ('loaded', 'loading', 'unloaded', 'error'), or null when it has none */
export function faceStatus(family: string): string | null {
  try {
    for (const f of document.fonts as unknown as Iterable<FontFace>) {
      if (f.family.replace(/^(['"])(.*)\1$/, '$2') === family) return f.status
    }
  } catch { /* no page */ }
  return null
}

/** The faces the app ships (public/fonts/fonts.css) and a text each must draw itself */
export const BUNDLED_CHECKS: readonly { face: string; text: string }[] = [
  { face: 'Monaspace Neon Var', text: 'W0' },
  { face: 'W Uncut', text: 'Pokédex' },
  { face: 'W Pretendard', text: '가' },
]

/**
 * Whether `face` draws `text` itself: measured with two different fallbacks behind it,
 * the width is the same only when no character fell through to them
 */
export function faceSupplies(face: string, text: string): boolean {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return false
    const widths = ['monospace', 'serif'].map((base) => { ctx.font = `48px "${face}", ${base}`; return ctx.measureText(text).width })
    return widths[0] === widths[1]
  } catch { return false }
}

export type FontStatus = { face: string; status: string | null; text: string; supplied: boolean }[]

/** The bundled faces in this page: loaded or not, and whether each draws its sample itself */
export function fontStatus(): FontStatus {
  return BUNDLED_CHECKS.map(({ face, text }) => ({ face, status: faceStatus(face), text, supplied: faceSupplies(face, text) }))
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', '-apple-system', 'ui-monospace', 'ui-sans-serif', 'ui-serif'])

/** Whether `face` is installed: text in it measures differently from the generic fallbacks */
export function facePresent(face: string): boolean {
  if (GENERIC.has(face)) return true
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return false
    const sample = 'mmmmmmmmmmlli10WQ@#'
    return ['monospace', 'serif', 'sans-serif'].some((base) => {
      ctx.font = `72px ${base}`
      const plain = ctx.measureText(sample).width
      ctx.font = `72px "${face}", ${base}`
      return ctx.measureText(sample).width !== plain
    })
  } catch { return false }
}

if (typeof window !== 'undefined') {
  const w = window as unknown as { spawnTermMetrics?: () => TermMetrics[]; spawnFontStatus?: () => FontStatus }
  w.spawnTermMetrics = termMetrics
  w.spawnFontStatus = fontStatus
}
