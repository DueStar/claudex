/**
 * TodayLog — today's collecting story: what was caught (new species marked),
 * what got away, evolutions, level-ups and releases, newest first, with a
 * summary on top.
 */

import React from 'react'
import { spriteUrl } from '../theme'
import { usePokedex, TIER_LABEL, ballName, genderMark, sourceText, type DexEvent } from '../pokedexStore'
import { PokeBall } from './Icons'

const time = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

function line(e: DexEvent): React.ReactNode {
  switch (e.kind) {
    case 'catch': return <><b>{e.shiny ? '✦ ' : ''}{e.name}{genderMark(e.gender)}</b> 포획{e.level ? ` · Lv.${e.level}` : ''}</>
    case 'flee': return <><b>{e.name}</b>이(가) 도망쳤다</>
    case 'evolve': return <><b>{e.fromName}</b> → <b>{e.name}</b> 진화</>
    case 'levelup': return <><b>{e.name}</b> Lv.{e.level}</>
    case 'release': return <><b>{e.name}</b>을(를) 놓아줬다</>
    default: return <><b>{e.name}</b></>
  }
}

const TodayLog: React.FC = () => {
  const { state } = usePokedex()
  const today = [...(state?.today ?? [])].filter(e => e.kind !== 'sendout' && e.kind !== 'swap' && e.kind !== 'exchange').reverse()
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
        {today.length === 0 && <div className="dex-empty">오늘은 아직 기록이 없어요. 세션에서 일하다 보면 야생 포켓몬을 만나요</div>}
        {today.map((e, i) => (
          <div key={`${e.at}-${i}`} className={`today-row kind-${e.kind} tier-${e.tier ?? 'common'}`}>
            <span className="today-time">{time(e.at)}</span>
            <img src={spriteUrl(e.id, !!e.shiny)} alt="" loading="lazy" className={e.kind === 'flee' ? 'faded' : ''} />
            <div className="today-text">
              <span className="today-line">
                {line(e)}
                {e.kind === 'catch' && e.newSpecies && <span className="today-new">NEW</span>}
                {e.attendance && <span className="today-tag">출석</span>}
                {e.pity && <span className="today-tag">천장</span>}
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
        ))}
      </div>
    </div>
  )
}

export default TodayLog
