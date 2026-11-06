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

function durationOf(e: DexEvent): number {
  const rare = e.tier === 'legendary' || e.tier === 'mythical' || e.shiny
  return rare ? 10000 : 5500
}

const Toast: React.FC = () => {
  const queue = useRef<DexEvent[]>([])
  const [current, setCurrent] = useState<DexEvent | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => bridge?.toast.onEvent((e: DexEvent) => {
    queue.current.push(e)
    setCurrent(c => c ?? queue.current.shift() ?? null)
  }), [])

  useEffect(() => {
    if (!current) return
    setLeaving(false)
    const out = setTimeout(() => setLeaving(true), durationOf(current) - 350)
    const next = setTimeout(() => {
      const n = queue.current.shift() ?? null
      setCurrent(n)
      if (!n) bridge?.toast.done()
    }, durationOf(current))
    return () => { clearTimeout(out); clearTimeout(next) }
  }, [current])

  if (!current) return null
  const t = current
  const dismiss = () => {
    const n = queue.current.shift() ?? null
    setCurrent(n)
    if (!n) bridge?.toast.done()
  }

  return (
    <div className="widget toast-host">
      <div
        key={`${t.at}-${t.id}`}
        className={`w-toast kind-${t.kind} tier-${t.tier ?? 'common'}${t.shiny ? ' shiny' : ''}${leaving ? ' leaving' : ''}`}
        onClick={dismiss}
        role="status"
      >
        <img src={spriteUrl(t.id, !!t.shiny)} alt="" />
        <div className="w-toast-text">
          {t.attendance && <span className="w-toast-badge">오늘의 출석 조우!</span>}
          <span className="w-toast-line">
            {t.kind === 'catch' && <><b>{t.shiny ? '✦ 빛나는 ' : ''}{t.name}{genderMark(t.gender)}</b>을(를) 잡았다!{t.pity ? ' (천장)' : ''}</>}
            {t.kind === 'flee' && <>야생의 <b>{t.name}</b>이(가) 도망쳤다…</>}
            {t.kind === 'evolve' && <><b>{t.fromName}</b>이(가) <b>{t.name}</b>(으)로 진화했다!</>}
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
    </div>
  )
}

export default Toast
