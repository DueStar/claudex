'use strict'

/**
 * runtime-dir.cjs — where Claudex keeps its data (the game, the server token,
 * the cloud session, the sprite cache), shared by the server, the app and the
 * hooks (hooks/post.cjs resolves it the same way).
 *
 *   CLAUDEX_HOME, else ~/.claudex
 *
 * Until 1.3.8 the folder was ~/.agent-office (the project began as a fork of
 * Claude Office). migrateRuntimeDir copies it to ~/.claudex once, the first
 * time a new version starts: the Pokédex lives there, so nothing is moved or
 * deleted. The copy goes to a temporary folder that is renamed into place
 * only when complete, so a crash halfway never leaves a partial ~/.claudex,
 * and the old folder stays as it was, with a note saying where the data went.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

/** CLAUDEX_<name> from the environment, or '' */
function envVar(name, env = process.env) {
  return (env && env[`CLAUDEX_${name}`]) || ''
}

const LEGACY_NAME = '.agent-office'
const NAME = '.claudex'

/**
 * The folder in use. While ~/.claudex does not exist but ~/.agent-office does
 * (the copy failed, or has not run yet), the old folder stays in use, so a
 * failed copy never starts a fresh game; the next start tries again.
 */
function runtimeDir(env = process.env, home = os.homedir()) {
  const chosen = envVar('HOME', env)
  if (chosen) return chosen
  const target = path.join(home, NAME)
  const legacy = path.join(home, LEGACY_NAME)
  return !fs.existsSync(target) && fs.existsSync(legacy) ? legacy : target
}

/**
 * Copy ~/.agent-office to ~/.claudex when the new folder does not exist yet.
 * Returns what happened: 'custom' (CLAUDEX_HOME is set: the
 * user chose the folder), 'present', 'nothing' (no old folder), 'copied', or
 * 'failed' (the error is logged; runtimeDir keeps using ~/.agent-office and
 * the next start tries again).
 */
function migrateRuntimeDir({ env = process.env, home = os.homedir(), log = console } = {}) {
  if (envVar('HOME', env)) return 'custom'
  const target = path.join(home, NAME)
  const legacy = path.join(home, LEGACY_NAME)
  if (fs.existsSync(target)) return 'present'
  if (!fs.existsSync(legacy)) return 'nothing'
  const temp = `${target}.moving-${process.pid}`
  try {
    fs.rmSync(temp, { recursive: true, force: true })
    fs.cpSync(legacy, temp, { recursive: true, preserveTimestamps: true, errorOnExist: false })
    // The game file is the one that must arrive: check it before going live
    const game = path.join(legacy, 'pokedex.json')
    if (fs.existsSync(game) && fs.statSync(path.join(temp, 'pokedex.json')).size !== fs.statSync(game).size) {
      throw new Error('pokedex.json did not copy whole')
    }
    fs.renameSync(temp, target)
    try {
      fs.writeFileSync(path.join(legacy, 'MOVED-TO-CLAUDEX.txt'),
        `Claudex ${new Date().toISOString()}: this folder was copied to ${target}, which Claudex uses from now on.\n` +
        'Nothing here is read any more; it is kept as a backup and can be deleted once Claudex runs fine.\n')
    } catch { /* only a note */ }
    log?.log?.(`[claudex] Copied ${legacy} to ${target}`)
    return 'copied'
  } catch (err) {
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* best effort */ }
    // Another process may have finished the same copy first
    if (fs.existsSync(target)) return 'present'
    log?.error?.(`[claudex] Could not copy ${legacy} to ${target}: ${err.message}`)
    return 'failed'
  }
}

module.exports = { envVar, runtimeDir, migrateRuntimeDir, LEGACY_NAME, NAME }
