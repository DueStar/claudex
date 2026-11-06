# Notice

Claudex is a non-commercial fan project built on
[W17ant/Claude-Office](https://github.com/W17ant/Claude-Office) (MIT, see [LICENSE](LICENSE)).
It is not affiliated with or endorsed by Nintendo, Creatures Inc., GAME FREAK inc.,
The Pokémon Company or Anthropic.

## What the MIT licence covers

The code inherited from Claude-Office and the code added in this repository.

## What it does not cover

- **Pokémon names, data and artwork.** Pokémon and all related names and art are
  © Nintendo / Creatures Inc. / GAME FREAK inc.
  - The repository holds no Pokémon or Poké Ball artwork.
  - Pokémon pictures are downloaded by the app on first use from PokeAPI's public
    sprites (https://github.com/PokeAPI/sprites) and kept on the user's PC
    (`server/sprites.js`).
  - The Poké Ball pictures (Scarlet/Violet bag artwork, Bulbagarden Archives) are
    downloaded at build time by `tools/fetch-balls.mjs` and shipped inside the app,
    never committed.
  - Names, flavour text and game data in `src/pokemon/*.json` and `server/*.json` come
    from PokeAPI (https://pokeapi.co/).

  None of this is licensed by this repository.

## Third-party art with its own licence

- `tools/assets/tilemap.png` — "Pokemon inspired 16x16 tiles" by RedVoxel, **CC0**:
  https://opengameart.org/content/pokemon-inspired-16x16-tiles
- Character sprites, furniture and docs images under `public/sprites/` and `docs/images/`
  come from Claude-Office (MIT).
- `public/sprites/claudex-ball.png` and the default icons in `build/` and `electron/assets/`
  are original drawings made by `tools/build-icons.py` (MIT).
