/**
 * PartyPickers — the two "who goes?" dialogs of the widget:
 *   SwapPicker   another Pokémon for a running session: a resting party one, or a box one (they trade places)
 *   ThrowPicker  the party Pokémon a new (or resumed) session is thrown out with (a box one, as a
 *                helper, once the party is all out)
 */

import React, { useMemo, useState } from 'react'
import { iconUrl, pokemonById, spriteUrl } from '../theme'
import { freeBoxUids, genderMark, isFullyEvolved, levelOf, type DexState, type Mon } from '../pokedexStore'
import type { AiTool } from '../desktop'
import { t, nameOf } from '../i18n'

const Dialog: React.FC<{ label: string; title: React.ReactNode; onClose: () => void; children: React.ReactNode }> = ({ label, title, onClose, children }) => (
  <div className="resume-backdrop" onClick={onClose}>
    <div className="resume-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={label}>
      <div className="resume-head">
        <span>{title}</span>
        <button onClick={onClose} aria-label={t('닫기')}>×</button>
      </div>
      {children}
    </div>
  </div>
)

/** Who works now: the Pokémon some session was thrown out with */
const busyOf = (dex: DexState) => new Set(Object.values(dex.assign ?? {}))

export const SwapPicker: React.FC<{ dex: DexState; currentDex: number; helper?: boolean; onPick: (uid: string) => void; onClose: () => void }> = ({ dex, currentDex, helper = false, onPick, onClose }) => {
  const [query, setQuery] = useState('')
  // Working ones (in another session, or helping a subagent) are shown, dimmed, not hidden
  const busy = new Set([...busyOf(dex), ...Object.values(dex.helpers ?? {}).flat()])
  const party = dex.party.filter(uid => dex.mons[uid])
  const q = query.trim().toLowerCase()
  const box = useMemo(() => dex.box
    .map(uid => dex.mons[uid]).filter((m): m is Mon => !!m)
    .filter(m => !q || nameOf(pokemonById(m.dex)).toLowerCase().includes(q) || String(m.dex) === q)
    .sort((a, b) => levelOf(b) - levelOf(a) || b.at - a.at), [dex, q])
  return (
    <Dialog label={t('포켓몬 교체')} title={t('{name} 대신 보낼 포켓몬', { name: nameOf(pokemonById(currentDex)) })} onClose={onClose}>
      <div className="w-swap-section">{t('파티')}</div>
      <div className="w-swap-list">
        {party.map(uid => {
          const m = dex.mons[uid]
          const working = busy.has(uid)
          return (
            <button key={uid} className={`w-swap-item${working ? ' busy' : ''}`} disabled={working} onClick={() => onPick(uid)}>
              <img src={spriteUrl(m.dex, m.shiny)} alt="" />
              <span className="w-swap-name">{m.shiny ? '✦ ' : ''}{nameOf(pokemonById(m.dex))}{genderMark(m.gender)}</span>
              <span className="w-swap-meta">{working ? t('일하는 중') : t('쉬는 중 · Lv.{level}', { level: levelOf(m) })}{isFullyEvolved(m.dex) ? ` · ${t('최종')}` : ''}</span>
            </button>
          )
        })}
      </div>
      <div className="w-swap-section">
        <span>{t('박스')}</span>
        {/* A helper session (worked by a box Pokémon) just changes worker: nobody moves */}
        <small>{helper ? t('고르면 이 세션을 맡는 포켓몬만 바뀌어요') : t('고르면 지금 포켓몬과 자리를 바꿔요')}</small>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('이름 검색')} aria-label={t('이름 검색')} />
      </div>
      <div className="w-swap-box">
        {box.length === 0 && <div className="resume-empty">{q ? t('찾는 포켓몬이 없어요') : t('박스가 비어 있어요')}</div>}
        {box.map(m => {
          const working = busy.has(m.uid)
          const name = nameOf(pokemonById(m.dex))
          return (
            <button key={m.uid} className={`w-swap-cell${working ? ' busy' : ''}`} disabled={working} onClick={() => onPick(m.uid)}
              title={`${m.shiny ? '✦ ' : ''}${name} Lv.${levelOf(m)}${working ? ` · ${t('조력자로 일하는 중')}` : ''}`}>
              <img src={iconUrl(m.dex)} alt={name} loading="lazy" />
              <span>Lv.{levelOf(m)}</span>
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}

/**
 * The party Pokémon a new session goes out with, and (when the trainer listed
 * other AI tools in 설정 › 세션) which tool the session runs
 */
export const ThrowPicker: React.FC<{
  dex: DexState; resume: boolean
  tools?: AiTool[]; defaultTool?: string
  onPick: (uid: string, tool: string) => void; onClose: () => void
}> = ({ dex, resume, tools = [], defaultTool = 'claude', onPick, onClose }) => {
  const busy = busyOf(dex)
  const choices = [{ id: 'claude', name: 'Claude Code' }, ...tools]
  const [tool, setTool] = useState(choices.some(c => c.id === defaultTool) ? defaultTool : 'claude')
  // The party all out: a resting box Pokémon goes as a helper
  const partyOut = dex.party.every(uid => !dex.mons[uid] || busy.has(uid))
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const box = useMemo(() => partyOut ? freeBoxUids(dex)
    .map(uid => dex.mons[uid])
    .filter(m => !q || nameOf(pokemonById(m.dex)).toLowerCase().includes(q) || String(m.dex) === q)
    .sort((a, b) => levelOf(b) - levelOf(a) || b.at - a.at) : [], [dex, q, partyOut])
  return (
    <Dialog label={t('몬스터볼 던지기')} title={resume ? t('이 세션에 보낼 포켓몬') : t('누구를 보낼까요?')} onClose={onClose}>
      {resume && <div className="w-throw-hint">{t('이 세션의 포켓몬이 다른 세션에서 일하고 있어서, 대신 보낼 포켓몬을 골라주세요.')}</div>}
      {choices.length > 1 && (
        <div className="w-throw-tools" role="radiogroup" aria-label={t('AI 도구')}>
          <span>{t('AI 도구')}</span>
          {choices.map(c => (
            <button key={c.id} role="radio" aria-checked={tool === c.id} className={tool === c.id ? 'on' : ''} onClick={() => setTool(c.id)}>{c.name}</button>
          ))}
        </div>
      )}
      <div className="w-swap-list">
        {dex.party.map(uid => {
          const m = dex.mons[uid]
          if (!m) return null
          const working = busy.has(uid)
          return (
            <button key={uid} className={`w-swap-item${working ? ' busy' : ''}`} disabled={working} onClick={() => onPick(uid, tool)}>
              <img src={spriteUrl(m.dex, m.shiny)} alt="" />
              <span className="w-swap-name">{m.shiny ? '✦ ' : ''}{nameOf(pokemonById(m.dex))}</span>
              <span className="w-swap-meta">{working ? t('일하는 중') : t('쉬는 중 · {steps}걸음', { steps: m.steps })}</span>
            </button>
          )
        })}
      </div>
      {partyOut && <>
        <div className="w-swap-section">
          <span>{t('박스')}</span>
          <small>{t('파티가 모두 일하는 중이에요. 박스의 포켓몬이 조력자로 가요.')}</small>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('이름 검색')} aria-label={t('이름 검색')} />
        </div>
        <div className="w-swap-box">
          {box.length === 0 && <div className="resume-empty">{q ? t('찾는 포켓몬이 없어요') : t('박스가 비어 있어요')}</div>}
          {box.map(m => {
            const name = nameOf(pokemonById(m.dex))
            return (
              <button key={m.uid} className="w-swap-cell" onClick={() => onPick(m.uid, tool)} title={`${m.shiny ? '✦ ' : ''}${name} Lv.${levelOf(m)}`}>
                <img src={iconUrl(m.dex)} alt={name} loading="lazy" />
                <span>Lv.{levelOf(m)}</span>
              </button>
            )
          })}
        </div>
      </>}
    </Dialog>
  )
}
