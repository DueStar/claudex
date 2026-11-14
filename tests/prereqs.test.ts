import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { checkPrereqs } = require('../electron/prereqs.cjs')

describe('prereqs.cjs on the Mac', () => {
  it('does not run git when the Xcode tools are missing, and reports git as ok', async () => {
    const calls: string[] = []
    const run = async (cmd: string) => { calls.push(cmd); return cmd === 'xcode-select' ? null : (cmd === 'git' ? 'git version 2' : 'claude 1.0') }
    const out = await checkPrereqs({ platform: 'darwin', run, home: '/Users/me', exists: () => false })
    expect(calls).not.toContain('git')
    expect(out.git.ok).toBe(true)
    expect(out.claude.ok).toBe(true)
  })

  it('reports the git version once the Xcode tools exist', async () => {
    const run = async (cmd: string) => (cmd === 'xcode-select' ? '/Library/Developer/CommandLineTools' : cmd === 'git' ? 'git version 2.39' : 'claude 1.0')
    const out = await checkPrereqs({ platform: 'darwin', run, home: '/Users/me', exists: () => false })
    expect(out.git).toMatchObject({ ok: true, version: 'git version 2.39' })
  })
})
