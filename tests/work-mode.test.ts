/**
 * 업무 모드 (src/workMode.ts): one switch that hides everything Pokémon while the
 * game keeps running. What each surface shows, the setting, the catch cards,
 * the shortcut and the words used while it is on.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  VIEWS, WORK_MODE_SETTING_TEXT, WORK_MODE_UI_TEXT,
  autoPartner, hideTitleKey, sessionLabel, sessionRowParts, shouldToast, viewIn, visibleViews, workModeKeyLabel,
} from '../src/workMode'
import { appShortcut, keptFromPty } from '../src/keys'
import { rowTooltip, sessionHeaderParts } from '../src/sessionList'
import { setPlatformForTest } from '../src/platform'
import DICTS from '../src/locales'
import part from '../src/locales/workMode'

const require = createRequire(import.meta.url)
const { DEFAULTS, sanitize, applyPatch, toastAllowed } = require('../electron/settings.cjs')
const { translator } = require('../electron/i18n.cjs')
const { macWindowOptions } = require('../electron/macWindow.cjs')

const noon = new Date(2026, 10, 13, 12)
const ROW = { title: null, name: '모래두지', project: 'todo-cli', level: 17, helpers: 2, helperSession: true }

describe('the setting', () => {
  it('is app.workMode, off by default, and kept as a yes/no', () => {
    expect(DEFAULTS.app.workMode).toBe(false)
    expect(sanitize(null).app.workMode).toBe(false)
    expect(applyPatch(sanitize(null), { app: { workMode: true } }).app.workMode).toBe(true)
    expect(sanitize({ app: { workMode: 'yes' } }).app.workMode).toBe(false)
    // turning it on changes nothing else
    const on = applyPatch(sanitize(null), { app: { workMode: true } })
    expect({ ...on, app: { ...on.app, workMode: false } }).toEqual(sanitize(null))
  })
})

describe('catch cards', () => {
  const catchEvent = { kind: 'catch', tier: 'legendary', shiny: true }

  it('none in work mode, whatever the notification settings say', () => {
    const on = applyPatch(sanitize(null), { app: { workMode: true } })
    for (const kind of ['catch', 'flee', 'evolve', 'levelup']) {
      expect(toastAllowed({ ...catchEvent, kind }, on, noon)).toBe(false)
      expect(shouldToast({ kind }, true)).toBe(false)
    }
  })

  it('as before with it off', () => {
    expect(toastAllowed(catchEvent, sanitize(null), noon)).toBe(true)
    expect(shouldToast({ kind: 'catch' }, false)).toBe(true)
    expect(shouldToast({ kind: 'sendout' }, false)).toBe(false)
    expect(shouldToast(null, false)).toBe(false)
  })
})

describe('views', () => {
  it('only the sessions in work mode; every view otherwise', () => {
    expect(visibleViews(true)).toEqual(['terminal'])
    expect(visibleViews(false)).toEqual(VIEWS)
  })

  it('a hidden view gives way to the sessions', () => {
    for (const v of VIEWS) expect(viewIn(v, true)).toBe('terminal')
    for (const v of VIEWS) expect(viewIn(v, false)).toBe(v)
  })
})

describe('a session row', () => {
  it('in work mode: a plain glyph, the folder, no level, helpers or swap, the bar labelled 컨텍스트', () => {
    const p = sessionRowParts(ROW, true)
    expect(p).toEqual({ picture: 'glyph', level: null, label: 'todo-cli', helpers: false, helperMark: false, swap: false, barLabel: '컨텍스트' })
    expect(JSON.stringify(p)).not.toContain('모래두지')
  })

  it('as before with it off: the Pokémon, Lv, its name, helpers, swap, HP', () => {
    expect(sessionRowParts(ROW, false)).toEqual({ picture: 'pokemon', level: 17, label: '모래두지', helpers: true, helperMark: true, swap: true, barLabel: 'HP' })
  })

  it('a shell tab keeps its prompt mark either way', () => {
    expect(sessionRowParts({ ...ROW, shell: true, level: null }, true).picture).toBe('shell')
    expect(sessionRowParts({ ...ROW, shell: true, level: null }, false).picture).toBe('shell')
  })
})

describe("a session's name in notifications and notes", () => {
  it("the trainer's name for it first", () => {
    expect(sessionLabel({ ...ROW, title: 'api 고치기' }, true)).toBe('api 고치기')
    expect(sessionLabel({ ...ROW, title: 'api 고치기' }, false)).toBe('api 고치기')
  })

  it('then its folder in work mode, never its Pokémon', () => {
    expect(sessionLabel(ROW, true)).toBe('todo-cli')
    expect(sessionLabel({ ...ROW, project: '' }, true)).toBeNull()
    expect(sessionLabel(ROW, false)).toBe('모래두지')
  })
})

describe('a new session in work mode (no picker)', () => {
  const dex = {
    party: ['a', 'b', 'c'], box: ['x', 'y'],
    mons: { a: {}, b: {}, c: {}, x: {}, y: {} },
    assign: { s1: 'a' }, helpers: { s1: ['x'] },
  }

  it('the remembered one if it rests in the party, else the first resting party one', () => {
    expect(autoPartner(dex, 'c')).toBe('c')
    expect(autoPartner(dex, 'a')).toBe('b') // a is working
    expect(autoPartner(dex)).toBe('b')
  })

  it('a resting box one as a helper once the party is all out, none when nobody is free', () => {
    const out = { ...dex, assign: { s1: 'a', s2: 'b', s3: 'c' } }
    expect(autoPartner(out)).toBe('y') // x helps a subagent
    expect(autoPartner({ ...out, assign: { ...out.assign, s4: 'y' } })).toBeNull()
  })
})

describe('the shortcut (src/keys.ts appShortcut → workMode)', () => {
  afterEach(() => setPlatformForTest(null))
  const key = (o: Partial<{ key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; code: string }>) =>
    ({ key: 'H', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, code: '', ...o }) as KeyboardEvent
  const isWorkModeKey = (e: KeyboardEvent) => appShortcut(e) === 'workMode'

  it('Windows: Ctrl+Shift+H, by the key (with any input language), named as before', () => {
    setPlatformForTest('win')
    expect(workModeKeyLabel(false)).toBe('Ctrl+Shift+H')
    expect(workModeKeyLabel()).toBe('Ctrl+Shift+H')
    expect(isWorkModeKey(key({ ctrlKey: true, shiftKey: true, code: 'KeyH' }))).toBe(true)
    expect(isWorkModeKey(key({ key: 'ㅗ', ctrlKey: true, shiftKey: true, code: 'KeyH' }))).toBe(true)
  })

  it("Windows: not Ctrl+H (backspace in a terminal), Ctrl+Alt+Shift+H, with ⊞, or the app's other keys", () => {
    setPlatformForTest('win')
    expect(isWorkModeKey(key({ ctrlKey: true, code: 'KeyH' }))).toBe(false)
    expect(isWorkModeKey(key({ ctrlKey: true, shiftKey: true, altKey: true, code: 'KeyH' }))).toBe(false)
    expect(isWorkModeKey(key({ ctrlKey: true, shiftKey: true, metaKey: true, code: 'KeyH' }))).toBe(false)
    expect(isWorkModeKey(key({ metaKey: true, shiftKey: true, code: 'KeyH' }))).toBe(false)
    for (const code of ['KeyT', 'KeyW', 'KeyC', 'KeyV']) expect(isWorkModeKey(key({ ctrlKey: true, shiftKey: true, code }))).toBe(false)
  })

  it("macOS: ⌘⇧H, never ⌘H (the menu's Hide) or Ctrl+Shift+H (the session's); kept from the pty", () => {
    setPlatformForTest('mac')
    expect(workModeKeyLabel(true)).toBe('⌘⇧H')
    expect(workModeKeyLabel()).toBe('⌘⇧H')
    const cmdShiftH = key({ metaKey: true, shiftKey: true, code: 'KeyH' })
    expect(isWorkModeKey(cmdShiftH)).toBe(true)
    expect(keptFromPty(cmdShiftH)).toBe(true)
    expect(isWorkModeKey(key({ key: 'ㅗ', metaKey: true, shiftKey: true, code: 'KeyH' }))).toBe(true)
    expect(isWorkModeKey(key({ key: 'h', metaKey: true, code: 'KeyH' }))).toBe(false)
    expect(isWorkModeKey(key({ key: 'h', metaKey: true, altKey: true, code: 'KeyH' }))).toBe(false)
    expect(isWorkModeKey(key({ ctrlKey: true, shiftKey: true, code: 'KeyH' }))).toBe(false)
    expect(isWorkModeKey(key({ ctrlKey: true, metaKey: true, shiftKey: true, code: 'KeyH' }))).toBe(false)
  })

  it("the setting's words name the platform's key; Windows reads exactly as 1.3.52", () => {
    const fill = (str: string, vars: Record<string, string>) => str.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m)
    const [, hint, title] = WORK_MODE_SETTING_TEXT
    expect(fill(DICTS.en[hint], { key: workModeKeyLabel(false) })).toMatch(/Shortcut: Ctrl\+Shift\+H$/)
    expect(fill(title, { key: workModeKeyLabel(false) })).toBe('업무 모드 켜고 끄기 (Ctrl+Shift+H)')
    expect(fill(DICTS.en[title], { key: workModeKeyLabel(true) })).toBe('Turn work mode on or off (⌘⇧H)')
  })

  it('both window handlers go through appShortcut (no key test of their own)', () => {
    const src = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8')
    expect(src('Widget.tsx')).toContain("if (action === 'workMode') {")
    expect(src('components/TerminalPanel.tsx')).toContain("case 'workMode':")
    expect(src('workMode.ts')).not.toContain('isWorkModeKey')
  })
})

describe('on a Mac (the platform passed explicitly)', () => {
  afterEach(() => setPlatformForTest(null))

  it("the widget's hide button names the menu bar icon, not the Poké Ball, in work mode", () => {
    expect(hideTitleKey(true, true)).toBe('숨기기 ({tray} 아이콘을 누르면 다시 열려요)')
    expect(hideTitleKey(false, true)).toBe('숨기기 ({tray}의 몬스터볼을 누르면 다시 열려요)')
    // Windows as 1.3.52
    expect(hideTitleKey(true, false)).toBe('숨기기 (트레이 아이콘을 누르면 다시 열려요)')
    expect(hideTitleKey(false, false)).toBe('숨기기 (작업 표시줄 트레이의 몬스터볼을 누르면 다시 열려요)')
    expect(DICTS.en[hideTitleKey(true, true)].replace('{tray}', 'menu bar')).toBe('Hide (click the menu bar icon to open it again)')
  })

  it("the profile takes the logo's place right of the traffic lights: the 78px room stays in work mode", () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'widget-expanded.css'), 'utf8')
    // The window and full screen keep the left room whatever the mode (the rule has no work-mode condition)
    expect(css).toContain('.is-mac .widget.mode-window .w-side .w-head, .is-mac .widget.mode-fullscreen .w-side .w-head { padding-left: 78px; }')
    expect(css).toContain('.is-mac .widget.expanded.side-hidden .w-rail { padding-top: 30px; }')
    // and no work-mode rule moves the header's start or the rail's top back under them
    const workRules = css.split('}').filter(r => r.includes('.work-mode'))
    expect(workRules.length).toBeGreaterThan(0)
    for (const r of workRules) {
      expect(r, r).not.toMatch(/padding(-left|-top)?\s*:|margin-left\s*:|position\s*:\s*(absolute|fixed)|(^|[\s;{])left\s*:|(^|[\s;{])top\s*:/)
      expect(r, r).not.toContain('.is-mac')
    }
    // The widget (frameless, no traffic lights) has no Mac header rule: it lays out as on Windows
    expect(css).not.toMatch(/\.is-mac [^{]*mode-widget/)
    expect(macWindowOptions('widget', 'darwin')).toEqual({ frame: false })
    expect(macWindowOptions('window', 'darwin')).toMatchObject({ trafficLightPosition: { x: 14, y: 14 } })
  })

  it('the sessions view only: ⌘1 opens it and ⌘2–5 open nothing, as Ctrl+1–5 on Windows', () => {
    for (const p of ['mac', 'win']) {
      setPlatformForTest(p)
      const mod = p === 'mac' ? { metaKey: true } : { ctrlKey: true }
      const views = visibleViews(true)
      for (const n of [1, 2, 3, 4, 5]) {
        const action = appShortcut({ key: String(n), code: `Digit${n}`, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mod } as KeyboardEvent)
        expect(action).toBe(`view${n}`)
        // Widget opens VIEWS[n - 1] only when it is visible
        expect(views.includes(VIEWS[n - 1])).toBe(n === 1)
      }
    }
  })
})

describe('the words', () => {
  const GAME = /포켓몬|몬스터볼|도감|박스|잡았|포획|파티|트레이너|Lv\.|\bHP\b|Pok[eé]|Poké|Pokédex|ポケモン|図鑑|ボックス|ゲット|トレーナー|モンスターボール/i
  const everyWord = [...WORK_MODE_UI_TEXT, ...WORK_MODE_SETTING_TEXT]

  it('every one is in Korean, English and Japanese', () => {
    for (const ko of everyWord) {
      expect(DICTS.en[ko], ko).toBeTruthy()
      expect(DICTS.ja[ko], ko).toBeTruthy()
    }
    // and the work-mode file holds nothing else
    expect(Object.keys(part.en).sort()).toEqual([...everyWord].sort())
    expect(Object.keys(part.ja).sort()).toEqual([...everyWord].sort())
  })

  it('the {key} placeholder survives translation', () => {
    for (const ko of everyWord.filter(k => k.includes('{key}'))) {
      expect(DICTS.en[ko]).toContain('{key}')
      expect(DICTS.ja[ko]).toContain('{key}')
    }
  })

  it('none shown in the session UI names the game, in any language', () => {
    for (const ko of WORK_MODE_UI_TEXT) {
      for (const text of [ko, DICTS.en[ko], DICTS.ja[ko]]) expect(text, text).not.toMatch(GAME)
    }
  })

  it("the main process's folder picker has a neutral title, in each language", () => {
    for (const lang of ['ko', 'en', 'ja']) {
      const title = translator(lang)('세션 폴더 선택')
      expect(title).not.toMatch(GAME)
      if (lang !== 'ko') expect(title).not.toBe('세션 폴더 선택')
    }
  })

  it("the session header and a 간략 row's tooltip name no Pokémon", () => {
    const head = JSON.stringify(sessionHeaderParts({ title: null, name: '모래두지', project: 'todo-cli', branch: 'main' }, true))
    expect(head).not.toMatch(GAME)
    expect(head).not.toContain('모래두지')
    expect(head).not.toContain('pokemon')
    for (const lang of ['ko', 'en', 'ja'] as const) {
      const tr = (k: string) => (lang === 'ko' ? k : DICTS[lang][k] ?? k)
      const tip = rowTooltip({ title: null, mood: '쉬는 중', left: 40, barLabel: sessionRowParts({ ...ROW, shell: false }, true).barLabel }, tr)
      expect(tip, tip).not.toMatch(GAME)
    }
  })

  it('the game-word check itself catches the words it is for', () => {
    for (const w of ['Lv.17 모래두지', 'HP 12', '도감', 'Pokédex', 'ポケモン', '포켓몬을 잡았어요']) expect(w).toMatch(GAME)
    expect('컨텍스트').not.toMatch(GAME)
  })
})
