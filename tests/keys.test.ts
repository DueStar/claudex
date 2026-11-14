/**
 * One shortcut map for the terminal and the window (src/keys.ts): Ctrl on Windows exactly
 * as before, ⌘ on macOS, where Ctrl keys belong to the session. Also the application menu
 * (electron/menu.cjs) and the tooltips that name the keys.
 */

import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { appShortcut, clipboardAction, keptFromPty, PINCH_STEP_MS, wheelFontStep } from '../src/keys'
import { modCombo, modLabel, setPlatformForTest } from '../src/platform'
import widgetDicts from '../src/locales/widget'
import allDicts from '../src/locales'

const require = createRequire(import.meta.url)
const { menuTemplate } = require('../electron/menu.cjs')

type Mods = { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }
/** A keydown as the browser reports it: e.key, e.code and the modifiers */
const key = (k: string, code: string, m: Mods = {}) => ({
  key: k, code,
  ctrlKey: !!m.ctrl, metaKey: !!m.meta, altKey: !!m.alt, shiftKey: !!m.shift,
}) as KeyboardEvent

const C = { ctrl: true }
const CS = { ctrl: true, shift: true }
const CA = { ctrl: true, alt: true }
const M = { meta: true }
const MS = { meta: true, shift: true }
const MA = { meta: true, alt: true }

afterEach(() => setPlatformForTest(null))

describe('appShortcut on Windows (as it has always been)', () => {
  const cases: [string, KeyboardEvent, string | null][] = [
    ['Ctrl+1', key('1', 'Digit1', C), 'view1'],
    ['Ctrl+2', key('2', 'Digit2', C), 'view2'],
    ['Ctrl+3', key('3', 'Digit3', C), 'view3'],
    ['Ctrl+4', key('4', 'Digit4', C), 'view4'],
    ['Ctrl+5', key('5', 'Digit5', C), 'view5'],
    ['Ctrl+6 is not a view', key('6', 'Digit6', C), null],
    ['Ctrl+Shift+1 is not a view', key('!', 'Digit1', CS), null],
    ['Ctrl+Alt+1 is not a view', key('1', 'Digit1', CA), null],
    ['1 alone', key('1', 'Digit1'), null],
    ['Ctrl+Alt+←', key('ArrowLeft', 'ArrowLeft', CA), 'prevView'],
    ['Ctrl+Alt+→', key('ArrowRight', 'ArrowRight', CA), 'nextView'],
    ['Ctrl+Alt+Shift+→', key('ArrowRight', 'ArrowRight', { ...CA, shift: true }), null],
    ['Ctrl+← stays the session\'s', key('ArrowLeft', 'ArrowLeft', C), null],
    ['Ctrl+Tab', key('Tab', 'Tab', C), 'nextTab'],
    ['Ctrl+Shift+Tab', key('Tab', 'Tab', CS), 'prevTab'],
    ['Ctrl+Alt+Tab', key('Tab', 'Tab', CA), null],
    ['Ctrl+Shift+T', key('T', 'KeyT', CS), 'newTab'],
    ['Ctrl+Shift+W', key('W', 'KeyW', CS), 'closeTab'],
    ['Ctrl+Shift+T on a Korean layout', key('ㅅ', 'KeyT', CS), 'newTab'],
    ['Ctrl+T stays Claude Code\'s', key('t', 'KeyT', C), null],
    ['Ctrl+W stays Claude Code\'s', key('w', 'KeyW', C), null],
    ['Ctrl+Shift+Alt+T', key('T', 'KeyT', { ...CS, alt: true }), null],
    ['Ctrl+F', key('f', 'KeyF', C), 'find'],
    ['Ctrl+F on a Korean layout', key('ㄹ', 'KeyF', C), 'find'],
    ['Ctrl+Shift+F', key('F', 'KeyF', CS), null],
    ['Ctrl+=', key('=', 'Equal', C), 'fontUp'],
    ['Ctrl+Shift+= (+)', key('+', 'Equal', CS), 'fontUp'],
    ['Ctrl++ on the keypad', key('+', 'NumpadAdd', C), 'fontUp'],
    ['Ctrl+-', key('-', 'Minus', C), 'fontDown'],
    ['Ctrl+0', key('0', 'Digit0', C), 'fontReset'],
    ['Ctrl+Alt+=', key('=', 'Equal', CA), null],
    ['Ctrl+V is not a shortcut', key('v', 'KeyV', C), null],
    ['Ctrl+C is not a shortcut', key('c', 'KeyC', C), null],
    ['⌘ means nothing on Windows', key('1', 'Digit1', M), null],
    ['Ctrl+Shift+H (work mode)', key('H', 'KeyH', CS), 'workMode'],
    ['Ctrl+Shift+H on a Korean layout', key('ㅗ', 'KeyH', CS), 'workMode'],
    ["Ctrl+H stays the session's (backspace)", key('h', 'KeyH', C), null],
    ['Ctrl+Alt+Shift+H', key('H', 'KeyH', { ...CS, alt: true }), null],
    ['Ctrl+Shift+⊞+H', key('H', 'KeyH', { ...CS, meta: true }), null],
    ['⌘⇧H means nothing on Windows', key('H', 'KeyH', MS), null],
  ]
  it.each(cases)('%s', (_name, e, want) => {
    setPlatformForTest('win')
    expect(appShortcut(e)).toBe(want)
  })
})

describe('Windows: the same answer as the 1.3.52 handlers (before src/keys.ts), for every key and modifier', () => {
  // The conditions as they stood in Widget.tsx and TerminalPanel.tsx in 1.3.52, in their order
  // (work mode's key first, as Widget checked it: src/workMode.ts isWorkModeKey)
  const before = (e: KeyboardEvent): string | null => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyH') return 'workMode'
    if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return e.key === 'ArrowRight' ? 'nextView' : 'prevView'
    if (e.ctrlKey && !e.altKey && e.key === 'Tab') return e.shiftKey ? 'prevTab' : 'nextTab'
    if (e.ctrlKey && e.shiftKey && !e.altKey && (e.code === 'KeyT' || e.code === 'KeyW')) return e.code === 'KeyT' ? 'newTab' : 'closeTab'
    if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-5]$/.test(e.key)) return `view${e.key}`
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyF') return 'find'
    if (e.ctrlKey && !e.altKey && (e.key === '=' || e.key === '+')) return 'fontUp'
    if (e.ctrlKey && !e.altKey && e.key === '-') return 'fontDown'
    if (e.ctrlKey && !e.altKey && e.key === '0') return 'fontReset'
    return null
  }
  const clipBefore = (e: KeyboardEvent, sel: boolean): string | null => {
    if (e.ctrlKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) return 'paste'
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && sel) return 'copy'
    return null
  }
  const keys: [string, string][] = [
    ...'0123456789'.split('').map(d => [d, `Digit${d}`] as [string, string]),
    ...'abcdefghijklmnopqrstuvwxyz'.split('').flatMap(c => [[c, `Key${c.toUpperCase()}`], [c.toUpperCase(), `Key${c.toUpperCase()}`]] as [string, string][]),
    ['ㅅ', 'KeyT'], ['ㅈ', 'KeyW'], ['ㄹ', 'KeyF'], ['ㅍ', 'KeyV'], ['ㅊ', 'KeyC'], ['ㅗ', 'KeyH'], ['く', 'KeyH'], ['!', 'Digit1'], [')', 'Digit0'],
    ['=', 'Equal'], ['+', 'Equal'], ['+', 'NumpadAdd'], ['-', 'Minus'], ['-', 'NumpadSubtract'], ['_', 'Minus'],
    ['Tab', 'Tab'], ['ArrowLeft', 'ArrowLeft'], ['ArrowRight', 'ArrowRight'], ['ArrowUp', 'ArrowUp'],
    ['Enter', 'Enter'], ['Process', 'Enter'], ['[', 'BracketLeft'], ['{', 'BracketLeft'], [']', 'BracketRight'],
  ]
  const mods: Mods[] = []
  for (let i = 0; i < 16; i++) mods.push({ ctrl: !!(i & 1), shift: !!(i & 2), alt: !!(i & 4), meta: !!(i & 8) })

  it('appShortcut and clipboardAction match on all of them', () => {
    setPlatformForTest('win')
    let n = 0
    for (const [k, code] of keys) {
      for (const m of mods) {
        const e = key(k, code, m)
        expect([k, code, m, appShortcut(e)]).toEqual([k, code, m, before(e)])
        for (const sel of [false, true]) expect([k, code, m, sel, clipboardAction(e, sel)]).toEqual([k, code, m, sel, clipBefore(e, sel)])
        n++
      }
    }
    expect(n).toBe(keys.length * 16)
  })
})

describe('appShortcut on macOS', () => {
  const cases: [string, KeyboardEvent, string | null][] = [
    ['⌘1', key('1', 'Digit1', M), 'view1'],
    ['⌘5', key('5', 'Digit5', M), 'view5'],
    ['⌘⇧1', key('!', 'Digit1', MS), null],
    ['⌘⌥←', key('ArrowLeft', 'ArrowLeft', MA), 'prevView'],
    ['⌘⌥→', key('ArrowRight', 'ArrowRight', MA), 'nextView'],
    ['⌘⇧[', key('{', 'BracketLeft', MS), 'prevTab'],
    ['⌘⇧]', key('}', 'BracketRight', MS), 'nextTab'],
    ['⌘[ alone', key('[', 'BracketLeft', M), null],
    ['⌘T', key('t', 'KeyT', M), 'newTab'],
    ['⌘W', key('w', 'KeyW', M), 'closeTab'],
    ['⌘T on a Korean layout', key('ㅅ', 'KeyT', M), 'newTab'],
    ['⌘⇧T', key('T', 'KeyT', MS), null],
    ['⌘F', key('f', 'KeyF', M), 'find'],
    ['⌘=', key('=', 'Equal', M), 'fontUp'],
    ['⌘⇧= (+)', key('+', 'Equal', MS), 'fontUp'],
    ['⌘-', key('-', 'Minus', M), 'fontDown'],
    ['⌘0', key('0', 'Digit0', M), 'fontReset'],
    // Ctrl keys are the session's on macOS
    ['Ctrl+1', key('1', 'Digit1', C), null],
    ['Ctrl+Tab', key('Tab', 'Tab', C), null],
    ['Ctrl+Shift+T', key('T', 'KeyT', CS), null],
    ['Ctrl+F', key('f', 'KeyF', C), null],
    ['Ctrl+=', key('=', 'Equal', C), null],
    ['Ctrl+Alt+→', key('ArrowRight', 'ArrowRight', CA), null],
    // ⌃⌘F is the system's full screen
    ['⌃⌘F', key('f', 'KeyF', { meta: true, ctrl: true }), null],
    // work mode: ⌘⇧H (⌘H is the app menu's Hide, ⌥⌘H Hide Others)
    ['⌘⇧H (work mode)', key('H', 'KeyH', MS), 'workMode'],
    ['⌘⇧H on a Korean layout', key('ㅗ', 'KeyH', MS), 'workMode'],
    ["⌘H stays the menu's Hide", key('h', 'KeyH', M), null],
    ['⌥⌘H stays Hide Others', key('h', 'KeyH', MA), null],
    ['⌥⌘⇧H', key('H', 'KeyH', { ...MS, alt: true }), null],
    ['⌃⌘⇧H', key('H', 'KeyH', { ...MS, ctrl: true }), null],
    ["Ctrl+Shift+H is the session's", key('H', 'KeyH', CS), null],
  ]
  it.each(cases)('%s', (_name, e, want) => {
    setPlatformForTest('mac')
    expect(appShortcut(e)).toBe(want)
  })
})

describe('clipboardAction', () => {
  it('Windows: Ctrl+V pastes, Ctrl+C copies only a selection (else it is the interrupt)', () => {
    setPlatformForTest('win')
    expect(clipboardAction(key('v', 'KeyV', C), false)).toBe('paste')
    expect(clipboardAction(key('V', 'KeyV', C), true)).toBe('paste')
    expect(clipboardAction(key('v', 'KeyV', CA), false)).toBe('paste')
    expect(clipboardAction(key('V', 'KeyV', CS), false)).toBe(null)
    expect(clipboardAction(key('c', 'KeyC', C), true)).toBe('copy')
    expect(clipboardAction(key('C', 'KeyC', CS), true)).toBe('copy')
    expect(clipboardAction(key('c', 'KeyC', C), false)).toBe(null)
    expect(clipboardAction(key('c', 'KeyC'), true)).toBe(null)
    expect(clipboardAction(key('v', 'KeyV'), false)).toBe(null)
    expect(clipboardAction(key('v', 'KeyV', M), false)).toBe(null)
    expect(clipboardAction(key('c', 'KeyC', M), true)).toBe(null)
  })

  it('macOS: ⌘V pastes, ⌘C copies a selection; Ctrl+C and Ctrl+V reach the session', () => {
    setPlatformForTest('mac')
    expect(clipboardAction(key('v', 'KeyV', M), false)).toBe('paste')
    expect(clipboardAction(key('ㅍ', 'KeyV', M), false)).toBe('paste')
    expect(clipboardAction(key('c', 'KeyC', M), true)).toBe('copy')
    expect(clipboardAction(key('c', 'KeyC', M), false)).toBe(null)
    expect(clipboardAction(key('c', 'KeyC', C), true)).toBe(null)
    expect(clipboardAction(key('c', 'KeyC', C), false)).toBe(null)
    expect(clipboardAction(key('v', 'KeyV', C), false)).toBe(null)
    expect(clipboardAction(key('V', 'KeyV', MS), false)).toBe(null)
  })
})

describe('keptFromPty: ⌘ keys never reach the session on macOS', () => {
  it('macOS: ⌘ keys are kept back (⌘A is xterm\'s select all); Ctrl keys pass', () => {
    setPlatformForTest('mac')
    expect(keptFromPty(key('k', 'KeyK', M))).toBe(true)
    expect(keptFromPty(key('Enter', 'Enter', M))).toBe(true)
    expect(keptFromPty(key('c', 'KeyC', M))).toBe(true)
    expect(keptFromPty(key('H', 'KeyH', MS))).toBe(true)
    expect(keptFromPty(key('a', 'KeyA', M))).toBe(false)
    expect(keptFromPty(key('c', 'KeyC', C))).toBe(false)
    expect(keptFromPty(key('v', 'KeyV', C))).toBe(false)
    expect(keptFromPty(key('a', 'KeyA'))).toBe(false)
  })

  it('Windows: nothing is kept back', () => {
    setPlatformForTest('win')
    expect(keptFromPty(key('k', 'KeyK', M))).toBe(false)
    expect(keptFromPty(key('c', 'KeyC', C))).toBe(false)
  })
})

describe('wheelFontStep', () => {
  const wheel = (deltaY: number, m: Mods = {}) => ({ deltaY, ctrlKey: !!m.ctrl, metaKey: !!m.meta }) as WheelEvent

  it('Windows: every Ctrl+wheel event is a step, as before', () => {
    setPlatformForTest('win')
    expect(wheelFontStep(wheel(-100, C), 1000, 990)).toEqual({ step: 1, pinchAt: 990 })
    expect(wheelFontStep(wheel(100, C), 1000, 990)).toEqual({ step: -1, pinchAt: 990 })
    expect(wheelFontStep(wheel(0, C), 1000, 0)).toEqual({ step: -1, pinchAt: 0 })
    expect(wheelFontStep(wheel(-100), 1000, 0)).toBe(null)
    expect(wheelFontStep(wheel(-100, M), 1000, 0)).toBe(null)
  })

  it('macOS: ⌘+wheel steps every event; a pinch (Ctrl wheel) at most once per 120 ms', () => {
    setPlatformForTest('mac')
    expect(PINCH_STEP_MS).toBe(120)
    expect(wheelFontStep(wheel(-3, M), 1000, 990)).toEqual({ step: 1, pinchAt: 990 })
    expect(wheelFontStep(wheel(3, M), 1000, 990)).toEqual({ step: -1, pinchAt: 990 })
    expect(wheelFontStep(wheel(-3), 1000, 0)).toBe(null)
    // pinch out = bigger, pinch in = smaller
    expect(wheelFontStep(wheel(-2, C), 1000, 0)).toEqual({ step: 1, pinchAt: 1000 })
    expect(wheelFontStep(wheel(2, C), 1000, 0)).toEqual({ step: -1, pinchAt: 1000 })
    // too soon after the last step: taken (no scroll) but no step
    expect(wheelFontStep(wheel(-2, C), 1050, 1000)).toEqual({ step: 0, pinchAt: 1000 })
    expect(wheelFontStep(wheel(-2, C), 1119, 1000)).toEqual({ step: 0, pinchAt: 1000 })
    expect(wheelFontStep(wheel(-2, C), 1120, 1000)).toEqual({ step: 1, pinchAt: 1120 })
    // a pinch event with no movement does not use up the step
    expect(wheelFontStep(wheel(0, C), 2000, 1000)).toEqual({ step: 0, pinchAt: 1000 })
  })
})

describe('tooltips name the platform\'s keys', () => {
  const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m)
  const views: [string, string, string, string][] = [
    ['세션 ({key})', '1', 'Sessions', 'セッション'],
    ['도감 ({key})', '2', 'Pokédex', '図鑑'],
    ['박스 ({key})', '3', 'Box', 'ボックス'],
    ['기록 ({key})', '4', 'Log', '記録'],
    ['랭킹 ({key})', '5', 'Leaderboard', 'ランキング'],
  ]

  it('the first view is 세션: the old 터미널 ({key}) tooltip key is gone', () => {
    expect(widgetDicts.en).not.toHaveProperty('터미널 ({key})')
    expect(widgetDicts.ja).not.toHaveProperty('터미널 ({key})')
    expect(allDicts.en['세션']).toBe('Sessions')
    expect(allDicts.ja['세션']).toBe('セッション')
  })

  it('modCombo: Ctrl+1 on Windows, ⌘1 on macOS', () => {
    setPlatformForTest('win')
    expect(modCombo('1')).toBe('Ctrl+1')
    expect(modLabel()).toBe('Ctrl')
    setPlatformForTest('mac')
    expect(modCombo('1')).toBe('⌘1')
    expect(modLabel()).toBe('⌘')
  })

  it('Windows reads exactly as before, in ko / en / ja', () => {
    setPlatformForTest('win')
    for (const [ko, n, en, ja] of views) {
      const vars = { key: modCombo(n) }
      expect(fill(ko, vars)).toBe(ko.replace('{key}', `Ctrl+${n}`))
      expect(fill(widgetDicts.en[ko], vars)).toBe(`${en} (Ctrl+${n})`)
      expect(fill(widgetDicts.ja[ko], vars)).toBe(`${ja} (Ctrl+${n})`)
    }
    const vars = { mod: modLabel() }
    expect(fill('글자 크기 ({mod}+휠로도 바꿀 수 있어요)', vars)).toBe('글자 크기 (Ctrl+휠로도 바꿀 수 있어요)')
    expect(fill('글자 크기 · {mod}+휠, {mod}+= / {mod}+-', vars)).toBe('글자 크기 · Ctrl+휠, Ctrl+= / Ctrl+-')
    expect(fill(widgetDicts.en['글자 크기 ({mod}+휠로도 바꿀 수 있어요)'], vars)).toBe('Text size (Ctrl+wheel works too)')
    expect(fill(widgetDicts.en['글자 크기 · {mod}+휠, {mod}+= / {mod}+-'], vars)).toBe('Text size · Ctrl+wheel, Ctrl+= / Ctrl+-')
    expect(fill(widgetDicts.ja['글자 크기 ({mod}+휠로도 바꿀 수 있어요)'], vars)).toBe('文字サイズ（Ctrl+ホイールでも変更できます）')
    expect(fill(widgetDicts.ja['글자 크기 · {mod}+휠, {mod}+= / {mod}+-'], vars)).toBe('文字サイズ · Ctrl+ホイール、Ctrl+= / Ctrl+-')
  })

  it('macOS names ⌘', () => {
    setPlatformForTest('mac')
    expect(fill(widgetDicts.en['세션 ({key})'], { key: modCombo('1') })).toBe('Sessions (⌘1)')
    expect(fill(widgetDicts.en['글자 크기 · {mod}+휠, {mod}+= / {mod}+-'], { mod: modLabel() })).toBe('Text size · ⌘+wheel, ⌘+= / ⌘+-')
  })
})

describe('application menu (electron/menu.cjs)', () => {
  const t = (ko: string) => ko
  const toggleWidget = () => {}
  const roles = (items: { role?: string; type?: string }[]) => items.map(i => i.role ?? i.type)

  it('Windows: the menu as before, edit shortcuts not registered', () => {
    const tpl = menuTemplate({ platform: 'win32', appName: 'spawn', t, toggleWidget })
    expect(tpl).toHaveLength(2)
    expect(tpl[0].label).toBe('spawn')
    expect(tpl[0].submenu[0]).toEqual({ label: '보이기/숨기기', click: toggleWidget })
    expect(roles(tpl[0].submenu.slice(1))).toEqual(['separator', 'reload', 'toggleDevTools', 'separator', 'quit'])
    expect(tpl[1].label).toBe('편집')
    expect(tpl[1].submenu).toEqual(['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'separator', 'selectAll']
      .map(role => (role === 'separator' ? { type: 'separator' } : { role, registerAccelerator: false })))
  })

  it('macOS: app menu, edit menu with its ⌘ shortcuts, window menu', () => {
    const tpl = menuTemplate({ platform: 'darwin', appName: 'spawn', t, toggleWidget })
    expect(tpl[0]).toEqual({ role: 'appMenu' })
    expect(tpl[1].label).toBe('spawn')
    expect(roles(tpl[1].submenu.slice(1))).toEqual(['separator', 'reload', 'toggleDevTools'])
    expect(tpl[2].label).toBe('편집')
    expect(tpl[2].submenu).toEqual(['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'separator', 'selectAll']
      .map(role => (role === 'separator' ? { type: 'separator' } : { role })))
    expect(tpl[3].label).toBe('창')
    expect(tpl[3].role).toBe('window')
    expect(roles(tpl[3].submenu)).toEqual(['minimize', 'zoom', 'separator', 'close'])
  })

  it('macOS: no menu item takes ⌘⇧H (work mode) or names the game; no menu item opens a view', () => {
    const tpl = menuTemplate({ platform: 'darwin', appName: 'spawn', t, toggleWidget })
    const items: { label?: string; role?: string; accelerator?: string; submenu?: unknown }[] = []
    const walk = (list: typeof items) => { for (const i of list) { items.push(i); if (Array.isArray(i.submenu)) walk(i.submenu as typeof items) } }
    walk(tpl)
    // appMenu's own items (about, services, hide ⌘H, hide others ⌥⌘H, show all, quit ⌘Q) come from
    // its role; none of the template's own items carries an accelerator
    expect(items.filter(i => i.accelerator)).toEqual([])
    expect(items.map(i => i.label).filter(Boolean)).toEqual(['spawn', '보이기/숨기기', '편집', '창'])
  })
})
