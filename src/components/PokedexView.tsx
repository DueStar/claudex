/**
 * PokedexView — the Pokédex (#1–649): a grid of every species (caught in
 * colour, seen as a silhouette, unknown as ?) under a dashboard of totals,
 * filters by generation, tier, caught and name, and a detail card with where
 * and how each one was caught.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { readCarry, writeCarry, freshDexPick } from '../carry'
import { POKEMON, spriteUrl, iconUrl, type PokemonEntry } from '../theme'
// Genus, flavor and weight: only this view shows them, and it is its own chunk
import TEXT from 'virtual:pokedex-text'
import { bridge } from '../desktop'
import { PokeBall } from './Icons'
import { ballName, levelOf, usePokedex, useViewed, markViewed, TIER_LABEL, TIER_RATE, TYPE_KO, NATURE_BY_ID, genderMark, sourceText, placeText, type Tier } from '../pokedexStore'
import { t, locale, nameOf, statName, useLang } from '../i18n'

const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const TIERS: Tier[] = ['common', 'rare', 'sub', 'legendary', 'mythical']
const HOW: Record<string, string> = { starter: '스타팅 포켓몬', gift: '여행의 시작부터 함께', wild: '야생에서 포획', evolve: '진화로 획득', pity: '야생에서 포획', attendance: '출석 보상' }

type Entry = PokemonEntry & { genus?: string; flavor?: string; weightHg?: number }

function no(id: number) { return `No.${String(id).padStart(3, '0')}` }
function date(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** A dashboard tile: a number, and with a total its share as a bar */
const Stat: React.FC<{ label: string; value: number; total?: number; hint?: string }> = ({ label, value, total, hint }) => {
  const pct = total ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className="dex-stat" title={hint}>
      <span className="dex-stat-label">{label}</span>
      <span className="dex-stat-value"><b>{value.toLocaleString(locale())}</b>{total !== undefined && <small> / {total.toLocaleString(locale())}</small>}</span>
      {/* Kept without a total too (hidden), so every tile's number sits at the same height */}
      <span className="dex-stat-bar" style={total === undefined ? { visibility: 'hidden' } : undefined}><i style={{ width: `${pct}%` }} /></span>
      {total !== undefined && <span className="dex-stat-pct">{pct.toFixed(1)}%</span>}
    </div>
  )
}

/**
 * Arrow keys across a grid of cells: the step up or down is the number of
 * cells on the first row, read from the layout (the grid wraps to its width).
 */
function gridStep(grid: HTMLElement, key: string): number | null {
  const cells = grid.querySelectorAll<HTMLElement>('.dex-cell')
  let cols = 0
  while (cols < cells.length && cells[cols].offsetTop === cells[0].offsetTop) cols++
  switch (key) {
    case 'ArrowLeft': return -1
    case 'ArrowRight': return 1
    case 'ArrowUp': return -Math.max(1, cols)
    case 'ArrowDown': return Math.max(1, cols)
    case 'Home': return -Infinity
    case 'End': return Infinity
    default: return null
  }
}

const PokedexView: React.FC = () => {
  const { state } = usePokedex()
  const lang = useLang()
  const [gen, setGen] = useState<number | null>(null)
  // Tiers to show; none picked shows them all. Several can be on at once
  const [tiers, setTiers] = useState<Tier[]>([])
  const toggleTier = (k: Tier) => setTiers(cur => (cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]))
  const [show, setShow] = useState<'all' | 'caught' | 'missing'>('all')
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState<number | null>(() => freshDexPick())
  const [releasing, setReleasing] = useState<string | null>(null)
  const { isNew } = useViewed()
  // Where the grid was scrolled, kept across a widget <-> window swap (a new page)
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  useLayoutEffect(() => {
    const top = readCarry().dexScroll
    if (gridRef.current && typeof top === 'number') gridRef.current.scrollTop = top
  }, [])
  // A clicked notification picks a species (src/Widget.tsx); shown with every filter cleared
  useEffect(() => {
    // Not cleared after use: it expires on its own (freshDexPick), since the page that asked swaps away
    const focus = (id: number) => {
      setGen(null); setTiers([]); setShow('all'); setQuery(''); setPick(id)
      if (state?.caught?.[id]) markViewed(id)
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.scrollIntoView({ block: 'center' }))
    }
    const carried = freshDexPick()
    if (carried !== null) focus(carried)
    const onPick = (e: Event) => focus((e as CustomEvent<number>).detail)
    window.addEventListener('spawn:dex-pick', onPick)
    return () => window.removeEventListener('spawn:dex-pick', onPick)
  }, [state])
  useEffect(() => () => { if (scrollSave.current) clearTimeout(scrollSave.current) }, [])
  const onGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    if (scrollSave.current) clearTimeout(scrollSave.current)
    scrollSave.current = setTimeout(() => writeCarry({ dexScroll: top }), 200)
  }

  const caught = state?.caught ?? {}
  const seen = state?.seen ?? {}
  const all = POKEMON as Entry[]
  const q = query.trim().toLowerCase()
  const list = useMemo(() => all.filter(p =>
    (gen === null || p.gen === gen) && (tiers.length === 0 || (p.tier != null && tiers.includes(p.tier)))
    && (show === 'all' || (show === 'caught' ? !!caught[p.id] : !caught[p.id]))
    // Names only for what has been met: a search must not give an unseen one away
    && (!q || String(p.id) === q.replace(/^0+/, '') || (!!(caught[p.id] || seen[p.id]) && (p.ko.includes(q) || p.en.toLowerCase().includes(q) || !!p.ja?.includes(q)))),
  ), [all, gen, tiers, show, q, caught, seen])
  const total = state?.total ?? all.length
  // Caught out of each tier's species
  const byTier = useMemo(() => TIERS.map(t => {
    const of = all.filter(p => p.tier === t)
    return { t, total: of.length, caught: of.filter(p => caught[p.id]).length }
  }), [all, caught])

  const caughtCount = Object.keys(caught).length
  const seenCount = Object.keys(seen).length
  const found = pick ? all.find(p => p.id === pick) : null
  const detail: Entry | null = found ? { ...found, ...TEXT[found.id] } : null
  const dc = detail ? caught[detail.id] : undefined
  const ds = detail ? seen[detail.id] : undefined
  // The entry's text in the language in use; English where the Korean or Japanese one is missing
  const tx = detail ? TEXT[detail.id] : undefined
  const inLang = (ko?: string, en?: string, ja?: string) => (lang === 'en' ? en : (lang === 'ja' ? ja : ko) || en) ?? ''

  return (
    <div className="dex">
      <div className="dex-top">
        <div className="dex-stats">
          <Stat label={t('포획')} value={caughtCount} total={total} />
          <Stat label={t('발견')} value={seenCount} total={total} hint={t('만났지만 아직 못 잡은 종도 포함')} />
          <Stat label={t('박스')} value={state?.box.length ?? 0} total={state?.boxLimit ?? 1200} hint={t('파티 6마리 별도. 꽉 차면 새로 잡은 개체는 박사님께 가요')} />
          <div className="dex-stat dex-stat-tiers">
            <div className="dex-tiers">
              {byTier.map(({ t: k, total: n, caught: c }) => (
                <div key={k} className={`dex-tiercol tier-${k}`} title={`${TIER_LABEL[k]} ${t('{c} / {n}종', { c, n })} · ${t('만날 확률 {rate}', { rate: TIER_RATE[k] })}`}>
                  <span>{TIER_LABEL[k]}</span>
                  <em>{c}<small> / {n}</small></em>
                  <i><b style={{ width: `${n ? (c / n) * 100 : 0}%` }} /></i>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="dex-filterbar">
          <div className="dex-fgroup">
            <span className="dex-flabel">{t('세대')}</span>
            <div className="dex-seg">
              <button className={gen === null ? 'on' : ''} onClick={() => setGen(null)}>{t('전체')}</button>
              {GENS.map(g => <button key={g} className={gen === g ? 'on' : ''} onClick={() => setGen(g)} title={t('{n}세대', { n: g })}>{g}</button>)}
            </div>
          </div>
          <div className="dex-fgroup">
            <span className="dex-flabel">{t('보기')}</span>
            <div className="dex-seg">
              <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>{t('전체')}</button>
              <button className={show === 'caught' ? 'on' : ''} onClick={() => setShow('caught')}>{t('잡은 것')}</button>
              <button className={show === 'missing' ? 'on' : ''} onClick={() => setShow('missing')}>{t('못 잡은 것')}</button>
            </div>
          </div>
          <div className="dex-fgroup">
            <span className="dex-flabel">{t('등급')}</span>
            <div className="dex-chips">
              {TIERS.map(k => (
                <button key={k} className={`tier-${k}${tiers.includes(k) ? ' on' : ''}`} aria-pressed={tiers.includes(k)} onClick={() => toggleTier(k)} title={t('만날 확률 {rate}', { rate: TIER_RATE[k] })}>
                  {TIER_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="dex-fgroup dex-fsearch">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('이름·번호 찾기')} aria-label={t('이름이나 번호로 찾기')} />
            <span className="dex-result">{t('{n}종', { n: list.length })}</span>
          </div>
        </div>
      </div>

      <div className="dex-main">
        <div
          className="dex-grid"
          role="list"
          ref={gridRef}
          onScroll={onGridScroll}
          onKeyDown={e => {
            const step = gridStep(e.currentTarget, e.key)
            if (step === null || list.length === 0) return
            e.preventDefault()
            const at = list.findIndex(p => p.id === pick)
            const next = Math.min(list.length - 1, Math.max(0, (at < 0 ? 0 : at) + step))
            const id = list[next].id
            setPick(id)
            if (caught[id]) markViewed(id)
            e.currentTarget.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus()
          }}
        >
          {list.map((p, i) => {
            const c = caught[p.id]
            const s = seen[p.id]
            const cls = c ? 'caught' : s ? 'seen' : 'unknown'
            return (
              <button
                key={p.id}
                role="listitem"
                data-id={p.id}
                // One tab stop for the whole grid (the picked cell, else the first); arrows move inside it
                tabIndex={pick === p.id || (i === 0 && !list.some(x => x.id === pick)) ? 0 : -1}
                className={`dex-cell ${cls} tier-${p.tier}${pick === p.id ? ' picked' : ''}`}
                onClick={() => { setPick(p.id); if (c) markViewed(p.id) }}
                title={c || s ? `${no(p.id)} ${nameOf(p)}` : no(p.id)}
              >
                {cls !== 'unknown' ? <img src={spriteUrl(p.id, !!c?.shiny)} alt="" loading="lazy" draggable={false} /> : <span className="dex-q">?</span>}
                <span className="dex-no">{p.id}</span>
                {c?.shiny && <span className="dex-shiny">✦</span>}
                {c && c.count > 1 && <span className="dex-count">×{c.count}</span>}
                {isNew(p.id) && <span className="dex-new" aria-label={t('새로 잡음')} />}
              </button>
            )
          })}
          {list.length === 0 && <div className="dex-empty">{t('조건에 맞는 포켓몬이 없어요')}</div>}
        </div>

        <aside className="dex-detail">
          {!detail && (
            <div className="dex-help">
              <section className="dex-box dex-rates">
                <h4>{t('등급별 만날 확률')}</h4>
                {TIERS.map(t => (
                  <div key={t} className={`dex-rate tier-${t}`}>
                    <span>{TIER_LABEL[t]}</span>
                    <i><b style={{ width: `${Math.max(2, parseFloat(TIER_RATE[t]))}%` }} /></i>
                    <em>{TIER_RATE[t]}</em>
                  </div>
                ))}
              </section>
            </div>
          )}
          {detail && (
            <div className={`dex-card tier-${detail.tier}`}>
              <div className="dex-card-art">
                {dc || ds
                  ? <img src={spriteUrl(detail.id, !!dc?.shiny)} alt={nameOf(detail)} className={dc ? '' : 'silhouette'} />
                  : <span className="dex-q big">?</span>}
              </div>
              <div className="dex-card-no">{no(detail.id)} · {t('{n}세대', { n: detail.gen ?? '' })}</div>
              <div className="dex-card-name">{dc && <img className="dex-card-icon" src={iconUrl(detail.id)} alt="" />}{dc || ds ? nameOf(detail) : '???'} {dc && lang !== 'en' && <span className="dex-card-en">{detail.en}</span>}</div>
              {(dc || ds) && (
                <div className="dex-card-tags">
                  <span className={`dex-tier tier-${detail.tier}`}>{TIER_LABEL[detail.tier ?? 'common']}</span>
                  {detail.types.map(t => <span key={t} className={`dex-type type-${t}`}>{TYPE_KO[t] ?? t}</span>)}
                </div>
              )}
              {dc ? (
                <>
                  <div className="dex-card-genus">{inLang(tx?.genus, tx?.genusEn, tx?.genusJa)}</div>
                  <p className="dex-card-flavor">{inLang(tx?.flavor, tx?.flavorEn, tx?.flavorJa)}</p>
                  <div className="dex-facts">
                    <div><span>{t('키')}</span><b>{((detail.heightDm ?? 0) / 10).toFixed(1)} m</b></div>
                    <div><span>{t('몸무게')}</span><b>{((detail.weightHg ?? 0) / 10).toFixed(1)} kg</b></div>
                    <div><span>{t('잡은 횟수')}</span><b>{t('{n}마리', { n: dc.count })}</b></div>
                    <div><span>{t('방법')}</span><b>{HOW[dc.how] ? t(HOW[dc.how]) : dc.how}{dc.shiny ? ' · ✦' : ''}</b></div>
                    <div className="wide"><span>{t('잡은 곳')}</span><b>{placeText(dc.place)}</b></div>
                    <div className="wide"><span>{t('처음 잡은 날')}</span><b>{date(dc.firstAt)}</b></div>
                    {dc.via && <div className="wide"><span>{t('포획 경위')}</span><b>{t('{how} 포획', { how: sourceText(dc.via) })}</b></div>}
                  </div>
                  {(() => {
                    const mine = Object.values(state?.mons ?? {}).filter(m => m.dex === detail.id)
                    if (!mine.length) return null
                    const busy = new Set(Object.values(state?.assign ?? {}))
                    return (
                      <div className="dex-owned">
                        <div className="dex-owned-title">{t('보유 개체 {n}마리', { n: mine.length })}</div>
                        {mine.map(m => {
                          const n = m.nature ? NATURE_BY_ID.get(m.nature) : undefined
                          return (
                            <div key={m.uid} className="dex-owned-row">
                              <div className="dex-owned-top">
                                <PokeBall ball={m.ball} size={14} title={ballName(m.ball)} />
                                <span className="dex-lv">Lv.{levelOf(m)}</span>
                                <b>{m.shiny ? '✦ ' : ''}{nameOf(detail)}{genderMark(m.gender)}{m.gender === 'none' ? ` (${t('무성')})` : ''}</b>
                                {n && <span className="dex-nature" title={n.up ? `${statName(n.up)}↑ ${statName(n.down ?? '')}↓` : t('능력 보정 없음')}>{nameOf(n)}{n.up ? ` · ${statName(n.up)}↑ ${statName(n.down ?? '')}↓` : ''}</span>}
                              </div>
                              {!state?.party.includes(m.uid) && !busy.has(m.uid) && (
                                <button
                                  className={`dex-release${releasing === m.uid ? ' confirm' : ''}`}
                                  onClick={() => { if (releasing !== m.uid) { setReleasing(m.uid); return } setReleasing(null); bridge?.game.release(m.uid) }}
                                  onMouseLeave={() => releasing === m.uid && setReleasing(null)}
                                  title={t('박스에서 놓아줘요. 도감 기록은 남아요')}
                                >{releasing === m.uid ? t('정말 놓아주기') : t('놓아주기')}</button>
                              )}
                              <div className="dex-owned-sub">
                                {state?.party.includes(m.uid) ? t('파티') : t('박스')}{busy.has(m.uid) ? ` · ${t('일하는 중')}` : ''} · {t('{n}걸음', { n: m.steps })}
                                {m.via ? ` · ${t('{how} 포획', { how: sourceText(m.via) })}` : m.how === 'starter' ? ` · ${t('스타팅')}` : m.how === 'gift' ? ` · ${t('여행의 시작')}` : ''}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </>
              ) : ds ? (
                <p className="dex-card-flavor muted">{t('아직 잡지 못했어요. {n}번 만났어요.', { n: ds })}</p>
              ) : (
                <p className="dex-card-flavor muted">{t('아직 만나지 못한 포켓몬이에요.')}</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

// Memoized: the widget re-renders on every server message, and this view reads its own stores
export default React.memo(PokedexView)
