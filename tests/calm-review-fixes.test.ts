/**
 * The calm style's final review (C1, M3, M4, M6): source and CSS checks that the controls keep
 * main's hit areas, the usage labels are never cut, hover and chosen differ in the segmented
 * controls, and the dead code is gone. The sizes themselves are measured in a real page by
 * `node tests/visual/shots.mjs --flow hit-areas` (floors from main, 0dbb6c9).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = (f: string) => readFileSync(join(__dirname, '..', 'src', 'styles', f), 'utf8')
const src = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8')
/** The declarations of the first rule whose selector is exactly `sel` (and the rules after it with the same selector) */
const decls = (text: string, sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...text.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g'))].map(m => m[1]).join(';')
}

describe('C1: hit areas not smaller than on main', () => {
  it("the header's 로그인: 10px each side (the 400 weight sets narrower than main's 700)", () => {
    expect(decls(css('pokedex.css'), '.w-signin')).toMatch(/padding: 3px 10px/)
  })
  it('the update button: 3px 10px inside its 1px border (main: 4px 10px, no border)', () => {
    expect(decls(css('widget.css'), '.w-update')).toMatch(/padding: 3px 10px;[^;]*;[^;]*border: 1px solid/)
  })
  it("상세's 확인 필요 button: 1px above and below (16px tall, as on main)", () => {
    expect(decls(css('widget-expanded.css'), '.w-pill.as-button')).toMatch(/padding: 1px 0/)
  })
  it("도감's tier chips: 5px above and below (24px tall without main's 1px border)", () => {
    expect(decls(css('pokedex.css'), '.dex-chips button')).toMatch(/padding-top: 5px; padding-bottom: 5px/)
  })
  it("the folded rail's buttons: 38px, as on main", () => {
    const rail = decls(css('widget-expanded.css'), '.w-rail-btn')
    expect(rail).toMatch(/width: 38px; height: 38px/)
    expect(rail).not.toMatch(/36px/)
    // the chosen session's bar still sits at the rail's edge: (56 - 38) / 2 = 9
    expect(css('widget-expanded.css')).toMatch(/\.w-rail-session\.on::before \{[^}]*left: -9px/)
  })
})

describe('M3: the usage labels are never cut', () => {
  it('one column set for the rows (a subgrid), the label column as wide as the longest label', () => {
    const w = css('widget.css')
    expect(decls(w, '.w-limits:not(.idle)')).toMatch(/grid-template-columns: minmax\(36px, max-content\) minmax\(0, 1fr\) 30px 74px/)
    expect(decls(w, '.w-limit')).toMatch(/grid-template-columns: subgrid/)
    expect(decls(w, '.w-limit')).not.toMatch(/36px minmax/)
  })
})

describe('M4: hovered and chosen differ in the segmented controls (도감, 박스, 랭킹, 설정)', () => {
  it('hover keeps the words at --ink-2 and never restyles the chosen one', () => {
    const p = css('pokedex.css')
    expect(p).toContain('.dex-seg button:not(.on):hover, .dex-chips button:not(.on):hover { color: var(--ink-2); background: var(--hover); }')
    expect(p).not.toMatch(/\.dex-seg button:hover/)
    expect(decls(p, '.dex-seg button.on, .dex-chips button.on')).toMatch(/color: var\(--ink\)/)
  })
})

describe('M6: no dead code', () => {
  it('contextTone (no caller since the usage bars moved to usageTone) is gone', () => {
    expect(src('meters.ts')).not.toMatch(/contextTone/)
    expect(src('Widget.tsx')).not.toMatch(/contextTone/)
  })
  it("the bar's scrollbar rule is gone (the bar is overflow: visible)", () => {
    expect(css('widget-expanded.css')).not.toMatch(/\.w-term-tabs::-webkit-scrollbar/)
  })
})
