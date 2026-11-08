/**
 * LeaderboardView — 랭킹: trainers who chose to be public, by nickname.
 * The numbers are worked out in the database from the game each PC uploads
 * (supabase/leaderboard.sql); this page only asks for a board and shows it.
 * Joining needs a sign-in, a nickname and a partner (the icon beside it).
 */

import React, { useCallback, useEffect, useState } from 'react'
import { bridge, type BoardKind, type BoardProfile, type BoardRow } from '../desktop'
import { useCloud } from '../cloudStore'
import { usePokedex } from '../pokedexStore'
import { iconUrl, pokemonById } from '../theme'
import { t, locale, nameOf, josa } from '../i18n'

const BOARDS: { key: BoardKind; label: string; unit: string; note: string }[] = [
  { key: 'week', label: '이번 주 포획', unit: '마리', note: '매주 월요일 0시(한국 시간)에 새로 시작해요' },
  { key: 'caught', label: '도감', unit: '종', note: '도감에 등록한 종 수' },
  { key: 'shiny', label: '색이 다른 포켓몬', unit: '마리', note: '가지고 있는 색이 다른 포켓몬 수' },
  { key: 'legends', label: '전설·환상', unit: '종', note: '도감에 등록한 전설·환상 포켓몬 수' },
]

const REASON: Record<string, string> = {
  'not-set-up': '리더보드를 준비하고 있어요. 조금 뒤에 다시 와 주세요.',
  'not-configured': '이 버전에서는 리더보드를 쓸 수 없어요.',
  'bad-nickname': '닉네임은 한글·일본어·영문·숫자·_로 2~12자예요.',
  taken: '이미 누가 쓰는 닉네임이에요.',
  'no-game': '도감을 아직 동기화하지 못했어요. 잠시 뒤에 다시 해 주세요.',
  'signed-out': '로그인이 필요해요.',
}
const reasonText = (r?: string) => (r && REASON[r] ? t(REASON[r]) : t('잠시 뒤에 다시 해 주세요 ({reason})', { reason: r ?? t('알 수 없음') }))

/** The nickname in bold inside a translated sentence ({name}) */
function withNick(text: string, name: string): React.ReactNode {
  const [before, after = ''] = text.split('{name}')
  return <>{before}<b>{name}</b>{after}</>
}

const LeaderboardView: React.FC = () => {
  const cloud = useCloud()
  const { state } = usePokedex()
  const [board, setBoard] = useState<BoardKind>('week')
  const [rows, setRows] = useState<BoardRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<BoardProfile | null>(null)
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [partner, setPartner] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const signedIn = !!cloud?.user

  const loadBoard = useCallback(async (b: BoardKind) => {
    if (!bridge?.board) return
    const r = await bridge.board.get(b)
    if (r.ok) { setRows(r.rows ?? []); setError(null) } else { setRows(null); setError(reasonText(r.reason)) }
  }, [])
  const loadProfile = useCallback(async () => {
    if (!bridge?.board || !signedIn) { setProfile(null); return }
    const r = await bridge.board.profile()
    setProfile(r.ok ? r.profile ?? null : null)
  }, [signedIn])

  useEffect(() => { loadBoard(board) }, [board, loadBoard, signedIn])
  useEffect(() => { loadProfile() }, [loadProfile])

  // The partner to suggest: the one already chosen, else the party's first
  const partyDex = (state?.party ?? []).map(uid => state?.mons[uid]?.dex).filter((d): d is number => !!d)
  const startEdit = () => {
    setNickname(profile?.nickname ?? '')
    setPartner(profile?.partner ?? partyDex[0] ?? null)
    setNote(null)
    setEditing(true)
  }
  const save = async (isPublic: boolean) => {
    if (!bridge?.board) return
    setBusy(true)
    const r = await bridge.board.setProfile({ nickname: isPublic ? nickname.trim() : (profile?.nickname ?? ''), isPublic, partner: partner ?? profile?.partner ?? null })
    setBusy(false)
    if (!r.ok) { setNote(reasonText(r.reason)); return }
    setEditing(false)
    setNote(isPublic ? null : t('리더보드에서 빠졌어요. 언제든 다시 참여할 수 있어요.'))
    await Promise.all([loadProfile(), loadBoard(board)])
  }

  const meta = BOARDS.find(b => b.key === board)!
  const joined = !!profile?.isPublic

  return (
    <div className="rank">
      <div className="rank-top">
        <div className="dex-seg rank-boards" role="tablist" aria-label={t('랭킹 종류')}>
          {BOARDS.map(b => <button key={b.key} role="tab" aria-selected={board === b.key} className={board === b.key ? 'on' : ''} onClick={() => setBoard(b.key)}>{t(b.label)}</button>)}
        </div>
        <span className="rank-note">{t(meta.note)} · {t('순위는 1시간마다 새로 고쳐져요')}</span>
      </div>

      {/* Me: sign in, join (nickname + partner), or my entry */}
      <div className="rank-me">
        {!cloud?.enabled ? <span className="rank-me-text">{t('이 버전에서는 리더보드를 쓸 수 없어요.')}</span>
          : !signedIn ? <>
            <span className="rank-me-text">{t('로그인하면 닉네임으로 랭킹에 참여할 수 있어요. 보기는 누구나 할 수 있어요.')}</span>
            <button className="set-btn" onClick={() => bridge?.cloud.signIn()}>{t('Google로 로그인')}</button>
          </>
          : editing ? <div className="rank-form">
            <label className="rank-field">
              <span>{t('닉네임')}</span>
              <input value={nickname} maxLength={12} onChange={e => setNickname(e.target.value)} placeholder={t('2~12자')} autoFocus />
            </label>
            <div className="rank-field">
              <span>{t('대표 포켓몬')}</span>
              <div className="rank-partners">
                {partyDex.map((d, i) => (
                  <button key={`${d}-${i}`} className={partner === d ? 'on' : ''} onClick={() => setPartner(d)} title={nameOf(pokemonById(d))}><img src={iconUrl(d)} alt={nameOf(pokemonById(d))} /></button>
                ))}
              </div>
            </div>
            <p className="rank-fine">{t('Google 계정의 이름과 이메일은 공개되지 않아요. 닉네임, 대표 포켓몬, 숫자만 공개돼요.')}</p>
            <div className="rank-actions">
              <button className="set-btn ghost" onClick={() => setEditing(false)}>{t('취소')}</button>
              <button className="set-btn primary" disabled={busy} onClick={() => save(true)}>{joined ? t('저장') : t('참여하기')}</button>
            </div>
          </div>
          : joined ? <>
            {profile?.partner ? <img className="rank-me-icon" src={iconUrl(profile.partner)} alt="" /> : null}
            <span className="rank-me-text">{withNick(t('{name}{ro} 참여 중', { ro: josa(profile?.nickname ?? '', '으로') }), profile?.nickname ?? '')}{profile?.flagged ? ` · ${t('숫자를 확인하는 중이라 지금은 순위에 안 보여요')}` : ''}</span>
            <button className="set-btn ghost" onClick={startEdit}>{t('수정')}</button>
            <button className="set-btn ghost" disabled={busy} onClick={() => save(false)}>{t('그만두기')}</button>
          </>
          : <>
            <span className="rank-me-text">{t('닉네임을 정하고 랭킹에 참여해 보세요.')}</span>
            <button className="set-btn primary" onClick={startEdit}>{t('참여하기')}</button>
          </>}
      </div>
      {note && <p className="rank-msg">{note}</p>}

      <div className="rank-list">
        {error ? <div className="dex-empty">{error}</div>
          : !rows ? <div className="dex-empty">{t('불러오는 중…')}</div>
          : rows.length === 0 ? <div className="dex-empty">{t('아직 참여한 트레이너가 없어요. 첫 번째가 되어 보세요!')}</div>
          : rows.map((r, i) => (
            <React.Fragment key={`${r.place}-${r.nickname}`}>
              {/* the caller's place below the top 100: a gap first */}
              {i > 0 && r.rn > rows[i - 1].rn + 1 && <div className="rank-gap">⋯</div>}
              <div className={`rank-row${r.me ? ' me' : ''}${r.place <= 3 ? ` top${r.place}` : ''}`}>
                <span className="rank-place">{r.place}</span>
                {r.partner ? <img src={iconUrl(r.partner)} alt="" /> : <span className="rank-noicon" />}
                <span className="rank-name">{r.nickname}{r.me && <small>{t('나')}</small>}</span>
                <span className="rank-value"><b>{r.value.toLocaleString(locale())}</b>{t(meta.unit)}</span>
              </div>
            </React.Fragment>
          ))}
      </div>
    </div>
  )
}

export default LeaderboardView
