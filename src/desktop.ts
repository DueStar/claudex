/**
 * desktop.ts — the bridge to the desktop app (electron/preload.cjs). In a
 * plain browser `window.pokeOffice` is absent and every helper is a no-op, so
 * the office still runs as a web page (read-only, no terminals).
 */

import { useSyncExternalStore } from 'react'

export interface TerminalInfo {
  id: string
  sessionId: string
  cwd: string
  project: string
  dex: number
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

interface PokeOfficeBridge {
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
    setDex(id: string, dex: number): Promise<boolean>
    close(id: string): Promise<void>
    rename(id: string, title: string): Promise<boolean>
    pathForFile(file: File): string
    openUrl(url: string): Promise<void>
    onData(fn: (p: { id: string; data: string }) => void): () => void
    onList(fn: (list: TerminalInfo[]) => void): () => void
    onFocus(fn: (id: string) => void): () => void
  }
  cloud: {
    signIn(): Promise<{ ok: boolean; reason?: string }>
    signOut(): Promise<{ ok: boolean }>
    sync(): Promise<{ ok: boolean; reason?: string }>
  }
  env: {
    check(): Promise<Record<'claude' | 'git' | 'python', { ok: boolean; version: string | null; link: string }>>
    openLink(key: 'claude' | 'git' | 'python' | 'release'): Promise<void>
  }
  toast: {
    show(event: unknown): void
    done(): void
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
    check(): Promise<UpdateState | null>
    install(): Promise<UpdateState | null>
    restart(): Promise<boolean>
    onState(fn: (s: UpdateState) => void): () => void
  }
  widget: {
    toggle(): Promise<void>
    hide(): Promise<void>
    getExpanded(): Promise<boolean>
    setExpanded(flag: boolean): Promise<boolean>
    getMode(): Promise<WidgetMode>
    minimize(): Promise<void>
    setMode(mode: WidgetMode): Promise<WidgetMode>
    onMode(fn: (mode: WidgetMode) => void): () => void
    onExpanded(fn: (flag: boolean) => void): () => void
    resize(width: number, height: number): void
    showOffice(terminalId?: string | null): Promise<void>
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
  interface Window { pokeOffice?: PokeOfficeBridge }
}

export const bridge: PokeOfficeBridge | null = typeof window !== 'undefined' ? window.pokeOffice ?? null : null
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

export function terminalForSession(sessionId: string | undefined): TerminalInfo | undefined {
  return sessionId ? terminals.find(t => t.sessionId === sessionId && t.status === 'running') : undefined
}
