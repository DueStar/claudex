/**
 * The Mac half of a release (scripts/release-mac.mjs): after the Windows
 * release is out, CI builds both Macs, the zips are checked here, each arch
 * gets its own signed latest-mac-<arch>.json, and all of it goes up to the
 * same GitHub release. Every side effect is a fake here: gh is never run.
 */

import { createHash, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without types
import { releaseMac, parseReleaseArgs, releaseArgsOrExit, macFailureMessage, SMOKE_STEP } from '../scripts/release-mac.mjs'
// @ts-expect-error plain ESM script without types
import { signManifest } from '../scripts/signing.mjs'

const require = createRequire(import.meta.url)
const { manifestName, appFilePattern, verifyManifest } = require('../electron/updater.cjs')

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const V = '9.9.9'
const SHA = 'c0ffee'.padEnd(40, '0')
const REPO = 'DueStar/spawn'
const NOTES = { notes: '- 한글 노트', notesEn: '- English notes', notesJa: '- 日本語', date: '2026-11-13T00:00:00.000Z' }
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

type Arch = 'arm64' | 'x64'
interface ArchSetup {
  missing?: boolean        // no artifact for this arch
  noAppZip?: boolean
  badSha?: boolean         // sha256.txt does not match the app zip
  smoke?: 'ok' | 'failed' | 'missing'
  job?: string             // the CI job's conclusion
  failedSteps?: string[]   // the job's steps that failed (mac.yml's names)
}

let root: string
let calls: string[][]
let logs: string[]
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'spawn-release-mac-')); calls = []; logs = [] })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** What CI's artifact for one arch holds (scripts/mac-build.mjs pack + smoke-mac.mjs) */
function writeArtifact(dir: string, arch: Arch, s: ArchSetup) {
  mkdirSync(join(dir, 'smoke'), { recursive: true })
  const appZip = `spawn-app-${V}-mac-${arch}.zip`
  const fullZip = `spawn-${V}-mac-${arch}.zip`
  const app = Buffer.from(`app zip ${arch}`)
  const full = Buffer.from(`full zip ${arch}`)
  if (!s.noAppZip) writeFileSync(join(dir, appZip), app)
  writeFileSync(join(dir, fullZip), full)
  writeFileSync(join(dir, 'sha256.txt'), `${s.badSha ? 'ab'.repeat(32) : hash(app)}  ${appZip}\n${hash(full)}  ${fullZip}\n`)
  writeFileSync(join(dir, 'electron-version.txt'), '33.4.11\n')
  const smoke = s.smoke ?? 'ok'
  if (smoke !== 'missing') writeFileSync(join(dir, 'smoke', 'smoke.json'), JSON.stringify({ ok: smoke === 'ok', done: true, arch, failure: smoke === 'ok' ? null : 'shell: no output' }))
}

/** A fake `run` that answers as gh and git would, and records every call */
function fakeRun(setup: Partial<Record<Arch, ArchSetup>> = {}, { headSha = SHA, watchFails = false, publishedNotes = NOTES, assets = [] as string[], failOn = (_a: string) => false, otherRun = false } = {}) {
  let lists = 0
  return async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args])
    const a = args.join(' ')
    if (cmd !== 'gh') throw new Error(`unexpected ${cmd} ${a}`)
    if (failOn(a)) throw new Error(`gh ${args[0]} ${args[1]} failed`)
    if (a.startsWith(`api repos/${REPO}/commits/v${V}`)) return SHA
    if (a.startsWith('run list')) {
      lists++
      const old = { databaseId: 100, headSha: 'old', headBranch: 'main', event: 'workflow_dispatch', createdAt: '2026-11-12T00:00:00Z' }
      // Someone else's run on main, started meanwhile: never taken for ours (another head sha)
      const other = { databaseId: 102, headSha: 'e'.repeat(40), headBranch: 'main', event: 'workflow_dispatch', createdAt: '2026-11-13T01:00:01Z' }
      // The new run shows up on the third look
      const mine = { databaseId: 101, headSha, headBranch: `v${V}`, event: 'workflow_dispatch', createdAt: '2026-11-13T01:00:00Z' }
      return JSON.stringify(lists >= 3 ? [...(otherRun ? [other] : []), mine, old] : [old])
    }
    if (a.startsWith('workflow run')) return ''
    if (a.startsWith('run watch')) { if (watchFails) throw new Error('exit 1'); return '' }
    if (a.startsWith('run view')) {
      return JSON.stringify({ jobs: (['arm64', 'x64'] as Arch[]).map(arch => {
        const s = setup[arch] ?? {}
        const bad = s.failedSteps ?? (s.smoke === 'failed' ? [SMOKE_STEP] : s.missing ? ['Package'] : [])
        const steps = ['Test', 'Package', SMOKE_STEP, 'Zip', 'Upload', 'Tests passed'].map(name => ({ name, conclusion: bad.includes(name) ? 'failure' : 'success' }))
        return { name: `mac-${arch}`, conclusion: s.job ?? (bad.length ? 'failure' : 'success'), steps }
      }) })
    }
    if (a.startsWith('release view')) return JSON.stringify({ assets: assets.map(name => ({ name })) })
    if (a.startsWith('release delete-asset')) return ''
    if (a.startsWith('run download')) {
      const name = args[args.indexOf('-n') + 1]
      const dir = args[args.indexOf('-D') + 1]
      const arch = name.replace('mac-', '') as Arch
      if (setup[arch]?.missing) throw new Error(`no artifact matches ${name}`)
      writeArtifact(dir, arch, setup[arch] ?? {})
      return ''
    }
    if (a.startsWith('release download')) {
      const dir = args[args.indexOf('--dir') + 1]
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'latest.json'), JSON.stringify({ version: V, electron: '33.4.11', ...publishedNotes, app: { file: `claudex-app-${V}.zip` } }))
      return ''
    }
    if (a.startsWith('release upload')) return ''
    throw new Error(`unexpected gh ${a}`)
  }
}

function deps(over: Record<string, unknown> = {}) {
  return {
    root,
    run: fakeRun(),
    sign: (m: object) => signManifest(m, pem),
    publicKey: pub,
    sleep: async () => {},
    log: { log: (m: string) => logs.push(m), warn: (m: string) => logs.push(`WARN ${m}`), error: (m: string) => logs.push(`ERROR ${m}`) },
    notes: NOTES,
    ...over,
  }
}

const gh = () => calls.filter(c => c[0] === 'gh').map(c => c.slice(1))
const uploads = () => gh().filter(c => c[0] === 'release' && c[1] === 'upload')
const outDir = () => join(root, 'release', 'mac', V)

describe('releaseMac', () => {
  it('runs CI on the release tag, finds the run by its commit, downloads both archs and uploads zips then manifests', async () => {
    const result = await releaseMac(V, deps())
    expect(result).toMatchObject({ ok: true, released: ['arm64', 'x64'], failed: [] })
    const seq = gh()
    const dir = outDir()
    // no git: the tag names what CI builds, whatever branch this PC is on
    expect(calls.some(c => c[0] === 'git')).toBe(false)
    const list = ['run', 'list', '--repo', REPO, '--workflow', 'mac.yml', '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,headSha,headBranch,event,createdAt']
    expect(seq).toEqual([
      ['api', `repos/${REPO}/commits/v${V}`, '--jq', '.sha'],
      list,
      ['workflow', 'run', 'mac.yml', '--repo', REPO, '--ref', `v${V}`, '-f', `version=${V}`],
      list,
      list,
      ['run', 'watch', '101', '--repo', REPO, '--exit-status'],
      ['run', 'view', '101', '--repo', REPO, '--json', 'jobs'],
      ['run', 'download', '101', '--repo', REPO, '-n', 'mac-arm64', '-D', join(dir, 'mac-arm64')],
      ['run', 'download', '101', '--repo', REPO, '-n', 'mac-x64', '-D', join(dir, 'mac-x64')],
      ['release', 'view', `v${V}`, '--repo', REPO, '--json', 'assets'],
      ['release', 'upload', `v${V}`, '--repo', REPO, '--clobber',
        join(dir, 'mac-arm64', `spawn-app-${V}-mac-arm64.zip`), join(dir, 'mac-arm64', `spawn-${V}-mac-arm64.zip`),
        join(dir, 'mac-x64', `spawn-app-${V}-mac-x64.zip`), join(dir, 'mac-x64', `spawn-${V}-mac-x64.zip`)],
      ['release', 'upload', `v${V}`, '--repo', REPO, '--clobber', join(dir, 'latest-mac-arm64.json'), join(dir, 'latest-mac-x64.json')],
    ])
  })

  it('writes manifests the app accepts: signed, named and pointing at its own zip', async () => {
    await releaseMac(V, deps())
    for (const arch of ['arm64', 'x64'] as Arch[]) {
      const file = join(outDir(), manifestName('darwin', arch))
      const m = JSON.parse(readFileSync(file, 'utf8'))
      expect(verifyManifest(m, pub)).toBe(true)
      expect(basename(file)).toBe(`latest-mac-${arch}.json`)
      const re = appFilePattern('darwin')
      expect(re.exec(m.app.file)?.[1]).toBe(arch)
      expect(m).toMatchObject({ version: V, electron: '33.4.11', ...NOTES, full: { file: `spawn-${V}-mac-${arch}.zip` } })
      expect(m.app.sha256).toBe(hash(`app zip ${arch}`))
      expect(m.app.size).toBe(Buffer.byteLength(`app zip ${arch}`))
      // Tampering breaks it, and so does another key
      expect(verifyManifest({ ...m, version: '9.9.10' }, pub)).toBe(false)
      expect(verifyManifest(m)).toBe(false)
    }
  })

  it('uploads every zip before any manifest', async () => {
    await releaseMac(V, deps())
    const up = uploads()
    expect(up).toHaveLength(2)
    expect(up[0].slice(6).every((f: string) => f.endsWith('.zip'))).toBe(true)
    expect(up[1].slice(6).every((f: string) => f.endsWith('.json'))).toBe(true)
  })

  it('a manifest that does not verify with the shipped key stops everything before the upload', async () => {
    const result = await releaseMac(V, deps({ publicKey: undefined }))
    expect(result.ok).toBe(false)
    expect(uploads()).toEqual([])
  })

  it('a sha256 mismatch fails that arch before any upload', async () => {
    const both = await releaseMac(V, deps({ run: fakeRun({ arm64: { badSha: true }, x64: { badSha: true } }) }))
    expect(both).toMatchObject({ ok: false, released: [] })
    expect(both.failed.map((f: { arch: string }) => f.arch)).toEqual(['arm64', 'x64'])
    expect(both.failed[0].reason).toMatch(/sha256/)
    expect(uploads()).toEqual([])
  })

  it('one bad arch: the other is still released, and the result is a failure', async () => {
    const result = await releaseMac(V, deps({ run: fakeRun({ arm64: { badSha: true } }) }))
    expect(result).toMatchObject({ ok: false, released: ['x64'] })
    expect(result.failed).toHaveLength(1)
    const up = uploads()
    expect(up).toHaveLength(2)
    expect(up.flat().join(' ')).not.toMatch(/arm64/)
    expect(up[1].slice(6)).toEqual([join(outDir(), 'latest-mac-x64.json')])
    expect(existsSync(join(outDir(), 'latest-mac-arm64.json'))).toBe(false)
  })

  it('a missing artifact or zip fails that arch only', async () => {
    const a = await releaseMac(V, deps({ run: fakeRun({ x64: { missing: true } }) }))
    expect(a).toMatchObject({ ok: false, released: ['arm64'] })
    calls = []
    const b = await releaseMac(V, deps({ run: fakeRun({ arm64: { noAppZip: true } }) }))
    expect(b).toMatchObject({ ok: false, released: ['x64'] })
    expect(b.failed[0].reason).toMatch(new RegExp(`spawn-app-${V}-mac-arm64\\.zip`))
  })

  it('a failed or missing smoke run fails the arch', async () => {
    const failed = await releaseMac(V, deps({ run: fakeRun({ arm64: { smoke: 'failed', job: 'success' } }) }))
    expect(failed).toMatchObject({ ok: false, released: ['x64'] })
    expect(failed.failed[0].reason).toMatch(/smoke/)
    calls = []
    const missing = await releaseMac(V, deps({ run: fakeRun({ x64: { smoke: 'missing' } }) }))
    expect(missing).toMatchObject({ ok: false, released: ['arm64'] })
  })

  it('a failed smoke step, a failed test gate or a cancelled job fails that arch: there is no override', async () => {
    const smoke = await releaseMac(V, deps({ run: fakeRun({ arm64: { smoke: 'failed' } }, { watchFails: true }), allowUnsmoked: true }))
    expect(smoke).toMatchObject({ ok: false, released: ['x64'] })
    expect(smoke.failed[0].reason).toMatch(new RegExp(SMOKE_STEP))
    calls = []
    const tests = await releaseMac(V, deps({ run: fakeRun({ arm64: { failedSteps: ['Tests passed'] } }, { watchFails: true }) }))
    expect(tests).toMatchObject({ ok: false, released: ['x64'] })
    expect(tests.failed[0].reason).toMatch(/Tests passed/)
    calls = []
    const cancelled = await releaseMac(V, deps({ run: fakeRun({ x64: { job: 'cancelled' } }) }))
    expect(cancelled).toMatchObject({ ok: false, released: ['arm64'] })
  })

  it('--mac-allow-unsmoked is gone from the scripts', () => {
    for (const f of ['release-mac.mjs', 'release.mjs']) expect(readFileSync(join(__dirname, '..', 'scripts', f), 'utf8')).not.toMatch(/allow-unsmoked|allowUnsmoked/)
  })

  it("the smoke step's name is mac.yml's", () => {
    const yaml = require('js-yaml')
    const wf = yaml.load(readFileSync(join(__dirname, '..', '.github', 'workflows', 'mac.yml'), 'utf8'))
    expect(wf.jobs.build.steps.map((st: { name?: string }) => st.name)).toContain(SMOKE_STEP)
  })

  it('a retry removes the manifests already on the release before replacing their zips', async () => {
    const assets = [`spawn-app-${V}-mac-arm64.zip`, 'latest-mac-arm64.json', 'latest-mac-x64.json', 'latest.json']
    const result = await releaseMac(V, deps({ run: fakeRun({}, { assets }) }))
    expect(result.ok).toBe(true)
    const seq = gh().map(c => c.slice(0, 2).join(' '))
    expect(gh().filter(c => c[1] === 'delete-asset')).toEqual([
      ['release', 'delete-asset', `v${V}`, 'latest-mac-arm64.json', '--repo', REPO, '--yes'],
      ['release', 'delete-asset', `v${V}`, 'latest-mac-x64.json', '--repo', REPO, '--yes'],
    ])
    expect(seq.lastIndexOf('release delete-asset')).toBeLessThan(seq.indexOf('release upload'))
    // Windows' latest.json is never touched
    expect(gh().flat()).not.toContain('latest.json')
  })

  it('only the manifests of the arches going out are removed', async () => {
    await releaseMac(V, deps({ run: fakeRun({ x64: { badSha: true } }, { assets: ['latest-mac-arm64.json', 'latest-mac-x64.json'] }) }))
    expect(gh().filter(c => c[1] === 'delete-asset').map(c => c[3])).toEqual(['latest-mac-arm64.json'])
  })

  it('a first release has no manifest to remove', async () => {
    await releaseMac(V, deps())
    expect(gh().some(c => c[1] === 'delete-asset')).toBe(false)
  })

  it('an old manifest that cannot be removed: no zip is replaced', async () => {
    const result = await releaseMac(V, deps({ run: fakeRun({}, { assets: ['latest-mac-arm64.json'], failOn: (a: string) => a.startsWith('release delete-asset') }) }))
    expect(result.ok).toBe(false)
    expect(uploads()).toEqual([])
  })

  it('the zip upload fails: no manifest goes up', async () => {
    const result = await releaseMac(V, deps({ run: fakeRun({}, { failOn: (a: string) => a.startsWith('release upload') && a.includes('.zip') }) }))
    expect(result).toMatchObject({ ok: false, released: [], zipsUploaded: [] })
    expect(uploads().filter(c => c.some((x: string) => x.endsWith('.json')))).toEqual([])
    expect(macFailureMessage(V, result, { windowsOut: true })).toContain('Nothing was uploaded for the Macs.')
  })

  it('the manifest upload fails after the zips: the message says the zips are up', async () => {
    const result = await releaseMac(V, deps({ run: fakeRun({}, { failOn: (a: string) => a.startsWith('release upload') && a.includes('.json') }) }))
    expect(result).toMatchObject({ ok: false, released: [], zipsUploaded: ['arm64', 'x64'] })
    const msg = macFailureMessage(V, result, { windowsOut: true })
    expect(msg).toMatch(/Zips uploaded for arm64, x64, manifests not/)
    expect(msg).not.toContain('Nothing was uploaded')
    expect(msg).toContain(`node scripts/release.mjs --mac-only ${V}`)
  })

  it('old manifests removed but nothing replaced: the message says so', () => {
    const msg = macFailureMessage(V, { released: [], failed: [{ arch: 'arm64', reason: 'x' }], zipsUploaded: [], manifestsRemoved: ['arm64'] }, { windowsOut: false })
    expect(msg).toMatch(/old manifest of arm64 was removed/)
    expect(msg).not.toContain('Nothing was uploaded')
  })

  it('a failed CI job fails its arch even with the zips there', async () => {
    const result = await releaseMac(V, deps({ run: fakeRun({ x64: { job: 'failure' } }, { watchFails: true }) }))
    expect(result).toMatchObject({ ok: false, released: ['arm64'] })
    expect(result.failed[0]).toMatchObject({ arch: 'x64' })
  })

  it('CI built another commit than the release tag: nothing is uploaded', async () => {
    const result = await releaseMac(V, deps({ run: fakeRun({}, { headSha: 'f'.repeat(40) }) }))
    expect(result.ok).toBe(false)
    expect(result.failed[0].reason).toMatch(/builds fffffff but v9\.9\.9 is c0ffee0/)
    expect(uploads()).toEqual([])
    expect(gh().some(c => c[0] === 'run' && c[1] === 'download')).toBe(false)
  })

  it("another run started meanwhile (newer, another commit) is not taken for the release's", async () => {
    const result = await releaseMac(V, deps({ run: fakeRun({}, { otherRun: true }) }))
    expect(result.ok).toBe(true)
    expect(gh().find(c => c[1] === 'watch')).toEqual(['run', 'watch', '101', '--repo', REPO, '--exit-status'])
  })

  it('gives up when the triggered run never shows up', async () => {
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      if (args[0] === 'api') return SHA
      if (args[0] === 'run' && args[1] === 'list') return '[]'
      return ''
    }
    const result = await releaseMac(V, deps({ run }))
    expect(result.ok).toBe(false)
    expect(gh().filter(c => c[1] === 'list').length).toBeGreaterThan(2)
    expect(gh().some(c => c[1] === 'watch')).toBe(false)
  })

  it('without notes given (--mac-only), takes them from the published latest.json', async () => {
    const published = { notes: '- 게시된 노트', notesEn: '- published', notesJa: '- 公開', date: '2026-11-01T00:00:00.000Z' }
    const result = await releaseMac(V, deps({ notes: null, run: fakeRun({}, { publishedNotes: published }) }))
    expect(result.ok).toBe(true)
    expect(gh()[1]).toEqual(['release', 'download', `v${V}`, '--repo', REPO, '--pattern', 'latest.json', '--dir', join(outDir(), 'windows'), '--clobber'])
    const m = JSON.parse(readFileSync(join(outDir(), 'latest-mac-arm64.json'), 'utf8'))
    expect(m).toMatchObject(published)
  })

  it('cleans the download folder first', async () => {
    mkdirSync(join(outDir(), 'mac-arm64'), { recursive: true })
    writeFileSync(join(outDir(), 'mac-arm64', 'stale.zip'), 'old')
    await releaseMac(V, deps())
    expect(existsSync(join(outDir(), 'mac-arm64', 'stale.zip'))).toBe(false)
  })
})

describe('parseReleaseArgs', () => {
  it('a test build (no --publish) is Windows only', () => {
    expect(parseReleaseArgs([])).toMatchObject({ windows: true, mac: false, macOnly: null })
    expect(parseReleaseArgs(['some notes'])).toMatchObject({ windows: true, mac: false })
  })

  it('--publish alone is the Windows release exactly as before: no Macs', () => {
    expect(parseReleaseArgs(['--publish'])).toEqual({ windows: true, mac: false, macOnly: null, publish: true })
    expect(parseReleaseArgs(['notes', '--publish'])).toMatchObject({ windows: true, mac: false })
  })

  it('--publish --with-mac releases Windows, then the Macs', () => {
    expect(parseReleaseArgs(['--publish', '--with-mac'])).toEqual({ windows: true, mac: true, macOnly: null, publish: true })
    expect(parseReleaseArgs(['notes', '--with-mac', '--publish'])).toMatchObject({ windows: true, mac: true })
  })

  it('--with-mac without --publish is an error (a test build is Windows only)', () => {
    expect(() => parseReleaseArgs(['--with-mac'])).toThrow(/--with-mac goes with --publish/)
  })

  it('--mac-only <version> skips every Windows step', () => {
    expect(parseReleaseArgs(['--mac-only', '1.3.49'])).toMatchObject({ windows: false, mac: true, macOnly: '1.3.49' })
  })

  it('release.mjs starts the Mac part after --publish only when asked (cli.mac)', () => {
    const src = readFileSync(join(__dirname, '..', 'scripts', 'release.mjs'), 'utf8')
    const calls = src.split('runMacRelease(').length - 1
    expect(calls).toBe(2) // --mac-only, and after the Windows release
    expect(src).toMatch(/if \(cli\.mac\) \{\n\s+const macCode = await runMacRelease\(/)
  })

  it('--mac-only needs a version', () => {
    expect(() => parseReleaseArgs(['--mac-only'])).toThrow(/version/)
    expect(() => parseReleaseArgs(['--mac-only', 'v1.3.49'])).toThrow(/version/)
    expect(() => parseReleaseArgs(['--mac-only', '--publish'])).toThrow(/version/)
  })
})

describe('releaseArgsOrExit', () => {
  it('a bad --mac-only value is one line and exit code 1', () => {
    const errors: string[] = []
    const codes: number[] = []
    releaseArgsOrExit(['--mac-only', 'latest'], { error: (m: string) => errors.push(m), exit: (c: number) => { codes.push(c) } })
    expect(codes).toEqual([1])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/--mac-only needs the version/)
    expect(errors[0]).not.toContain('\n')
  })

  it('good arguments pass through', () => {
    expect(releaseArgsOrExit(['--publish'], { exit: () => { throw new Error('no exit') } })).toMatchObject({ mac: false })
    expect(releaseArgsOrExit(['--publish', '--with-mac'], { exit: () => { throw new Error('no exit') } })).toMatchObject({ mac: true })
  })
})

describe('macFailureMessage', () => {
  it('says the Windows release is out and how to retry the Mac part', () => {
    const msg = macFailureMessage('1.3.49', { released: ['x64'], failed: [{ arch: 'arm64', reason: 'sha256 mismatch' }] }, { windowsOut: true })
    expect(msg).toMatch(/Windows release v1\.3\.49 is out/)
    expect(msg).toContain('node scripts/release.mjs --mac-only 1.3.49')
    expect(msg).toMatch(/arm64.*sha256 mismatch/)
    expect(msg).toMatch(/x64/)
  })
})
