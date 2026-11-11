import { defineConfig } from 'vitest/config'
import { pokedexData } from './vite.pokedex'

// Server/hook tests only for now — they run in plain Node. Frontend (jsdom)
// browser tests can be added as a second project later.
export default defineConfig({
  // virtual:pokedex (src/theme.ts) comes from the same plugin as in the build
  plugins: [pokedexData()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // One worker per file: each file imports its own copy of server/index.js
    // with its own SPAWN_HOME temp dir (see tests/helpers.ts).
    pool: 'forks',
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
