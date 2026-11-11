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
  - The repository holds no Pokémon artwork. Of the games' Poké Ball art it holds only the
    Dream World Poké Ball used as the app icon (see below).
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

- The app, window and tray icons (`build/icon.png`, `electron/assets/`) and
  `public/sprites/spawn-ball.png` are the **Dream World Poké Ball sprite**, Nintendo /
  Creatures Inc. / GAME FREAK inc. artwork, resized. It is used here only because this is a
  personal, non-commercial fan project, is not licensed by this repository, and will be
  taken down on request.
