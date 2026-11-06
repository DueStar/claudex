/**
 * TerminalPanel — the Claude Code sessions that live inside the desktop app,
 * one tab per session, each tab wearing its session's Pokémon.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { bridge, useTerminals, type PastSession, type TerminalInfo } from '../desktop'
import { getAvatarPath, themedDisplayName, useTheme } from '../theme'

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
      fontSize: 13,
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

    let disposed = false
    bridge.terminals.buffer(term.id).then((buf) => { if (!disposed && buf) xterm.write(buf) })
    const offData = bridge.terminals.onData(({ id, data }) => { if (id === term.id) xterm.write(data) })
    const input = xterm.onData((data) => bridge!.terminals.write(term.id, data))
    // Ctrl+V pastes, Ctrl+C copies when there is a selection (else it is ^C for Claude)
    xterm.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
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

    // One session can be on screen in two windows (the widget and the office). Only a
    // window the user can see sets the session's size, or the two fight over it and
    // Claude Code draws for the wrong width
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
    document.fonts.addEventListener('loadingdone', refont)
    document.addEventListener('visibilitychange', doFit)
    window.addEventListener('focus', doFit)

    return () => {
      disposed = true
      host.removeEventListener('dragover', onDragOver)
      host.removeEventListener('drop', onDrop)
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
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.round(h / 24)}일 전`
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
      <div className="resume-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="세션 이어하기">
        <div className="resume-head">
          <span>세션 이어하기</span>
          <button onClick={onClose} aria-label="닫기">×</button>
        </div>
        {warn ? (
          <div className="resume-warn">
            <p><b>{warn.title}</b></p>
            <p>이 세션은 지금 다른 터미널에서 실행 중이에요. 같은 세션을 두 곳에서 동시에 쓰면 대화가 꼬일 수 있어요.</p>
            <p>먼저 그쪽 Claude를 종료(<code>/exit</code>)한 뒤 여는 걸 추천해요.</p>
            <div className="resume-warn-actions">
              <button onClick={() => setWarn(null)}>돌아가기</button>
              <button className="danger" onClick={() => onPick(warn)}>그래도 열기</button>
            </div>
          </div>
        ) : (
          <div className="resume-list">
            {items === null && <div className="resume-empty">불러오는 중…</div>}
            {items?.length === 0 && <div className="resume-empty">이어할 세션이 없어요.</div>}
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
                    {open ? <span className="resume-badge">앱에서 열림</span> : it.running && <span className="resume-badge run">실행 중</span>}
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

const TerminalPanel: React.FC = () => {
  const terms = useTerminals()
  useTheme()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const resume = async (past: PastSession) => {
    if (!bridge) return
    setPicking(false)
    setError(null)
    const r = await bridge.terminals.create({ cwd: past.cwd, resume: past.id })
    if ('error' in r) setError(r.error)
    else setActiveId(r.id)
  }

  useEffect(() => {
    if (!activeId || !terms.some(t => t.id === activeId)) setActiveId(terms[terms.length - 1]?.id ?? null)
  }, [terms, activeId])

  useEffect(() => bridge?.terminals.onFocus((id) => setActiveId(id)), [])

  /** New session: in Documents straight away, or in a picked folder */
  const open = async (pick = false) => {
    if (!bridge) return
    setError(null)
    let cwd: string | undefined
    if (pick) {
      const chosen = await bridge.terminals.pickFolder()
      if (!chosen) return
      cwd = chosen
    }
    const r = await bridge.terminals.create(cwd ? { cwd } : {})
    if ('error' in r) setError(r.error)
    else setActiveId(r.id)
  }

  if (!bridge) {
    return <div className="term-empty">터미널은 데스크톱 앱에서만 열 수 있어요.</div>
  }

  return (
    <div className="term-panel">
      <div className="term-tabs">
        {terms.map(t => {
          const name = themedDisplayName('assistant', 'Claude', `main-${t.sessionId}`)
          return (
            <button
              key={t.id}
              className={`term-tab${t.id === activeId ? ' active' : ''}${t.status === 'exited' ? ' exited' : ''}`}
              onClick={() => setActiveId(t.id)}
              title={`${name} — ${t.cwd}`}
            >
              <img src={getAvatarPath('assistant', `main-${t.sessionId}`)} alt="" />
              <span className="term-tab-name">{name}</span>
              <span className="term-tab-project">{t.project}</span>
              <span
                className="term-tab-close"
                role="button"
                aria-label={`${name} 닫기`}
                onClick={(e) => { e.stopPropagation(); bridge!.terminals.close(t.id) }}
              >×</span>
            </button>
          )
        })}
        <button className="term-new" onClick={() => open()} title="문서 폴더에서 새 Claude 세션 열기">＋ 몬스터볼 던지기</button>
        <button className="term-new icon" onClick={() => open(true)} title="다른 폴더를 골라 새 세션 열기" aria-label="폴더 골라서 열기">📁</button>
        <button className="term-new" onClick={() => setPicking(true)} title="예전 세션을 골라 이어서 하기">↺ 이어하기</button>
      </div>
      {picking && <ResumePicker onPick={resume} onClose={() => setPicking(false)} openIds={new Set(terms.filter(t => t.status === 'running').map(t => t.sessionId))} />}
      {error && <div className="term-error">세션을 열 수 없어요: {error}</div>}
      <div className="term-body">
        {terms.length === 0 && (
          <div className="term-empty">
            <p>아직 일하는 포켓몬이 없어요.</p>
            <button className="term-new big" onClick={() => open()}>＋ 몬스터볼 던지기 (문서 폴더)</button>
            <button className="term-new big" onClick={() => open(true)}>📁 다른 폴더에서 열기</button>
            <button className="term-new big" onClick={() => setPicking(true)}>↺ 예전 세션 이어하기</button>
          </div>
        )}
        {terms.map(t => <TerminalView key={t.id} term={t} active={t.id === activeId} />)}
      </div>
    </div>
  )
}

export default TerminalPanel
