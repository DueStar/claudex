/**
 * src/sessionList.ts — the left list's pure helpers. hpTone: the colour of a session's
 * context bar (what is left of the window, drained like a Pokémon's HP); the list mode
 * (상세 / 간략); a 간략 row's tooltip; what the session header shows. And the tab row's
 * removal (source checks).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hpTone, LIST_MODE_KEY, readListMode, rowKeyAction, rowLabel, rowTooltip, sessionHeaderParts } from '../src/sessionList'
import DICTS from '../src/locales'

describe('hpTone', () => {
  it('nothing reported yet: the full, dimmed bar', () => {
    expect(hpTone(null)).toBe('hp-full')
  })

  it('green above half, amber at half and under, red at a fifth and under', () => {
    expect(hpTone(100)).toBe('hp-green')
    expect(hpTone(51)).toBe('hp-green')
    expect(hpTone(50)).toBe('hp-yellow')
    expect(hpTone(21)).toBe('hp-yellow')
    expect(hpTone(20)).toBe('hp-red')
    expect(hpTone(0)).toBe('hp-red')
  })
})

describe('the list mode (상세 / 간략)', () => {
  const store = (v: string | null) => ({ getItem: () => v })
  it('상세 unless 간략 was picked; storage missing or odd reads 상세', () => {
    expect(LIST_MODE_KEY).toBe('spawn-list-mode')
    expect(readListMode(null)).toBe('detail')
    expect(readListMode(undefined)).toBe('detail')
    expect(readListMode(store(null))).toBe('detail')
    expect(readListMode(store('compact'))).toBe('compact')
    expect(readListMode(store('detail'))).toBe('detail')
    expect(readListMode(store('x'))).toBe('detail')
    expect(readListMode({ getItem: () => { throw new Error('blocked') } })).toBe('detail')
  })
})

describe("a 간략 row's tooltip", () => {
  it('name · status · context left, every word through the translator', () => {
    expect(rowTooltip({ title: '타입 정리', mood: '쉬는 중', left: 100, barLabel: 'HP' }, k => k)).toBe('타입 정리 · 쉬는 중 · HP 100%')
    expect(rowTooltip({ title: null, mood: '쉬는 중', left: null, barLabel: 'HP' }, k => k)).toBe('새 세션 · 쉬는 중')
    expect(rowTooltip({ title: 'x', mood: '일하는 중', left: 61.6, barLabel: '컨텍스트' }, k => k)).toBe('x · 일하는 중 · 컨텍스트 62%')
    const en: Record<string, string> = { '새 세션': 'New session', '쉬는 중': 'Idle', '컨텍스트': 'Context' }
    expect(rowTooltip({ title: null, mood: '쉬는 중', left: 40, barLabel: '컨텍스트' }, k => en[k] ?? k)).toBe('New session · Idle · Context 40%')
  })

  it("a row that can be renamed says how on its own line (the name has no tooltip of its own in 간략: it would hide the row's)", () => {
    expect(rowTooltip({ title: '타입 정리', mood: '쉬는 중', left: 100, barLabel: 'HP', renamable: true }, k => k)).toBe('타입 정리 · 쉬는 중 · HP 100%\n더블클릭해서 세션 이름 바꾸기')
    expect(rowTooltip({ title: '타입 정리', mood: '쉬는 중', left: 100, barLabel: 'HP', renamable: false }, k => k)).toBe('타입 정리 · 쉬는 중 · HP 100%')
    expect(rowTooltip({ title: null, mood: '쉬는 중', left: null, barLabel: 'HP', renamable: true }, k => DICTS.en[k] ?? k)).toBe('New session · Resting\nDouble-click to rename the session')
  })

  it('the 간략 row draws no own title on its name, and the row passes renamable (source check)', () => {
    const w = readFileSync(join(__dirname, '..', 'src', 'Widget.tsx'), 'utf8')
    expect(w).toContain("title={!compact && r.terminal ? t('더블클릭해서 세션 이름 바꾸기') : undefined}")
    expect(w).toMatch(/rowTooltip\(\{[^}]*renamable: !!r\.terminal[^}]*\}, t\)/)
  })
})

describe('rows from the keyboard and for screen readers (final review I2)', () => {
  const widget = () => readFileSync(join(__dirname, '..', 'src', 'Widget.tsx'), 'utf8')
  const css = () => readFileSync(join(__dirname, '..', 'src', 'styles', 'widget.css'), 'utf8')

  it("a row's name: the session's name and its status (and the context left), in both list modes", () => {
    expect(rowLabel({ title: '타입 정리', mood: '쉬는 중', left: 100, barLabel: 'HP' }, k => k)).toBe('타입 정리 · 쉬는 중 · HP 100%')
    expect(rowLabel({ title: null, mood: '확인 필요', left: null, barLabel: '컨텍스트' }, k => k)).toBe('새 세션 · 확인 필요')
    expect(rowLabel({ title: null, mood: '일하는 중', left: 40, barLabel: '컨텍스트' }, k => DICTS.ja[k] ?? k)).toBe(`${DICTS.ja['새 세션']} · ${DICTS.ja['일하는 중']} · ${DICTS.ja['컨텍스트']} 40%`)
    // never the rename hint (that is the tooltip's)
    expect(rowLabel({ title: 'x', mood: '쉬는 중', left: null, barLabel: 'HP' }, k => k)).not.toContain('\n')
  })

  it('Enter and Space open the row, F2 renames it; nothing while an IME composes', () => {
    expect(rowKeyAction('Enter')).toBe('open')
    expect(rowKeyAction(' ')).toBe('open')
    expect(rowKeyAction('Spacebar')).toBe('open')
    expect(rowKeyAction('F2')).toBe('rename')
    for (const k of ['a', 'Tab', 'Escape', 'ArrowDown', 'Delete']) expect(rowKeyAction(k), k).toBeNull()
    expect(rowKeyAction('Enter', true)).toBeNull()
    expect(rowKeyAction('F2', true)).toBeNull()
  })

  it('a row is a focusable button; the one in view is the current one; keys only on the row itself (source check)', () => {
    const w = widget()
    expect(w).toContain("role={r.terminal ? 'button' : undefined}")
    expect(w).toContain('tabIndex={r.terminal ? 0 : undefined}')
    expect(w).toContain("aria-current={r.terminal && shown?.sessionId === r.sessionId ? 'true' : undefined}")
    expect(w).toMatch(/aria-label=\{rowLabel\(\{ title: r\.title, mood: MOOD_LABEL\[r\.mood\]/)
    expect(w).toContain('if (e.target !== e.currentTarget || !r.terminal) return')
    expect(w).toContain('rowKeyAction(e.key, e.nativeEvent.isComposing)')
    // the mouse goes through the same open() (the drag's click guard kept)
    expect(w).toContain('onClick={rowOrder.click(open)}')
  })

  it('the focus ring is a quiet hairline (no yellow, none on a click); 간략 shows its × on keyboard focus; an ended 간략 row is dimmed', () => {
    const c = css()
    expect(c).toContain('.w-row:focus-visible { outline: 1px solid var(--ink-3); outline-offset: -1px; }')
    expect(c).not.toMatch(/\.w-row:focus-visible[^}]*accent/)
    expect(c).toContain('.w-rows.compact .w-row:is(:focus-visible, :has(.w-row-close:focus-visible)) .w-row-state > .w-row-close { display: inline-grid; place-items: center; }')
    // a click's focus never shows the × (only :focus-visible does)
    expect(c).not.toMatch(/\.w-rows\.compact \.w-row:focus-within/)
    expect(c).toContain('.w-rows.compact .w-row.mood-ended { opacity: 0.45; }')
  })
})

describe("the list header's >_ (final review M2)", () => {
  it('opens the window only when a shell opened; the note of a refused one stays', () => {
    const w = readFileSync(join(__dirname, '..', 'src', 'Widget.tsx'), 'utf8')
    expect(w).toContain('const openShell = async (): Promise<boolean> => {')
    expect(w).toContain('onClick={async () => { if (await openShell()) setExpanded(true) }}')
    expect(w).not.toContain('await openShell(); setExpanded(true)')
  })
})

describe('the session header', () => {
  const row = { title: null, name: '모래두지', project: 'shop-web', branch: 'main' }
  it("names the session (never its Pokémon), its branch and project; the picture as in the rows", () => {
    expect(sessionHeaderParts(row, false)).toEqual({ picture: 'pokemon', name: null, branch: 'main', project: 'shop-web' })
    expect(sessionHeaderParts(row, true)).toEqual({ picture: 'glyph', name: null, branch: 'main', project: 'shop-web' })
    expect(sessionHeaderParts({ ...row, shell: true }, false).picture).toBe('shell')
    expect(sessionHeaderParts({ ...row, shell: true }, true).picture).toBe('shell')
    expect(sessionHeaderParts({ ...row, title: '타입 정리', branch: undefined }, false)).toEqual({ picture: 'pokemon', name: '타입 정리', branch: null, project: 'shop-web' })
  })
})

describe('the session tab row is gone', () => {
  const src = (...p: string[]) => join(__dirname, '..', 'src', ...p)
  it('no SessionTabs, no glint, no tab rules', () => {
    const widget = readFileSync(src('Widget.tsx'), 'utf8')
    expect(widget).not.toContain('SessionTabs')
    expect(widget).not.toContain('w-glint')
    expect(existsSync(src('components', 'SessionTabs.tsx'))).toBe(false)
    expect(readFileSync(src('styles', 'widget-expanded.css'), 'utf8')).not.toContain('.w-sess-tab')
    expect(readFileSync(src('styles', 'pokedex.css'), 'utf8')).not.toContain('.w-sess-tab')
  })

  it('the new words are in English and Japanese; the tab words are gone', () => {
    const words = ['간략', '상세', '목록 보기', '한 줄씩 (많이 보기)', '이름·상태·컨텍스트·모델까지', '세션 {n}', '셸 열기', '셸 열기 (포켓몬 없이 {shell})', '셸은 {n}개까지 열 수 있어요.']
    for (const ko of words) {
      expect(DICTS.en[ko], ko).toBeTruthy()
      expect(DICTS.ja[ko], ko).toBeTruthy()
    }
    expect(DICTS.en['세션 {n}']).toBe('Sessions {n}')
    expect(DICTS.ja['간략']).toBe('コンパクト')
    for (const gone of ['셸 탭 열기', '셸 탭 열기 (포켓몬 없이 {shell})', '셸 탭은 {n}개까지 열 수 있어요.']) {
      expect(DICTS.en[gone], gone).toBeUndefined()
      expect(DICTS.ja[gone], gone).toBeUndefined()
    }
  })
})
