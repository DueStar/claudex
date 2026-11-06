/**
 * import-balls.mjs — bundle high-quality Poké Ball art into the next build.
 *
 *   node tools/import-balls.mjs <folder>
 *
 * <folder> holds the Scarlet/Violet bag pictures saved from
 * https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9_Ball (the 27 balls, Master
 * Ball to Park Ball), named as the archive names them, e.g.
 * "Bag_Great_Ball_SV_Sprite.png" (Poké Ball may be "Bag_Poké_Ball_SV_Sprite.png").
 * The archive does not allow automated downloads, so they are saved by hand.
 *
 * Writes public/sprites/balls/<id>.png (trimmed, 128px; gitignored: the art is
 * Nintendo's and never goes in the repository) and keeps the Poké Ball at full
 * size in tools/_cache/ for the app icon (tools/build-icons.py). Without these
 * files the app shows PokeAPI's small item icons instead.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fitPng } from '../server/sprites.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = process.argv[2]
if (!src || !existsSync(src)) { console.error('usage: node tools/import-balls.mjs <folder with Bag_*_SV_Sprite.png>'); process.exit(1) }
const { balls } = JSON.parse(readFileSync(join(root, 'server', 'balls.json'), 'utf8'))
const out = join(root, 'public', 'sprites', 'balls')
const cache = join(root, 'tools', '_cache')
mkdirSync(out, { recursive: true })
mkdirSync(cache, { recursive: true })

const files = readdirSync(src)
const norm = (s) => decodeURIComponent(s).normalize('NFC').toLowerCase().replace(/é/g, 'e').replace(/[\s_]+/g, '_')
const missing = []
for (const b of balls) {
  const want = norm(decodeURIComponent(b.art.split('/').pop()))
  const hit = files.find((f) => norm(f) === want)
  if (!hit) { missing.push(b.id); continue }
  const raw = readFileSync(join(src, hit))
  writeFileSync(join(out, `${b.id}.png`), fitPng(raw, 128))
  if (b.id === 'poke-ball') writeFileSync(join(cache, 'poke-ball-full.png'), raw)
}
console.log(`balls: ${balls.length - missing.length} imported to ${out}`)
if (missing.length) console.log(`missing: ${missing.join(', ')}`)
