/**
 * server/config.js — the server's runtime configuration: AGENT_OFFICE_PORT
 * and AGENT_OFFICE_UI_PORT (readPort / readUiPort) and AGENT_OFFICE_HOST
 * (readHost: loopback only, anything else refused with the reason). Then the
 * server on top of them: start() binds the configured port, a non-loopback
 * host still binds 127.0.0.1, and the origin allowlist follows the port.
 */

import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_HOST, DEFAULT_PORT, DEFAULT_UI_PORT, readHost, readPort, readUiPort,
} from '../server/config.js'
import { loadServer, removeServer, type Office } from './helpers'

/** A logger that records instead of printing. */
function recorder() {
  const warn: string[] = []
  const error: string[] = []
  return { warn: (m: string) => { warn.push(m) }, error: (m: string) => { error.push(m) }, lines: { warn, error } }
}

/** A port nothing listens on right now (bind 0, read, release). */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  return port
}

describe('readPort / readUiPort', () => {
  it('is 3334 when AGENT_OFFICE_PORT is unset or empty, without a warning', () => {
    const log = recorder()
    expect(readPort({}, log)).toBe(DEFAULT_PORT)
    expect(readPort({ AGENT_OFFICE_PORT: '' }, log)).toBe(DEFAULT_PORT)
    expect(log.lines.warn).toEqual([])
    expect(DEFAULT_PORT).toBe(3334)
  })

  it('parses a port, tolerating surrounding whitespace', () => {
    expect(readPort({ AGENT_OFFICE_PORT: '4000' })).toBe(4000)
    expect(readPort({ AGENT_OFFICE_PORT: ' 4123 ' })).toBe(4123)
    expect(readPort({ AGENT_OFFICE_PORT: '65535' })).toBe(65535)
    expect(readPort({ AGENT_OFFICE_PORT: '1' })).toBe(1)
  })

  it('falls back to 3334 with a warning naming the value when it is not a port', () => {
    for (const bad of ['abc', '0', '70000', '-1', '33.34', '3334abc', '0x3334']) {
      const log = recorder()
      expect(readPort({ AGENT_OFFICE_PORT: bad }, log)).toBe(DEFAULT_PORT)
      expect(log.lines.warn).toHaveLength(1)
      expect(log.lines.warn[0]).toContain(`AGENT_OFFICE_PORT=${JSON.stringify(bad)}`)
      expect(log.lines.warn[0]).toContain('using 3334')
    }
  })

  it('readUiPort reads AGENT_OFFICE_UI_PORT the same way, default 3333', () => {
    const log = recorder()
    expect(readUiPort({}, log)).toBe(DEFAULT_UI_PORT)
    expect(DEFAULT_UI_PORT).toBe(3333)
    expect(readUiPort({ AGENT_OFFICE_UI_PORT: '3400' }, log)).toBe(3400)
    expect(readUiPort({ AGENT_OFFICE_UI_PORT: 'vite' }, log)).toBe(3333)
    expect(log.lines.warn[0]).toContain('AGENT_OFFICE_UI_PORT="vite"')
  })

  it('reads from the env it is given, not process.env', () => {
    const before = process.env.AGENT_OFFICE_PORT
    process.env.AGENT_OFFICE_PORT = '5000'
    try {
      expect(readPort({})).toBe(DEFAULT_PORT)
      expect(readPort()).toBe(5000)
    } finally {
      if (before === undefined) delete process.env.AGENT_OFFICE_PORT
      else process.env.AGENT_OFFICE_PORT = before
    }
  })
})

describe('readHost', () => {
  it('is 127.0.0.1 when AGENT_OFFICE_HOST is unset or blank, silently', () => {
    const log = recorder()
    expect(readHost({}, log)).toBe(DEFAULT_HOST)
    expect(readHost({ AGENT_OFFICE_HOST: '' }, log)).toBe(DEFAULT_HOST)
    expect(readHost({ AGENT_OFFICE_HOST: '   ' }, log)).toBe(DEFAULT_HOST)
    expect(log.lines.error).toEqual([])
    expect(DEFAULT_HOST).toBe('127.0.0.1')
  })

  it('accepts 127.0.0.1 and localhost, and binds 127.0.0.1 for both (the resolver may answer ::1 for localhost)', () => {
    const log = recorder()
    expect(readHost({ AGENT_OFFICE_HOST: '127.0.0.1' }, log)).toBe('127.0.0.1')
    expect(readHost({ AGENT_OFFICE_HOST: 'localhost' }, log)).toBe('127.0.0.1')
    expect(readHost({ AGENT_OFFICE_HOST: 'LOCALHOST' }, log)).toBe('127.0.0.1')
    expect(readHost({ AGENT_OFFICE_HOST: ' localhost ' }, log)).toBe('127.0.0.1')
    expect(log.lines.error).toEqual([])
  })

  it('refuses IPv6 loopback with its own reason and binds 127.0.0.1: every client dials IPv4', () => {
    for (const host of ['::1', '[::1]', '0:0:0:0:0:0:0:1']) {
      const log = recorder()
      expect(readHost({ AGENT_OFFICE_HOST: host }, log)).toBe('127.0.0.1')
      expect(log.lines.error).toHaveLength(1)
      const msg = log.lines.error[0]
      expect(msg).toContain(`AGENT_OFFICE_HOST=${JSON.stringify(host)} refused`)
      expect(msg).toMatch(/IPv4 loopback only/)
      expect(msg).toMatch(/dial 127\.0\.0\.1/)
      expect(msg).toMatch(/Binding 127\.0\.0\.1/)
    }
  })

  it('refuses anything else with the reason and binds 127.0.0.1', () => {
    for (const host of ['0.0.0.0', '192.168.1.20', '::', 'office.local', 'example.com', '127.0.0.1:4000']) {
      const log = recorder()
      expect(readHost({ AGENT_OFFICE_HOST: host }, log)).toBe('127.0.0.1')
      expect(log.lines.error).toHaveLength(1)
      const msg = log.lines.error[0]
      expect(msg).toContain(`AGENT_OFFICE_HOST=${JSON.stringify(host)} refused`)
      expect(msg).toMatch(/loopback only/)
      expect(msg).toMatch(/every GET and the WebSocket are open on loopback by design/i)
      expect(msg).toMatch(/would show your sessions to the network/)
      expect(msg).toMatch(/Binding 127\.0\.0\.1/)
    }
  })
})

describe('the server on a configured port', () => {
  const offices: Office[] = []
  const spies: Array<{ mockRestore: () => void }> = []

  afterAll(async () => {
    for (const spy of spies) spy.mockRestore()
    for (const office of offices) {
      await new Promise<void>(res => office.server.wss.close(() => res()))
      await new Promise<void>(res => office.server.httpServer.close(() => res()))
      removeServer(office)
    }
  })

  /** start() the office and wait for the socket (the banner is silenced). */
  function started(office: Office) {
    spies.push(vi.spyOn(console, 'log').mockImplementation(() => {}))
    const listening = new Promise<void>(res => office.server.httpServer.once('listening', res))
    office.server.start()
    return listening
  }

  it('start() with AGENT_OFFICE_PORT set listens there, writes the token and answers GET /health', async () => {
    const port = await freePort()
    const office = await loadServer({ env: { AGENT_OFFICE_PORT: String(port) } })
    offices.push(office)
    expect(office.server.PORT).toBe(port)
    await started(office)

    expect((office.server.httpServer.address() as AddressInfo).port).toBe(port)
    expect(existsSync(join(office.dir, 'auth-token'))).toBe(true)
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    expect(health.status).toBe(200)
  })

  it('a non-loopback AGENT_OFFICE_HOST is logged as refused, with the reason, and 127.0.0.1 is bound', async () => {
    const port = await freePort()
    const office = await loadServer({ env: { AGENT_OFFICE_PORT: String(port) } })
    offices.push(office)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    spies.push(error)

    process.env.AGENT_OFFICE_HOST = '0.0.0.0'
    try {
      await started(office)
    } finally {
      delete process.env.AGENT_OFFICE_HOST
    }

    const logged = error.mock.calls.map(c => c.join(' ')).join('\n')
    expect(logged).toContain('AGENT_OFFICE_HOST="0.0.0.0" refused')
    expect(logged).toMatch(/open on loopback by design/)
    expect(office.server.httpServer.address()).toMatchObject({ address: '127.0.0.1', port })
  })
})

describe('the port-derived surfaces (AGENT_OFFICE_PORT=4000)', () => {
  let office: Office

  beforeAll(async () => { office = await loadServer({ env: { AGENT_OFFICE_PORT: '4000' } }) })
  afterAll(() => removeServer(office))

  it('the origin allowlist accepts the configured port (and Vite) and rejects 3334', async () => {
    const { isAllowedOrigin } = office.server
    for (const origin of ['http://localhost:4000', 'http://127.0.0.1:4000', 'http://[::1]:4000', 'http://localhost:3333', 'http://127.0.0.1:3333']) {
      expect(isAllowedOrigin(origin), origin).toBe(true)
      const res = await request(office.server.app).get('/health').set('Origin', origin)
      expect(res.status, origin).toBe(200)
    }
    for (const origin of ['http://localhost:3334', 'http://127.0.0.1:3334', 'http://localhost:4001', 'https://localhost:4000']) {
      expect(isAllowedOrigin(origin), origin).toBe(false)
      const res = await request(office.server.app).get('/health').set('Origin', origin)
      expect(res.status, origin).toBe(403)
    }
  })
})

describe('AGENT_OFFICE_UI_PORT widens the origin allowlist', () => {
  let office: Office
  beforeAll(async () => { office = await loadServer({ env: { AGENT_OFFICE_UI_PORT: '3400' } }) })
  afterAll(() => removeServer(office))

  it('allows the configured Vite port and still 3333 and the server port', () => {
    expect(office.server.UI_DEV_PORT).toBe(3400)
    expect(office.server.isAllowedOrigin('http://localhost:3400')).toBe(true)
    expect(office.server.isAllowedOrigin('http://localhost:3333')).toBe(true)
    expect(office.server.isAllowedOrigin('http://localhost:3334')).toBe(true)
    expect(office.server.isAllowedOrigin('http://localhost:3401')).toBe(false)
  })
})
