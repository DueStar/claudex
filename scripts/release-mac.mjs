/**
 * release-mac.mjs — the Mac half of a release, run by scripts/release.mjs after
 * the Windows release is on GitHub (only with --publish), or on its own with
 * --mac-only for a release tag that is already there:
 *
 *   node scripts/release.mjs --publish [--mac-allow-unsmoked]
 *   node scripts/release.mjs --mac-only <version> [--mac-allow-unsmoked]
 *
 * Macs are built by CI (.github/workflows/mac.yml), never on this PC: the run is
 * started on the current branch for the release's version, waited for, and its
 * two artifacts (mac-arm64, mac-x64: scripts/mac-build.mjs) downloaded into
 * release/mac/<v>/. Each arch is checked here (both zips there, the update
 * zip's sha256 recomputed, the smoke launch passed), then gets its own
 * latest-mac-<arch>.json (scripts/manifest.mjs) with the Windows release's
 * notes and date, signed with the local key (it never goes to CI) and
 * verified with the key installed apps hold. The zips go up first and the
 * manifests last, so a manifest never names a zip that is not there yet.
 *
 * One arch that fails does not hold back the other; the run still ends as a
 * failure. Nothing here touches the Windows release.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as nodeFs from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeManifest } from './manifest.mjs'
import { macArtifactNames } from './mac-build.mjs'
import { signManifest, signingKeyPath } from './signing.mjs'

const { manifestName, verifyManifest, REPO } = createRequire(import.meta.url)('../electron/updater.cjs')

export const MAC_ARCHES = ['arm64', 'x64']
const WORKFLOW = 'mac.yml'
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
// How long the started run may take to show up in `gh run list`
const FIND_TRIES = 24
const FIND_EVERY_MS = 5000

/**
 * What release.mjs's arguments ask for. A test build (no --publish) is
 * Windows only; --publish is Windows, then the Macs; --mac-only <v> is the
 * Macs alone, for the release v<v> already on GitHub.
 */
export function parseReleaseArgs(argv) {
  const at = argv.indexOf('--mac-only')
  let macOnly = null
  if (at >= 0) {
    macOnly = argv[at + 1] ?? ''
    if (!VERSION.test(macOnly)) throw new Error(`--mac-only needs the version of a published release (like 1.3.49), not "${macOnly}"`)
  }
  const publish = argv.includes('--publish')
  return {
    windows: !macOnly,
    mac: !!macOnly || publish,
    macOnly,
    publish,
    allowUnsmoked: argv.includes('--mac-allow-unsmoked'),
  }
}

const sha256Of = (fs, file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** sha256.txt's lines ("<sha256>  <file>", as shasum writes them) as { file: sha256 } */
function readSha256s(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line)
    if (m) out[m[2]] = m[1].toLowerCase()
  }
  return out
}

/**
 * One arch's downloaded artifact, checked: returns what its manifest needs,
 * or throws the reason it cannot be released. A failed smoke launch is only
 * a warning with allowUnsmoked.
 */
function checkArch({ fs, dir, version, arch, allowUnsmoked, log }) {
  const { appZip, fullZip } = macArtifactNames(version, arch)
  for (const f of [appZip, fullZip]) {
    if (!fs.existsSync(join(dir, f))) throw new Error(`${f} is not in the artifact`)
  }
  let sums = {}
  try { sums = readSha256s(fs.readFileSync(join(dir, 'sha256.txt'), 'utf8')) } catch { throw new Error('no sha256.txt in the artifact') }
  const sha = sha256Of(fs, join(dir, appZip))
  if (!sums[appZip]) throw new Error(`sha256.txt has no line for ${appZip}`)
  if (sums[appZip] !== sha) throw new Error(`sha256 mismatch for ${appZip}: CI says ${sums[appZip]}, the download is ${sha}`)
  if (sums[fullZip] && sums[fullZip] !== sha256Of(fs, join(dir, fullZip))) throw new Error(`sha256 mismatch for ${fullZip}`)
  let electron = ''
  try { electron = fs.readFileSync(join(dir, 'electron-version.txt'), 'utf8').trim() } catch {}
  if (!VERSION.test(electron)) throw new Error(`no Electron version in electron-version.txt (${electron || 'missing'})`)
  let smoke = null
  try { smoke = JSON.parse(fs.readFileSync(join(dir, 'smoke', 'smoke.json'), 'utf8')) } catch {}
  if (!(smoke && smoke.ok === true && smoke.done === true)) {
    const why = smoke ? `the smoke launch failed (${smoke.failure || 'not passed'})` : 'no smoke.json: the smoke launch did not report'
    if (!allowUnsmoked) throw new Error(`${why} (--mac-allow-unsmoked releases it anyway)`)
    warnLoud(log, `mac-${arch}: ${why}. RELEASED ANYWAY (--mac-allow-unsmoked): this build was not seen to start`)
  }
  return {
    electron,
    app: { file: appZip, sha256: sha, size: fs.statSync(join(dir, appZip)).size, path: join(dir, appZip) },
    full: { file: fullZip, size: fs.statSync(join(dir, fullZip)).size, path: join(dir, fullZip) },
  }
}

function warnLoud(log, msg) {
  const bar = '!'.repeat(72)
  log.warn(`\n${bar}\n  ${msg}\n${bar}`)
}

/**
 * Release the Macs for v<version>. Every side effect comes in `deps`:
 *   run(cmd, args, { show })  gh and git; resolves to stdout, throws on a non-zero exit
 *   fs, sign(manifest), publicKey (the one manifests are verified with: the
 *   shipped one by default), log, sleep(ms), root (the repo), ref (the branch
 *   CI builds: the current one by default), notes ({ notes, notesEn, notesJa,
 *   date } of the Windows manifest; null: read from the release's latest.json),
 *   allowUnsmoked.
 * Resolves to { ok, released: [arch], failed: [{ arch, reason }] }; never throws.
 */
export async function releaseMac(version, deps = {}) {
  const {
    run, fs = nodeFs, sign = signManifest, publicKey, log = console, sleep = (ms) => new Promise(r => setTimeout(r, ms)),
    root, notes: givenNotes = null, allowUnsmoked = false,
  } = deps
  const tag = `v${version}`
  const out = join(root, 'release', 'mac', version)
  const released = []
  const failed = []
  const failAll = (reason) => {
    for (const arch of MAC_ARCHES) if (!failed.some(f => f.arch === arch)) failed.push({ arch, reason })
    log.error(`Mac release of ${version}: ${reason}`)
    return { ok: false, released, failed }
  }
  const gh = (args, opts) => run('gh', args, opts)

  try {
    const ref = deps.ref || String(await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (!ref || ref === 'HEAD') return failAll('not on a branch: CI builds a branch (check one out)')

    // The release's tag must be there: its commit is the one CI has to build
    let tagSha = ''
    try { tagSha = String(await gh(['api', `repos/${REPO}/commits/${tag}`, '--jq', '.sha'])).trim() } catch {}
    if (!/^[0-9a-f]{40}$/i.test(tagSha)) return failAll(`no ${tag} on GitHub: the Windows release makes it first`)

    fs.rmSync(out, { recursive: true, force: true })
    fs.mkdirSync(out, { recursive: true })

    // The notes and date the Windows manifest went out with
    let notes = givenNotes
    if (!notes) {
      const winDir = join(out, 'windows')
      await gh(['release', 'download', tag, '--repo', REPO, '--pattern', 'latest.json', '--dir', winDir, '--clobber'])
      const win = JSON.parse(fs.readFileSync(join(winDir, 'latest.json'), 'utf8'))
      if (win.version !== version) return failAll(`${tag}'s latest.json is for ${win.version}`)
      notes = { notes: win.notes ?? '', notesEn: win.notesEn ?? '', notesJa: win.notesJa ?? '', date: win.date }
    }

    // CI on the current branch; the run it started is the new one in the list
    const listArgs = ['run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--event', 'workflow_dispatch', '--branch', ref, '--limit', '20', '--json', 'databaseId,headSha,headBranch,event,createdAt']
    const before = new Set(JSON.parse(String(await gh(listArgs)) || '[]').map(r => r.databaseId))
    log.log(`Mac: starting ${WORKFLOW} on ${ref} for ${version}`)
    await gh(['workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', ref, '-f', `version=${version}`])
    let runInfo = null
    for (let i = 0; i < FIND_TRIES && !runInfo; i++) {
      await sleep(FIND_EVERY_MS)
      const runs = JSON.parse(String(await gh(listArgs)) || '[]').filter(r => !before.has(r.databaseId))
      runInfo = runs.sort((a, b) => b.databaseId - a.databaseId)[0] ?? null
    }
    if (!runInfo) return failAll(`the ${WORKFLOW} run did not show up within ${(FIND_TRIES * FIND_EVERY_MS) / 1000} s`)
    const id = String(runInfo.databaseId)
    if (String(runInfo.headSha).toLowerCase() !== tagSha.toLowerCase()) {
      return failAll(`CI run ${id} builds ${String(runInfo.headSha).slice(0, 7)} but ${tag} is ${tagSha.slice(0, 7)}: ${ref} on GitHub is not the release's commit`)
    }
    log.log(`Mac: CI run ${id} (https://github.com/${REPO}/actions/runs/${id})`)

    // A failed job is looked at per arch below: the other arch may be fine
    try { await gh(['run', 'watch', id, '--repo', REPO, '--exit-status'], { show: true }) } catch { log.warn(`Mac: CI run ${id} did not fully pass; checking each arch`) }
    let jobs = []
    try { jobs = JSON.parse(String(await gh(['run', 'view', id, '--repo', REPO, '--json', 'jobs']))).jobs ?? [] } catch {}

    const ready = []
    for (const arch of MAC_ARCHES) {
      const { artifact } = macArtifactNames(version, arch)
      const dir = join(out, artifact)
      try {
        const job = jobs.find(j => j.name === artifact)
        if (!job || job.conclusion !== 'success') {
          const why = `CI job ${artifact} ended ${job ? job.conclusion || job.status : 'missing'}`
          if (!allowUnsmoked) throw new Error(why)
          warnLoud(log, `${why}: going on (--mac-allow-unsmoked)`)
        }
        try { await gh(['run', 'download', id, '--repo', REPO, '-n', artifact, '-D', dir], { show: true }) } catch (err) { throw new Error(`could not download ${artifact}: ${err.message}`) }
        const built = checkArch({ fs, dir, version, arch, allowUnsmoked, log })
        const { file } = writeManifest('darwin', arch, {
          version, electron: built.electron, notes: notes.notes, notesEn: notes.notesEn, notesJa: notes.notesJa, date: notes.date,
          app: { file: built.app.file, sha256: built.app.sha256, size: built.app.size },
          full: { file: built.full.file, size: built.full.size },
        }, { dir: out, sign })
        const written = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (!verifyManifest(written, publicKey)) {
          fs.rmSync(file, { force: true })
          return failAll(`${manifestName('darwin', arch)} does not verify with the key installed apps hold: is ${signingKeyPath()} the release key?`)
        }
        ready.push({ arch, zips: [built.app.path, built.full.path], manifest: file })
      } catch (err) {
        failed.push({ arch, reason: err.message })
        log.error(`Mac ${arch}: ${err.message}`)
      }
    }
    if (!ready.length) return { ok: false, released, failed }

    // Zips first, manifests last: a manifest must never name a zip that is not there yet
    await gh(['release', 'upload', tag, '--repo', REPO, '--clobber', ...ready.flatMap(r => r.zips)], { show: true })
    await gh(['release', 'upload', tag, '--repo', REPO, '--clobber', ...ready.map(r => r.manifest)], { show: true })
    for (const r of ready) released.push(r.arch)
    log.log(`Mac: released ${released.join(', ')} to ${tag}`)
    return { ok: failed.length === 0, released, failed }
  } catch (err) {
    return failAll(err.message)
  }
}

/** What to tell the operator when the Mac part did not fully go out */
export function macFailureMessage(version, { released = [], failed = [] }, { windowsOut }) {
  const bar = '!'.repeat(72)
  return [
    bar,
    `  The Mac release of ${version} did not fully go out.`,
    ...failed.map(f => `  - ${f.arch}: ${f.reason}`),
    released.length ? `  Released for: ${released.join(', ')}` : '  Nothing was uploaded for the Macs.',
    windowsOut ? `  The Windows release v${version} is out and stays as it is.` : `  The Windows release v${version} was not touched.`,
    `  Retry the Mac part: node scripts/release.mjs --mac-only ${version}`,
    bar,
  ].join('\n')
}

/**
 * release.mjs's call: the Mac part with the real gh, git, key and file system.
 * Returns the exit code (0 when every arch went out).
 */
export async function runMacRelease({ root, version, notes = null, allowUnsmoked = false, windowsOut }) {
  console.log(`\n== spawn ${version} for Mac`)
  if (!nodeFs.existsSync(signingKeyPath())) {
    console.error(macFailureMessage(version, { failed: [{ arch: 'all', reason: `no signing key at ${signingKeyPath()}` }] }, { windowsOut }))
    return 1
  }
  const run = async (cmd, args, { show = false } = {}) => {
    const stdout = execFileSync(cmd, args, { cwd: root, encoding: 'utf8', shell: false, stdio: ['ignore', show ? 'inherit' : 'pipe', 'inherit'] })
    return (stdout ?? '').trim()
  }
  const result = await releaseMac(version, { run, root, notes, allowUnsmoked })
  if (result.ok) return 0
  console.error(`\n${macFailureMessage(version, result, { windowsOut })}\n`)
  return 1
}
