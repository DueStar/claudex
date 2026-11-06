/**
 * The terminals' font size, shared by every terminal view and kept per PC.
 * 소 / 중 / 대 presets, Ctrl+wheel and Ctrl+= / Ctrl+- / Ctrl+0 step it.
 */

import { useSyncExternalStore } from 'react'

export const FONT_PRESETS = [
  { label: '소', size: 13 },
  { label: '중', size: 15 },
  { label: '대', size: 17 },
] as const
const KEY = 'claudex-term-font'
const MIN = 10
const MAX = 24
const DEFAULT = 13

let size = (() => {
  try { const v = Number(localStorage.getItem(KEY)); return v >= MIN && v <= MAX ? v : DEFAULT } catch { return DEFAULT }
})()
const listeners = new Set<() => void>()

export function getTermFont(): number { return size }

export function setTermFont(next: number) {
  const v = Math.max(MIN, Math.min(MAX, Math.round(next)))
  if (v === size) return
  size = v
  try { localStorage.setItem(KEY, String(v)) } catch {}
  for (const l of listeners) l()
}

export function stepTermFont(delta: number) { setTermFont(size + delta) }
export function resetTermFont() { setTermFont(DEFAULT) }

export function subscribeTermFont(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useTermFont(): number {
  return useSyncExternalStore(subscribeTermFont, getTermFont, getTermFont)
}
