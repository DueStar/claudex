# Claudex

[한국어](README.md) · **English** · [日本語](README.ja.md)

A Windows desktop app for running Claude Code sessions with Pokémon. Each session is worked by one Pokémon from your party, and while Claude works you meet wild Pokémon and fill your Pokédex. There is no battling: it is about **collecting**.

> A non-commercial fan project. The rights to Pokémon names and artwork belong to Nintendo / Creatures Inc. / GAME FREAK inc. See [NOTICE.md](NOTICE.md).

## What it does

### Sessions are Pokémon
- On first launch you get a party of six, including a starter (Bulbasaur, Charmander or Squirtle).
- Press **New session** and pick a Pokémon from the party: it takes on a new Claude Code session. A party holds six, so you can run up to six sessions.
- A session remembers its Pokémon. Resume it and the same Pokémon comes back out.
- Rename a session by double-clicking it or with ✎.
- You can swap the working Pokémon for any other one you caught, at any time.

### Catching
- Every tool Claude uses is one step. Thinking or writing for over a minute without a tool is also one step. Each step has a 3% chance of a wild encounter, and when steps pile up they are handled in turn (8 seconds apart).
- The first session of each day always meets one Pokémon you have not caught yet (daily encounter).
- Where you meet them depends on the tool: Edit is tall grass, Bash is a cave, Read is a forest. At night Ghost, Dark and Psychic types show up more.
- A catch shows a notice at the top of the screen. It records the request and the tool that were in use, and the ball it was caught in.

| Tier | Encounter rate | Rule |
|---|---|---|
| Common | 74% | Every other Pokémon |
| Rare | 21% | Official catch rate 45 or lower (starters, pseudo-legendaries, fossils, …) |
| Sub-legendary | 3.6% | PokeAPI `is_legendary` that are not box legends |
| Legendary | 1.0% | Box legends |
| Mythical | 0.4% | PokeAPI `is_mythical` |

- A Shiny Pokémon (✦) appears at 1/4096, and species you have not caught yet come up more often.

### Individuals
- Every Pokémon has a gender (the species' official ratio) and a nature (the official 25).
- They evolve at the main games' levels (Charmander 16, Charmeleon 36, …). Each Pokémon grows on its own.
  - Friendship evolutions: at the next level-up after you have raised it 20 levels.
  - Trade evolutions: at the next level-up after a swap or a trade.
  - Eevee: from Lv.30, depending on the situation, Espeon (friendship, day), Umbreon (friendship, night), Leafeon (forest), Glaceon (cave, night), otherwise one of the stone evolutions or Sylveon.
  - Evolution stones: Lv.30 (40 for a second evolution).
- Each catch of a species lowers its chance of appearing again by 10% (0.9, 0.81, …). The share it loses goes to the other Pokémon of the same tier.
- The ball is drawn at set odds. Rarity follows how easy each ball is to come by in the games.

| Ball tier | Rate | Balls |
|---|---|---|
| Common | 60% | Poké Ball 32, Great Ball 18, Ultra Ball 10 |
| Special | 29.4% | Premier 4, Net · Dive · Nest · Repeat · Timer · Dusk · Quick · Heal 3 each, Luxury 1.4 |
| Apricorn | 8.4% | Fast · Level · Lure · Heavy · Love · Friend · Moon Ball 1.2 each |
| Limited | 2.0% | Safari 1.2, Beast Ball 0.8 |
| Master Ball | 0.2% | 1% when catching a Legendary or Mythical |

- The Competition, Park, Dream and Cherish Balls are event-only in the games, so they never come from a wild catch.
- The right situation makes a ball more likely. For example, the Dusk Ball at night or in a cave (Bash), the Lure Ball while a search tool is in use, the Beast Ball for Ultra Beasts, and the Luxury and Friend Balls with a Pokémon that has worked with you a long time. The full rules are `ballBoosts` in `server/pokedex.js`.
- Levels: wild Pokémon are met at Lv.1–55. They level up with the time they spend working with you: 20 minutes at first, growing to one level per 60 minutes at higher levels, about 55 hours to Lv.100.

### Pokédex and Box
- **Pokédex**: all 1025 species by generation and tier. Pokémon you caught but have not opened yet get a red dot.
- **Box**: holds up to 1200. Sort, search and a Shiny filter, plus swapping places with the party and releasing. When it is full, new catches are only registered in the Pokédex and sent to the Professor.

### The app
- **Widget / window / full screen**: the widget stays on top; the window and full screen are normal windows. Full screen stops at the taskbar.
- **Terminal**:
  - Shift+Enter or Ctrl+Enter for a new line.
  - Ctrl+click opens a link.
  - Drop a file on it to type its path.
  - Drag the tabs at the top to reorder sessions.
- **Restoring sessions**: sessions open when you closed the app open again on the next launch (can be turned off in Settings).
- **Limits**: shows the 5-hour and weekly limits and when they reset.
- **Google sign-in** (optional): your Pokédex is saved to the cloud (Supabase).
- **Updates**: when a new version is out, an update button appears at the top of the widget. Only the app part is downloaded, then it restarts.

## Install

1. Download `Claudex-<version>-win-x64.zip` from [Releases](https://github.com/DueStar/claudex/releases/latest) and unzip it anywhere.
2. Run `win-unpacked\Claudex.exe`.

If something it needs is missing, the app shows where to install it.
- [Claude Code](https://docs.claude.com/en/docs/claude-code/setup) (signed in)
- [Git for Windows](https://git-scm.com/downloads/win): Claude Code uses Git Bash.

Nothing else, like Python, is needed. Claudex runs the session hooks itself.

> The app is not code-signed yet. If SmartScreen warns you, click **More info → Run anyway**. With Windows 11's Smart App Control on, it will not run.

Pokémon artwork is not in the app. The first time a picture is shown it is downloaded from the [PokeAPI sprites repository](https://github.com/PokeAPI/sprites) into `%USERPROFILE%\.claudex\sprites`, and the saved file is used after that.

## How it works

```
Claudex (Electron)
 ├─ Terminal (node-pty + xterm.js) ── claude --session-id … --settings <Claudex's own hooks>
 │                                        │ hooks · status line
 ├─ Local server 127.0.0.1:3334 <─────────┘
 │    ├─ Session state, limits
 │    ├─ Game (server/pokedex.js → ~/.claudex/pokedex.json)
 │    ├─ Pokémon art (server/sprites.js, downloaded on first use)
 │    └─ Cloud sync (server/cloud.js, Supabase)
 └─ Widget / Pokédex / Box / notice windows (React)
```

- **Hooks only apply to sessions Claudex starts**: Claude Code's global settings (`~/.claude/settings.json`) are left alone.
- **The server is local only**: it listens on `127.0.0.1` only, and requests that change anything need `~/.claudex/auth-token`.
- **Updates are signature-checked**: the app only accepts a `latest.json` signed with the release key.
- **Data folder**: `~/.agent-office`, used up to 1.3.7, is copied to `~/.claudex` on the first run of 1.3.8. The old folder is left in place; delete it once everything works.
- **Logs**: the tray menu's "Open logs folder" shows `claudex.log`.
- **The sign-in token stays in the server**: the cloud sign-in token is never passed to the screens.

## Using it with your own Claude Code hooks

Claudex starts Claude Code as `claude --session-id <id> --settings %APPDATA%\Claudex\session-settings.json`. That file holds the Claudex hooks (16 events) and status line, and is rewritten each time the app starts. Claudex never touches `~/.claude/settings.json` or a project's `.claude/` settings.

- **Your hooks keep running**: Claude Code merges the hooks from every settings source, so in a Claudex session your hooks and the Claudex hooks both run. The Claudex hooks print nothing and always succeed (exit code 0), so they never change a permission decision or the context your hooks add. The three tool-call hooks (PreToolUse, PostToolUse, PostToolBatch) are set to `async`, so Claude does not wait for them; the others wait at most 1 second when the Claudex server is down.
- **The status line is Claudex's**: there is only one status line, and `--settings` comes before user and project settings, so a Claudex session shows the Claudex status line (`model · ctx 42% · $1.23`) instead of yours. Claudex reads the context in use and the 5-hour and weekly limits from it. Sessions outside Claudex keep your status line.
- **Environment variables Claudex adds**: only to the Claude Code sessions in Claudex terminals. If `CLAUDEX_SESSION_ID` is set in your hook, the session runs inside Claudex.

| Variable | Value |
|---|---|
| `CLAUDEX_SESSION_ID` | The terminal's session id. It stays the same when `/clear` starts a new conversation |
| `CLAUDEX_LINK_FILE` | `%APPDATA%\Claudex\session-links\<session id>`. The Claudex hook writes the current conversation id here at every SessionStart, and reopening the session continues that conversation |

- **Environment variables left out**: `CLAUDECODE`, `CLAUDE_PID` and anything starting with `CLAUDE_CODE_` are removed from the session environment, so a Claudex started from inside Claude Code does not open its sessions as child sessions. A `CLAUDE_CODE_…` variable you set system-wide therefore does not reach Claudex sessions.
- **Sessions outside Claudex don't count**: steps, catches and limits come only from sessions opened in a Claudex terminal. A Claude Code session in another terminal or an IDE has no Claudex hooks, so no Pokémon walks with it.
- **Codex CLI**: add Codex (the `codex` command) under Settings › AI tools, and Claudex follows the session log Codex writes itself (`~/.codex/sessions/…jsonl`): prompts, tool calls (steps), turn ends, the model, the context (HP) and Codex's usage limits (5-hour, weekly or monthly, depending on the plan) show as they do for Claude, and reopening the app resumes the same conversation with `codex resume`. Claudex never touches Codex's settings or sign-in.
- **Other AI tools**: other tools (Gemini CLI and so on) get no hooks and none of the variables above. Their steps are counted from the terminal output alone.

## What is stored and what is sent

### Stored on this PC

`~/.claudex` is `%USERPROFILE%\.claudex` (change it with `CLAUDEX_HOME`).

| Where | What |
|---|---|
| `~/.claudex/pokedex.json` | The whole game: party, box, Pokédex, log. A catch record holds the project folder name, the tool in use and the start of its argument (e.g. the first 32 characters of a Bash command), and the first 40 characters of the request at the time |
| `~/.claudex/agents.json` | The open sessions (folder, model, the first 200 characters of the last request and reply, …), so a restarted server can carry on |
| `~/.claudex/usage-limits.json` | The last 5-hour and weekly usage heard, with reset times |
| `~/.claudex/auth-token` | The local server's token (a random value), used by the hooks and the app to talk to the server |
| `~/.claudex/cloud-session.json` | The Google sign-in session, only when signed in |
| `~/.claudex/sprites/` | Downloaded Pokémon pictures |
| `%APPDATA%\Claudex\settings.json` | Settings |
| `%APPDATA%\Claudex\window-state.json` | Window position, size and mode; session names |
| `%APPDATA%\Claudex\open-sessions.json` | The sessions to reopen next time (session id, folder, tool) |
| `%APPDATA%\Claudex\session-links\` | Each terminal's current conversation id (a Codex tab: its Codex thread id) |
| `%APPDATA%\Claudex\session-settings.json` | The hook and status-line settings given to Claudex sessions |
| `%APPDATA%\Claudex\logs\claudex.log` | The app's and the local server's log |

- To list sessions to resume, Claudex only reads `~/.claude/projects` (transcripts) and `~/.claude/sessions` (running sessions). While a Codex tab is open, it only reads that tab's log under `~/.codex/sessions`.
- The local server listens on `127.0.0.1` only; requests from the hooks and the app are signed or checked with `auth-token`.
- With "Hide prompts" on in Settings, prompts are hidden on screen, and the game copy uploaded to the cloud leaves out request text and tool arguments (only tool names remain). This PC's `pokedex.json` keeps them.

### What leaves this PC

| When | Where | What |
|---|---|---|
| Signed in with Google, when records such as catches or evolutions change (at most every 30 seconds) | Supabase | User id, display name (your Google name, else your email), species caught and seen, and a copy of the game. The copy leaves out what only this PC uses (session assignments, the project list, today's catch count, session start times) and keeps the latest 200 log entries. Project folder names in catch records stay in the copy; the start of tool arguments and the first 40 characters of requests do too, unless "Hide prompts" is on. Row-level security (RLS) lets only you read and write it |
| Viewing the rankings | Supabase | Only which board. It works before signing in; signed in, your sign-in goes along to find your own place. What comes back is the nicknames, partner Pokémon and numbers of those who chose to be public |
| Joining or changing your ranking entry | Supabase | Nickname, public or not, partner Pokémon number. The ranking numbers (Pokédex count, shiny count, legendaries and mythicals, catches this week) are not sent by the app: Supabase works them out from the uploaded game copy. Your Google name and email never appear in the rankings |
| The first time a Pokémon picture is shown | `raw.githubusercontent.com` (PokeAPI art), `img.pokemondb.net` (box icons) | A request for the picture's address only |
| 15 seconds after start, then every 30 minutes | GitHub Releases (`github.com`, falling back to `api.github.com`) | A check for a new version (`latest.json`). Updating downloads the app files |

- There is no other code that sends usage statistics or error reports.

## Development

```bash
npm install
npm run dev:electron        # run in development
npx vitest run tests/pokedex.test.ts tests/sprites.test.ts tests/theme.test.ts
npm test                    # must all pass on Windows too
node scripts/release.mjs             # build (release/), notes from "### <version>" in CHANGELOG.md
node scripts/release.mjs --publish   # checks, then the GitHub release too (needs the signing key)
```

- **Art fetched at build time**: `tools/fetch-balls.mjs` downloads the ball art. `tools/build-icons.py` makes the app icons.
- **Not in the repository**: Pokémon and ball art is never committed (`.gitignore`).
- **Test runs**: to leave your real data alone, run with `CLAUDEX_HOME=<temp folder> CLAUDEX_PORT=3344`.

```
claudex/
├── electron/      # app: windows, terminals, updates, tray
├── server/        # local server: game, art, cloud, sessions
├── src/           # screens: Widget, Pokédex, Box, notices
├── hooks/         # Claude Code hooks and status line
├── tools/         # data and art preparation scripts
├── scripts/       # release scripts
└── supabase/      # cloud tables (RLS)
```

## Credits

- Built on [W17ant/Claude-Office](https://github.com/W17ant/Claude-Office) (MIT). Session tracking, the hooks and the status line structure come from it.
- Pokémon data comes from [PokeAPI](https://pokeapi.co/), ball art from [Bulbagarden Archives](https://archives.bulbagarden.net/).

## License

The code is MIT. Pokémon names and artwork are not covered by the license. See [NOTICE.md](NOTICE.md).
