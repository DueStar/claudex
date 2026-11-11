/**
 * fetch-i18n.mjs — the official English and Japanese names (and Pokédex text)
 * from PokeAPI, added next to the Korean ones already in the data files:
 *
 *   src/pokemon/pokedex.json   ja; genus/flavor for en and ja (genusEn, genusJa, flavorEn, flavorJa)
 *   server/pokemon-data.json   en, ja
 *   server/natures.json        ja
 *   server/balls.json          ja
 *
 * Every PokeAPI answer is cached in tools/_cache/pokeapi/ (not committed), so
 * a second run touches nothing on the network. Run: node tools/fetch-i18n.mjs
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(root, 'tools', '_cache', 'pokeapi')
mkdirSync(CACHE, { recursive: true })

async function get(path) {
  const file = join(CACHE, path.replace(/[/?]/g, '_') + '.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://pokeapi.co/api/v2/${path}`, { headers: { 'User-Agent': 'spawn-i18n-fetch' } })
    if (res.ok) { const json = await res.json(); writeFileSync(file, JSON.stringify(json)); return json }
    if (res.status === 404) return null
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
  }
  throw new Error(`PokeAPI ${path}: giving up`)
}

/** Many at a time, a few in flight (PokeAPI's fair use) */
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

const nameIn = (names, lang) => names?.find(n => n.language.name === lang)?.name ?? null
const jaName = (names) => nameIn(names, 'ja') ?? nameIn(names, 'ja-Hrkt') ?? nameIn(names, 'ja-hrkt')
/** The newest entry in a language (PokeAPI lists them oldest first), with the game's line breaks flattened */
const latest = (entries, lang, key) => {
  const all = (entries ?? []).filter(e => e.language.name === lang)
  const text = all.length ? all[all.length - 1][key] : null
  return text ? text.replace(/[\f\n\r­]+/g, lang === 'en' ? ' ' : '').replace(/\s+/g, lang === 'en' ? ' ' : ' ').trim() : null
}
const latestJa = (entries, key) => latest(entries, 'ja', key) ?? latest(entries, 'ja-Hrkt', key) ?? latest(entries, 'ja-hrkt', key)

// ---- species ----
const dexFile = join(root, 'src', 'pokemon', 'pokedex.json')
const dex = JSON.parse(readFileSync(dexFile, 'utf8'))
let done = 0
const species = await pool(dex, 8, async (p) => {
  const sp = await get(`pokemon-species/${p.id}`)
  if (++done % 100 === 0) console.log(`species ${done}/${dex.length}`)
  return sp
})
for (const [i, p] of dex.entries()) {
  const sp = species[i]
  p.en = nameIn(sp.names, 'en') ?? p.en
  p.ja = jaName(sp.names)
  p.genusEn = sp.genera?.find(g => g.language.name === 'en')?.genus ?? null
  p.genusJa = sp.genera?.find(g => g.language.name === 'ja')?.genus ?? sp.genera?.find(g => g.language.name === 'ja-Hrkt')?.genus ?? null
  p.flavorEn = latest(sp.flavor_text_entries, 'en', 'flavor_text')
  p.flavorJa = latestJa(sp.flavor_text_entries, 'flavor_text')
}
writeFileSync(dexFile, JSON.stringify(dex) + '\n')

const dataFile = join(root, 'server', 'pokemon-data.json')
const data = JSON.parse(readFileSync(dataFile, 'utf8'))
const byId = new Map(dex.map(p => [p.id, p]))
for (const s of data) { const p = byId.get(s.id); if (p) { s.en = p.en; s.ja = p.ja } }
writeFileSync(dataFile, JSON.stringify(data) + '\n')

// ---- natures ----
const natFile = join(root, 'server', 'natures.json')
const natures = JSON.parse(readFileSync(natFile, 'utf8'))
await pool(natures, 4, async (n) => { const r = await get(`nature/${n.en.toLowerCase()}`); n.ja = jaName(r?.names) })
writeFileSync(natFile, JSON.stringify(natures, null, 1) + '\n') // the file's own indent (Python's indent=1)

// ---- balls ----
const ballFile = join(root, 'server', 'balls.json')
const balls = JSON.parse(readFileSync(ballFile, 'utf8'))
await pool(balls.balls, 4, async (b) => { const r = await get(`item/${b.id}`); b.ja = jaName(r?.names); if (!b.en && r) b.en = nameIn(r.names, 'en') })
writeFileSync(ballFile, JSON.stringify(balls, null, 2) + '\n')

const missing = {
  ja: dex.filter(p => !p.ja).length, flavorEn: dex.filter(p => !p.flavorEn).length, flavorJa: dex.filter(p => !p.flavorJa).length,
  genusJa: dex.filter(p => !p.genusJa).length, natureJa: natures.filter(n => !n.ja).length, ballJa: balls.balls.filter(b => !b.ja).length,
}
console.log('done; missing:', JSON.stringify(missing))
