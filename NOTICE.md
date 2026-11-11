# Notice

spawn is a non-commercial fan project built on
[W17ant/Claude-Office](https://github.com/W17ant/Claude-Office) (MIT, see [LICENSE](LICENSE)).
It is not affiliated with or endorsed by Nintendo, Creatures Inc., GAME FREAK inc.,
The Pokémon Company or Anthropic.

## What the MIT licence covers

The code inherited from Claude-Office and the code added in this repository.

## What it does not cover

- **Pokémon names, data and artwork.** Pokémon and all related names and art are
  © Nintendo / Creatures Inc. / GAME FREAK inc.
  - The repository holds no Pokémon artwork and none of the games' Poké Ball artwork
    (the Poké Ball icon below is a separate, openly licensed drawing).
  - Pokémon pictures are downloaded by the app on first use from PokeAPI's public
    sprites (https://github.com/PokeAPI/sprites) and kept on the user's PC
    (`server/sprites.js`).
  - The Poké Ball pictures (Scarlet/Violet bag artwork, Bulbagarden Archives) are
    downloaded at build time by `tools/fetch-balls.mjs` and shipped inside the app,
    never committed.
  - Names, flavour text and game data in `src/pokemon/*.json` and `server/*.json` come
    from PokeAPI (https://pokeapi.co/).

  None of this is licensed by this repository.

## The Poké Ball icon

- The committed Poké Ball icon — `public/brand/pokeball.svg`, the default app, window and
  tray icons in `build/` and `electron/assets/`, and `public/sprites/spawn-ball.png` — is
  **"Poké Ball icon" by Andreuvv**, from Wikimedia Commons
  (https://commons.wikimedia.org/wiki/File:Pok%C3%A9_Ball_icon.svg), licensed under
  **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/). Changes: the empty
  margin is cropped and the picture is rendered to PNG at icon sizes. These files are
  shared under the same licence, not under MIT. Release builds use the games' Poké Ball art
  for these icons instead (imported at build time, never committed, see above); this icon is
  what shows where that art is missing.
- The Poké Ball design itself may be protected as a trademark of Nintendo / Creatures Inc. /
  GAME FREAK inc.; this is a non-commercial fan project.
- `tools/build-icons.py` (MIT) can still draw the earlier, original ball icons; they are
  no longer used.
