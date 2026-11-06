/**
 * sprites.js — Pokémon artwork, fetched on first use and kept on this PC.
 *
 * The artwork is Nintendo / The Pokémon Company's, so it is never part of the
 * repository or a release. When the app first needs a picture it downloads
 * the Pokémon HOME render from PokeAPI's public sprites, trims it to its
 * opaque pixels, scales it to fit 128x128 (the same as tools/fetch-pokemon-art.py)
 * and saves it under <runtime dir>/sprites. From then on it is a local file.
 *
 *   GET /sprites/pokemon/art/<id>.png        normal colours
 *   GET /sprites/pokemon/art-shiny/<id>.png  shiny
 *   GET /sprites/pokemon/icon/<id>.png       the Scarlet/Violet box icon (small, facing a little
 *                                            left; pokemondb.net, slugs in pokemon-icons.json): a
 *                                            session in the panel and the terminal tabs. There is no
 *                                            shiny icon. Kept at its own size (never scaled up); when
 *                                            it cannot be had, the HOME artwork is sent instead.
 *   GET /sprites/balls/<id>.png              a Poké Ball: the bundled high-quality art when the
 *                                            build has it, else PokeAPI's small item icon
 *
 * A copy already in the UI folder (a developer's local pack) is served as is.
 * When a picture cannot be had (offline, unknown id) the Poké Ball stand-in is
 * sent instead, and nothing is cached, so it is tried again next time.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

export const SPRITE_SIZE = 128
const SOURCE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home'
const MAX_ID = 1025
const ICON_SOURCE = 'https://img.pokemondb.net/sprites/scarlet-violet/icon'
const ICON_SLUGS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pokemon-icons.json'), 'utf8')).slugs
const KINDS = new Set(['art', 'art-shiny', 'icon'])
const PARALLEL = 6
const BALL_ID = /^[a-z]+-ball$/
const BALL_SOURCE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items'

/** Crop to the opaque pixels, then scale down (area average) to fit size x size. */
export function fitPng(buffer, size = SPRITE_SIZE) {
  const src = PNG.sync.read(buffer)
  const { width: w, height: h, data } = src
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1 }
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const scale = Math.min(1, size / Math.max(cw, ch))
  const ow = Math.max(1, Math.round(cw * scale))
  const oh = Math.max(1, Math.round(ch * scale))
  const out = new PNG({ width: ow, height: oh })
  const step = 1 / scale
  for (let oy = 0; oy < oh; oy++) {
    const sy0 = y0 + oy * step
    const sy1 = Math.min(y0 + ch, sy0 + step)
    for (let ox = 0; ox < ow; ox++) {
      const sx0 = x0 + ox * step
      const sx1 = Math.min(x0 + cw, sx0 + step)
      // Alpha-weighted average of the covered source pixels (no dark fringes)
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const i = (sy * w + sx) * 4
          const al = data[i + 3]
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al; n++
        }
      }
      const o = (oy * ow + ox) * 4
      if (a > 0) {
        out.data[o] = Math.round(r / a)
        out.data[o + 1] = Math.round(g / a)
        out.data[o + 2] = Math.round(b / a)
      }
      out.data[o + 3] = n ? Math.round(a / n) : 0
    }
  }
  return PNG.sync.write(out)
}

export function mountSprites(app, { runtimeDir, uiDir, fetchImpl = fetch }) {
  const cacheDir = join(runtimeDir, 'sprites')
  const inflight = new Map()
  let running = 0
  const waiting = []
  const slot = () => new Promise((resolve) => {
    if (running < PARALLEL) { running++; resolve() } else waiting.push(resolve)
  })
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else running--
  }

  async function obtain(kind, id) {
    const file = join(cacheDir, kind, `${id}.png`)
    if (existsSync(file)) return file
    const key = `${kind}/${id}`
    if (inflight.has(key)) return inflight.get(key)
    const job = (async () => {
      await slot()
      try {
        const url = kind === 'icon'
          ? `${ICON_SOURCE}/${ICON_SLUGS[id]}.png`
          : `${SOURCE}/${kind === 'art-shiny' ? 'shiny/' : ''}${id}.png`
        const res = await fetchImpl(url, { headers: { 'User-Agent': 'Claudex' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const png = fitPng(Buffer.from(await res.arrayBuffer()))
        mkdirSync(join(cacheDir, kind), { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        writeFileSync(tmp, png)
        renameSync(tmp, file)
        return file
      } finally {
        release()
        inflight.delete(key)
      }
    })()
    inflight.set(key, job)
    return job
  }

  app.get('/sprites/pokemon/:kind/:file', async (req, res) => {
    const { kind, file } = req.params
    const m = /^(\d{1,4})\.png$/.exec(file)
    const id = m ? Number(m[1]) : 0
    if (!KINDS.has(kind) || id < 1 || id > MAX_ID || (kind === 'icon' && !ICON_SLUGS[id])) return res.status(404).end()
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    const local = join(uiDir, 'sprites', 'pokemon', kind, `${id}.png`)
    if (existsSync(local)) return res.type('png').send(readFileSync(local))
    try {
      res.type('png').send(readFileSync(await obtain(kind, id)))
    } catch (err) {
      console.warn(`[sprites] ${kind}/${id}: ${err.message}`)
      // No icon: the HOME artwork of the same Pokémon; no artwork: the Poké Ball stand-in
      res.set('Cache-Control', 'no-store').redirect(302, kind === 'icon' ? `/sprites/pokemon/art/${id}.png` : '/sprites/claudex-ball.png')
    }
  })

  async function obtainBall(id) {
    const file = join(cacheDir, 'balls', `${id}.png`)
    if (existsSync(file)) return file
    const res = await fetchImpl(`${BALL_SOURCE}/${id}.png`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const png = Buffer.from(await res.arrayBuffer())
    PNG.sync.read(png)
    mkdirSync(join(cacheDir, 'balls'), { recursive: true })
    writeFileSync(file, png)
    return file
  }

  app.get('/sprites/balls/:file', async (req, res) => {
    const m = /^([a-z-]{1,30})\.png$/.exec(req.params.file)
    if (!m || !BALL_ID.test(m[1])) return res.status(404).end()
    res.set('Cache-Control', 'public, max-age=86400')
    const bundled = join(uiDir, 'sprites', 'balls', `${m[1]}.png`)
    if (existsSync(bundled)) return res.type('png').send(readFileSync(bundled))
    try {
      res.type('png').send(readFileSync(await obtainBall(m[1])))
    } catch (err) {
      console.warn(`[sprites] ball ${m[1]}: ${err.message}`)
      res.set('Cache-Control', 'no-store').redirect(302, '/sprites/claudex-ball.png')
    }
  })

  return { obtain, obtainBall, cacheDir }
}
