/**
 * One text size for the whole app: the lists, the panels and the terminal change together,
 * in four steps (작게 / 보통 / 크게 / 아주 크게). The UI reads the step as a class on <html>
 * (ts-small / ts-large / ts-xlarge; 보통 has none) that switches the type scale in
 * src/styles/tokens.css; the terminal reads its px from TERM_PX (src/termFont.ts).
 *
 * Kept per PC in page storage (spawn-text-size). The first time, the old terminal-only size
 * (spawn-term-font, 10–24px) picks the nearest step, a tie going to the larger one; nothing
 * is written until the user changes the step, and the old key is left as it is.
 * The catch toast and the status card do not follow it: they are fixed-size windows.
 */

import { useSyncExternalStore } from 'react'

export const TEXT_STEPS = ['small', 'normal', 'large', 'xlarge'] as const
export type TextStep = typeof TEXT_STEPS[number]

/** The step's name (a Korean key for t()) */
export const TEXT_STEP_LABEL: Record<TextStep, string> = { small: '작게', normal: '보통', large: '크게', xlarge: '아주 크게' }
/** The UI's name size per step (--t-name in tokens.css), as the owner reads it */
export const UI_PX: Record<TextStep, number> = { small: 11, normal: 12, large: 13, xlarge: 14 }
/** The terminal's font size per step */
export const TERM_PX: Record<TextStep, number> = { small: 12, normal: 13, large: 15, xlarge: 17 }

export const TEXT_KEY = 'spawn-text-size'
/** The terminal's own size before there was one step for everything (10–24px) */
export const OLD_TERM_KEY = 'spawn-term-font'

const isStep = (v: unknown): v is TextStep => typeof v === 'string' && (TEXT_STEPS as readonly string[]).includes(v)

/** The step whose terminal size is nearest to px; a tie goes to the larger step */
export function stepFromTermPx(px: number): TextStep {
  let best: TextStep = 'normal'
  let bestD = Infinity
  for (const s of TEXT_STEPS) {
    const d = Math.abs(TERM_PX[s] - px)
    if (d <= bestD) { best = s; bestD = d }
  }
  return best
}

/** One step bigger (1) or smaller (-1), held at both ends */
export function nextStep(step: TextStep, delta: -1 | 1): TextStep {
  const i = TEXT_STEPS.indexOf(step) + delta
  return TEXT_STEPS[Math.max(0, Math.min(TEXT_STEPS.length - 1, i))]
}

/** The step to start with: the one picked, else the old terminal size's nearest, else 보통. Never writes */
export function readInitialStep(store: Pick<Storage, 'getItem'> | null | undefined): TextStep {
  try {
    const picked = store?.getItem(TEXT_KEY)
    if (isStep(picked)) return picked
    const old = store?.getItem(OLD_TERM_KEY)
    if (old != null && old.trim() !== '') {
      const px = Number(old)
      if (Number.isFinite(px) && px >= 10 && px <= 24) return stepFromTermPx(px)
    }
  } catch { /* no storage */ }
  return 'normal'
}

// ---------------------------------------------------------------- the store

const pageStorage = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }

let step: TextStep = readInitialStep(pageStorage())
const listeners = new Set<() => void>()

/** The <html> class for the step: none for 보통 */
function applyClass(s: TextStep) {
  if (typeof document === 'undefined') return
  const cl = document.documentElement.classList
  for (const x of TEXT_STEPS) cl.toggle(`ts-${x}`, x === s && x !== 'normal')
}

function apply(next: TextStep) {
  if (next === step) return
  step = next
  applyClass(step)
  for (const l of listeners) l()
}

export function getTextStep(): TextStep { return step }

/** Picks a step: remembered, put on <html>, and every listener (each terminal) told */
export function setTextStep(next: TextStep) {
  if (!isStep(next)) return
  try { pageStorage()?.setItem(TEXT_KEY, next) } catch { /* the step lasts until the page goes */ }
  apply(next)
}

export function stepTextSize(delta: -1 | 1) { setTextStep(nextStep(step, delta)) }
export function resetTextSize() { setTextStep('normal') }

export function subscribeTextStep(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useTextStep(): TextStep {
  return useSyncExternalStore(subscribeTextStep, getTextStep, getTextStep)
}

// On load: the class at once (before the first paint), and a step picked in another window followed here
applyClass(step)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === TEXT_KEY || e.key === null) apply(readInitialStep(pageStorage()))
  })
}
