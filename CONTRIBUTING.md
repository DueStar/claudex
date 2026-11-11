# Contributing

Thanks for helping. A few ground rules so a pull request lands quickly.

## What spawn is

A Windows desktop app that runs Claude Code sessions with Pokémon partners:
the sessions are real terminals, and the game (encounters, the Pokédex, the
box) follows what Claude Code really does, through the app's own hooks.

## Before you open a PR

- Run `npm test`. It runs the Vitest suite against a temp `SPAWN_HOME`, so
  it never touches your real `~/.spawn`. It must pass on Windows: a check
  that only makes sense on Unix (file modes, symlinks, uids) skips there with
  its reason. CI (`.github/workflows/ci.yml`) runs `tsc --noEmit`, `npm test`
  and `vite build` on Windows and Linux.
- Add or update a test for behaviour you change (`tests/`).
- Keep the README true: if you change a command, a port, a hook event or a
  default, change the line that documents it in the same PR.
- User-facing changes get a line in CHANGELOG.md under the next version: the
  app shows it as patch notes after an update.
- One change per PR; describe what you saw before and after, and name the
  Claude Code version and Windows version you tested on.

## Style

- Match the surrounding code; no reformatting-only diffs.
- No Pokémon or Poké Ball artwork in the repository (see [NOTICE.md](NOTICE.md)):
  the app fetches Pokémon art on first use, and ball art is bundled at build time.
