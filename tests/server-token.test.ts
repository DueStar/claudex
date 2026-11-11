/**
 * src/officeToken.ts — how the page takes the server token from the link
 * (`#token=` in the fragment), keeps it, strips it from the address bar and
 * offers it to the WebSocket. Node only: the location, history and storages
 * are fakes.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  SERVER_TOKEN_KEY, WS_PROTOCOL, WS_TOKEN_PROTOCOL_PREFIX,
  captureServerToken, clearServerToken, getServerToken, serverWsProtocols, resetServerTokenMemory, setServerToken, splitTokenFromHash,
  type HashLocation, type ReplaceHistory, type TokenStorage,
} from '../src/serverToken'

const TOKEN = 'ab'.repeat(32)
const NEWER = 'cd'.repeat(32)

class FakeStorage implements TokenStorage {
  data = new Map<string, string>()
  constructor(private readonly broken: 'none' | 'write' | 'all' = 'none') {}
  getItem(key: string) {
    if (this.broken === 'all') throw new Error('SecurityError')
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.broken !== 'none') throw new Error('QuotaExceededError')
    this.data.set(key, value)
  }
  removeItem(key: string) {
    if (this.broken === 'all') throw new Error('SecurityError')
    this.data.delete(key)
  }
}

function page(href: { pathname?: string; search?: string; hash?: string } = {}) {
  const location: HashLocation = { pathname: '/', search: '', hash: '', ...href }
  const calls: Array<{ data: unknown; url: string | null | undefined }> = []
  const history: ReplaceHistory = { state: { kept: true }, replaceState: (data, _unused, url) => { calls.push({ data, url }) } }
  return { location, history, calls }
}

afterEach(() => resetServerTokenMemory())

describe('splitTokenFromHash', () => {
  it('takes token= out of the fragment and keeps the other parameters verbatim', () => {
    expect(splitTokenFromHash(`#token=${TOKEN}`)).toEqual({ found: true, token: TOKEN, rest: '' })
    expect(splitTokenFromHash(`#view=compact&token=${TOKEN}&x`)).toEqual({ found: true, token: TOKEN, rest: 'view=compact&x' })
    expect(splitTokenFromHash(`token=${TOKEN}`)).toEqual({ found: true, token: TOKEN, rest: '' })
  })

  it('a malformed token is found (so it is stripped) but not taken', () => {
    expect(splitTokenFromHash('#token=abc')).toEqual({ found: true, token: null, rest: '' })
    expect(splitTokenFromHash(`#token=${TOKEN.toUpperCase()}`)).toEqual({ found: true, token: null, rest: '' })
    expect(splitTokenFromHash(`#token=${TOKEN}0`)).toEqual({ found: true, token: null, rest: '' })
  })

  it('no token: nothing found, the fragment untouched', () => {
    expect(splitTokenFromHash('')).toEqual({ found: false, token: null, rest: '' })
    expect(splitTokenFromHash('#section-2')).toEqual({ found: false, token: null, rest: 'section-2' })
    expect(splitTokenFromHash('#mytoken=1')).toEqual({ found: false, token: null, rest: 'mytoken=1' })
  })
})

describe('captureServerToken (hash -> storage -> replaceState)', () => {
  it('keeps the token in localStorage and replaces the address with the same path and query, without the fragment', () => {
    const local = new FakeStorage()
    const session = new FakeStorage()
    const { location, history, calls } = page({ pathname: '/', search: '?variant=incident', hash: `#token=${TOKEN}` })
    expect(captureServerToken(location, history, [local, session])).toBe(TOKEN)
    expect(local.data.get(SERVER_TOKEN_KEY)).toBe(TOKEN)
    expect(session.data.size).toBe(0)
    expect(calls).toEqual([{ data: { kept: true }, url: '/?variant=incident' }])
  })

  it('keeps the other fragment parameters in the new address', () => {
    const { location, history, calls } = page({ hash: `#a=1&token=${TOKEN}` })
    captureServerToken(location, history, [new FakeStorage()])
    expect(calls[0].url).toBe('/#a=1')
  })

  it('a newer link replaces the token kept before (a rotation)', () => {
    const local = new FakeStorage()
    local.data.set(SERVER_TOKEN_KEY, TOKEN)
    const { location, history } = page({ hash: `#token=${NEWER}` })
    expect(captureServerToken(location, history, [local])).toBe(NEWER)
    expect(local.data.get(SERVER_TOKEN_KEY)).toBe(NEWER)
  })

  it('a malformed token is stripped from the address but not kept; the old one stays', () => {
    const local = new FakeStorage()
    local.data.set(SERVER_TOKEN_KEY, TOKEN)
    const { location, history, calls } = page({ hash: '#token=<script>' })
    expect(captureServerToken(location, history, [local])).toBe(TOKEN)
    expect(local.data.get(SERVER_TOKEN_KEY)).toBe(TOKEN)
    expect(calls).toEqual([{ data: { kept: true }, url: '/' }])
  })

  it('no token in the address: the address is left alone and the kept token is returned', () => {
    const local = new FakeStorage()
    local.data.set(SERVER_TOKEN_KEY, TOKEN)
    const { location, history, calls } = page({ hash: '#section' })
    expect(captureServerToken(location, history, [local])).toBe(TOKEN)
    expect(calls).toEqual([])
    expect(captureServerToken(page().location, page().history, [new FakeStorage()])).toBeNull()
  })

  it('localStorage refuses: sessionStorage keeps it; both refuse: memory, for this page', () => {
    const local = new FakeStorage('write')
    const session = new FakeStorage()
    const first = page({ hash: `#token=${TOKEN}` })
    expect(captureServerToken(first.location, first.history, [local, session])).toBe(TOKEN)
    expect(session.data.get(SERVER_TOKEN_KEY)).toBe(TOKEN)

    resetServerTokenMemory()
    const broken = [new FakeStorage('all'), new FakeStorage('all')]
    const second = page({ hash: `#token=${NEWER}` })
    expect(captureServerToken(second.location, second.history, broken)).toBe(NEWER)
    expect(getServerToken(broken)).toBe(NEWER)
    expect(second.calls).toHaveLength(1)
  })

  it('a storage that refuses the new token drops its old copy, so it cannot shadow the new one', () => {
    const local = new FakeStorage()
    local.data.set(SERVER_TOKEN_KEY, TOKEN)
    const refusing: TokenStorage = { getItem: k => local.getItem(k), setItem: () => { throw new Error('full') }, removeItem: k => local.removeItem(k) }
    const session = new FakeStorage()
    setServerToken(NEWER, [refusing, session])
    expect(getServerToken([refusing, session])).toBe(NEWER)
  })

  it('a replaceState that throws still leaves the token kept', () => {
    const local = new FakeStorage()
    const history: ReplaceHistory = { state: null, replaceState: () => { throw new Error('SecurityError') } }
    expect(captureServerToken({ pathname: '/', search: '', hash: `#token=${TOKEN}` }, history, [local])).toBe(TOKEN)
  })
})

describe('getServerToken / clearServerToken', () => {
  it('ignores a malformed stored value and reads storage afresh each time (another tab may have a newer token)', () => {
    const local = new FakeStorage()
    local.data.set(SERVER_TOKEN_KEY, 'garbage')
    expect(getServerToken([local])).toBeNull()
    local.data.set(SERVER_TOKEN_KEY, TOKEN)
    expect(getServerToken([local])).toBe(TOKEN)
    local.data.set(SERVER_TOKEN_KEY, NEWER)
    expect(getServerToken([local])).toBe(NEWER)
  })

  it('clear forgets it everywhere', () => {
    const local = new FakeStorage()
    const session = new FakeStorage()
    setServerToken(TOKEN, [local, session])
    session.data.set(SERVER_TOKEN_KEY, TOKEN)
    clearServerToken([local, session])
    expect(getServerToken([local, session])).toBeNull()
  })
})

describe('serverWsProtocols (what useAgentSocket offers on every (re)connect)', () => {
  it('the office protocol, plus the token when the page has a well-formed one', () => {
    expect(serverWsProtocols(TOKEN)).toEqual([WS_PROTOCOL, `${WS_TOKEN_PROTOCOL_PREFIX}${TOKEN}`])
    expect(serverWsProtocols(TOKEN)).toEqual(['spawn', `spawn.token.${TOKEN}`])
    expect(serverWsProtocols(null)).toEqual(['spawn'])
    expect(serverWsProtocols(undefined)).toEqual(['spawn'])
    // Never a value the WebSocket constructor would throw on
    expect(serverWsProtocols('has space, comma')).toEqual(['spawn'])
  })

  it('the token goes in a subprotocol, never in the URL', async () => {
    const { serverWsUrl } = await import('../src/serverUrl')
    expect(serverWsUrl()).not.toContain('token')
  })

  it('useAgentSocket builds its socket with it and passes over the server\'s `auth` message', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../src/hooks/useAgentSocket.ts', import.meta.url), 'utf8')
    expect(source).toContain('new WebSocket(url, serverWsProtocols())')
    expect(source).toMatch(/msg\.type === 'auth'/)
  })
})
