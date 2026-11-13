/**
 * mac-build.mjs — the Mac build's steps after electron-builder, run by
 * .github/workflows/mac.yml on a macOS runner (ditto and codesign are macOS's).
 *
 *   node scripts/mac-build.mjs prune <arch>   the Windows node-pty binaries out of the bundle
 *                                             (electron-builder copies them: see below)
 *   node scripts/mac-build.mjs stamp <arch>   build-info.json into the bundle's app
 *                                             folder (before the ad-hoc signing:
 *                                             a file added after it breaks the seal)
 *   node scripts/mac-build.mjs pack <arch>    the zips, their sha256s and the
 *                                             Electron version into release/upload/
 *
 * Files (release/upload/):
 *   spawn-app-<v>-mac-<arch>.zip   Contents/Resources/app's contents, package.json at
 *                                  the root: what the in-app update downloads
 *                                  (electron/updater.cjs takes only this name on a Mac)
 *   spawn-<v>-mac-<arch>.zip       spawn.app itself (ditto --keepParent), for a first install
 *   sha256.txt                     "<sha256>  <file>" for both
 *   electron-version.txt           the Electron the build runs on (the manifest's
 *                                  `electron`, which decides a full download)
 *
 * The version is the built app's own (its package.json). electron-builder puts
 * an x64 build in release/mac and an arm64 one in release/mac-arm64.
 *
 * Why prune here and not with a build.mac.files list: electron-builder 24 turns the
 * top-level files list into a file set of its own, so a platform list beside it
 * (exclusions only) becomes a second matcher that takes everything else (**\/*):
 * the project went in twice and the Mac build failed linking server/ (EEXIST).
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { smokeTimeoutMs, QUIT_TIMEOUT_MS } = createRequire(import.meta.url)('../electron/smoke.cjs')

const ARCHES = new Set(['arm64', 'x64'])
// Past the app's own timeout and quit cap: time for it to write smoke.json and exit
const SMOKE_KILL_MARGIN_MS = 10_000

/**
 * When scripts/smoke-mac.mjs kills a smoke launch: the app's run timeout (its
 * SPAWN_SMOKE_TIMEOUT_MS, read as the app reads it) plus its quit cap plus a margin,
 * so the app always gets to record its own reason first. 90 s by default.
 */
export function smokeKillMs(env = process.env) {
  return smokeTimeoutMs(env) + QUIT_TIMEOUT_MS + SMOKE_KILL_MARGIN_MS
}
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** The names one arch's build goes by: the CI artifact and the two zips */
export function macArtifactNames(version, arch) {
  if (!ARCHES.has(arch)) throw new Error(`not a Mac arch: ${arch} (arm64 or x64)`)
  if (!VERSION.test(String(version ?? ''))) throw new Error(`not a version: ${version}`)
  return { artifact: `mac-${arch}`, appZip: `spawn-app-${version}-mac-${arch}.zip`, fullZip: `spawn-${version}-mac-${arch}.zip` }
}

/** Every spawn.app electron-builder left in `releaseDir` (release/mac*\/spawn.app) */
export function findMacApps(releaseDir) {
  let names = []
  try { names = readdirSync(releaseDir) } catch { return [] }
  return names.filter(n => /^mac(-|$)/.test(n)).map(n => join(releaseDir, n, 'spawn.app')).filter(p => existsSync(p))
}

/** The spawn.app for `arch`: release/mac-arm64 for arm64, release/mac for x64; else the only one there */
export function pickMacApp(releaseDir, arch) {
  const apps = findMacApps(releaseDir)
  const want = join(releaseDir, arch === 'arm64' ? 'mac-arm64' : 'mac', 'spawn.app')
  if (apps.includes(want)) return want
  return apps.length === 1 ? apps[0] : null
}

/** The app folder inside the bundle: what the update zip holds */
export function appDirOf(appPath) {
  return join(appPath, 'Contents', 'Resources', 'app')
}

/**
 * What is wrong with node-pty's spawn-helper in the bundle: every
 * prebuilds/darwin-* must have one, executable (node-pty starts every shell
 * through it; without the exec bit each session fails with posix_spawnp).
 */
export function spawnHelperProblems(appPath) {
  const pre = join(appDirOf(appPath), 'node_modules', 'node-pty', 'prebuilds')
  let dirs = []
  try { dirs = readdirSync(pre).filter(n => n.startsWith('darwin-')) } catch {}
  if (!dirs.length) return [`no node-pty darwin prebuilds in ${pre}`]
  const problems = []
  for (const d of dirs) {
    const helper = join(pre, d, 'spawn-helper')
    let st = null
    try { st = statSync(helper) } catch {}
    if (!st) problems.push(`spawn-helper missing: ${helper}`)
    else if ((st.mode & 0o111) === 0) problems.push(`spawn-helper not executable (mode ${(st.mode & 0o777).toString(8)}): ${helper}`)
  }
  return problems
}

/** node-pty's Windows binaries, under node_modules/node-pty: none of them runs on a Mac (~60 MB) */
export const OTHER_PLATFORM_PATHS = Object.freeze(['prebuilds/win32-*', 'third_party/conpty', 'build/Release/conpty'])

/** Remove OTHER_PLATFORM_PATHS from the bundle; returns what was removed */
export function pruneOtherPlatforms(appPath) {
  const pty = join(appDirOf(appPath), 'node_modules', 'node-pty')
  const removed = []
  for (const rel of OTHER_PLATFORM_PATHS) {
    const parts = rel.split('/')
    const last = parts.pop()
    const dir = join(pty, ...parts)
    let names = []
    if (last.endsWith('*')) {
      try { names = readdirSync(dir).filter(n => n.startsWith(last.slice(0, -1))) } catch {}
    } else if (existsSync(join(dir, last))) names = [last]
    for (const n of names) {
      rmSync(join(dir, n), { recursive: true, force: true })
      removed.push(join(dir, n))
    }
  }
  return removed
}

/** sha256.txt's lines, as shasum -a 256 writes them */
export function sha256Lines(hashes) {
  return Object.entries(hashes).map(([file, hash]) => `${hash}  ${file}\n`).join('')
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const [command, arch] = argv
  const release = join(root, 'release')
  if (!['prune', 'stamp', 'pack'].includes(command) || !ARCHES.has(arch)) {
    console.error('usage: node scripts/mac-build.mjs prune|stamp|pack arm64|x64')
    process.exit(2)
  }
  const app = pickMacApp(release, arch)
  if (!app) throw new Error(`no spawn.app for ${arch} in ${release}`)
  const appDir = appDirOf(app)
  const version = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).version

  if (command === 'prune') {
    const removed = pruneOtherPlatforms(app)
    console.log(`pruned ${removed.length} Windows node-pty folder(s) from ${app}${removed.map(r => `
  - ${r}`).join('')}`)
    return
  }

  if (command === 'stamp') {
    // As scripts/release.mjs does for Windows: the app tells a newer local build of the same version by it
    writeFileSync(join(appDir, 'build-info.json'), JSON.stringify({ version, date: new Date().toISOString() }))
    console.log(`stamped ${app} (${version})`)
    return
  }

  const names = macArtifactNames(version, arch)
  const out = join(release, 'upload')
  mkdirSync(out, { recursive: true })
  for (const f of [names.appZip, names.fullZip]) rmSync(join(out, f), { force: true })
  // ditto keeps the exec bits, symlinks and extended attributes the bundle needs
  execFileSync('ditto', ['-c', '-k', appDir, join(out, names.appZip)], { stdio: 'inherit' })
  execFileSync('ditto', ['-c', '-k', '--keepParent', app, join(out, names.fullZip)], { stdio: 'inherit' })
  writeFileSync(join(out, 'sha256.txt'), sha256Lines({ [names.appZip]: sha256(join(out, names.appZip)), [names.fullZip]: sha256(join(out, names.fullZip)) }))
  const electron = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  writeFileSync(join(out, 'electron-version.txt'), `${electron}\n`)
  const mb = (f) => `${(statSync(join(out, f)).size / 1024 / 1024).toFixed(1)} MB`
  console.log(`${names.artifact}: ${names.appZip} ${mb(names.appZip)} · ${names.fullZip} ${mb(names.fullZip)} · electron ${electron}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) } catch (err) { console.error(err.message); process.exit(1) }
}
