/**
 * release-mac.mjs — the Mac half of a release. Off unless asked for: run by
 * scripts/release.mjs after the Windows release is on GitHub only with
 * --publish --with-mac, or on its own with --mac-only for a release tag that
 * is already there:
 *
 *   node scripts/release.mjs --publish --with-mac
 *   node scripts/release.mjs --mac-only <version>
 *
 * Macs are built by CI (.github/workflows/mac.yml), never on this PC: the run is
 * started on the release's tag (v<version>), so a retry after main has moved on
 * still builds the release's commit; it is found by that commit (its head sha)
 * and waited for, and its two artifacts (mac-arm64, mac-x64:
 * scripts/mac-build.mjs) downloaded into release/mac/<v>/. A workflow runs from
 * the file at the ref it is started on, so for the first Mac release mac.yml
 * must already be on main at that tag. Each arch is checked here (both zips
 * there, the update zip's sha256 recomputed, the smoke launch passed: a failed
 * or missing smoke launch always fails that arch), then gets its own
 * latest-mac-<arch>.json (scripts/manifest.mjs) with the Windows release's
 * notes and date, signed with the local key (it never goes to CI) and verified
 * with the key installed apps hold. The zips go up first and the manifests
 * last, so a manifest never names a zip that is not there yet.
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
import { macArtifactNames, VERSION } from './mac-build.mjs'
import { signManifest, signingKeyPath } from './signing.mjs'

const { manifestName, verifyManifest, REPO } = createRequire(import.meta.url)('../electron/updater.cjs')

export const MAC_ARCHES = ['arm64', 'x64']
const WORKFLOW = 'mac.yml'
// How long the started run may take to show up in `gh run list`
const FIND_TRIES = 24
const FIND_EVERY_MS = 5000
// mac.yml's step that launches the built app
export const SMOKE_STEP = 'Smoke launch'

/**
 * What release.mjs's arguments ask for. A test build (no --publish) is
 * Windows only; --publish is Windows only too, exactly as before the Macs;
 * --publish --with-mac is Windows, then the Macs; --mac-only <v> is the Macs
 * alone, for the release v<v> already on GitHub.
 */
export function parseReleaseArgs(argv) {
  const at = argv.indexOf('--mac-only')
  let macOnly = null
  if (at >= 0) {
    macOnly = argv[at + 1] ?? ''
    if (!VERSION.test(macOnly)) throw new Error(`--mac-only needs the version of a published release (like 1.3.49), not "${macOnly}"`)
  }
  const publish = argv.includes('--publish')
  const withMac = argv.includes('--with-mac')
  if (withMac && !publish && !macOnly) throw new Error('--with-mac goes with --publish (a test build is Windows only)')
  return {
    windows: !macOnly,
    mac: !!macOnly || (publish && withMac),
    macOnly,
    publish,
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
 * parseReleaseArgs for release.mjs: a bad argument is one line on stderr and
 * exit code 1, not a stack trace.
 */
export function releaseArgsOrExit(argv, { exit = process.exit, error = console.error } = {}) {
  try { return parseReleaseArgs(argv) } catch (err) {
    error(err.message)
    return exit(1)
  }
}

/**
 * One arch's downloaded artifact, checked: returns what its manifest needs,
 * or throws the reason it cannot be released (a failed or missing smoke
 * launch among them).
 */
function checkArch({ fs, dir, version, arch }) {
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
    throw new Error(smoke ? `the smoke launch failed (${smoke.failure || 'not passed'})` : 'no smoke.json: the smoke launch did not report')
  }
  return {
    electron,
    app: { file: appZip, sha256: sha, size: fs.statSync(join(dir, appZip)).size, path: join(dir, appZip) },
    full: { file: fullZip, size: fs.statSync(join(dir, fullZip)).size, path: join(dir, fullZip) },
  }
}

/**
 * Release the Macs for v<version>. Every side effect comes in `deps`:
 *   run(cmd, args, { show })  gh and git; resolves to stdout, throws on a non-zero exit
 *   fs, sign(manifest), publicKey (the one manifests are verified with: the
 *   shipped one by default), log, sleep(ms), root (the repo), notes ({ notes,
 *   notesEn, notesJa, date } of the Windows manifest; null: read from the
 *   release's latest.json).
 * Resolves to { ok, released: [arch], failed: [{ arch, reason }], zipsUploaded:
 * [arch], manifestsRemoved: [arch] } (the last two say what is on the release
 * when it stopped half way); never throws.
 */
export async function releaseMac(version, deps = {}) {
  const {
    run, fs = nodeFs, sign = signManifest, publicKey, log = console, sleep = (ms) => new Promise(r => setTimeout(r, ms)),
    root, notes: givenNotes = null,
  } = deps
  const tag = `v${version}`
  const out = join(root, 'release', 'mac', version)
  const released = []
  const failed = []
  const zipsUploaded = []
  const manifestsRemoved = []
  const result = () => ({ ok: failed.length === 0, released, failed, zipsUploaded, manifestsRemoved })
  const failAll = (reason) => {
    for (const arch of MAC_ARCHES) if (!failed.some(f => f.arch === arch)) failed.push({ arch, reason })
    log.error(`Mac release of ${version}: ${reason}`)
    return result()
  }
  const gh = (args, opts) => run('gh', args, opts)

  try {
    // The release's tag must be there: CI runs on it, and its commit is the one to build
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

    // CI on the release's tag (not a branch, which may have moved on since); the run it
    // started is the new one in the list that builds the tag's commit
    const listArgs = ['run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,headSha,headBranch,event,createdAt']
    const before = new Set(JSON.parse(String(await gh(listArgs)) || '[]').map(r => r.databaseId))
    log.log(`Mac: starting ${WORKFLOW} on ${tag} for ${version}`)
    await gh(['workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', tag, '-f', `version=${version}`])
    let runInfo = null
    let others = []
    const sameSha = (r) => String(r.headSha).toLowerCase() === tagSha.toLowerCase()
    for (let i = 0; i < FIND_TRIES && !runInfo; i++) {
      await sleep(FIND_EVERY_MS)
      const runs = JSON.parse(String(await gh(listArgs)) || '[]').filter(r => !before.has(r.databaseId)).sort((a, b) => b.databaseId - a.databaseId)
      runInfo = runs.find(sameSha) ?? null
      others = runs.filter(r => !sameSha(r))
    }
    if (!runInfo) {
      // The head sha check: a new run that builds another commit is never taken for ours
      if (others.length) return failAll(`CI run ${others[0].databaseId} builds ${String(others[0].headSha).slice(0, 7)} but ${tag} is ${tagSha.slice(0, 7)}: no run of ${WORKFLOW} built the release's commit`)
      return failAll(`the ${WORKFLOW} run did not show up within ${(FIND_TRIES * FIND_EVERY_MS) / 1000} s`)
    }
    const id = String(runInfo.databaseId)
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
          const failedSteps = (job?.steps ?? []).filter(st => st.conclusion === 'failure').map(st => st.name)
          throw new Error(`CI job ${artifact} ended ${job ? job.conclusion || job.status : 'missing'}${failedSteps.length ? ` (failed: ${failedSteps.join(', ')})` : ''}`)
        }
        try { await gh(['run', 'download', id, '--repo', REPO, '-n', artifact, '-D', dir], { show: true }) } catch (err) { throw new Error(`could not download ${artifact}: ${err.message}`) }
        const built = checkArch({ fs, dir, version, arch })
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
    if (!ready.length) return result()

    // A retry rebuilds the zips and ditto's are not byte for byte the same: a manifest
    // already on the release would name a zip with another sha256 once it is replaced.
    // It goes first (no manifest only means no update offered); if it cannot go, nothing is replaced.
    let assets = []
    try { assets = (JSON.parse(String(await gh(['release', 'view', tag, '--repo', REPO, '--json', 'assets']))).assets ?? []).map(a => a.name) } catch (err) {
      return failAll(`could not list ${tag}'s assets: ${err.message}`)
    }
    for (const r of ready) {
      const name = manifestName('darwin', r.arch)
      if (!assets.includes(name)) continue
      try { await gh(['release', 'delete-asset', tag, name, '--repo', REPO, '--yes']) } catch (err) {
        return failAll(`could not remove the old ${name} before replacing its zips: ${err.message}`)
      }
      manifestsRemoved.push(r.arch)
    }

    // Zips first, manifests last: a manifest must never name a zip that is not there yet
    try { await gh(['release', 'upload', tag, '--repo', REPO, '--clobber', ...ready.flatMap(r => r.zips)], { show: true }) } catch (err) {
      return failAll(`the zip upload failed, so no manifest went up: ${err.message}`)
    }
    zipsUploaded.push(...ready.map(r => r.arch))
    try { await gh(['release', 'upload', tag, '--repo', REPO, '--clobber', ...ready.map(r => r.manifest)], { show: true }) } catch (err) {
      return failAll(`zips uploaded, manifests not: ${err.message}`)
    }
    for (const r of ready) released.push(r.arch)
    log.log(`Mac: released ${released.join(', ')} to ${tag}`)
    return result()
  } catch (err) {
    return failAll(err.message)
  }
}

/** What to tell the operator when the Mac part did not fully go out */
export function macFailureMessage(version, { released = [], failed = [], zipsUploaded = [], manifestsRemoved = [] }, { windowsOut }) {
  const bar = '!'.repeat(72)
  const zipsOnly = zipsUploaded.filter(a => !released.includes(a))
  const removedOnly = manifestsRemoved.filter(a => !released.includes(a) && !zipsUploaded.includes(a))
  const state = []
  if (released.length) state.push(`  Released for: ${released.join(', ')}`)
  if (zipsOnly.length) state.push(`  Zips uploaded for ${zipsOnly.join(', ')}, manifests not: those Macs are offered no update until the retry.`)
  if (removedOnly.length) state.push(`  The old manifest of ${removedOnly.join(', ')} was removed, its zips not replaced: those Macs are offered no update until the retry.`)
  if (!state.length) state.push('  Nothing was uploaded for the Macs.')
  return [
    bar,
    `  The Mac release of ${version} did not fully go out.`,
    ...failed.map(f => `  - ${f.arch}: ${f.reason}`),
    ...state,
    windowsOut ? `  The Windows release v${version} is out and stays as it is.` : `  The Windows release v${version} was not touched.`,
    `  Retry the Mac part: node scripts/release.mjs --mac-only ${version}`,
    bar,
  ].join('\n')
}

/**
 * release.mjs's call: the Mac part with the real gh, git, key and file system.
 * Returns the exit code (0 when every arch went out).
 */
export async function runMacRelease({ root, version, notes = null, windowsOut }) {
  console.log(`\n== spawn ${version} for Mac`)
  if (!nodeFs.existsSync(signingKeyPath())) {
    console.error(macFailureMessage(version, { failed: [{ arch: 'all', reason: `no signing key at ${signingKeyPath()}` }] }, { windowsOut }))
    return 1
  }
  const run = async (cmd, args, { show = false } = {}) => {
    const stdout = execFileSync(cmd, args, { cwd: root, encoding: 'utf8', shell: false, stdio: ['ignore', show ? 'inherit' : 'pipe', 'inherit'] })
    return (stdout ?? '').trim()
  }
  const result = await releaseMac(version, { run, root, notes })
  if (result.ok) return 0
  console.error(`\n${macFailureMessage(version, result, { windowsOut })}\n`)
  return 1
}
