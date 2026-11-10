/**
 * electron/codexWatch.cjs — a Codex CLI session told to Claudex from Codex's
 * own session log (~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread id>.jsonl):
 * prompts, tool calls (steps), turn ends, the model, the context and Codex's
 * usage limits, and the thread id a reopened tab resumes.
 */

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createCodexWatch, codexTool } = require('../electron/codexWatch.cjs')

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const START = new Date(2026, 10, 10, 14, 50).getTime() // local time: the date folders are local
const CWD = 'C:\\Users\\me\\work'
const line = (o: unknown) => JSON.stringify(o) + '\n'
const meta = (id: string, cwd = CWD, at = START + 1000) => line({ timestamp: new Date(at).toISOString(), type: 'session_meta', payload: { id, session_id: id, timestamp: new Date(at).toISOString(), cwd } })
const msg = (role: string, text: string) => line({ type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] } })
const ev = (type: string, extra: object = {}) => line({ type: 'event_msg', payload: { type, ...extra } })

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'codex-sessions-'))
  dirs.push(root)
  const day = join(root, '2026', '11', '10')
  mkdirSync(day, { recursive: true })
  const events: any[] = []
  const statuses: any[] = []
  const threads: string[] = []
  const make = (opts: object = {}) => createCodexWatch({
    sessionId: 's1', cwd: CWD, startedAt: START, sessionsDir: root, pollMs: 0, now: () => START + 60_000,
    emit: (e: any) => events.push(e), status: (s: any) => statuses.push(s), onThread: (id: string) => threads.push(id), ...opts,
  })
  return { day, events, statuses, threads, make }
}

describe('codex watch', () => {
  it('finds the session log Codex started in this folder after the tab opened (not an older one, not another folder)', () => {
    const { day, threads, make } = setup()
    writeFileSync(join(day, 'rollout-old-aaa.jsonl'), meta('aaa', CWD, START - 60_000))
    writeFileSync(join(day, 'rollout-other-bbb.jsonl'), meta('bbb', 'C:\\elsewhere'))
    const w = make()
    w.poll()
    expect(threads).toEqual([])
    writeFileSync(join(day, 'rollout-new-ccc.jsonl'), meta('ccc', 'c:/users/me/work'))
    w.poll()
    expect(threads).toEqual(['ccc'])
    w.stop()
  })

  it('tells prompts, tool calls, the model and turn ends; Codex\'s own context messages are not prompts', () => {
    const { day, events, make } = setup()
    const f = join(day, 'rollout-x-ddd.jsonl')
    writeFileSync(f, meta('ddd'))
    const w = make()
    w.poll()
    appendFileSync(f, ev('task_started') + line({ type: 'turn_context', payload: { model: 'gpt-6-luna' } }) + msg('user', '<environment_context>cwd</environment_context>') + msg('user', 'fix the login bug'))
    appendFileSync(f, line({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'npm test\nmore' } }))
    appendFileSync(f, line({ type: 'response_item', payload: { type: 'function_call', name: 'apply_patch', arguments: '{}' } }))
    appendFileSync(f, ev('task_complete', { last_agent_message: 'Fixed it.' }))
    w.poll()
    expect(events).toEqual([
      { type: 'session_model', sessionId: 's1', model: 'gpt-6-luna' },
      { type: 'session_prompt', sessionId: 's1', text: 'fix the login bug' },
      { type: 'agent_working', sessionId: 's1', tool: 'Bash', status: 'running: npm test' },
      { type: 'agent_working', sessionId: 's1', tool: 'Edit', status: 'editing' },
      { type: 'session_turn_end', sessionId: 's1', text: 'Fixed it.', backgroundTasks: [], crons: 0 },
    ])
    w.stop()
  })

  it('reports the context and Codex usage limits from token counts', () => {
    const { day, statuses, make } = setup()
    const f = join(day, 'rollout-x-eee.jsonl')
    writeFileSync(f, meta('eee') + line({ type: 'turn_context', payload: { model: 'gpt-6-luna' } }) + ev('token_count', {
      info: { last_token_usage: { input_tokens: 50_000, output_tokens: 1_000, total_tokens: 51_000 }, model_context_window: 200_000 },
      rate_limits: { primary: { used_percent: 12.5, window_minutes: 300, resets_at: 1794300000 }, secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1794800000 } },
    }))
    const w = make()
    w.poll()
    expect(statuses).toEqual([{
      type: 'session_status', sessionId: 's1', model: 'gpt-6-luna',
      context: { used: 25.5, size: 200_000, input: 50_000, output: 1_000 },
      codexLimits: { primary: { usedPercent: 12.5, windowMinutes: 300, resetsAt: 1794300000 }, secondary: { usedPercent: 40, windowMinutes: 10080, resetsAt: 1794800000 } },
    }])
    w.stop()
  })

  it('reads what is appended, a half-written line once it is whole', () => {
    const { day, events, make } = setup()
    const f = join(day, 'rollout-x-fff.jsonl')
    writeFileSync(f, meta('fff'))
    const w = make()
    w.poll()
    const whole = ev('task_complete', { last_agent_message: 'done' })
    appendFileSync(f, whole.slice(0, 10))
    w.poll()
    expect(events).toEqual([])
    appendFileSync(f, whole.slice(10))
    w.poll()
    expect(events).toEqual([{ type: 'session_turn_end', sessionId: 's1', text: 'done', backgroundTasks: [], crons: 0 }])
    w.stop()
  })

  it('a reopened tab follows the thread it resumes, from its end (the past is not told again), however old its folder', () => {
    const { day, events, threads, make } = setup()
    const old = join(day, '..', '..', '10', '02')
    mkdirSync(old, { recursive: true })
    const f = join(old, 'rollout-2026-10-02-ggg.jsonl')
    writeFileSync(f, meta('ggg', CWD, START - 86_400_000) + msg('user', 'old prompt') + ev('task_complete', { last_agent_message: 'old' }))
    const w = make({ resumeThread: 'ggg' })
    w.poll()
    expect(threads).toEqual(['ggg'])
    expect(events).toEqual([])
    appendFileSync(f, msg('user', 'new prompt'))
    w.poll()
    expect(events).toEqual([{ type: 'session_prompt', sessionId: 's1', text: 'new prompt' }])
    w.stop()
  })

  it('knows a Codex command line', () => {
    expect(codexTool({ command: 'codex' })).toBe(true)
    expect(codexTool({ command: 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd --full-auto' })).toBe(true)
    expect(codexTool({ command: '"C:\\Program Files\\codex\\codex.exe"' })).toBe(true)
    expect(codexTool({ command: 'gemini' })).toBe(false)
    expect(codexTool({ command: 'codexx' })).toBe(false)
  })
})

describe('codex watch, harder cases', () => {
  it('two tabs opened in one folder at once take the logs in the order they started', () => {
    const { day, make } = setup()
    const a: string[] = [], b: string[] = []
    const wa = make({ sessionId: 'a', startedAt: START, onThread: (id: string) => a.push(id) })
    const wb = make({ sessionId: 'b', startedAt: START + 5, onThread: (id: string) => b.push(id) })
    writeFileSync(join(day, 'rollout-1-first.jsonl'), meta('first', CWD, START + 1500))
    writeFileSync(join(day, 'rollout-2-second.jsonl'), meta('second', CWD, START + 1700))
    wb.poll() // the later tab polls first
    wa.poll()
    expect(a).toEqual(['first'])
    expect(b).toEqual(['second'])
    wa.stop(); wb.stop()
  })

  it('reads a log whose first line is very long (instructions in the session header)', () => {
    const { day, threads, make } = setup()
    const big = JSON.stringify({ type: 'session_meta', payload: { id: 'hhh', timestamp: new Date(START + 1000).toISOString(), cwd: CWD, base_instructions: { text: 'x'.repeat(200_000) } } }) + '\n'
    writeFileSync(join(day, 'rollout-big-hhh.jsonl'), big)
    const w = make()
    w.poll()
    expect(threads).toEqual(['hhh'])
    w.stop()
  })

  it('a Korean prompt split across two reads stays whole', () => {
    const { day, events, make } = setup()
    const f = join(day, 'rollout-x-kkk.jsonl')
    writeFileSync(f, meta('kkk'))
    const w = make()
    w.poll()
    const bytes = Buffer.from(msg('user', '로그인 버그 고쳐줘'))
    const cut = bytes.indexOf(Buffer.from('버')) + 1 // inside a three-byte character
    appendFileSync(f, bytes.subarray(0, cut))
    w.poll()
    appendFileSync(f, bytes.subarray(cut))
    w.poll()
    expect(events).toEqual([{ type: 'session_prompt', sessionId: 's1', text: '로그인 버그 고쳐줘' }])
    w.stop()
  })

  it("Codex's injected instructions are not prompts", () => {
    const { day, events, make } = setup()
    const f = join(day, 'rollout-x-lll.jsonl')
    writeFileSync(f, meta('lll') + msg('user', '# AGENTS.md instructions for C:\\work\n\nbe nice') + msg('user', 'real one'))
    const w = make()
    w.poll()
    expect(events).toEqual([{ type: 'session_prompt', sessionId: 's1', text: 'real one' }])
    w.stop()
  })

  it('usage limits without a token count still arrive', () => {
    const { day, statuses, make } = setup()
    writeFileSync(join(day, 'rollout-x-mmm.jsonl'), meta('mmm') + ev('token_count', { info: null, rate_limits: { primary: { used_percent: 5, window_minutes: 43200, resets_at: 1 } } }))
    const w = make()
    w.poll()
    expect(statuses).toEqual([{ type: 'session_status', sessionId: 's1', codexLimits: { primary: { usedPercent: 5, windowMinutes: 43200, resetsAt: 1 }, secondary: null } }])
    w.stop()
  })
})

describe('codex watch, tabs that wait', () => {
  it('a tab left idle does not take the log of a tab opened later in the same folder (a log is written at the first prompt)', () => {
    const { day, make } = setup()
    const a: string[] = [], b: string[] = []
    const wa = make({ sessionId: 'a', startedAt: START, onThread: (id: string) => a.push(id) })
    const wb = make({ sessionId: 'b', startedAt: START + 5 * 60_000, onThread: (id: string) => b.push(id) })
    // B's Codex started with B's tab and got the first prompt; A's Codex is still idle
    writeFileSync(join(day, 'rollout-b-bbbb.jsonl'), meta('bbbb', CWD, START + 5 * 60_000 + 800))
    wa.poll(); wb.poll()
    expect(a).toEqual([])
    expect(b).toEqual(['bbbb'])
    // A's prompt comes at last: its log is stamped with A's Codex start
    writeFileSync(join(day, 'rollout-a-aaaa.jsonl'), meta('aaaa', CWD, START + 700))
    wa.poll()
    expect(a).toEqual(['aaaa'])
    wa.stop(); wb.stop()
  })

  it("a closed tab's log is not handed to another tab", () => {
    const { day, make } = setup()
    const a: string[] = [], b: string[] = []
    const wa = make({ sessionId: 'a', startedAt: START, onThread: (id: string) => a.push(id) })
    const wb = make({ sessionId: 'b', startedAt: START + 10, onThread: (id: string) => b.push(id) })
    writeFileSync(join(day, 'rollout-a-cccc.jsonl'), meta('cccc', CWD, START + 600))
    wa.poll()
    expect(a).toEqual(['cccc'])
    wa.stop()
    wb.poll()
    expect(b).toEqual([])
    wb.stop()
  })

  it("a thread to resume that is gone: after a while the tab takes the new log Codex starts instead", () => {
    const { day, threads, make } = setup()
    let t = START + 1000
    const w = make({ resumeThread: '01a1c401-0000-7000-8000-000000000000', now: () => t })
    w.poll()
    expect(threads).toEqual([])
    writeFileSync(join(day, 'rollout-new-nnnn.jsonl'), meta('nnnn', CWD, START + 900))
    t = START + 15_000
    w.poll()
    expect(threads).toEqual(['nnnn'])
    w.stop()
  })
})

describe('codex watch, closed and reopened', () => {
  it('a thread whose tab was closed can be resumed by a new tab in the same run', () => {
    const { day, make } = setup()
    const a: string[] = [], b: string[] = []
    const wa = make({ sessionId: 'a', onThread: (id: string) => a.push(id) })
    writeFileSync(join(day, 'rollout-r-01a1c401-1111-7000-8000-000000000001.jsonl'), meta('01a1c401-1111-7000-8000-000000000001', CWD, START + 500))
    wa.poll()
    expect(a).toEqual(['01a1c401-1111-7000-8000-000000000001'])
    wa.stop()
    const wb = make({ sessionId: 'b', resumeThread: '01a1c401-1111-7000-8000-000000000001', onThread: (id: string) => b.push(id) })
    wb.poll()
    expect(b).toEqual(['01a1c401-1111-7000-8000-000000000001'])
    wb.stop()
  })

  it('a Codex that took minutes to start (a trust prompt left open) still finds its tab', () => {
    const { day, threads, make } = setup()
    const w = make()
    writeFileSync(join(day, 'rollout-slow-ssss.jsonl'), meta('ssss', CWD, START + 4 * 60_000))
    w.poll()
    expect(threads).toEqual(['ssss'])
    w.stop()
  })
})

describe('codex watch, an idle tab and a later one', () => {
  it('a tab opened minutes after an idle one in the same folder gets its own log', () => {
    const { day, make } = setup()
    const a: string[] = [], b: string[] = []
    const wa = make({ sessionId: 'a', startedAt: START, onThread: (id: string) => a.push(id) })
    const wb = make({ sessionId: 'b', startedAt: START + 3 * 60_000, onThread: (id: string) => b.push(id) })
    writeFileSync(join(day, 'rollout-b-later.jsonl'), meta('later', CWD, START + 3 * 60_000 + 700))
    wa.poll(); wb.poll()
    expect(a).toEqual([])
    expect(b).toEqual(['later'])
    wa.stop(); wb.stop()
  })
})
