/**
 * src/sessionList.ts — the left list's pure helpers. hpTone: the colour of a session's
 * context bar (what is left of the window, drained like a Pokémon's HP); the list mode
 * (상세 / 간략); a 간략 row's tooltip; what the session header shows. And the tab row's
 * removal (source checks).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hpTone, LIST_MODE_KEY, readListMode, rowTooltip, sessionHeaderParts } from '../src/sessionList'
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
