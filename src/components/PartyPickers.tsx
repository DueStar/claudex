/**
 * PartyPickers — the two "who goes?" dialogs of the widget:
 *   SwapPicker   another Pokémon for a running session (party or box, not busy)
 *   ThrowPicker  the party Pokémon a new (or resumed) session is thrown out with
 */

import React from 'react'
import { pokemonById, spriteUrl } from '../theme'
import { genderMark, isFullyEvolved, type DexState } from '../pokedexStore'

const Dialog: React.FC<{ label: string; title: React.ReactNode; onClose: () => void; children: React.ReactNode }> = ({ label, title, onClose, children }) => (
  <div className="resume-backdrop" onClick={onClose}>
    <div className="resume-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={label}>
      <div className="resume-head">
        <span>{title}</span>
        <button onClick={onClose} aria-label="닫기">×</button>
      </div>
      {children}
    </div>
  </div>
)

/** Who works now: the Pokémon some session was thrown out with */
const busyOf = (dex: DexState) => new Set(Object.values(dex.assign ?? {}))

export const SwapPicker: React.FC<{ dex: DexState; currentDex: number; onPick: (uid: string) => void; onClose: () => void }> = ({ dex, currentDex, onPick, onClose }) => {
  const busy = busyOf(dex)
  // The party first, then the box, newest catch first
  const candidates = [...dex.party, ...dex.box.slice().reverse()].filter(uid => !busy.has(uid) && dex.mons[uid])
  return (
    <Dialog label="포켓몬 교체" title={`${pokemonById(currentDex)?.ko} 대신 보낼 포켓몬`} onClose={onClose}>
      <div className="w-swap-list">
        {candidates.length === 0 && <div className="resume-empty">보낼 수 있는 포켓몬이 없어요. 야생 포켓몬을 더 잡아보세요!</div>}
        {candidates.map(uid => {
          const m = dex.mons[uid]
          return (
            <button key={uid} className="w-swap-item" onClick={() => onPick(uid)}>
              <img src={spriteUrl(m.dex, m.shiny)} alt="" />
              <span className="w-swap-name">{m.shiny ? '✦ ' : ''}{pokemonById(m.dex)?.ko}{genderMark(m.gender)}</span>
              <span className="w-swap-meta">{dex.party.includes(uid) ? '파티' : '박스'} · {m.steps}걸음{isFullyEvolved(m.dex) ? ' · 최종' : ''}</span>
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}

export const ThrowPicker: React.FC<{ dex: DexState; resume: boolean; onPick: (uid: string) => void; onClose: () => void }> = ({ dex, resume, onPick, onClose }) => {
  const busy = busyOf(dex)
  return (
    <Dialog label="몬스터볼 던지기" title={resume ? '이 세션에 보낼 포켓몬' : '누구를 보낼까요?'} onClose={onClose}>
      {resume && <div className="w-throw-hint">이 세션의 포켓몬이 다른 세션에서 일하고 있어서, 대신 보낼 포켓몬을 골라주세요.</div>}
      <div className="w-swap-list">
        {dex.party.map(uid => {
          const m = dex.mons[uid]
          if (!m) return null
          const working = busy.has(uid)
          return (
            <button key={uid} className={`w-swap-item${working ? ' busy' : ''}`} disabled={working} onClick={() => onPick(uid)}>
              <img src={spriteUrl(m.dex, m.shiny)} alt="" />
              <span className="w-swap-name">{m.shiny ? '✦ ' : ''}{pokemonById(m.dex)?.ko}</span>
              <span className="w-swap-meta">{working ? '일하는 중' : `쉬는 중 · ${m.steps}걸음`}</span>
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}
