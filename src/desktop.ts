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
  /** Claude Code is waiting on a question (folder trust, a permission, a choice) */
  asking?: boolean
}

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
    create(opts?: { cwd?: string; resume?: string; sessionId?: string }): Promise<TerminalInfo | { error: string }>
    pickFolder(): Promise<string | null>
    history(): Promise<PastSession[]>
    buffer(id: string): Promise<string>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    send(id: string, text: string): Promise<{ ok: boolean; reason?: string }>
    close(id: string): Promise<void>
    rename(id: string, title: string): Promise<boolean>
    pathForFile(file: File): string
    openUrl(url: string): Promise<void>
    onData(fn: (p: { id: string; data: string }) => void): () => void
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
  }
}

export interface UpdateState {
  status: 'idle' | 'current' | 'available' | 'downloading' | 'ready'
  current: string
  latest: string | null
  notes: string
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

/** The 설정 screen's values (electron/settings.cjs keeps them and checks every change) */
export interface AppSettings {
  notify: { catch: boolean; flee: boolean; evolve: boolean; levelup: boolean; rareOnly: boolean; duration: 'short' | 'normal' | 'long'; quiet: boolean; quietFrom: string; quietTo: string }
  privacy: { hidePrompts: boolean }
  session: { defaultCwd: string; model: '' | 'opus' | 'sonnet' | 'haiku'; permissionMode: '' | 'default' | 'acceptEdits' | 'plan'; confirmClose: boolean }
  app: { openAtLogin: boolean; startHidden: boolean; widgetOnTop: boolean }
}
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

export function useTerminals(): TerminalInfo[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => terminals,
    () => terminals,
  )
}
