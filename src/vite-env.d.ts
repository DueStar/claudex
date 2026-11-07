/// <reference types="vite/client" />

// vite.pokedex.ts: src/pokemon/pokedex.json split for the first paint
declare module 'virtual:pokedex' {
  const data: import('./theme').PokemonEntry[]
  export default data
}
declare module 'virtual:pokedex-text' {
  const text: Record<number, { genus?: string; flavor?: string; weightHg?: number }>
  export default text
}
