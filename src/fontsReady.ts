/**
 * The bundled terminal faces, loaded before the app's page opens a terminal.
 *
 * xterm measures its cell once, when the terminal opens, from whatever face
 * is ready then: opened before Monaspace has loaded it measures a stand-in
 * (a proportional Korean face on a PC without Monaspace installed) and the
 * text comes out spaced far apart. The faces are files of the app
 * (public/fonts/fonts.css), so the wait is a few milliseconds; a face that
 * cannot load never holds the page up for longer than `timeoutMs`.
 */

/** The terminal's own face (src/termFont.ts) and the one its Hangul falls through to */
export const TERMINAL_FACES: readonly { font: string; text?: string }[] = [
  { font: "13px 'Monaspace Neon Var'" },
  { font: "13px 'Pretendard Variable'", text: '가' },
]

export function terminalFontsReady(timeoutMs = 3000): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts?.load) return Promise.resolve()
  const loads = Promise.all(TERMINAL_FACES.map(f => fonts.load(f.font, f.text))).then(() => {}, () => {})
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    void loads.then(() => { clearTimeout(timer); resolve() })
  })
}
