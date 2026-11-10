/**
 * cloudStore.ts — who is signed in (Google, through Supabase) and when the
 * game last synced. The server (server/cloud.js) owns the tokens; the page
 * only ever gets this public summary.
 */

import { useSyncExternalStore } from 'react'
import { t } from './i18n'

export interface CloudState {
  enabled: boolean
  user: { email: string | null; name: string | null; avatar: string | null } | null
  lastSyncAt: number | null
  error: CloudError | null
}

/** What went wrong, as a code: the server has no language, the page words it */
export interface CloudError { code: 'sign-in-failed' | 'session-expired' | 'sync-failed' | 'offline'; detail?: string }

/** The error in the language in use. A plain string (an older server) shows as it is. */
export function cloudErrorText(err: CloudError | string | null | undefined): string {
  if (!err) return ''
  if (typeof err === 'string') return err
  const detail = err.detail ?? ''
  switch (err.code) {
    case 'sign-in-failed': return t('로그인 실패: {error}', { error: detail })
    case 'session-expired': return t('로그인이 만료됐어요. 다시 로그인해주세요.')
    case 'sync-failed': return t('동기화 실패: {error}', { error: detail })
    case 'offline': return t('오프라인이라 잠시 동기화를 미뤘어요')
    default: return detail || t('알 수 없는 이유')
  }
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
