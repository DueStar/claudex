/**
 * Widget — the app. A transparent, always-on-top window: the session Pokémon
 * float freely above a bento of cards (limits, spend, launcher, party, and a
 * box to hand a Pokémon its next instruction). Expanded, the same widget grows
 * a terminal card beside it: one tab per Pokémon, the real Claude Code session.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './styles/widget.css'
import './styles/widget-expanded.css'
import './styles/pokedex.css'
import { useAgentSocket } from './hooks/useAgentSocket'
import { officeWsUrl } from './serverUrl'
import { dispatchMeters, useMeters, formatMoney, formatTokens, formatClockTime, contextTone, type SessionStatus } from './meters'
import { bridge, useTerminals, type PastSession, type TerminalInfo, type WidgetMode, type UpdateState } from './desktop'
import { assignPokemonToRole, getPokemonFor, getSpritePath, getAvatarPath, themedDisplayName, useTheme, spriteUrl, displayHeight, pokemonById } from './theme'
import { isHardNeedsYou } from './mainState'
import { dispatchCloud, useCloud } from './cloudStore'
import { dispatchPokedex, usePokedex, TIER_LABEL, freePartyCount, isFullyEvolved, genderMark, type Mon } from './pokedexStore'
import PokedexView from './components/PokedexView'
import { BoxIcon, DexIcon, FolderIcon, FullscreenIcon, PlusIcon, PokeBall, SessionsIcon, TerminalIcon, WidgetModeIcon, WindowModeIcon } from './components/Icons'
import BoxView from './components/BoxView'
import { TerminalView, ResumePicker } from './components/TerminalPanel'
import type { SessionInfo } from './types'

type Mood = 'working' | 'idle' | 'needs-you' | 'error' | 'ended'

function moodOf(s: SessionInfo | undefined, t: TerminalInfo | undefined): Mood {
  if (t?.status === 'exited' || s?.state === 'ended') return 'ended'
  const m = s?.main
  if (!m) return 'idle'
  if (m.state === 'needs-you' && isHardNeedsYou(m.needsYou)) return 'needs-you'
  if (m.state === 'error') return 'error'
  if (m.state === 'working' || m.state === 'compacting' || m.state === 'waiting') return 'working'
  return 'idle'
}

const PREREQ_LABEL = {
  claude: { name: 'Claude Code', why: '포켓몬이 일할 Claude 세션' },
  git: { name: 'Git for Windows', why: 'Claude Code와 기록 훅이 쓰는 Git Bash' },
  python: { name: 'Python 3', why: '세션 기록(훅)을 만드는 데 필요' },
} as const

const MOOD_LABEL: Record<Mood, string> = {
  working: '일하는 중', idle: '쉬는 중', 'needs-you': '확인 필요', error: '오류', ended: '종료',
}

interface Row {
  sessionId: string
  terminal?: TerminalInfo
  session?: SessionInfo
  meter?: SessionStatus
  mood: Mood
  name: string
  sprite: string
  avatar: string
  height: number
  project: string
  /** The trainer's name for the session */
  title: string | null
}

function pct(n: number | null | undefined): string {
  return typeof n === 'number' ? String(Math.round(n)) : '—'
}

/** A big-number card: label, value, unit, an optional bar and footnote */
const Stat: React.FC<{ label: string; value: string; unit?: string; bar?: number | null; foot?: string; tone?: string }> = ({ label, value, unit, bar, foot, tone = 'ok' }) => (
  <section className={`w-card w-stat tone-${tone}`}>
    <div className="w-label">{label}</div>
    <div className="w-value">{value}{unit && <span className="w-unit">{unit}</span>}</div>
    {typeof bar === 'number' && (
      <div className="w-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.min(100, bar))}%` }} /></div>
    )}
    {foot && <div className="w-foot">{foot}</div>}
  </section>
)

/** One limit row: label, bar, percent, when it resets */
const Limit: React.FC<{ label: string; value: number | null | undefined; reset: string | null }> = ({ label, value, reset }) => (
  <div className={`w-limit tone-${contextTone(value)}`}>
    <span className="w-label">{label}</span>
    <div className="w-bar" aria-hidden="true"><span style={{ width: `${typeof value === 'number' ? Math.max(2, Math.min(100, value)) : 0}%` }} /></div>
    <span className="w-limit-pct">{pct(value)}<small>%</small></span>
    <span className="w-limit-reset" title="리셋 시각">{reset ? `↻ ${reset}` : ''}</span>
  </div>
)

/** Bottom-right grip: a transparent window has no resizable frame on Windows */
const ResizeGrip: React.FC = () => {
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    start.current = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight }
  }
  const onMove = (e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    bridge?.widget.resize(s.w + (e.screenX - s.x), s.h + (e.screenY - s.y))
  }
  const onUp = () => { start.current = null }
  return <div className="w-grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} title="크기 조절" aria-hidden="true" />
}

const Widget: React.FC = () => {
  useTheme()
  const meters = useMeters()
  const terminals = useTerminals()
  const onEvent = useCallback((e: Parameters<typeof dispatchMeters>[0]) => { dispatchMeters(e); dispatchPokedex(e as never); dispatchCloud(e as never) }, [])
  const { sessions, connected } = useAgentSocket({ onEvent, url: officeWsUrl() })

  const [update, setUpdate] = useState<UpdateState | null>(null)
  useEffect(() => {
    bridge?.update.get().then(setUpdate).catch(() => {})
    return bridge?.update.onState(setUpdate)
  }, [])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [mode, setModeState] = useState<WidgetMode>('widget')
  const expanded = mode !== 'widget'
  const [view, setView] = useState<'terminal' | 'dex' | 'box'>('terminal')
  const { state: dex, lastEvent } = usePokedex()
  // Catches, evolutions and rare escapes pop up above every window (the ?toast window)
  useEffect(() => {
    if (!lastEvent || !bridge) return
    const rareFlee = lastEvent.kind === 'flee' && (lastEvent.tier === 'sub' || lastEvent.tier === 'legendary' || lastEvent.tier === 'mythical')
    if (lastEvent.kind === 'catch' || lastEvent.kind === 'evolve' || rareFlee) bridge.toast.show(lastEvent)
  }, [lastEvent])
  useEffect(() => {
    bridge?.widget.getMode().then(setModeState).catch(() => {})
    return bridge?.widget.onMode((m) => setModeState(m))
  }, [])
  const setMode = (m: WidgetMode) => {
    setModeState(m)
    bridge?.widget.setMode(m)
  }
  // Opening a terminal or the dex widens the widget; an open window stays as it is
  const setExpanded = (flag: boolean) => {
    if (flag && expanded) return
    setMode(flag ? 'window' : 'widget')
  }

  const rows: Row[] = useMemo(() => {
    const ids = new Set<string>()
    for (const t of terminals) ids.add(t.sessionId)
    // Only the sessions this app runs: one left over from a closed app has no terminal to talk to
    return [...ids].map((sessionId) => {
      const terminal = terminals.find(t => t.sessionId === sessionId)
      const session = sessions.find(s => s.id === sessionId)
      const meter = meters.sessions.find(m => m.sessionId === sessionId)
      const agentId = `main-${sessionId}`
      return {
        sessionId, terminal, session, meter,
        mood: moodOf(session, terminal),
        name: themedDisplayName('assistant', 'Claude', agentId),
        title: terminal?.title ?? null,
        sprite: getSpritePath(agentId, 'assistant'),
        avatar: getAvatarPath('assistant', agentId),
        height: displayHeight(getPokemonFor('assistant', agentId)),
        project: terminal?.project ?? session?.project ?? meter?.project ?? '',
      }
    }).filter(r => r.mood !== 'ended' || r.terminal)
  }, [terminals, sessions, meters])

  const sendable = rows.filter(r => r.terminal && r.terminal.status === 'running')
  const withTerminal = rows.filter(r => r.terminal)
  const [target, setTarget] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [closing, setClosing] = useState<string | null>(null)
  const [swapFor, setSwapFor] = useState<string | null>(null)
  const cloud = useCloud()
  const [accountOpen, setAccountOpen] = useState(false)
  const signIn = async () => {
    const r = await bridge?.cloud.signIn()
    setNote(r?.ok ? '브라우저에서 구글 로그인을 마치면 여기로 돌아와요.' : `로그인을 시작하지 못했어요 (${r?.reason ?? '앱에서만 가능'})`)
  }
  // What a session needs on this PC (electron/prereqs.cjs): Claude Code, Git, Python
  type Prereqs = Awaited<ReturnType<NonNullable<typeof bridge>['env']['check']>>
  const [prereqs, setPrereqs] = useState<Prereqs | null>(null)
  const [checking, setChecking] = useState(false)
  const recheck = useCallback(async () => {
    if (!bridge) return
    setChecking(true)
    try { setPrereqs(await bridge.env.check()) } finally { setChecking(false) }
  }, [])
  useEffect(() => { recheck() }, [recheck])
  const missing = prereqs ? (Object.entries(prereqs) as [keyof Prereqs, Prereqs[keyof Prereqs]][]).filter(([, v]) => !v.ok) : []
  const monOf = (sessionId: string): Mon | undefined => {
    const uid = dex?.assign?.[sessionId]
    return uid ? dex?.mons?.[uid] : undefined
  }
  const partyFull = freePartyCount(dex) <= 0
  const FULL_NOTE = `파티의 포켓몬 ${dex?.partySize ?? 6}마리가 모두 일하고 있어서 새 세션을 열 수 없어요. 세션 하나를 닫으면 그 포켓몬이 돌아와요.`
  const chosen = sendable.find(r => r.sessionId === target) ?? sendable[0]
  const shown = withTerminal.find(r => r.sessionId === target) ?? chosen ?? withTerminal[0]

  // A new terminal (opened here, or from the office) becomes the one in front
  const lastCount = useRef(terminals.length)
  useEffect(() => {
    if (terminals.length > lastCount.current) setTarget(terminals[terminals.length - 1].sessionId)
    lastCount.current = terminals.length
  }, [terminals])

  const limitOf = (k: 'fiveHour' | 'sevenDay') => meters.sessions.map(m => m.rateLimits?.[k]).find(v => typeof v === 'number')
  const resetOf = (k: 'fiveHourResetsAt' | 'sevenDayResetsAt') => meters.sessions.map(m => m.rateLimits?.[k]).find(v => typeof v === 'number')
  const fiveHour = limitOf('fiveHour')
  const sevenDay = limitOf('sevenDay')
  const fiveReset = resetOf('fiveHourResetsAt')
  const sevenReset = resetOf('sevenDayResetsAt')
  const totals = meters.totals

  /** Where the next throw goes: a new session (optionally in a picked folder) or a resumed one */
  const [throwing, setThrowing] = useState<{ cwd?: string; resume?: PastSession } | null>(null)
  const busyUids = new Set(Object.values(dex?.assign ?? {}))

  const launch = async (pick: boolean) => {
    if (!bridge) return
    if (missing.length) { setNote('먼저 위의 준비 카드에서 필요한 프로그램을 설치해주세요.'); return }
    if (partyFull) { setNote(FULL_NOTE); return }
    let cwd: string | undefined
    if (pick) {
      const chosenDir = await bridge.terminals.pickFolder()
      if (!chosenDir) return
      cwd = chosenDir
    }
    setThrowing({ cwd })
  }

  /** The chosen party Pokémon goes out with a new (or resumed) session */
  const throwBall = async (uid: string, where: { cwd?: string; resume?: PastSession }) => {
    setThrowing(null)
    if (!bridge) return
    // Dress the session in its Pokémon first: the tab must never show a bare Poké Ball
    const sessionId = where.resume?.id ?? crypto.randomUUID()
    const mon = dex?.mons?.[uid]
    if (mon) assignPokemonToRole(`session:${sessionId}`, mon.dex, mon.shiny)
    const r = await bridge.terminals.create(where.resume ? { cwd: where.resume.cwd, resume: where.resume.id } : { sessionId, ...(where.cwd ? { cwd: where.cwd } : {}) })
    if ('error' in r) { setNote(`세션을 열 수 없어요: ${r.error}`); return }
    const t = await bridge.game.throw(r.sessionId, uid)
    if (!t.ok) setNote(`포켓몬을 보내지 못했어요 (${t.reason ?? '알 수 없음'})`)
    else if (!where.resume) setNote('가랏! 처음 여는 폴더면 터미널에서 신뢰 확인을 해주세요.')
    setTarget(r.sessionId)
    if (where.resume) { setView('terminal'); setExpanded(true) }
  }

  const resume = async (past: PastSession) => {
    setPicking(false)
    if (!bridge) return
    if (partyFull) { setNote(FULL_NOTE); return }
    // The Pokémon that worked this session comes back with it, if it is resting in the party
    const remembered = dex?.remembered?.[past.id]
    if (remembered && dex?.party.includes(remembered) && !busyUids.has(remembered)) { await throwBall(remembered, { resume: past }); return }
    setThrowing({ resume: past })
  }

  const closeSession = (r: Row) => {
    if (!r.terminal) return
    if (closing !== r.sessionId) { setClosing(r.sessionId); return }
    setClosing(null)
    bridge?.terminals.close(r.terminal.id)
  }

  const send = async () => {
    if (!bridge || !chosen?.terminal || !text.trim()) return
    if (chosen.mood === 'needs-you') {
      setNote(`${chosen.name}이(가) 확인을 기다려요. 펼쳐서 터미널에서 답해주세요.`)
      return
    }
    const r = await bridge.terminals.send(chosen.terminal.id, text)
    if (r.ok) {
      setNote(`${chosen.name}에게 보냈어요${chosen.mood === 'working' ? ' · 지금 일이 끝나면 이어서 해요' : ''}`)
      setText('')
    } else setNote(`보내지 못했어요 (${r.reason ?? '알 수 없음'})`)
  }

  const openIds = new Set(terminals.filter(t => t.status === 'running').map(t => t.sessionId))

  const doSwap = async (sessionId: string, uid: string) => {
    setSwapFor(null)
    if (!bridge) return
    const r = await bridge.game.swap(sessionId, uid)
    if (!r.ok) setNote(`교체하지 못했어요 (${r.reason ?? '알 수 없음'})`)
  }

  return (
    <div className={`widget${expanded ? ' expanded' : ''} mode-${mode}`}>
      <div className="w-side">
        <div className="w-bento">
          <header className="w-card w-head">
            <PokeBall size={18} />
            <span className="w-brand">Claudex</span>
            <span className={`w-conn${connected ? '' : ' off'}`} title={connected ? '연결됨' : '서버 연결 끊김'} />
            {cloud?.enabled && (cloud.user ? (
              <button className="w-account" onClick={() => setAccountOpen(!accountOpen)} title={`${cloud.user.email ?? ''}${cloud.lastSyncAt ? ` · ${new Date(cloud.lastSyncAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 동기화` : ''}`}>
                {cloud.user.avatar ? <img src={cloud.user.avatar} alt="" referrerPolicy="no-referrer" /> : <span>{(cloud.user.name ?? cloud.user.email ?? '?').slice(0, 1)}</span>}
              </button>
            ) : (
              <button className="w-signin" onClick={signIn} title="구글로 로그인하면 도감이 클라우드에 저장돼요">로그인</button>
            ))}
            {update && (update.status === 'available' || update.status === 'downloading' || update.status === 'ready') && (
              <button
                className={`w-update ${update.status}`}
                disabled={update.status === 'downloading'}
                title={`${update.current} → ${update.latest}${update.notes ? `

${update.notes}` : ''}${update.error ? `

오류: ${update.error}` : ''}`}
                onClick={() => {
                  if (update.needsFull) bridge?.env.openLink('release')
                  else if (update.status === 'available') bridge?.update.install()
                  else if (update.status === 'ready') bridge?.update.restart()
                }}
              >
                {update.status === 'downloading' ? `받는 중 ${Math.round(update.progress * 100)}%`
                  : update.status === 'ready' ? '재시작해서 적용'
                  : update.needsFull ? '새 버전 받기' : '업데이트'}
              </button>
            )}
            {!expanded && (
              <button className="w-icon" onClick={() => setMode('window')} title="창 모드로 펼쳐서 터미널 보기" aria-label="펼치기">⇤</button>
            )}
            <button className="w-icon" onClick={() => bridge?.widget.hide()} title="숨기기 (작업 표시줄 트레이의 몬스터볼을 누르면 다시 열려요)" aria-label="숨기기">–</button>
          </header>

          {accountOpen && cloud?.user && (
            <section className="w-card w-account-card">
              <div className="w-account-who">
                <b>{cloud.user.name ?? '트레이너'}</b>
                <span>{cloud.user.email}</span>
              </div>
              <div className="w-account-sync">
                {cloud.error ? <span className="tone-warn">{cloud.error}</span>
                  : cloud.lastSyncAt ? <>클라우드에 저장됨 · {new Date(cloud.lastSyncAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                  : '아직 저장 전이에요'}
              </div>
              <div className="w-account-actions">
                <button onClick={() => bridge?.cloud.sync()}>지금 저장</button>
                <button onClick={() => { setAccountOpen(false); bridge?.cloud.signOut() }}>로그아웃</button>
              </div>
            </section>
          )}
          {cloud?.error && !cloud.user && <div className="w-card w-note-card">{cloud.error}</div>}

          {missing.length > 0 && (
            <section className="w-card w-setup" role="alert">
              <div className="w-setup-title">시작하기 전에 설치가 필요해요</div>
              <p className="w-setup-desc">세션을 열려면 아래 프로그램이 필요해요. 설치한 뒤 <b>다시 확인</b>을 눌러주세요.</p>
              {missing.map(([key]) => (
                <div key={key} className="w-setup-row">
                  <span className="w-setup-name">{PREREQ_LABEL[key].name}</span>
                  <span className="w-setup-why">{PREREQ_LABEL[key].why}</span>
                  <button className="w-setup-go" onClick={() => bridge?.env.openLink(key)}>설치 페이지</button>
                </div>
              ))}
              <button className="w-setup-again" onClick={recheck} disabled={checking}>{checking ? '확인 중…' : '다시 확인'}</button>
            </section>
          )}

          {/* The subscription's two limits: the only numbers that decide whether work can go on */}
          <section className="w-card w-limits">
            <Limit label="5시간" value={fiveHour} reset={fiveReset ? formatClockTime(fiveReset) : null} />
            <Limit label="주간" value={sevenDay}
              reset={sevenReset ? `${new Date(sevenReset * 1000).getMonth() + 1}/${new Date(sevenReset * 1000).getDate()} ${formatClockTime(sevenReset)}` : null} />
          </section>

          <section className="w-card w-launch">
            <button className={`w-launch-main${partyFull ? ' full' : ''}`} onClick={() => launch(false)} title={partyFull ? '파티의 포켓몬이 모두 일하는 중' : '문서 폴더에서 새 Claude 세션'}>
              <PokeBall size={18} /> New session
            </button>
            <button className="w-launch-alt" onClick={() => launch(true)} title="다른 폴더에서 새 세션" aria-label="다른 폴더에서 새 세션"><FolderIcon /></button>
            <button className="w-launch-alt" onClick={() => setPicking(true)} title="예전 세션 골라서 이어하기" aria-label="예전 세션 이어하기"><SessionsIcon /></button>
          </section>

          <button className="w-card w-dex" onClick={() => { setView('dex'); setExpanded(true) }} title="도감 열기">
            <span className="w-label">도감</span>
            <span className="w-dex-count"><b>{dex ? Object.keys(dex.caught).length : 0}</b><span> / {dex?.total ?? 1025}</span>
              <span className={`w-dex-box${dex && dex.box.length >= (dex.boxLimit ?? 1200) ? ' full' : ''}`}>박스 {dex?.box.length ?? 0}/{dex?.boxLimit ?? 1200}</span></span>
            <span className="w-dex-recent">
              {(dex?.log ?? []).filter(e => e.kind === 'catch').slice(-6).reverse().map((e, i) => (
                <img key={`${e.at}-${i}`} src={spriteUrl(e.id, !!e.shiny)} alt={e.name} title={e.name} />
              ))}
            </span>
            <span className="w-dex-pity" title="전설·환상 천장: 이만큼 만나면 다음은 확정">전설 {dex?.sinceLegend ?? 0}/{dex?.pity ?? 150}<br />환상 {dex?.sinceMythical ?? 0}/{dex?.pityMythical ?? 300}</span>
          </button>

          <section className="w-card w-party">
            <div className="w-party-head">
              <span className="w-label">파티</span>
              <span className="w-party-slots" title="파티 6마리: 일하는 포켓몬은 세션에 나가 있어요">
                {(dex?.party ?? []).map(uid => {
                  const m = dex?.mons?.[uid]
                  const out = Object.values(dex?.assign ?? {}).includes(uid)
                  return m ? <img key={uid} src={spriteUrl(m.dex, m.shiny)} alt={pokemonById(m.dex)?.ko} title={`${pokemonById(m.dex)?.ko}${out ? ' · 일하는 중' : ' · 쉬는 중'}`} className={out ? 'out' : ''} /> : null
                })}
              </span>
              <span className="w-party-free">{dex ? `${freePartyCount(dex)}마리 대기` : ''}</span>
            </div>
            {rows.length === 0 && <div className="w-empty">몬스터볼을 던지면 여기 나타나요</div>}
            {rows.map(r => (
              <div
                key={r.sessionId}
                className={`w-row mood-${r.mood}${shown?.sessionId === r.sessionId ? ' chosen' : ''}`}
                onClick={() => { if (!r.terminal) return; setTarget(r.sessionId); if (expanded) setView('terminal') }}
                title={r.terminal ? '눌러서 이 세션 열기' : undefined}
              >
                <div className="w-row-top">
                  <img className="w-row-mon" src={r.sprite} alt="" />
                  {renaming === r.sessionId ? (
                    <input
                      className="w-row-rename"
                      autoFocus
                      defaultValue={r.title ?? ''}
                      placeholder={`${r.name} · ${r.project}`}
                      maxLength={40}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) { bridge?.terminals.rename(r.terminal!.id, e.currentTarget.value); setRenaming(null) }
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={e => { bridge?.terminals.rename(r.terminal!.id, e.currentTarget.value); setRenaming(null) }}
                    />
                  ) : (
                    <span
                      className="w-row-label"
                      title={r.terminal ? '더블클릭해서 세션 이름 바꾸기' : undefined}
                      onDoubleClick={e => { if (!r.terminal) return; e.stopPropagation(); setRenaming(r.sessionId) }}
                    >
                      {r.title ? (
                        <><span className="w-row-name">{r.title}</span><span className="w-row-project">{r.name}</span></>
                      ) : (
                        <><span className="w-row-name">{r.name}</span><span className="w-row-project">{r.project}</span></>
                      )}
                    </span>
                  )}
                  {r.terminal && renaming !== r.sessionId && (
                    <button className="w-row-edit" onClick={e => { e.stopPropagation(); setRenaming(r.sessionId) }} title="세션 이름 바꾸기" aria-label="세션 이름 바꾸기">✎</button>
                  )}
                  {r.mood === 'needs-you' && r.terminal ? (
                    <button className="w-pill mood-needs-you as-button" onClick={e => { e.stopPropagation(); setTarget(r.sessionId); setView('terminal'); setExpanded(true) }}>확인하러 가기</button>
                  ) : (
                    <span className={`w-pill mood-${r.mood}`}>{MOOD_LABEL[r.mood]}</span>
                  )}
                  {(() => {
                    const m = monOf(r.sessionId)
                    return m ? (
                      <button className="w-row-swap" onClick={e => { e.stopPropagation(); setSwapFor(r.sessionId) }} title="이 세션에서 일할 포켓몬을 바꿔요 (잡은 포켓몬 중에서)">교체</button>
                    ) : null
                  })()}
                  {r.terminal && (
                    <button
                      className={`w-row-close${closing === r.sessionId ? ' confirm' : ''}`}
                      onClick={e => { e.stopPropagation(); closeSession(r) }}
                      onMouseLeave={() => closing === r.sessionId && setClosing(null)}
                      title={closing === r.sessionId ? '한 번 더 누르면 세션을 닫아요' : '세션 닫기'}
                    >{closing === r.sessionId ? '닫기?' : '×'}</button>
                  )}
                </div>
                <div className="w-row-bottom">
                  <div className={`w-ctx tone-${contextTone(r.meter?.context.used)}`} title="컨텍스트 사용량">
                    <span style={{ width: `${Math.min(100, r.meter?.context.used ?? 0)}%` }} />
                  </div>
                  <span className="w-row-num">{typeof r.meter?.context.used === 'number' ? `${pct(r.meter.context.used)}%` : '—'}</span>
                </div>
              </div>
            ))}
          </section>

          <section className="w-card w-compose">
            <div className="w-input">
              <textarea
                value={text}
                placeholder={chosen ? `${chosen.title ?? chosen.name}에게 지시하기…` : '새 세션을 열면 지시할 수 있어요'}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
                }}
                disabled={!chosen}
                rows={2}
              />
              <button className="w-send" onClick={send} disabled={!chosen || !text.trim()} aria-label="보내기">보내기</button>
            </div>
            {note && <div className="w-note" onClick={() => setNote(null)}>{note}</div>}
          </section>
        </div>
      </div>

      {expanded && (
        <section className="w-card w-term">
          <div className="w-term-tabs" role="tablist">
            <div className="w-view-switch">
              <button className={view === 'terminal' ? 'on' : ''} onClick={() => setView('terminal')}><TerminalIcon size={14} />터미널</button>
              <button className={view === 'dex' ? 'on' : ''} onClick={() => setView('dex')}><DexIcon size={14} />도감</button>
              <button className={view === 'box' ? 'on' : ''} onClick={() => setView('box')}><BoxIcon size={14} />박스</button>
            </div>
            {view === 'terminal' && withTerminal.map(r => (
              <button
                key={r.sessionId}
                role="tab"
                aria-selected={shown?.sessionId === r.sessionId}
                className={`w-term-tab mood-${r.mood}${shown?.sessionId === r.sessionId ? ' on' : ''}`}
                onClick={() => setTarget(r.sessionId)}
                title={r.terminal?.cwd}
              >
                <img src={r.avatar} alt="" />
                <span className="w-term-tab-name" onDoubleClick={() => r.terminal && setRenaming(r.sessionId)}>{r.title ?? r.name}</span>
                <span className="w-term-tab-project">{r.title ? r.name : r.project}</span>
                <span className="w-term-tab-dot" />
              </button>
            ))}
            <span className="w-term-spacer" />
            <div className="w-view-switch w-mode-switch" role="group" aria-label="화면 모드">
              <button className="icon-only" onClick={() => setMode('widget')} title="위젯 (작게, 항상 위)" aria-label="위젯"><WidgetModeIcon /></button>
              <button className={`icon-only${mode === 'window' ? ' on' : ''}`} onClick={() => setMode('window')} title="창 모드" aria-label="창 모드"><WindowModeIcon /></button>
              <button className={`icon-only${mode === 'fullscreen' ? ' on' : ''}`} onClick={() => setMode('fullscreen')} title="전체화면" aria-label="전체화면"><FullscreenIcon /></button>
            </div>
            {view === 'terminal' && <button className="w-icon" onClick={() => launch(false)} title="새 세션 (문서 폴더)" aria-label="새 세션"><PlusIcon size={14} /></button>}
          </div>
          {view === 'dex' && <div className="w-dex-body"><PokedexView /></div>}
          {view === 'box' && <div className="w-dex-body"><BoxView /></div>}
          <div className="w-term-body" style={{ display: view === 'terminal' ? undefined : 'none' }}>
            {withTerminal.length === 0 && (
              <div className="w-term-empty">
                <p>아직 터미널이 없어요</p>
                <button className="w-launch-main" onClick={() => launch(false)}><PokeBall size={18} /> New session</button>
                <button className="w-launch-alt wide" onClick={() => setPicking(true)}><SessionsIcon /> 예전 세션 이어하기</button>
              </div>
            )}
            {withTerminal.map(r => r.terminal && (
              <TerminalView key={r.terminal.id} term={r.terminal} active={view === 'terminal' && shown?.sessionId === r.sessionId} />
            ))}
          </div>
        </section>
      )}

      {swapFor && dex && (
        <div className="resume-backdrop" onClick={() => setSwapFor(null)}>
          <div className="resume-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="포켓몬 교체">
            <div className="resume-head">
              <span>{pokemonById(monOf(swapFor)?.dex ?? 0)?.ko} 대신 보낼 포켓몬</span>
              <button onClick={() => setSwapFor(null)} aria-label="닫기">×</button>
            </div>
            <div className="w-swap-list">
              {(() => {
                const busy = new Set(Object.values(dex.assign ?? {}))
                const candidates = [...dex.party, ...dex.box.slice().reverse()].filter(uid => !busy.has(uid) && dex.mons[uid])
                if (candidates.length === 0) return <div className="resume-empty">보낼 수 있는 포켓몬이 없어요. 야생 포켓몬을 더 잡아보세요!</div>
                return candidates.map(uid => {
                  const m = dex.mons[uid]
                  const sp = pokemonById(m.dex)
                  return (
                    <button key={uid} className="w-swap-item" onClick={() => doSwap(swapFor, uid)}>
                      <img src={spriteUrl(m.dex, m.shiny)} alt="" />
                      <span className="w-swap-name">{m.shiny ? '✦ ' : ''}{sp?.ko}{genderMark(m.gender)}</span>
                      <span className="w-swap-meta">{dex.party.includes(uid) ? '파티' : '박스'} · {m.steps}걸음{isFullyEvolved(m.dex) ? ' · 최종' : ''}</span>
                    </button>
                  )
                })
              })()}
            </div>
          </div>
        </div>
      )}
      {picking && <ResumePicker onPick={resume} onClose={() => setPicking(false)} openIds={openIds}
        monFor={(sid) => { const uid = dex?.remembered?.[sid]; const m = uid ? dex?.mons?.[uid] : undefined; return m ? { src: spriteUrl(m.dex, m.shiny), name: pokemonById(m.dex)?.ko ?? '' } : null }} />}
      {throwing && dex && (
        <div className="resume-backdrop" onClick={() => setThrowing(null)}>
          <div className="resume-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="몬스터볼 던지기">
            <div className="resume-head">
              <span>{throwing.resume ? '이 세션에 보낼 포켓몬' : '누구를 보낼까요?'}</span>
              <button onClick={() => setThrowing(null)} aria-label="닫기">×</button>
            </div>
            {throwing.resume && <div className="w-throw-hint">이 세션의 포켓몬이 다른 세션에서 일하고 있어서, 대신 보낼 포켓몬을 골라주세요.</div>}
            <div className="w-swap-list">
              {dex.party.map(uid => {
                const m = dex.mons[uid]
                if (!m) return null
                const busy = busyUids.has(uid)
                return (
                  <button key={uid} className={`w-swap-item${busy ? ' busy' : ''}`} disabled={busy} onClick={() => throwBall(uid, throwing)}>
                    <img src={spriteUrl(m.dex, m.shiny)} alt="" />
                    <span className="w-swap-name">{m.shiny ? '✦ ' : ''}{pokemonById(m.dex)?.ko}</span>
                    <span className="w-swap-meta">{busy ? '일하는 중' : `쉬는 중 · ${m.steps}걸음`}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {mode !== 'fullscreen' && <ResizeGrip />}
    </div>
  )
}

export default Widget
