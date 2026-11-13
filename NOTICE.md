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

## Fonts

The app ships three typefaces in `public/fonts/` (declared in `public/fonts/fonts.css`),
each the unmodified variable webfont from the project's release, under the
**SIL Open Font License 1.1**, not the MIT licence. The licence text and copyright notice
of each sit beside the files.

- **Monaspace Neon** (`MonaspaceNeonVar.woff2`, version 1.400): Copyright (c) 2023, GitHub,
  with Reserved Font Name "Monaspace". https://github.com/githubnext/monaspace
  (release v1.400). Licence: `public/fonts/LICENSE-Monaspace.txt`.
- **Pretendard** (`PretendardVariable.woff2`, version 1.3.9): Copyright (c) 2021,
  Kil Hyung-jin, with Reserved Font Name Pretendard. https://github.com/orioncactus/pretendard
  (release v1.3.9). Licence: `public/fonts/LICENSE-Pretendard.txt`.
- **Uncut Sans** (`UncutSansVariable.woff2`, version 1.304): Copyright (c) 2022
  Kasper Nordkvist; "Uncut Sans" is a trademark of Kasper Nordkvist.
  https://github.com/kaspernordkvist/uncut_sans (release v1.3.4).
  Licence: `public/fonts/LICENSE-UncutSans.txt`.
