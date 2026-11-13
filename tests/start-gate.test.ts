/**
 * electron/startGate.cjs: on a Mac the app opens nothing before the login
 * shell's PATH and LANG are read (a Dock click or a second launch during the
 * read waits too); on Windows the start runs at once, in the same tick, as before.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createStartGate } = require('../electron/startGate.cjs')
const { singleFlight } = require('../electron/helpers.cjs')

describe('createStartGate', () => {
  it('Windows: run calls the start at once, synchronously, and returns what it returns', () => {
    const gate = createStartGate('win32')
    const start = vi.fn(() => 'started')
    expect(gate.run(start)).toBe('started')
    expect(start).toHaveBeenCalledTimes(1)
    expect(gate.waits).toBe(false)
  })

  it('a Mac: a Dock click and a second launch during the read wait; they start once, after the read', async () => {
    const gate = createStartGate('darwin')
    const order: string[] = []
    let finish: () => void = () => {}
    const startApp = vi.fn(() => { order.push('start'); return new Promise<void>((r) => { finish = r }) })
    const startOnce = singleFlight(startApp)
    const open = () => gate.run(() => startOnce())
    const activate = open()        // Dock click during the read
    const second = open()          // second-instance during the read
    await Promise.resolve()
    expect(startApp).not.toHaveBeenCalled()
    order.push('env merged')
    gate.open()
    const first = open()           // the start itself, after the merge
    await new Promise((r) => setTimeout(r, 0))
    expect(order).toEqual(['env merged', 'start'])
    expect(startApp).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([activate, second, first])
    expect(startApp).toHaveBeenCalledTimes(1)
  })

  it('main.cjs: open() goes through the gate, and the gate opens after the merge even when it throws', () => {
    const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
    expect(main).toContain('const open = () => envGate.run(() => startOnce()).catch(')
    const darwin = main.slice(main.indexOf("if (process.platform === 'darwin') {\n      // A shutdown"), main.indexOf('registerTerminalIpc()\n'))
    expect(darwin).toMatch(/try \{\n\s+const merged = await mergeLoginEnv\(\{ env: process\.env \}\)[\s\S]*\} finally \{\n\s+envGate\.open\(\)\n\s+\}/)
    expect(main.split('envGate.open()').length - 1).toBe(1)
  })
})
