# Rename Claudex → spawn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The product, its data, its integration names and its GitHub repo are called `spawn` (lowercase everywhere), and every existing install (1.3.35 and older) updates into it without losing its Pokédex, settings, sessions or updates.

**Architecture:** One release (1.3.36) carries the rename. New code copies old data into new places on first start (never moves or deletes), reads old names as fallbacks, and keeps the few names an *old* client depends on (app-zip name, latest.json, signing key). The repo is renamed on GitHub; old clients reach it through GitHub's rename redirects.

**Tech Stack:** Electron 33 (CJS main), React 18, Express server, vitest, `gh`.

**Spec:** user requests 2026-11-11 — "spawn이라는 이름으로", "GitHub 이름이랑 모든거 다 포함해서", "내부까지 전부 + 이사", name written `spawn`, app icon `spawn-app-icon-white-gradient` (may still change), brand assets in `%USERPROFILE%\Downloads\spawn-brand\` (README there: colours, usage rules). Inventory of every hit: subagent report in the session (594 hits / 105 files, buckets A–F).

## Global Constraints

- Name is `spawn` in text, titles, files and identifiers (`SPAWN_*` for env vars, since env vars are upper case by convention).
- Never delete or move old data: copy, then leave a note file (`MOVED-TO-SPAWN.txt`) in the old folder.
- Every release stays signed with the existing key (`~/.claudex-release/signing-key.pem`). The key is not moved or regenerated.
- The app-update zip keeps the name `claudex-app-<v>.zip` in `latest.json` (1.3.35 rejects any other name: `electron/updater.cjs:166`). New clients accept `claudex-app-` and `spawn-app-`. Switching the manifest to `spawn-app-` is a later release, once no old clients are left.
- Never create a new repo named `DueStar/claudex` after the rename (it would break the redirects old clients use).
- User-visible text in ko/en/ja; Korean is the translation key (`src/i18n.ts`), so a changed Korean string changes in code and both maps.

## Review Focus

1. **Update from 1.3.35 on a real install** (`%LOCALAPPDATA%\Claudex\Claudex.exe`): after the restart, the new app shows the same Pokédex, settings, window place, open sessions and patch-notes state. Pinned by the local test-build run in Task 7.
2. **userData copy runs before anything reads userData** (before the pending-update check at the top of `main.cjs`, before `app.whenReady`), and only when `%APPDATA%\spawn` does not exist yet; caches (`Cache`, `Code Cache`, `GPUCache`, `Dawn*`, `blob_storage`) are skipped. Test in Task 1.
3. **`~/.claudex` → `~/.spawn` copy** chains with the old `.agent-office` copy, honours `SPAWN_HOME`, then `CLAUDEX_HOME`, and a half-finished copy never leaves a partial `~/.spawn` (temp folder + rename, as today). Test in Task 1.
4. **An old server still on port 3334** (or a Claudex.exe and a spawn.exe side by side) is still recognised: the health proof accepts `spawn-health:` and `claudex-health:`. Test in Task 2.
5. **`latest.json` from the new release passes 1.3.35's checks** (signature, `app.file` regex, sha256, root package.json). Test in Task 3 with the 1.3.35 check copied as-is.

---

### Task 1: Data migration (runtime dir + userData)

**Files:** Modify `server/runtime-dir.cjs`, `electron/helpers.cjs:172`, `electron/main.cjs` (top), `server/cloud.js:73`, `electron/logs.cjs:21-22`. Create `electron/userDataMigration.cjs`. Tests `tests/runtime-dir.test.ts`, new `tests/userdata-migration.test.ts`.

**Interfaces:** Produces `runtimeDir(env, home)` → `SPAWN_HOME` ‖ `CLAUDEX_HOME` ‖ `~/.spawn`; `migrateRuntimeDir()` copies `.claudex` (else `.agent-office`) into `~/.spawn` once. `migrateUserData({ appData, from: 'Claudex', to: 'spawn', skip })` → `{ copied: boolean }`.

- [ ] Tests: `.claudex` copied to `.spawn` with a note `MOVED-TO-SPAWN.txt`; `.agent-office` only → copied to `.spawn`; existing `.spawn` → nothing copied; `SPAWN_HOME` wins over `CLAUDEX_HOME`; partial copy leaves no `.spawn`.
- [ ] Tests: userData copy skips the cache folders, copies `Local Storage`, settings, window state, session links; does nothing when the target exists; never throws.
- [ ] Implement; call `migrateUserData` as the first thing in `main.cjs` (dev: `Claudex-dev` → `spawn-dev`). Logs become `spawn.log` / `spawn.old.log`.
- [ ] Run the two test files, then commit.

### Task 2: Integration names (env, hooks, protocol, ids)

**Files:** `server/config.js`, `server/index.js`, `server/auth.js`, `server/health.js`, `server/ws-protocol.js`, `server/guards.js`, `hooks/claudex-hook.cjs` → `hooks/spawn-hook.cjs`, `hooks/post.cjs`, `electron/terminals.cjs`, `electron/main.cjs`, `electron/prereqs.cjs`, `electron/preload.cjs` (`window.spawn`), `src/desktop.ts`, `src/serverToken.ts`, `src/serverUrl.ts`, `vite.config.ts`, `vite.pokedex.ts`, `src/Widget.tsx`, `src/components/PokedexView.tsx`, tests listed in bucket F.

**Interfaces:** `envVar(name)` reads `SPAWN_<name>`, then `CLAUDEX_<name>`. Sessions get both `SPAWN_SESSION_ID` and `CLAUDEX_SESSION_ID` (users' own hooks, README-documented). Headers `X-Spawn-Timestamp` / `X-Spawn-Signature`; WS subprotocols `spawn` / `spawn.token.`; realm `spawn`; health proof `spawn-health:` (verify accepts `claudex-health:` too). DOM event `spawn:dex-pick`; window props `spawnKind` / `spawnPainted`.

- [ ] Tests: env fallback order; session env has both ids; health check accepts both prefixes; existing protocol tests updated to the new strings.
- [ ] Implement; full `npx vitest run` + `npx tsc --noEmit -p .`; commit.

### Task 3: Update and release compatibility

**Files:** `electron/updater.cjs` (REPO `DueStar/spawn`, UA `spawn-updater`, `app.file` regex `/^(spawn|claudex)-app-[\w.-]+\.zip$/`), `electron/updateRunner.cjs` (flag `--spawn-updated`, also strip/accept `--claudex-updated`; temp prefix `spawn-update-`, cleanup removes both prefixes), `scripts/release.mjs` (repo, full zip `spawn-<v>-win-x64.zip`, app zip stays `claudex-app-<v>.zip`, CHANGELOG headings, stop drawing the ball icon), `scripts/signing.mjs` (`SPAWN_SIGNING_KEY`, else `CLAUDEX_SIGNING_KEY`, same default path), `package.json` (name `spawn`, productName `spawn`, appId `local.spawn.app`, repo URLs, artifactName), `electron/feedback.cjs` (REPO), `main.cjs:1133`.

- [ ] Test: a manifest built by the new release code passes a verbatim copy of 1.3.35's checks (`app.file` regex `/^claudex-app-[\w.-]+\.zip$/`).
- [ ] Tests: cleanup removes `claudex-update-*` and `spawn-update-*`; flag handling; update-download URLs point at `DueStar/spawn`.
- [ ] Implement; run tests; commit.

### Task 4: Words people see

**Files:** `index.html`, `electron/helpers.cjs:16` (`APP_NAME = 'spawn'`) and its menu/notification/dialog uses, `electron/statusCard.cjs`, `electron/status-card.html`, `electron/i18n.cjs`, `server/index.js:795-799` (sign-in page), `src/locales/*.ts` + their call sites (brand tooltip, patch-notes title, feedback title), `src/components/SettingsView.tsx:139`, `src/patchNotes.ts:22` + `CHANGELOG.md` headings (`## spawn`, `## spawn (English)`, `## spawn (日本語)`), `README.md`, `README.en.md`, `README.ja.md` (repo links, data paths now `~/.spawn` / `%APPDATA%\spawn`, env table `SPAWN_*` with the old names noted as still read), `NOTICE.md`, `CONTRIBUTING.md`, `scripts/install-local.cmd` + `scripts/desktop-shortcut.ps1` (handle `Claudex.exe` and `spawn.exe`). localStorage keys `claudex-*` → `spawn-*` with a one-time copy shim in the renderer (`src/storageMigration.ts`, run first in `main.tsx`).

- [ ] Tests: patch notes still parse; tray labels; storage shim copies each old key once and never overwrites a new one.
- [ ] Implement; tests; commit.

### Task 5: Logo and icons

**Files:** `build/icon.png` (from `png/app-icon/spawn-app-icon-white-gradient-1024.png`), `electron/assets/icon.png`, tray PNGs `electron/assets/tray-16/32/48.png` (from the symbol: colour at 32/48, single colour at 16 per the brand README "24px 이하 단색"), header brand mark in `Widget.tsx` (brand spots only: header and rail logo use a new `SpawnMark` SVG component from `svg/symbol/`; the game's Poké Ball pictures stay), `public/sprites/claudex-ball.png` → `spawn-ball.png` (same drawing; `theme.ts`, `sprites.js` redirects), `tools/build-icons.py` no longer writes the app icons, `release.mjs:120-127` no longer redraws them.

- [ ] Visual check in an isolated app run (header, rail, tray, settings version line); commit.

### Task 6: The site (`Documents\claudex-site\`, outside the repo)

`PRODUCT_NAME = 'spawn'`, logo from `logo-horizontal/…color-on-dark` (header) and favicon set from `favicon/` (+ `head-snippet.html`), repo links → `DueStar/spawn`, release asset names, feedback REPO, latest version. Folder name stays until deploy.

### Task 7: Rename the repo and ship (asks the user first)

- [ ] Local test build (`node scripts/release.mjs "test build: spawn"`) installed over this PC's 1.3.35: check Review Focus 1 by hand (Pokédex count, settings, window, sessions, patch notes), `%APPDATA%\spawn` and `~/.spawn` exist, old folders untouched with notes, `update.log` timings.
- [ ] Ask the user, then `gh repo rename spawn -R DueStar/claudex`; `git remote set-url origin https://github.com/DueStar/spawn.git`.
- [ ] Verify redirects: `curl -sIL https://github.com/DueStar/claudex/releases/latest/download/latest.json` ends 200 at DueStar/spawn; same for the API URL.
- [ ] Version 1.3.36, CHANGELOG (three sections, user tone), HANDOFF, memory; push; `node scripts/release.mjs --publish`; check the release's `latest.json` `app.file` is `claudex-app-1.3.36.zip`.

## Left outside the repo (tell the user)

- Google/Supabase sign-in consent screen app name.
- The local folder `Documents\pokemon-office` and `Documents\claudex-site` names.
- Installed copies keep running `Claudex.exe` from `%LOCALAPPDATA%\Claudex` until a fresh full install.
