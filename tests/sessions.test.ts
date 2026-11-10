/**
 * Sessions: one Claude Code terminal per session_id. Created by SessionStart
 * (or implicitly by the first event that names an unknown session), listed by
 * GET /sessions and the WS snapshot, ended by SessionEnd (or the stale sweep)
 * and forgotten after 60 s; saved to agents.json and restored on a restart.
 * POST /event needs the token and accepts the event types older hooks send.
 */

import { existsSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import { listen, loadServer, serverProtocols, postEvent, removeServer, type Office } from './helpers'

// Two terminals: the fields the tracker puts on every event of each
const ALPHA = {
  sessionId: 'aaaaaaaa-1111-4111-8111-111111111111',
  project: 'alpha',
  cwd: '/home/me/alpha',
  transcriptPath: '/root/.claude/projects/-home-me-alpha/aaaaaaaa-1111-4111-8111-111111111111.jsonl',
}
const BETA = {
  sessionId: 'bbbbbbbb-2222-4222-8222-222222222222',
  project: 'beta',
  cwd: '/home/me/beta',
  transcriptPath: '/root/.claude/projects/-home-me-beta/bbbbbbbb-2222-4222-8222-222222222222.jsonl',
}

describe('POST /event', () => {
  let office: Office
  beforeAll(async () => { office = await loadServer() })
  afterAll(() => removeServer(office))

  it('is 401 without the token or with a wrong one, and nothing happens', async () => {
    const body = { type: 'session_started', ...ALPHA, source: 'startup' }
    expect((await request(office.server.app).post('/event').send(body)).status).toBe(401)
    expect((await postEvent(office.server, body, 'f'.repeat(64))).status).toBe(401)
    expect(office.server.sessions.size).toBe(0)
  })

  it('refuses a body without a known type', async () => {
    expect((await postEvent(office.server, {})).status).toBe(400)
    expect((await postEvent(office.server, { type: 'chat_message', text: 'hi' })).body).toEqual({ error: 'Unknown event type: chat_message' })
  })

  it('refuses the office-era events the hooks no longer send (agents, signals, tasks)', async () => {
    for (const type of ['agent_spawned', 'agent_linked', 'agent_started', 'signal', 'task_created', 'task_completed']) {
      const res = await postEvent(office.server, { type, ...ALPHA })
      expect(res.status, type).toBe(400)
    }
    expect(office.server.sessions.has(ALPHA.sessionId)).toBe(false)
  })

  it('clamps the session strings (cwd and transcriptPath up to 400 characters)', async () => {
    const long = '/x'.repeat(400)
    await postEvent(office.server, { type: 'session_started', sessionId: 'clamp', cwd: long, transcriptPath: long, project: 'p'.repeat(300), source: 'startup' })
    const session = office.server.sessions.get('clamp')
    expect(session.cwd).toHaveLength(400)
    expect(session.transcriptPath).toHaveLength(400)
    expect(session.project).toHaveLength(200)
  })
})

describe('session_started (SessionStart)', () => {
  let office: Office
  beforeAll(async () => { office = await loadServer() })
  afterAll(() => removeServer(office))

  it('creates an active session and lists it in GET /sessions', async () => {
    const res = await postEvent(office.server, { type: 'session_started', ...ALPHA, source: 'startup', model: 'claude-haiku-5-5' })
    expect(res.status).toBe(200)

    const session = office.server.sessions.get(ALPHA.sessionId)
    expect(session).toMatchObject({
      id: ALPHA.sessionId, project: 'alpha', cwd: ALPHA.cwd, source: 'startup', model: 'claude-haiku-5-5', state: 'active',
      main: { state: 'idle' },
    })
    expect(session.startedAt).toBeTypeOf('number')
    expect(session.lastActivityAt).toBe(session.startedAt)

    const list = await request(office.server.app).get('/sessions')
    expect(list.status).toBe(200)
    expect(list.body).toEqual({
      sessions: [expect.objectContaining({
        id: ALPHA.sessionId, project: 'alpha', cwd: ALPHA.cwd, source: 'startup', model: 'claude-haiku-5-5', state: 'active', hooked: true,
      })],
    })
    expect(list.body.sessions[0]).not.toHaveProperty('agentCount')
  })

  it('returns the broadcast shape', () => {
    const ev = office.server.processEvent({ type: 'session_started', ...BETA, source: 'startup' })
    expect(ev).toEqual(expect.objectContaining({
      type: 'session_started', sessionId: BETA.sessionId, project: 'beta', cwd: BETA.cwd, source: 'startup', state: 'active', timestamp: expect.any(Number),
    }))
    expect(ev).not.toHaveProperty('id')
  })

  it('a replayed start updates the record instead of creating another: compact keeps the source, resume replaces it', () => {
    office.server.processEvent({ type: 'session_started', ...ALPHA, source: 'compact', model: 'claude-opus-4-1' })
    expect(office.server.sessions.get(ALPHA.sessionId)).toMatchObject({ source: 'startup', model: 'claude-opus-4-1' })

    office.server.processEvent({ type: 'session_started', ...ALPHA, source: 'resume', title: 'dex refactor' })
    expect(office.server.sessions.get(ALPHA.sessionId)).toMatchObject({ source: 'resume', model: 'claude-opus-4-1', title: 'dex refactor' })
    expect(office.server.sessions.size).toBe(2)
  })

  it('ignores a start without a sessionId', () => {
    expect(office.server.processEvent({ type: 'session_started', source: 'startup' })).toBeNull()
    expect(office.server.sessions.size).toBe(2)
  })
})

describe('tool calls (agent_working)', () => {
  let office: Office
  beforeAll(async () => { office = await loadServer() })
  afterAll(() => removeServer(office))

  it('the first event naming an unknown session creates it with source "implicit"', () => {
    const ev = office.server.processEvent({ type: 'agent_working', status: 'reading App.tsx', tool: 'Read', ...ALPHA })
    expect(office.server.sessions.get(ALPHA.sessionId)).toMatchObject({ id: ALPHA.sessionId, project: 'alpha', source: 'implicit', state: 'active' })
    // A main-thread call: Claude is working, and the broadcast names the session
    expect(ev).toEqual({
      type: 'agent_working', status: 'reading App.tsx', sessionId: ALPHA.sessionId, project: 'alpha',
      main: expect.objectContaining({ state: 'working' }), timestamp: expect.any(Number),
    })
  })

  it('a call inside a subagent keeps the session alive but does not change what its Claude is doing', () => {
    office.server.processEvent({ type: 'session_turn_end', ...BETA, text: '' })
    expect(office.server.sessions.get(BETA.sessionId).main.state).toBe('idle')
    const ev = office.server.processEvent({ type: 'agent_working', agentId: 'sub-1', agentType: 'Explore', status: 'reading x', ...BETA })
    expect(ev).toBeNull()
    expect(office.server.sessions.get(BETA.sessionId).main.state).toBe('idle')
  })

  it('a failed main-thread call is flagged on the broadcast', () => {
    const ev = office.server.processEvent({ type: 'agent_working', status: 'failed: Bash — Exit code 1', failed: true, tool: 'Bash', ...ALPHA })
    expect(ev).toMatchObject({ type: 'agent_working', failed: true, sessionId: ALPHA.sessionId })
  })

  it('derives the project from cwd when the event has none; a bare sessionId still makes a session; no sessionId is ignored', () => {
    office.server.processEvent({ type: 'agent_working', status: 'x', sessionId: 'cwd-only', cwd: '/srv/www/shop/' })
    expect(office.server.sessions.get('cwd-only').project).toBe('shop')
    office.server.processEvent({ type: 'agent_working', status: 'x', sessionId: 'bare' })
    expect(office.server.sessions.get('bare')).toMatchObject({ id: 'bare', source: 'implicit' })
    expect(office.server.processEvent({ type: 'agent_working', status: 'x' })).toBeNull()
  })

  it('every event with a sessionId bumps that session\'s activity clock', () => {
    const session = office.server.sessions.get(ALPHA.sessionId)
    session.lastActivityAt = 1
    office.server.processEvent({ type: 'mcp_call', server: 'github', tool: 'search', ...ALPHA })
    expect(session.lastActivityAt).toBeGreaterThan(1)
  })
})

describe('session_ended (SessionEnd)', () => {
  let office: Office
  beforeAll(async () => {
    office = await loadServer()
    office.server.processEvent({ type: 'session_started', ...ALPHA, source: 'startup' })
    office.server.processEvent({ type: 'session_started', ...BETA, source: 'startup' })
  })
  afterAll(() => {
    vi.useRealTimers()
    removeServer(office)
  })

  it('marks the session ended and forgets it after 60 s', () => {
    // Only fake setTimeout so Date.now() and the HTTP stack stay real
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ev = office.server.processEvent({ type: 'session_ended', ...ALPHA, reason: 'other' })
    expect(ev).toEqual(expect.objectContaining({
      type: 'session_ended', sessionId: ALPHA.sessionId, project: 'alpha', state: 'ended', reason: 'other',
      endedAt: expect.any(Number), timestamp: expect.any(Number),
    }))
    expect(office.server.sessions.get(ALPHA.sessionId)).toMatchObject({ state: 'ended', reason: 'other', main: { state: 'idle' } })

    vi.advanceTimersByTime(59_999)
    expect(office.server.sessions.has(ALPHA.sessionId)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(office.server.sessions.has(ALPHA.sessionId)).toBe(false)
    expect(office.server.sessions.has(BETA.sessionId)).toBe(true)
    vi.useRealTimers()
  })

  it('a straggling event does not revive an ended session, but a SessionStart (resume) with the same id does', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    office.server.processEvent({ type: 'session_ended', ...BETA, reason: 'prompt_input_exit' })
    expect(office.server.sessions.get(BETA.sessionId)).toMatchObject({ state: 'ended', reason: 'prompt_input_exit' })

    office.server.processEvent({ type: 'agent_working', status: 'late', ...BETA })
    expect(office.server.sessions.get(BETA.sessionId).state).toBe('ended')

    const ev = office.server.processEvent({ type: 'session_started', ...BETA, source: 'resume' })
    expect(ev).toMatchObject({ type: 'session_started', sessionId: BETA.sessionId, state: 'active', source: 'resume' })
    const session = office.server.sessions.get(BETA.sessionId)
    expect(session.endedAt).toBeUndefined()
    expect(session.reason).toBeUndefined()

    vi.advanceTimersByTime(60_000)
    expect(office.server.sessions.has(BETA.sessionId)).toBe(true)
    vi.useRealTimers()
  })

  it('an end for an unknown session passes through without creating one; a duplicate end is a no-op', () => {
    const ev = office.server.processEvent({ type: 'session_ended', sessionId: 'ghost', reason: 'other' })
    expect(ev).toEqual({ type: 'session_ended', sessionId: 'ghost', reason: 'other', timestamp: expect.any(Number) })
    expect(office.server.sessions.has('ghost')).toBe(false)
    expect(office.server.processEvent({ type: 'session_ended', reason: 'other' })).toBeNull()

    office.server.processEvent({ type: 'session_ended', ...BETA, reason: 'other' })
    const { endedAt } = office.server.sessions.get(BETA.sessionId)
    office.server.processEvent({ type: 'session_ended', ...BETA, reason: 'later' })
    expect(office.server.sessions.get(BETA.sessionId)).toMatchObject({ state: 'ended', reason: 'other', endedAt })
  })
})

describe('stale sessions', () => {
  let office: Office | undefined
  afterEach(() => {
    vi.useRealTimers()
    removeServer(office)
    office = undefined
  })

  it('a session with no events for CLAUDEX_STALE_MINUTES ends on the sweep', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    office = await loadServer({ env: { CLAUDEX_STALE_MINUTES: '1' } })
    office.server.processEvent({ type: 'session_started', ...ALPHA, source: 'startup' })
    office.server.processEvent({ type: 'session_started', ...BETA, source: 'startup' })
    office.server.sessions.get(ALPHA.sessionId).lastActivityAt = Date.now() - 2 * 60_000

    vi.advanceTimersByTime(5 * 60_000)
    expect(office.server.sessions.get(ALPHA.sessionId)).toMatchObject({ state: 'ended', reason: 'stale' })
    expect(office.server.sessions.get(BETA.sessionId).state).toBe('active')
  })
})

describe('persistence', () => {
  const offices: Office[] = []
  afterEach(() => {
    while (offices.length) removeServer(offices.pop())
  })

  it('sessions are saved to agents.json and restored on a fresh import of the same runtime dir (ended ones are not)', async () => {
    const first = await loadServer()
    offices.push(first)
    first.server.processEvent({ type: 'session_started', ...ALPHA, source: 'startup', model: 'claude-haiku-5-5' })
    first.server.processEvent({ type: 'session_prompt', ...ALPHA, text: 'fix the dex' })
    first.server.processEvent({ type: 'session_started', ...BETA, source: 'startup' })
    first.server.processEvent({ type: 'session_ended', ...BETA, reason: 'other' })

    const saved = JSON.parse(readFileSync(join(first.dir, 'agents.json'), 'utf8'))
    expect(Object.keys(saved)).toEqual(['sessions'])
    expect(saved.sessions).toEqual([expect.objectContaining({
      id: ALPHA.sessionId, project: 'alpha', cwd: ALPHA.cwd, source: 'startup', model: 'claude-haiku-5-5', state: 'active',
      main: expect.objectContaining({ state: 'working', lastPrompt: 'fix the dex' }),
    })])

    const second = await loadServer({ dir: first.dir })
    offices.push(second)
    expect(Array.from(second.server.sessions.keys())).toEqual([ALPHA.sessionId])
    expect(second.server.sessions.get(ALPHA.sessionId)).toMatchObject({ project: 'alpha', model: 'claude-haiku-5-5', main: { state: 'working', lastPrompt: 'fix the dex' } })
  })

  it('a tool call that changes nothing but activity does not rewrite agents.json at once; flushSessions writes it', async () => {
    const office = await loadServer()
    offices.push(office)
    const file = join(office.dir, 'agents.json')
    office.server.processEvent({ type: 'session_started', ...ALPHA, source: 'startup' })
    office.server.processEvent({ type: 'agent_working', ...ALPHA, status: 'Read' }) // idle -> working: saved
    const working = readFileSync(file, 'utf8')
    expect(JSON.parse(working).sessions[0].main.state).toBe('working')
    await new Promise(r => setTimeout(r, 5))
    office.server.processEvent({ type: 'agent_working', ...ALPHA, status: 'Edit' }) // still working: activity only
    expect(readFileSync(file, 'utf8')).toBe(working)
    office.server.flushSessions()
    expect(readFileSync(file, 'utf8')).not.toBe(working)
  })

  it('an unhooked (registry-only) session coming and going does not write agents.json', async () => {
    const office = await loadServer()
    offices.push(office)
    const file = join(office.dir, 'agents.json')
    office.server.processEvent({ type: 'session_started', ...BETA, source: 'startup' })
    office.server.sessions.get(BETA.sessionId).hooked = false
    rmSync(file, { force: true })
    office.server.processEvent({ type: 'session_ended', ...BETA, reason: 'other' })
    expect(existsSync(file)).toBe(false)
  })

  it('drops sessions quiet for too long on load, and reads an older agents.json (with agents) all the same', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudex-test-'))
    const now = Date.now()
    const minutes = 60_000
    writeFileSync(join(dir, 'agents.json'), JSON.stringify({
      agents: [{ id: 'old-worker', name: 'Worker', role: 'debugger', state: 'working', spawnedAt: now, lastActivityAt: now, sessionId: 'fresh' }],
      sessions: [
        { id: 'fresh', project: 'fresh', state: 'active', startedAt: now - 5 * minutes, lastActivityAt: now - 5 * minutes, agentIds: ['old-worker'] },
        { id: 'stale', project: 'stale', state: 'active', startedAt: now - 180 * minutes, lastActivityAt: now - 180 * minutes },
        { id: 'stale-no-activity', project: 'old', state: 'active', startedAt: now - 180 * minutes },
        { id: 'ended', project: 'ended', state: 'ended', startedAt: now, lastActivityAt: now },
        { project: 'no-id', state: 'active', startedAt: now, lastActivityAt: now },
      ],
    }))
    const office = await loadServer({ dir, env: { CLAUDEX_STALE_MINUTES: '60' } })
    offices.push(office)
    expect(Array.from(office.server.sessions.keys())).toEqual(['fresh'])
    // The office worker list of an older file is left behind
    expect(office.server.sessions.get('fresh')).not.toHaveProperty('agentIds')
  })

  it('ignores a corrupt agents.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudex-test-'))
    writeFileSync(join(dir, 'agents.json'), '{ not json')
    const office = await loadServer({ dir })
    offices.push(office)
    expect(office.server.sessions.size).toBe(0)
  })
})

describe('WebSocket snapshot', () => {
  let office: Office
  let ws: WebSocket | undefined

  beforeAll(async () => {
    office = await loadServer()
    office.server.processEvent({ type: 'session_started', ...ALPHA, source: 'startup' })
    office.server.processEvent({ type: 'session_prompt', ...ALPHA, text: 'secret plan' })
  })

  afterAll(async () => {
    ws?.terminate()
    await new Promise<void>(res => office.server.wss.close(() => res()))
    await new Promise<void>(res => office.server.httpServer.close(() => res()))
    removeServer(office)
  })

  it('carries the sessions, the status-line store, the game and the cloud — and nothing of the old office', async () => {
    const port = await listen(office.server.httpServer)
    const snapshot = await new Promise<any>((resolve, reject) => {
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, serverProtocols(office.server))
      // The first message says whether the connection is trusted; the snapshot follows
      ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'snapshot') resolve(m) })
      ws.once('error', reject)
    })
    expect(Object.keys(snapshot).sort()).toEqual(['cloud', 'health', 'pokedex', 'sessions', 'statuses', 'timestamp', 'type'])
    expect(snapshot.sessions).toEqual([
      expect.objectContaining({ id: ALPHA.sessionId, project: 'alpha', state: 'active', main: expect.objectContaining({ state: 'working', lastPrompt: 'secret plan' }) }),
    ])
    expect(snapshot.statuses).toEqual({ sessions: [] })
  })
})

describe('POST /flush', () => {
  let office: Office
  beforeAll(async () => { office = await loadServer() })
  afterAll(() => removeServer(office))

  it('needs the token, then writes what waits to be saved', async () => {
    expect((await request(office.server.app).post('/flush')).status).toBe(401)
    const res = await request(office.server.app).post('/flush').set('Authorization', `Bearer ${office.server.AUTH_TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
