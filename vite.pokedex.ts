import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * src/pokemon/pokedex.json (the tools/fetch-pokemon*.py output) split in two
 * at build time, so the first paint does not carry 1025 flavor texts:
 *   virtual:pokedex       what every page needs (names, types, tier, ...)
 *   virtual:pokedex-text  genus, flavor and weight, imported only by the
 *                         Pokédex view, which is its own chunk
 */
const SOURCE = fileURLToPath(new URL('./src/pokemon/pokedex.json', import.meta.url))
const CORE = ['id', 'ko', 'en', 'types', 'evolvesFrom', 'heightDm', 'gen', 'tier'] as const
const TEXT = ['genus', 'flavor', 'weightHg'] as const

const pick = (o: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]))

export function pokedexData(): Plugin {
  return {
    name: 'claudex-pokedex',
    resolveId(id) {
      return id === 'virtual:pokedex' || id === 'virtual:pokedex-text' ? `\0${id}` : null
    },
    load(id) {
      if (id !== '\0virtual:pokedex' && id !== '\0virtual:pokedex-text') return null
      this.addWatchFile(SOURCE)
      const all = JSON.parse(readFileSync(SOURCE, 'utf8')) as Record<string, unknown>[]
      const data = id === '\0virtual:pokedex'
        ? all.map(p => pick(p, CORE))
        : Object.fromEntries(all.map(p => [p.id, pick(p, TEXT)]))
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(data))})`
    },
  }
}
