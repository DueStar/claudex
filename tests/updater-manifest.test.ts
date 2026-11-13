/**
 * One update manifest per platform and arch (electron/updater.cjs,
 * scripts/manifest.mjs): Windows keeps latest.json and its zip names exactly
 * as they were; a Mac reads latest-mac-<arch>.json and only its own zip.
 */
import { generateKeyPairSync } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain ESM script without types
import { writeManifest } from '../scripts/manifest.mjs'
// @ts-expect-error plain ESM script without types
import { signManifest } from '../scripts/signing.mjs'

const require = createRequire(import.meta.url)
const { manifestName, appFilePattern, createUpdater, verifyManifest, localUpdateDir } = require('../electron/updater.cjs')

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cx-manifest-')) })
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })

describe('manifestName', () => {
  it('is latest.json on Windows, whatever the arch', () => {
    expect(manifestName('win32', 'x64')).toBe('latest.json')
    expect(manifestName('win32', 'arm64')).toBe('latest.json')
  })

  it('is one per arch on a Mac', () => {
    expect(manifestName('darwin', 'arm64')).toBe('latest-mac-arm64.json')
    expect(manifestName('darwin', 'x64')).toBe('latest-mac-x64.json')
  })

  it('defaults to this process', () => {
    expect(manifestName()).toBe(manifestName(process.platform, process.arch))
  })
})

describe('appFilePattern', () => {
  it('is the Windows rule, unchanged', () => {
    expect(appFilePattern('win32').source).toBe(/^(spawn|claudex)-app-[\w.-]+\.zip$/.source)
    expect(appFilePattern('win32').test('claudex-app-1.3.48.zip')).toBe(true)
    expect(appFilePattern('win32').test('spawn-app-1.3.48.zip')).toBe(true)
    // The Windows rule stays as installed apps have it, and it would match a Mac name too
    // ([\w.-]+ takes "1.3.49-mac-arm64"): what keeps a Mac zip away from Windows is
    // latest.json, and writeManifest never puts one there (below)
    expect(appFilePattern('win32').test('spawn-app-1.3.49-mac-arm64.zip')).toBe(true)
  })

  it('takes only a Mac app zip on a Mac', () => {
    expect(appFilePattern('darwin').test('spawn-app-1.3.49-mac-arm64.zip')).toBe(true)
    expect(appFilePattern('darwin').test('spawn-app-1.3.49-mac-x64.zip')).toBe(true)
    expect(appFilePattern('darwin').test('claudex-app-1.3.48.zip')).toBe(false)
    expect(appFilePattern('darwin').test('spawn-app-1.3.48.zip')).toBe(false)
    expect(appFilePattern('darwin').test('spawn-app-1.3.49-mac-ia32.zip')).toBe(false)
  })
})

function fakeApp() {
  return { getVersion: () => '1.0.0', getAppPath: () => join(root, 'no-app'), getPath: () => join(root, 'userData'), relaunch: vi.fn(), quit: vi.fn() }
}

describe('check', () => {
  const seenFor = async (platform: string, arch: string) => {
    const seen: string[] = []
    const fetch = async (url: string) => { seen.push(url); throw new Error('offline') }
    const updater = createUpdater({ app: fakeApp(), send: () => {}, isPackaged: true, platform, arch, fetch, localDir: () => null })
    await updater.check()
    return seen[0]
  }

  it("asks the release for this platform's manifest", async () => {
    expect(await seenFor('win32', 'x64')).toBe('https://github.com/DueStar/spawn/releases/latest/download/latest.json')
    expect(await seenFor('darwin', 'arm64')).toBe('https://github.com/DueStar/spawn/releases/latest/download/latest-mac-arm64.json')
    expect(await seenFor('darwin', 'x64')).toBe('https://github.com/DueStar/spawn/releases/latest/download/latest-mac-x64.json')
  })

  it("the local update folder serves this platform's manifest too", () => {
    vi.stubEnv('SPAWN_UPDATE_DIR', '')
    vi.stubEnv('SPAWN_HOME', join(root, 'home'))
    mkdirSync(join(root, 'home'))
    const dir = join(root, 'release'); mkdirSync(dir)
    writeFileSync(join(root, 'home', 'update-dir'), dir)
    writeFileSync(join(dir, 'latest.json'), '{}')
    expect(localUpdateDir('latest.json')).toBe(dir)
    expect(localUpdateDir('latest-mac-arm64.json')).toBe(null)
    writeFileSync(join(dir, 'latest-mac-arm64.json'), '{}')
    expect(localUpdateDir('latest-mac-arm64.json')).toBe(dir)
  })

  it('reads the Mac manifest from the local folder on a Mac', async () => {
    const dir = join(root, 'release'); mkdirSync(dir)
    writeFileSync(join(dir, 'latest.json'), JSON.stringify({ version: '8.0.0' }))
    writeFileSync(join(dir, 'latest-mac-arm64.json'), JSON.stringify({ version: '9.0.0' }))
    const asked: string[] = []
    const updater = createUpdater({ app: fakeApp(), send: () => {}, isPackaged: true, platform: 'darwin', arch: 'arm64', localDir: (name: string) => { asked.push(name); return dir } })
    const st = await updater.check()
    expect(asked[0]).toBe('latest-mac-arm64.json')
    expect(st).toMatchObject({ status: 'available', latest: '9.0.0' })
  })
})

/** A local folder holding one manifest and its app zip */
function localRelease(name: string, appFile: string) {
  const dir = join(root, 'release'); mkdirSync(dir, { recursive: true })
  const zip = Buffer.from('zip bytes')
  writeFileSync(join(dir, appFile), zip)
  writeFileSync(join(dir, name), JSON.stringify({ version: '9.9.9', app: { file: appFile, sha256: createHash('sha256').update(zip).digest('hex'), size: zip.length } }))
  return dir
}

describe('install on Windows (pinned: Windows must not change)', () => {
  it("unpacks claudex-app-<v>.zip with Windows' own tar.exe", async () => {
    const dir = localRelease('latest.json', 'claudex-app-9.9.9.zip')
    const spawn = vi.fn((_cmd: string, args: string[]) => {
      const child = new EventEmitter()
      writeFileSync(join(args[3], 'package.json'), '{}')
      setTimeout(() => child.emit('exit', 0), 0)
      return child
    })
    const updater = createUpdater({ app: fakeApp(), send: () => {}, isPackaged: true, platform: 'win32', arch: 'x64', localDir: () => dir, spawn })
    await updater.check()
    const st = await updater.install()
    expect(st).toMatchObject({ status: 'ready', error: null })
    const [cmd, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], object]
    expect(cmd).toBe(join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'))
    expect(args[0]).toBe('-xf')
    expect(args[1].endsWith('claudex-app-9.9.9.zip')).toBe(true)
    expect(args[2]).toBe('-C')
    expect(opts).toEqual({ windowsHide: true })
    rmSync(join(args[3], '..'), { recursive: true, force: true })
  })
})

describe('install on a Mac takes only a Mac zip', () => {
  it('refuses the Windows zip', async () => {
    const dir = localRelease('latest-mac-arm64.json', 'claudex-app-9.9.9.zip')
    const spawn = vi.fn()
    const updater = createUpdater({ app: fakeApp(), send: () => {}, isPackaged: true, platform: 'darwin', arch: 'arm64', localDir: () => dir, spawn })
    await updater.check()
    expect(await updater.install()).toMatchObject({ status: 'available', error: 'bad manifest' })
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('writeManifest (scripts/manifest.mjs)', () => {
  const fields = {
    version: '9.9.9', electron: '33.4.11', notes: '- 노트', notesEn: '- notes', notesJa: '- ノート', date: '2026-11-13T00:00:00.000Z',
    app: { file: 'claudex-app-9.9.9.zip', sha256: 'ab'.repeat(32), size: 123 },
    full: { file: 'spawn-9.9.9-win-x64.zip', size: 456 },
  }

  it('writes latest.json for Windows, byte for byte as release.mjs always has', () => {
    // the fields in another order: the file keeps the one order every installed app has read
    const shuffled = { full: fields.full, app: fields.app, date: fields.date, notesJa: fields.notesJa, notesEn: fields.notesEn, notes: fields.notes, electron: fields.electron, version: fields.version }
    const out = writeManifest('win32', 'x64', shuffled, { dir: root })
    expect(out.file).toBe(join(root, 'latest.json'))
    expect(readFileSync(out.file, 'utf8')).toBe(JSON.stringify(fields, null, 2))
  })

  it('writes latest-mac-<arch>.json for a Mac', () => {
    const mac = { ...fields, app: { file: 'spawn-app-9.9.9-mac-arm64.zip', sha256: 'cd'.repeat(32) }, full: { file: 'spawn-9.9.9-mac-arm64.zip' } }
    expect(writeManifest('darwin', 'arm64', mac, { dir: root }).file).toBe(join(root, 'latest-mac-arm64.json'))
    const x64 = { ...mac, app: { ...mac.app, file: 'spawn-app-9.9.9-mac-x64.zip' } }
    expect(writeManifest('darwin', 'x64', x64, { dir: root }).file).toBe(join(root, 'latest-mac-x64.json'))
    expect(JSON.parse(readFileSync(join(root, 'latest-mac-arm64.json'), 'utf8'))).toEqual(mac)
  })

  it("never names another platform's zip (a Mac zip in latest.json would reach Windows)", () => {
    expect(() => writeManifest('win32', 'x64', { ...fields, app: { ...fields.app, file: 'spawn-app-9.9.9-mac-arm64.zip' } }, { dir: root })).toThrow(/latest\.json/)
    expect(() => writeManifest('darwin', 'arm64', fields, { dir: root })).toThrow(/latest-mac-arm64\.json/)
    expect(() => writeManifest('darwin', 'arm64', { ...fields, app: { ...fields.app, file: 'spawn-app-9.9.9-mac-x64.zip' } }, { dir: root })).toThrow(/latest-mac-arm64\.json/)
    expect(readdirSync(root)).toEqual([])
  })

  it('signs with the given signer, and the app verifies what it wrote', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const out = writeManifest('darwin', 'arm64', { ...fields, app: { ...fields.app, file: 'spawn-app-9.9.9-mac-arm64.zip' } }, { dir: root, sign: (m: object) => signManifest(m, pem) })
    expect(verifyManifest(JSON.parse(readFileSync(out.file, 'utf8')), pub)).toBe(true)
    expect(typeof out.manifest.signature).toBe('string')
  })
})
