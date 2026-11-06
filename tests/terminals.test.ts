/**
 * electron/terminals.cjs — the app's Claude Code terminals: the session
 * settings it hands every session, and the environment it starts them in.
 */

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

describe('terminals.cjs', () => {
  it('writes session settings with the office hooks pointed at this checkout, and the status line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poke-settings-'))
    dirs.push(dir)
    const file = writeSessionSettings(REPO, dir)
    const settings = JSON.parse(readFileSync(file, 'utf8'))
    const command: string = settings.hooks.SessionStart[0].hooks[0].command
    expect(command).toContain('/hooks/agent-tracker.sh')
    expect(command).not.toContain('${CLAUDE_PLUGIN_ROOT}')
    expect(command).not.toContain('\\')
    expect(Object.keys(settings.hooks)).toEqual(expect.arrayContaining(['PreToolUse', 'Stop', 'SessionEnd', 'UserPromptSubmit']))
    expect(settings.statusLine.command).toContain('/hooks/status-line.sh')
  })

  it('starts sessions without another Claude Code session\'s markers', () => {
    const env = cleanEnv({
      PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_PID: '9',
      CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CONFIG_DIR: '/c',
    })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', CLAUDE_CONFIG_DIR: '/c' })
  })
})
