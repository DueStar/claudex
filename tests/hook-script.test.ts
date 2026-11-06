/**
 * hooks/agent-tracker.sh — the Python (hooks/agent-tracker.py) that turns a
 * Claude Code hook payload into a server event. The bash wrapper reads stdin, pipes the
 * payload into the Python (never through an environment variable or an
 * argument: a big tool_response would hit the exec's single-argument limit)
 * and curls the result, so the heredoc is lifted out (the same awk the repo
 * uses by hand) and run against real 2.1.x payload shapes exactly as the
 * wrapper runs it: `python3 -I -c <source>` with the payload on stdin. The
 * last group runs the whole script with a fake `curl` on PATH.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const TRACKER = fileURLToPath(new URL('../hooks/agent-tracker.sh', import.meta.url))

// The event builder lives beside the script (it used to be a heredoc inside it)
const PYTHON_FILE = fileURLToPath(new URL('../hooks/agent-tracker.py', import.meta.url))
const PYTHON = readFileSync(PYTHON_FILE, 'utf8')
if (!PYTHON.includes('hook_event_name')) throw new Error('could not read hooks/agent-tracker.py')

// A home with no token file, so the developer's real ~/.agent-office never changes what the tests see
const NO_MARKER_HOME = mkdtempSync(join(tmpdir(), 'claudex-hook-home-'))
afterAll(() => rmSync(NO_MARKER_HOME, { recursive: true, force: true }))

/**
 * The hook's Python against a payload (on stdin, as the wrapper does): its
 * stdout content lines. The Python prints the event, then its POST signature
 * (empty here — these runs set no OFFICE_TOKEN); the empty signature line is
 * dropped so the tests speak to the event. The live wrapper reads the lines
 * positionally (sed -n), so the empty line there is harmless.
 */
function runHookLines(payload: unknown, env: Record<string, string> = {}): string[] {
  const out = execFileSync('python3', ['-I', PYTHON_FILE], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, AGENT_OFFICE_HOME: NO_MARKER_HOME, ...env },
  }).trim()
  return out ? out.split('\n').filter(line => line !== '') : []
}

/** Canonical JSON as the hook's call_key writes it: keys sorted, no spaces. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** The callKey the hook sends for a call: 16 hex of sha256(tool name, NUL, the input). */
function callKeyOf(toolName: string, input: unknown): string {
  return createHash('sha256').update(`${toolName}\0${canonical(input)}`).digest('hex').slice(0, 16)
}

/** Run the hook's Python against a payload; null when it printed nothing. */
function runHook(payload: unknown): Record<string, any> | null {
  const lines = runHookLines(payload)
  if (lines.length > 1) throw new Error(`expected one line, got ${lines.length}: ${lines.join(' | ')}`)
  return lines.length ? JSON.parse(lines[0]) : null
}

describe('agent-tracker.sh: Agent tool', () => {
  it('PreToolUse Agent -> agent_working with tool Agent (a step in the Safari Zone), the task in the status (Task alias too)', () => {
    expect(runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_use_id: 'toolu_01X',
      tool_input: { description: 'Write tests for parser', prompt: '...', subagent_type: 'general-purpose', run_in_background: true },
    })).toEqual({ type: 'agent_working', status: 'starting a subagent: Write tests for parser', tool: 'Agent' })
    expect(runHook({
      hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 'toolu_02Y',
      tool_input: { prompt: '...', subagent_type: 'debugger' },
    })).toEqual({ type: 'agent_working', status: 'starting a subagent: debugger', tool: 'Task' })
  })

  it('PostToolUse Agent -> session_tool_done like any tool (lowers the hand the call raised); without a session, nothing', () => {
    const session = { session_id: 's1', cwd: '/x/proj', transcript_path: '/t.jsonl' }
    const input = { description: 'Write tests for parser', prompt: '...', subagent_type: 'general-purpose', run_in_background: true }
    expect(runHook({
      ...session, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_01X', tool_input: input,
      tool_response: { isAsync: true, status: 'async_launched', agentId: 'a1921bf97b0af9fd1' },
    })).toEqual({ type: 'session_tool_done', toolName: 'Agent', callKey: callKeyOf('Agent', input), sessionId: 's1', project: 'proj', cwd: '/x/proj', transcriptPath: '/t.jsonl' })
    expect(runHook({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: input, tool_response: {} })).toBeNull()
  })
})

describe('agent-tracker.sh: inside a subagent', () => {
  it('PreToolUse Bash with agent_id -> agent_working tagged with the subagent', () => {
    expect(runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      agent_id: 'a1921bf97b0af9fd1',
      agent_type: 'general-purpose',
      tool_input: { command: 'ls /etc | wc -l' },
    })).toEqual({
      type: 'agent_working',
      status: 'running: ls /etc | wc -l',
      tool: 'Bash',
      agentId: 'a1921bf97b0af9fd1',
    })
  })

  it('PreToolUse Read on the main thread -> agent_working without an agent id', () => {
    expect(runHook({
      hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/repo/server/index.js' },
    })).toEqual({ type: 'agent_working', status: 'reading index.js', tool: 'Read' })
  })

  it('SubagentStop -> agent_completed with the last assistant message', () => {
    expect(runHook({
      hook_event_name: 'SubagentStop',
      agent_id: 'af4d4090b68ebb5f9',
      agent_type: 'general-purpose',
      last_assistant_message: 'The Bash command ran and printed hi.',
    })).toEqual({ type: 'agent_completed', agentId: 'af4d4090b68ebb5f9', result: 'The Bash command ran and printed hi.' })

    expect(runHook({ hook_event_name: 'SubagentStop', agent_id: 'af4d4090b68ebb5f9', agent_type: 'general-purpose' })?.result).toBe('done')
    expect(runHook({ hook_event_name: 'SubagentStop' })).toBeNull()
  })

  it('PostToolUseFailure with agent_id -> failed agent_working tagged with the subagent', () => {
    // Shape captured on the main thread (see below) plus the agent_id/agent_type
    // every hook fired inside a subagent carries — not captured inside one.
    expect(runHook({
      hook_event_name: 'PostToolUseFailure',
      agent_id: 'a29964dc791f62039',
      agent_type: 'general-purpose',
      tool_name: 'Bash',
      tool_input: { command: 'cat /definitely/not/here', description: 'Attempt to read a nonexistent file' },
      tool_use_id: 'toolu_01NT86yPHDT746zG29pswfa9',
      error: 'Exit code 1\ncat: /definitely/not/here: No such file or directory',
      is_interrupt: false,
      duration_ms: 135,
    })).toEqual({
      type: 'agent_working',
      status: 'failed: Bash — Exit code 1 cat: /definitely/not/here: No such file or direc',
      failed: true,
      tool: 'Bash',
      agentId: 'a29964dc791f62039',
    })
  })

  it('nested PreToolUse Agent (a subagent spawning a subagent) -> agent_working tagged with the parent subagent', () => {
    // The Agent call is made inside subagent a29964dc791f62039, so the hook
    // carries its agent_id/agent_type like any other tool call made in there.
    expect(runHook({
      hook_event_name: 'PreToolUse',
      agent_id: 'a29964dc791f62039',
      agent_type: 'general-purpose',
      tool_name: 'Agent',
      tool_input: { description: 'Find hostname', prompt: 'Read /etc/hostname and report it.', subagent_type: 'Explore', run_in_background: false },
      tool_use_id: 'toolu_012RzmXCF41YXYEnVbdvuQTT',
    })).toEqual({ type: 'agent_working', status: 'starting a subagent: Find hostname', tool: 'Agent', agentId: 'a29964dc791f62039' })
  })
})

/**
 * Payloads captured verbatim from Claude Code 2.1.300 (scratchpad/hookcap,
 * 2026-10-14). Only the capture's own bookkeeping keys were dropped.
 */
describe('agent-tracker.sh: captured 2.1.300 payloads', () => {
  const common = {
    session_id: '8cf68f64-5433-40f7-a130-557fc7f67e42',
    transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/8cf68f64-5433-40f7-a130-557fc7f67e42.jsonl',
    cwd: '/tmp/claude-0/-home-user-Claude-Office/c25c5511-f321-521a-825b-f189ac4d57e8/scratchpad/hookcap',
    scratchpad_dir: '/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/8cf68f64-5433-40f7-a130-557fc7f67e42/scratchpad',
    prompt_id: 'd0f0818e-428e-4732-b3f2-6830d470b485',
  }
  // What every event made from `common` carries: the session it came from
  const session = {
    sessionId: common.session_id,
    project: 'hookcap',
    cwd: common.cwd,
    transcriptPath: common.transcript_path,
  }
  // The other capture session (c25c5511…) that some payloads below belong to
  const other = {
    session_id: 'c25c5511-f321-521a-825b-f189ac4d57e8',
    transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/c25c5511-f321-521a-825b-f189ac4d57e8.jsonl',
  }
  const otherSession = { sessionId: other.session_id, project: 'hookcap', cwd: common.cwd, transcriptPath: other.transcript_path }

  it('SubagentStart -> nothing (the subagent shows up in its own tool calls)', () => {
    expect(runHook({ ...common, agent_id: 'ac5ff55b850b4fecf', agent_type: 'general-purpose', hook_event_name: 'SubagentStart' })).toBeNull()
  })

  it('PreToolUse Agent (background) -> agent_working on the main thread', () => {
    expect(runHook({
      ...common,
      permission_mode: 'bypassPermissions',
      effort: { level: 'medium' },
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_input: { description: 'Count etc', prompt: 'Run ls /etc | wc -l with Bash and report it.', subagent_type: 'general-purpose', run_in_background: true },
      tool_use_id: 'toolu_01B8Zp1BDnyYNe7SEsseUD22',
    })).toEqual({ type: 'agent_working', status: 'starting a subagent: Count etc', tool: 'Agent', ...session })
  })

  it('PostToolUse Agent (async_launched) -> session_tool_done', () => {
    expect(runHook({
      ...common,
      permission_mode: 'bypassPermissions',
      effort: { level: 'medium' },
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      tool_input: { description: 'Count etc', prompt: 'Run ls /etc | wc -l with Bash and report it.', subagent_type: 'general-purpose', run_in_background: true },
      tool_response: {
        isAsync: true,
        status: 'async_launched',
        agentId: 'ac5ff55b850b4fecf',
        description: 'Count etc',
        resolvedModel: 'claude-haiku-5-5',
        prompt: 'Run ls /etc | wc -l with Bash and report it.',
        outputFile: '/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/8cf68f64-5433-40f7-a130-557fc7f67e42/tasks/ac5ff55b850b4fecf.output',
        canReadOutputFile: true,
        canContinueAgent: true,
      },
      tool_use_id: 'toolu_01B8Zp1BDnyYNe7SEsseUD22',
      duration_ms: 10,
    })).toMatchObject({ type: 'session_tool_done', toolName: 'Agent', ...session })
  })

  it('PreToolUse Bash inside the subagent -> agent_working on that subagent', () => {
    // A hook fired inside a subagent carries the PARENT session's session_id
    // (the subagent transcript lives under <session_id>/subagents/), so the
    // working event files the worker under the terminal that spawned it
    expect(runHook({
      ...other,
      cwd: common.cwd,
      scratchpad_dir: '/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/c25c5511-f321-521a-825b-f189ac4d57e8/scratchpad',
      prompt_id: '60d87662-ef42-4452-a6bd-cd9718825c5b',
      permission_mode: 'bypassPermissions',
      agent_id: 'a29964dc791f62039',
      agent_type: 'general-purpose',
      effort: { level: 'medium' },
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls /etc | wc -l', description: 'Count entries in /etc' },
      tool_use_id: 'toolu_01YUQ8UYuNroNSSpa5Qp26CW',
    })).toEqual({
      type: 'agent_working',
      status: 'running: ls /etc | wc -l',
      tool: 'Bash',
      agentId: 'a29964dc791f62039',
      promptId: undefined,
      ...otherSession,
    })
  })

  it('SubagentStop of a real worker -> agent_completed with the first 120 chars of its last message', () => {
    const last = '`ls /etc | wc -l` returned **154**, so `/etc` has 154 entries.\n\nThe MCP connection failures in the system notice (design and sales plugin servers returning 403 from the proxy) are unrelated to this command and did not affect it.'
    expect(runHook({
      ...common,
      permission_mode: 'bypassPermissions',
      agent_id: 'ac5ff55b850b4fecf',
      agent_type: 'general-purpose',
      effort: { level: 'medium' },
      hook_event_name: 'SubagentStop',
      stop_hook_active: false,
      agent_transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/8cf68f64-5433-40f7-a130-557fc7f67e42/subagents/agent-ac5ff55b850b4fecf.jsonl',
      last_assistant_message: last,
      background_tasks: [{ id: 'ac5ff55b850b4fecf', type: 'subagent', status: 'running', description: 'Count etc', agent_type: 'general-purpose' }],
      session_crons: [],
    })).toEqual({ type: 'agent_completed', agentId: 'ac5ff55b850b4fecf', result: last.slice(0, 120), ...session })
  })

  it('phantom SubagentStop (compaction summariser, agent_type "") -> nothing', () => {
    expect(runHook({
      session_id: 'c25c5511-f321-521a-825b-f189ac4d57e8',
      transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/c25c5511-f321-521a-825b-f189ac4d57e8.jsonl',
      cwd: common.cwd,
      scratchpad_dir: '/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/c25c5511-f321-521a-825b-f189ac4d57e8/scratchpad',
      prompt_id: 'e40b57ac-50aa-4bae-a043-8852cc9ba9c7',
      permission_mode: 'bypassPermissions',
      agent_id: 'a4b69979afca21afd',
      agent_type: '',
      effort: { level: 'medium' },
      hook_event_name: 'SubagentStop',
      stop_hook_active: false,
      agent_transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/c25c5511-f321-521a-825b-f189ac4d57e8/subagents/agent-a4b69979afca21afd.jsonl',
      last_assistant_message: '<analysis>\nThe conversation has three parts. The user first asked for two subagents: a background general-purpose agent described as "Count etc" to run `ls /etc | wc -l`, and a foreground Explore agent described as "Find hostname" to read `/etc/hostname`. They then asked me to wait for the background result and reply DONE. I launched both in one message. The foreground agent returned `vm` as the h...[+2447 chars]',
      background_tasks: [],
      session_crons: [],
    })).toBeNull()
  })

  it('phantom SubagentStop (prompt-suggestion sidechain, agent_type "") -> nothing', () => {
    expect(runHook({
      session_id: 'ce07e2db-35c7-42b0-b00b-fb2ebe9f8e3f',
      transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/ce07e2db-35c7-42b0-b00b-fb2ebe9f8e3f.jsonl',
      cwd: common.cwd,
      scratchpad_dir: '/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/ce07e2db-35c7-42b0-b00b-fb2ebe9f8e3f/scratchpad',
      prompt_id: 'b09cb9a5-0ed7-4592-b4cb-94b9c030e211',
      permission_mode: 'bypassPermissions',
      agent_id: 'a876884f19e1485b2',
      agent_type: '',
      effort: { level: 'medium' },
      hook_event_name: 'SubagentStop',
      stop_hook_active: false,
      agent_transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/ce07e2db-35c7-42b0-b00b-fb2ebe9f8e3f/subagents/agent-a876884f19e1485b2.jsonl',
      last_assistant_message: 'try the team setup again',
      background_tasks: [],
      session_crons: [],
    })).toBeNull()

    // Missing agent_type altogether is treated the same way
    expect(runHook({ hook_event_name: 'SubagentStop', agent_id: 'a876884f19e1485b2', last_assistant_message: 'x' })).toBeNull()
  })

  it('PostToolUseFailure on the main thread (Bash exit 1) -> failed agent_working without an agent id', () => {
    const failure = {
      session_id: '17f46010-d2b1-4d95-bdde-34994b4b1d00',
      transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/17f46010-d2b1-4d95-bdde-34994b4b1d00.jsonl',
      cwd: common.cwd,
      scratchpad_dir: '/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/17f46010-d2b1-4d95-bdde-34994b4b1d00/scratchpad',
      prompt_id: '47795df5-e84a-4a57-8884-078b1e761a82',
      permission_mode: 'bypassPermissions',
      effort: { level: 'medium' },
      hook_event_name: 'PostToolUseFailure',
    }
    const failureSession = { sessionId: failure.session_id, project: 'hookcap', cwd: failure.cwd, transcriptPath: failure.transcript_path }
    expect(runHook({
      ...failure,
      tool_name: 'Bash',
      tool_input: { command: 'cat /definitely/not/here', description: 'Attempt to read a nonexistent file' },
      tool_use_id: 'toolu_01NT86yPHDT746zG29pswfa9',
      error: 'Exit code 1\ncat: /definitely/not/here: No such file or directory',
      is_interrupt: false,
      duration_ms: 135,
    })).toEqual({
      type: 'agent_working',
      status: 'failed: Bash — Exit code 1 cat: /definitely/not/here: No such file or direc',
      failed: true,
      tool: 'Bash',
      ...failureSession,
    })

    expect(runHook({
      ...failure,
      tool_name: 'Bash',
      tool_input: { command: 'false', description: 'Run false to exit with status 1' },
      tool_use_id: 'toolu_01CHztAKTp1SviXu1oRzVeh9',
      error: 'Exit code 1',
      is_interrupt: false,
      duration_ms: 53,
    })).toEqual({ type: 'agent_working', status: 'failed: Bash — Exit code 1', failed: true, tool: 'Bash', ...failureSession })
  })

  it('PostToolUseFailure of an MCP call -> mcp_done, of an Agent launch -> a failed agent_working', () => {
    expect(runHook({
      hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__github__get_me', tool_input: {}, tool_use_id: 'toolu_mcp',
      error: 'MCP error -32603: boom', is_interrupt: false, duration_ms: 20,
    })).toEqual({ type: 'mcp_done', server: 'github', tool: 'get_me', callKey: callKeyOf('mcp__github__get_me', {}) })

    expect(runHook({
      hook_event_name: 'PostToolUseFailure', tool_name: 'Agent', tool_use_id: 'toolu_01X',
      tool_input: { description: 'Nope', prompt: '...', subagent_type: 'does-not-exist' },
      error: 'Agent type \'does-not-exist\' not found.', is_interrupt: false, duration_ms: 3,
    })).toEqual({ type: 'agent_working', status: "failed: Agent — Agent type 'does-not-exist' not found.", failed: true, tool: 'Agent' })
  })
})

/**
 * Sessions. SessionStart / SessionEnd payloads captured verbatim from Claude
 * Code 2.1.300 (scratchpad/hookcap/events.jsonl, 2026-10-14): session_id,
 * transcript_path and cwd are in the base schema of every hook event.
 */
describe('agent-tracker.sh: sessions', () => {
  const base = {
    session_id: 'c25c5511-f321-521a-825b-f189ac4d57e8',
    transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/c25c5511-f321-521a-825b-f189ac4d57e8.jsonl',
    cwd: '/tmp/claude-0/-home-user-Claude-Office/c25c5511-f321-521a-825b-f189ac4d57e8/scratchpad/hookcap',
    scratchpad_dir: '/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/c25c5511-f321-521a-825b-f189ac4d57e8/scratchpad',
  }
  const session = { sessionId: base.session_id, project: 'hookcap', cwd: base.cwd, transcriptPath: base.transcript_path }

  it('SessionStart {source: startup} -> session_started (no model on a bare startup)', () => {
    expect(runHook({ ...base, hook_event_name: 'SessionStart', source: 'startup' }))
      .toEqual({ type: 'session_started', source: 'startup', ...session })
  })

  it('SessionStart {source: startup, model} -> session_started with the model', () => {
    expect(runHook({
      session_id: '19616213-277c-4e70-9909-9883230a3394',
      transcript_path: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/19616213-277c-4e70-9909-9883230a3394.jsonl',
      cwd: base.cwd,
      scratchpad_dir: '/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/19616213-277c-4e70-9909-9883230a3394/scratchpad',
      hook_event_name: 'SessionStart',
      source: 'startup',
      model: 'claude-haiku-5-5',
    })).toEqual({
      type: 'session_started',
      source: 'startup',
      model: 'claude-haiku-5-5',
      sessionId: '19616213-277c-4e70-9909-9883230a3394',
      project: 'hookcap',
      cwd: base.cwd,
      transcriptPath: '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/19616213-277c-4e70-9909-9883230a3394.jsonl',
    })
  })

  it('SessionStart {source: resume} (claude -r) -> session_started with the same session id; token fields are dropped', () => {
    expect(runHook({
      ...base,
      hook_event_name: 'SessionStart',
      source: 'resume',
      seconds_since_last_response: 5,
      context_tokens: 44052,
      prompt_cache_likely_expired: false,
      estimated_cache_write_usd: 0.0088,
    })).toEqual({ type: 'session_started', source: 'resume', ...session })
  })

  it('SessionStart {source: compact, model} -> session_started with the model (the server treats it as an update)', () => {
    expect(runHook({
      ...base,
      prompt_id: 'e40b57ac-50aa-4bae-a043-8852cc9ba9c7',
      hook_event_name: 'SessionStart',
      source: 'compact',
      model: 'claude-haiku-5-5',
    })).toEqual({ type: 'session_started', source: 'compact', model: 'claude-haiku-5-5', ...session })
  })

  it('a named session (session_title) -> title; source defaults to startup', () => {
    // session_title only exists when the session was named (--name / /rename)
    expect(runHook({ ...base, hook_event_name: 'SessionStart', source: 'fork', session_title: 'office refactor' }))
      .toEqual({ type: 'session_started', source: 'fork', title: 'office refactor', ...session })
    expect(runHook({ ...base, hook_event_name: 'SessionStart' })?.source).toBe('startup')
  })

  it('SessionEnd {reason: other} (every -p exit) and {reason: prompt_input_exit} (/exit) -> session_ended', () => {
    expect(runHook({ ...base, prompt_id: '54f01295-3ff5-45ab-a738-b0598eae881d', hook_event_name: 'SessionEnd', reason: 'other' }))
      .toEqual({ type: 'session_ended', reason: 'other', ...session })
    expect(runHook({
      session_id: '19616213-277c-4e70-9909-9883230a3394',
      transcript_path: '/t/19616213.jsonl',
      cwd: base.cwd,
      prompt_id: 'f2fb3821-dd71-4d36-95ff-ae5cdedfaf8f',
      hook_event_name: 'SessionEnd',
      reason: 'prompt_input_exit',
    })).toEqual({
      type: 'session_ended', reason: 'prompt_input_exit',
      sessionId: '19616213-277c-4e70-9909-9883230a3394', project: 'hookcap', cwd: base.cwd, transcriptPath: '/t/19616213.jsonl',
    })
  })

  it('SessionStart/SessionEnd without a session_id emit nothing', () => {
    expect(runHook({ hook_event_name: 'SessionStart', source: 'startup' })).toBeNull()
    expect(runHook({ hook_event_name: 'SessionEnd', reason: 'other' })).toBeNull()
  })

  it('every emitted event carries sessionId, project, cwd and transcriptPath', () => {
    const payloads: Array<Record<string, unknown>> = [
      { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'toolu_1', tool_input: { description: 'Count etc', subagent_type: 'general-purpose', run_in_background: true } },
      { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_1', tool_input: { run_in_background: true }, tool_response: { status: 'async_launched', agentId: 'ac5ff55b850b4fecf' } },
      { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_2', tool_input: {}, tool_response: { status: 'completed', content: [{ type: 'text', text: 'ok' }] } },
      { hook_event_name: 'PostToolUseFailure', tool_name: 'Agent', tool_use_id: 'toolu_3', tool_input: {}, error: 'nope' },
      { hook_event_name: 'SubagentStop', agent_id: 'ac5ff55b850b4fecf', agent_type: 'general-purpose', last_assistant_message: 'done' },
      { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/y.js' } },
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', agent_id: 'ac5ff55b850b4fecf', agent_type: 'general-purpose', tool_input: { command: 'ls' } },
      { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'false' }, error: 'Exit code 1' },
      { hook_event_name: 'PreToolUse', tool_name: 'mcp__github__get_me', tool_input: {} },
      { hook_event_name: 'PostToolUse', tool_name: 'mcp__github__get_me', tool_input: {}, tool_response: {} },
      { hook_event_name: 'PostToolUse', tool_name: 'SubagentHandback', tool_input: { agent_id: 'ac5ff55b850b4fecf' }, tool_response: 'report' },
      { hook_event_name: 'SessionStart', source: 'startup' },
      { hook_event_name: 'SessionEnd', reason: 'other' },
    ]
    const types = payloads.map(p => {
      const ev = runHook({ ...base, ...p })
      expect(ev, JSON.stringify(p)).toMatchObject(session)
      return ev?.type
    })
    expect(types).toEqual([
      'agent_working', 'session_tool_done', 'session_tool_done', 'agent_working', 'agent_completed',
      'agent_working', 'agent_working', 'agent_working', 'mcp_call', 'mcp_done', 'agent_completed',
      'session_started', 'session_ended',
    ])
  })

  it('project is the last path segment of cwd (trailing slash tolerated; "/" stays "/")', () => {
    const read = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, session_id: 's', transcript_path: '/t.jsonl' }
    expect(runHook({ ...read, cwd: '/home/me/Claude-Office' })?.project).toBe('Claude-Office')
    expect(runHook({ ...read, cwd: '/home/me/Claude-Office/' })?.project).toBe('Claude-Office')
    expect(runHook({ ...read, cwd: '/' })?.project).toBe('/')
    // No cwd: no project/cwd keys, but the session id still travels
    expect(runHook({ ...read })).toEqual({ type: 'agent_working', status: 'reading x', tool: 'Read', sessionId: 's', transcriptPath: '/t.jsonl' })
  })

  it('payloads without session fields (older hooks, hand-made events) emit the old shapes unchanged', () => {
    expect(runHook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b.js' } }))
      .toEqual({ type: 'agent_working', status: 'reading b.js', tool: 'Read' })
  })
})

describe('agent-tracker.sh: MCP tools', () => {
  it('PreToolUse mcp__github__get_me -> mcp_call', () => {
    expect(runHook({ hook_event_name: 'PreToolUse', tool_name: 'mcp__github__get_me', tool_input: {} }))
      .toEqual({ type: 'mcp_call', server: 'github', tool: 'get_me' })
  })

  it('PostToolUse mcp__github__get_me -> mcp_done with the tool and the callKey (the server lowers the hand that call raised); inside a worker with its agentId', () => {
    expect(runHook({ hook_event_name: 'PostToolUse', tool_name: 'mcp__github__get_me', tool_input: {}, tool_response: { login: 'w17ant' } }))
      .toEqual({ type: 'mcp_done', server: 'github', tool: 'get_me', callKey: callKeyOf('mcp__github__get_me', {}) })
    const input = { owner: 'W17ant', repo: 'Claude-Office', title: 'x' }
    expect(runHook({ hook_event_name: 'PostToolUse', tool_name: 'mcp__github__create_issue', agent_id: 'a027f376ae8cdcbd0', agent_type: 'Explore', tool_input: input, tool_response: {} }))
      .toEqual({ type: 'mcp_done', server: 'github', tool: 'create_issue', callKey: callKeyOf('mcp__github__create_issue', input), agentId: 'a027f376ae8cdcbd0' })
  })

  it('splits server and tool on the first "__" only', () => {
    expect(runHook({ hook_event_name: 'PreToolUse', tool_name: 'mcp__claude-code-remote__list_sessions' }))
      .toEqual({ type: 'mcp_call', server: 'claude-code-remote', tool: 'list_sessions' })
  })
})

describe('agent-tracker.sh: every tool call is activity', () => {
  it('PreToolUse of a tool without a specific status line -> a generic "using <tool>" working status, main thread or worker', () => {
    expect(runHook({ hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }))
      .toEqual({ type: 'agent_working', status: 'using WebFetch', tool: 'WebFetch' })
    expect(runHook({ hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', agent_id: 'a1921bf97b0af9fd1', agent_type: 'Explore', tool_input: { todos: [] } }))
      .toEqual({ type: 'agent_working', status: 'using TodoWrite', tool: 'TodoWrite', agentId: 'a1921bf97b0af9fd1' })
    // The known tools keep their specific lines; a tool_input that is not an object does not crash the hook
    expect(runHook({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'needle' } })?.status).toBe("searching for 'needle'")
    expect(runHook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: null })).toEqual({ type: 'agent_working', status: 'reading ', tool: 'Read' })
  })

  it('PostToolUse of an ordinary tool -> session_tool_done {toolName, callKey} (lowers the permission hand that very call raised); inside a worker with its agentId; without a session, nothing', () => {
    const session = { session_id: 's1', cwd: '/x/proj', transcript_path: '/t.jsonl', prompt_id: 'p' }
    expect(runHook({ ...session, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: 'ok' }))
      .toEqual({ type: 'session_tool_done', toolName: 'Bash', callKey: callKeyOf('Bash', { command: 'ls' }), promptId: 'p', sessionId: 's1', project: 'proj', cwd: '/x/proj', transcriptPath: '/t.jsonl' })
    expect(runHook({ ...session, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/x/probe.txt', content: 'hello' }, tool_response: { filePath: '/x/probe.txt', success: true } }))
      .toMatchObject({ type: 'session_tool_done', toolName: 'Write' })
    // A worker's call: its dialog (agent_id on the PermissionRequest) is answered by its own finish
    expect(runHook({ ...session, hook_event_name: 'PostToolUse', tool_name: 'Bash', agent_id: 'a1921bf97b0af9fd1', agent_type: 'general-purpose', tool_input: { command: 'ls' }, tool_response: 'ok' }))
      .toEqual({ type: 'session_tool_done', toolName: 'Bash', callKey: callKeyOf('Bash', { command: 'ls' }), agentId: 'a1921bf97b0af9fd1', promptId: 'p', sessionId: 's1', project: 'proj', cwd: '/x/proj', transcriptPath: '/t.jsonl' })
    expect(runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: 'ok' })).toBeNull()
    expect(runHook({ hook_event_name: 'PostToolUse', tool_name: 'WebFetch', tool_input: {}, tool_response: 'page' })).toBeNull()
  })

  it('callKey: the PermissionRequest and the PostToolUse of one call carry the same key; another call of that tool (git status beside git push) another one', () => {
    const session = { session_id: 's1', cwd: '/x/proj', transcript_path: '/t.jsonl', prompt_id: 'p', permission_mode: 'default' }
    const push = { command: 'git push origin main', description: 'Push' }
    const asked = runHook({ ...session, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: push })
    const ran = runHook({ ...session, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { description: 'Push', command: 'git push origin main' }, tool_response: { stdout: '', stderr: '' } })
    const sibling = runHook({ ...session, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status', description: 'Status' }, tool_response: { stdout: '', stderr: '' } })
    expect(asked?.callKey).toMatch(/^[0-9a-f]{16}$/)
    expect(ran?.callKey).toBe(asked?.callKey)                     // key order in the input does not matter
    expect(sibling?.callKey).not.toBe(asked?.callKey)
    // The tool name is part of it: the same input to another tool is another call
    expect(runHook({ ...session, hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: push })?.callKey).not.toBe(asked?.callKey)
  })

})

describe('agent-tracker.sh: ignored payloads', () => {
  it('prints nothing for an empty payload or one with neither a tool_name nor a session', () => {
    expect(runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' })).toBeNull()
    expect(runHook({ hook_event_name: 'Stop', last_assistant_message: 'x' })).toBeNull()
    expect(runHook({})).toBeNull()
  })

  it('prints nothing (and exits 0) for a payload that is not JSON, or JSON that is not an object', () => {
    expect(runHook('not json at all')).toBeNull()
    expect(runHook('')).toBeNull()
    expect(runHook('[1, 2]')).toBeNull()
    expect(runHook('"a string"')).toBeNull()
  })
})

/**
 * The session's own Claude — the main-thread events. Payloads captured
 * verbatim from Claude Code 2.1.300 (scratchpad/hookcap/events.jsonl and the
 * session-a transcript, 2026-10-14) unless marked synthetic; only the
 * capture's own bookkeeping keys were dropped. None of these carries a
 * tool_name except PermissionRequest.
 */
describe('agent-tracker.sh: the main thread (session_* events)', () => {
  const HOOKCAP = '/tmp/claude-0/-home-user-Claude-Office/c25c5511-f321-521a-825b-f189ac4d57e8/scratchpad/hookcap'
  const PROJECTS = '/root/.claude/projects/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap'
  /** Common keys of a captured session: session_id, transcript_path, cwd, scratchpad_dir */
  const captured = (sid: string) => ({
    session_id: sid,
    transcript_path: `${PROJECTS}/${sid}.jsonl`,
    cwd: HOOKCAP,
    scratchpad_dir: `/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/${sid}/scratchpad`,
  })
  /** What every event made from that session carries */
  const forwarded = (sid: string) => ({ sessionId: sid, project: 'hookcap', cwd: HOOKCAP, transcriptPath: `${PROJECTS}/${sid}.jsonl` })
  const C = 'c25c5511-f321-521a-825b-f189ac4d57e8'   // the round-1 capture session (session a's twin)
  const A = '8cf68f64-5433-40f7-a130-557fc7f67e42'   // round-2 session a: background + foreground subagent

  it('UserPromptSubmit -> session_prompt with the prompt text and the prompt id', () => {
    const prompt = "Launch ONE background subagent with the Agent tool (run_in_background: true, subagent_type general-purpose, description 'Count etc') whose prompt is 'Run ls /etc | wc -l with Bash and report it.' Then launch ONE foreground subagent (subagent_type Explore, description 'Find hostname') with prompt 'Read /etc/hostname and report it.' Wait for the background result, then reply DONE."
    expect(runHook({
      ...captured(C),
      prompt_id: '60d87662-ef42-4452-a6bd-cd9718825c5b',
      permission_mode: 'bypassPermissions',
      hook_event_name: 'UserPromptSubmit',
      prompt,
    })).toEqual({ type: 'session_prompt', text: prompt, isWakeup: false, promptId: '60d87662-ef42-4452-a6bd-cd9718825c5b', ...forwarded(C) })
  })

  it('a <task-notification> prompt (a background worker reporting back) -> session_prompt {isWakeup, wakeupAgentId}; only the <summary> travels', () => {
    // The full prompt as written to session a's transcript (the hook capture clipped it at 400 chars)
    const prompt = '<task-notification>\n<task-id>ac5ff55b850b4fecf</task-id>\n<tool-use-id>toolu_01B8Zp1BDnyYNe7SEsseUD22</tool-use-id>\n<output-file>/tmp/claude-0/-tmp-claude-0--home-user-Claude-Office-c25c5511-f321-521a-825b-f189ac4d57e8-scratchpad-hookcap/8cf68f64-5433-40f7-a130-557fc7f67e42/tasks/ac5ff55b850b4fecf.output</output-file>\n<status>completed</status>\n<summary>Agent "Count etc" finished</summary>\n<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.</note>\n<result>`ls /etc | wc -l` returned **154**, so `/etc` has 154 entries.\n\nThe MCP connection failures in the system notice (design and sales plugin servers returning 403 from the proxy) are unrelated to this command and did not affect it.</result>\n<usage><subagent_tokens>29829</subagent_tokens><tool_uses>1</tool_uses><duration_ms>3973</duration_ms></usage>\n</task-notification>'
    const ev = runHook({
      ...captured(A),
      prompt_id: 'd0f0818e-428e-4732-b3f2-6830d470b485',
      permission_mode: 'bypassPermissions',
      hook_event_name: 'UserPromptSubmit',
      prompt,
    })
    expect(ev).toEqual({
      type: 'session_prompt',
      text: 'Agent "Count etc" finished',
      isWakeup: true,
      wakeupAgentId: 'ac5ff55b850b4fecf',   // the subagent id the server already resolves to its office agent
      wakeupStatus: 'completed',
      promptId: 'd0f0818e-428e-4732-b3f2-6830d470b485',
      ...forwarded(A),
    })
    // Neither the XML nor the worker's result leaks
    expect(JSON.stringify(ev)).not.toMatch(/<task-notification>|returned \*\*154\*\*|output-file/)
  })

  it('clamps a long prompt to 2000 characters hook-side (the server would refuse an oversize body whole)', () => {
    const ev = runHook({ ...captured(C), prompt_id: 'p', hook_event_name: 'UserPromptSubmit', prompt: 'z'.repeat(10_000) })
    expect(ev?.text).toHaveLength(2000)
    // A prompt that is not a string (never seen; schema says string) is forwarded as empty text, not a crash
    expect(runHook({ ...captured(C), hook_event_name: 'UserPromptSubmit', prompt: 42 })).toMatchObject({ type: 'session_prompt', text: '', isWakeup: false })
  })

  it('Stop -> session_turn_end with the reply, the (empty) task list and the cron count', () => {
    // Captured while the background agent was still running: background_tasks was [] all the same (see the synthetic case below)
    const last = "The foreground Explore agent reports that `/etc/hostname` contains `vm`.\n\nThe background agent that runs `ls /etc | wc -l` is still running. I'll reply DONE when its completion notification arrives."
    expect(runHook({
      ...captured(C),
      prompt_id: '60d87662-ef42-4452-a6bd-cd9718825c5b',
      permission_mode: 'bypassPermissions',
      effort: { level: 'medium' },
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: last,
      background_tasks: [],
      session_crons: [],
    })).toEqual({
      type: 'session_turn_end', text: last, backgroundTasks: [], crons: 0, stopHookActive: false,
      promptId: '60d87662-ef42-4452-a6bd-cd9718825c5b', ...forwarded(C),
    })

    // The auto-continuation turn after the wake-up
    expect(runHook({
      ...captured(C), prompt_id: '54f01295-3ff5-45ab-a738-b0598eae881d', permission_mode: 'bypassPermissions', effort: { level: 'medium' },
      hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'DONE', background_tasks: [], session_crons: [],
    })).toMatchObject({ type: 'session_turn_end', text: 'DONE', promptId: '54f01295-3ff5-45ab-a738-b0598eae881d' })
  })

  it('Stop with a running background task (synthetic: the entry shape is the one SubagentStop carried) -> backgroundTasks, max 10, descriptions at 120', () => {
    const running = { id: 'a29964dc791f62039', type: 'subagent', status: 'running', description: 'Count etc', agent_type: 'general-purpose' }
    const ev = runHook({
      ...captured(C), prompt_id: 'p', permission_mode: 'bypassPermissions', effort: { level: 'medium' },
      hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: 'Waiting for the count.',
      background_tasks: [
        running,
        { id: 'sh1', type: 'shell', status: 'running', description: 'x'.repeat(500), command: 'sleep 1000' },
        'junk',
        ...Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, type: 'monitor', status: 'pending', description: `m${i}` })),
      ],
      session_crons: [{ id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'check CI' }],
    })
    expect(ev).toMatchObject({ type: 'session_turn_end', text: 'Waiting for the count.', crons: 1, stopHookActive: true })
    expect(ev?.backgroundTasks[0]).toEqual({ id: 'a29964dc791f62039', type: 'subagent', status: 'running', description: 'Count etc' })
    expect(ev?.backgroundTasks[1].description).toHaveLength(120)
    expect(ev?.backgroundTasks).toHaveLength(9)  // the first ten raw entries, minus the junk one
    expect(ev?.backgroundTasks.every((t: any) => Object.keys(t).sort().join() === 'description,id,status,type')).toBe(true)
    // A reply over 2000 characters is clamped here too
    expect(runHook({ ...captured(C), hook_event_name: 'Stop', last_assistant_message: 'r'.repeat(5000) })?.text).toHaveLength(2000)
  })

  it('PermissionRequest Write -> session_needs_you {kind: permission, toolName, summary: the file name, callKey}', () => {
    expect(runHook({
      ...captured('4a9dd43b-f941-406a-809a-01149a62b597'),
      prompt_id: '273fe3a9-5b8d-4724-bb83-0c5e06bca880',
      permission_mode: 'default',
      effort: { level: 'medium' },
      hook_event_name: 'PermissionRequest',
      tool_name: 'Write',
      tool_input: { file_path: `${HOOKCAP}/probe.txt`, content: 'hello' },
      permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    })).toEqual({
      type: 'session_needs_you', kind: 'permission', toolName: 'Write', summary: 'probe.txt',
      callKey: callKeyOf('Write', { file_path: `${HOOKCAP}/probe.txt`, content: 'hello' }),
      promptId: '273fe3a9-5b8d-4724-bb83-0c5e06bca880', ...forwarded('4a9dd43b-f941-406a-809a-01149a62b597'),
    })
  })

  it('PermissionRequest Bash -> the first 80 characters of the command; other tools -> the tool name; inside a subagent -> agentId', () => {
    // Shapes from the hooks reference (only Write was captured)
    const base = { ...captured(C), prompt_id: 'p', permission_mode: 'default', hook_event_name: 'PermissionRequest' }
    const long = 'rm -rf node_modules && ' + 'echo again && '.repeat(20)
    expect(runHook({ ...base, tool_name: 'Bash', tool_input: { command: long, description: 'Remove node_modules directory' } }))
      .toMatchObject({ kind: 'permission', toolName: 'Bash', summary: long.slice(0, 80) })
    expect(runHook({ ...base, tool_name: 'Bash', tool_input: { command: 'rm -rf\n  node_modules' } })?.summary).toBe('rm -rf node_modules')
    expect(runHook({ ...base, tool_name: 'Edit', tool_input: { file_path: '/repo/src/App.tsx', old_string: 'a', new_string: 'b' } })?.summary).toBe('App.tsx')
    expect(runHook({ ...base, tool_name: 'mcp__github__create_pull_request', tool_input: { title: 'x' } }))
      .toMatchObject({ toolName: 'mcp__github__create_pull_request', summary: 'mcp__github__create_pull_request' })
    expect(runHook({ ...base, tool_name: 'WebFetch', tool_input: null })?.summary).toBe('WebFetch')
    // Raised inside a subagent (schema-only, not captured): the worker is named as well
    expect(runHook({ ...base, agent_id: 'ac5ff55b850b4fecf', agent_type: 'general-purpose', tool_name: 'Write', tool_input: { file_path: '/x/y.txt', content: '' } }))
      .toMatchObject({ kind: 'permission', toolName: 'Write', summary: 'y.txt', agentId: 'ac5ff55b850b4fecf' })
  })

  it('Notification permission_prompt (interactive, ~6 s after PermissionRequest) -> session_needs_you {kind: permission, notificationType, message}', () => {
    expect(runHook({
      ...captured('19616213-277c-4e70-9909-9883230a3394'),
      prompt_id: 'a7c849b6-361e-4cf8-84c8-7f387f16fafc',
      hook_event_name: 'Notification',
      message: 'Claude needs your permission',
      notification_type: 'permission_prompt',
    })).toEqual({
      type: 'session_needs_you', kind: 'permission', notificationType: 'permission_prompt', message: 'Claude needs your permission',
      promptId: 'a7c849b6-361e-4cf8-84c8-7f387f16fafc', ...forwarded('19616213-277c-4e70-9909-9883230a3394'),
    })
  })

  it('Notification idle_prompt / quota_auto_resume_* / agent_needs_input -> idle / quota / agent-input; every other type -> nothing', () => {
    // Types from the binary's string table and the hooks reference (only permission_prompt was captured)
    const base = { ...captured(C), prompt_id: 'p', hook_event_name: 'Notification' }
    const kindOf = (notification_type: string, message = 'msg') => runHook({ ...base, notification_type, message })?.kind ?? null
    expect(kindOf('idle_prompt', 'Claude is waiting for your input')).toBe('idle')
    expect(kindOf('quota_auto_resume_fired')).toBe('quota')
    expect(kindOf('quota_auto_resume_stale')).toBe('quota')
    expect(kindOf('quota_auto_resume_disabled')).toBe('quota')
    expect(kindOf('agent_needs_input')).toBe('agent-input')
    for (const ignored of ['auth_success', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_completed', 'worker_permission_prompt', 'push_notification', 'model_refusal_fallback', 'plugin_notification', '']) {
      expect(kindOf(ignored), ignored).toBeNull()
    }
    expect(runHook({ ...base, notification_type: 'idle_prompt', message: 'm'.repeat(500) })?.message).toHaveLength(200)
  })

  it('StopFailure -> session_error {error, detail} (shape from the hooks reference; never fired locally)', () => {
    expect(runHook({
      ...captured(C), prompt_id: 'p', hook_event_name: 'StopFailure',
      error: 'rate_limit', error_details: '429 Too Many Requests', last_assistant_message: 'API Error: Rate limit reached',
    })).toEqual({ type: 'session_error', error: 'rate_limit', detail: '429 Too Many Requests', promptId: 'p', ...forwarded(C) })
    // Without details the rendered error text is the detail; without either, an empty one
    expect(runHook({ ...captured(C), hook_event_name: 'StopFailure', error: 'overloaded', last_assistant_message: 'API Error: Overloaded' }))
      .toMatchObject({ error: 'overloaded', detail: 'API Error: Overloaded' })
    expect(runHook({ ...captured(C), hook_event_name: 'StopFailure' })).toMatchObject({ error: 'unknown', detail: '' })
    expect(runHook({ ...captured(C), hook_event_name: 'StopFailure', error: 'server_error', error_details: 'd'.repeat(500) })?.detail).toHaveLength(200)
  })

  it('PreCompact -> session_compact pre; PostCompact -> post, and the summary text stays behind', () => {
    expect(runHook({
      ...captured(C), prompt_id: 'e40b57ac-50aa-4bae-a043-8852cc9ba9c7', hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: null,
    })).toEqual({ type: 'session_compact', phase: 'pre', trigger: 'manual', promptId: 'e40b57ac-50aa-4bae-a043-8852cc9ba9c7', ...forwarded(C) })

    const ev = runHook({
      ...captured(C), prompt_id: 'e40b57ac-50aa-4bae-a043-8852cc9ba9c7', hook_event_name: 'PostCompact', trigger: 'manual',
      compact_summary: '<analysis>\nThe conversation has three parts. The user first asked for two subagents: a background general-purpose agent described as "Count etc" to run `ls /etc | wc -l`, and a foreground Explore agent described as "Find hostname" to read `/etc/hostname`. ...',
    })
    expect(ev).toEqual({ type: 'session_compact', phase: 'post', trigger: 'manual', promptId: 'e40b57ac-50aa-4bae-a043-8852cc9ba9c7', ...forwarded(C) })
    expect(JSON.stringify(ev)).not.toContain('Count etc')
    expect(runHook({ ...captured(C), hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null })).toMatchObject({ phase: 'pre', trigger: 'auto' })
  })

  it('PostToolBatch on the main thread -> session_tool_done {batch, count}; inside a worker -> the same with its agentId (it answers only that worker\'s dialog)', () => {
    // Captured: the batch that launched the background and the foreground agent (session c25c5511)
    expect(runHook({
      ...captured(C), prompt_id: '60d87662-ef42-4452-a6bd-cd9718825c5b', permission_mode: 'bypassPermissions', effort: { level: 'medium' },
      hook_event_name: 'PostToolBatch',
      tool_calls: [
        { tool_name: 'Agent', tool_input: { description: 'Count etc', prompt: 'Run ls /etc | wc -l with Bash and report it.', subagent_type: 'general-purpose', run_in_background: true }, tool_use_id: 'toolu_01BqtWPXox4wWP2tR2CS8jVE', tool_response: [{ type: 'text', text: 'Async agent launched successfully. ...' }] },
        { tool_name: 'Agent', tool_input: { description: 'Find hostname', prompt: 'Read /etc/hostname and report it.', subagent_type: 'Explore', run_in_background: false }, tool_use_id: 'toolu_01GxFiqPkJRKxd5Qkyus2tLN', tool_response: [{ type: 'text', text: '[Subagent hand-back] ...' }] },
      ],
    })).toEqual({ type: 'session_tool_done', batch: true, count: 2, promptId: '60d87662-ef42-4452-a6bd-cd9718825c5b', ...forwarded(C) })
    // The denied Write's batch in a headless session (captured, session 4a9dd43b): one call, answered "you haven't granted it yet"
    expect(runHook({
      ...captured('4a9dd43b-f941-406a-809a-01149a62b597'), prompt_id: '273fe3a9-5b8d-4724-bb83-0c5e06bca880', permission_mode: 'default', effort: { level: 'medium' },
      hook_event_name: 'PostToolBatch',
      tool_calls: [{ tool_name: 'Write', tool_input: { file_path: `${HOOKCAP}/probe.txt`, content: 'hello' }, tool_use_id: 'toolu_01W', tool_response: `Claude requested permissions to write to ${HOOKCAP}/probe.txt, but you haven't granted it yet.` }],
    })).toMatchObject({ type: 'session_tool_done', batch: true, count: 1 })
    // Inside a subagent (captured shape: agent_id + agent_type on the batch)
    expect(runHook({
      ...captured(C), prompt_id: 'p', permission_mode: 'bypassPermissions', agent_id: 'a027f376ae8cdcbd0', agent_type: 'Explore', effort: { level: 'medium' },
      hook_event_name: 'PostToolBatch',
      tool_calls: [{ tool_name: 'Read', tool_input: { file_path: '/etc/hostname' }, tool_use_id: 'toolu_01XaBQyUGgXLSCM8GdEpBHFk', tool_response: '1\tvm\n2\t' }],
    })).toEqual({ type: 'session_tool_done', batch: true, count: 1, agentId: 'a027f376ae8cdcbd0', promptId: 'p', ...forwarded(C) })
    expect(runHook({ ...captured(C), hook_event_name: 'PostToolBatch' })).toMatchObject({ type: 'session_tool_done', batch: true, count: 0 })
  })

  it('CwdChanged -> session_cwd with the new cwd and project (the payload\'s own cwd is still the old one)', () => {
    expect(runHook({
      ...captured('7d77f597-b547-42f9-823a-50fc2ecdbf3b'), prompt_id: 'd66959d4-65e0-4b8b-8b59-3e2796c5fb1a', hook_event_name: 'CwdChanged',
      old_cwd: HOOKCAP, new_cwd: '/tmp',
    })).toEqual({
      type: 'session_cwd', cwd: '/tmp', project: 'tmp', oldCwd: HOOKCAP, promptId: 'd66959d4-65e0-4b8b-8b59-3e2796c5fb1a',
      sessionId: '7d77f597-b547-42f9-823a-50fc2ecdbf3b', transcriptPath: `${PROJECTS}/7d77f597-b547-42f9-823a-50fc2ecdbf3b.jsonl`,
    })
    expect(runHook({ ...captured(C), hook_event_name: 'CwdChanged', old_cwd: HOOKCAP, new_cwd: '/' })).toMatchObject({ cwd: '/', project: '/' })
    expect(runHook({ ...captured(C), hook_event_name: 'CwdChanged', old_cwd: HOOKCAP })).toBeNull()
  })

  it('PostModelSwitch -> session_model {model, fromModel, switchSource} (shape from the schema; never fired locally)', () => {
    expect(runHook({
      ...captured(C), prompt_id: 'p', hook_event_name: 'PostModelSwitch',
      from_model: 'claude-haiku-5-5', to_model: 'claude-opus-4-1', requested_model: 'opus', source: 'command', context_tokens: 44052, prompt_cache_warm: true, cache_ttl: '5m',
    })).toEqual({ type: 'session_model', model: 'claude-opus-4-1', fromModel: 'claude-haiku-5-5', switchSource: 'command', promptId: 'p', ...forwarded(C) })
    expect(runHook({ ...captured(C), hook_event_name: 'PostModelSwitch', to_model: 'claude-sonnet-4-5', source: 'auto' })).toMatchObject({ model: 'claude-sonnet-4-5', switchSource: 'auto' })
    expect(runHook({ ...captured(C), hook_event_name: 'PostModelSwitch', from_model: 'x' })).toBeNull()
  })

  it('Setup and InstructionsLoaded -> nothing, like every other event the office does not listen to', () => {
    expect(runHook({ ...captured('149f6824-9a0a-4031-beff-0864614b9005'), hook_event_name: 'Setup', trigger: 'init' })).toBeNull()
    expect(runHook({ ...captured('10690f0a-fe94-4e15-9a2d-b59573025579'), hook_event_name: 'Setup', trigger: 'maintenance' })).toBeNull()
    expect(runHook({
      ...captured('7d77f597-b547-42f9-823a-50fc2ecdbf3b'), hook_event_name: 'InstructionsLoaded',
      file_path: `${HOOKCAP}/CLAUDE.md`, memory_type: 'Project', load_reason: 'session_start',
    })).toBeNull()
    for (const hook_event_name of ['MessageDisplay', 'ConfigChange', 'UserPromptExpansion', 'PreModelSwitch', 'PermissionDenied', 'TeammateIdle', 'Elicitation', 'ElicitationResult', 'WorktreeCreate', 'WorktreeRemove', 'FileChanged', 'DirectoryAdded']) {
      expect(runHook({ ...captured(C), prompt_id: 'p', hook_event_name }), hook_event_name).toBeNull()
    }
  })

  it('TaskCreated / TaskCompleted -> nothing (the hooks are not registered for them any more; an older settings file may still fire them)', () => {
    const example = { task_id: 'task-001', task_subject: 'Implement user authentication', task_description: 'Add login and signup endpoints' }
    expect(runHook({ ...captured(C), hook_event_name: 'TaskCreated', ...example })).toBeNull()
    expect(runHook({ ...captured(C), hook_event_name: 'TaskCompleted', ...example })).toBeNull()
  })

  it('every main-thread event without a session id prints nothing', () => {
    for (const payload of [
      { hook_event_name: 'UserPromptSubmit', prompt: 'hello', prompt_id: 'p' },
      { hook_event_name: 'Stop', last_assistant_message: 'x', background_tasks: [], session_crons: [] },
      { hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: '/x' } },
      { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'm' },
      { hook_event_name: 'StopFailure', error: 'rate_limit' },
      { hook_event_name: 'PreCompact', trigger: 'manual' },
      { hook_event_name: 'PostCompact', trigger: 'manual', compact_summary: 's' },
      { hook_event_name: 'PostToolBatch', tool_calls: [] },
      { hook_event_name: 'CwdChanged', old_cwd: '/a', new_cwd: '/b' },
      { hook_event_name: 'PostModelSwitch', from_model: 'a', to_model: 'b', source: 'command' },
      { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {}, tool_response: 'ok' },
    ]) {
      expect(runHook(payload), payload.hook_event_name).toBeNull()
    }
  })
})

/**
 * The whole script, with a fake `curl` on PATH that records its argv AND the
 * body it was handed on stdin (the hook sends the body with --data-binary @-,
 * so neither the token nor the event text is ever on argv). The payload
 * reaches the Python on stdin, stdout stays empty (on UserPromptSubmit it
 * would be injected into Claude's context) and the exit code is 0.
 */
describe('agent-tracker.sh: the bash wrapper', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-tracker-'))
  const bin = join(dir, 'bin')
  const officeHome = join(dir, 'office')
  const log = join(dir, 'curl.jsonl')
  mkdirSync(bin)
  mkdirSync(officeHome)
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\npython3 -c 'import json,sys; print(json.dumps({"argv": sys.argv[1:], "stdin": sys.stdin.read()}))' "$@" >> "$FAKE_CURL_LOG"\n`)
  chmodSync(join(bin, 'curl'), 0o755)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  /** Run the script on a payload; resolve with its stdout/status and what curl was given (the POST is backgrounded). */
  async function runScript(payload: unknown, extraEnv: Record<string, string> = {}) {
    rmSync(log, { force: true })
    const env: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AGENT_OFFICE_HOME: officeHome, FAKE_CURL_LOG: log }
    // The caller's own office settings must not leak into the script under test
    delete env.AGENT_OFFICE_EVENT_URL
    delete env.AGENT_OFFICE_PORT
    Object.assign(env, extraEnv)
    const res = spawnSync('bash', [TRACKER], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env,
    })
    // The fake curl's `>>` creates the log before its python has written the
    // line, so wait for a complete line, not just for the file (a read in that
    // window parsed '' and failed under full-suite load)
    const complete = () => existsSync(log) && readFileSync(log, 'utf8').endsWith('\n')
    for (let i = 0; i < 60 && !complete(); i++) await sleep(50)
    const calls = complete() ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { argv: string[]; stdin: string }) : []
    const args = calls[0]?.argv ?? null
    const body = calls[0]?.stdin ? JSON.parse(calls[0].stdin) : null
    return { stdout: res.stdout, stderr: res.stderr, status: res.status, calls, args, body }
  }

  const session = { session_id: 's-wrap', cwd: '/home/me/proj', transcript_path: '/t/s-wrap.jsonl' }

  it('UserPromptSubmit: nothing on stdout, exit 0, the session_prompt goes to curl as one JSON body on stdin, never argv', async () => {
    const run = await runScript({ ...session, prompt_id: 'p1', hook_event_name: 'UserPromptSubmit', prompt: 'fix the bug' })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe('')
    expect(run.calls).toHaveLength(1)
    expect(run.args?.slice(0, 4)).toEqual(['-sf', '-X', 'POST', 'http://127.0.0.1:3334/event'])
    expect(run.args).toContain('--data-binary')
    expect(run.body).toEqual({ type: 'session_prompt', text: 'fix the bug', isWakeup: false, promptId: 'p1', sessionId: 's-wrap', project: 'proj', cwd: '/home/me/proj', transcriptPath: '/t/s-wrap.jsonl' })
    // No token file: nothing to sign with, and never an Authorization header
    expect(run.args?.some(a => /Authorization/i.test(a))).toBe(false)
    expect(run.args?.some(a => /X-Office-Signature/i.test(a))).toBe(false)
    // The prompt text travels on stdin, not on the command line
    expect(run.args?.some(a => a.includes('fix the bug'))).toBe(false)
  })

  it('a 300 KB tool_response reaches the Python (stdin, not an argument that would fail with E2BIG); the event carries none of it', async () => {
    const run = await runScript({
      ...session, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x/big.txt' },
      tool_response: { file: { content: 'x'.repeat(300_000) } },
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe('')
    expect(run.body).toMatchObject({ type: 'session_tool_done', toolName: 'Read', sessionId: 's-wrap' })
    expect(JSON.stringify(run.body)).not.toContain('xxxx')
  })

  it('with a token file it SIGNS the request (X-Office-Timestamp/Signature headers) and never puts the token on argv; an ignored event never calls curl', async () => {
    const token = 'a'.repeat(64)
    writeFileSync(join(officeHome, 'auth-token'), token + '\n')
    try {
      const run = await runScript({ ...session, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/y.js' } })
      expect(run.status).toBe(0)
      // The token is nowhere on the command line, and no Authorization header
      expect(run.args?.some(a => a.includes(token))).toBe(false)
      expect(run.args?.some(a => /Authorization/i.test(a))).toBe(false)
      // It is signed instead: a timestamp and a 64-hex signature ride as headers
      const headers = (run.args ?? []).filter((_, i) => run.args?.[i - 1] === '-H')
      expect(headers.some(h => /^X-Office-Timestamp: \d+$/.test(h))).toBe(true)
      expect(headers.some(h => /^X-Office-Signature: [0-9a-f]{64}$/.test(h))).toBe(true)
      expect(run.body).toMatchObject({ type: 'agent_working', status: 'reading y.js' })

      const quiet = await runScript({ ...session, hook_event_name: 'Setup', trigger: 'init' })
      expect(quiet.status).toBe(0)
      expect(quiet.stdout).toBe('')
      expect(quiet.calls).toEqual([])
    } finally {
      rmSync(join(officeHome, 'auth-token'), { force: true })
    }
  })

  it('posts to AGENT_OFFICE_EVENT_URL when set, else to 127.0.0.1:$AGENT_OFFICE_PORT/event, else to port 3334', async () => {
    const read = { ...session, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/y.js' } }
    // The default host is pinned to 127.0.0.1, not 'localhost' (no IPv6 ::1 squatter)
    expect((await runScript(read)).args?.[3]).toBe('http://127.0.0.1:3334/event')
    expect((await runScript(read, { AGENT_OFFICE_PORT: '3998' })).args?.[3]).toBe('http://127.0.0.1:3998/event')
    expect((await runScript(read, { AGENT_OFFICE_PORT: '3998', AGENT_OFFICE_EVENT_URL: 'http://127.0.0.1:4100/event' })).args?.[3]).toBe('http://127.0.0.1:4100/event')
  })
})
