'use strict'

/**
 * updateRunner.cjs — the short run between an update restart's quit and the
 * new app ("process 2").
 *
 * The old app writes userData/pending-update.json and relaunches. This run
 * sees the marker first thing (main.cjs, before anything else loads), shows the
 * "updating" card, mirrors the staged update over resources/app with robocopy
 * (it retries while the old run's processes let go of their files), and starts
 * the app once more on the new code, flagged --spawn-updated so that run
 * times its start in update.log.
 *
 * On a Mac the copy is mirrorDir (mirrorDir.cjs) into the bundle's
 * Contents/Resources/app; the bundle is then signed again ad hoc (the copy
 * changed what its signature seals) and opened with `open -n`.
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
const { mirrorDir } = require('./mirrorDir.cjs')
const { isMac } = require('./platform.cjs')

const UPDATED_FLAG = '--spawn-updated'
/** The same flag from when the app was Claudex (1.3.35 and older run the copy step of the update into spawn) */
const LEGACY_UPDATED_FLAG = '--claudex-updated'
/** True when this run follows an update restart, flagged by this version or an older one */
const isUpdatedRun = (argv = process.argv) => argv.includes(UPDATED_FLAG) || argv.includes(LEGACY_UPDATED_FLAG)
const pendingFile = (userData) => path.join(userData, 'pending-update.json')

function hasPendingUpdate(userData) {
  return fs.existsSync(pendingFile(userData))
}

/**
 * robocopy's exit code (0–7 copied or nothing to do, 8+ failed), -1 when it
 * could not run. Its output is not piped: nobody reads it, and its retry lines
 * for locked files could fill a pipe and stop it.
 */
function robocopy(spawn, from, to) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('robocopy', [from, to, '/MIR', '/MT:8', '/R:20', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { windowsHide: true, stdio: 'ignore' })
    } catch { resolve(-1); return }
    child.on('error', () => resolve(-1))
    child.on('exit', (code) => resolve(typeof code === 'number' ? code : -1))
  })
}

/** The .app folder of a Mac app: two levels above its Contents/Resources */
const bundlePath = (resourcesPath) => path.posix.dirname(path.posix.dirname(String(resourcesPath).replace(/\/+$/, '')))

/**
 * A command's exit code, -1 when it could not run or did not end within
 * `timeoutMs` (the run must always get to starting the app again). Its output
 * is not read.
 */
function runCommand(spawn, cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try { child = spawn(cmd, args, { stdio: 'ignore' }) } catch { resolve(-1); return }
    const timer = setTimeout(() => resolve(-1), timeoutMs)
    const done = (code) => { clearTimeout(timer); resolve(code) }
    child.on('error', () => done(-1))
    child.on('exit', (code) => done(typeof code === 'number' ? code : -1))
  })
}

/**
 * A Mac's copy: mirror the staged app into the bundle, then sign the bundle
 * again ad hoc whatever the copy did (a copy that failed halfway through its
 * removals has changed it too). A failed signing is only noted in update.log:
 * an updated app with a bad signature is mended by a full download, while an
 * app that never opens again is not.
 */
async function applyOnMac({ staged, resourcesPath, version, spawn, mirror, timer }) {
  let result
  timer.mark('mirror-start', `version=${version ?? '?'}`)
  try {
    mirror(staged, path.posix.join(resourcesPath, 'app'))
    timer.mark('mirror-end')
    result = { ok: true }
  } catch (err) {
    timer.mark('mirror-end', `error=${err?.code ? `${err.code} ` : ''}${err?.message ?? err}`)
    result = { ok: false, reason: `mirror ${err?.code ?? 'failed'}` }
  }
  timer.mark('codesign-start')
  const signed = await runCommand(spawn, 'codesign', ['--force', '--deep', '--sign', '-', bundlePath(resourcesPath)], 120_000)
  timer.mark('codesign-end', `code=${signed}`)
  return result
}

/**
 * A Mac update that could not be put into the bundle (the mirror failed) leaves
 * userData/mac-update-failed.json { version }: the next check (updater.cjs) then
 * offers the full download of that version instead of the same patch again.
 */
const macFailedFile = (userData) => path.join(userData, 'mac-update-failed.json')
function writeMacFailed(userData, version) {
  try { fs.writeFileSync(macFailedFile(userData), JSON.stringify({ version: String(version ?? ''), at: new Date().toISOString() })) } catch { /* the next check offers the patch again */ }
}

async function runPendingUpdate({
  app,
  isPackaged,
  resourcesPath,
  userData,
  readNear = () => null,
  getLang = () => 'ko',
  spawn = childProcess.spawn,
  openCard = null,
  timer = createStepTimer({ file: path.join(userData, 'update.log'), label: 'p2' }),
  argv = process.argv,
  removeMarker = (file) => fs.rmSync(file, { force: true }),
  setAsideMarker = (file) => fs.renameSync(file, `${file}.stuck-${Date.now()}`),
  readyTimeoutMs = 5000,
  platform = process.platform,
  mirror = mirrorDir,
}) {
  timer.mark('p2-start', `boot=${Math.max(0, Date.now() - Math.round(process.getCreationTime?.() ?? Date.now()))}ms`)
  const file = pendingFile(userData)
  let pending = null
  try { pending = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  // The marker goes before anything is tried, so a bad update can never loop. If it
  // cannot go (a scanner holding it), set it aside; if that fails too, stop here
  // without starting again: a start would only come back to this run.
  try { removeMarker(file) } catch {
    try { setAsideMarker(file) } catch {
      timer.mark('marker-stuck')
      app.exit(0)
      return { ok: false, reason: 'marker stuck' }
    }
  }
  if (!isPackaged) return { ok: false, reason: 'not packaged' }

  const staged = pending?.staged
  let result
  if (!staged || !fs.existsSync(path.join(staged, 'package.json'))) {
    result = { ok: false, reason: 'no staged app' }
  } else {
    // The card: where the quitting app left it and in its language (it wrote them
    // into the marker), else from window-state/settings once Electron is ready
    let card = null
    try {
      const ready = await Promise.race([app.whenReady().then(() => true), new Promise(r => setTimeout(() => r(false), readyTimeoutMs))])
      if (ready && openCard) {
        card = openCard({ near: pending.card?.near ?? readNear(), step: 'updating', lang: pending.card?.lang ?? getLang() })
      }
    } catch { /* no card: the copy still runs */ }
    if (isMac(platform)) {
      result = await applyOnMac({ staged, resourcesPath, version: pending.version, spawn, mirror, timer })
      if (!result.ok) writeMacFailed(userData, pending.version)
    } else {
      timer.mark('robocopy-start', `version=${pending.version ?? '?'}`)
      const code = await robocopy(spawn, staged, path.join(resourcesPath, 'app'))
      timer.mark('robocopy-end', `code=${code}`)
      result = code >= 0 && code < 8 ? { ok: true } : { ok: false, reason: `robocopy ${code}` }
    }
    try { card?.close() } catch {}
  }

  timer.mark('relaunch', result.ok ? '' : `reason=${result.reason}`)
  if (isMac(platform)) {
    // Through Launch Services, so the bundle as signed now is what opens; should
    // that fail, Electron starts the app itself as it does on Windows
    const opened = await runCommand(spawn, 'open', ['-n', bundlePath(resourcesPath), '--args', UPDATED_FLAG], 30_000)
    if (opened !== 0) {
      timer.mark('open-failed', `code=${opened}`)
      app.relaunch({ args: [UPDATED_FLAG] })
    }
  } else {
    app.relaunch({ args: [...argv.slice(1).filter(a => a !== UPDATED_FLAG && a !== LEGACY_UPDATED_FLAG), UPDATED_FLAG] })
  }
  app.exit(0)
  return result
}

/**
 * Remove the spawn-update-* (and older claudex-update-*) folders a past update left in the temp folder
 * (all but `keep`, the one this run may be downloading into). Returns how many went.
 */
async function cleanupStaleUpdates({ tmpdir, keep = null, rm = fs.promises.rm, minAgeMs = 10 * 60_000, now = Date.now }) {
  let names = []
  try { names = await fs.promises.readdir(tmpdir) } catch { return 0 }
  const keepPath = keep ? path.resolve(keep) : null
  let removed = 0
  for (const name of names) {
    // claudex-update-*: made by 1.3.35 and older (the update into spawn among them)
    if (!name.startsWith('spawn-update-') && !name.startsWith('claudex-update-')) continue
    const full = path.resolve(tmpdir, name)
    if (keepPath && (full === keepPath || keepPath.startsWith(full + path.sep))) continue
    // A folder made in the last minutes may be an update being unpacked right now
    // (this run's, before it is known, or another spawn run's): left for next time
    try {
      const st = await fs.promises.stat(full)
      const made = st.birthtimeMs || st.ctimeMs
      if (now() - made < minAgeMs) continue
    } catch { continue }
    try { await rm(full, { recursive: true, force: true }); removed++ } catch {}
  }
  return removed
}

module.exports = { UPDATED_FLAG, LEGACY_UPDATED_FLAG, isUpdatedRun, pendingFile, hasPendingUpdate, runPendingUpdate, cleanupStaleUpdates, bundlePath, macFailedFile, writeMacFailed }
