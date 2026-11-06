/**
 * PokedexView — the Pokédex (#1–649): a grid of every species (caught in
 * colour, seen as a silhouette, unknown as ?), filters by generation, tier and
 * caught, and a detail card with where and how each one was caught.
 */

import React, { useMemo, useState } from 'react'
import { POKEMON, spriteUrl, type PokemonEntry } from '../theme'
import { bridge } from '../desktop'
import { PokeBall } from './Icons'
import { ballName, levelOf, usePokedex, useViewed, markViewed, TIER_LABEL, TIER_RATE, TYPE_KO, NATURE_BY_ID, genderMark, sourceText, type Tier } from '../pokedexStore'

const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const TIERS: Tier[] = ['common', 'rare', 'sub', 'legendary', 'mythical']
const HOW: Record<string, string> = { starter: '스타팅 포켓몬', gift: '여행의 시작부터 함께', wild: '야생에서 포획', evolve: '진화로 획득', pity: '천장 보상', attendance: '출석 보상' }

type Entry = PokemonEntry & { genus?: string; flavor?: string; tier?: Tier; gen?: number; heightDm?: number; weightHg?: number }

function no(id: number) { return `No.${String(id).padStart(3, '0')}` }
function date(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const PokedexView: React.FC = () => {
  const { state } = usePokedex()
  const [gen, setGen] = useState<number | null>(null)
  const [tier, setTier] = useState<Tier | null>(null)
  const [onlyCaught, setOnlyCaught] = useState(false)
  const [pick, setPick] = useState<number | null>(null)
  const [releasing, setReleasing] = useState<string | null>(null)
  const { isNew } = useViewed()

  const caught = state?.caught ?? {}
  const seen = state?.seen ?? {}
  const all = POKEMON as Entry[]
  const list = useMemo(() => all.filter(p =>
    (gen === null || p.gen === gen) && (tier === null || p.tier === tier) && (!onlyCaught || caught[p.id]),
  ), [all, gen, tier, onlyCaught, caught])

  const caughtCount = Object.keys(caught).length
  const seenCount = Object.keys(seen).length
  const shinyCount = Object.values(caught).filter(c => c.shiny).length
  const detail = pick ? all.find(p => p.id === pick) : null
  const dc = detail ? caught[detail.id] : undefined
  const ds = detail ? seen[detail.id] : undefined

  return (
    <div className="dex">
      <div className="dex-top">
        <div className="dex-sum">
          <span><b>{caughtCount}</b> / {state?.total ?? all.length} 포획</span>
          <span><b>{seenCount}</b> 발견</span>
          <span><b>{shinyCount}</b> 이로치</span>
          <span title="박스에 넣을 수 있는 개체 수 (파티 6마리 별도). 꽉 차면 새로 잡은 개체는 박사님께 가요">박스 <b>{state?.box.length ?? 0}</b> / {state?.boxLimit ?? 1200}</span>
          <span title="이만큼 만나도 전설이 안 나오면 다음은 확정 전설">전설 천장 <b>{state?.sinceLegend ?? 0}</b> / {state?.pity ?? 150}</span>
          <span title="이만큼 만나도 환상이 안 나오면 다음은 확정 환상">환상 천장 <b>{state?.sinceMythical ?? 0}</b> / {state?.pityMythical ?? 300}</span>
        </div>
        <div className="dex-filters">
          <button className={gen === null ? 'on' : ''} onClick={() => setGen(null)}>전체</button>
          {GENS.map(g => <button key={g} className={gen === g ? 'on' : ''} onClick={() => setGen(g)}>{g}세대</button>)}
          <span className="dex-sep" />
          {TIERS.map(t => (
            <button key={t} className={`tier-${t}${tier === t ? ' on' : ''}`} onClick={() => setTier(tier === t ? null : t)} title={`만날 확률 ${TIER_RATE[t]}`}>
              {TIER_LABEL[t]}
            </button>
          ))}
          <span className="dex-sep" />
          <button className={onlyCaught ? 'on' : ''} onClick={() => setOnlyCaught(!onlyCaught)}>잡은 것만</button>
        </div>
      </div>

      <div className="dex-main">
        <div className="dex-grid" role="list">
          {list.map(p => {
            const c = caught[p.id]
            const s = seen[p.id]
            const cls = c ? 'caught' : s ? 'seen' : 'unknown'
            return (
              <button
                key={p.id}
                role="listitem"
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
              <p className="dex-help-title">포켓몬을 골라보세요</p>
              <p>Claude가 도구를 한 번 쓸 때마다 풀숲을 한 걸음 걸어요. 걸음마다 3% 확률로 야생 포켓몬을 만나고, 등급에 따라 잡히거나 도망가요. 매일 첫 세션에는 아직 못 잡은 포켓몬이 꼭 한 마리 나타나요(출석 조우).</p>
              <table className="dex-rates">
                <tbody>
                  {TIERS.map(t => (
                    <tr key={t}><td className={`tier-${t}`}>{TIER_LABEL[t]}</td><td>{TIER_RATE[t]}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="dex-fine">이로치 1/4096 · 아직 못 잡은 종은 8배 잘 나와요 · 전설 {state?.pity ?? 150}회, 환상 {state?.pityMythical ?? 300}회 천장(포획 확정)</p>
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
                  <dl className="dex-card-facts">
                    <dt>키</dt><dd>{((detail.heightDm ?? 0) / 10).toFixed(1)} m</dd>
                    <dt>몸무게</dt><dd>{((detail.weightHg ?? 0) / 10).toFixed(1)} kg</dd>
                    <dt>잡은 곳</dt><dd>{dc.place}</dd>
                    <dt>처음 잡은 날</dt><dd>{date(dc.firstAt)}</dd>
                    <dt>방법</dt><dd>{HOW[dc.how] ?? dc.how}{dc.shiny ? ' · ✦ 이로치' : ''}</dd>
                    {dc.via && <><dt>포획 경위</dt><dd>{sourceText(dc.via)} 포획</dd></>}
                    <dt>잡은 횟수</dt><dd>{dc.count}마리</dd>
                  </dl>
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
