/**
 * The terminals' fonts (the stacks for each 설정 choice) and their size, which is the app's
 * one text step (src/textSize.ts).
 */

import { useSyncExternalStore } from 'react'
import type { TerminalFont } from './desktop'
import { isMac } from './platform'
import { getTextStep, resetTextSize, stepTextSize, subscribeTextStep, TERM_PX } from './textSize'

/**
 * The terminal font choices (설정 › 앱 › 터미널 글꼴), each a CSS font stack.
 * Only D2Coding has Hangul of its own: every stack ends in Pretendard and
 * Malgun Gothic so Korean always has a font. A font that is not installed is
 * skipped: a missing Cascadia or D2Coding falls back to Consolas (still
 * monospace), and Hangul to Pretendard.
 *
 * Monaspace Neon and Pretendard ship with the app (public/fonts/fonts.css);
 * Cascadia and D2Coding are used when installed. xterm measures its cell from
 * the first face that has the letter: Consolas (on every Windows PC) comes
 * before any proportional or CJK face, so should the bundled Monaspace ever
 * fail to load the cell is still a monospace one (Korean still falls through
 * to Pretendard glyph by glyph).
 */
export const TERM_FONT_STACKS: Record<TerminalFont, string> = {
  default: "'Monaspace Neon Var', 'Monaspace Neon', Consolas, 'Pretendard Variable', 'Malgun Gothic', monospace",
  consolas: "Consolas, 'Pretendard Variable', 'Malgun Gothic', monospace",
  cascadia: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Pretendard Variable', 'Malgun Gothic', monospace",
  d2coding: "D2Coding, 'D2Coding ligature', Consolas, 'Pretendard Variable', 'Malgun Gothic', monospace",
}
/**
 * The same choices on a Mac, on the same principle: the chosen face (Monaspace ships
 * with the app; Cascadia and D2Coding when installed), then Menlo and Monaco, which
 * every Mac has, before any proportional or CJK face. Should a face not be there, the
 * cell is still a monospace one: with Pretendard or Apple SD Gothic Neo first it was as
 * wide as their W and the text stood spaced out (CI run 2). Korean and Japanese still
 * fall through to Pretendard / Apple SD Gothic Neo, glyph by glyph. The stored value
 * 'consolas' is Menlo here (Consolas is not on macOS); SF Mono is not a system font
 * (it lives inside Terminal.app).
 */
export const MAC_TERM_FONT_STACKS: Record<TerminalFont, string> = {
  default: "'Monaspace Neon Var', 'Monaspace Neon', Menlo, Monaco, 'SF Mono', 'Pretendard Variable', 'Apple SD Gothic Neo', monospace",
  consolas: "Menlo, Monaco, 'SF Mono', 'Pretendard Variable', 'Apple SD Gothic Neo', monospace",
  cascadia: "'Cascadia Mono', 'Cascadia Code', Menlo, Monaco, 'SF Mono', 'Pretendard Variable', 'Apple SD Gothic Neo', monospace",
  d2coding: "D2Coding, 'D2Coding ligature', Menlo, Monaco, 'SF Mono', 'Pretendard Variable', 'Apple SD Gothic Neo', monospace",
}

/** The stack to render: Windows' (TERM_FONT_STACKS) or the Mac's (MAC_TERM_FONT_STACKS). */
export const termFontStack = (font: TerminalFont | undefined, mac: boolean = isMac()): string => {
  const stacks = mac ? MAC_TERM_FONT_STACKS : TERM_FONT_STACKS
  return stacks[font ?? 'default'] ?? stacks.default
}

/** The settings label of a font choice: the stored value consolas reads Menlo on a Mac. */
export const termFontLabel = (font: TerminalFont, mac: boolean = isMac()): string =>
  font === 'consolas' && mac ? 'Menlo' : { default: 'Monaspace', consolas: 'Consolas', cascadia: 'Cascadia', d2coding: 'D2Coding' }[font]

/**
 * The terminals' font size is the app's one text step (src/textSize.ts): these are its view
 * for TerminalPanel.tsx, under the names it has always used. Ctrl+wheel and Ctrl+= / Ctrl+- /
 * Ctrl+0 in a terminal step it like anywhere else in the window.
 */
export const getTermFont = (): number => TERM_PX[getTextStep()]
export const subscribeTermFont = subscribeTextStep
export function stepTermFont(delta: number) { if (delta) stepTextSize(delta > 0 ? 1 : -1) }
export const resetTermFont = resetTextSize

export function useTermFont(): number {
  return useSyncExternalStore(subscribeTermFont, getTermFont, getTermFont)
}
