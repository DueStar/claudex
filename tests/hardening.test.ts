/**
 * Server hardening: the token on every route that reports a session or
 * changes the game (and nothing else), the constant-time token check, the
 * token file written only once the port is bound, signed hook requests, the
 * Host guard, runtime files only this user can read, and JSON errors that
 * never carry a stack trace.
 */

import { createHmac } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import { listen, loadServer, postAuthed, postEvent, removeServer, type Office, type ServerModule } from './helpers'

// Pass-through mock so the test can see the server reach for timingSafeEqual
vi.mock('crypto', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:crypto')>()
  return { ...mod, timingSafeEqual: vi.fn(mod.timingSafeEqual) }
})

const mode = (path: string) => statSync(path).mode & 0o777

// Windows has no POSIX permission bits: Node reports 0o666 (or 0o444 when
// read-only) whatever the server asked for, chmod only toggles read-only,
// there is no getuid, and a symlink needs admin rights or Developer Mode. The
// checks that rest on those run on Linux (CI) and skip here; the rest of each
// test still runs on Windows.
const WINDOWS = process.platform === 'win32'
/** The token file is private to this user (0600), where the OS has modes to say so */
const expectPrivate = (file: string) => { if (!WINDOWS) expect(mode(file)).toBe(0o600) }

type Message = Record<string, any>
interface Client { ws: WebSocket; next: (pred?: (m: Message) => boolean) => Promise<Message>; all: () => Message[] }

function connect(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const queue: Message[] = []
    const seen: Message[] = []
    const waiters: Array<{ pred: (m: Message) => boolean; resolve: (m: Message) => void }> = []
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString())
      seen.push(m)
      const i = waiters.findIndex(w => w.pred(m))
      if (i >= 0) waiters.splice(i, 1)[0].resolve(m)
      else queue.push(m)
    })
    const next = (pred: (m: Message) => boolean = () => true) => {
      const i = queue.findIndex(pred)
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0])
      return new Promise<Message>(res => waiters.push({ pred, resolve: res }))
    }
    ws.once('open', () => resolve({ ws, next, all: () => seen.slice() }))
    ws.once('error', reject)
  })
}

const settle = (ms = 150) => new Promise(res => setTimeout(res, ms))

// ---------------------------------------------------------------------------

describe('token comparison (C40)', () => {
  let office: Office
  beforeAll(async () => { office = await loadServer() })
  afterAll(() => removeServer(office))

  it('uses crypto.timingSafeEqual and rejects prefixes, extensions and same-length impostors', async () => {
    const { timingSafeEqual } = await import('crypto')
    const spy = timingSafeEqual as unknown as ReturnType<typeof vi.fn>
    spy.mockClear()

    const token = office.server.AUTH_TOKEN
    expect(token).toHaveLength(64)
    const impostor = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')
    for (const bad of [token.slice(0, 63), token + '0', impostor, '']) {
      const res = await postEvent(office.server, { type: 'session_ended', sessionId: 's', reason: 'other' }, bad)
      expect(res.status, JSON.stringify(bad)).toBe(401)
    }
    const ok = await postEvent(office.server, { type: 'session_ended', sessionId: 's', reason: 'other' })
    expect(ok.status).toBe(200)

    // Only same-length candidates reach the constant-time compare: the impostor and the real token
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('start() and the token file (C09)', () => {
  const offices: Office[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    while (offices.length) removeServer(offices.pop())
  })

  it('writes the token (0600) only once the port is bound', async () => {
    const office = await loadServer()
    offices.push(office)
    const tokenFile = join(office.dir, 'auth-token')
    expect(existsSync(tokenFile)).toBe(false)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const listening = new Promise<void>(res => office.server.httpServer.once('listening', res))
    office.server.start({ port: 0 })
    expect(existsSync(tokenFile)).toBe(false)  // not written synchronously, before listen
    await listening

    expect(readFileSync(tokenFile, 'utf8')).toBe(office.server.AUTH_TOKEN)
    expectPrivate(tokenFile)
    await new Promise<void>(res => office.server.wss.close(() => res()))
    await new Promise<void>(res => office.server.httpServer.close(() => res()))
  })

  it('leaves the running instance\'s token alone when a second instance loses the port race (C09)', async () => {
    // Instance B: a second `node server/index.js` against the same runtime
    // dir, imported before A has written a token — so it mints its own
    // (a later start would reuse A's, tests/ws-auth.test.ts)
    const a = await loadServer()
    offices.push(a)
    const tokenFile = join(a.dir, 'auth-token')
    const b = await loadServer({ dir: a.dir })
    expect(existsSync(tokenFile)).toBe(false)

    // Instance A: a real office that binds an ephemeral port and writes its token
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const aListening = new Promise<void>(res => a.server.httpServer.once('listening', res))
    a.server.start({ port: 0 })
    await aListening
    const port = (a.server.httpServer.address() as import('node:net').AddressInfo).port
    const aToken = readFileSync(tokenFile, 'utf8')
    expect(aToken).toBe(a.server.AUTH_TOKEN)

    try {
      // B starts while A holds the port
      expect(b.server.AUTH_TOKEN).not.toBe(aToken)
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      const bErrored = new Promise<void>(res => b.server.httpServer.once('error', () => res()))
      b.server.start({ port })
      await bErrored

      expect(exit).toHaveBeenCalledWith(1)
      expect(error.mock.calls[0][0]).toMatch(/already in use/)
      // A's token — what the hook still sends — is untouched
      expect(readFileSync(tokenFile, 'utf8')).toBe(aToken)
    } finally {
      await new Promise<void>(res => a.server.wss.close(() => res()))
      await new Promise<void>(res => a.server.httpServer.close(() => res()))
    }
  })
})

describe('signed requests authenticate the hook without the token on the wire', () => {
  let office: Office
  beforeAll(async () => { office = await loadServer() })
  afterAll(() => removeServer(office))

  /** A request signed the way the hook signs it: HMAC(token, method\npath\nts\nbody). */
  function signed(method: 'post' | 'get', path: string, bodyObj: unknown, opts: { token?: string; ts?: number } = {}) {
    const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj)
    const ts = String(opts.ts ?? Date.now())
    const key = opts.token ?? office.server.AUTH_TOKEN
    const sig = createHmac('sha256', key).update(`${method.toUpperCase()}\n${path}\n${ts}\n`).update(body).digest('hex')
    let req = request(office.server.app)[method](path).set('X-Claudex-Timestamp', ts).set('X-Claudex-Signature', sig)
    if (bodyObj !== undefined) req = req.set('Content-Type', 'application/json').send(body)
    return req
  }

  const event = () => ({ type: 'session_started', sessionId: 's-sign', project: 'p', cwd: '/home/me/p', source: 'startup' })
  const status = () => ({ type: 'session_status', sessionId: 's-sign', project: 'p', model: 'claude', cost: 0 })

  it('a valid signature is accepted on POST /event and POST /status (no Authorization header)', async () => {
    expect((await signed('post', '/event', event())).status).toBe(200)
    expect((await signed('post', '/status', status())).status).toBe(200)
  })

  it('a tool finishing, from the hook, is accepted when signed', async () => {
    const res = await signed('post', '/event', { type: 'session_tool_done', tool: 'Bash', sessionId: 's-sign', project: 'p', cwd: '/home/me/p' })
    expect(res.status).toBe(200)
  })

  it('a bad signature, or one over a different body, is 401', async () => {
    const ts = String(Date.now())
    const bad = request(office.server.app).post('/event').set('X-Claudex-Timestamp', ts).set('X-Claudex-Signature', 'f'.repeat(64)).set('Content-Type', 'application/json').send(JSON.stringify(event()))
    expect((await bad).status).toBe(401)
    // A signature wrong only because a different token was used
    expect((await signed('post', '/event', event(), { token: 'not-the-token' })).status).toBe(401)
  })

  it('a stale timestamp (older than the window) is 401 even with a correct signature', async () => {
    expect((await signed('post', '/event', event(), { ts: Date.now() - 120_000 })).status).toBe(401)
    expect((await signed('post', '/event', event(), { ts: Date.now() + 120_000 })).status).toBe(401)
  })

  it('the bearer token is still accepted (the desktop app sends it)', async () => {
    expect((await postEvent(office.server, event())).status).toBe(200)
    expect((await postAuthed(office.server, '/status', status())).status).toBe(200)
  })
})

describe('Host-header guard defeats DNS rebinding (finding 30)', () => {
  let office: Office
  beforeAll(async () => { office = await loadServer() })
  afterAll(() => removeServer(office))

  it('a non-loopback Host is 421 on every route; the three loopback forms (any port) pass', async () => {
    for (const path of ['/sessions', '/status', '/pokedex', '/registry', '/health']) {
      const res = await request(office.server.app).get(path).set('Host', 'attacker.example:3334')
      expect(res.status, path).toBe(421)
      expect(res.body).toEqual({ error: 'Forbidden host' })
    }
    for (const host of ['127.0.0.1:3334', 'localhost:3333', '[::1]:3334', 'localhost', '127.0.0.1']) {
      expect((await request(office.server.app).get('/health').set('Host', host)).status, host).toBe(200)
    }
    // A missing Host is refused too
    const res = await request(office.server.app).get('/health').set('Host', '')
    expect(res.status).toBe(421)
  })

  it('the WebSocket refuses a non-loopback Host (close 1008)', async () => {
    const port = await listen(office.server.httpServer)
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Host: 'attacker.example' } })
      const code = await new Promise<number>((res, rej) => {
        ws.on('close', c => res(c))
        ws.on('error', () => { /* a refused upgrade may surface as an error first */ })
        setTimeout(() => rej(new Error('no close')), 3_000)
      })
      expect(code).toBe(1008)
    } finally {
      await new Promise<void>(res => office.server.httpServer.close(() => res()))
    }
  })
})

describe('runtime files are private (C17)', () => {
  let office: Office
  beforeAll(async () => { office = await loadServer() })
  afterAll(() => removeServer(office))

  it.skipIf(process.platform === 'win32')('agents.json is 0600 and the runtime dir 0700, even when an older build left them world-readable', async () => {
    await postEvent(office.server, { type: 'session_started', sessionId: 's-private', project: 'p', cwd: '/tmp/p', source: 'startup' })
    expect(mode(join(office.dir, 'agents.json'))).toBe(0o600)
    chmodSync(office.dir, 0o755)
    const again = await loadServer({ dir: office.dir })
    expect(again.server.RUNTIME_DIR).toBe(office.dir)
    expect(mode(office.dir)).toBe(0o700)
  })
})

describe('errors are JSON without stack traces or paths (C18)', () => {
  let office: Office
  let errors: ReturnType<typeof vi.spyOn>
  beforeAll(async () => {
    office = await loadServer()
    errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterAll(() => {
    errors.mockRestore()
    removeServer(office)
  })

  it('malformed JSON is a 400', async () => {
    const res = await request(office.server.app).post('/status').set('Content-Type', 'application/json').send('{"sender": "x", "text": ')
    expect(res.status).toBe(400)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toEqual({ error: 'Malformed JSON body' })
  })

  it('a body over the 10kb limit is a 413', async () => {
    const res = await request(office.server.app).post('/status').send({ sender: 'x', text: 'y'.repeat(20_000) })
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'Request body too large' })
  })

  it('an exception in a handler is a 500 with a generic body', async () => {
    const store = office.server.app.locals.status
    const ingest = store.ingest
    store.ingest = () => { throw new Error('boom at /home/someone/secret/index.js:1:1') }
    try {
      const res = await postAuthed(office.server, '/status', { type: 'session_status', sessionId: 's-boom' })
      expect(res.status).toBe(500)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(res.body).toEqual({ error: 'Internal error' })
      expect(res.text).not.toContain('secret')
      expect(res.text).not.toContain(office.server.RUNTIME_DIR)
    } finally {
      store.ingest = ingest
    }
    // ...and the server is still up
    expect((await request(office.server.app).get('/health')).status).toBe(200)
    expect(errors).toHaveBeenCalled()
  })

  it('a request nothing matches is still a plain 404', async () => {
    const res = await request(office.server.app).get('/sprites/nope.png')
    expect(res.status).toBe(404)
  })
})

