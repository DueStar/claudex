/**
 * PartyPickers — the two "who goes?" dialogs of the widget:
 *   SwapPicker   another party Pokémon for a running session (one that is resting)
 *   ThrowPicker  the party Pokémon a new (or resumed) session is thrown out with
 */

import React from 'react'
import { pokemonById, spriteUrl } from '../theme'
import { genderMark, isFullyEvolved, type DexState } from '../pokedexStore'
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

export const SwapPicker: React.FC<{ dex: DexState; currentDex: number; onPick: (uid: string) => void; onClose: () => void }> = ({ dex, currentDex, onPick, onClose }) => {
  const busy = busyOf(dex)
  // Only the party: a box Pokémon comes into the party first (in the box, or by dragging it onto a party slot)
  const candidates = dex.party.filter(uid => !busy.has(uid) && dex.mons[uid])
  return (
    <Dialog label={t('포켓몬 교체')} title={t('{name} 대신 보낼 포켓몬', { name: nameOf(pokemonById(currentDex)) })} onClose={onClose}>
      <div className="w-swap-list">
        {candidates.length === 0 && <div className="resume-empty">{t('파티에 쉬고 있는 포켓몬이 없어요. 박스에서 파티로 데려오면 교체할 수 있어요.')}</div>}
        {candidates.map(uid => {
          const m = dex.mons[uid]
          return (
            <button key={uid} className="w-swap-item" onClick={() => onPick(uid)}>
              <img src={spriteUrl(m.dex, m.shiny)} alt="" />
              <span className="w-swap-name">{m.shiny ? '✦ ' : ''}{nameOf(pokemonById(m.dex))}{genderMark(m.gender)}</span>
              <span className="w-swap-meta">{t('쉬는 중 · {steps}걸음', { steps: m.steps })}{isFullyEvolved(m.dex) ? ` · ${t('최종')}` : ''}</span>
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
    <Dialog label={t('몬스터볼 던지기')} title={resume ? t('이 세션에 보낼 포켓몬') : t('누구를 보낼까요?')} onClose={onClose}>
      {resume && <div className="w-throw-hint">{t('이 세션의 포켓몬이 다른 세션에서 일하고 있어서, 대신 보낼 포켓몬을 골라주세요.')}</div>}
      <div className="w-swap-list">
        {dex.party.map(uid => {
          const m = dex.mons[uid]
          if (!m) return null
          const working = busy.has(uid)
          return (
            <button key={uid} className={`w-swap-item${working ? ' busy' : ''}`} disabled={working} onClick={() => onPick(uid)}>
              <img src={spriteUrl(m.dex, m.shiny)} alt="" />
              <span className="w-swap-name">{m.shiny ? '✦ ' : ''}{nameOf(pokemonById(m.dex))}</span>
              <span className="w-swap-meta">{working ? t('일하는 중') : t('쉬는 중 · {steps}걸음', { steps: m.steps })}</span>
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}
