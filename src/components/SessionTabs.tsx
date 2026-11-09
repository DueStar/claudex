/**
 * SessionTabs — the terminal's session tabs, a row of their own under the
 * view bar (the same small rounded tabs as before). A tab is dragged with the pointer (not HTML drag and drop), so it
 * follows the cursor and the others slide out of its way as it passes them;
 * on release the order goes to the main process (terminals.move).
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TerminalInfo } from '../desktop'
import { PlusIcon } from './Icons'
import { t } from '../i18n'

export interface TabRow {
  sessionId: string
  terminal?: TerminalInfo
  mood: string
  sprite: string
  /** The Pokémon's name (on hover: the tab shows its picture only) */
  name: string
  title: string | null
}

interface Drag {
  id: string
  from: number
  startX: number
  /** Every tab's box when the drag began: the slots the tabs slide between */
  rects: DOMRect[]
  dx: number
  to: number
  active: boolean
}

/** A press becomes a drag past this many pixels (a shorter one is a click) */
const DRAG_START_PX = 4

export const SessionTabs: React.FC<{
  rows: TabRow[]
  shownId?: string
  onSelect: (sessionId: string) => void
  onRename: (sessionId: string) => void
  onMove: (terminalId: string, index: number) => void
  onNew: () => void
}> = ({ rows, shownId, onSelect, onRename, onMove, onNew }) => {
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The order shown right after a drop, until the main process's list catches up (no snap back)
  const [order, setOrder] = useState<string[] | null>(null)
  const suppressClick = useRef(false)

  const listed = rows.map(r => r.sessionId).join('\n')
  useEffect(() => {
    if (!order) return
    if (order.join('\n') === listed) { setOrder(null); return }
    const timer = setTimeout(() => setOrder(null), 1500)
    return () => clearTimeout(timer)
  }, [listed, order])

  const shown = order
    ? [...order.map(id => rows.find(r => r.sessionId === id)).filter((r): r is TabRow => !!r), ...rows.filter(r => !order.includes(r.sessionId))]
    : rows

  // The tab in view stays in sight when there are more than fit
  useLayoutEffect(() => {
    if (shownId) refs.current.get(shownId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [shownId])

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, i: number, r: TabRow) => {
    if (e.button !== 0 || !r.terminal) return
    const rects = shown.map(x => refs.current.get(x.sessionId)?.getBoundingClientRect() ?? new DOMRect())
    dragRef.current = { id: r.sessionId, from: i, startX: e.clientX, rects, dx: 0, to: i, active: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    if (!d.active && Math.abs(dx) < DRAG_START_PX) return
    // Kept inside the row: from the first slot's left edge to the last one's right edge
    const own = d.rects[d.from]
    const min = d.rects[0].left - own.left
    const max = d.rects[d.rects.length - 1].right - own.right
    const x = Math.max(min, Math.min(max, dx))
    // The slot it lands in: how many of the others' middles its middle has passed
    const mid = own.left + own.width / 2 + x
    let to = 0
    d.rects.forEach((rc, j) => { if (j !== d.from && rc.left + rc.width / 2 < mid) to++ })
    const next = { ...d, dx: x, to, active: true }
    dragRef.current = next
    setDrag(next)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d?.active) return
    suppressClick.current = true
    setDrag(null)
    if (d.to === d.from) return
    const ids = shown.map(r => r.sessionId)
    ids.splice(d.from, 1)
    ids.splice(d.to, 0, d.id)
    setOrder(ids)
    const term = shown[d.from].terminal
    if (term) onMove(term.id, d.to)
  }

  /** How far tab j slides while another is dragged across it */
  const shift = (j: number): number => {
    if (!drag?.active || j === drag.from) return 0
    const own = drag.rects[drag.from]
    const next = drag.rects[drag.from + 1] ?? drag.rects[drag.from - 1]
    const gap = next ? Math.max(0, Math.abs(next.left - own.left) - own.width) : 0
    const step = own.width + gap
    if (drag.from < drag.to && j > drag.from && j <= drag.to) return -step
    if (drag.from > drag.to && j >= drag.to && j < drag.from) return step
    return 0
  }

  return (
    <div className="w-sess-tabs" role="tablist">
      {shown.map((r, i) => {
        const dragging = drag?.active && drag.id === r.sessionId
        const on = shownId === r.sessionId
        return (
          <button
            key={r.sessionId}
            ref={el => { if (el) refs.current.set(r.sessionId, el); else refs.current.delete(r.sessionId) }}
            role="tab"
            aria-selected={on}
            className={`w-sess-tab mood-${r.mood}${on ? ' on' : ''}${dragging ? ' dragging' : ''}${drag?.active ? ' sliding' : ''}`}
            style={{ transform: dragging ? `translateX(${drag!.dx}px)` : shift(i) ? `translateX(${shift(i)}px)` : undefined }}
            title={[r.terminal?.tool && r.terminal.tool !== 'claude' ? r.terminal.toolName : '', r.terminal?.cwd].filter(Boolean).join(' · ')}
            onPointerDown={e => onPointerDown(e, i, r)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return } onSelect(r.sessionId) }}
          >
            <img src={r.sprite} alt={r.name} title={r.name} draggable={false} />
            <span className="w-sess-tab-name" onDoubleClick={() => r.terminal && onRename(r.sessionId)}>{r.title ?? t('새 세션')}</span>
            <span className="w-sess-tab-dot" />
          </button>
        )
      })}
      <button className="w-sess-new" onClick={onNew} title={t('새로운 세션 시작하기 (문서 폴더)')} aria-label={t('새로운 세션 시작하기')}><PlusIcon size={14} /></button>
    </div>
  )
}

export default SessionTabs
