/**
 * src/textSize.ts — one text-size step for the whole app (the UI's type scale and the
 * terminal's font size together): the step tables, stepping, and the migration from the
 * old terminal-only size (spawn-term-font, 10–24px) to the nearest step, ties going larger.
 * And src/termFont.ts keeps the names TerminalPanel.tsx imports (a source check).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextStep, OLD_TERM_KEY, readInitialStep, stepFromTermPx, TERM_PX, TEXT_KEY, TEXT_STEP_LABEL, TEXT_STEP_SENSE, TEXT_STEPS, UI_PX } from '../src/textSize'

const ROOT = join(__dirname, '..')
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('the steps', () => {
  it('four steps, their names and sizes', () => {
    expect([...TEXT_STEPS]).toEqual(['small', 'normal', 'large', 'xlarge'])
    expect(TEXT_STEP_LABEL).toEqual({ small: '작게', normal: '보통', large: '크게', xlarge: '아주 크게' })
    expect(UI_PX).toEqual({ small: 11, normal: 12, large: 13, xlarge: 14 })
    expect(TERM_PX).toEqual({ small: 12, normal: 13, large: 15, xlarge: 17 })
    expect([TEXT_KEY, OLD_TERM_KEY]).toEqual(['spawn-text-size', 'spawn-term-font'])
  })
})

describe('stepFromTermPx: an old terminal size to the nearest step, a tie to the larger', () => {
  it.each([
    [10, 'small'], [12, 'small'], [13, 'normal'], [14, 'large'], [15, 'large'],
    [16, 'xlarge'], [17, 'xlarge'], [20, 'xlarge'], [24, 'xlarge'],
  ] as const)('%ipx → %s', (px, step) => {
    expect(stepFromTermPx(px)).toBe(step)
  })
})

describe('nextStep', () => {
  it('one step up or down, held at both ends', () => {
    expect(nextStep('small', -1)).toBe('small')
    expect(nextStep('small', 1)).toBe('normal')
    expect(nextStep('normal', 1)).toBe('large')
    expect(nextStep('normal', -1)).toBe('small')
    expect(nextStep('xlarge', 1)).toBe('xlarge')
    expect(nextStep('xlarge', -1)).toBe('large')
  })
})

describe('readInitialStep', () => {
  const store = (o: Record<string, string>) => ({ getItem: (k: string) => (k in o ? o[k] : null) })

  it('nothing stored: 보통', () => {
    expect(readInitialStep(null)).toBe('normal')
    expect(readInitialStep(undefined)).toBe('normal')
    expect(readInitialStep(store({}))).toBe('normal')
  })

  it('the old terminal size carries over to its nearest step', () => {
    expect(readInitialStep(store({ 'spawn-term-font': '15' }))).toBe('large')
    expect(readInitialStep(store({ 'spawn-term-font': '14' }))).toBe('large')
    expect(readInitialStep(store({ 'spawn-term-font': '16' }))).toBe('xlarge')
    expect(readInitialStep(store({ 'spawn-term-font': '20' }))).toBe('xlarge')
    expect(readInitialStep(store({ 'spawn-term-font': '10' }))).toBe('small')
  })

  it('a step the user picked wins over the old size (never migrated again)', () => {
    expect(readInitialStep(store({ 'spawn-term-font': '15', 'spawn-text-size': 'small' }))).toBe('small')
    expect(readInitialStep(store({ 'spawn-term-font': '24', 'spawn-text-size': 'normal' }))).toBe('normal')
  })

  it('garbage or out of range: 보통', () => {
    expect(readInitialStep(store({ 'spawn-term-font': 'abc' }))).toBe('normal')
    expect(readInitialStep(store({ 'spawn-term-font': '99' }))).toBe('normal')
    expect(readInitialStep(store({ 'spawn-term-font': '9' }))).toBe('normal')
    expect(readInitialStep(store({ 'spawn-term-font': '' }))).toBe('normal')
    expect(readInitialStep(store({ 'spawn-text-size': 'huge' }))).toBe('normal')
  })

  it('an unknown step falls back to the old size', () => {
    expect(readInitialStep(store({ 'spawn-text-size': 'huge', 'spawn-term-font': '17' }))).toBe('xlarge')
  })

  it('it only reads', () => {
    const writes: string[] = []
    const s = { getItem: (k: string) => (k === 'spawn-term-font' ? '15' : null), setItem: (k: string) => { writes.push(k) }, removeItem: (k: string) => { writes.push(k) } }
    readInitialStep(s)
    expect(writes).toEqual([])
  })

  it('a storage that throws: 보통', () => {
    expect(readInitialStep({ getItem: () => { throw new Error('denied') } })).toBe('normal')
  })
})

describe('the terminal follows the step (source checks)', () => {
  it('TerminalPanel.tsx still imports exactly the same names from termFont', () => {
    const m = /import \{([^}]*)\} from '\.\.\/termFont'/.exec(src('src/components/TerminalPanel.tsx'))
    expect(m).not.toBeNull()
    expect(m![1].split(',').map(s => s.trim()).filter(Boolean).sort()).toEqual(['getTermFont', 'resetTermFont', 'stepTermFont', 'subscribeTermFont', 'termFontStack'])
  })

  it('termFont.ts sizes come from the step: no presets, no setter, no size state of its own', () => {
    const tf = src('src/termFont.ts')
    expect(tf).not.toMatch(/FONT_PRESETS|\bsetTermFont\b|spawn-term-font/)
    expect(tf).toMatch(/TERM_PX\[getTextStep\(\)\]/)
  })

  it('no unused hook is left (useTermFont had no caller: final review M6)', () => {
    expect(src('src/termFont.ts')).not.toMatch(/useTermFont|useSyncExternalStore/)
  })
})

describe('the text-size control (source checks)', () => {
  it('the header has − 가 + in place of the Aa trio', () => {
    const w = src('src/Widget.tsx')
    // (folded to one 가 button when the bar is narrow: the bar's level 2)
    expect(w).toMatch(/<TextSizeControl compact=\{barLevel >= 2\} \/>/)
    expect(w).not.toMatch(/w-font-switch/)
    expect(w).not.toMatch(/Aa<\/button>/)
    for (const css of ['src/styles/pokedex.css', 'src/styles/widget-expanded.css']) expect(src(css)).not.toMatch(/w-font-switch/)
  })

  it('설정 › 앱 has a 글자 크기 row', () => {
    expect(src('src/components/SettingsView.tsx')).toContain("t('글자 크기')")
  })

  it('the words in English and Japanese; the trio\'s words are gone', async () => {
    const { default: WIDGET } = await import('../src/locales/widget')
    const { default: DICTS } = await import('../src/locales')
    for (const lang of ['en', 'ja'] as const) {
      for (const k of ['글자 크기', '작게', '보통#text-size', '크게', '아주 크게', '글자 작게', '글자 크게', '화면 {ui} · 터미널 {term}']) expect(WIDGET[lang][k], `${lang} ${k}`).toBeTruthy()
      for (const k of ['소', '중', '대', '글자 {size}', '글자 크기 {size}']) expect(WIDGET[lang][k], `${lang} ${k}`).toBeUndefined()
    }
    // the merged dictionaries read the step names as the control does
    expect([DICTS.en['보통#text-size'], DICTS.ja['보통#text-size'], DICTS.ja['아주 크게']]).toEqual(['Normal', '標準', '特大'])
  })

  it("'보통' has two senses: the text size (ja 標準) and 설정's display time (ja 普通, as on main) — final review M5", async () => {
    const { default: DICTS } = await import('../src/locales')
    const { default: SETTINGS } = await import('../src/locales/settings')
    const { default: WIDGET } = await import('../src/locales/widget')
    expect([DICTS.en['보통'], DICTS.ja['보통']]).toEqual(['Normal', '普通'])
    expect([SETTINGS.en['보통'], SETTINGS.ja['보통']]).toEqual(['Normal', '普通'])
    // the plain word lives once, in settings.ts (as on main); the text size has its own sense key
    expect([WIDGET.en['보통'], WIDGET.ja['보통']]).toEqual([undefined, undefined])
    expect(TEXT_STEP_SENSE).toBe('text-size')
    // the step names are read in their sense, the display time plainly (Korean shows 보통 in both)
    for (const f of ['src/components/TextSizeControl.tsx', 'src/components/SettingsView.tsx']) {
      expect(src(f), f).not.toMatch(/t\(TEXT_STEP_LABEL/)
      expect(src(f), f).toContain('tSense(TEXT_STEP_LABEL[')
    }
    expect(src('src/components/SettingsView.tsx')).toContain("['normal', t('보통')]")
    expect(src('src/i18n.ts')).toContain('const k = `${ko}#${sense}`')
  })

  it('the menu works from the keyboard: it opens on the checked step, arrows / Home / End move, Esc and Tab close it (final review M7)', async () => {
    const { menuKeyIndex } = await import('../src/menuKeys')
    expect(menuKeyIndex('ArrowDown', 0, 4)).toBe(1)
    expect(menuKeyIndex('ArrowDown', 3, 4)).toBe(0)
    expect(menuKeyIndex('ArrowUp', 0, 4)).toBe(3)
    expect(menuKeyIndex('ArrowUp', 2, 4)).toBe(1)
    expect(menuKeyIndex('ArrowDown', -1, 4)).toBe(0)
    expect(menuKeyIndex('ArrowUp', -1, 4)).toBe(3)
    expect(menuKeyIndex('Home', 2, 4)).toBe(0)
    expect(menuKeyIndex('End', 1, 4)).toBe(3)
    expect(menuKeyIndex('Enter', 1, 4)).toBeNull()
    expect(menuKeyIndex('ArrowDown', 0, 0)).toBeNull()
    const c = src('src/components/TextSizeControl.tsx')
    expect(c).toContain('role="menu"')
    expect(c).toContain("box.current?.querySelector<HTMLElement>('.w-textsize-item.on')?.focus()")
    expect(c).toContain('menuKeyIndex(e.key, at, items.length)')
    expect(c).toMatch(/if \(e\.key === 'Tab'\) \{ setOpen\(false\); cur\.current\?\.focus\(\); return \}/)
    expect(c).toMatch(/e\.key === 'Escape'[\s\S]{0,120}cur\.current\?\.focus\(\)/)
  })
})
