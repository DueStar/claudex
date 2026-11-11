'use strict'

/**
 * runtime-dir.cjs — where spawn keeps its data (the game, the server token,
 * the cloud session, the sprite cache), shared by the server, the app and the
 * hooks (hooks/post.cjs resolves it the same way).
 *
 *   SPAWN_HOME (else the older CLAUDEX_HOME), else ~/.spawn
 *
 * The folder was ~/.claudex until 1.3.35 (the app was called Claudex) and
 * ~/.agent-office until 1.3.8 (the project began as a fork of Claude Office).
 * migrateRuntimeDir copies the newest of those to ~/.spawn once, the first
 * time a new version starts: the Pokédex lives there, so nothing is moved or
 * deleted. The copy goes to a temporary folder that is renamed into place
 * only when complete, so a crash halfway never leaves a partial ~/.spawn,
 * and the old folder stays as it was, with a note saying where the data went.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

/** SPAWN_<name> from the environment, else the older CLAUDEX_<name>, or '' */
function envVar(name, env = process.env) {
  return (env && (env[`SPAWN_${name}`] || env[`CLAUDEX_${name}`])) || ''
}

/**
 * Settings made under the old name (CLAUDEX_PORT=4000, CLAUDEX_HOME=…) keep
 * working: each CLAUDEX_<name> with no SPAWN_<name> is copied over, in place.
 * Run once at the start of the app and of the server.
 */
function adoptLegacyEnv(env = process.env) {
  for (const key of Object.keys(env)) {
    if (!key.startsWith('CLAUDEX_')) continue
    const next = `SPAWN_${key.slice('CLAUDEX_'.length)}`
    if (env[next] === undefined) env[next] = env[key]
  }
  return env
}

/** Older data folders, newest first: ~/.claudex (to 1.3.35), ~/.agent-office (to 1.3.7) */
const LEGACY_NAMES = ['.claudex', '.agent-office']
const LEGACY_NAME = LEGACY_NAMES[0]
const NAME = '.spawn'
const legacyIn = (home) => LEGACY_NAMES.map(n => path.join(home, n)).find(d => fs.existsSync(d)) ?? null

/**
 * The folder in use. While ~/.spawn does not exist but an older one does
 * (the copy failed, or has not run yet), the old folder stays in use, so a
 * failed copy never starts a fresh game; the next start tries again.
 */
function runtimeDir(env = process.env, home = os.homedir()) {
  const chosen = envVar('HOME', env)
  if (chosen) return chosen
  const target = path.join(home, NAME)
  if (fs.existsSync(target)) return target
  return legacyIn(home) ?? target
}

/**
 * Copy the newest older folder (~/.claudex, else ~/.agent-office) to ~/.spawn
 * when the new folder does not exist yet.
 * Returns what happened: 'custom' (SPAWN_HOME is set: the
 * user chose the folder), 'present', 'nothing' (no old folder), 'copied', or
 * 'failed' (the error is logged; runtimeDir keeps using ~/.agent-office and
 * the next start tries again).
 */
function migrateRuntimeDir({ env = process.env, home = os.homedir(), log = console } = {}) {
  if (envVar('HOME', env)) return 'custom'
  const target = path.join(home, NAME)
  if (fs.existsSync(target)) return 'present'
  const legacy = legacyIn(home)
  if (!legacy) return 'nothing'
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
      fs.writeFileSync(path.join(legacy, 'MOVED-TO-SPAWN.txt'),
        `spawn ${new Date().toISOString()}: this folder was copied to ${target}, which spawn (formerly Claudex) uses from now on.\n` +
        'Nothing here is read any more; it is kept as a backup and can be deleted once spawn runs fine.\n')
    } catch { /* only a note */ }
    log?.log?.(`[spawn] Copied ${legacy} to ${target}`)
    return 'copied'
  } catch (err) {
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* best effort */ }
    // Another process may have finished the same copy first
    if (fs.existsSync(target)) return 'present'
    log?.error?.(`[spawn] Could not copy ${legacy} to ${target}: ${err.message}`)
    return 'failed'
  }
}

module.exports = { envVar, adoptLegacyEnv, runtimeDir, migrateRuntimeDir, LEGACY_NAME, LEGACY_NAMES, NAME }
