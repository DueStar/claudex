'use strict'

/**
 * updateRunner.cjs — the short run between an update restart's quit and the
 * new app ("process 2").
 *
 * The old app writes userData/pending-update.json and relaunches. This run
 * sees the marker first thing (main.cjs, before anything else loads), shows the
 * "updating" card, mirrors the staged update over resources/app with robocopy
 * (it retries while the old run's processes let go of their files), and starts
 * the app once more on the new code, flagged --claudex-updated so that run
 * times its start in update.log.
 *
 * The marker is removed before trying, so a bad update can never loop: a
 * failed copy starts the old code once. The staged folder is not deleted here
 * (9,000 files, ~2 s): the new app removes it in the background
 * (cleanupStaleUpdates) once its window is up.
 */

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const { createStepTimer } = require('./updateTiming.cjs')

const UPDATED_FLAG = '--claudex-updated'
const pendingFile = (userData) => path.join(userData, 'pending-update.json')

function hasPendingUpdate(userData) {
  return fs.existsSync(pendingFile(userData))
}

/** robocopy's exit code (0–7 copied or nothing to do, 8+ failed), -1 when it could not run */
function robocopy(spawn, from, to) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('robocopy', [from, to, '/MIR', '/R:20', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { windowsHide: true })
    } catch { resolve(-1); return }
    child.on('error', () => resolve(-1))
    child.on('exit', (code) => resolve(typeof code === 'number' ? code : -1))
  })
}

async function runPendingUpdate({
  app,
  isPackaged,
  resourcesPath,
  userData,
  readNear = () => null,
  lang = 'ko',
  spawn = childProcess.spawn,
  openCard = null,
  timer = createStepTimer({ file: path.join(userData, 'update.log'), label: 'p2' }),
  argv = process.argv,
}) {
  timer.mark('p2-start')
  const file = pendingFile(userData)
  let pending = null
  try { pending = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  fs.rmSync(file, { force: true })
  if (!isPackaged) return { ok: false, reason: 'not packaged' }

  const staged = pending?.staged
  let result
  if (!staged || !fs.existsSync(path.join(staged, 'package.json'))) {
    result = { ok: false, reason: 'no staged app' }
  } else {
    let card = null
    try {
      await app.whenReady()
      card = openCard ? openCard({ near: readNear(), step: 'updating', lang }) : null
    } catch { /* no card: the copy still runs */ }
    timer.mark('robocopy-start', `version=${pending.version ?? '?'}`)
    const code = await robocopy(spawn, staged, path.join(resourcesPath, 'app'))
    timer.mark('robocopy-end', `code=${code}`)
    result = code >= 0 && code < 8 ? { ok: true } : { ok: false, reason: `robocopy ${code}` }
    try { card?.close() } catch {}
  }

  timer.mark('relaunch', result.ok ? '' : `reason=${result.reason}`)
  app.relaunch({ args: [...argv.slice(1).filter(a => a !== UPDATED_FLAG), UPDATED_FLAG] })
  app.exit(0)
  return result
}

/**
 * Remove the claudex-update-* folders a past update left in the temp folder
 * (all but `keep`, the one this run may be downloading into). Returns how many went.
 */
async function cleanupStaleUpdates({ tmpdir, keep = null, rm = fs.promises.rm }) {
  let names = []
  try { names = await fs.promises.readdir(tmpdir) } catch { return 0 }
  const keepPath = keep ? path.resolve(keep) : null
  let removed = 0
  for (const name of names) {
    if (!name.startsWith('claudex-update-')) continue
    const full = path.resolve(tmpdir, name)
    if (keepPath && (full === keepPath || keepPath.startsWith(full + path.sep))) continue
    try { await rm(full, { recursive: true, force: true }); removed++ } catch {}
  }
  return removed
}

module.exports = { UPDATED_FLAG, pendingFile, hasPendingUpdate, runPendingUpdate, cleanupStaleUpdates }
