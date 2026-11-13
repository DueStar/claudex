/**
 * electron/terminals.cjs — the app's Claude Code terminals: the session
 * settings it hands every session, and the environment it starts them in.
 */

import { spawnSync } from 'node:child_process'
import fs, { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os, { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { writeSessionSettings, cleanEnv, readOpenSessions, hasTranscript, linkedConversation, gitBranch, createTerminalManager } = require('../electron/terminals.cjs')

const REPO = fileURLToPath(new URL('..', import.meta.url))

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'poke-settings-')); dirs.push(d); return d }

describe('terminals.cjs', () => {
  it('writes session settings whose hooks and status line run this checkout\'s scripts with the app in Node mode', () => {
    const file = writeSessionSettings(REPO, tempDir(), 'C:\\Program Files\\spawn\\spawn.exe')
    const settings = JSON.parse(readFileSync(file, 'utf8'))
    const command: string = settings.hooks.SessionStart[0].hooks[0].command
    expect(command).toMatch(/^ELECTRON_RUN_AS_NODE=1 ".+spawn\.exe" "[^"\\]+\/hooks\/spawn-hook\.cjs"$/)
    expect(command).not.toMatch(/python|bash|curl/)
    expect(Object.keys(settings.hooks)).toEqual(expect.arrayContaining(['PreToolUse', 'Stop', 'SessionEnd', 'UserPromptSubmit', 'PermissionRequest']))
    expect(settings.statusLine.command).toMatch(/^ELECTRON_RUN_AS_NODE=1 ".+" ".+\/hooks\/status-line\.cjs"$/)
  })

  it('tool-call hooks run in the background (async); the ones that change what the session is doing do not', () => {
    const settings = JSON.parse(readFileSync(writeSessionSettings(REPO, tempDir(), process.execPath), 'utf8'))
    for (const e of ['PreToolUse', 'PostToolUse', 'PostToolBatch']) expect(settings.hooks[e][0].hooks[0].async, e).toBe(true)
    for (const e of ['Stop', 'PermissionRequest', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PostToolUseFailure', 'Notification']) expect(settings.hooks[e][0].hooks[0].async, e).toBeUndefined()
  })

  it('the hook command really runs in a shell: reads the payload, prints nothing, exits 0 (server down)', () => {
    // Here the "app" is the Node running the tests, which ignores ELECTRON_RUN_AS_NODE
    const settings = JSON.parse(readFileSync(writeSessionSettings(REPO, tempDir(), process.execPath), 'utf8'))
    const command: string = settings.hooks.PreToolUse[0].hooks[0].command
    const res = spawnSync('bash', ['-c', command], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, session_id: 's' }),
      encoding: 'utf8',
      env: { ...process.env, SPAWN_PORT: '9', SPAWN_HOME: tempDir() },
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
    expect(res.stderr).toBe('')
  })

  it('starts sessions without another Claude Code session\'s markers', () => {
    const env = cleanEnv({
      PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_PID: '9',
      CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CONFIG_DIR: '/c',
    })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', CLAUDE_CONFIG_DIR: '/c' })
  })

  it('reads back the sessions open at the last close: real ids, folders that exist, no repeats', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-open-'))
    const file = path.join(dir, 'open-sessions.json')
    const a = '11111111-1111-4111-8111-111111111111'
    fs.writeFileSync(file, JSON.stringify([
      { sessionId: a, cwd: dir }, { sessionId: a, cwd: dir },
      { sessionId: 'not-an-id', cwd: dir },
      { sessionId: '22222222-2222-4222-8222-222222222222', cwd: path.join(dir, 'gone') },
    ]))
    expect(readOpenSessions(file)).toEqual([{ sessionId: a, cwd: dir, tool: 'claude' }])
    fs.writeFileSync(file, '{broken')
    expect(readOpenSessions(file)).toEqual([])
    expect(readOpenSessions(path.join(dir, 'missing.json'))).toEqual([])
  })

  it('after /clear the hook links the terminal to its new conversation, which reopening resumes', () => {
    const userData = tempDir()
    const terminal = '11111111-2222-4333-8444-555555555555'
    const fresh = '99999999-8888-4777-8666-555555555555'
    fs.mkdirSync(join(userData, 'session-links'))
    expect(linkedConversation(userData, terminal)).toBe('')
    const res = spawnSync(process.execPath, [join(REPO, 'hooks', 'spawn-hook.cjs')], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'clear', session_id: fresh, cwd: REPO }),
      encoding: 'utf8',
      env: { ...process.env, SPAWN_EVENT_URL: 'http://127.0.0.1:9/event', SPAWN_SESSION_ID: terminal, SPAWN_LINK_FILE: join(userData, 'session-links', terminal) },
    })
    expect(res.status).toBe(0)
    expect(linkedConversation(userData, terminal)).toBe(fresh)
  })

  it("does not pass another app terminal's identity on", () => {
    const env = cleanEnv({ PATH: '/bin', SPAWN_SESSION_ID: 'x', SPAWN_LINK_FILE: 'y' })
    expect(env).toEqual({ PATH: '/bin' })
  })

  it("reads a folder's git branch from its repository (detached: the short commit; a worktree's .git file; none outside)", () => {
    const repo = tempDir()
    fs.mkdirSync(join(repo, '.git'))
    fs.mkdirSync(join(repo, 'src', 'deep'), { recursive: true })
    fs.writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/hp-bar\n')
    expect(gitBranch(join(repo, 'src', 'deep'))).toBe('feature/hp-bar')
    fs.writeFileSync(join(repo, '.git', 'HEAD'), 'eb017ee82a26a403af65ca01db31e9284e3d032d\n')
    expect(gitBranch(repo)).toBe('eb017ee')
    const wt = tempDir()
    fs.mkdirSync(join(repo, '.git', 'worktrees', 'w'), { recursive: true })
    fs.writeFileSync(join(repo, '.git', 'worktrees', 'w', 'HEAD'), 'ref: refs/heads/side\n')
    fs.writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'w')}\n`)
    expect(gitBranch(wt)).toBe('side')
    expect(gitBranch(tempDir())).toBeNull()
  })

  it('reopens only sessions that have a transcript', () => {
    const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-claude-'))
    const id = '33333333-3333-4333-8333-333333333333'
    fs.mkdirSync(path.join(claude, 'projects', 'C--work'), { recursive: true })
    fs.writeFileSync(path.join(claude, 'projects', 'C--work', `${id}.jsonl`), '{}\n')
    expect(hasTranscript(id, claude)).toBe(true)
    expect(hasTranscript('44444444-4444-4444-8444-444444444444', claude)).toBe(false)
  })

  it('drops the NO_COLOR Claude Code sets, keeps one the user set', () => {
    expect(cleanEnv({ PATH: '/bin', CLAUDECODE: '1', NO_COLOR: '1' })).toEqual({ PATH: '/bin' })
    expect(cleanEnv({ PATH: '/bin', NO_COLOR: '1' })).toEqual({ PATH: '/bin', NO_COLOR: '1' })
  })
})

/** A stand-in for node-pty: records what was spawned; `exit(pid)` plays the process ending */
function fakePty(log: string[] = []) {
  let next = 100
  const procs = new Map<number, { onExit?: (e: { exitCode: number }) => void; onData?: (d: string) => void; killed: boolean }>()
  const spawned: { command: string; args: string[] }[] = []
  return {
    procs,
    spawned,
    exit(pid: number) { procs.get(pid)?.onExit?.({ exitCode: 1 }) },
    data(pid: number, d: string) { procs.get(pid)?.onData?.(d) },
    spawn(command: string, args: string[]) {
      spawned.push({ command, args })
      const pid = next++
      const p = { killed: false } as { onExit?: (e: { exitCode: number }) => void; onData?: (d: string) => void; killed: boolean }
      procs.set(pid, p)
      return {
        pid,
        onData(cb: (d: string) => void) { p.onData = cb },
        onExit(cb: (e: { exitCode: number }) => void) { p.onExit = cb },
        kill() { p.killed = true; log.push(`pty ${pid}`) },
        write() {}, resize(c: number, r: number) { log.push(`resize ${pid} ${c}x${r}`) },
      }
    },
  }
}

function manager(pty: ReturnType<typeof fakePty>, killTree: (pid: number) => void, extra: Record<string, unknown> = {}) {
  const userDataDir = tempDir()
  return createTerminalManager({ repoRoot: REPO, userDataDir, defaultCwd: userDataDir, send: () => {}, pty, killTree, ...extra })
}

describe('terminal manager shutdown', () => {
  it("shutdown kills each running session's process tree and waits for its exit", async () => {
    const pty = fakePty()
    const killed: number[] = []
    const terms = manager(pty, (pid) => { killed.push(pid); setTimeout(() => pty.exit(pid), 10) })
    terms.create({ tool: 'shell' })
    terms.create({ tool: 'shell' })
    expect(await terms.shutdown(1000, 0)).toEqual({ exited: 2, stuck: 0 })
    expect(killed.sort()).toEqual([100, 101])
    expect([...pty.procs.values()].every(p => p.killed)).toBe(true)
  })

  it('shutdown gives up after the timeout and reports the stuck ones', async () => {
    const pty = fakePty()
    const terms = manager(pty, () => {})
    terms.create({ tool: 'shell' })
    const t0 = Date.now()
    expect(await terms.shutdown(50, 0)).toEqual({ exited: 0, stuck: 1 })
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('kills the tree first and the pty only after the exit; a session that ended by itself has its pty closed too', async () => {
    const order: string[] = []
    const pty = fakePty(order)
    const terms = manager(pty, (pid) => { order.push(`tree ${pid}`); pty.exit(pid) })
    terms.create({ tool: 'shell' })
    terms.create({ tool: 'shell' })
    pty.exit(101) // ended on its own earlier: still holds its pseudo-console
    expect(await terms.shutdown(1000, 0)).toEqual({ exited: 1, stuck: 0 })
    expect(order).toEqual(['tree 100', 'pty 100', 'pty 101'])
  })

  it('shutdown with nothing running resolves at once', async () => {
    const terms = manager(fakePty(), () => { throw new Error('no tree to kill') })
    expect(await terms.shutdown(1000, 0)).toEqual({ exited: 0, stuck: 0 })
  })
})

describe('the reopen list when Windows shuts down', () => {
  const setup = (exitGraceMs: number) => {
    const pty = fakePty()
    const userDataDir = tempDir()
    const terms = createTerminalManager({ repoRoot: REPO, userDataDir, defaultCwd: userDataDir, send: () => {}, pty, killTree: () => {}, exitGraceMs })
    const openList = () => JSON.parse(readFileSync(join(userDataDir, 'open-sessions.json'), 'utf8')).map((o: any) => o.sessionId)
    return { pty, terms, openList }
  }

  it('sessions ending one by one (Windows killing them before the app) stay listed until the exits settle', async () => {
    const { pty, terms, openList } = setup(60)
    const a = terms.create({ tool: 'shell' }) as any
    const b = terms.create({ tool: 'shell' }) as any
    expect(openList()).toEqual([a.sessionId, b.sessionId])
    pty.exit(100)
    pty.exit(101)
    // the app is killed in this window: the file still lists both, so the next start reopens them
    expect(openList()).toEqual([a.sessionId, b.sessionId])
    await new Promise(r => setTimeout(r, 120))
    // the app lived on: the ended ones leave the list
    expect(openList()).toEqual([])
  })

  it('once Windows says the session is ending (freeze), later exits never empty the list', async () => {
    const { pty, terms, openList } = setup(20)
    const a = terms.create({ tool: 'shell' }) as any
    terms.freeze()
    pty.exit(100)
    await new Promise(r => setTimeout(r, 60))
    expect(openList()).toEqual([a.sessionId])
  })

  it('closing a tab yourself still updates the list at once', () => {
    const { terms, openList } = setup(10_000)
    const a = terms.create({ tool: 'shell' }) as any
    const b = terms.create({ tool: 'shell' }) as any
    terms.close(a.id)
    expect(openList()).toEqual([b.sessionId])
  })
})

describe('resizing a session', () => {
  it('passes a new size on to the session once; the same size again is not sent (Claude Code redraws on every resize)', () => {
    const log: string[] = []
    const pty = fakePty(log)
    const terms = manager(pty, () => {})
    const info = terms.create({ tool: 'shell' })
    const id = (info as any).id ?? (info as any).terminal?.id
    terms.resize(id, 100, 30)
    terms.resize(id, 100, 30)
    terms.resize(id, 100, 30)
    terms.resize(id, 101, 30)
    expect(log.filter(l => l.startsWith('resize'))).toEqual(['resize 100 100x30', 'resize 100 101x30'])
  })
})

describe('closing a tab', () => {
  it("closes the pty of a session that already ended (it still holds its pseudo-console)", () => {
    const log: string[] = []
    const pty = fakePty(log)
    const terms = manager(pty, () => {})
    const t = terms.create({ tool: 'shell' })
    pty.exit(100)
    terms.close(t.id)
    expect(log).toEqual(['pty 100'])
  })
})

describe('terminal output', () => {
  it('output within 16 ms goes out as one message', async () => {
    vi.useFakeTimers()
    try {
      const pty = fakePty()
      const sent: { id: string; data: string }[] = []
      const terms = manager(pty, () => {}, { send: (ch: string, p: any) => { if (ch === 'terminals:data') sent.push(p) } })
      const t = terms.create({ tool: 'shell' })
      pty.data(100, 'a'); pty.data(100, 'b'); pty.data(100, 'c')
      expect(sent).toEqual([])
      await vi.advanceTimersByTimeAsync(20)
      expect(sent).toEqual([{ id: t.id, data: 'abc', seq: 1 }])
    } finally { vi.useRealTimers() }
  })

  it('the replay buffer holds only output already sent, at most 200000 characters', async () => {
    vi.useFakeTimers()
    try {
      const pty = fakePty()
      const terms = manager(pty, () => {})
      const t = terms.create({ tool: 'shell' })
      pty.data(100, 'pending')
      expect(terms.buffer(t.id)).toEqual({ data: '', seq: 0 })
      await vi.advanceTimersByTimeAsync(20)
      expect(terms.buffer(t.id)).toEqual({ data: 'pending', seq: 1 })
      for (let i = 0; i < 3000; i++) { pty.data(100, String(i % 10).repeat(100)); if (i % 50 === 49) await vi.advanceTimersByTimeAsync(20) }
      await vi.advanceTimersByTimeAsync(20)
      const { data: buf, seq } = terms.buffer(t.id)
      expect(seq).toBeGreaterThan(1)
      expect(buf.length).toBe(200000)
      expect(buf.endsWith('9'.repeat(100))).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it("a session's last output is sent before its exit is reported", async () => {
    const pty = fakePty()
    const order: string[] = []
    const terms = manager(pty, () => {}, { send: (ch: string, p: any) => order.push(ch === 'terminals:data' ? `data ${p.data}` : ch) })
    terms.create({ tool: 'shell' })
    order.length = 0
    pty.data(100, 'bye')
    pty.exit(100)
    expect(order[0]).toBe('data bye')
    expect(order).toContain('terminals:list')
  })
})

describe('a Codex tab', () => {
  const TOOLS = [{ id: 'codex', name: 'Codex CLI', command: 'codex' }]
  // Other AI tools switched on (electron/features.cjs), so the feature keeps being tested while it is hidden
  function codexManager(otherTools = true, userDataDir = tempDir()) {
    const pty = fakePty()
    const watches: any[] = []
    const events: any[] = []
    const statuses: any[] = []
    const terms = createTerminalManager({
      repoRoot: REPO, userDataDir, defaultCwd: userDataDir, send: () => {}, pty, killTree: () => {},
      tools: () => TOOLS, emit: (e: any) => events.push(e), postStatus: (s: any) => statuses.push(s),
      codexWatch: (opts: any) => { const w = { opts, stopped: false, stop() { w.stopped = true } }; watches.push(w); return w },
      otherTools,
    })
    return { pty, userDataDir, watches, events, statuses, terms }
  }

  it("follows its session log: what it tells goes to the server, its thread is remembered for reopening, and output stops standing in", () => {
    const { pty, userDataDir, watches, events, statuses, terms } = codexManager()
    const t = terms.create({ tool: 'codex' })
    expect(watches).toHaveLength(1)
    expect(watches[0].opts).toMatchObject({ sessionId: t.id, resumeThread: null })
    watches[0].opts.onThread('01a1c401-945a-7ca0-8b17-38351a3ade01')
    expect(linkedConversation(userDataDir, t.id)).toBe('01a1c401-945a-7ca0-8b17-38351a3ade01')
    watches[0].opts.status({ type: 'session_status', sessionId: t.id })
    expect(statuses).toEqual([{ type: 'session_status', sessionId: t.id }])
    events.length = 0
    pty.data(100, 'lots of output')
    expect(events.filter(e => e.type === 'agent_working')).toEqual([]) // the log speaks now, not the output
    watches[0].opts.emit({ type: 'session_prompt', sessionId: t.id, text: 'hi' })
    expect(events).toContainEqual({ type: 'session_prompt', sessionId: t.id, text: 'hi' })
    pty.exit(100)
    expect(watches[0].stopped).toBe(true)
  })

  it('reopened, it resumes the remembered thread; with none it starts anew under the same tab id', () => {
    const { pty, userDataDir, watches, terms } = codexManager()
    const id = '77777777-7777-4777-8777-777777777777'
    terms.create({ tool: 'codex', resume: id })
    expect(pty.spawned.at(-1)!.args).not.toContain('resume')
    expect(watches.at(-1).opts).toMatchObject({ sessionId: id, resumeThread: null })
    fs.mkdirSync(join(userDataDir, 'session-links'), { recursive: true })
    fs.writeFileSync(join(userDataDir, 'session-links', id), '01a1bf02-5c65-7463-ac3e-1dc7420b39fc')
    terms.close(id)
    terms.create({ tool: 'codex', resume: id })
    expect(pty.spawned.at(-1)!.args.slice(-2)).toEqual(['resume', '01a1bf02-5c65-7463-ac3e-1dc7420b39fc'])
    expect(watches.at(-1).opts).toMatchObject({ sessionId: id, resumeThread: '01a1bf02-5c65-7463-ac3e-1dc7420b39fc' })
  })

  it('switched on, a Codex tab from the last run comes back in the reopen list', () => {
    const userDataDir = tempDir()
    const codexTab = { sessionId: '88888888-8888-4888-8888-888888888888', cwd: userDataDir, tool: 'codex' }
    fs.writeFileSync(join(userDataDir, 'open-sessions.json'), JSON.stringify([codexTab]))
    const { terms } = codexManager(true, userDataDir)
    expect(terms.takeRestorable()).toEqual([codexTab])
  })
})

describe('other AI tools switched off (electron/features.cjs)', () => {
  const TOOLS = [{ id: 'codex', name: 'Codex CLI', command: 'codex' }]
  function offManager(userDataDir = tempDir()) {
    const pty = fakePty()
    const watches: any[] = []
    const events: any[] = []
    const terms = createTerminalManager({
      repoRoot: REPO, userDataDir, defaultCwd: userDataDir, send: () => {}, pty, killTree: () => {},
      // Codex still listed in the stored settings: it must not leak through
      tools: () => TOOLS, emit: (e: any) => events.push(e),
      codexWatch: (opts: any) => { const w = { opts, stop() {} }; watches.push(w); return w },
      otherTools: false,
    })
    return { pty, userDataDir, watches, events, terms }
  }

  it('a session asked for with Codex (a stored default) starts Claude Code, and no Codex log watcher runs', () => {
    const { pty, watches, events, terms } = offManager()
    const t = terms.create({ tool: 'codex' })
    expect(t.tool).toBe('claude')
    expect(t.toolName).toBe('Claude Code')
    expect(pty.spawned.at(-1)!.args).toContain('--session-id')
    expect(pty.spawned.at(-1)!.command).not.toMatch(/codex/i)
    expect(watches).toEqual([])
    expect(events).toEqual([]) // nothing stands in for hooks: it is a Claude session
  })

  it('a reopened Codex id starts a fresh Claude Code, never a resume of an id Claude never had', () => {
    const { pty, terms } = offManager()
    terms.create({ tool: 'codex', resume: '77777777-7777-4777-8777-777777777777' })
    expect(pty.spawned.at(-1)!.args).not.toContain('--resume')
    expect(pty.spawned.at(-1)!.args).not.toContain('resume')
  })

  it("the shell tab is not part of it: it still opens", () => {
    const { pty, terms } = offManager()
    expect(terms.create({ tool: 'shell' }).tool).toBe('shell')
    expect(pty.spawned).toHaveLength(1)
  })

  it('Codex tabs in the reopen list are skipped, and kept in the list for when the switch is flipped back', () => {
    const userDataDir = tempDir()
    const codexTab = { sessionId: '88888888-8888-4888-8888-888888888888', cwd: userDataDir, tool: 'codex' }
    const shellTab = { sessionId: '99999999-9999-4999-8999-999999999999', cwd: userDataDir, tool: 'shell' }
    fs.writeFileSync(join(userDataDir, 'open-sessions.json'), JSON.stringify([codexTab, shellTab]))
    const { terms } = offManager(userDataDir)
    expect(terms.takeRestorable()).toEqual([shellTab])
    // This run writes its own tabs over the list: the Codex one stays in it
    const s = terms.create({ tool: 'shell' })
    const list = JSON.parse(readFileSync(join(userDataDir, 'open-sessions.json'), 'utf8'))
    expect(list).toEqual([{ sessionId: s.sessionId, cwd: userDataDir, tool: 'shell' }, codexTab])
    terms.close(s.id)
    expect(JSON.parse(readFileSync(join(userDataDir, 'open-sessions.json'), 'utf8'))).toEqual([codexTab])
  })
})

describe('the other-tools switch', () => {
  it('the manager follows electron/features.cjs when not told otherwise', () => {
    const { OTHER_TOOLS } = require('../electron/features.cjs')
    const pty = fakePty()
    const userDataDir = tempDir()
    const terms = createTerminalManager({
      repoRoot: REPO, userDataDir, defaultCwd: userDataDir, send: () => {}, pty, killTree: () => {},
      tools: () => [{ id: 'codex', name: 'Codex CLI', command: 'codex' }],
      codexWatch: () => ({ stop() {} }),
    })
    expect(terms.create({ tool: 'codex' }).tool).toBe(OTHER_TOOLS ? 'codex' : 'claude')
  })
})

describe('reopening tabs', () => {
  it('a reopened id that is not a session id is not taken (it names a file)', () => {
    const terms = manager(fakePty(), () => {})
    const t = terms.create({ tool: 'shell', resume: '..\..\escape' })
    expect(t.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('a tab whose tool was removed from the settings opens a fresh Claude Code, not a resume of an id it never had', () => {
    const pty = fakePty()
    const terms = manager(pty, () => {})
    terms.create({ tool: 'gone-tool', resume: '77777777-7777-4777-8777-777777777777' })
    expect(pty.spawned.at(-1)!.args).not.toContain('--resume')
    expect(pty.spawned.at(-1)!.args).toContain('--session-id')
  })
})
