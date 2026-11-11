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

  it('a box icon comes from pokemondb by the default form\'s slug, trimmed but never scaled up', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprites-'))
    dirs.push(dir)
    const urls: string[] = []
    const fetchImpl = async (url: string) => { urls.push(url); return new Response(sample(), { status: 200 }) }
    const { obtain } = mountSprites({ get() {} }, { runtimeDir: dir, uiDir: join(dir, 'ui'), fetchImpl })
    const pika = PNG.sync.read(readFileSync(await obtain('icon', 25)))
    await obtain('icon', 386)
    expect(urls).toEqual([
      'https://img.pokemondb.net/sprites/scarlet-violet/icon/pikachu.png',
      'https://img.pokemondb.net/sprites/scarlet-violet/icon/deoxys-normal.png',
    ])
    // The sample's 150x60 block is wider than 128, so it comes down to 128 wide; a 50x50 icon stays 50x50
    expect(pika.width).toBe(SPRITE_SIZE)
    const small = new PNG({ width: 120, height: 112 })
    for (let y = 30; y < 80; y++) for (let x = 40; x < 90; x++) small.data[(y * 120 + x) * 4 + 3] = 255
    const fit = PNG.sync.read(fitPng(PNG.sync.write(small)))
    expect([fit.width, fit.height]).toEqual([50, 50])
  })

  it('every species has a box icon slug', () => {
    const { slugs } = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'pokemon-icons.json'), 'utf8'))
    for (let id = 1; id <= 1025; id++) expect(slugs[id], `#${id}`).toMatch(/^[a-z0-9-]+$/)
  })

  it('the route: an icon that cannot be had falls back to the HOME artwork, a bad kind or id is a 404', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprites-'))
    dirs.push(dir)
    const routes: any = {}
    const fetchImpl = async () => new Response('', { status: 404 })
    mountSprites({ get: (path: string, fn: any) => { routes[path] = fn } }, { runtimeDir: dir, uiDir: join(dir, 'ui'), fetchImpl })
    const call = async (kind: string, file: string) => {
      const res: any = { code: 200, location: '', set() { return res }, type() { return res }, send() { return res },
        status(c: number) { res.code = c; return res }, end() { return res },
        redirect(c: number, to: string) { res.code = c; res.location = to; return res } }
      await routes['/sprites/pokemon/:kind/:file']({ params: { kind, file } }, res)
      return res
    }
    expect(await call('icon', '25.png')).toMatchObject({ code: 302, location: '/sprites/pokemon/art/25.png' })
    expect(await call('art', '25.png')).toMatchObject({ code: 302, location: '/sprites/spawn-ball.png' })
    expect((await call('icon', '0.png')).code).toBe(404)
    expect((await call('icons', '25.png')).code).toBe(404)
  })
})
