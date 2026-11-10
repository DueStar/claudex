/**
 * TodayLog — the collecting story: what was caught (new species marked),
 * what got away, evolutions and releases, newest first under a heading per
 * day, each with its Pokémon's SV box icon. A day's level-ups fold into one
 * small line (each Pokémon once, at its highest level that day), with today's summary on top. It is the save's log (the
 * newest LOG_LIMIT events, server/pokedex.js), so it reaches back as far as
 * that holds.
 */

import React from 'react'
import { iconUrl, spriteUrl, pokemonById } from '../theme'
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

/** A log line, or level-ups in a row folded into one (newest first, each Pokémon once) */
type Item = { kind: 'event'; e: DexEvent } | { kind: 'levelups'; at: number; mons: DexEvent[] }

function fold(events: DexEvent[]): Item[] {
  const out: Item[] = []
  const byDay = new Map<string, Extract<Item, { kind: 'levelups' }>>()
  for (const e of events) {
    if (e.kind !== 'levelup') { out.push({ kind: 'event', e }); continue }
    // A day's level-ups: one line where its newest was; newest first, so a
    // Pokémon already in the line is there at its higher level
    const day = byDay.get(dayOf(e.at))
    if (!day) { const item = { kind: 'levelups' as const, at: e.at, mons: [e] }; byDay.set(dayOf(e.at), item); out.push(item) }
    else if (!day.mons.some(m => (m.uid ?? m.id) === (e.uid ?? e.id))) day.mons.push(e)
  }
  return out
}

/** The SV box icon; the HOME picture when there is none (a form the icon set lacks) */
const Icon: React.FC<{ e: DexEvent; className?: string }> = ({ e, className }) => (
  <img src={iconUrl(e.id)} alt="" loading="lazy" className={className}
    onError={ev => { const img = ev.currentTarget; if (!img.dataset.fallback) { img.dataset.fallback = '1'; img.src = spriteUrl(e.id, !!e.shiny) } }} />
)

const TodayLog: React.FC = () => {
  const { state } = usePokedex()
  const events = [...(state?.log ?? [])].filter(e => e.kind !== 'sendout' && e.kind !== 'swap' && e.kind !== 'exchange').reverse()
  const today = events.filter(e => dayOf(e.at) === dayOf(Date.now()))
  const count = (k: string) => today.filter(e => e.kind === k).length
  const fresh = today.filter(e => e.kind === 'catch' && e.newSpecies).length
  const items = fold(events)

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
        {items.map((it, i) => {
          const at = it.kind === 'event' ? it.e.at : it.at
          const prev = items[i - 1]
          const day = (i === 0 || dayOf(prev.kind === 'event' ? prev.e.at : prev.at) !== dayOf(at)) && <div className="today-day">{dayLabel(at)}</div>
          if (it.kind === 'levelups') return (
            <React.Fragment key={`lv-${at}-${i}`}>
              {day}
              <div className="today-row kind-levelups">
                <span className="today-time">{time(at)}</span>
                <span className="today-lv-label">{t('레벨업')}</span>
                <span className="today-lv-mons">
                  {it.mons.map(m => (
                    <span key={m.uid ?? m.id} className="today-lv-mon"><Icon e={m} />{nameOf(pokemonById(m.id)) || m.name}<b>Lv.{m.level}</b></span>
                  ))}
                </span>
              </div>
            </React.Fragment>
          )
          const e = it.e
          return (
          <React.Fragment key={`${e.at}-${i}`}>
          {day}
          <div className={`today-row kind-${e.kind} tier-${e.tier ?? 'common'}`}>
            <span className="today-time">{time(e.at)}</span>
            <Icon e={e} className={`today-icon${e.kind === 'flee' ? ' faded' : ''}`} />
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
          )
        })}
      </div>
    </div>
  )
}

// Memoized: the widget re-renders on every server message, and this view reads its own stores
export default React.memo(TodayLog)
