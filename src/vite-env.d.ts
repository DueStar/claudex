/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** vite.config.ts: changes with every build, busts the day-long cache of the ball pictures */
  readonly VITE_ASSET_REV?: string
}

// vite.pokedex.ts: src/pokemon/pokedex.json split for the first paint
declare module 'virtual:pokedex' {
  const data: import('./theme').PokemonEntry[]
  export default data
}
declare module 'virtual:pokedex-text' {
  const text: Record<number, { genus?: string; flavor?: string; genusEn?: string; flavorEn?: string; genusJa?: string; flavorJa?: string; weightHg?: number }>
  export default text
}
