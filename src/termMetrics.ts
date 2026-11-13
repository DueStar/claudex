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
  /** each face of the stack: document.fonts.check (true for any face nothing has to load) and whether it draws differently from the generic fallbacks (installed) */
  faces: { face: string; check: boolean; present: boolean }[]
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

if (typeof window !== 'undefined') (window as unknown as { spawnTermMetrics?: () => TermMetrics[] }).spawnTermMetrics = termMetrics
