/**
 * The short run between an update restart's quit and the new app
 * (electron/updateRunner.cjs): copy the staged update over resources/app
 * behind the "updating" card, never loop, leave the staged folder for later.
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { hasPendingUpdate, runPendingUpdate, cleanupStaleUpdates } = require('../electron/updateRunner.cjs')

let root: string
let userData: string
let resources: string
let staged: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cx-runner-'))
  userData = join(root, 'userData'); mkdirSync(userData)
  resources = join(root, 'resources'); mkdirSync(join(resources, 'app'), { recursive: true })
  staged = join(root, 'spawn-update-x', 'app'); mkdirSync(staged, { recursive: true })
  writeFileSync(join(staged, 'package.json'), '{}')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const marker = () => join(userData, 'pending-update.json')
const writeMarker = (stagedPath = staged) => writeFileSync(marker(), JSON.stringify({ staged: stagedPath, version: '9.9.9' }))

function fakes(code: number | null = 1) {
  const app = { whenReady: vi.fn(() => Promise.resolve()), relaunch: vi.fn(), exit: vi.fn() }
  const spawn = vi.fn(() => {
    const child = new EventEmitter()
    setTimeout(() => child.emit('exit', code), 0)
    return child
  })
  const card = { close: vi.fn() }
  const openCard = vi.fn(() => card)
  const steps: string[] = []
  const timer = { mark: vi.fn((step: string) => { steps.push(step) }) }
  return { app, spawn, card, openCard, timer, steps }
}

// These are the Windows flow (robocopy, app.relaunch), pinned so they run on any host; the Mac flow is pinned to darwin below
const run = (f: ReturnType<typeof fakes>, isPackaged = true) => runPendingUpdate({ platform: 'win32',
  app: f.app, isPackaged, resourcesPath: resources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer,
  readNear: () => null, lang: 'ko', argv: ['spawn.exe', '--some-flag'],
})

describe('hasPendingUpdate', () => {
  it('is true only when the last run left an update staged', () => {
    expect(hasPendingUpdate(userData)).toBe(false)
    writeMarker()
    expect(hasPendingUpdate(userData)).toBe(true)
  })
})

describe('runPendingUpdate', () => {
  it('copies the update behind the card, keeps the staged folder, starts the new app', async () => {
    writeMarker()
    const f = fakes(1)
    await expect(run(f)).resolves.toEqual({ ok: true })
    expect(existsSync(marker())).toBe(false)
    expect(f.openCard).toHaveBeenCalledWith(expect.objectContaining({ step: 'updating', lang: 'ko' }))
    expect(f.card.close).toHaveBeenCalled()
    const [cmd, args] = f.spawn.mock.calls[0] as unknown as [string, string[]]
    expect(cmd).toBe('robocopy')
    expect(args.slice(0, 3)).toEqual([staged, join(resources, 'app'), '/MIR'])
    expect(args).toContain('/MT:8') // files copied side by side
    expect(existsSync(staged)).toBe(true)
    expect(f.app.relaunch).toHaveBeenCalledWith({ args: ['--some-flag', '--spawn-updated'] })
    expect(f.app.exit).toHaveBeenCalledWith(0)
    expect(f.steps).toEqual(['p2-start', 'robocopy-start', 'robocopy-end', 'relaunch'])
  })

  it('a failed copy still starts the app once (the old code), and never again', async () => {
    writeMarker()
    const f = fakes(8)
    const r = await run(f)
    expect(r.ok).toBe(false)
    expect(existsSync(marker())).toBe(false)
    expect(f.app.relaunch).toHaveBeenCalledTimes(1)
    expect(f.app.exit).toHaveBeenCalledTimes(1)
  })

  it('a marker pointing at nothing copies nothing and starts the app', async () => {
    writeMarker(join(root, 'gone', 'app'))
    const f = fakes()
    await expect(run(f)).resolves.toEqual({ ok: false, reason: 'no staged app' })
    expect(f.spawn).not.toHaveBeenCalled()
    expect(f.app.relaunch).toHaveBeenCalledTimes(1)
    expect(f.app.exit).toHaveBeenCalledTimes(1)
  })

  it('a development run only drops the marker', async () => {
    writeMarker()
    const f = fakes()
    const r = await run(f, false)
    expect(r.ok).toBe(false)
    expect(f.spawn).not.toHaveBeenCalled()
    expect(f.app.relaunch).not.toHaveBeenCalled()
    expect(existsSync(marker())).toBe(false)
  })

  it('does not add the updated flag twice', async () => {
    writeMarker()
    const f = fakes(0)
    await runPendingUpdate({ platform: 'win32', app: f.app, isPackaged: true, resourcesPath: resources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer, readNear: () => null, lang: 'ko', argv: ['spawn.exe', '--spawn-updated'] })
    expect(f.app.relaunch).toHaveBeenCalledWith({ args: ['--spawn-updated'] })
  })

  it('drops the old --claudex-updated flag (from a 1.3.35 restart) instead of carrying it along', async () => {
    writeMarker()
    const f = fakes(0)
    await runPendingUpdate({ platform: 'win32', app: f.app, isPackaged: true, resourcesPath: resources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer, readNear: () => null, lang: 'ko', argv: ['spawn.exe', '--claudex-updated', '--x'] })
    expect(f.app.relaunch).toHaveBeenCalledWith({ args: ['--x', '--spawn-updated'] })
  })

  it('a run after an update restart is recognised by either flag', () => {
    const { isUpdatedRun } = require('../electron/updateRunner.cjs')
    expect(isUpdatedRun(['spawn.exe', '--spawn-updated'])).toBe(true)
    expect(isUpdatedRun(['Claudex.exe', '--claudex-updated'])).toBe(true)
    expect(isUpdatedRun(['spawn.exe'])).toBe(false)
  })
})

describe('runPendingUpdate — robustness', () => {
  it("robocopy's output is not piped (a full pipe would stop it)", async () => {
    writeMarker()
    const f = fakes(1)
    await run(f)
    const opts = (f.spawn.mock.calls[0] as unknown as [string, string[], any])[2]
    expect(opts).toMatchObject({ windowsHide: true, stdio: 'ignore' })
  })

  it('a robocopy that cannot start still starts the app once', async () => {
    writeMarker()
    const f = fakes()
    f.spawn.mockImplementation(() => { throw new Error('no robocopy') })
    const r = await run(f)
    expect(r).toEqual({ ok: false, reason: 'robocopy -1' })
    expect(f.app.relaunch).toHaveBeenCalledTimes(1)
  })

  it('a marker that cannot be removed ends the run without starting it again (no loop)', async () => {
    writeMarker()
    const f = fakes()
    const r = await runPendingUpdate({ platform: 'win32',
      app: f.app, isPackaged: true, resourcesPath: resources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer, argv: ['x'],
      removeMarker: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) },
      setAsideMarker: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) },
    })
    expect(r).toEqual({ ok: false, reason: 'marker stuck' })
    expect(f.spawn).not.toHaveBeenCalled()
    expect(f.app.relaunch).not.toHaveBeenCalled()
    expect(f.app.exit).toHaveBeenCalledTimes(1)
  })

  it('a marker that cannot be removed but can be set aside still lets the update go in', async () => {
    writeMarker()
    const f = fakes(1)
    const r = await runPendingUpdate({ platform: 'win32',
      app: f.app, isPackaged: true, resourcesPath: resources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer, argv: ['x'],
      removeMarker: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) },
    })
    expect(r).toEqual({ ok: true })
    expect(hasPendingUpdate(userData)).toBe(false)
    expect(f.app.relaunch).toHaveBeenCalledTimes(1)
  })

  it('the card goes where the quitting app left it, in its language', async () => {
    writeFileSync(marker(), JSON.stringify({ staged, version: '9.9.9', card: { near: { x: 1, y: 2, width: 300, height: 600 }, lang: 'ja' } }))
    const f = fakes(1)
    await run(f)
    expect(f.openCard).toHaveBeenCalledWith(expect.objectContaining({ near: { x: 1, y: 2, width: 300, height: 600 }, lang: 'ja', step: 'updating' }))
  })

  it('the language fallback is read once Electron is ready', async () => {
    writeMarker()
    const f = fakes(1)
    let ready = false
    f.app.whenReady = vi.fn(async () => { ready = true })
    const getLang = vi.fn(() => (ready ? 'ko' : 'en'))
    await runPendingUpdate({ platform: 'win32', app: f.app, isPackaged: true, resourcesPath: resources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer, argv: ['x'], getLang })
    expect(f.openCard).toHaveBeenCalledWith(expect.objectContaining({ lang: 'ko' }))
  })

  it('Electron never getting ready does not hold the copy up', async () => {
    writeMarker()
    const f = fakes(1)
    f.app.whenReady = vi.fn(() => new Promise<void>(() => {}))
    const r = await runPendingUpdate({ platform: 'win32', app: f.app, isPackaged: true, resourcesPath: resources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer, argv: ['x'], readyTimeoutMs: 20 })
    expect(r.ok).toBe(true)
    expect(f.openCard).not.toHaveBeenCalled()
    expect(f.app.relaunch).toHaveBeenCalledTimes(1)
  })
})

describe('cleanupStaleUpdates', () => {
  it('removes old update folders, never the one to keep or anything else', async () => {
    const tmp = join(root, 'tmp'); mkdirSync(tmp)
    // claudex-update-*: left by 1.3.35 and older (the update into spawn among them)
    for (const d of ['spawn-update-a', 'spawn-update-b', 'claudex-update-c', 'other']) mkdirSync(join(tmp, d))
    // Seen an hour on, so every folder is old: a file's birth time is finer than Date.now()'s whole
    // milliseconds and can read a fraction after it, so with minAgeMs 0 and the real clock a folder
    // made in the same millisecond still counted as new (macOS CI, run 3: 0 removed, not 2)
    const later = Date.now() + 60 * 60_000
    await expect(cleanupStaleUpdates({ tmpdir: tmp, keep: join(tmp, 'spawn-update-b'), now: () => later })).resolves.toBe(2)
    expect(readdirSync(tmp).sort()).toEqual(['other', 'spawn-update-b'])
  })

  it('leaves a folder made recently alone (an update may be unpacking into it)', async () => {
    const tmp = join(root, 'tmp'); mkdirSync(tmp)
    mkdirSync(join(tmp, 'spawn-update-new'))
    await expect(cleanupStaleUpdates({ tmpdir: tmp })).resolves.toBe(0)
    expect(readdirSync(tmp)).toEqual(['spawn-update-new'])
    // the same folder, seen just over ten minutes later (a file time is finer than Date.now's whole ms)
    await expect(cleanupStaleUpdates({ tmpdir: tmp, now: () => Date.now() + 10 * 60_000 + 1000 })).resolves.toBe(1)
  })
})

describe('runPendingUpdate on macOS', () => {
  const bundle = '/Applications/spawn.app'
  const macResources = `${bundle}/Contents/Resources`

  /** spawn and mirror fakes that log the order things happen in; `codes` per command */
  function macFakes(codes: Record<string, number> = {}, mirrorError: Error | null = null) {
    const f = fakes()
    const order: string[] = []
    f.spawn.mockImplementation(((cmd: string) => {
      order.push(cmd)
      const child = new EventEmitter()
      setTimeout(() => child.emit('exit', codes[cmd] ?? 0), 0)
      return child
    }) as any)
    const mirror = vi.fn((_from: string, _to: string) => { order.push('mirror'); if (mirrorError) throw mirrorError })
    const runMac = () => runPendingUpdate({
      app: f.app, isPackaged: true, resourcesPath: macResources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer,
      argv: ['/Applications/spawn.app/Contents/MacOS/spawn', '--some-flag'], platform: 'darwin', mirror,
    })
    return { f, order, mirror, runMac }
  }

  it('mirrors the update into the bundle, re-signs it ad hoc and opens it again', async () => {
    writeMarker()
    const { f, order, mirror, runMac } = macFakes()
    await expect(runMac()).resolves.toEqual({ ok: true })
    expect(order).toEqual(['mirror', 'codesign', 'open'])
    expect(mirror).toHaveBeenCalledWith(staged, `${macResources}/app`)
    const calls = f.spawn.mock.calls as unknown as Array<[string, string[], any]>
    expect(calls[0].slice(0, 2)).toEqual(['codesign', ['--force', '--deep', '--sign', '-', bundle]])
    expect(calls[1].slice(0, 2)).toEqual(['open', ['-n', bundle, '--args', '--spawn-updated']])
    expect(f.app.relaunch).not.toHaveBeenCalled()
    expect(f.app.exit).toHaveBeenCalledWith(0)
    expect(existsSync(marker())).toBe(false)
    expect(existsSync(staged)).toBe(true)
    expect(f.card.close).toHaveBeenCalled()
    expect(f.steps).toEqual(['p2-start', 'mirror-start', 'mirror-end', 'codesign-start', 'codesign-end', 'relaunch'])
  })

  it('a failed re-sign still opens the updated app, and the update log says so', async () => {
    writeMarker()
    const { f, order, runMac } = macFakes({ codesign: 1 })
    const r = await runMac()
    expect(order).toEqual(['mirror', 'codesign', 'open'])
    expect(r.ok).toBe(true)
    expect(f.timer.mark).toHaveBeenCalledWith('codesign-end', 'code=1')
    expect(f.app.exit).toHaveBeenCalledWith(0)
  })

  it('a failed copy is logged, the bundle is signed again all the same, and the app opens', async () => {
    writeMarker()
    const { f, order, runMac } = macFakes({}, Object.assign(new Error('nope'), { code: 'EACCES' }))
    const r = await runMac()
    expect(r).toEqual({ ok: false, reason: 'mirror EACCES' })
    expect(order).toEqual(['mirror', 'codesign', 'open'])
    expect(f.timer.mark).toHaveBeenCalledWith('mirror-end', 'error=EACCES nope')
    expect(f.app.exit).toHaveBeenCalledTimes(1)
  })

  it('when open fails, Electron starts the app instead (never left closed)', async () => {
    writeMarker()
    const { f, runMac } = macFakes({ open: 1 })
    await runMac()
    expect(f.app.relaunch).toHaveBeenCalledWith({ args: ['--spawn-updated'] })
    expect(f.app.exit).toHaveBeenCalledWith(0)
  })

  it('a marker pointing at nothing touches nothing and opens the app', async () => {
    writeMarker(join(root, 'gone', 'app'))
    const { f, order, runMac } = macFakes()
    await expect(runMac()).resolves.toEqual({ ok: false, reason: 'no staged app' })
    expect(order).toEqual(['open'])
    expect(f.app.exit).toHaveBeenCalledTimes(1)
  })

  it('bundlePath is the .app two levels above Contents/Resources', () => {
    const { bundlePath } = require('../electron/updateRunner.cjs')
    expect(bundlePath('/Applications/spawn.app/Contents/Resources')).toBe('/Applications/spawn.app')
    expect(bundlePath('/Users/me/Apps/spawn.app/Contents/Resources/')).toBe('/Users/me/Apps/spawn.app')
  })
})
