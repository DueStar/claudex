/**
 * Toast — the catch notification (?toast): a small window above every other
 * window that shows one game event at a time, then hides itself.
 */

import React, { useEffect, useRef, useState } from 'react'
import './styles/widget.css'
import './styles/toast.css'
import { bridge } from './desktop'
import { spriteUrl, pokemonById } from './theme'
import { TIER_LABEL, genderMark, sourceText, placeText, ballName, NATURE_BY_ID, type DexEvent } from './pokedexStore'
import { t as tr, nameOf, lang } from './i18n'
import { PokeBall } from './components/Icons'
import { useSettings } from './settingsStore'

/** 설정 › 알림 › 표시 시간 */
const DURATION_SCALE = { short: 0.6, normal: 1, long: 1.6 } as const

/** How long a card stays; with others waiting behind it, the ordinary ones move along faster */
export function durationOf(e: DexEvent, waiting = 0): number {
  const rare = e.tier === 'legendary' || e.tier === 'mythical' || e.shiny
  if (rare) return 15000
  if (e.kind === 'levelup') return waiting ? 3000 : 5000 // small news: a short visit
  return waiting ? 4000 : 8000
}

// Its own words, not t(): '포획' here is the toast's "Caught!", elsewhere the plain "Caught"
const KIND_LABEL: Partial<Record<DexEvent['kind'], [string, string, string]>> = {
  catch: ['포획', 'Caught!', 'ゲット'], flee: ['도망쳤어요', 'Fled', '逃げられた'], evolve: ['진화', 'Evolved', '進化'], levelup: ['레벨 업', 'Level up', 'レベルアップ'],
}
/** The species' name in the language in use (the saved `name` is Korean) */
const monName = (id: number | undefined, saved?: string) => nameOf(pokemonById(id ?? -1)) || saved || ''

/**
 * One notification card: the toast window shows it, and the QA page (?qa) lays
 * every kind out. One job per line, loudest first: what happened (a small
 * label with the tier), who (the name, big), then how and where, then why.
 * Cards waiting behind it peek out below as a stack (one or two edges).
 */
export const ToastCard: React.FC<{ t: DexEvent; leaving?: boolean; waiting?: number; onClick?: () => void; onClose?: () => void; onHover?: (on: boolean) => void }> = ({ t, leaving = false, waiting = 0, onClick, onClose, onHover }) => {
  const nature = t.nature ? nameOf(NATURE_BY_ID.get(t.nature)) : null
  const meta = t.kind === 'catch' || t.kind === 'flee' ? [nature, placeText(t.place)].filter(Boolean).join(' · ') : ''
  return (
    <div className="w-toast-stack" onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)}>
    {waiting > 1 && <span className="w-toast-behind second" aria-hidden />}
    {waiting > 0 && <span className="w-toast-behind" aria-hidden />}
    <div
      className={`w-toast kind-${t.kind} tier-${t.tier ?? 'common'}${t.shiny ? ' shiny' : ''}${leaving ? ' leaving' : ''}`}
      onClick={onClick}
      title={waiting ? tr('눌러서 도감에서 보기 · 알림 {n}개 더', { n: waiting }) : tr('눌러서 도감에서 보기')}
      role="status"
    >
      <button className="w-toast-close" onClick={e => { e.stopPropagation(); onClose?.() }} aria-label={tr('알림 닫기')} title={tr('닫기')}>×</button>
      {/* The HOME picture (the SV icons blur at this size); one that got away is only a silhouette */}
      <div className="w-toast-art"><img src={spriteUrl(t.id, !!t.shiny)} alt="" /></div>
      <div className="w-toast-text">
        <div className="w-toast-eyebrow">
          {t.attendance && <span className="w-toast-badge">{tr('오늘의 출석')}</span>}
          <span className="w-toast-kind">{KIND_LABEL[t.kind]?.[{ ko: 0, en: 1, ja: 2 }[lang()]] ?? ''}</span>
          {t.tier && t.kind !== 'levelup' && <span className="w-toast-tier">{TIER_LABEL[t.tier]}</span>}
          {t.newSpecies && <span className="w-toast-new">NEW</span>}
        </div>
        <div className="w-toast-title">
          {t.kind === 'evolve'
            ? <>{monName(t.from, t.fromName)} <span className="w-toast-arrow">→</span> {monName(t.id, t.name)}</>
            : <>{t.shiny ? '✦ ' : ''}{monName(t.id, t.name)}{genderMark(t.gender)}</>}
          {(t.kind === 'catch' || t.kind === 'levelup') && t.level ? <small>Lv.{t.level}</small> : null}
        </div>
        {(meta || (t.kind === 'catch' && t.ball)) && (
          <div className="w-toast-meta">
            {t.kind === 'catch' && t.ball && <span className="w-toast-ball"><PokeBall ball={t.ball} size={14} />{ballName(t.ball)}</span>}
            {meta && <span className="w-toast-place">{meta}</span>}
          </div>
        )}
        {t.via && t.kind === 'catch' && <div className="w-toast-via">{tr('{how} 포획', { how: sourceText(t.via) })}</div>}
        {t.toProfessor && <div className="w-toast-via warn">{tr('박스가 꽉 차서 박사님께 보냈어요 (도감엔 등록됨)')}</div>}
      </div>
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
  const settings = useSettings() // also redraws the card when the privacy setting changes
  const scale = DURATION_SCALE[settings.notify.duration] ?? 1

  const next = () => {
    const n = queue.current.shift() ?? null
    setWaiting(queue.current.length)
    setHovered(false)
    setCurrent(n)
    if (!n) bridge?.toast.done()
  }

  useEffect(() => {
    const off = bridge?.toast.onEvent((e: DexEvent) => {
      queue.current.push(e)
      setCurrent(c => c ?? queue.current.shift() ?? null)
      setWaiting(queue.current.length)
    })
    bridge?.toast.ready() // events wait in main until the page listens
    return off
  }, [])

  useEffect(() => {
    if (!current) return
    left.current = Math.round(durationOf(current, queue.current.length) * scale)
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
      <ToastCard key={`${t.at}-${t.id}`} t={t} leaving={leaving && !hovered} waiting={waiting} onClick={open} onClose={next} onHover={on => { setHovered(on); if (on) setLeaving(false) }} />
    </div>
  )
}

export default Toast
