/**
 * PokedexView — the Pokédex (#1–649): a grid of every species (caught in
 * colour, seen as a silhouette, unknown as ?) under a dashboard of totals,
 * filters by generation, tier, caught and name, and a detail card with where
 * and how each one was caught.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { readCarry, writeCarry, freshDexPick } from '../carry'
import { POKEMON, spriteUrl, type PokemonEntry } from '../theme'
// Genus, flavor and weight: only this view shows them, and it is its own chunk
import TEXT from 'virtual:pokedex-text'
import { bridge } from '../desktop'
import { PokeBall } from './Icons'
import { ballName, levelOf, usePokedex, useViewed, markViewed, TIER_LABEL, TIER_RATE, TYPE_KO, NATURE_BY_ID, genderMark, sourceText, type Tier } from '../pokedexStore'

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
      <span className="dex-stat-value"><b>{value.toLocaleString()}</b>{total !== undefined && <small> / {total.toLocaleString()}</small>}</span>
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
  const [gen, setGen] = useState<number | null>(null)
  const [tier, setTier] = useState<Tier | null>(null)
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
      setGen(null); setTier(null); setShow('all'); setQuery(''); setPick(id)
      if (state?.caught?.[id]) markViewed(id)
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.scrollIntoView({ block: 'center' }))
    }
    const carried = freshDexPick()
    if (carried !== null) focus(carried)
    const onPick = (e: Event) => focus((e as CustomEvent<number>).detail)
    window.addEventListener('claudex:dex-pick', onPick)
    return () => window.removeEventListener('claudex:dex-pick', onPick)
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
    (gen === null || p.gen === gen) && (tier === null || p.tier === tier)
    && (show === 'all' || (show === 'caught' ? !!caught[p.id] : !caught[p.id]))
    // Names only for what has been met: a search must not give an unseen one away
    && (!q || String(p.id) === q.replace(/^0+/, '') || (!!(caught[p.id] || seen[p.id]) && (p.ko.includes(q) || p.en.toLowerCase().includes(q)))),
  ), [all, gen, tier, show, q, caught, seen])
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

  return (
    <div className="dex">
      <div className="dex-top">
        <div className="dex-stats">
          <Stat label="포획" value={caughtCount} total={total} />
          <Stat label="발견" value={seenCount} total={total} hint="만났지만 아직 못 잡은 종도 포함" />
          <Stat label="박스" value={state?.box.length ?? 0} total={state?.boxLimit ?? 1200} hint="파티 6마리 별도. 꽉 차면 새로 잡은 개체는 박사님께 가요" />
          <div className="dex-stat dex-stat-tiers">
            <span className="dex-stat-label">등급별 포획</span>
            <div className="dex-tiers">
              {byTier.map(({ t, total: n, caught: c }) => (
                <div key={t} className={`dex-tiercol tier-${t}`} title={`${TIER_LABEL[t]} ${c} / ${n}종 · 만날 확률 ${TIER_RATE[t]}`}>
                  <span>{TIER_LABEL[t]}</span>
                  <em>{c}<small> / {n}</small></em>
                  <i><b style={{ width: `${n ? (c / n) * 100 : 0}%` }} /></i>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="dex-filterbar">
          <div className="dex-fgroup">
            <span className="dex-flabel">세대</span>
            <div className="dex-seg">
              <button className={gen === null ? 'on' : ''} onClick={() => setGen(null)}>전체</button>
              {GENS.map(g => <button key={g} className={gen === g ? 'on' : ''} onClick={() => setGen(g)} title={`${g}세대`}>{g}</button>)}
            </div>
          </div>
          <div className="dex-fgroup">
            <span className="dex-flabel">보기</span>
            <div className="dex-seg">
              <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>전체</button>
              <button className={show === 'caught' ? 'on' : ''} onClick={() => setShow('caught')}>잡은 것</button>
              <button className={show === 'missing' ? 'on' : ''} onClick={() => setShow('missing')}>못 잡은 것</button>
            </div>
          </div>
          <div className="dex-fgroup dex-fsearch">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="이름·번호 찾기" aria-label="이름이나 번호로 찾기" />
            <span className="dex-result">{list.length}종</span>
          </div>
          <div className="dex-fgroup dex-frow">
            <span className="dex-flabel">등급</span>
            <div className="dex-chips">
              {TIERS.map(t => (
                <button key={t} className={`tier-${t}${tier === t ? ' on' : ''}`} onClick={() => setTier(tier === t ? null : t)} title={`만날 확률 ${TIER_RATE[t]}`}>
                  {TIER_LABEL[t]}
                </button>
              ))}
            </div>
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
                title={c || s ? `${no(p.id)} ${p.ko}` : no(p.id)}
              >
                {cls !== 'unknown' ? <img src={spriteUrl(p.id, !!c?.shiny)} alt="" loading="lazy" draggable={false} /> : <span className="dex-q">?</span>}
                <span className="dex-no">{p.id}</span>
                {c?.shiny && <span className="dex-shiny">✦</span>}
                {c && c.count > 1 && <span className="dex-count">×{c.count}</span>}
                {isNew(p.id) && <span className="dex-new" aria-label="새로 잡음" />}
              </button>
            )
          })}
          {list.length === 0 && <div className="dex-empty">조건에 맞는 포켓몬이 없어요</div>}
        </div>

        <aside className="dex-detail">
          {!detail && (
            <div className="dex-help">
              <section className="dex-box">
                <h4>등급별 만날 확률</h4>
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
                  ? <img src={spriteUrl(detail.id, !!dc?.shiny)} alt={detail.ko} className={dc ? '' : 'silhouette'} />
                  : <span className="dex-q big">?</span>}
              </div>
              <div className="dex-card-no">{no(detail.id)} · {detail.gen}세대</div>
              <div className="dex-card-name">{dc || ds ? detail.ko : '???'} {dc && <span className="dex-card-en">{detail.en}</span>}</div>
              {(dc || ds) && (
                <div className="dex-card-tags">
                  <span className={`dex-tier tier-${detail.tier}`}>{TIER_LABEL[detail.tier ?? 'common']}</span>
                  {detail.types.map(t => <span key={t} className={`dex-type type-${t}`}>{TYPE_KO[t] ?? t}</span>)}
                </div>
              )}
              {dc ? (
                <>
                  <div className="dex-card-genus">{detail.genus}</div>
                  <p className="dex-card-flavor">{detail.flavor}</p>
                  <div className="dex-facts">
                    <div><span>키</span><b>{((detail.heightDm ?? 0) / 10).toFixed(1)} m</b></div>
                    <div><span>몸무게</span><b>{((detail.weightHg ?? 0) / 10).toFixed(1)} kg</b></div>
                    <div><span>잡은 횟수</span><b>{dc.count}마리</b></div>
                    <div><span>방법</span><b>{HOW[dc.how] ?? dc.how}{dc.shiny ? ' · ✦' : ''}</b></div>
                    <div className="wide"><span>잡은 곳</span><b>{dc.place}</b></div>
                    <div className="wide"><span>처음 잡은 날</span><b>{date(dc.firstAt)}</b></div>
                    {dc.via && <div className="wide"><span>포획 경위</span><b>{sourceText(dc.via)} 포획</b></div>}
                  </div>
                  {(() => {
                    const mine = Object.values(state?.mons ?? {}).filter(m => m.dex === detail.id)
                    if (!mine.length) return null
                    const busy = new Set(Object.values(state?.assign ?? {}))
                    return (
                      <div className="dex-owned">
                        <div className="dex-owned-title">보유 개체 {mine.length}마리</div>
                        {mine.map(m => {
                          const n = m.nature ? NATURE_BY_ID.get(m.nature) : undefined
                          return (
                            <div key={m.uid} className="dex-owned-row">
                              <div className="dex-owned-top">
                                <PokeBall ball={m.ball} size={14} title={ballName(m.ball)} />
                                <span className="dex-lv">Lv.{levelOf(m)}</span>
                                <b>{m.shiny ? '✦ ' : ''}{detail.ko}{genderMark(m.gender)}{m.gender === 'none' ? ' (무성)' : ''}</b>
                                {n && <span className="dex-nature" title={n.up ? `${n.up}↑ ${n.down}↓` : '능력 보정 없음'}>{n.ko}{n.up ? ` · ${n.up}↑ ${n.down}↓` : ''}</span>}
                              </div>
                              {!state?.party.includes(m.uid) && !busy.has(m.uid) && (
                                <button
                                  className={`dex-release${releasing === m.uid ? ' confirm' : ''}`}
                                  onClick={() => { if (releasing !== m.uid) { setReleasing(m.uid); return } setReleasing(null); bridge?.game.release(m.uid) }}
                                  onMouseLeave={() => releasing === m.uid && setReleasing(null)}
                                  title="박스에서 놓아줘요. 도감 기록은 남아요"
                                >{releasing === m.uid ? '정말 놓아주기' : '놓아주기'}</button>
                              )}
                              <div className="dex-owned-sub">
                                {state?.party.includes(m.uid) ? '파티' : '박스'}{busy.has(m.uid) ? ' · 일하는 중' : ''} · {m.steps}걸음
                                {m.via ? ` · ${sourceText(m.via)} 포획` : m.how === 'starter' ? ' · 스타팅' : m.how === 'gift' ? ' · 여행의 시작' : ''}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </>
              ) : ds ? (
                <p className="dex-card-flavor muted">아직 잡지 못했어요. {ds}번 만났어요.</p>
              ) : (
                <p className="dex-card-flavor muted">아직 만나지 못한 포켓몬이에요.</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

export default PokedexView
