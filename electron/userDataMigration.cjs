'use strict'

// The app's own folder (%APPDATA%\<name>: settings, window place, open
// sessions, session names, the page's storage, logs) follows the app's name,
// so renaming Claudex to spawn would start the new version on an empty one.
// Starts under the new name copy the old folder's contents over until a copy
// has gone through, before anything reads them. Nothing is moved or deleted;
// the old folder gets a note.
//
// "Done" is a marker file in the new folder, not the folder being there: the
// app makes the folder itself (logs, locks) right after this runs, so a copy
// that failed once (the update's last step can still hold files in the old
// folder for a moment) would otherwise never be tried again. Each entry is
// copied on its own, with a few retries; the ones that went through are
// written down, the rest are tried at the next start.
//
// What the old folder has wins over what a run without the copy made in the
// new one (that run started empty). update.log is joined (old lines first),
// logs/ stays (the old folder keeps its own), Chromium's caches and an update
// marker are left behind (a copied marker would run the same update again).

const fs = require('fs')
const path = require('path')

/** Folders and files not worth carrying over */
const SKIP = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'blob_storage', 'Crashpad', 'Shared Dictionary', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  'pending-update.json', 'MOVED-TO-SPAWN.txt', 'logs',
])
const MARKER = '.copied-from-claudex.json'

/** Wait without an event loop (this runs before Electron is ready) */
const pause = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* no wait */ } }

function readMarker(to) {
  try { return JSON.parse(fs.readFileSync(path.join(to, MARKER), 'utf8')) } catch { return null }
}

function copyEntry(from, to, name) {
  const src = path.join(from, name)
  const dst = path.join(to, name)
  if (name === 'update.log') {
    // old lines (the restart's first steps, written by the old version) before the new ones
    const old = fs.readFileSync(src, 'utf8')
    const now = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : ''
    fs.writeFileSync(dst, old + (old.endsWith('\n') || !old ? '' : '\n') + now)
    return
  }
  // A folder is replaced whole (page storage files only make sense together)
  const temp = `${dst}.copying-${process.pid}`
  fs.rmSync(temp, { recursive: true, force: true })
  fs.cpSync(src, temp, { recursive: true, preserveTimestamps: true, errorOnExist: false })
  fs.rmSync(dst, { recursive: true, force: true })
  fs.renameSync(temp, dst)
}

/**
 * Copy what `from` has into `to` until it has all gone through once. Returns
 * 'done' (an earlier start finished it), 'nothing' (no old folder), 'copied',
 * 'partial' (some entries are left for the next start; see `failed`) with the
 * names copied and failed. Never throws.
 */
function migrateUserData({ from, to, waitMs = 300, budgetMs = 3000, now = Date.now } = {}) {
  const result = { status: 'nothing', copied: [], failed: [] }
  try {
    if (!from || !to || !fs.existsSync(from)) return result
    const marker = readMarker(to)
    if (marker?.done) return { ...result, status: 'done' }
    fs.mkdirSync(to, { recursive: true })
    const already = new Set(marker?.copied ?? [])
    // retries share one time budget, so a busy old folder delays the start by seconds at most
    const deadline = now() + budgetMs
    const names = fs.readdirSync(from).filter(n => !SKIP.has(n) && !already.has(n) && !n.includes('.copying-'))
    for (const name of names) {
      let lastErr = null
      for (;;) {
        try { copyEntry(from, to, name); lastErr = null; break } catch (err) { lastErr = err }
        if (now() + waitMs > deadline) break
        pause(waitMs)
      }
      if (lastErr) result.failed.push(`${name}: ${lastErr.code || lastErr.message}`)
      else result.copied.push(name)
    }
    const copied = [...already, ...result.copied]
    const done = result.failed.length === 0
    fs.writeFileSync(path.join(to, MARKER), JSON.stringify({ from, done, copied, at: new Date().toISOString() }, null, 2))
    if (done) {
      try {
        fs.writeFileSync(path.join(from, 'MOVED-TO-SPAWN.txt'),
          `spawn ${new Date().toISOString()}: this folder was copied to ${to}, which spawn (formerly Claudex) uses from now on.\n` +
          'Nothing here is read any more; it is kept as a backup and can be deleted once spawn runs fine.\n')
      } catch { /* only a note */ }
    }
    return { ...result, status: done ? 'copied' : 'partial' }
  } catch (err) {
    return { ...result, status: 'partial', failed: [...result.failed, err.code || err.message] }
  }
}

module.exports = { migrateUserData, SKIP, MARKER }
