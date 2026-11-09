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
import { afterAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { writeSessionSettings, cleanEnv, readOpenSessions, hasTranscript } = require('../electron/terminals.cjs')

const REPO = fileURLToPath(new URL('..', import.meta.url))

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'poke-settings-')); dirs.push(d); return d }

describe('terminals.cjs', () => {
  it('writes session settings whose hooks and status line run this checkout\'s scripts with the app in Node mode', () => {
    const file = writeSessionSettings(REPO, tempDir(), 'C:\\Program Files\\Claudex\\Claudex.exe')
    const settings = JSON.parse(readFileSync(file, 'utf8'))
    const command: string = settings.hooks.SessionStart[0].hooks[0].command
    expect(command).toMatch(/^ELECTRON_RUN_AS_NODE=1 ".+Claudex\.exe" "[^"\\]+\/hooks\/claudex-hook\.cjs"$/)
    expect(command).not.toMatch(/python|bash|curl/)
    expect(Object.keys(settings.hooks)).toEqual(expect.arrayContaining(['PreToolUse', 'Stop', 'SessionEnd', 'UserPromptSubmit', 'PermissionRequest']))
    expect(settings.statusLine.command).toMatch(/^ELECTRON_RUN_AS_NODE=1 ".+" ".+\/hooks\/status-line\.cjs"$/)
  })

  it('the hook command really runs in a shell: reads the payload, prints nothing, exits 0 (server down)', () => {
    // Here the "app" is the Node running the tests, which ignores ELECTRON_RUN_AS_NODE
    const settings = JSON.parse(readFileSync(writeSessionSettings(REPO, tempDir(), process.execPath), 'utf8'))
    const command: string = settings.hooks.PreToolUse[0].hooks[0].command
    const res = spawnSync('bash', ['-c', command], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, session_id: 's' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDEX_PORT: '9', CLAUDEX_HOME: tempDir() },
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudex-open-'))
    const file = path.join(dir, 'open-sessions.json')
    const a = '11111111-1111-4111-8111-111111111111'
    fs.writeFileSync(file, JSON.stringify([
      { sessionId: a, cwd: dir }, { sessionId: a, cwd: dir },
      { sessionId: 'not-an-id', cwd: dir },
      { sessionId: '22222222-2222-4222-8222-222222222222', cwd: path.join(dir, 'gone') },
    ]))
    expect(readOpenSessions(file)).toEqual([{ sessionId: a, cwd: dir }])
    fs.writeFileSync(file, '{broken')
    expect(readOpenSessions(file)).toEqual([])
    expect(readOpenSessions(path.join(dir, 'missing.json'))).toEqual([])
  })

  it('reopens only sessions that have a transcript', () => {
    const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claudex-claude-'))
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
