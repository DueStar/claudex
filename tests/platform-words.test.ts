/**
 * src/platform.ts platformWord: the words that differ per platform
 * (tray, startup, taskbar flash, shell), in each language. The Windows
 * wording must stay exactly as it was.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { platformWord, setPlatformForTest } from '../src/platform'
import { t } from '../src/i18n'
import { getSettings } from '../src/settingsStore'

// The language is read from the settings object: pin it here, restore it after
const app = getSettings().app
const original = app.language
const setLang = (l: 'ko' | 'en' | 'ja') => { app.language = l }

afterEach(() => { setPlatformForTest(null); app.language = original })

const say = (lang: 'ko' | 'en' | 'ja', key: Parameters<typeof platformWord>[0], mac: boolean) => {
  setLang(lang)
  return t(platformWord(key, mac))
}

describe('platformWord', () => {
  it('names the Mac words in ko / en / ja', () => {
    expect(['ko', 'en', 'ja'].map(l => say(l as 'ko', 'tray', true))).toEqual(['메뉴 막대', 'menu bar', 'メニューバー'])
    expect(['ko', 'en', 'ja'].map(l => say(l as 'ko', 'startup', true))).toEqual(['로그인 시 실행', 'Open at login', 'ログイン時に起動'])
    expect(['ko', 'en', 'ja'].map(l => say(l as 'ko', 'shell', true))).toEqual(['zsh', 'zsh', 'zsh'])
  })

  it('keeps the Windows words as they were', () => {
    expect(['ko', 'en', 'ja'].map(l => say(l as 'ko', 'startup', false))).toEqual(['Windows 시작 시 실행', 'Launch at Windows startup', 'Windows 起動時に開く'])
    expect(['ko', 'en', 'ja'].map(l => say(l as 'ko', 'shell', false))).toEqual(['PowerShell', 'PowerShell', 'PowerShell'])
    expect(say('en', 'tray', false)).toBe('tray')
  })
})

describe('sentences that name the platform', () => {
  const sentence = (lang: 'ko' | 'en' | 'ja', ko: string, vars?: Record<string, string>) => { setLang(lang); return t(ko, vars) }

  it('new-shell tooltip: PowerShell on Windows as before, the shell on Mac', () => {
    const k = '셸 열기 (포켓몬 없이 {shell})'
    expect(sentence('ko', k, { shell: 'PowerShell' })).toBe('셸 열기 (포켓몬 없이 PowerShell)')
    expect(sentence('en', k, { shell: 'PowerShell' })).toBe('Open a shell (PowerShell, no Pokémon)')
    expect(sentence('ja', k, { shell: 'PowerShell' })).toBe('シェルを開く(ポケモンなしのPowerShell)')
    expect(sentence('en', k, { shell: 'zsh' })).toBe('Open a shell (zsh, no Pokémon)')
    expect(sentence('ja', k, { shell: 'zsh' })).toBe('シェルを開く(ポケモンなしのzsh)')
  })

  it('has a Mac sentence in every language for the tray and Dock wording', () => {
    for (const k of ['숨기기 ({tray}의 몬스터볼을 누르면 다시 열려요)', '닫기 ({tray} 아이콘을 누르면 다시 열려요. 세션은 계속 돌아가요)',
      '시작 시 {tray}로 최소화', '창을 띄우지 않고 시작해요. {tray}의 몬스터볼로 열 수 있어요',
      '앱을 보고 있지 않을 때 세션이 일을 마치거나 확인이 필요하면 알림을 띄우고 Dock 아이콘을 튀겨요']) {
      const en = sentence('en', k, { tray: 'menu bar' }); const ja = sentence('ja', k, { tray: 'メニューバー' })
      expect(en).not.toBe(k); expect(ja).not.toBe(k)
      expect(en).not.toMatch(/[가-힣{}]/); expect(ja).not.toMatch(/[가-힣{}]/)
    }
    expect(sentence('en', '숨기기 ({tray}의 몬스터볼을 누르면 다시 열려요)', { tray: 'menu bar' })).toBe('Hide (click the Poké Ball in the menu bar to bring it back)')
  })

  it('keeps the Windows sentences', () => {
    expect(sentence('en', '숨기기 (작업 표시줄 트레이의 몬스터볼을 누르면 다시 열려요)')).toBe('Hide (click the Poké Ball in the taskbar tray to bring it back)')
    expect(sentence('en', 'Windows 시작 시 실행')).toBe('Launch at Windows startup')
    expect(sentence('en', '앱을 보고 있지 않을 때 세션이 일을 마치거나 확인이 필요하면 Windows 알림을 띄우고 작업 표시줄을 깜빡여요'))
      .toBe('When the app is not in front and a session finishes or needs you, show a Windows notification and flash the taskbar button')
  })

  it('names Git plainly on a Mac', () => {
    expect(sentence('en', 'Git')).toBe('Git')
    expect(sentence('en', '선택 사항이에요')).toBe('Optional')
    expect(sentence('ja', '선택 사항이에요')).toBe('任意です')
  })
})

describe('the new-shell button names the shell main runs', () => {
  it("an open shell tab's toolName (main's name for it), else the platform's usual shell", async () => {
    const { shellLabel } = await import('../src/sessionList')
    setLang('en')
    expect(shellLabel([{ shell: true, terminal: { toolName: 'bash' } as never }], true)).toBe('bash')
    expect(shellLabel([{ shell: false, terminal: { toolName: 'Codex CLI' } as never }], true)).toBe('zsh')
    expect(shellLabel([], true)).toBe('zsh')
    // Windows: PowerShell either way, as before
    expect(shellLabel([], false)).toBe('PowerShell')
    expect(shellLabel([{ shell: true, terminal: { toolName: 'PowerShell' } as never }], false)).toBe('PowerShell')
  })

  it('the taskbar word is gone (nothing used it)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const locales = readFileSync(join(__dirname, '..', 'src', 'locales', 'settings.ts'), 'utf8')
    expect(locales).not.toContain('작업 표시줄 깜빡이기')
    expect(locales).not.toContain('Dock 아이콘 튀기기')
  })
})
