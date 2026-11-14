/**
 * The app's keys, one map for the terminal (TerminalPanel) and the window (Widget).
 *
 * Windows: Ctrl, as it has always been — Ctrl+1–5 views, Ctrl+Alt+←/→ the previous / next
 * view, Ctrl+Tab / Ctrl+Shift+Tab sessions, Ctrl+Shift+T / W new and close (Ctrl+T and
 * Ctrl+W stay Claude Code's), Ctrl+Shift+H 업무 모드 (src/workMode.ts), Ctrl+F find,
 * Ctrl+= / - / 0 text size, Ctrl+V paste, Ctrl+C copy when text is selected (else it is ^C
 * for Claude).
 *
 * macOS: ⌘, as Mac apps do — ⌘1–5, ⌘⌥←/→, ⌘⇧[ / ⌘⇧], ⌘T / ⌘W, ⌘⇧H, ⌘F, ⌘= / - / 0, ⌘V,
 * ⌘C. (⌘⇧H is free: the menu has ⌘H hide and ⌥⌘H hide others, not ⌘⇧H.)
 * Every Ctrl key there is the session's: Ctrl+C is always the interrupt, Ctrl+V reaches
 * Claude Code (it pastes a screenshot with it).
 *
 * Letters are read from e.code, so a Korean layout (ㅅ for T) still matches.
 */

import { isMac, modKey } from './platform'

export type AppShortcut =
  | 'view1' | 'view2' | 'view3' | 'view4' | 'view5'
  | 'prevView' | 'nextView'
  | 'prevTab' | 'nextTab' | 'newTab' | 'closeTab'
  | 'workMode'
  | 'find' | 'fontUp' | 'fontDown' | 'fontReset'

type Keys = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/** The app shortcut this keydown is, or null when it is not one */
export function appShortcut(e: Keys): AppShortcut | null {
  if (!modKey(e)) return null
  // ⌃⌘ combinations are the system's (⌃⌘F full screen)
  if (isMac() && e.ctrlKey) return null
  const { altKey: alt, shiftKey: shift } = e
  // 업무 모드 on and off, by the key's place (a Korean or Japanese input on still matches).
  // Windows: Ctrl+Shift+H with no ⊞ key, exactly as 1.3.52 (src/workMode.ts had it); macOS: ⌘⇧H
  if (shift && !alt && e.code === 'KeyH' && (isMac() || !e.metaKey)) return 'workMode'
  if (alt && !shift && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return e.key === 'ArrowLeft' ? 'prevView' : 'nextView'
  if (isMac()) {
    if (shift && !alt && e.code === 'BracketLeft') return 'prevTab'
    if (shift && !alt && e.code === 'BracketRight') return 'nextTab'
    if (!shift && !alt && e.code === 'KeyT') return 'newTab'
    if (!shift && !alt && e.code === 'KeyW') return 'closeTab'
  } else {
    if (!alt && e.key === 'Tab') return shift ? 'prevTab' : 'nextTab'
    if (shift && !alt && e.code === 'KeyT') return 'newTab'
    if (shift && !alt && e.code === 'KeyW') return 'closeTab'
  }
  if (!alt && !shift && /^[1-5]$/.test(e.key)) return `view${e.key}` as AppShortcut
  if (!shift && !alt && e.code === 'KeyF') return 'find'
  if (!alt && (e.key === '=' || e.key === '+')) return 'fontUp'
  if (!alt && e.key === '-') return 'fontDown'
  if (!alt && e.key === '0') return 'fontReset'
  return null
}

/** Copy (only with a selection) or paste in the terminal, or null to leave the key alone */
export function clipboardAction(e: Keys, hasSelection: boolean): 'copy' | 'paste' | null {
  if (!modKey(e)) return null
  if (isMac()) {
    if (e.ctrlKey || e.altKey || e.shiftKey) return null
    if (e.code === 'KeyV') return 'paste'
    if (e.code === 'KeyC' && hasSelection) return 'copy'
    return null
  }
  if (!e.shiftKey && (e.key === 'v' || e.key === 'V')) return 'paste'
  if ((e.key === 'c' || e.key === 'C') && hasSelection) return 'copy'
  return null
}

/**
 * True for a key the terminal must not send to the session: on macOS every ⌘ key is the
 * app's or the menu's (⌘A stays xterm's select all, which sends nothing)
 */
export function keptFromPty(e: Keys): boolean {
  if (!isMac() || !e.metaKey) return false
  return !(e.code === 'KeyA' && !e.ctrlKey && !e.altKey && !e.shiftKey)
}

/** A trackpad pinch changes the text size at most once in this long */
export const PINCH_STEP_MS = 120

/**
 * What a wheel event over the terminal does to the text size: null when it is an ordinary
 * scroll, else the step (+1 bigger, -1 smaller, 0 none yet) and when the last pinch step was.
 * Ctrl+wheel on Windows and ⌘+wheel on macOS step on every event. A trackpad pinch on macOS
 * arrives as a stream of Ctrl+wheel events: it steps at most once per PINCH_STEP_MS.
 */
export function wheelFontStep(
  e: Pick<WheelEvent, 'deltaY' | 'ctrlKey' | 'metaKey'>, now: number, lastPinchAt: number,
): { step: -1 | 0 | 1; pinchAt: number } | null {
  if (modKey(e)) return { step: e.deltaY < 0 ? 1 : -1, pinchAt: lastPinchAt }
  if (!isMac() || !e.ctrlKey) return null
  if (e.deltaY === 0 || now - lastPinchAt < PINCH_STEP_MS) return { step: 0, pinchAt: lastPinchAt }
  return { step: e.deltaY < 0 ? 1 : -1, pinchAt: now }
}
