/**
 * TerminalPanel — a Claude Code session's terminal (TerminalView) and the
 * 이어하기 picker (ResumePicker). The widget lays them out.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { getTermFont, resetTermFont, stepTermFont, subscribeTermFont, termFontStack } from '../termFont'
import { getSettings, useSettings } from '../settingsStore'
import '@xterm/xterm/css/xterm.css'
import { bridge, onTerminalData, type PastSession, type TerminalInfo } from '../desktop'
import { createReplayGate } from '../terminalReplay'
import { t } from '../i18n'

const THEME = {
  background: '#101218',
  foreground: '#e6e6e6',
  cursor: '#ffd84a',
  selectionBackground: '#3a4a6a',
  black: '#1a1c22', red: '#ff6b6b', green: '#7bd88f', yellow: '#ffd84a',
  blue: '#6cb6ff', magenta: '#d78bff', cyan: '#5fd7d7', white: '#e6e6e6',
  brightBlack: '#5c6370', brightRed: '#ff8787', brightGreen: '#9ff0a8', brightYellow: '#ffe57a',
  brightBlue: '#8cc8ff', brightMagenta: '#e3a8ff', brightCyan: '#87ffff', brightWhite: '#ffffff',
}

/** `focus`: take the keyboard when shown (not for a question opened beside the terminal in use) */
/** How long a terminal put away keeps its WebGL renderer */
const WEBGL_IDLE_MS = 30_000

export const TerminalView: React.FC<{ term: TerminalInfo; active: boolean; focus?: boolean }> = ({ term, active, focus = true }) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  // Ctrl+F: find in this terminal's output (scrollback included)
  const searchRef = useRef<SearchAddon | null>(null)
  const openSearchRef = useRef<() => void>(() => {})
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ index: number; count: number } | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  openSearchRef.current = () => { setSearching(true); setTimeout(() => searchInput.current?.select(), 0) }
  // 설정 › 앱: scrollback and font, applied to this terminal as soon as they change
  const { scrollback, font } = useSettings().terminal
  const fitNowRef = useRef<() => void>(() => {})
  const webglRef = useRef<WebglAddon | null>(null)

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    const xterm = new Terminal({
      // Monaspace Neon for code by default (설정 can pick another). It has no Hangul, so
      // Korean falls through to Pretendard; the WebGL renderer keeps every glyph on the cell grid
      fontFamily: termFontStack(getSettings().terminal.font),
      fontSize: getTermFont(),
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: getSettings().terminal.scrollback,
      allowProposedApi: true,
      theme: THEME,
      // Claude Code's logo is block/quadrant characters (▐▛███▜▌): drawn by xterm itself, not taken from a font
      customGlyphs: true,
      rescaleOverlappingGlyphs: true,
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.open(hostRef.current)
    xtermRef.current = xterm
    fitRef.current = fit
    // Links open with Ctrl+click, as in Windows Terminal (a plain click selects text)
    xterm.loadAddon(new WebLinksAddon((event, uri) => {
      if (event.ctrlKey || event.metaKey) bridge!.terminals.openUrl(uri)
    }))
    // Find (Ctrl+F): matches marked in the app's yellow, the current one solid
    const search = new SearchAddon()
    xterm.loadAddon(search)
    searchRef.current = search
    const offResults = search.onDidChangeResults(({ resultIndex, resultCount }) => setFound({ index: resultIndex, count: resultCount }))
    // A file path in the output (src/app.ts:42:7, C:\x\y.py:3) opens in the code editor at that
    // line with Ctrl+click, as a link does
    const offPaths = xterm.registerLinkProvider({
      provideLinks(y, callback) {
        const line = xterm.buffer.active.getLine(y - 1)
        if (!line) return callback(undefined)
        // The text with each character's cell (a wide character such as Hangul takes two cells)
        let text = ''
        const cellOf: number[] = []
        for (let x = 0; x < line.length; x++) {
          const ch = line.getCell(x)?.getChars() ?? ''
          if (!ch) { if (line.getCell(x)?.getWidth() === 0) continue; text += ' '; cellOf.push(x); continue }
          for (const c of ch) { text += c; cellOf.push(x) }
        }
        const links: { range: { start: { x: number; y: number }; end: { x: number; y: number } }; text: string; activate: (e: MouseEvent) => void; decorations: { underline: boolean; pointerCursor: boolean } }[] = []
        for (const m of text.matchAll(FILE_REF)) {
          const at = m.index ?? 0
          const ref = m[0]
          const start = cellOf[at], end = cellOf[at + ref.length - 1]
          if (start === undefined || end === undefined) continue
          links.push({
            range: { start: { x: start + 1, y }, end: { x: end + 1, y } },
            text: ref,
            decorations: { underline: true, pointerCursor: true },
            activate: (e) => { if (e.ctrlKey || e.metaKey) void bridge!.terminals.openPath(term.id, m[1], Number(m[2] || 0), Number(m[3] || 0)) },
          })
        }
        callback(links.length ? links : undefined)
      },
    })
    // Files dropped on the terminal arrive as their paths, quoted when they have spaces
    // (Claude Code attaches a dropped image by its path)
    const host = hostRef.current
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      const paths = files.map(f => bridge!.terminals.pathForFile(f)).filter(Boolean).map(p => (/\s/.test(p) ? `"${p}"` : p))
      if (paths.length) { xterm.paste(paths.join(' ') + ' '); xterm.focus() }
    }
    host.addEventListener('dragover', onDragOver)
    host.addEventListener('drop', onDrop)
    // Ctrl+wheel: bigger or smaller text, in every terminal at once
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      stepTermFont(e.deltaY < 0 ? 1 : -1)
    }
    host.addEventListener('wheel', onWheel, { passive: false })

    let disposed = false
    // The output so far, then live, each piece once (src/terminalReplay.ts)
    const gate = createReplayGate((data) => xterm.write(data))
    bridge.terminals.buffer(term.id).then(({ data, seq }) => { if (!disposed) gate.replay(data, seq) }, () => { if (!disposed) gate.fail() })
    const offData = onTerminalData(term.id, (data, seq) => gate.live(data, seq))
    const input = xterm.onData((data) => bridge!.terminals.write(term.id, data))
    // When a Shift/Ctrl+Enter that ended an IME composition queued its newline
    let imeEnterAt = 0
    // Ctrl+V pastes, Ctrl+C copies when there is a selection (else it is ^C for Claude)
    xterm.attachCustomKeyEventHandler((e) => {
      // Shift+Enter / Ctrl+Enter: a new line in the prompt instead of sending it (Claude Code
      // reads ESC+CR as a newline). Blocked on every event type: stopping keydown alone left
      // the keypress, which xterm turned into a plain Enter, and the prompt was sent.
      // While Korean (or any IME) text is being composed, the last syllable is only committed
      // after this key: send the newline once xterm has sent that syllable, or it lands on the
      // new line
      // (mid-composition the browser may report the key as 'Process' (229): its code still says Enter)
      const isEnter = e.key === 'Enter' || (e.keyCode === 229 && (e.code === 'Enter' || e.code === 'NumpadEnter'))
      if (isEnter && (e.shiftKey || e.ctrlKey) && !e.altKey && !e.metaKey) {
        if (e.type === 'keydown') {
          const newline = () => bridge!.terminals.write(term.id, '\x1b\r')
          const ta = xterm.textarea
          if ((e.isComposing || e.keyCode === 229) && ta) {
            imeEnterAt = Date.now()
            let sent = false
            const once = () => { if (!sent) { sent = true; newline() } }
            // xterm reads the committed text in a setTimeout(0) after compositionend: queue behind it
            ta.addEventListener('compositionend', () => setTimeout(once, 10), { once: true })
            setTimeout(once, 300) // no compositionend after all
          } else if (Date.now() - imeEnterAt < 150) {
            // The Korean IME passes the Enter on after committing the syllable: a second keydown
            // for the same press, no longer composing. Its newline is already queued above
            imeEnterAt = 0
          } else {
            // A syllable whose composition just ended is sent by xterm on a zero timeout:
            // a beat later, so the newline comes after it
            setTimeout(newline, 15)
          }
        }
        return false
      }
      if (e.type !== 'keydown') return true
      // Ctrl+1–5 switch the app's views (터미널/도감/박스/기록/랭킹): not for the terminal
      if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-5]$/.test(e.key)) return false
      // The app's session keys, as in a terminal app: Ctrl+Tab / Ctrl+Shift+Tab next and previous
      // session, Ctrl+Shift+T a new one, Ctrl+Shift+W close (Ctrl+T and Ctrl+W stay Claude Code's)
      if (e.ctrlKey && !e.altKey && e.key === 'Tab') return false
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.code === 'KeyT' || e.code === 'KeyW')) return false
      // Ctrl+F: find in the output
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyF') { openSearchRef.current(); return false }
      // Ctrl+= / Ctrl+- / Ctrl+0: text size
      if (e.ctrlKey && !e.altKey && (e.key === '=' || e.key === '+')) { stepTermFont(1); return false }
      if (e.ctrlKey && !e.altKey && e.key === '-') { stepTermFont(-1); return false }
      if (e.ctrlKey && !e.altKey && e.key === '0') { resetTermFont(); return false }
      // Ctrl+V: text is pasted here; anything else (a screenshot) goes to Claude Code as the key
      // itself, and Claude Code reads the image from the clipboard
      if (e.ctrlKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        navigator.clipboard.readText()
          .then((t) => { if (t) xterm.paste(t); else bridge!.terminals.write(term.id, '\x16') })
          .catch(() => bridge!.terminals.write(term.id, '\x16'))
        return false
      }
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && xterm.hasSelection()) {
        navigator.clipboard.writeText(xterm.getSelection()).catch(() => {})
        xterm.clearSelection()
        return false
      }
      return true
    })

    // Only a terminal the user can see sets the session's size (the widget's question
    // card and the window's terminal card take turns), or Claude Code draws for the
    // wrong width
    const doFit = () => {
      if (!hostRef.current || hostRef.current.offsetWidth === 0 || document.visibilityState !== 'visible') return
      try {
        fit.fit()
        bridge!.terminals.resize(term.id, xterm.cols, xterm.rows)
      } catch {}
    }
    fitNowRef.current = doFit
    const ro = new ResizeObserver(doFit)
    ro.observe(hostRef.current)
    doFit()
    // The cell size is measured with whatever font is ready: once Monaspace has
    // loaded, measure again, or the last rows (Claude Code's status line) fall
    // below the bottom edge
    const refont = () => { if (disposed) return; xterm.options.fontFamily = xterm.options.fontFamily; doFit() }
    document.fonts.load("13px 'Monaspace Neon Var'").then(refont, () => {})
    // The shared text size changed: apply it and fit again
    const offFont = subscribeTermFont(() => { xterm.options.fontSize = getTermFont(); doFit() })
    document.fonts.addEventListener('loadingdone', refont)
    document.addEventListener('visibilitychange', doFit)
    window.addEventListener('focus', doFit)

    return () => {
      disposed = true
      fitNowRef.current = () => {}
      host.removeEventListener('dragover', onDragOver)
      host.removeEventListener('drop', onDrop)
      host.removeEventListener('wheel', onWheel)
      offResults.dispose()
      offPaths.dispose()
      offFont()
      document.fonts.removeEventListener('loadingdone', refont)
      document.removeEventListener('visibilitychange', doFit)
      window.removeEventListener('focus', doFit)
      ro.disconnect()
      offData()
      input.dispose()
      webglRef.current = null // disposed with xterm
      xterm.dispose()
    }
  }, [term.id])

  // The WebGL renderer only for the terminal on screen: every open terminal holding a GL
  // context (and its own glyph atlas) for hours came close to Chromium's ~16-context cap. A
  // terminal put away keeps it WEBGL_IDLE_MS (switching back is instant), then draws with the
  // DOM renderer until it is shown again.
  useEffect(() => {
    const x = xtermRef.current
    if (!x) return
    if (active) {
      if (!webglRef.current) {
        try {
          const webgl = new WebglAddon()
          webgl.onContextLoss(() => { webgl.dispose(); if (webglRef.current === webgl) webglRef.current = null })
          x.loadAddon(webgl)
          webglRef.current = webgl
        } catch { /* no WebGL: the DOM renderer still works */ }
      }
      return
    }
    if (!webglRef.current) return
    const timer = setTimeout(() => { webglRef.current?.dispose(); webglRef.current = null }, WEBGL_IDLE_MS)
    return () => clearTimeout(timer)
  }, [active, term.id])

  // A new scrollback or font from 설정: xterm takes both live. A new font changes the cell
  // size, so fit again, and once more when the font has loaded (a font in use for the first time)
  useEffect(() => {
    const x = xtermRef.current
    if (!x) return
    if (x.options.scrollback !== scrollback) x.options.scrollback = scrollback
    const stack = termFontStack(font)
    if (x.options.fontFamily === stack) return
    x.options.fontFamily = stack
    fitNowRef.current()
    let gone = false
    document.fonts.load(`13px ${stack.split(',')[0]}`).then(() => { if (!gone) fitNowRef.current() }, () => {})
    return () => { gone = true }
  }, [scrollback, font])

  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        const x = xtermRef.current
        if (x && document.visibilityState === 'visible') { bridge?.terminals.resize(term.id, x.cols, x.rows); if (focus) x.focus() }
      } catch {}
    })
    return () => cancelAnimationFrame(id)
  }, [active, term.id])

  const find = (back = false) => {
    const s = searchRef.current
    if (!s || !query) return
    const opts = { decorations: SEARCH_MARKS, incremental: false }
    if (back) s.findPrevious(query, opts); else s.findNext(query, opts)
  }
  const closeSearch = () => {
    setSearching(false)
    setFound(null)
    searchRef.current?.clearDecorations()
    xtermRef.current?.clearSelection()
    xtermRef.current?.focus()
  }

  return (
    <div className="term-wrap" style={{ display: active ? 'contents' : 'none' }}>
      <div className="term-view" ref={hostRef} />
      {searching && (
        <div className="term-search" role="search">
          <input
            ref={searchInput}
            value={query}
            placeholder={t('터미널에서 찾기')}
            aria-label={t('터미널에서 찾기')}
            onChange={e => {
              const q = e.target.value
              setQuery(q)
              if (!q) { searchRef.current?.clearDecorations(); setFound(null); return }
              searchRef.current?.findNext(q, { decorations: SEARCH_MARKS, incremental: true })
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); find(e.shiftKey) }
            }}
          />
          <span className="term-search-count">{query && found ? (found.count ? `${found.index + 1}/${found.count}` : t('없음')) : ''}</span>
          <button onClick={() => find(true)} title={t('이전 (Shift+Enter)')} aria-label={t('이전')}>↑</button>
          <button onClick={() => find(false)} title={t('다음 (Enter)')} aria-label={t('다음')}>↓</button>
          <button onClick={closeSearch} title={t('닫기 (Esc)')} aria-label={t('닫기')}>×</button>
        </div>
      )}
    </div>
  )
}

/** Find's marks: matches in a dim yellow, the current one in the app's yellow */
const SEARCH_MARKS = {
  matchBackground: '#4a3f14', matchBorder: '#4a3f14', matchOverviewRuler: '#a8892b',
  activeMatchBackground: '#f2c94c', activeMatchBorder: '#f2c94c', activeMatchColorOverviewRuler: '#f2c94c',
}

/**
 * A file reference in output: a path with a folder part or a drive (src/app.ts, ./x.js,
 * C:\a\b.py) or a bare file name followed by a line (app.ts:12), then :line and :column
 */
const FILE_REF = /(?<![\w/\:.@-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\w@.-]+[\\/])[\w@.\-\\/]*\.[A-Za-z0-9]{1,8}|[\w@.-]+\.[A-Za-z0-9]{1,8}(?=:\d))(?::(\d+))?(?::(\d+))?/g

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return t('방금')
  if (m < 60) return t('{n}분 전', { n: m })
  const h = Math.round(m / 60)
  if (h < 24) return t('{n}시간 전', { n: h })
  return t('{n}일 전', { n: Math.round(h / 24) })
}

/** The "이어하기" picker: recent sessions from every folder. */
export const ResumePicker: React.FC<{
  onPick: (s: PastSession) => void
  onClose: () => void
  openIds: Set<string>
  /** The Pokémon that worked a session, if the game remembers one */
  monFor?: (sessionId: string) => { src: string; name: string } | null
}> = ({ onPick, onClose, openIds, monFor }) => {
  const [items, setItems] = useState<PastSession[] | null>(null)
  const [warn, setWarn] = useState<PastSession | null>(null)
  useEffect(() => { bridge?.terminals.history().then(setItems).catch(() => setItems([])) }, [])
  return (
    <div className="resume-backdrop" onClick={onClose}>
      <div className="resume-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('세션 이어하기')}>
        <div className="resume-head">
          <span>{t('세션 이어하기')}</span>
          <button onClick={onClose} aria-label={t('닫기')}>×</button>
        </div>
        {warn ? (
          <div className="resume-warn">
            <p><b>{warn.title}</b></p>
            <p>{t('이 세션은 지금 다른 터미널에서 실행 중이에요. 같은 세션을 두 곳에서 동시에 쓰면 대화가 꼬일 수 있어요.')}</p>
            <p>{t('먼저 그쪽 Claude를 종료({exit})한 뒤 여는 걸 추천해요.').split('{exit}').flatMap((s, i) => i ? [<code key={i}>/exit</code>, s] : [s])}</p>
            <div className="resume-warn-actions">
              <button onClick={() => setWarn(null)}>{t('돌아가기')}</button>
              <button className="danger" onClick={() => onPick(warn)}>{t('그래도 열기')}</button>
            </div>
          </div>
        ) : (
          <div className="resume-list">
            {items === null && <div className="resume-empty">{t('불러오는 중…')}</div>}
            {items?.length === 0 && <div className="resume-empty">{t('이어할 세션이 없어요.')}</div>}
            {items?.map(it => {
              const open = openIds.has(it.id)
              return (
                <button
                  key={it.id}
                  className={`resume-item${it.running ? ' running' : ''}`}
                  disabled={open}
                  onClick={() => (it.running ? setWarn(it) : onPick(it))}
                  title={it.cwd}
                >
                  <span className="resume-title">
                    {(() => { const m = monFor?.(it.id); return m ? <img className="resume-mon" src={m.src} alt={m.name} title={m.name} /> : null })()}
                    {it.title}
                  </span>
                  <span className="resume-meta">
                    <span className="resume-project">{it.project}</span>
                    <span>{ago(it.updatedAt)}</span>
                    {open ? <span className="resume-badge">{t('앱에서 열림')}</span> : it.running && <span className="resume-badge run">{t('실행 중')}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
