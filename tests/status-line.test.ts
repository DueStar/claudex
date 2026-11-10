/**
 * hooks/status-line.cjs — the Claude Code statusLine command: POSTs the
 * session's context and rate-limit numbers to /status and prints the line
 * Claude Code displays. Runs the real script (in Node, as the app runs it in
 * Node mode) against a capture server.
 */

import { spawn } from 'node:child_process'

/** execFileSync's shape (stdout as a string), without blocking this process */
function execScript(cmd: string, args: string[], { input, env, timeout }: { input: string; env: NodeJS.ProcessEnv; timeout: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env })
    let out = ''
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout.setEncoding('utf8').on('data', (c: string) => { out += c })
    child.on('error', reject)
    child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`exit ${code}`)) })
    child.stdin.end(input)
  })
}
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../hooks/status-line.cjs', import.meta.url))
const POST = fileURLToPath(new URL('../hooks/post.cjs', import.meta.url))

/**
 * The stdin JSON Claude Code 2.1.300 gives a statusLine command: the shape
 * from https://code.claude.com/docs/en/statusline with the numbers of a
 * captured haiku-5-5 session (REPORT.md §2/§3) and a Pro/Max rate_limits block.
 */
const STATUS_JSON = {
  hook_event_name: 'Status',
  session_id: '8cf68f64-5433-40f7-a130-557fc7f67e42',
  transcript_path: '/root/.claude/projects/-home-user-Claude-Office/8cf68f64-5433-40f7-a130-557fc7f67e42.jsonl',
  cwd: '/home/user/Claude-Office',
  model: { id: 'claude-haiku-5-5', display_name: 'Haiku 5.5' },
  workspace: { current_dir: '/home/user/Claude-Office/src', project_dir: '/home/user/Claude-Office' },
  version: '2.1.300',
  output_style: { name: 'default' },
  cost: { total_cost_usd: 0.014055975, total_duration_ms: 23245, total_api_duration_ms: 19074, total_lines_added: 156, total_lines_removed: 23 },
  context_window: {
    total_input_tokens: 44051,
    total_output_tokens: 358,
    context_window_size: 1000000,
    used_percentage: 4.4,
    remaining_percentage: 95.6,
    current_usage: { input_tokens: 2, output_tokens: 358, cache_creation_input_tokens: 14539, cache_read_input_tokens: 27861 },
  },
  exceeds_200k_tokens: false,
  effort: { level: 'medium' },
  thinking: { enabled: true },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
    seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
  },
  vim: { mode: 'NORMAL' },
}

/** What the script is expected to POST for STATUS_JSON */
const EXPECTED_EVENT = {
  type: 'session_status',
  sessionId: '8cf68f64-5433-40f7-a130-557fc7f67e42',
  project: 'Claude-Office',
  model: 'Haiku 5.5',
  modelId: 'claude-haiku-5-5',
  context: { used: 4.4, size: 1000000, input: 44051, output: 358 },
  rateLimits: { fiveHour: 23.5, fiveHourResetsAt: 1738425600, sevenDay: 41.2, sevenDayResetsAt: 1738857600 },
}

interface Captured { url: string; authorization?: string; ts?: string; sig?: string; body: any }

let server: Server
let serverUrl: string
let closedUrl: string
const captured: Captured[] = []
const homes: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      captured.push({
        url: req.url ?? '', authorization: req.headers.authorization,
        ts: req.headers['x-claudex-timestamp'] as string | undefined,
        sig: req.headers['x-claudex-signature'] as string | undefined,
        body: JSON.parse(data),
      })
      res.setHeader('Content-Type', 'application/json')
      res.end('{"ok":true}')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/status`

  // A port nothing listens on (bind, read, release)
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  closedUrl = `http://127.0.0.1:${(probe.address() as AddressInfo).port}/status`
  await new Promise<void>(resolve => probe.close(() => resolve()))
})

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

beforeEach(() => { captured.length = 0 })
afterEach(() => { while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true }) })

/** A fresh CLAUDEX_HOME, optionally with an auth token. */
function claudexHome({ token }: { token?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'claudex-status-'))
  homes.push(home)
  if (token) writeFileSync(join(home, 'auth-token'), token)
  return home
}

/**
 * Run the script, asynchronously: the capture server lives in this process,
 * so a synchronous run would keep it from answering until the POST timed out.
 */
async function run(payload: unknown, home: string, { args = [], url = serverUrl, env = {} }: { args?: string[]; url?: string; env?: Record<string, string> } = {}) {
  const started = Date.now()
  const out = await execScript(process.execPath, [SCRIPT, ...args], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    timeout: 10_000,
    // not an app terminal's, though the tests may run inside one
    env: { ...process.env, CLAUDEX_SESSION_ID: '', CLAUDEX_PORT: '', CLAUDEX_STATUS_URL: url, CLAUDEX_HOME: home, ...env },
  })
  return { out, ms: Date.now() - started }
}

/** The POST has landed by the time the script exits; the wait is a margin. */
async function posted(count = 1, ms = 3000): Promise<Captured[]> {
  const deadline = Date.now() + ms
  while (captured.length < count && Date.now() < deadline) await new Promise(r => setTimeout(r, 25))
  return captured
}

describe('status-line.cjs: statusLine', () => {
  it('prints "<model> · ctx <used>% · $<cost>" and POSTs a session_status SIGNED (no token on the wire)', async () => {
    const home = claudexHome({ token: 'a'.repeat(64) })
    const { out } = await run(STATUS_JSON, home)
    expect(out).toBe('Haiku 5.5 · ctx 4% · $0.01\n')

    const [req] = await posted()
    expect(req).toBeDefined()
    expect(req.url).toBe('/status')
    // The token is never sent; the request is signed instead
    expect(req.authorization).toBeUndefined()
    expect(req.ts).toMatch(/^\d+$/)
    expect(req.sig).toMatch(/^[0-9a-f]{64}$/)
    expect(req.body).toEqual(EXPECTED_EVENT)
  })

  it("in an app terminal posts under the terminal's id, also after /clear gave the conversation another", async () => {
    const terminal = '11111111-2222-4333-8444-555555555555'
    await run(STATUS_JSON, claudexHome(), { env: { CLAUDEX_SESSION_ID: terminal } })
    const [req] = await posted()
    expect(req.body).toEqual({ ...EXPECTED_EVENT, sessionId: terminal })
  })

  it('posts without an Authorization or signature header when there is no token file', async () => {
    const { out } = await run(STATUS_JSON, claudexHome())
    expect(out).toBe('Haiku 5.5 · ctx 4% · $0.01\n')
    const [req] = await posted()
    expect(req.authorization).toBeUndefined()
    expect(req.sig).toBeUndefined()
    expect(req.body.type).toBe('session_status')
  })

  it('posts to 127.0.0.1:$CLAUDEX_PORT/status when CLAUDEX_STATUS_URL is unset', async () => {
    const port = new URL(serverUrl).port
    const { out } = await run(STATUS_JSON, claudexHome(), { env: { CLAUDEX_STATUS_URL: '', CLAUDEX_PORT: port } })
    expect(out).toBe('Haiku 5.5 · ctx 4% · $0.01\n')
    const [req] = await posted()
    expect(req).toBeDefined()
    expect(req.url).toBe('/status')
    expect(req.body).toEqual(EXPECTED_EVENT)
  })

  it('CLAUDEX_STATUS_URL wins over CLAUDEX_PORT', async () => {
    const closedPort = new URL(closedUrl).port
    await run(STATUS_JSON, claudexHome(), { env: { CLAUDEX_PORT: closedPort } })
    const [req] = await posted()
    expect(req).toBeDefined()
    expect(req.body.type).toBe('session_status')
  })

  it('defaults to 127.0.0.1:3334/status (never `localhost`, which may resolve to [::1])', () => {
    const source = readFileSync(POST, 'utf8')
    expect(source).toContain(': 3334')
    expect(source).toContain('return `http://127.0.0.1:${port}/${kind}`')
    expect(source).not.toContain('localhost:')
  })

  it('handles the early-session shape: null used_percentage, no rate_limits, no cost yet, no effort', async () => {
    const early = {
      hook_event_name: 'Status',
      session_id: 'sess-early',
      cwd: '/tmp/scratch/my-project/',
      model: { id: 'claude-opus-5-5', display_name: 'Opus' },
      workspace: { current_dir: '/tmp/scratch/my-project', project_dir: '/tmp/scratch/my-project' },
      version: '2.1.300',
      cost: { total_cost_usd: 0, total_duration_ms: 120, total_api_duration_ms: 0, total_lines_added: 0, total_lines_removed: 0 },
      context_window: { total_input_tokens: 0, total_output_tokens: 0, context_window_size: 200000, used_percentage: null, remaining_percentage: null, current_usage: null },
      exceeds_200k_tokens: false,
    }
    const { out } = await run(early, claudexHome())
    expect(out).toBe('Opus · ctx 0% · $0.00\n')
    const [req] = await posted()
    expect(req.body).toEqual({
      type: 'session_status', sessionId: 'sess-early', project: 'my-project', model: 'Opus', modelId: 'claude-opus-5-5',
      context: { used: null, size: 200000, input: 0, output: 0 },
    })
    expect(req.body).not.toHaveProperty('rateLimits')
  })

  it('falls back to cwd for the project when workspace is absent, and forwards spend_limit', async () => {
    const payload = { ...STATUS_JSON, workspace: undefined, cwd: '/srv/apps/billing-api', rate_limits: { spend_limit: { used_percentage: 62.8, resets_at: 1740787200, used_usd: 314.12, limit_usd: 500, period: 'monthly' } } }
    await run(payload, claudexHome())
    const [req] = await posted()
    expect(req.body.project).toBe('billing-api')
    expect(req.body.rateLimits).toEqual({ spendLimit: 62.8, spendLimitResetsAt: 1740787200 })
  })

  it('still prints the line, exits 0 and does not wait when the server is down', async () => {
    const { out, ms } = await run(STATUS_JSON, claudexHome({ token: 't' }), { url: closedUrl })
    expect(out).toBe('Haiku 5.5 · ctx 4% · $0.01\n')
    // A refused connection answers at once (the POST's own timeout is 1 s)
    expect(ms).toBeLessThan(1500)
    expect(captured).toHaveLength(0)
  })

  it('exits 0 on garbage stdin and posts nothing', async () => {
    const { out } = await run('this is not json', claudexHome())
    expect(out).toBe('Claude · ctx 0% · $0.00\n')
    await new Promise(r => setTimeout(r, 300))
    expect(captured).toHaveLength(0)
  })

  it('exits 0 and prints nothing on empty stdin', async () => {
    expect((await run('', claudexHome())).out).toBe('')
  })
})

describe('older setups', () => {
  it('still read CLAUDEX_STATUS_URL and CLAUDEX_HOME when the CLAUDEX_ names are unset', async () => {
    const home = claudexHome({ token: 'b'.repeat(64) })
    await run(STATUS_JSON, home, { env: { CLAUDEX_STATUS_URL: serverUrl, CLAUDEX_HOME: home } })
    const [req] = await posted()
    expect(req.sig).toMatch(/^[0-9a-f]{64}$/)
  })
})
