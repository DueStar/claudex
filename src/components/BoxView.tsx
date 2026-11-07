/**
 * BoxView — the PC: the party's six on top, the box below. Pick a Pokémon to
 * see its traits and catch story; a box Pokémon can trade places with a
 * resting party member, or be released. The grid shows the SV box icons by
 * default (small, many to a screen) or the HOME pictures; the detail card is
 * always the HOME picture, the one that shows a shiny's colours.
 */

import React, { useMemo, useState } from 'react'
import { pokemonById, spriteUrl, iconUrl } from '../theme'
import { bridge } from '../desktop'
import { usePokedex, TIER_LABEL, NATURE_BY_ID, genderMark, sourceText, ballName, levelOf, minutesToNext, BALL_BY_ID, BALL_TIER_LABEL, type Mon, type Tier } from '../pokedexStore'
import { PokeBall, SearchIcon } from './Icons'

type Sort = 'recent' | 'dex' | 'tier' | 'steps'
type Look = 'icon' | 'art'
const LOOK_KEY = 'claudex.boxLook'
function readLook(): Look {
  try { return localStorage.getItem(LOOK_KEY) === 'art' ? 'art' : 'icon' } catch { return 'icon' }
}
const TIER_RANK: Record<Tier, number> = { mythical: 0, legendary: 1, sub: 2, rare: 3, common: 4 }
const HOW: Record<string, string> = { starter: '스타팅', gift: '여행의 시작', attendance: '출석 조우', pity: '야생', wild: '야생' }

function tierOf(dex: number): Tier {
  return ((pokemonById(dex) as { tier?: Tier } | undefined)?.tier ?? 'common') as Tier
}

const BoxView: React.FC = () => {
  const { state } = usePokedex()
  const [sort, setSort] = useState<Sort>('recent')
  const [look, setLookState] = useState<Look>(readLook)
  const setLook = (l: Look) => { setLookState(l); try { localStorage.setItem(LOOK_KEY, l) } catch { /* this time only */ } }
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

  // A second click on the picked one closes the panel
  const select = (uid: string) => { setPick(pick === uid ? null : uid); setReleasing(false); setChoosing(false); setNote(null) }
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
      <img src={look === 'icon' ? iconUrl(m.dex) : spriteUrl(m.dex, m.shiny)} alt="" loading="lazy" />
      {m.shiny && <span className="box-shiny">✦</span>}
      <PokeBall ball={m.ball} size={14} className="box-ball" />
      <span className="box-lv">Lv.{levelOf(m)}</span>
      {working.has(m.uid) && <span className="box-working" />}
    </button>
  )

  return (
    <div className={`box look-${look}`}>
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
            <div className="box-tools">
              <label className="box-search">
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="이름 혹은 번호로 검색" aria-label="이름 혹은 번호로 검색" />
                <SearchIcon size={13} />
              </label>
              <div className="dex-fgroup">
                <span className="dex-flabel">정렬</span>
                <div className="dex-seg">
                  {([['recent', '최근'], ['dex', '번호'], ['tier', '등급'], ['steps', '걸음']] as [Sort, string][]).map(([k, label]) => (
                    <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="dex-seg">
                <button className={shinyOnly ? 'on' : ''} onClick={() => setShinyOnly(v => !v)} title="색이 다른 포켓몬만 보기">✦ 색이 다른 포켓몬</button>
              </div>
              <div className="dex-seg" role="group" aria-label="보기">
                <button className={look === 'icon' ? 'on' : ''} onClick={() => setLook('icon')} title="작은 아이콘으로 많이 보기">아이콘</button>
                <button className={look === 'art' ? 'on' : ''} onClick={() => setLook('art')} title="큰 그림으로 보기">그림</button>
              </div>
            </div>
          </div>
          <div className="box-grid">
            {box.length ? box.map(m => <Cell key={m.uid} m={m} />) : <div className="dex-empty">{state?.box.length ? '조건에 맞는 포켓몬이 없어요' : '박스가 비어 있어요. 일하다 보면 야생 포켓몬을 만나요'}</div>}
          </div>
        </div>

        {picked && p && (
        <aside className="dex-detail">
            <div className="dex-card">
              <button className="box-close" onClick={() => setPick(null)} aria-label="닫기" title="닫기">×</button>
              <div className={`dex-card-art tier-${tierOf(picked.dex)}`}><img src={spriteUrl(picked.dex, picked.shiny)} alt="" /></div>
              <div className="dex-card-name">
                <img className="dex-card-icon" src={iconUrl(picked.dex)} alt="" />
                <b>{picked.shiny ? '✦ ' : ''}{p.ko}{genderMark(picked.gender)}</b>
                <span className={`w-toast-tier tier-${tierOf(picked.dex)}`}>{TIER_LABEL[tierOf(picked.dex)]}</span>
              </div>
              <div className="dex-facts">
                <div><span>레벨</span><b>Lv.{levelOf(picked)}{levelOf(picked) > (picked.metLevel ?? 5) ? <small> · 함께 +{levelOf(picked) - (picked.metLevel ?? 5)}</small> : null}</b></div>
                <div><span>다음 레벨까지</span><b>{minutesToNext(picked) !== null ? `${minutesToNext(picked)}분` : '—'}</b></div>
                <div><span>위치</span><b>{inParty ? '파티' : '박스'}{isWorking ? ' · 일하는 중' : ''}</b></div>
                <div><span>성별</span><b>{picked.gender === 'male' ? '수컷' : picked.gender === 'female' ? '암컷' : picked.gender === 'none' ? '무성' : '—'}</b></div>
                <div><span>성격</span><b>{n ? n.ko : '—'}{n ? <small>{n.up ? ` ${n.up}↑ ${n.down}↓` : ' 보정 없음'}</small> : null}</b></div>
                <div><span>걸음</span><b>{picked.steps}걸음{picked.evos ? <small> · {picked.evos}번 진화</small> : null}</b></div>
                <div className="wide"><span>볼</span><b className="box-ball-dd"><PokeBall ball={picked.ball} size={16} />{ballName(picked.ball)}<small> · {BALL_TIER_LABEL[BALL_BY_ID.get(picked.ball ?? 'poke-ball')?.tier ?? 'basic']}</small></b></div>
                <div className="wide"><span>만난 곳</span><b>{picked.place || '—'} · {HOW[picked.how] ?? picked.how}</b></div>
                {picked.via && <div className="wide"><span>포획 경위</span><b>{sourceText(picked.via)}</b></div>}
                <div className="wide"><span>잡은 날</span><b>{new Date(picked.at).toLocaleDateString('ko-KR')}</b></div>
              </div>

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
        </aside>
        )}
      </div>
    </div>
  )
}

export default BoxView
