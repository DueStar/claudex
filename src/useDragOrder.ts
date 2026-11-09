/**
 * useDragOrder — reorder a row of items by dragging them with the pointer, as
 * a browser's tabs do: the item follows the pointer, the others slide out of
 * its way as it passes, and the new order is kept on screen until whoever
 * owns the list (the main process's terminals) sends it back.
 *
 * A press becomes a drag only after DRAG_START_PX, and the pointer is captured
 * only then, so a plain click (or a button inside the item) still works.
 * It lands where its leading edge has passed the middle of a neighbour: a
 * wide item dragged onto a narrow first one still takes the first place.
 */

import { useEffect, useRef, useState } from 'react'
import type React from 'react'

const DRAG_START_PX = 4

interface Drag {
  id: string
  from: number
  start: number
  /** Every item's box when the drag began: the slots they slide between */
  rects: DOMRect[]
  delta: number
  to: number
  active: boolean
  pointer: number
  el: HTMLElement
}

export function useDragOrder(ids: string[], axis: 'x' | 'y', onDrop: (id: string, to: number) => void) {
  const refs = useRef(new Map<string, HTMLElement>())
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [order, setOrder] = useState<string[] | null>(null)
  const suppressClick = useRef(false)

  // The order shown after a drop, until the owner's list catches up (no snap back)
  const listed = ids.join('\n')
  useEffect(() => {
    if (!order) return
    if (order.join('\n') === listed) { setOrder(null); return }
    const timer = setTimeout(() => setOrder(null), 1500)
    return () => clearTimeout(timer)
  }, [listed, order])
  const shown = order ? [...order.filter(id => ids.includes(id)), ...ids.filter(id => !order.includes(id))] : ids

  const span = (r: DOMRect): [number, number] => (axis === 'x' ? [r.left, r.width] : [r.top, r.height])
  const at = (e: React.PointerEvent) => (axis === 'x' ? e.clientX : e.clientY)

  function bind(id: string, index: number, enabled = true) {
    return {
      ref: (el: HTMLElement | null) => { if (el) refs.current.set(id, el); else refs.current.delete(id) },
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (!enabled || e.button !== 0) return
        // A button or a field inside the item keeps its own press
        const target = e.target as HTMLElement
        if (target !== e.currentTarget && target.closest('button, input, textarea, a, [data-no-drag]')) return
        const rects = shown.map(x => refs.current.get(x)?.getBoundingClientRect() ?? new DOMRect())
        dragRef.current = { id, from: index, start: at(e), rects, delta: 0, to: index, active: false, pointer: e.pointerId, el: e.currentTarget }
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const d = dragRef.current
        if (!d) return
        const raw = at(e) - d.start
        if (!d.active && Math.abs(raw) < DRAG_START_PX) return
        if (!d.active) { try { d.el.setPointerCapture(d.pointer) } catch { /* the pointer is gone */ } }
        const [ownStart, ownSize] = span(d.rects[d.from])
        const [firstStart] = span(d.rects[0])
        const [lastStart, lastSize] = span(d.rects[d.rects.length - 1])
        // Kept inside the row
        const delta = Math.max(firstStart - ownStart, Math.min(lastStart + lastSize - (ownStart + ownSize), raw))
        // The leading edge decides: how many others' middles it has passed
        const lead = delta < 0 ? ownStart + delta : ownStart + ownSize + delta
        let to = 0
        d.rects.forEach((r, j) => { if (j === d.from) return; const [s, z] = span(r); if (s + z / 2 < lead) to++ })
        const next = { ...d, delta, to, active: true }
        dragRef.current = next
        setDrag(next)
      },
      onPointerUp: () => finish(),
      onPointerCancel: () => finish(),
    }
  }

  function finish() {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    try { if (d.el.hasPointerCapture(d.pointer)) d.el.releasePointerCapture(d.pointer) } catch { /* released */ }
    if (!d.active) return
    // The click that follows a drag is not a click
    suppressClick.current = true
    setTimeout(() => { suppressClick.current = false }, 0)
    setDrag(null)
    if (d.to === d.from) return
    const next = shown.filter(x => x !== d.id)
    next.splice(d.to, 0, d.id)
    setOrder(next)
    onDrop(d.id, d.to)
  }

  /** How far item `index` is moved right now (the dragged one with the pointer, the others aside) */
  function offset(id: string, index: number): number {
    if (!drag?.active) return 0
    if (id === drag.id) return drag.delta
    const own = drag.rects[drag.from]
    const near = drag.rects[drag.from + 1] ?? drag.rects[drag.from - 1]
    const [ownStart, ownSize] = span(own)
    const gap = near ? Math.max(0, Math.abs(span(near)[0] - ownStart) - ownSize) : 0
    const step = ownSize + gap
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -step
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return step
    return 0
  }

  function style(id: string, index: number): React.CSSProperties | undefined {
    const v = offset(id, index)
    return v ? { transform: axis === 'x' ? `translateX(${v}px)` : `translateY(${v}px)` } : undefined
  }

  /** ' dragging' for the one in hand, ' sliding' for the rest while a drag is on */
  function stateClass(id: string): string {
    if (!drag?.active) return ''
    return id === drag.id ? ' dragging' : ' sliding'
  }

  /** Wrap a click handler: ignored right after a drag */
  const click = (fn: () => void) => () => { if (suppressClick.current) return; fn() }

  return { shown, bind, style, stateClass, click, dragging: !!drag?.active }
}
