/**
 * electron/adapters.cjs — the AI tools a session can run: Claude Code with
 * its hooks, and any listed terminal tool whose output stands in for events.
 */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { adapterFor, validTool, splitCommand, createActivity, STEP_MS, QUIET_MS } = require('../electron/adapters.cjs')
const { sanitize } = require('../electron/settings.cjs')

describe('adapters.cjs', () => {
  it('Claude Code is the default and the fallback: hooks, resume, its own arguments', () => {
    const claude = adapterFor(undefined)
    expect(claude.id).toBe('claude')
    expect(adapterFor('nope', []).id).toBe('claude')
    const run = claude.launch({ sessionId: 'abc', settingsFile: 's.json', extraArgs: ['--model', 'opus'] })
    expect(run.args).toEqual(['--session-id', 'abc', '--settings', 's.json', '--model', 'opus'])
    expect(claude.launch({ resume: 'old', settingsFile: 's.json' }).args.slice(0, 2)).toEqual(['--resume', 'old'])
    expect(claude.events).toBe('hooks')
  })

  it('a listed tool runs its own command, reports through its output, and cannot resume', () => {
    const tools = [{ id: 'codex', name: 'Codex CLI', command: 'codex --model "gpt 5"' }]
    const a = adapterFor('codex', tools)
    expect(a).toMatchObject({ id: 'codex', name: 'Codex CLI', events: 'pty', canResume: false })
    const run = a.launch({})
    // on Windows a bare name goes through cmd.exe (npm shims are .cmd files)
    expect(run.args.slice(-3)).toEqual(['codex', '--model', 'gpt 5'].slice(-3))
    expect(a.asking.test('Would you like to run the following command?')).toBe(true)
    expect(a.asking.test('Allow once')).toBe(true)
    expect(a.asking.test('Reading files')).toBe(false)
  })

  it('splits a command line with quotes', () => {
    expect(splitCommand('"C:\\Program Files\\x\\x.exe" --flag a  b')).toEqual(['C:\\Program Files\\x\\x.exe', '--flag', 'a', 'b'])
    expect(splitCommand('   ')).toEqual([])
  })

  it('checks a listed tool: an id of its own, a name, a command', () => {
    expect(validTool({ id: 'gemini', name: 'Gemini', command: 'gemini' })).toBe(true)
    expect(validTool({ id: 'claude', name: 'x', command: 'x' })).toBe(false)
    expect(validTool({ id: 'shell', name: 'x', command: 'x' })).toBe(false) // the built-in shell tab
    expect(validTool({ id: 'Bad Id', name: 'x', command: 'x' })).toBe(false)
    expect(validTool({ id: 'x', name: '', command: 'x' })).toBe(false)
    expect(validTool({ id: 'x', name: 'x', command: '  ' })).toBe(false)
  })

  it('settings keep a valid tool list (three fields each) and drop a bad one', () => {
    const ok = sanitize({ session: { tools: [{ id: 'codex', name: ' Codex ', command: 'codex', extra: 1 }], defaultTool: 'codex' } })
    expect(ok.session.tools).toEqual([{ id: 'codex', name: 'Codex', command: 'codex' }])
    expect(ok.session.defaultTool).toBe('codex')
    expect(sanitize({ session: { tools: [{ id: 'x', name: 'a', command: 'a' }, { id: 'x', name: 'b', command: 'b' }] } }).session.tools).toEqual([])
    expect(sanitize({ session: { tools: 'codex' } }).session.tools).toEqual([])
  })

  it('output is work: a step at its start and every STEP_MS, the turn ends after a quiet spell, echoes are not work', () => {
    let t = 1_000_000
    const timers: { at: number; fn: () => void }[] = []
    const sent: any[] = []
    const act = createActivity({
      sessionId: 's', tool: 'Codex CLI', cwd: '/w', emit: (e: any) => sent.push(e), now: () => t,
      setTimer: (fn: () => void, ms: number) => { const x = { at: t + ms, fn }; timers.push(x); return x },
      clearTimer: (x: any) => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1) },
      every: () => null, stopEvery: () => {},
    })
    const run = () => { for (const x of [...timers]) if (x.at <= t) { timers.splice(timers.indexOf(x), 1); x.fn() } }
    // the trainer types: the echo is not work
    act.input(); t += 50; act.output('h')
    expect(sent).toEqual([])
    // the tool answers: a step
    t += 1000; act.output('thinking…')
    expect(sent.map(e => e.type)).toEqual(['agent_working'])
    expect(sent[0]).toMatchObject({ sessionId: 's', tool: 'Codex CLI' })
    // still going: one more step only after STEP_MS
    for (let i = 0; i < 10; i++) { t += 1000; act.output('…') }
    expect(sent.length).toBe(1)
    t += STEP_MS; act.output('…')
    expect(sent.length).toBe(2)
    // quiet: the turn is over, once
    t += QUIET_MS; run()
    expect(sent.at(-1)).toEqual({ type: 'session_turn_end', sessionId: 's' })
    t += QUIET_MS; run()
    expect(sent.filter(e => e.type === 'session_turn_end').length).toBe(1)
  })
})

describe('adapters: the plain shell tab', () => {
  it('runs PowerShell (the login shell elsewhere), reports nothing and cannot resume', () => {
    const a = adapterFor('shell', [{ id: 'shell', name: 'Mine', command: 'mine' }])
    expect(a.id).toBe('shell')
    expect(a.events).toBe('none')
    expect(a.canResume).toBe(false)
    expect(a.asking.test('Do you want to proceed? [y/N]')).toBe(false)
    const { file } = a.launch({})
    expect(file).toMatch(process.platform === 'win32' ? /^powershell\.exe$/ : /sh$/)
  })
})
