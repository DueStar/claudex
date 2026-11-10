/**
 * electron/quitWatchdog.cjs — a separate process that ends the app's main
 * process when a quit hangs (a main stuck in native teardown kept running
 * for a day after an update restart).
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { startQuitWatchdog } = require('../electron/quitWatchdog.cjs')

// Whatever a failed assertion left running is ended
const spawned: number[] = []
afterEach(() => { for (const pid of spawned.splice(0)) { try { process.kill(pid) } catch {} } })

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const until = async (ok: () => boolean, ms: number) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (ok()) return true; await new Promise(r => setTimeout(r, 50)) }
  return ok()
}

describe('quit watchdog', () => {
  it('ends a process that outlives its deadline', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const watchdog = startQuitWatchdog(child.pid!, 300, process.execPath)
    spawned.push(child.pid!, watchdog.pid)
    expect(await until(() => !alive(child.pid!), 4000)).toBe(true)
    expect(await until(() => !alive(watchdog.pid), 3000)).toBe(true)
  })

  it('leaves alone a process that exits by itself, and goes away too', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], { stdio: 'ignore' })
    const watchdog = startQuitWatchdog(child.pid!, 60_000, process.execPath)
    spawned.push(child.pid!, watchdog.pid)
    expect(await until(() => !alive(child.pid!), 3000)).toBe(true)
    expect(await until(() => !alive(watchdog.pid), 3000)).toBe(true)
  })
})
