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
 * It checks every 100 ms, so a main that exits is noticed long before its
 * process id could be given to another process. Given a log file (an update
 * restart's update.log), it notes when the main went: the only process that
 * outlives the main and can see that moment.
 */

const { spawn } = require('child_process')

const SCRIPT = `
const pid = Number(process.argv[1]), ms = Number(process.argv[2]), logFile = process.argv[3] || '', t0 = Date.now(), end = t0 + ms
const gone = () => { try { process.kill(pid, 0); return false } catch { return true } }
const note = (what) => { if (!logFile) return; try { const t = Date.now(); require('fs').appendFileSync(logFile, new Date(t).toISOString() + ' pid=' + pid + ' p1 ' + what + ' +' + (t - t0) + 'ms (watchdog)' + String.fromCharCode(10)) } catch {} }
const timer = setInterval(() => {
  if (gone()) { clearInterval(timer); note('main-gone'); return }
  if (Date.now() >= end) { try { process.kill(pid) } catch {} clearInterval(timer); note('main-killed') }
}, 100)
`

/** Start the watchdog for `pid`; returns the watchdog's child process (detached, not waited on). */
function startQuitWatchdog(pid, ms = 10_000, runtime = process.execPath, logFile = null) {
  const child = spawn(runtime, ['-e', SCRIPT, String(pid), String(ms), ...(logFile ? [logFile] : [])], {
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
