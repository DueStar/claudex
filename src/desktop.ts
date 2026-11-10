/**
 * desktop.ts — the bridge to the desktop app (electron/preload.cjs). In a
 * plain browser `window.claudex` is absent and every helper is a no-op
 * (no terminals, no game actions).
 */

import { useSyncExternalStore } from 'react'

export interface TerminalInfo {
  id: string
  sessionId: string
  cwd: string
  project: string
  status: 'running' | 'exited'
  createdAt: number
  exitCode: number | null
  /** The trainer's name for the session, if given */
  title: string | null
  /** The session is waiting on a question (folder trust, a permission, a choice) */
  asking?: boolean
  /** The AI tool it runs: 'claude' (Claude Code) or an id from 설정 › 세션 › AI 도구 */
  tool?: string
  toolName?: string
  /** Only Claude Code sessions resume by id */
  canResume?: boolean
}

/** Another AI tool a session can run (설정 › 세션 › AI 도구) */
export interface AiTool { id: string; name: string; command: string }

export interface PastSession {
  id: string
  cwd: string
  project: string
  title: string
  updatedAt: number
  sizeKb: number
  /** Its Claude Code process is still running somewhere (another terminal, or this app) */
  running: boolean
}

interface ClaudexBridge {
  isDesktop: true
  terminals: {
    list(): Promise<TerminalInfo[]>
    create(opts?: { cwd?: string; resume?: string; sessionId?: string; tool?: string }): Promise<TerminalInfo | { error: string }>
    pickFolder(): Promise<string | null>
    /** The sessions open when the app last closed, once per run; none when 설정 › 세션 says not to */
    restorable(): Promise<{ sessionId: string; cwd: string; tool: string }[]>
    /** The git branch of each folder (null: not in a repository) */
    branches(dirs: string[]): Promise<Record<string, string | null>>
    history(): Promise<PastSession[]>
    /** The output so far, and the number of the last batch in it (terminals:data carries each batch's) */
    buffer(id: string): Promise<{ data: string; seq: number }>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    send(id: string, text: string): Promise<{ ok: boolean; reason?: string }>
    close(id: string): Promise<void>
    rename(id: string, title: string): Promise<boolean>
    /** Drag a tab: put it at `index` in the tab order */
    move(id: string, index: number): Promise<boolean>
    pathForFile(file: File): string
    openUrl(url: string): Promise<void>
    /** A file named in a session's output, at a line: opened in the code editor (Ctrl+click) */
    openPath(id: string, file: string, line?: number, col?: number): Promise<boolean>
    onData(fn: (p: { id: string; data: string; seq: number }) => void): () => void
    onList(fn: (list: TerminalInfo[]) => void): () => void
  }
  cloud: {
    signIn(): Promise<{ ok: boolean; reason?: string }>
    signOut(): Promise<{ ok: boolean }>
    sync(): Promise<{ ok: boolean; reason?: string }>
  }
  settings: {
    get(): Promise<AppSettings>
    /** A part of the settings ({ notify: { flee: false } }); the whole new settings come back */
    set(patch: SettingsPatch): Promise<AppSettings>
    onChange(fn: (s: AppSettings) => void): () => void
    /** The tray's 설정: open the settings screen */
    onOpen(fn: () => void): () => void
  }
  board: {
    get(board: BoardKind): Promise<{ ok: boolean; reason?: string; rows?: BoardRow[] }>
    profile(): Promise<{ ok: boolean; reason?: string; profile?: BoardProfile | null }>
    setProfile(p: { nickname: string; isPublic: boolean; partner: number | null }): Promise<{ ok: boolean; reason?: string }>
  }
  data: {
    exportBackup(): Promise<{ ok: boolean; path?: string; reason?: string }>
    openFolder(): Promise<boolean>
  }
  env: {
    check(): Promise<Record<'claude' | 'git', { ok: boolean; version: string | null; link: string }>>
    openLink(key: 'claude' | 'git' | 'release'): Promise<void>
  }
  toast: {
    show(event: unknown): void
    done(): void
    /** The toast page listens now: main sends what waited */
    ready(): void
    /** A notification was clicked: the app window opens the Pokédex at this species */
    open(id: number): void
    onEvent(fn: (event: any) => void): () => void
  }
  game: {
    throw(sessionId: string, uid: string): Promise<{ ok: boolean; reason?: string }>
    release(uid: string): Promise<{ ok: boolean; reason?: string }>
    exchange(boxUid: string, partyUid: string): Promise<{ ok: boolean; reason?: string }>
    /** The box in the trainer's own order (every box Pokémon, each once) */
    arrange(order: string[]): Promise<{ ok: boolean; reason?: string }>
    swap(sessionId: string, uid: string): Promise<{ ok: boolean; reason?: string }>
  }
  update: {
    get(): Promise<UpdateState | null>
    install(): Promise<UpdateState | null>
    restart(): Promise<boolean>
    onState(fn: (s: UpdateState) => void): () => void
  }
  widget: {
    hide(): Promise<void>
    getMode(): Promise<WidgetMode>
    minimize(): Promise<void>
    setMode(mode: WidgetMode): Promise<WidgetMode>
    onMode(fn: (mode: WidgetMode) => void): () => void
    onOpenDex(fn: (id: number) => void): () => void
    resize(width: number, height: number): void
    /** A Windows notification and a flashing taskbar button, only while the app is not in front */
    alert(title: string, body: string): void
  }
}

export interface UpdateState {
  status: 'idle' | 'current' | 'available' | 'downloading' | 'ready'
  current: string
  latest: string | null
  notes: string
  /** The same notes in English and Japanese; empty from a manifest that has none */
  notesEn?: string
  notesJa?: string
  progress: number
  error: string | null
  /** The new release needs a new Electron: download the full app instead */
  needsFull: boolean
  page: string
}

export type WidgetMode = 'widget' | 'window' | 'fullscreen'

declare global {
  interface Window { claudex?: ClaudexBridge }
}

/** The app's languages (src/i18n.ts) */
export type Lang = 'ko' | 'en' | 'ja'

/** The 설정 screen's values (electron/settings.cjs keeps them and checks every change) */
export interface AppSettings {
  notify: { catch: boolean; flee: boolean; evolve: boolean; levelup: boolean; rareOnly: boolean; duration: 'short' | 'normal' | 'long'; quiet: boolean; quietFrom: string; quietTo: string; sound: boolean; sessions: boolean }
  privacy: { hidePrompts: boolean }
  session: { defaultCwd: string; model: '' | 'opus' | 'sonnet' | 'haiku'; permissionMode: '' | 'default' | 'acceptEdits' | 'plan' | 'auto'; confirmClose: boolean; restoreOnStart: boolean; tools: AiTool[]; defaultTool: string }
  app: { openAtLogin: boolean; startHidden: boolean; widgetOnTop: boolean; language: 'auto' | Lang }
  terminal: { scrollback: 1000 | 5000 | 10000 | 50000; font: TerminalFont }
}
/** The terminal font choices (their font stacks: src/termFont.ts) */
export type TerminalFont = 'default' | 'consolas' | 'cascadia' | 'd2coding'
export type BoardKind = 'caught' | 'shiny' | 'legends' | 'week'
export interface BoardRow { place: number; rn: number; nickname: string; partner: number | null; value: number; me: boolean }
export interface BoardProfile { nickname: string; isPublic: boolean; partner: number | null; caught: number; shiny: number; legends: number; week: number; flagged: boolean }
export type SettingsPatch = { [G in keyof AppSettings]?: Partial<AppSettings[G]> }

export const bridge: ClaudexBridge | null = typeof window !== 'undefined' ? window.claudex ?? null : null
export const isDesktop = !!bridge

let terminals: TerminalInfo[] = []
const listeners = new Set<() => void>()

function setList(list: TerminalInfo[]) {
  terminals = list
  // Who each session is drawn as comes from the server's game state (src/pokedexStore.ts)
  listeners.forEach(l => l())
}

if (bridge) {
  bridge.terminals.list().then(setList).catch(() => {})
  bridge.terminals.onList(setList)
}

// Terminal output: one subscription for the whole page, handed to the terminal it is for.
// A subscription per terminal copied every chunk across the bridge once per open terminal.
const dataHandlers = new Map<string, Set<(data: string, seq: number) => void>>()
let dataSubscribed = false

/** Output of one terminal; returns the unsubscribe */
export function onTerminalData(id: string, fn: (data: string, seq: number) => void): () => void {
  if (!bridge) return () => {}
  if (!dataSubscribed) {
    dataSubscribed = true
    bridge.terminals.onData(({ id: from, data, seq }) => { dataHandlers.get(from)?.forEach(h => h(data, seq)) })
  }
  let set = dataHandlers.get(id)
  if (!set) { set = new Set(); dataHandlers.set(id, set) }
  set.add(fn)
  return () => {
    const s = dataHandlers.get(id)
    if (!s) return
    s.delete(fn)
    if (!s.size) dataHandlers.delete(id)
  }
}

export function useTerminals(): TerminalInfo[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => terminals,
    () => terminals,
  )
}
