/**
 * TodayLog — the collecting story: what was caught (new species marked),
 * what got away, evolutions, level-ups and releases, newest first under a
 * heading per day, with today's summary on top. It is the save's log (the
 * newest LOG_LIMIT events, server/pokedex.js), so it reaches back as far as
 * that holds.
 */

import React from 'react'
import { spriteUrl, pokemonById } from '../theme'
import { usePokedex, TIER_LABEL, ballName, genderMark, sourceText, placeText, type DexEvent } from '../pokedexStore'
import { t, josa, locale, nameOf } from '../i18n'
import { PokeBall } from './Icons'

const time = (t: number) => new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
const dayOf = (t: number) => new Date(t).toDateString()
function dayLabel(ms: number): string {
  const d = new Date(ms)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dayOf(ms) === dayOf(Date.now())) return t('오늘')
  if (dayOf(ms) === yesterday.toDateString()) return t('어제')
  return d.toLocaleDateString(locale(), { month: 'long', day: 'numeric', weekday: 'short' })
}

/** A sentence with the name in bold: the {name} placeholder of the translated text becomes <b> */
function withName(text: string, name: string): React.ReactNode {
  const [before, after = ''] = text.split('{name}')
  return <>{before}<b>{name}</b>{after}</>
}

function line(e: DexEvent): React.ReactNode {
  // The saved names are Korean: the species' name comes from its number
  const name = nameOf(pokemonById(e.id)) || e.name || `No.${e.id}`
  switch (e.kind) {
    case 'catch': return <>{withName(t('{name} 포획'), `${e.shiny ? '✦ ' : ''}${name}${genderMark(e.gender)}`)}{e.level ? ` · Lv.${e.level}` : ''}</>
    case 'flee': return withName(t('{name}{iga} 도망쳤다', { iga: josa(name, '이가') }), name)
    case 'evolve': {
      const from = nameOf(pokemonById(e.from ?? -1)) || e.fromName || ''
      const [a, b = ''] = t('{from} → {name} 진화').split('{from}')
      return <>{a}<b>{from}</b>{withName(b, name)}</>
    }
    case 'levelup': return <><b>{name}</b> Lv.{e.level}</>
    case 'release': return withName(t('{name}{eul} 놓아줬다', { eul: josa(name, '을를') }), name)
    // A cloud sync filled the box past its limit: the newest went to the professor (server/merge.js)
    case 'professor': return withName(t('박스가 꽉 차서 {name}{eul} 박사님께 보냈다', { eul: josa(name, '을를') }), name)
    default: return <><b>{name}</b></>
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
        <span><b>{count('catch')}</b> {t('포획')}</span>
        <span><b>{fresh}</b> {t('새로운 종')}</span>
        <span><b>{count('flee')}</b> {t('놓침')}</span>
        <span><b>{count('evolve')}</b> {t('진화')}</span>
        <span><b>{count('levelup')}</b> {t('레벨업')}</span>
      </div>
      <div className="today-list">
        {events.length === 0 && <div className="dex-empty">{t('아직 기록이 없어요. 세션에서 일하다 보면 야생 포켓몬을 만나요')}</div>}
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
                {e.attendance && <span className="today-tag">{t('출석')}</span>}
              </span>
              {(e.kind === 'catch' || e.kind === 'flee') && (
                <span className="today-sub">
                  {e.tier && <span className={`w-toast-tier tier-${e.tier}`}>{TIER_LABEL[e.tier]}</span>}
                  {e.kind === 'catch' && e.ball && <span className="today-ball"><PokeBall ball={e.ball} size={13} />{ballName(e.ball)}</span>}
                  <span>{placeText(e.place)}</span>
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
