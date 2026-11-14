/**
 * SessionHeader — the bar above the terminal names the session in view, now that the
 * session tabs are gone (the left list, or the folded rail, switches sessions): its
 * picture (the Pokémon; in 업무 모드 a plain glyph; a shell's prompt), its name, the
 * folder's git branch and the project. The name renames on a double-click and the ×
 * closes, both through the same state and functions as the list's rows (Widget.tsx),
 * so they work with the left panel folded too.
 */

import React from 'react'
import { TerminalIcon } from './Icons'
import { t } from '../i18n'
import type { SessionHeaderParts } from '../sessionList'

export const SessionHeader: React.FC<{
  parts: SessionHeaderParts
  sprite: string
  /** The session's folder: the header's tooltip */
  cwd?: string
  renaming: boolean
  onRenameStart(): void
  onRenameCommit(value: string): void
  onRenameCancel(): void
  /** The × waits for a second click ("닫기") */
  closing: boolean
  onClose(): void
  onCloseCancel(): void
}> = ({ parts, sprite, cwd, renaming, onRenameStart, onRenameCommit, onRenameCancel, closing, onClose, onCloseCancel }) => (
  <div className="w-sess-head" title={cwd || undefined}>
    {parts.picture === 'shell' ? <span className="w-sess-head-pic w-sess-head-shell" aria-hidden="true">&gt;_</span>
      : parts.picture === 'glyph' ? <span className="w-sess-head-pic w-sess-head-glyph" aria-hidden="true"><TerminalIcon size={14} /></span>
      : <img className="w-sess-head-pic" src={sprite} alt="" draggable={false} />}
    {renaming ? (
      <input
        className="w-sess-head-rename"
        autoFocus
        defaultValue={parts.name ?? ''}
        placeholder={t('새 세션')}
        maxLength={40}
        aria-label={t('세션 이름 바꾸기')}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) onRenameCommit(e.currentTarget.value)
          if (e.key === 'Escape') onRenameCancel()
        }}
        onBlur={e => onRenameCommit(e.currentTarget.value)}
      />
    ) : (
      <span className="w-sess-head-name" title={t('더블클릭해서 세션 이름 바꾸기')} onDoubleClick={onRenameStart}>{parts.name ?? t('새 세션')}</span>
    )}
    {parts.branch && <span className="w-row-branch w-sess-head-branch" title={t('git 브랜치')}>{parts.branch}</span>}
    {parts.project && <span className="w-sess-head-proj">{parts.project}</span>}
    <span className="w-sess-head-spacer" />
    <button
      className={`w-sess-head-close${closing ? ' confirm' : ''}`}
      onClick={onClose}
      onMouseLeave={() => closing && onCloseCancel()}
      title={closing ? t('한 번 더 누르면 세션을 닫아요') : t('세션 닫기')}
      aria-label={t('세션 닫기')}
    >{closing ? t('닫기') : '×'}</button>
  </div>
)

export default SessionHeader
