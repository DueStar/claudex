/**
 * electron/quitWatchdog.cjs — a separate process that ends the app's main
 * process when a quit hangs (a main stuck in native teardown kept running
 * for a day after an update restart).
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('notes in the log when the main went, or that it ended it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spawn-watchdog-'))
    const log = join(dir, 'update.log')
    const quick = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], { stdio: 'ignore' })
    const stuck = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const w1 = startQuitWatchdog(quick.pid!, 60_000, process.execPath, log)
    const w2 = startQuitWatchdog(stuck.pid!, 300, process.execPath, log)
    spawned.push(quick.pid!, stuck.pid!, w1.pid, w2.pid)
    const lines = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split(/\r?\n/) : [])
    expect(await until(() => lines().length === 2, 4000)).toBe(true)
    expect(lines().find(l => l.includes(`pid=${quick.pid} p1 main-gone`))).toBeTruthy()
    expect(lines().find(l => l.includes(`pid=${stuck.pid} p1 main-killed`))).toBeTruthy()
    rmSync(dir, { recursive: true, force: true })
  })
})
