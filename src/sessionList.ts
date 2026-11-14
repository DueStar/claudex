/**
 * sessionList.ts — the left list's helpers (unit-tested in plain Node): the context bar's tone,
 * the list mode (상세 / 간략) and its store, a 간략 row's tooltip, the session header's parts,
 * and the shell's name for the new-shell button.
 */

import { useSyncExternalStore } from 'react'
import { t } from './i18n'
import { isMac, platformWord } from './platform'

export type HpTone = 'hp-full' | 'hp-green' | 'hp-yellow' | 'hp-red'

/**
 * A session's context bar, drawn as the share of the window that is left (a Pokémon's HP):
 * nothing reported yet is the full, dimmed bar; green above half, amber at half and under,
 * red at a fifth and under.
 */
export function hpTone(left: number | null): HpTone {
  if (left === null) return 'hp-full'
  if (left <= 20) return 'hp-red'
  if (left <= 50) return 'hp-yellow'
  return 'hp-green'
}

// ---------------------------------------------------------------- the list mode

/**
 * The left list's two looks: 상세 (two lines, the context bar and model: as it always was) and
 * 간략 (one line each: picture, name, a context tick and the status dot). Kept per PC.
 */
export type ListMode = 'detail' | 'compact'
export const LIST_MODE_KEY = 'spawn-list-mode'

/** The saved mode: anything but 'compact' (nothing saved, storage blocked, an odd value) is 상세 */
export function readListMode(store: Pick<Storage, 'getItem'> | null | undefined): ListMode {
  try { return store?.getItem(LIST_MODE_KEY) === 'compact' ? 'compact' : 'detail' } catch { return 'detail' }
}

const pageStorage = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }

let listMode: ListMode = readListMode(pageStorage())
const listModeListeners = new Set<() => void>()

export function getListMode(): ListMode { return listMode }

export function setListMode(m: ListMode): void {
  if (m === listMode) return
  listMode = m
  try { pageStorage()?.setItem(LIST_MODE_KEY, m) } catch {}
  for (const l of listModeListeners) l()
}

function subscribeListMode(fn: () => void): () => void {
  listModeListeners.add(fn)
  return () => { listModeListeners.delete(fn) }
}

export function useListMode(): ListMode {
  return useSyncExternalStore(subscribeListMode, getListMode, getListMode)
}

// ---------------------------------------------------------------- rows and the header

/**
 * The shell a shell session runs, as main names it (the adapter's toolName: PowerShell, or the
 * login shell's basename on a Mac); before any shell is open, the platform's usual one
 */
export function shellLabel(rows: { shell?: boolean; terminal?: { toolName?: string } }[], mac: boolean = isMac()): string {
  return rows.find(r => r.shell && r.terminal?.toolName)?.terminal?.toolName ?? t(platformWord('shell', mac))
}

/**
 * A 간략 row's tooltip: what its second line and bottom line said in 상세 —
 * "<name or 새 세션> · <status> · <HP|컨텍스트> <n>%" (the last part only once the context is known).
 * `mood` is the status word's Korean key; every word goes through `tr` (t() in the app).
 * renamable: a second line says how to rename it (the name has no tooltip of its own in 간략,
 * where it spans most of the row and would hide this one).
 */
export function rowTooltip(
  p: { title: string | null; mood: string; left: number | null; barLabel: 'HP' | '컨텍스트'; renamable?: boolean },
  tr: (ko: string, vars?: Record<string, string | number>) => string,
): string {
  const parts = [p.title ?? tr('새 세션'), tr(p.mood)]
  if (p.left !== null) parts.push(`${tr(p.barLabel)} ${Math.round(p.left)}%`)
  return parts.join(' · ') + (p.renamable ? `\n${tr('더블클릭해서 세션 이름 바꾸기')}` : '')
}

export interface SessionHeaderParts {
  /** The same rule as a row's picture (sessionRowParts): the Pokémon, in 업무 모드 a glyph, a shell's prompt */
  picture: 'pokemon' | 'glyph' | 'shell'
  /** The session's own name; null: none yet (the caller says 새 세션). Never the Pokémon's name */
  name: string | null
  branch: string | null
  project: string
}

/** What the bar above the terminal shows for the session in view */
export function sessionHeaderParts(
  row: { title: string | null; name: string; project: string; branch?: string | null; shell?: boolean },
  workMode: boolean,
): SessionHeaderParts {
  return {
    picture: row.shell ? 'shell' : workMode ? 'glyph' : 'pokemon',
    name: row.title || null,
    branch: row.branch ?? null,
    project: row.project,
  }
}
