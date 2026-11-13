// The other-AI-tools switch (Codex CLI and friends, hidden 2026-11-13): one value in
// electron/features.json, read by the main process and the page alike.

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { OTHER_TOOLS, settingsSections, sessionTools, shownCodexLimits } from '../src/features'

const require = createRequire(import.meta.url)

const SECTIONS: ['notify' | 'session' | 'tools' | 'app', string][] = [['notify', '알림'], ['session', '세션'], ['tools', 'AI 도구'], ['app', '앱']]
const STORED = { tools: [{ id: 'codex', name: 'Codex CLI', command: 'codex' }], defaultTool: 'codex' }
const CODEX = { primary: { usedPercent: 40, windowMinutes: 300, resetsAt: 1 }, secondary: null }

describe('the switch', () => {
  it('the page and the main process read the same value', () => {
    expect(OTHER_TOOLS).toBe(require('../electron/features.cjs').OTHER_TOOLS)
    expect(typeof OTHER_TOOLS).toBe('boolean')
  })
})

describe('other AI tools switched off', () => {
  it('설정 has no AI 도구 section', () => {
    expect(settingsSections(SECTIONS, false).map(([k]) => k)).toEqual(['notify', 'session', 'app'])
  })

  it('a new session can only be Claude Code, even with Codex stored as the default', () => {
    expect(sessionTools(STORED, false)).toEqual({ tools: [], defaultTool: 'claude' })
  })

  it('the stored settings are not changed, only not used', () => {
    sessionTools(STORED, false)
    expect(STORED).toEqual({ tools: [{ id: 'codex', name: 'Codex CLI', command: 'codex' }], defaultTool: 'codex' })
  })

  it("the usage card gets no Codex limits (Claude's rows only)", () => {
    expect(shownCodexLimits(CODEX, false)).toBeUndefined()
  })
})

describe('other AI tools switched on (as before)', () => {
  it('설정 shows every section', () => {
    expect(settingsSections(SECTIONS, true)).toEqual(SECTIONS)
  })

  it('the stored tools and default reach the picker', () => {
    expect(sessionTools(STORED, true)).toEqual(STORED)
  })

  it('Codex limits reach the usage card', () => {
    expect(shownCodexLimits(CODEX, true)).toBe(CODEX)
  })
})

describe('the default follows the switch', () => {
  it('each decision uses OTHER_TOOLS when not told otherwise', () => {
    expect(settingsSections(SECTIONS).some(([k]) => k === 'tools')).toBe(OTHER_TOOLS)
    expect(sessionTools(STORED).defaultTool).toBe(OTHER_TOOLS ? 'codex' : 'claude')
    expect(shownCodexLimits(CODEX)).toBe(OTHER_TOOLS ? CODEX : undefined)
  })
})
