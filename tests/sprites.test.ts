import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { fitPng, mountSprites, SPRITE_SIZE } from '../server/sprites.js'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

/** A 300x200 transparent picture with an opaque 150x60 block at (40, 70) */
function sample(): Buffer {
  const png = new PNG({ width: 300, height: 200 })
  for (let y = 70; y < 130; y++) for (let x = 40; x < 190; x++) {
    const i = (y * 300 + x) * 4
    png.data[i] = 200; png.data[i + 1] = 50; png.data[i + 2] = 50; png.data[i + 3] = 255
  }
  return PNG.sync.write(png)
}

describe('sprites', () => {
  it('trims to the opaque pixels and fits 128x128, keeping the shape', () => {
    const out = PNG.sync.read(fitPng(sample()))
    expect(out.width).toBe(SPRITE_SIZE)
    expect(out.height).toBe(Math.round(60 * SPRITE_SIZE / 150))
    expect(out.data[3]).toBe(255)
    expect(out.data[0]).toBe(200)
  })

  it('fetches a picture once, then serves the saved file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprites-'))
    dirs.push(dir)
    let calls = 0
    const fetchImpl = async () => { calls++; return new Response(sample(), { status: 200 }) }
    const routes: any = {}
    const app = { get: (path: string, fn: any) => { routes[path] = fn } }
    const { obtain } = mountSprites(app, { runtimeDir: dir, uiDir: join(dir, 'ui'), fetchImpl })
    const [a, b] = await Promise.all([obtain('art', 25), obtain('art', 25)])
    expect(a).toBe(b)
    expect(calls).toBe(1)
    expect(existsSync(a)).toBe(true)
    await obtain('art', 25)
    expect(calls).toBe(1)
    expect(PNG.sync.read(readFileSync(a)).width).toBe(SPRITE_SIZE)
  })
})
