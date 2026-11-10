'use strict'

/**
 * quitWatchdog.cjs — a last resort for a quit that never finishes.
 *
 * Once a quit has started, a small separate process (this app in Node mode)
 * watches the main process: when the main is gone it goes too; when the main
 * is still there after `ms` it ends it. An update restart waits on the old
 * main (Electron's relauncher), and a main hung in its native teardown once
 * kept running, with ~550 MB, for a day.
 *
 * It checks every half second, so a main that exits is noticed long before
 * its process id could be given to another process.
 */

const { spawn } = require('child_process')

const SCRIPT = `
const pid = Number(process.argv[1]), ms = Number(process.argv[2]), end = Date.now() + ms
const gone = () => { try { process.kill(pid, 0); return false } catch { return true } }
const timer = setInterval(() => {
  if (gone()) { clearInterval(timer); return }
  if (Date.now() >= end) { try { process.kill(pid) } catch {} clearInterval(timer) }
}, 500)
`

/** Start the watchdog for `pid`; returns the watchdog's child process (detached, not waited on). */
function startQuitWatchdog(pid, ms = 10_000, runtime = process.execPath) {
  const child = spawn(runtime, ['-e', SCRIPT, String(pid), String(ms)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  child.on('error', () => {})
  child.unref()
  return child
}

module.exports = { startQuitWatchdog }
