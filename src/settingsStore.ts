/**
 * settingsStore — the 설정 values in a page: fetched once, kept current by
 * settings:changed (the main process owns them, electron/settings.cjs).
 * Outside the app (a plain browser, the tests) the defaults stand.
 */

import { useSyncExternalStore } from 'react'
import { bridge, type AppSettings, type SettingsPatch } from './desktop'
import { WORK_MODE_CLASS } from './workMode'

export const DEFAULT_SETTINGS: AppSettings = {
  notify: { catch: true, flee: true, evolve: true, levelup: true, rareOnly: false, duration: 'normal', quiet: false, quietFrom: '23:00', quietTo: '08:00', sound: true, sessions: true },
  privacy: { hidePrompts: false },
  session: { defaultCwd: '', model: '', permissionMode: '', confirmClose: true, restoreOnStart: true, tools: [], defaultTool: 'claude' },
  app: { openAtLogin: false, startHidden: false, widgetOnTop: true, language: 'auto', workMode: false },
  terminal: { scrollback: 5000, font: 'default' },
}

/** 업무 모드 on the page's root element (src/workMode.ts), for the CSS */
function markWorkMode(on: boolean) {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle(WORK_MODE_CLASS, on)
}

// Until the settings arrive, 업무 모드 as the preload read it when the page loaded:
// a page that starts in it never draws a Pokémon first
let current: AppSettings = bridge?.settings?.workModeAtLoad
  ? { ...DEFAULT_SETTINGS, app: { ...DEFAULT_SETTINGS.app, workMode: true } }
  : DEFAULT_SETTINGS
markWorkMode(current.app.workMode)
const listeners = new Set<() => void>()
const take = (s: AppSettings | null | undefined) => { if (s) { current = s; markWorkMode(s.app.workMode === true); listeners.forEach(l => l()) } }

if (bridge?.settings) {
  bridge.settings.get().then(take).catch(() => {})
  bridge.settings.onChange(take)
}

/** The settings now (for code outside React, like sourceText) */
export const getSettings = (): AppSettings => current

export function useSettings(): AppSettings {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => current, () => current)
}

/** 업무 모드 is on (설정 › 앱, Ctrl+Shift+H) */
export function useWorkMode(): boolean {
  return useSettings().app.workMode === true
}

/** Change a part; the main process saves it and every window gets the new settings */
export async function changeSettings(patch: SettingsPatch): Promise<void> {
  if (!bridge?.settings) return
  take(await bridge.settings.set(patch))
}
