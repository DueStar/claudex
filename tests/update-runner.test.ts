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
  staged = join(root, 'claudex-update-x', 'app'); mkdirSync(staged, { recursive: true })
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

const run = (f: ReturnType<typeof fakes>, isPackaged = true) => runPendingUpdate({
  app: f.app, isPackaged, resourcesPath: resources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer,
  readNear: () => null, lang: 'ko', argv: ['Claudex.exe', '--some-flag'],
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
    expect(existsSync(staged)).toBe(true)
    expect(f.app.relaunch).toHaveBeenCalledWith({ args: ['--some-flag', '--claudex-updated'] })
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
    await runPendingUpdate({ app: f.app, isPackaged: true, resourcesPath: resources, userData, spawn: f.spawn, openCard: f.openCard, timer: f.timer, readNear: () => null, lang: 'ko', argv: ['Claudex.exe', '--claudex-updated'] })
    expect(f.app.relaunch).toHaveBeenCalledWith({ args: ['--claudex-updated'] })
  })
})

describe('cleanupStaleUpdates', () => {
  it('removes old update folders, never the one to keep or anything else', async () => {
    const tmp = join(root, 'tmp'); mkdirSync(tmp)
    for (const d of ['claudex-update-a', 'claudex-update-b', 'other']) mkdirSync(join(tmp, d))
    await expect(cleanupStaleUpdates({ tmpdir: tmp, keep: join(tmp, 'claudex-update-b') })).resolves.toBe(1)
    expect(readdirSync(tmp).sort()).toEqual(['claudex-update-b', 'other'])
  })
})
