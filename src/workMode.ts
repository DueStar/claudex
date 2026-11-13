/**
 * workMode — 업무 모드 (설정 › 앱, Ctrl+Shift+H): one switch that hides
 * everything Pokémon, so the app looks like a plain session tool at the office
 * or in public. The game keeps running underneath (steps, levels, encounters,
 * catches, the Pokédex, cloud sync, ranking); turning it off shows it all again.
 *
 * One source of truth: settings `app.workMode` (electron/settings.cjs). The
 * pages read it through useWorkMode() and put WORK_MODE_CLASS on their root
 * element (src/settingsStore.ts); the main process reads the same setting for
 * the catch cards and its own words. What each surface shows is decided here,
 * in small functions the tests can call.
 */

/** On the document element of every page while the mode is on */
export const WORK_MODE_CLASS = 'work-mode'

/**
 * The shortcut. Free on Windows, in Chromium and in the app; Claude Code has
 * nothing on it either (a terminal can't tell Ctrl+Shift+H from Ctrl+H, which
 * is backspace there). The app takes it before the terminal, so the pty never
 * gets it.
 */
export const WORK_MODE_KEY = 'Ctrl+Shift+H'
export function isWorkModeKey(e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey?: boolean; code: string }): boolean {
  // By the key's place (code), so it works with the Korean or Japanese input on
  return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyH'
}

/** The app's views, in their Ctrl+1–5 order */
export const VIEWS = ['terminal', 'dex', 'box', 'today', 'rank'] as const
export type View = (typeof VIEWS)[number]

/** The views that can be opened: only the sessions in work mode (도감 / 박스 / 기록 / 랭킹 hidden) */
export function visibleViews(workMode: boolean): readonly View[] {
  return workMode ? ['terminal'] : VIEWS
}

/** The view on screen: a hidden one gives way to the sessions */
export function viewIn(view: View, workMode: boolean): View {
  return visibleViews(workMode).includes(view) ? view : 'terminal'
}

/** The game events that pop up as a card (the ?toast window): none in work mode */
const TOAST_KINDS = new Set(['catch', 'flee', 'evolve', 'levelup'])
export function shouldToast(event: { kind?: string } | null | undefined, workMode: boolean): boolean {
  return !workMode && !!event && TOAST_KINDS.has(String(event.kind))
}

export interface SessionRowInput {
  /** The trainer's name for the session */
  title: string | null
  /** The Pokémon working it (its name) */
  name: string
  /** The session's folder */
  project: string
  /** The Pokémon's level, when one works it */
  level: number | null
  /** Box Pokémon helping its subagents */
  helpers: number
  /** Worked by a box Pokémon (the party was all out) */
  helperSession?: boolean
  /** A plain shell tab */
  shell?: boolean
}

export interface SessionRowParts {
  /** Left of the row: the Pokémon, a neutral session glyph, or the shell's prompt mark */
  picture: 'pokemon' | 'glyph' | 'shell'
  /** "Lv.17" before the name; null: none */
  level: number | null
  /** Line 2's first words: the Pokémon's name, or in work mode the folder */
  label: string
  /** The helpers' pictures */
  helpers: boolean
  /** The mark of a session worked by a box Pokémon */
  helperMark: boolean
  /** The swap button (another Pokémon for the session) */
  swap: boolean
  /** The context bar's label: 'HP', or in work mode '컨텍스트' (a Korean key, through t()) */
  barLabel: 'HP' | '컨텍스트'
}

/**
 * What a session row in the side panel shows. In work mode it keeps the session's
 * name, folder, branch, status, model and tokens; the context bar stays, as a
 * plain context bar.
 */
export function sessionRowParts(row: SessionRowInput, workMode: boolean): SessionRowParts {
  if (workMode) {
    return { picture: row.shell ? 'shell' : 'glyph', level: null, label: row.project, helpers: false, helperMark: false, swap: false, barLabel: '컨텍스트' }
  }
  return {
    picture: row.shell ? 'shell' : 'pokemon', level: row.level, label: row.name,
    helpers: row.helpers > 0, helperMark: row.helperSession === true, swap: row.level !== null, barLabel: 'HP',
  }
}

/**
 * The name a session goes by in a notification, the question card and notes: the
 * trainer's name for it, else its Pokémon's, in work mode its folder. null: none
 * (the caller says 새 세션).
 */
export function sessionLabel(row: { title: string | null; name: string; project: string }, workMode: boolean): string | null {
  if (row.title) return row.title
  return workMode ? (row.project || null) : row.name
}

interface PartnerDex {
  party: string[]
  box: string[]
  mons: Record<string, unknown>
  assign?: Record<string, string>
  helpers?: Record<string, string[]>
}

/**
 * Work mode opens a session without the "who goes?" picker: the Pokémon goes out
 * all the same, picked as a restored session picks it (`prefer` if it is resting
 * in the party, else the first resting party one, else a resting box one as a
 * helper). null: nobody is free.
 */
export function autoPartner(dex: PartnerDex, prefer?: string | null): string | null {
  const busy = new Set(Object.values(dex.assign ?? {}))
  const party = dex.party.filter(uid => dex.mons[uid] && !busy.has(uid))
  if (prefer && party.includes(prefer)) return prefer
  if (party.length) return party[0]
  const helping = new Set([...busy, ...Object.values(dex.helpers ?? {}).flat()])
  return dex.box.find(uid => dex.mons[uid] && !helping.has(uid)) ?? null
}

/**
 * The words the session UI shows only in work mode (Korean keys; en / ja in
 * src/locales/workMode.ts). None of them may name the game.
 */
export const WORK_MODE_UI_TEXT = [
  '컨텍스트',
  '지시하기…',
  '숨기기 (트레이 아이콘을 누르면 다시 열려요)',
] as const

/** The switch in 설정 › 앱 (settings may speak of the game: a passer-by does not open them) */
export const WORK_MODE_SETTING_TEXT = [
  '업무 모드',
  '포켓몬 그림과 이름, 도감·박스·기록·랭킹, 포획 알림을 숨겨서 평범한 세션 도구처럼 보여요. 게임은 그대로 계속돼요. 단축키 {key}',
  '업무 모드 켜고 끄기 ({key})',
] as const
