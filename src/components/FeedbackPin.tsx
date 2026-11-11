/**
 * FeedbackPin — feedback about Claudex, with a pin on the screen if wanted.
 *
 * Mounted while it is open. It opens on the note: what kind and a line of text.
 * Pinning a spot is optional: the trainer picks one (the page under it does not
 * react), a pin goes there and a small picture of that part is taken; sending
 * the picture is a separate tick. Sending opens a new GitHub issue on our repo,
 * filled in by the app (electron/feedback.cjs); the picture goes on the
 * clipboard for a Ctrl+V. On the terminal screen the picture starts unticked and
 * no terminal text is written down, so code or paths never land in a public issue.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bridge, type FeedbackKind } from '../desktop'
import { t, lang } from '../i18n'
import '../styles/feedback.css'

type Rect = { x: number; y: number; width: number; height: number }
interface Spot { x: number; y: number; element: string; text: string; inTerminal: boolean; area: Rect }

const KINDS: { id: FeedbackKind; label: string }[] = [
  { id: 'fix', label: '고쳐 주세요' },
  { id: 'add', label: '추가해 주세요' },
  { id: 'direction', label: '이런 방향은 어때요' },
  { id: 'like', label: '좋았던 점' },
]

const isOurs = (el: Element | null) => !!el?.closest('.fb-ui')

function under(x: number, y: number): Element | null {
  return document.elementsFromPoint(x, y).find(el => !el.closest('.fb-ui, .fb-layer')) ?? null
}

/** A short path to the element, for finding the spot again: classes, not the text */
function cssPath(node: Element | null): string {
  const parts: string[] = []
  while (node && node !== document.body && parts.length < 5) {
    if (node.id && node.id !== 'root') { parts.unshift(`#${node.id}`); break }
    let part = node.tagName.toLowerCase()
    const cls = Array.from(node.classList).filter(c => c !== 'on' && !c.startsWith('fb-') && !/^mood-/.test(c)).slice(0, 2)
    if (cls.length) part += `.${cls.join('.')}`
    parts.unshift(part)
    node = node.parentElement
  }
  return parts.join(' > ')
}

function snippet(el: Element): string {
  const s = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim()
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

/** The part to picture: the nearest element around the pin of a sensible size, else a box around it */
function areaFor(el: Element, x: number, y: number): Rect {
  const pad = 24
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const r = n.getBoundingClientRect()
    if (r.width > 900 || r.height > 560) break
    if (r.width >= 80 && r.height >= 48) return { x: r.left - pad, y: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }
  }
  const w = 520, h = 320
  return { x: x - w / 2, y: y - h / 2, width: w, height: h }
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

export default function FeedbackPin({ view, onClose }: { view: string; onClose(): void }) {
  const [phase, setPhase] = useState<'pick' | 'shoot' | 'write'>('write')
  const [hover, setHover] = useState<DOMRect | null>(null)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [shot, setShot] = useState<string | null>(null)
  const [kind, setKind] = useState<FeedbackKind>('fix')
  const [text, setText] = useState('')
  const [attach, setAttach] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [sent, setSent] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [popAt, setPopAt] = useState<{ left: number; top: number } | null>(null)

  // Esc: out of picking back to the note, else closed
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      if (phaseRef.current === 'pick') setPhase('write')
      else if (phaseRef.current === 'write') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function startPick() {
    setMsg(null)
    setPopAt(null)
    setPhase('pick')
  }

  function clearSpot() {
    setSpot(null)
    setShot(null)
    setAttach(false)
    setPopAt(null)
  }

  async function pick(e: React.MouseEvent) {
    const el = under(e.clientX, e.clientY)
    if (!el) return
    const inTerminal = view === 'terminal' || !!el.closest('.xterm')
    const s: Spot = {
      x: e.clientX, y: e.clientY, inTerminal,
      element: cssPath(el),
      text: el.closest('.xterm') ? '' : snippet(el),
      area: areaFor(el, e.clientX, e.clientY),
    }
    setSpot(s)
    setHover(null)
    setPhase('shoot')
    await nextFrame() // the pin is on screen, the outline is gone
    const img = await bridge?.feedback?.capture(s.area).catch(() => null)
    setShot(img ?? null)
    setAttach(!!img && !inTerminal)
    setPopAt(null)
    setPhase('write')
  }

  // The note goes beside the pin, inside the window
  useLayoutEffect(() => {
    if (phase !== 'write') return
    const box = popRef.current
    if (!box) return
    const w = box.offsetWidth, h = box.offsetHeight, W = window.innerWidth, H = window.innerHeight
    if (!spot) { setPopAt({ left: (W - w) / 2, top: Math.max(12, (H - h) / 2) }); return }
    let left = spot.x + 18
    if (left + w > W - 12) left = spot.x - w - 18
    left = Math.max(12, Math.min(left, W - w - 12))
    const top = Math.max(12, Math.min(spot.y - 24, H - h - 12))
    setPopAt({ left, top })
    areaRef.current?.focus({ preventScroll: true })
  }, [phase, spot, shot, popAt === null])
  useEffect(() => { if (phase === 'write') areaRef.current?.focus({ preventScroll: true }) }, [phase])

  const note = () => ({
    kind, text,
    context: {
      view,
      element: spot?.element,
      text: spot?.text || undefined,
      width: window.innerWidth, height: window.innerHeight,
      lang: lang(),
    },
  })

  async function send() {
    if (!text.trim()) { setMsg({ tone: 'warn', text: t('한 줄만 적어 주세요') }); areaRef.current?.focus(); return }
    const r = await bridge?.feedback?.send({ ...note(), attach: attach && !!shot })
    if (!r?.ok) { setMsg({ tone: 'warn', text: t('GitHub 창을 열지 못했어요') }); return }
    setSent(true)
    setMsg({ tone: 'ok', text: r.attached ? t('GitHub 창이 열렸어요. 본문에 Ctrl+V 하면 화면이 붙고, 「Create」를 누르면 올라가요') : t('GitHub 창에서 「Create」를 누르면 올라가요') })
  }

  async function copy() {
    if (!text.trim()) { setMsg({ tone: 'warn', text: t('한 줄만 적어 주세요') }); areaRef.current?.focus(); return }
    const r = await bridge?.feedback?.copy(note())
    if (r?.ok) { setSent(true); setMsg({ tone: 'ok', text: t('복사했어요') }) }
  }

  return (
    <>
      {phase === 'pick' && (
        <div
          className="fb-layer"
          onMouseMove={e => { const el = under(e.clientX, e.clientY); setHover(el && !isOurs(el) ? el.getBoundingClientRect() : null) }}
          onMouseLeave={() => setHover(null)}
          onClick={pick}
          onContextMenu={e => { e.preventDefault(); setPhase('write') }}
        />
      )}
      {phase === 'pick' && hover && (
        <div className="fb-ui fb-hover" style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }} />
      )}
      {phase === 'pick' && (
        <div className="fb-ui fb-bar" role="status">
          <span>{t('의견을 남길 곳을 눌러 주세요')}</span>
          <button type="button" className="fb-bar-btn ghost" onClick={() => setPhase('write')}>{t('취소')}</button>
        </div>
      )}
      {spot && phase !== 'pick' && <div className={`fb-ui fb-pin${sent ? ' sent' : ''}`} style={{ left: spot.x, top: spot.y }} aria-hidden="true" />}
      {phase === 'write' && (
        <div
          ref={popRef}
          className="fb-ui fb-pop"
          role="dialog"
          aria-label={t('Claudex에 바라는 점')}
          style={popAt ? { left: popAt.left, top: popAt.top } : { visibility: 'hidden' }}
          onKeyDown={e => e.stopPropagation()}
        >
          <div className="fb-pop-head">
            <strong>{t('Claudex에 바라는 점')}</strong>
            <button type="button" className="fb-x" onClick={onClose} aria-label={t('닫기')}>×</button>
          </div>
          <p className="fb-lead">{t('고쳤으면 하는 것, 더해졌으면 하는 것, 이렇게 자랐으면 하는 방향을 들려주세요.')}</p>
          <div className="fb-kinds" role="group">
            {KINDS.map(k => (
              <button key={k.id} type="button" className={`fb-kind${kind === k.id ? ' on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{t(k.label)}</button>
            ))}
          </div>
          <textarea
            ref={areaRef}
            className="fb-text"
            rows={4}
            maxLength={2000}
            value={text}
            placeholder={t('한 줄이어도 좋아요. 편하게 적어 주세요.')}
            aria-label={t('의견')}
            onChange={e => { setText(e.target.value); setMsg(null) }}
          />
          {!spot && (
            <div className="fb-spot">
              <button type="button" className="fb-spot-btn" onClick={startPick}>
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 1.5a4.6 4.6 0 0 0-4.6 4.6C3.4 9.6 8 14.5 8 14.5s4.6-4.9 4.6-8.4A4.6 4.6 0 0 0 8 1.5Zm0 6.3a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z" /></svg>
                {t('화면에서 위치 찍기')}
              </button>
              <span>{t('선택 · 찍은 부분의 화면도 함께 보낼 수 있어요')}</span>
            </div>
          )}
          {spot && (
            <div className="fb-spot-acts">
              <span>{t('위치를 찍었어요')}</span>
              <button type="button" onClick={startPick}>{t('다시 찍기')}</button>
              <button type="button" onClick={clearSpot}>{t('위치 빼기')}</button>
            </div>
          )}
          {spot && shot && (
            <label className={`fb-shot${attach ? '' : ' off'}`}>
              <img src={shot} alt="" />
              <span className="fb-shot-row">
                <input type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)} />
                <span>
                  {t('이 부분 화면도 같이 보내기')}
                  {spot?.inTerminal && <em>{t('터미널 내용이 보일 수 있어요')}</em>}
                </span>
              </span>
            </label>
          )}
          <div className="fb-actions">
            <button type="button" className="fb-btn primary" onClick={send}>{t('GitHub에 올리기')}</button>
            <button type="button" className="fb-btn" onClick={copy}>{t('복사')}</button>
          </div>
          {msg && <div className={`fb-msg ${msg.tone}`} role="status">{msg.text}</div>}
          <p className="fb-note">{t('GitHub 로그인이 필요해요. 계정이 없으면 복사해서 보내 주세요. 올린 내용은 누구나 볼 수 있어요.')}</p>
        </div>
      )}
    </>
  )
}
