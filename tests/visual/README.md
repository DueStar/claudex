# Screenshot harness

Shots of the real built UI (`dist/`) with fixture sessions, to compare each restyle with the design lab.

    npx vite build
    node tests/visual/shots.mjs --out <dir> [--only session,dex] [--size 1100x720] [--check fit --check work]
    node tests/visual/shots.mjs --sheet session --out <dir>     # before | lab | after → <dir>/sheet-session.png
    node tests/visual/shots.mjs --flow tabs-gone                # close / rename / drag / switch without the tab row
    node tests/visual/shots.mjs --only session --side 240 --out <dir>   # the left panel at 240px (files end in -side240)
    node tests/visual/shots.mjs --flow side-resize              # drag / double-click / keys on the left panel's edge
    node tests/visual/shots.mjs --flow text-size [--out <dir>]  # the text step: migration, keys, wheel, − 가 +, its menu, 설정
    node tests/visual/shots.mjs --help                          # every option and surface id

- `fixture.mjs` — the four lab sessions + a shell (and a twelve-session set), usage 46 % / 82 %, the game.
- `fake-bridge.js` — `window.spawn` for the page; records `move/close/rename/create/send/write` in `window.__CALLS__`.
- The repo's server runs on port 3397 with `SPAWN_HOME=tests/visual/.home` (git-ignored) only to serve `dist/` and
  the Pokémon pictures (fetched once, cached there). The page's WebSocket is answered with the fixture, never the server.
- playwright-core comes from `PLAYWRIGHT_CORE` (default: the spawn-promo copy); the browser is its Chromium, else Edge, else Chrome (`SHOTS_BROWSER` = an executable overrides).
- Pages run at 2026-11-14 14:30 Seoul time, `ko-KR`, with a seeded `Math.random`: a rerun gives the same pictures.
- Exit code 0 only when every shot was written and every check passed. No Electron, nothing of the owner's is read.
