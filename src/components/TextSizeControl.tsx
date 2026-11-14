/**
 * TextSizeControl — `− 가 보통 +` in the top bar: the app's one text size (src/textSize.ts),
 * which the lists, the panels and the terminal follow together. − and + step it (dimmed at
 * the ends); the middle opens the four steps, each with its UI and terminal size. The same
 * step moves with Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel (⌘ on a Mac), anywhere in the window.
 */

import React, { useEffect, useRef, useState } from 'react'
import { setTextStep, stepTextSize, TERM_PX, TEXT_STEP_LABEL, TEXT_STEPS, UI_PX, useTextStep } from '../textSize'
import { t } from '../i18n'
import { modCombo, modLabel } from '../platform'
import { CheckIcon } from './Icons'

export const TextSizeControl: React.FC = () => {
  const step = useTextStep()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const cur = useRef<HTMLButtonElement>(null)
  // The menu closes on a press outside it and on Esc (focus back on the button)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      setOpen(false)
      cur.current?.focus()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  const at = TEXT_STEPS.indexOf(step)
  const name = t(TEXT_STEP_LABEL[step])
  const tip = t('글자 크기 · 목록·패널·터미널 함께 ({mod}+= 크게 · {mod}+- 작게 · {mod}+0 보통 · {mod}+휠)', { mod: modLabel() })
  return (
    <div className="w-textsize" ref={box}>
      <button className="w-textsize-step" onClick={() => stepTextSize(-1)} disabled={at <= 0}
        title={`${t('글자 작게')} (${modCombo('-')})`} aria-label={t('글자 작게')}>−</button>
      <button ref={cur} className={`w-textsize-cur${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)}
        title={tip} aria-label={`${t('글자 크기')}: ${name}`} aria-haspopup="menu" aria-expanded={open}>
        <span className="w-textsize-g" aria-hidden="true">가</span><span className="w-textsize-name">{name}</span>
      </button>
      <button className="w-textsize-step" onClick={() => stepTextSize(1)} disabled={at >= TEXT_STEPS.length - 1}
        title={`${t('글자 크게')} (${modCombo('=')})`} aria-label={t('글자 크게')}>+</button>
      {open && (
        <div className="w-textsize-menu" role="menu" aria-label={t('글자 크기')}>
          <div className="w-textsize-title">{t('글자 크기')}</div>
          {TEXT_STEPS.map(s => (
            <button key={s} role="menuitemradio" aria-checked={s === step} className={`w-textsize-item${s === step ? ' on' : ''}`}
              onClick={() => { setTextStep(s); setOpen(false); cur.current?.focus() }}>
              <span className="w-textsize-ck"><CheckIcon size={12} /></span>
              <span className="w-textsize-item-name">{t(TEXT_STEP_LABEL[s])}</span>
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
