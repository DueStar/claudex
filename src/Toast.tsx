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

const KIND_LABEL: Partial<Record<DexEvent['kind'], string>> = { catch: '포획', flee: '도망쳤어요', evolve: '진화', levelup: '레벨 업' }

/**
 * One notification card: the toast window shows it, and the QA page (?qa) lays
 * every kind out. One job per line, loudest first: what happened (a small
 * label with the tier), who (the name, big), then how and where, then why.
 */
export const ToastCard: React.FC<{ t: DexEvent; leaving?: boolean; waiting?: number; onClick?: () => void; onHover?: (on: boolean) => void }> = ({ t, leaving = false, waiting = 0, onClick, onHover }) => {
  const nature = t.nature ? NATURE_BY_ID.get(t.nature)?.ko : null
  const meta = t.kind === 'catch' || t.kind === 'flee' ? [nature, t.place].filter(Boolean).join(' · ') : ''
  return (
    <div
      className={`w-toast kind-${t.kind} tier-${t.tier ?? 'common'}${t.shiny ? ' shiny' : ''}${leaving ? ' leaving' : ''}`}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      title="눌러서 도감에서 보기"
      role="status"
    >
      {waiting > 0 && <span className="w-toast-more" aria-label={`알림 ${waiting}개 더`}>+{waiting}</span>}
      {/* The HOME picture (the SV icons blur at this size); one that got away is only a silhouette */}
      <div className="w-toast-art"><img src={spriteUrl(t.id, !!t.shiny)} alt="" /></div>
      <div className="w-toast-text">
        <div className="w-toast-eyebrow">
          {t.attendance && <span className="w-toast-badge">오늘의 출석</span>}
          <span className="w-toast-kind">{KIND_LABEL[t.kind] ?? ''}</span>
          {t.tier && t.kind !== 'levelup' && <span className="w-toast-tier">{TIER_LABEL[t.tier]}</span>}
          {t.newSpecies && <span className="w-toast-new">NEW</span>}
        </div>
        <div className="w-toast-title">
          {t.kind === 'evolve'
            ? <>{t.fromName} <span className="w-toast-arrow">→</span> {t.name}</>
            : <>{t.shiny ? '✦ ' : ''}{t.name}{genderMark(t.gender)}</>}
          {(t.kind === 'catch' || t.kind === 'levelup') && t.level ? <small>Lv.{t.level}</small> : null}
        </div>
        {(meta || (t.kind === 'catch' && t.ball)) && (
          <div className="w-toast-meta">
            {t.kind === 'catch' && t.ball && <span className="w-toast-ball"><PokeBall ball={t.ball} size={14} />{ballName(t.ball)}</span>}
            {meta && <span className="w-toast-place">{meta}</span>}
          </div>
        )}
        {t.via && t.kind === 'catch' && <div className="w-toast-via">{sourceText(t.via)} 포획</div>}
        {t.toProfessor && <div className="w-toast-via warn">박스가 꽉 차서 박사님께 보냈어요 (도감엔 등록됨)</div>}
      </div>
    </div>
  )
}

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
