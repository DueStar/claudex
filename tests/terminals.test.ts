/**
 * electron/terminals.cjs — the app's Claude Code terminals: the session
 * settings it hands every session, and the environment it starts them in.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { writeSessionSettings, cleanEnv } = require('../electron/terminals.cjs')

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
})
