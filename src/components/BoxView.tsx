/**
 * BoxView — the PC: the party's six on top, the box below. Pick a Pokémon to
 * see its traits and catch story; a box Pokémon can trade places with a
 * resting party member (the button, or drag it onto a party slot), or be
 * released. The grid fills the width; it shows the SV box icons by default
 * (small, many to a screen) or the HOME pictures; the detail card is always
 * the HOME picture, the one that shows a shiny's colours.
 * (30 to a box, 6 × 5 like the games, was tried in 1.3.13–1.3.14 and rolled back.)
 */

import React, { useMemo, useState } from 'react'
import { pokemonById, spriteUrl, iconUrl } from '../theme'
import { bridge } from '../desktop'
import { t, locale, nameOf, statName } from '../i18n'
import { usePokedex, TIER_LABEL, NATURE_BY_ID, genderMark, sourceText, placeText, ballName, levelOf, minutesToNext, BALL_BY_ID, BALL_TIER_LABEL, type Mon, type Tier } from '../pokedexStore'
import { PokeBall, SearchIcon } from './Icons'

type Sort = 'mine' | 'recent' | 'dex' | 'tier' | 'steps'
/** The sort is remembered: an arranged box opens in its own order */
const SORT_KEY = 'claudex-box-sort'
const SORTS: Sort[] = ['mine', 'recent', 'dex', 'tier', 'steps']
function savedSort(): Sort {
  try { const v = localStorage.getItem(SORT_KEY) as Sort | null; return v && SORTS.includes(v) ? v : 'recent' } catch { return 'recent' }
}
type Look = 'icon' | 'art'
const LOOK_KEY = 'claudex.boxLook'
function readLook(): Look {
  try { return localStorage.getItem(LOOK_KEY) === 'art' ? 'art' : 'icon' } catch { return 'icon' }
}
const TIER_RANK: Record<Tier, number> = { mythical: 0, legendary: 1, sub: 2, rare: 3, common: 4 }
const HOW: Record<string, string> = { starter: '스타팅', gift: '여행의 시작', attendance: '출석 조우', pity: '야생', wild: '야생' }

const nameById = (dex: number) => nameOf(pokemonById(dex))

function tierOf(dex: number): Tier {
  return ((pokemonById(dex) as { tier?: Tier } | undefined)?.tier ?? 'common') as Tier
}

/** `resting`: party Pokémon whose session is open but not working (they may still trade places) */
const BoxView: React.FC<{ resting?: Set<string> }> = ({ resting }) => {
  const { state } = usePokedex()
  const [sort, setSortState] = useState<Sort>(savedSort)
  const setSort = (s: Sort) => { setSortState(s); try { localStorage.setItem(SORT_KEY, s) } catch {} }
  const [look, setLookState] = useState<Look>(readLook)
  const setLook = (l: Look) => { setLookState(l); try { localStorage.setItem(LOOK_KEY, l) } catch { /* this time only */ } }
  const [shinyOnly, setShinyOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [releasing, setReleasing] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null) // a box Pokémon being dragged
  const [dropOn, setDropOn] = useState<string | null>(null)     // the party slot under it
  const [insert, setInsert] = useState<{ uid: string; after: boolean } | null>(null) // the gap in the box it would go into

  const mons = state?.mons ?? {}
  const party = state?.party ?? []
  // `assign` holds only the sessions that are live now: these Pokémon are working
  // (and the box ones out helping a session's subagents)
  const working = useMemo(() => new Set([...Object.values(state?.assign ?? {}), ...Object.values(state?.helpers ?? {}).flat()]), [state])

  const box = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = (state?.box ?? []).map(uid => mons[uid]).filter((m): m is Mon => !!m)
    if (shinyOnly) list = list.filter(m => m.shiny)
    if (q) list = list.filter(m => nameById(m.dex).toLowerCase().includes(q) || (pokemonById(m.dex)?.ko ?? '').includes(q) || String(m.dex) === q)
    if (sort === 'mine') return list // the box's own order, as the trainer arranged it
    const by: Record<Exclude<Sort, 'mine'>, (a: Mon, b: Mon) => number> = {
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
  const exchangeWith = async (boxUid: string, partyUid: string) => {
    if (!bridge) return
    const r = await bridge.game.exchange(boxUid, partyUid)
    setChoosing(false)
    setNote(r.ok ? t('파티에 넣었어요') : t('바꾸지 못했어요 ({reason})', { reason: r.reason === 'busy' ? t('일하는 중') : r.reason ?? t('알 수 없음') }))
  }
  const exchange = (partyUid: string) => { if (picked) exchangeWith(picked.uid, partyUid) }
  const release = async () => {
    if (!picked || !bridge) return
    if (!releasing) { setReleasing(true); return }
    const r = await bridge.game.release(picked.uid)
    setReleasing(false)
    if (r.ok) setPick(null)
    else setNote(t('놓아주지 못했어요 ({reason})', { reason: r.reason ?? t('알 수 없음') }))
  }

  // Drag a box Pokémon onto a resting party slot to trade places (a working one cannot leave its session)
  const inBox = (uid: string) => !party.includes(uid)
  // a working one stays; one whose session rests may go, and the box one takes over its session
  const locked = (uid: string) => working.has(uid) && !resting?.has(uid)
  // Inside the box it goes in between: the gap on the near side of the Pokémon under the pointer
  // (the others shift along, nobody trades places). Only the whole box can be
  // arranged (not a search or the shiny filter); the order seen becomes the trainer's own
  const filtered = shinyOnly || query.trim() !== ''
  const canDropOn = (uid: string) => !!dragging && dragging !== uid && (party.includes(uid) ? !locked(uid) : !filtered)
  const arrange = (from: string, onto: string, after: boolean) => {
    if (!bridge) return
    const ids = box.map(m => m.uid).filter(u => u !== from)
    const at = ids.indexOf(onto)
    if (at === -1) return
    ids.splice(after ? at + 1 : at, 0, from)
    if (ids.join() === box.map(m => m.uid).join()) return // back into its own gap
    setSort('mine')
    void bridge.game.arrange(ids).then(r => { if (!r.ok) setNote(t('옮기지 못했어요 ({reason})', { reason: r.reason ?? t('알 수 없음') })) })
  }
  // A plain function, not a component: a new component type every render would remount the cell mid-drag
  const cell = (m: Mon) => (
    <button
      key={m.uid}
      className={`box-cell tier-${tierOf(m.dex)}${pick === m.uid ? ' picked' : ''}${working.has(m.uid) ? ' working' : ''}${dragging === m.uid ? ' dragging' : ''}${dropOn === m.uid ? ' drop' : ''}${insert?.uid === m.uid ? (insert.after ? ' ins-after' : ' ins-before') : ''}${dragging && party.includes(m.uid) && locked(m.uid) ? ' nodrop' : ''}`}
      onClick={() => select(m.uid)}
      title={`${nameById(m.dex)}${genderMark(m.gender)}${inBox(m.uid) ? ` · ${t('끌어서 박스 안에서 옮기거나, 파티 칸에 놓아 교체')}` : ''}`}
      draggable={inBox(m.uid)}
      onDragStart={e => { if (!inBox(m.uid)) return; e.dataTransfer.setData('text/plain', m.uid); e.dataTransfer.effectAllowed = 'move'; setDragging(m.uid) }}
      onDragEnd={() => { setDragging(null); setDropOn(null); setInsert(null) }}
      onDragOver={e => {
        if (!canDropOn(m.uid)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (party.includes(m.uid)) { if (dropOn !== m.uid) setDropOn(m.uid); return }
        const r = e.currentTarget.getBoundingClientRect()
        const after = e.clientX > r.left + r.width / 2
        if (insert?.uid !== m.uid || insert.after !== after) setInsert({ uid: m.uid, after })
      }}
      onDragLeave={() => { if (dropOn === m.uid) setDropOn(null) }}
      onDrop={e => {
        e.preventDefault()
        const from = e.dataTransfer.getData('text/plain') || dragging
        const gap = insert
        setDragging(null); setDropOn(null); setInsert(null)
        if (!from || !canDropOn(m.uid) || !inBox(from)) return
        if (party.includes(m.uid)) exchangeWith(from, m.uid)
        else arrange(from, m.uid, gap?.uid === m.uid ? gap.after : false)
      }}
    >
      <img src={look === 'icon' ? iconUrl(m.dex) : spriteUrl(m.dex, m.shiny)} alt="" loading="lazy" draggable={false} />
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
            <div className="box-title">{t('파티')} <span>{party.length} / {state?.partySize ?? 6}</span></div>
            <div className="box-party-row">
              {party.map(uid => mons[uid] && cell(mons[uid]))}
            </div>
          </div>
          <div className="box-toolbar">
            <div className="box-title">{t('박스')} <span className={(state?.box.length ?? 0) >= (state?.boxLimit ?? 1200) ? 'full' : ''}>{state?.box.length ?? 0} / {state?.boxLimit ?? 1200}</span></div>
            <div className="box-tools">
              <label className="box-search">
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('이름 혹은 번호로 검색')} aria-label={t('이름 혹은 번호로 검색')} />
                <SearchIcon size={13} />
              </label>
              <div className="dex-fgroup">
                <span className="dex-flabel">{t('정렬')}</span>
                <div className="dex-seg">
                  {([['mine', '내 순서'], ['recent', '최근'], ['dex', '번호'], ['tier', '등급'], ['steps', '걸음']] as [Sort, string][]).map(([k, label]) => (
                    <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{t(label)}</button>
                  ))}
                </div>
              </div>
              <div className="dex-seg">
                <button className={shinyOnly ? 'on' : ''} onClick={() => setShinyOnly(v => !v)} title={t('색이 다른 포켓몬만 보기')}>✦ {t('색이 다른 포켓몬')}</button>
              </div>
              <div className="dex-seg" role="group" aria-label={t('보기')}>
                <button className={look === 'icon' ? 'on' : ''} onClick={() => setLook('icon')} title={t('작은 아이콘으로 많이 보기')}>{t('아이콘')}</button>
                <button className={look === 'art' ? 'on' : ''} onClick={() => setLook('art')} title={t('큰 그림으로 보기')}>{t('그림')}</button>
              </div>
            </div>
          </div>
          {/* A drop in the gap between cells goes where the bar shows */}
          <div
            className="box-grid"
            onDragOver={e => { if (insert && dragging) e.preventDefault() }}
            onDrop={e => {
              if (e.defaultPrevented || !insert || !dragging) return
              e.preventDefault()
              const gap = insert
              const from = dragging
              setDragging(null); setInsert(null)
              if (inBox(from) && !filtered) arrange(from, gap.uid, gap.after)
            }}
          >
            {box.length ? box.map(cell) : <div className="dex-empty">{state?.box.length ? t('조건에 맞는 포켓몬이 없어요') : t('박스가 비어 있어요. 일하다 보면 야생 포켓몬을 만나요')}</div>}
          </div>
        </div>

        {picked && p && (
        <aside className="dex-detail">
            <div className="dex-card">
              <button className="box-close" onClick={() => setPick(null)} aria-label={t('닫기')} title={t('닫기')}>×</button>
              <div className={`dex-card-art tier-${tierOf(picked.dex)}`}><img src={spriteUrl(picked.dex, picked.shiny)} alt="" /></div>
              <div className="dex-card-name">
                <img className="dex-card-icon" src={iconUrl(picked.dex)} alt="" />
                <b>{picked.shiny ? '✦ ' : ''}{nameOf(p)}{genderMark(picked.gender)}</b>
                <span className={`w-toast-tier tier-${tierOf(picked.dex)}`}>{TIER_LABEL[tierOf(picked.dex)]}</span>
              </div>
              <div className="dex-facts">
                <div><span>{t('레벨')}</span><b>Lv.{levelOf(picked)}{levelOf(picked) > (picked.metLevel ?? 5) ? <small> · {t('함께 +{n}', { n: levelOf(picked) - (picked.metLevel ?? 5) })}</small> : null}</b></div>
                <div><span>{t('다음 레벨까지')}</span><b>{minutesToNext(picked) !== null ? t('{n}분', { n: minutesToNext(picked)! }) : '—'}</b></div>
                <div><span>{t('위치')}</span><b>{inParty ? t('파티') : t('박스')}{isWorking ? ` · ${t('일하는 중')}` : ''}</b></div>
                <div><span>{t('성별')}</span><b>{picked.gender === 'male' ? t('수컷') : picked.gender === 'female' ? t('암컷') : picked.gender === 'none' ? t('무성') : '—'}</b></div>
                <div><span>{t('성격')}</span><b>{n ? nameOf(n) : '—'}{n ? <small>{n.up ? ` ${statName(n.up)}↑ ${statName(n.down ?? '')}↓` : ` ${t('보정 없음')}`}</small> : null}</b></div>
                <div><span>{t('걸음')}</span><b>{t('{n}걸음', { n: picked.steps })}{picked.evos ? <small> · {t('{n}번 진화', { n: picked.evos })}</small> : null}</b></div>
                <div className="wide"><span>{t('볼')}</span><b className="box-ball-dd"><PokeBall ball={picked.ball} size={16} />{ballName(picked.ball)}<small> · {BALL_TIER_LABEL[BALL_BY_ID.get(picked.ball ?? 'poke-ball')?.tier ?? 'basic']}</small></b></div>
                <div className="wide"><span>{t('만난 곳')}</span><b>{placeText(picked.place) || '—'} · {HOW[picked.how] ? t(HOW[picked.how]) : picked.how}</b></div>
                {picked.via && <div className="wide"><span>{t('포획 경위')}</span><b>{sourceText(picked.via)}</b></div>}
                <div className="wide"><span>{t('잡은 날')}</span><b>{new Date(picked.at).toLocaleDateString(locale())}</b></div>
              </div>

              {!inParty && (
                <div className="box-actions">
                  <button className="box-act" onClick={() => setChoosing(v => !v)}>{t('파티에 넣기')}</button>
                  <button className={`box-act danger${releasing ? ' confirm' : ''}`} onClick={release} onMouseLeave={() => setReleasing(false)}>
                    {releasing ? t('정말 놓아주기') : t('놓아주기')}
                  </button>
                </div>
              )}
              {choosing && (
                <div className="box-choose">
                  <div className="dex-fine">{t('누구와 바꿀까요? (일하는 포켓몬은 못 바꿔요)')}</div>
                  <div className="box-party-row">
                    {party.map(uid => {
                      const m = mons[uid]
                      if (!m) return null
                      const w = locked(uid)
                      return (
                        <button key={uid} className={`box-cell${w ? ' working' : ''}`} disabled={w} onClick={() => exchange(uid)} title={nameById(m.dex)}>
                          <img src={spriteUrl(m.dex, m.shiny)} alt="" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {inParty && <p className="dex-fine">{t('파티 포켓몬이에요. 세션을 열 때 몬스터볼로 던질 수 있어요.')}</p>}
              {note && <p className="dex-fine">{note}</p>}
            </div>
        </aside>
        )}
      </div>
    </div>
  )
}

export default BoxView
