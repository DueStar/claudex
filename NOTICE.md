# Notice

This is a personal, local-only fork of [W17ant/Claude-Office](https://github.com/W17ant/Claude-Office)
(MIT, see [LICENSE](LICENSE)) reskinned as a 2D Pokémon park. Do not publish or redistribute it.

## What the MIT licence covers

The code inherited from Claude-Office and the code added here.

## What it does not cover

- **Pokémon sprites and names** — `public/sprites/pokemon/` (Black/White sprites of #1–151,
  downloaded once from img.pokemondb.net by `tools/fetch-pokemon.py`) and the names in
  `src/pokemon/pokedex.json` (from PokeAPI). Pokémon and all related names and art are
  © Nintendo / Creatures Inc. / GAME FREAK inc. They are used here for personal,
  non-commercial enjoyment on this machine only and are not licensed by this repository.
  Keep any git remote for this project **private**.

## Third-party art with its own licence

- `tools/assets/tilemap.png` — "Pokemon inspired 16x16 tiles" by RedVoxel
  (https://red-voxel.itch.io/), released as **CC0** on OpenGameArt:
  https://opengameart.org/content/pokemon-inspired-16x16-tiles . The map
  (`public/rooms/pokemon-*.png`) is composed from it by `tools/build-map.py`, together with
  props (desk, pond, board, PC, Poké Ball statue) drawn in that script.
