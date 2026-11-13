/**
 * 업무 모드 (src/workMode.ts): one switch that hides everything Pokémon while the
 * game keeps running. What each surface shows, the setting, the catch cards,
 * the shortcut and the words used while it is on.
 */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  VIEWS, WORK_MODE_KEY, WORK_MODE_SETTING_TEXT, WORK_MODE_UI_TEXT,
  autoPartner, isWorkModeKey, sessionLabel, sessionRowParts, shouldToast, viewIn, visibleViews,
} from '../src/workMode'
import DICTS from '../src/locales'
import part from '../src/locales/workMode'

const require = createRequire(import.meta.url)
const { DEFAULTS, sanitize, applyPatch, toastAllowed } = require('../electron/settings.cjs')
const { translator } = require('../electron/i18n.cjs')

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

describe('the shortcut', () => {
  const key = (o: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; code: string }>) =>
    ({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, code: '', ...o })

  it('is Ctrl+Shift+H, by the key (with any input language)', () => {
    expect(WORK_MODE_KEY).toBe('Ctrl+Shift+H')
    expect(isWorkModeKey(key({ ctrlKey: true, shiftKey: true, code: 'KeyH' }))).toBe(true)
  })

  it('not Ctrl+H (backspace in a terminal), Ctrl+Alt+Shift+H, or the app\'s other keys', () => {
    expect(isWorkModeKey(key({ ctrlKey: true, code: 'KeyH' }))).toBe(false)
    expect(isWorkModeKey(key({ ctrlKey: true, shiftKey: true, altKey: true, code: 'KeyH' }))).toBe(false)
    expect(isWorkModeKey(key({ ctrlKey: true, shiftKey: true, metaKey: true, code: 'KeyH' }))).toBe(false)
    for (const code of ['KeyT', 'KeyW', 'KeyC', 'KeyV']) expect(isWorkModeKey(key({ ctrlKey: true, shiftKey: true, code }))).toBe(false)
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

  it('the game-word check itself catches the words it is for', () => {
    for (const w of ['Lv.17 모래두지', 'HP 12', '도감', 'Pokédex', 'ポケモン', '포켓몬을 잡았어요']) expect(w).toMatch(GAME)
    expect('컨텍스트').not.toMatch(GAME)
  })
})
