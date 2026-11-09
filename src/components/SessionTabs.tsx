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
}

export const SessionTabs: React.FC<{
  rows: TabRow[]
  shownId?: string
  onSelect: (sessionId: string) => void
  onRename: (sessionId: string) => void
  onMove: (terminalId: string, index: number) => void
  onNew: () => void
}> = ({ rows, shownId, onSelect, onRename, onMove, onNew }) => {
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
            title={[r.terminal?.tool && r.terminal.tool !== 'claude' ? r.terminal.toolName : '', r.terminal?.cwd].filter(Boolean).join(' · ')}
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerCancel}
            onClick={order.click(() => onSelect(id))}
          >
            <img src={r.sprite} alt={r.name} title={r.name} draggable={false} />
            <span className="w-sess-tab-name" onDoubleClick={() => r.terminal && onRename(id)}>{r.title ?? t('새 세션')}</span>
            <span className="w-sess-tab-dot" />
          </button>
        )
      })}
      <button className="w-sess-new" onClick={onNew} title={t('새로운 세션 시작하기 (문서 폴더)')} aria-label={t('새로운 세션 시작하기')}><PlusIcon size={14} /></button>
    </div>
  )
}

export default SessionTabs
