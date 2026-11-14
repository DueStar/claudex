/**
 * TextSizeControl — `− 가 보통 +` in the top bar: the app's one text size (src/textSize.ts),
 * which the lists, the panels and the terminal follow together. − and + step it (dimmed at
 * the ends); the middle opens the four steps, each with its UI and terminal size. The same
 * step moves with Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel (⌘ on a Mac), anywhere in the window.
 * The menu works from the keyboard as a menu does: it opens on the checked step, ↓ / ↑ / Home /
 * End move, Enter or Space picks, Esc and Tab close it, and the focus comes back to the button.
 */

import React, { useEffect, useRef, useState } from 'react'
import { setTextStep, stepTextSize, TERM_PX, TEXT_STEP_LABEL, TEXT_STEP_SENSE, TEXT_STEPS, UI_PX, useTextStep } from '../textSize'
import { t, tSense } from '../i18n'
import { modCombo, modLabel } from '../platform'
import { CheckIcon } from './Icons'
import { menuKeyIndex } from '../menuKeys'

/** compact: a narrow top bar — one 가 button that opens the same menu (no − / + and no step name) */
export const TextSizeControl: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const step = useTextStep()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const cur = useRef<HTMLButtonElement>(null)
  // Open: the focus goes to the checked step. It closes on a press outside it, on Esc (focus back
  // on the button) and on Tab (from the button, so Tab goes on to the next control)
  useEffect(() => {
    if (!open) return
    box.current?.querySelector<HTMLElement>('.w-textsize-item.on')?.focus()
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        setOpen(false)
        cur.current?.focus()
        return
      }
      if (e.key === 'Tab') { setOpen(false); cur.current?.focus(); return }
      const items = [...(box.current?.querySelectorAll<HTMLElement>('.w-textsize-item') ?? [])]
      const at = items.indexOf(document.activeElement as HTMLElement)
      if (at < 0 || e.altKey || e.ctrlKey || e.metaKey) return
      const next = menuKeyIndex(e.key, at, items.length)
      if (next === null) return
      e.preventDefault(); e.stopPropagation()
      items[next].focus()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  const at = TEXT_STEPS.indexOf(step)
  const name = tSense(TEXT_STEP_LABEL[step], TEXT_STEP_SENSE)
  const tip = t('글자 크기 · 목록·패널·터미널 함께 ({mod}+= 크게 · {mod}+- 작게 · {mod}+0 보통 · {mod}+휠)', { mod: modLabel() })
  return (
    <div className={`w-textsize${compact ? ' compact' : ''}`} ref={box}>
      {!compact && <button className="w-textsize-step" onClick={() => stepTextSize(-1)} disabled={at <= 0}
        title={`${t('글자 작게')} (${modCombo('-')})`} aria-label={t('글자 작게')}>−</button>}
      <button ref={cur} className={`w-textsize-cur${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true) } }}
        title={compact ? `${name} · ${tip}` : tip} aria-label={`${t('글자 크기')}: ${name}`} aria-haspopup="menu" aria-expanded={open}>
        <span className="w-textsize-g" aria-hidden="true">가</span>{!compact && <span className="w-textsize-name">{name}</span>}
      </button>
      {!compact && <button className="w-textsize-step" onClick={() => stepTextSize(1)} disabled={at >= TEXT_STEPS.length - 1}
        title={`${t('글자 크게')} (${modCombo('=')})`} aria-label={t('글자 크게')}>+</button>}
      {open && (
        <div className="w-textsize-menu" role="menu" aria-label={t('글자 크기')}>
          <div className="w-textsize-title">{t('글자 크기')}</div>
          {TEXT_STEPS.map(s => (
            <button key={s} role="menuitemradio" aria-checked={s === step} tabIndex={-1} className={`w-textsize-item${s === step ? ' on' : ''}`}
              onClick={() => { setTextStep(s); setOpen(false); cur.current?.focus() }}>
              <span className="w-textsize-ck"><CheckIcon size={12} /></span>
              <span className="w-textsize-item-name">{tSense(TEXT_STEP_LABEL[s], TEXT_STEP_SENSE)}</span>
              <small>{t('화면 {ui} · 터미널 {term}', { ui: UI_PX[s], term: TERM_PX[s] })}</small>
            </button>
          ))}
          <div className="w-textsize-foot">{modCombo('=')} · {modCombo('-')} · {modCombo('0')}</div>
        </div>
      )}
    </div>
  )
}

export default TextSizeControl
