/**
 * cloudStore.ts — who is signed in (Google, through Supabase) and when the
 * game last synced. The server (server/cloud.js) owns the tokens; the page
 * only ever gets this public summary.
 */

import { useSyncExternalStore } from 'react'

export interface CloudState {
  enabled: boolean
  user: { email: string | null; name: string | null; avatar: string | null } | null
  lastSyncAt: number | null
  error: string | null
}

let state: CloudState | null = null
let version = 0
const listeners = new Set<() => void>()

export function dispatchCloud(msg: { type?: string; cloud?: CloudState } | null | undefined) {
  if (!msg || msg.type !== 'cloud' || !msg.cloud) return
  state = msg.cloud
  version++
  listeners.forEach(l => l())
}

export function useCloud(): CloudState | null {
  useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => version,
    () => version,
  )
  return state
}
