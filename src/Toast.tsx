/**
 * Toast — the catch notification (?toast): a small window above every other
 * window that shows one game event at a time, then hides itself.
 */

import React, { useEffect, useRef, useState } from 'react'
import './styles/widget.css'
import './styles/toast.css'
import { bridge } from './desktop'
import { spriteUrl } from './theme'
import { TIER_LABEL, genderMark, sourceText, ballName, NATURE_BY_ID, type DexEvent } from './pokedexStore'
import { PokeBall } from './components/Icons'

export function durationOf(e: DexEvent): number {
  if (e.kind === 'levelup') return 5000 // small news: a short visit
  const rare = e.tier === 'legendary' || e.tier === 'mythical' || e.shiny
  return rare ? 15000 : 8000
}

/** One notification card: the toast window shows it, and the QA page (?qa) lays every kind out */
export const ToastCard: React.FC<{ t: DexEvent; leaving?: boolean; waiting?: number; onClick?: () => void; onHover?: (on: boolean) => void }> = ({ t, leaving = false, waiting = 0, onClick, onHover }) => (
  <div
    className={`w-toast kind-${t.kind} tier-${t.tier ?? 'common'}${t.shiny ? ' shiny' : ''}${leaving ? ' leaving' : ''}`}
    onClick={onClick}
    onMouseEnter={() => onHover?.(true)}
    onMouseLeave={() => onHover?.(false)}
    title="눌러서 도감에서 보기"
    role="status"
  >
    {waiting > 0 && <span className="w-toast-more" aria-label={`알림 ${waiting}개 더`}>+{waiting}</span>}
    <img src={spriteUrl(t.id, !!t.shiny)} alt="" />
    <div className="w-toast-text">
      {t.attendance && <span className="w-toast-badge">오늘의 출석 조우!</span>}
      <span className="w-toast-line">
        {t.kind === 'catch' && <><b>{t.shiny ? '✦ ' : ''}{t.name}{genderMark(t.gender)}</b>을(를) 잡았다!</>}
        {t.kind === 'flee' && <>야생의 <b>{t.name}</b>이(가) 도망쳤다…</>}
        {t.kind === 'evolve' && <><b>{t.fromName}</b>이(가) <b>{t.name}</b>(으)로 진화했다!</>}
        {t.kind === 'levelup' && <><b>{t.shiny ? '✦ ' : ''}{t.name}</b>의 레벨이 <b>{t.level}</b>(으)로 올랐다!</>}
      </span>
      <span className="w-toast-sub">
        {t.kind === 'catch' && t.level && <span className="w-toast-lv">Lv.{t.level}</span>}
        {t.kind === 'catch' && t.ball && <span className="w-toast-ball"><PokeBall ball={t.ball} size={14} />{ballName(t.ball)}</span>}
        {t.tier && <span className={`w-toast-tier tier-${t.tier}`}>{TIER_LABEL[t.tier]}</span>}
        {t.nature ? `${NATURE_BY_ID.get(t.nature)?.ko} · ` : ''}{t.place}
      </span>
      {t.via && <span className="w-toast-via">{sourceText(t.via)} 포획</span>}
      {t.toProfessor && <span className="w-toast-via warn">박스가 꽉 차서 박사님께 보냈어요 (도감엔 등록됨)</span>}
    </div>
  </div>
)

const Toast: React.FC = () => {
  const queue = useRef<DexEvent[]>([])
  const [current, setCurrent] = useState<DexEvent | null>(null)
  const [waiting, setWaiting] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [hovered, setHovered] = useState(false)
  // Time left for the card on screen: a hover stops the clock, leaving starts it again
  const left = useRef(0)

  const next = () => {
    const n = queue.current.shift() ?? null
    setWaiting(queue.current.length)
    setHovered(false)
    setCurrent(n)
    if (!n) bridge?.toast.done()
  }

  useEffect(() => bridge?.toast.onEvent((e: DexEvent) => {
    queue.current.push(e)
    setCurrent(c => c ?? queue.current.shift() ?? null)
    setWaiting(queue.current.length)
  }), [])

  useEffect(() => {
    if (!current) return
    left.current = durationOf(current)
    setLeaving(false)
  }, [current])

  useEffect(() => {
    if (!current || hovered) return
    const startedAt = Date.now()
    const out = setTimeout(() => setLeaving(true), Math.max(0, left.current - 350))
    const done = setTimeout(next, left.current)
    return () => { clearTimeout(out); clearTimeout(done); left.current = Math.max(800, left.current - (Date.now() - startedAt)) }
  }, [current, hovered])

  if (!current) return null
  const t = current
  const open = () => { bridge?.toast.open(t.id); next() }

  return (
    <div className="widget toast-host">
      <ToastCard key={`${t.at}-${t.id}`} t={t} leaving={leaving && !hovered} waiting={waiting} onClick={open} onHover={on => { setHovered(on); if (on) setLeaving(false) }} />
    </div>
  )
}

export default Toast
