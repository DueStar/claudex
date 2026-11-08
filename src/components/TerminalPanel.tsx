/**
 * TerminalPanel — a Claude Code session's terminal (TerminalView) and the
 * 이어하기 picker (ResumePicker). The widget lays them out.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { getTermFont, resetTermFont, stepTermFont, subscribeTermFont } from '../termFont'
import '@xterm/xterm/css/xterm.css'
import { bridge, type PastSession, type TerminalInfo } from '../desktop'
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

export const TerminalView: React.FC<{ term: TerminalInfo; active: boolean }> = ({ term, active }) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const xtermRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!bridge || !hostRef.current) return
    const xterm = new Terminal({
      // Monaspace Neon for code. It has no Hangul, so Korean falls through to
      // Pretendard; the WebGL renderer keeps every glyph on the cell grid
      fontFamily: "'Monaspace Neon Var', 'Monaspace Neon', 'Pretendard Variable', 'Malgun Gothic', Consolas, monospace",
      fontSize: getTermFont(),
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: THEME,
      // Claude Code's logo is block/quadrant characters (▐▛███▜▌): drawn by xterm itself, not taken from a font
      customGlyphs: true,
      rescaleOverlappingGlyphs: true,
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.open(hostRef.current)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      xterm.loadAddon(webgl)
    } catch { /* no WebGL: the DOM renderer still works */ }
    xtermRef.current = xterm
    fitRef.current = fit
    // Links open with Ctrl+click, as in Windows Terminal (a plain click selects text)
    xterm.loadAddon(new WebLinksAddon((event, uri) => {
      if (event.ctrlKey || event.metaKey) bridge!.terminals.openUrl(uri)
    }))
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
    bridge.terminals.buffer(term.id).then((buf) => { if (!disposed && buf) xterm.write(buf) })
    const offData = bridge.terminals.onData(({ id, data }) => { if (id === term.id) xterm.write(data) })
    const input = xterm.onData((data) => bridge!.terminals.write(term.id, data))
    // Ctrl+V pastes, Ctrl+C copies when there is a selection (else it is ^C for Claude)
    xterm.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      // Ctrl+1–4 switch the app's views (터미널/도감/박스/기록): not for the terminal
      if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-4]$/.test(e.key)) return false
      // Ctrl+= / Ctrl+- / Ctrl+0: text size
      if (e.ctrlKey && !e.altKey && (e.key === '=' || e.key === '+')) { stepTermFont(1); return false }
      if (e.ctrlKey && !e.altKey && e.key === '-') { stepTermFont(-1); return false }
      if (e.ctrlKey && !e.altKey && e.key === '0') { resetTermFont(); return false }
      // Shift+Enter: a new line in the prompt instead of sending it (Claude Code reads ESC+CR as a newline)
      if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
        bridge!.terminals.write(term.id, '\x1b\r')
        return false
      }
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
      host.removeEventListener('dragover', onDragOver)
      host.removeEventListener('drop', onDrop)
      host.removeEventListener('wheel', onWheel)
      offFont()
      document.fonts.removeEventListener('loadingdone', refont)
      document.removeEventListener('visibilitychange', doFit)
      window.removeEventListener('focus', doFit)
      ro.disconnect()
      offData()
      input.dispose()
      xterm.dispose()
    }
  }, [term.id])

  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        const x = xtermRef.current
        if (x && document.visibilityState === 'visible') { bridge?.terminals.resize(term.id, x.cols, x.rows); x.focus() }
      } catch {}
    })
    return () => cancelAnimationFrame(id)
  }, [active, term.id])

  return <div className="term-view" ref={hostRef} style={{ display: active ? 'block' : 'none' }} />
}

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
