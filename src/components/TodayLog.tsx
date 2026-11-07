/**
 * TodayLog — the collecting story: what was caught (new species marked),
 * what got away, evolutions, level-ups and releases, newest first under a
 * heading per day, with today's summary on top. It is the save's log (the
 * newest LOG_LIMIT events, server/pokedex.js), so it reaches back as far as
 * that holds.
 */

import React from 'react'
import { spriteUrl } from '../theme'
import { usePokedex, TIER_LABEL, ballName, genderMark, sourceText, type DexEvent } from '../pokedexStore'
import { PokeBall } from './Icons'

const time = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
const dayOf = (t: number) => new Date(t).toDateString()
function dayLabel(t: number): string {
  const d = new Date(t)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dayOf(t) === dayOf(Date.now())) return '오늘'
  if (dayOf(t) === yesterday.toDateString()) return '어제'
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}

function line(e: DexEvent): React.ReactNode {
  switch (e.kind) {
    case 'catch': return <><b>{e.shiny ? '✦ ' : ''}{e.name}{genderMark(e.gender)}</b> 포획{e.level ? ` · Lv.${e.level}` : ''}</>
    case 'flee': return <><b>{e.name}</b>이(가) 도망쳤다</>
    case 'evolve': return <><b>{e.fromName}</b> → <b>{e.name}</b> 진화</>
    case 'levelup': return <><b>{e.name}</b> Lv.{e.level}</>
    case 'release': return <><b>{e.name}</b>을(를) 놓아줬다</>
    // A cloud sync filled the box past its limit: the newest went to the professor (server/merge.js)
    case 'professor': return <>박스가 꽉 차서 <b>{e.name ?? `No.${e.id}`}</b>을(를) 박사님께 보냈다</>
    default: return <><b>{e.name}</b></>
  }
}

const TodayLog: React.FC = () => {
  const { state } = usePokedex()
  const events = [...(state?.log ?? [])].filter(e => e.kind !== 'sendout' && e.kind !== 'swap' && e.kind !== 'exchange').reverse()
  const today = events.filter(e => dayOf(e.at) === dayOf(Date.now()))
  const count = (k: string) => today.filter(e => e.kind === k).length
  const fresh = today.filter(e => e.kind === 'catch' && e.newSpecies).length

  return (
    <div className="today">
      <div className="today-sum">
        <span><b>{count('catch')}</b> 포획</span>
        <span><b>{fresh}</b> 새로운 종</span>
        <span><b>{count('flee')}</b> 놓침</span>
        <span><b>{count('evolve')}</b> 진화</span>
        <span><b>{count('levelup')}</b> 레벨업</span>
      </div>
      <div className="today-list">
        {events.length === 0 && <div className="dex-empty">아직 기록이 없어요. 세션에서 일하다 보면 야생 포켓몬을 만나요</div>}
        {events.map((e, i) => (
          <React.Fragment key={`${e.at}-${i}`}>
          {(i === 0 || dayOf(events[i - 1].at) !== dayOf(e.at)) && <div className="today-day">{dayLabel(e.at)}</div>}
          <div className={`today-row kind-${e.kind} tier-${e.tier ?? 'common'}`}>
            <span className="today-time">{time(e.at)}</span>
            <img src={spriteUrl(e.id, !!e.shiny)} alt="" loading="lazy" className={e.kind === 'flee' ? 'faded' : ''} />
            <div className="today-text">
              <span className="today-line">
                {line(e)}
                {e.kind === 'catch' && e.newSpecies && <span className="today-new">NEW</span>}
                {e.attendance && <span className="today-tag">출석</span>}
              </span>
              {(e.kind === 'catch' || e.kind === 'flee') && (
                <span className="today-sub">
                  {e.tier && <span className={`w-toast-tier tier-${e.tier}`}>{TIER_LABEL[e.tier]}</span>}
                  {e.kind === 'catch' && e.ball && <span className="today-ball"><PokeBall ball={e.ball} size={13} />{ballName(e.ball)}</span>}
                  <span>{e.place}</span>
                  {e.via && <span>· {sourceText(e.via)}</span>}
                </span>
              )}
            </div>
          </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export default TodayLog
