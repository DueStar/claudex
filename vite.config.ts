import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pokedexData } from './vite.pokedex'

// The server's port, the same SPAWN_PORT the server, the hook
// and the app read (default 3334). A value that is not a port falls back
// to 3334 like server/config.js readPort does, so a typo cannot split the
// dev page from its server.
function serverPort(): number {
  const raw = process.env.SPAWN_PORT || ''
  const port = /^\d{1,5}$/.test(raw.trim()) ? Number(raw.trim()) : NaN
  return port >= 1 && port <= 65535 ? port : 3334
}

const SERVER_PORT = serverPort()

export default defineConfig({
  plugins: [react(), pokedexData()],
  // The built app is always served from an origin root: Vite on 3333 in dev,
  // the server on its own port after `vite build` (it mounts dist/ at
  // /, and the packaged desktop app loads http://127.0.0.1:<port>/). Sprite
  // and room URLs in src/ are absolute ('/sprites/...'), so a relative base
  // would not make the bundle relocatable anyway — keep the root base explicit.
  base: '/',
  // Where the page finds the server when Vite, not the server, serves it
  // (src/serverUrl.ts). A production build is served by the server itself and
  // uses its own origin, so this only matters under `vite` / `vite --port`.
  define: {
    'import.meta.env.VITE_SPAWN_PORT': JSON.stringify(String(SERVER_PORT)),
  },
  server: {
    port: 3333,
    // 127.0.0.1, not `localhost`: on a resolver that answers [::1] first, a
    // listener there would serve the dev page and receive its server token
    host: '127.0.0.1',
    // Fail instead of drifting to 3335 when 3333 is busy: the Electron dev
    // window and the server's origin allowlist all expect 3333.
    strictPort: true,
    proxy: {
      // Pokémon artwork comes from the server (fetched on first use), never from public/
      '/sprites/pokemon': { target: `http://127.0.0.1:${SERVER_PORT}` },
      '/sprites/balls': { target: `http://127.0.0.1:${SERVER_PORT}` },
      '/ws': {
        target: `ws://127.0.0.1:${SERVER_PORT}`,
        ws: true,
      },
    },
  },
})
