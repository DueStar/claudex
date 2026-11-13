/**
 * The Mac build (package.json build.mac, scripts/mac-build.mjs) and its CI
 * (.github/workflows/mac.yml): the names the zips go by (the Mac updater
 * takes only spawn-app-<v>-mac-<arch>.zip), where electron-builder leaves
 * spawn.app, the node-pty helper that must stay executable, and a Windows
 * build left exactly as it was.
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without types
import { macArtifactNames, findMacApps, pickMacApp, appDirOf, spawnHelperProblems, sha256Lines, smokeKillMs } from '../scripts/mac-build.mjs'

const require = createRequire(import.meta.url)
const { appFilePattern } = require('../electron/updater.cjs')
const yaml = require('js-yaml')
const ROOT = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

describe('artifact names', () => {
  it('per arch: the update zip, the full zip and the CI artifact', () => {
    expect(macArtifactNames('1.3.48', 'arm64')).toEqual({ artifact: 'mac-arm64', appZip: 'spawn-app-1.3.48-mac-arm64.zip', fullZip: 'spawn-1.3.48-mac-arm64.zip' })
    expect(macArtifactNames('0.0.0-test', 'x64')).toEqual({ artifact: 'mac-x64', appZip: 'spawn-app-0.0.0-test-mac-x64.zip', fullZip: 'spawn-0.0.0-test-mac-x64.zip' })
  })

  it('the update zip is one the Mac updater takes, for its own arch', () => {
    for (const arch of ['arm64', 'x64']) {
      const m = appFilePattern('darwin').exec(macArtifactNames('1.3.48', arch).appZip)
      expect(m?.[1]).toBe(arch)
    }
  })

  it('only arm64 and x64, and a version that is a version', () => {
    expect(() => macArtifactNames('1.3.48', 'ia32')).toThrow()
    expect(() => macArtifactNames('', 'arm64')).toThrow()
    expect(() => macArtifactNames('1.3.48/../x', 'arm64')).toThrow()
  })

  it('sha256.txt: one "<hash>  <file>" line per file', () => {
    expect(sha256Lines({ 'a.zip': 'ab12', 'b.zip': 'cd34' })).toBe('ab12  a.zip\ncd34  b.zip\n')
  })
})

describe("the smoke launch's kill time", () => {
  it("follows the app's own timeout: it plus the quit cap plus a margin, so the app always says why first", () => {
    // default: 60 s run + 20 s quit + 10 s = 90 s
    expect(smokeKillMs({})).toBe(90_000)
    expect(smokeKillMs({ SPAWN_SMOKE_TIMEOUT_MS: '120000' })).toBe(150_000)
    // what the app would not take as a timeout, the kill does not take either
    for (const bad of ['', 'abc', '-5', '0', 'Infinity']) expect(smokeKillMs({ SPAWN_SMOKE_TIMEOUT_MS: bad })).toBe(90_000)
  })
})

describe('the built app', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'spawn-mac-build-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const makeApp = (folder: string) => {
    const app = join(dir, folder, 'spawn.app')
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    return app
  }

  it('finds spawn.app in release/mac (x64) and release/mac-arm64, and picks the one for the arch', () => {
    const x64 = makeApp('mac')
    const arm = makeApp('mac-arm64')
    makeApp('win-unpacked') // not a Mac folder
    expect(findMacApps(dir).sort()).toEqual([x64, arm].sort())
    expect(pickMacApp(dir, 'arm64')).toBe(arm)
    expect(pickMacApp(dir, 'x64')).toBe(x64)
    expect(pickMacApp(join(dir, 'nothing'), 'arm64')).toBe(null)
  })

  it('the app folder inside the bundle (what the update zip holds)', () => {
    expect(appDirOf('/r/mac-arm64/spawn.app').replace(/\\/g, '/')).toBe('/r/mac-arm64/spawn.app/Contents/Resources/app')
  })

  it('spawn-helper: missing is a problem', () => {
    const app = makeApp('mac-arm64')
    expect(spawnHelperProblems(app).join(' ')).toMatch(/no node-pty darwin prebuilds/)
    const pre = join(appDirOf(app), 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64')
    mkdirSync(pre, { recursive: true })
    expect(spawnHelperProblems(app).join(' ')).toMatch(/spawn-helper missing/)
  })

  it.skipIf(process.platform === 'win32')('spawn-helper: present but not executable is a problem; executable passes', () => {
    const app = makeApp('mac-arm64')
    const pre = join(appDirOf(app), 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64')
    mkdirSync(pre, { recursive: true })
    const helper = join(pre, 'spawn-helper')
    writeFileSync(helper, '')
    chmodSync(helper, 0o644)
    expect(spawnHelperProblems(app).join(' ')).toMatch(/not executable/)
    chmodSync(helper, 0o755)
    expect(spawnHelperProblems(app)).toEqual([])
  })
})

describe('package.json build', () => {
  it('mac: a dir build, the icns, ad-hoc (no identity), no hardened runtime', () => {
    expect(pkg.build.mac).toMatchObject({
      target: ['dir'],
      icon: 'build/icon.icns',
      category: 'public.app-category.developer-tools',
      identity: null,
      hardenedRuntime: false,
    })
  })

  it('mac leaves out the Windows node-pty binaries (prebuilds and conpty)', () => {
    expect(pkg.build.mac.files).toEqual(expect.arrayContaining(['!node_modules/node-pty/prebuilds/win32-*/**', '!node_modules/node-pty/third_party/conpty/**']))
    for (const p of pkg.build.mac.files) expect(p.startsWith('!')).toBe(true)
  })

  it('Windows is as it was: its block, the shared files list, the output folder', () => {
    expect(pkg.build.win).toEqual({ icon: 'build/icon.ico', target: ['dir'] })
    expect(pkg.build.files).toEqual(['dist/**', 'electron/**', 'server/**', 'hooks/**', '!dist/sprites/pokemon/**'])
    expect(pkg.build.directories).toEqual({ output: 'release', buildResources: 'build' })
    expect(pkg.build.asar).toBe(false)
    expect(pkg.build.npmRebuild).toBe(false)
  })
})

describe('workflows', () => {
  const mac = yaml.load(readFileSync(join(ROOT, '.github', 'workflows', 'mac.yml'), 'utf8'))
  const ci = yaml.load(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'))

  it('mac.yml: on a push to mac-port, and by hand with a version', () => {
    expect(mac.on.push.branches).toEqual(['mac-port'])
    expect(mac.on.workflow_dispatch.inputs.version).toBeTruthy()
  })

  it('mac.yml: arm64 on macos-14, x64 on macos-15-intel (macOS 13 images are retired), neither stops the other', () => {
    const job = mac.jobs.build
    expect(job.strategy['fail-fast']).toBe(false)
    expect(job.strategy.matrix.include).toEqual(expect.arrayContaining([
      expect.objectContaining({ arch: 'arm64', runner: 'macos-14' }),
      expect.objectContaining({ arch: 'x64', runner: 'macos-15-intel' }),
    ]))
    expect(job['runs-on']).toBe('${{ matrix.runner }}')
  })

  it('mac.yml: build, ad-hoc sign, smoke, zip; the smoke pictures uploaded even when it fails', () => {
    const steps = mac.jobs.build.steps as Array<{ name?: string, run?: string, if?: string, uses?: string, with?: Record<string, string>, env?: Record<string, string> }>
    const runs = steps.map(s => s.run ?? '').join('\n')
    expect(runs).toMatch(/npx vitest run/)
    expect(runs).toMatch(/npx tsc --noEmit -p \./)
    expect(runs).toMatch(/npx vite build/)
    expect(runs).toMatch(/electron-builder --mac dir --\$\{\{ matrix\.arch \}\}/)
    expect(runs).toMatch(/codesign --force --deep --sign - /)
    expect(runs).toMatch(/codesign --verify --deep --strict/)
    expect(runs).toMatch(/node scripts\/smoke-mac\.mjs/)
    expect(runs).toMatch(/node scripts\/mac-build\.mjs pack/)
    // the Electron binary is needed here (the smoke launch), unlike ci.yml
    for (const s of steps) expect(s.env?.ELECTRON_SKIP_BINARY_DOWNLOAD).toBeUndefined()
    // one artifact per arch, uploaded even when a step failed: the smoke folder is inside it
    const uploads = steps.filter(s => String(s.uses ?? '').startsWith('actions/upload-artifact'))
    expect(uploads).toEqual([expect.objectContaining({ if: 'always()', with: expect.objectContaining({ name: 'mac-${{ matrix.arch }}', path: 'release/upload' }) })])
    const smokeStep = steps.find(s => String(s.run ?? '').includes('smoke-mac.mjs'))
    expect(smokeStep?.env?.SPAWN_SMOKE_DIR).toBe('${{ github.workspace }}/release/upload/smoke')
    // a failed test still fails the job, after the build and the smoke launch
    const test = steps.find(s => s.run === 'npx vitest run') as { id?: string, 'continue-on-error'?: boolean }
    expect(test['continue-on-error']).toBe(true)
    expect(steps.at(-1)?.if).toBe(`always() && steps.${test.id}.outcome == 'failure'`)
  })

  it('ci.yml: macOS joins the test matrix; its triggers are as they were', () => {
    expect(ci.jobs.test.strategy.matrix.os).toEqual(['windows-latest', 'ubuntu-latest', 'macos-latest'])
    expect(ci.on).toEqual({ push: { branches: ['main'] }, pull_request: null })
  })

  it('ci.yml: the page is built before the tests (tests/dist-check.test.ts checks dist/)', () => {
    const runs = (ci.jobs.test.steps as Array<{ run?: string }>).map(s => s.run ?? '')
    const build = runs.findIndex(r => r.includes('npx vite build'))
    const test = runs.findIndex(r => r === 'npm test')
    expect(build).toBeGreaterThanOrEqual(0)
    expect(test).toBeGreaterThan(build)
  })
})
