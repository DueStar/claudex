'use strict'

// The app's own folder (%APPDATA%\<name>: settings, window place, open
// sessions, session names, the page's storage, logs) follows the app's name,
// so renaming Claudex to spawn would start the new version on an empty one.
// The first start under the new name copies the old folder over, once, before
// anything reads it. Nothing is moved or deleted; the old folder gets a note.
// Chromium's caches are left behind (they rebuild themselves), and so is an
// update marker (a copied one would run the same update again).

const fs = require('fs')
const path = require('path')

/** Folders and files not worth carrying over */
const SKIP = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'blob_storage', 'Crashpad', 'Shared Dictionary', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  'pending-update.json', 'MOVED-TO-SPAWN.txt',
])

/**
 * Copy `from` to `to` when `to` does not exist yet. Returns 'present' (nothing
 * to do), 'nothing' (no old folder), 'copied' or 'failed' (logged; the next
 * start tries again, since a failed copy leaves no `to` behind).
 */
function migrateUserData({ from, to, log = console } = {}) {
  if (!from || !to) return 'nothing'
  if (fs.existsSync(to)) return 'present'
  if (!fs.existsSync(from)) return 'nothing'
  const temp = `${to}.moving-${process.pid}`
  try {
    fs.rmSync(temp, { recursive: true, force: true })
    fs.cpSync(from, temp, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: false,
      filter: (src) => src === from || !SKIP.has(path.basename(src)),
    })
    fs.renameSync(temp, to)
    try {
      fs.writeFileSync(path.join(from, 'MOVED-TO-SPAWN.txt'),
        `spawn ${new Date().toISOString()}: this folder was copied to ${to}, which spawn (formerly Claudex) uses from now on.\n` +
        'Nothing here is read any more; it is kept as a backup and can be deleted once spawn runs fine.\n')
    } catch { /* only a note */ }
    log?.log?.(`[spawn] Copied ${from} to ${to}`)
    return 'copied'
  } catch (err) {
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* best effort */ }
    if (fs.existsSync(to)) return 'present'
    log?.error?.(`[spawn] Could not copy ${from} to ${to}: ${err.message}`)
    return 'failed'
  }
}

module.exports = { migrateUserData, SKIP }
