/**
 * SessionTabs — the terminal's session tabs, a row of their own under the
 * view bar (the same small rounded tabs as before). A tab is dragged with the
 * pointer (useDragOrder): it follows the cursor and the others slide out of
 * its way as it passes them; on release the order goes to the main process
 * (terminals.move).
 */

import React, { useLayoutEffect, useRef } from 'react'
import type { TerminalInfo } from '../desktop'
import { PlusIcon } from './Icons'
import { t } from '../i18n'
import { useDragOrder } from '../useDragOrder'

export interface TabRow {
  sessionId: string
  terminal?: TerminalInfo
  mood: string
  sprite: string
  /** The Pokémon's name (on hover: the tab shows its picture only) */
  name: string
  title: string | null
  /** The git branch of the session's folder */
  branch?: string | null
  /** A plain shell tab: no Pokémon */
  shell?: boolean
}

export const SessionTabs: React.FC<{
  rows: TabRow[]
  shownId?: string
  onSelect: (sessionId: string) => void
  onRename: (sessionId: string) => void
  onMove: (terminalId: string, index: number) => void
  onNew: () => void
  /** A plain shell tab (PowerShell), no Pokémon */
  onNewShell?: () => void
  /** The × that shows on hover (the same close as the session card's) */
  onClose?: (sessionId: string) => void
  /** The tab whose × waits for a second click ("닫기?") */
  closing?: string | null
  onCloseCancel?: () => void
}> = ({ rows, shownId, onSelect, onRename, onMove, onNew, onNewShell, onClose, closing, onCloseCancel }) => {
  const bySession = new Map(rows.map(r => [r.sessionId, r]))
  const order = useDragOrder(rows.map(r => r.sessionId), 'x', (id, to) => {
    const term = bySession.get(id)?.terminal
    if (term) onMove(term.id, to)
  })
  const els = useRef(new Map<string, HTMLElement>())

  // The tab in view stays in sight when there are more than fit
  useLayoutEffect(() => {
    if (shownId) els.current.get(shownId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [shownId])

  return (
    <div className="w-sess-bar">
    <div className="w-sess-tabs" role="tablist">
      {order.shown.map((id, i) => {
        const r = bySession.get(id)
        if (!r) return null
        const on = shownId === id
        const drag = order.bind(id, i, !!r.terminal)
        return (
          <button
            key={id}
            ref={el => { drag.ref(el); if (el) els.current.set(id, el); else els.current.delete(id) }}
            role="tab"
            aria-selected={on}
            className={`w-sess-tab mood-${r.mood}${on ? ' on' : ''}${order.stateClass(id)}`}
            style={order.style(id, i)}
            title={[r.terminal?.tool && r.terminal.tool !== 'claude' ? r.terminal.toolName : '', r.terminal?.cwd, r.branch ? `⎇ ${r.branch}` : ''].filter(Boolean).join(' · ')}
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerCancel}
            onClick={order.click(() => onSelect(id))}
          >
            {r.shell ? <span className="w-sess-shell" aria-hidden="true">&gt;_</span> : <img src={r.sprite} alt={r.name} title={r.name} draggable={false} />}
            <span className="w-sess-tab-name" onDoubleClick={() => r.terminal && onRename(id)}>{r.title ?? t('새 세션')}</span>
            <span className="w-sess-tab-dot" />
            {onClose && r.terminal && (
              // A span, not a button: a button can't sit inside the tab's button.
              // Its pointerdown stops here so pressing it never starts a drag.
              <span
                role="button"
                tabIndex={-1}
                className={`w-sess-tab-close${closing === id ? ' confirm' : ''}`}
                title={closing === id ? t('한 번 더 누르면 세션을 닫아요') : t('세션 닫기')}
                aria-label={t('세션 닫기')}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onClose(id) }}
                onMouseLeave={() => closing === id && onCloseCancel?.()}
              >{closing === id ? t('닫기?') : '×'}</span>
            )}
          </button>
        )
      })}
      <button className="w-sess-new" onClick={onNew} title={t('새로운 세션 시작하기 (문서 폴더)')} aria-label={t('새로운 세션 시작하기')}><PlusIcon size={14} /></button>
      </div>
      {/* The shell button stays at the right end, outside the scrolling tabs */}
      {onNewShell && <button className="w-sess-shell-btn" onClick={onNewShell} title={t('셸 탭 열기 (포켓몬 없이 PowerShell)')} aria-label={t('셸 탭 열기')}>&gt;_</button>}
    </div>
  )
}

export default SessionTabs
