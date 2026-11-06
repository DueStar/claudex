/**
 * BoxView — the PC: the party's six on top, the box below. Pick a Pokémon to
 * see its traits and catch story; a box Pokémon can trade places with a
 * resting party member, or be released.
 */

import React, { useMemo, useState } from 'react'
import { pokemonById, spriteUrl } from '../theme'
import { bridge } from '../desktop'
import { usePokedex, TIER_LABEL, NATURE_BY_ID, genderMark, sourceText, type Mon, type Tier } from '../pokedexStore'

type Sort = 'recent' | 'dex' | 'tier' | 'steps'
const TIER_RANK: Record<Tier, number> = { mythical: 0, legendary: 1, sub: 2, rare: 3, common: 4 }
const HOW: Record<string, string> = { starter: '스타팅', gift: '여행의 시작', attendance: '출석 조우', pity: '천장', wild: '야생' }

function tierOf(dex: number): Tier {
  return ((pokemonById(dex) as { tier?: Tier } | undefined)?.tier ?? 'common') as Tier
}

const BoxView: React.FC = () => {
  const { state } = usePokedex()
  const [sort, setSort] = useState<Sort>('recent')
  const [shinyOnly, setShinyOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [releasing, setReleasing] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const mons = state?.mons ?? {}
  const party = state?.party ?? []
  // `assign` holds only the sessions that are live now: these Pokémon are working
  const working = useMemo(() => new Set(Object.values(state?.assign ?? {})), [state])

  const box = useMemo(() => {
    const q = query.trim()
    let list = (state?.box ?? []).map(uid => mons[uid]).filter((m): m is Mon => !!m)
    if (shinyOnly) list = list.filter(m => m.shiny)
    if (q) list = list.filter(m => (pokemonById(m.dex)?.ko ?? '').includes(q) || String(m.dex) === q)
    const by: Record<Sort, (a: Mon, b: Mon) => number> = {
      recent: (a, b) => b.at - a.at,
      dex: (a, b) => a.dex - b.dex || b.at - a.at,
      tier: (a, b) => TIER_RANK[tierOf(a.dex)] - TIER_RANK[tierOf(b.dex)] || a.dex - b.dex,
      steps: (a, b) => b.steps - a.steps,
    }
    return list.sort(by[sort])
  }, [state, mons, sort, shinyOnly, query])

  const picked = pick ? mons[pick] : undefined
  const inParty = picked ? party.includes(picked.uid) : false
  const isWorking = picked ? working.has(picked.uid) : false
  const p = picked ? pokemonById(picked.dex) : undefined
  const n = picked?.nature ? NATURE_BY_ID.get(picked.nature) : undefined

  const select = (uid: string) => { setPick(uid); setReleasing(false); setChoosing(false); setNote(null) }
  const exchange = async (partyUid: string) => {
    if (!picked || !bridge) return
    const r = await bridge.game.exchange(picked.uid, partyUid)
    setChoosing(false)
    setNote(r.ok ? '파티에 넣었어요' : `바꾸지 못했어요 (${r.reason === 'busy' ? '일하는 중' : r.reason ?? '알 수 없음'})`)
  }
  const release = async () => {
    if (!picked || !bridge) return
    if (!releasing) { setReleasing(true); return }
    const r = await bridge.game.release(picked.uid)
    setReleasing(false)
    if (r.ok) setPick(null)
    else setNote(`놓아주지 못했어요 (${r.reason ?? '알 수 없음'})`)
  }

  const Cell: React.FC<{ m: Mon }> = ({ m }) => (
    <button
      className={`box-cell tier-${tierOf(m.dex)}${pick === m.uid ? ' picked' : ''}${working.has(m.uid) ? ' working' : ''}`}
      onClick={() => select(m.uid)}
      title={`${pokemonById(m.dex)?.ko ?? ''}${genderMark(m.gender)}`}
    >
      <img src={spriteUrl(m.dex, m.shiny)} alt="" loading="lazy" />
      {m.shiny && <span className="box-shiny">✦</span>}
      {working.has(m.uid) && <span className="box-working" />}
    </button>
  )

  return (
    <div className="box">
      <div className="box-main">
        <div className="box-left">
          <div className="box-party">
            <div className="box-title">파티 <span>{party.length} / {state?.partySize ?? 6}</span></div>
            <div className="box-party-row">
              {party.map(uid => mons[uid] && <Cell key={uid} m={mons[uid]} />)}
            </div>
          </div>
          <div className="box-toolbar">
            <div className="box-title">박스 <span className={(state?.box.length ?? 0) >= (state?.boxLimit ?? 1200) ? 'full' : ''}>{state?.box.length ?? 0} / {state?.boxLimit ?? 1200}</span></div>
            <input className="box-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="이름·번호" />
            <div className="dex-filters">
              {([['recent', '최근'], ['dex', '번호'], ['tier', '등급'], ['steps', '걸음']] as [Sort, string][]).map(([k, label]) => (
                <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
              ))}
              <span className="dex-sep" />
              <button className={shinyOnly ? 'on' : ''} onClick={() => setShinyOnly(v => !v)}>✦ 이로치</button>
            </div>
          </div>
          <div className="box-grid">
            {box.length ? box.map(m => <Cell key={m.uid} m={m} />) : <div className="dex-empty">{state?.box.length ? '조건에 맞는 포켓몬이 없어요' : '박스가 비어 있어요. 일하다 보면 야생 포켓몬을 만나요'}</div>}
          </div>
        </div>

        <aside className="dex-detail">
          {!picked || !p ? (
            <div className="dex-help">
              <p className="dex-help-title">PC 박스</p>
              <p>포켓몬을 눌러 개체 정보를 봐요. 박스 포켓몬은 쉬고 있는 파티 포켓몬과 자리를 바꾸거나 놓아줄 수 있어요.</p>
              <p className="dex-fine">박스가 꽉 차면 새로 잡은 포켓몬은 도감에만 등록되고 박사님께 보내져요.</p>
            </div>
          ) : (
            <div className="dex-card">
              <div className={`dex-card-art tier-${tierOf(picked.dex)}`}><img src={spriteUrl(picked.dex, picked.shiny)} alt="" /></div>
              <div className="dex-card-name">
                <b>{picked.shiny ? '✦ ' : ''}{p.ko}{genderMark(picked.gender)}</b>
                <span className={`w-toast-tier tier-${tierOf(picked.dex)}`}>{TIER_LABEL[tierOf(picked.dex)]}</span>
              </div>
              <dl className="dex-card-facts">
                <dt>위치</dt><dd>{inParty ? '파티' : '박스'}{isWorking ? ' · 일하는 중' : ''}</dd>
                <dt>성격</dt><dd>{n ? `${n.ko}${n.up ? ` (${n.up}↑ ${n.down}↓)` : ' (보정 없음)'}` : '—'}</dd>
                <dt>성별</dt><dd>{picked.gender === 'male' ? '수컷' : picked.gender === 'female' ? '암컷' : picked.gender === 'none' ? '무성' : '—'}</dd>
                <dt>걸음</dt><dd>{picked.steps}걸음{picked.evos ? ` · ${picked.evos}번 진화` : ''}</dd>
                <dt>만난 곳</dt><dd>{picked.place || '—'} · {HOW[picked.how] ?? picked.how}</dd>
                {picked.via && <><dt>포획 경위</dt><dd>{sourceText(picked.via)}</dd></>}
                <dt>잡은 날</dt><dd>{new Date(picked.at).toLocaleDateString('ko-KR')}</dd>
              </dl>

              {!inParty && (
                <div className="box-actions">
                  <button className="box-act" onClick={() => setChoosing(v => !v)}>파티에 넣기</button>
                  <button className={`box-act danger${releasing ? ' confirm' : ''}`} onClick={release} onMouseLeave={() => setReleasing(false)}>
                    {releasing ? '정말 놓아주기' : '놓아주기'}
                  </button>
                </div>
              )}
              {choosing && (
                <div className="box-choose">
                  <div className="dex-fine">누구와 바꿀까요? (일하는 포켓몬은 못 바꿔요)</div>
                  <div className="box-party-row">
                    {party.map(uid => {
                      const m = mons[uid]
                      if (!m) return null
                      const w = working.has(uid)
                      return (
                        <button key={uid} className={`box-cell${w ? ' working' : ''}`} disabled={w} onClick={() => exchange(uid)} title={pokemonById(m.dex)?.ko}>
                          <img src={spriteUrl(m.dex, m.shiny)} alt="" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {inParty && <p className="dex-fine">파티 포켓몬이에요. 세션을 열 때 몬스터볼로 던질 수 있어요.</p>}
              {note && <p className="dex-fine">{note}</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

export default BoxView
