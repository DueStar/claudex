# spawn for macOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A macOS build of spawn (arm64 + x64) that does everything the Windows build does, released together with Windows from this PC.

**Architecture:** Shared code gains small platform helpers (`electron/platform.cjs`, `src/platform.ts`) and `isMac` branches; Windows behaviour is unchanged. Mac builds run on GitHub Actions macOS runners (tests, build, smoke launch with screenshots); `scripts/release.mjs --publish` on Windows publishes Windows as now, then fetches the Mac zips from the workflow, signs per-platform manifests with the local key and uploads them to the same release.

**Tech Stack:** Electron 33, node-pty 1.1 (N-API prebuilds), React + Vite, vitest, electron-builder 24, GitHub Actions (`macos-14` arm64, `macos-13` x64), `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-13-macos-port-design.md`

## Global Constraints
- Windows behaviour must not change: every Mac path is behind `process.platform === 'darwin'` (main) or `isMac()` (renderer). Windows `latest.json` and the `^(spawn|claudex)-app-…\.zip$` asset rule stay exactly as they are (1.3.35 clients accept only that).
- No Apple Developer ID: builds are ad-hoc signed (`codesign --sign -`).
- Mac updates: changed files only (`spawn-app-<v>-mac-<arch>.zip`), then ad-hoc re-sign; Electron version change → full download page (`needsFull`, as on Windows).
- Mac manifests: `latest-mac-arm64.json`, `latest-mac-x64.json`, same shape and Ed25519 signing as `latest.json`.
- The update signing key stays on this PC (`~/.claudex-release`); never in CI secrets.
- Window/full-screen: traffic lights top-left, custom min/max/close hidden on Mac; widget: Dock hidden while in widget mode; full screen = fill the work area.
- Shortcuts on Mac use ⌘; Ctrl+C in the terminal is always interrupt; Ctrl+V still reaches Claude.
- Every UI string change in ko / en / ja.
- `npx vitest run` and `npx tsc --noEmit -p .` green on Windows after every task; Mac CI green from Task 12 on.

## Review Focus
1. Login-shell environment read hangs or fails (a slow `.zshrc`, fish, no `$SHELL`): the app must still start within ~3 s with a sane PATH (`/opt/homebrew/bin:/usr/local/bin:~/.local/bin` appended). → test in Task 2.
2. App in `/Applications` owned by another user, or run from Downloads (App Translocation, read-only): the update must fail cleanly with a message and a link to the full download, never leave a half-copied app. → test in Task 6.
3. Old Windows clients after the first Mac release: they must still read `latest.json` and see no change. → test in Task 5.
4. A Mac zip made or unpacked such that `node-pty/prebuilds/darwin-*/spawn-helper` loses its exec bit ("posix_spawnp failed"). → check in Task 12 smoke test.
5. Korean IME on macOS: Enter while composing must not send early (TerminalPanel keyCode 229 path). → human checklist item, Task 15.

---

### Task 1: Platform helpers

**Files:**
- Create: `electron/platform.cjs`, `src/platform.ts`
- Test: `tests/platform.test.ts`

**Interfaces:**
- Produces (main): `isMac(platform = process.platform): boolean`, `isWin(platform?)`, `appSupportDir(home = os.homedir(), platform?, env = process.env): string` (win: `%APPDATA%\spawn`, mac: `~/Library/Application Support/spawn`).
- Produces (renderer): `isMac(): boolean` (from `navigator.platform`/`userAgentData`, overridable for tests via `setPlatformForTest(p)`), `modKey(e: KeyboardEvent | MouseEvent): boolean` (⌘ on Mac, Ctrl elsewhere), `modLabel(): '⌘' | 'Ctrl'`.

- [ ] Step 1: tests — `appSupportDir('/Users/a', 'darwin')` → `/Users/a/Library/Application Support/spawn`; win with `APPDATA=C:\x` → `C:\x\spawn`; `modKey({metaKey:true,ctrlKey:false})` true on mac, false on win; `modLabel()` per platform.
- [ ] Step 2: run, expect FAIL (modules missing).
- [ ] Step 3: implement both files.
- [ ] Step 4: run, expect PASS; full suite + tsc green.
- [ ] Step 5: commit `platform: helpers for the macOS port`.

### Task 2: Environment for apps started from Finder; claude, shell and git on Mac

**Files:**
- Create: `electron/shellEnv.cjs`
- Modify: `electron/main.cjs` (call once at start, before the server and terminals), `electron/adapters.cjs:38-42,97-103`, `electron/prereqs.cjs:19,31-41`
- Test: `tests/shell-env.test.ts`, extend `tests/adapters.test.ts`

**Interfaces:**
- Produces: `parseEnv(output: string): Record<string,string>`; `mergeLoginEnv({ env, run, timeoutMs = 3000, home }): Promise<Record<string,string>>` — `run(shell, ['-ilc', 'env -0'])` injected; on error/timeout returns `env` with PATH extended by `/opt/homebrew/bin:/usr/local/bin:<home>/.local/bin` (deduped) and `LANG` defaulted to `en_US.UTF-8` when unset. No-op on Windows.
- `claudeCommand()` on Mac: `~/.local/bin/claude` if it exists, else `'claude'`. Shell tab on Mac: `$SHELL || /bin/zsh` with `-l`, label key `셸` → shows "zsh"/basename. `prereqs` on Mac: git optional, check with `xcode-select -p` before running git, no Git Bash wording.

- [ ] Step 1: tests — `parseEnv('A=1\0PATH=/x\0')`; `mergeLoginEnv` with a `run` that rejects → PATH contains `/opt/homebrew/bin` once, LANG set; with a `run` that never resolves → returns within `timeoutMs`; with `platform='win32'` → returns env unchanged. Adapters: on darwin with a fake existing `~/.local/bin/claude` → that path; shell tab command on darwin → `/bin/zsh -l` when `SHELL` unset.
- [ ] Step 2: run, expect FAIL.
- [ ] Step 3: implement; in `main.cjs` replace `process.env` used for ptys/server with the merged env on Mac (store once, `cleanEnv` keeps working on it).
- [ ] Step 4: run, PASS; suite + tsc green.
- [ ] Step 5: commit `mac: login-shell PATH and LANG, claude at ~/.local/bin, zsh shell tab, git optional`.

### Task 3: Processes and temp folders on POSIX

**Files:** Modify `electron/terminals.cjs:40-47`, `electron/quitWatchdog.cjs:26`, `electron/history.cjs:109`. Test: extend `tests/quit-watchdog.test.ts`, `tests/electron-helpers.test.ts`.

**Interfaces:** `killTreeNow(pid, { platform, kill = process.kill, spawn })`: win → `taskkill` as now; posix → `kill(-pid, 'SIGKILL')`, falling back to `kill(pid, 'SIGKILL')`. Watchdog uses `'SIGKILL'` off Windows. History skips paths under `/var/folders/` and `/private/var/folders/`.

- [ ] Step 1: tests for each of the three with injected `platform`/`kill`.
- [ ] Step 2: FAIL. - [ ] Step 3: implement. - [ ] Step 4: PASS, suite green.
- [ ] Step 5: commit `mac: process groups instead of taskkill, SIGKILL watchdog, macOS temp skipped`.

### Task 4: "Hide prompts" setting found on every platform (privacy fix)

**Files:** Modify `server/cloud.js:72-74`. Test: extend `tests/cloud-privacy.test.ts`.

**Interfaces:** `defaultSettingsFile(env = process.env, home = os.homedir(), platform = process.platform)` → `join(appSupportDir(home, platform, env), 'settings.json')` (Task 1's helper, required from `../electron/platform.cjs`).

- [ ] Step 1: test — darwin, home `/Users/a` → `/Users/a/Library/Application Support/spawn/settings.json`; win32 unchanged; with that file holding `hidePrompts: true` the cloud payload has no prompt text.
- [ ] Step 2: FAIL. - [ ] Step 3: implement. - [ ] Step 4: PASS.
- [ ] Step 5: commit `cloud: find the settings file on macOS too (hide prompts was ignored there)`.

### Task 5: One manifest per platform

**Files:** Modify `electron/updater.cjs:140,167`, `scripts/release.mjs:136-154`. Test: create `tests/updater-manifest.test.ts`.

**Interfaces:** `manifestName(platform = process.platform, arch = process.arch): string` → `latest.json` (win32), `latest-mac-arm64.json`, `latest-mac-x64.json`; `appFilePattern(platform)` → win: `/^(spawn|claudex)-app-[\w.-]+\.zip$/` (unchanged), darwin: `/^spawn-app-[\w.-]+-mac-(arm64|x64)\.zip$/`. Exported from updater.cjs.

- [ ] Step 1: tests — names per platform/arch; win pattern accepts `claudex-app-1.3.48.zip`, rejects `spawn-app-1.3.49-mac-arm64.zip`; darwin pattern the reverse; the check() path asks `releaseFile('latest', manifestName())`.
- [ ] Step 2: FAIL. - [ ] Step 3: implement (release.mjs gains `writeManifest(platform, arch, {...})` used by Task 13). - [ ] Step 4: PASS.
- [ ] Step 5: commit `updater: a manifest per platform and arch; Windows unchanged`.

### Task 6: Applying an update on Mac

**Files:** Modify `electron/updater.cjs:183-211`, `electron/updateRunner.cjs:41-50,97-100`. Create `electron/mirrorDir.cjs`. Test: create `tests/mirror-dir.test.ts`, extend update-runner tests.

**Interfaces:**
- `mirrorDir(from, to, fsx = fs)`: copy everything (keeping modes), then delete files/dirs in `to` that are not in `from`; throws on the first failure before deleting anything.
- Mac unzip: `ditto -x -k <zip> <dir>`. Mac apply (runner, after quit): `mirrorDir(staged, <bundle>/Contents/Resources/app)`, then `codesign --force --deep --sign - <bundle>`, then relaunch with `UPDATED_FLAG` via `open -n <bundle> --args <flag>`.
- `bundlePath(resourcesPath)` → the `.app` folder (two levels up from `Contents/Resources`).
- Writable check before download: if the bundle is not writable or its path starts with `/private/var/folders/` (translocated), publish `{ status: 'available', error: t('맥: 앱을 응용 프로그램 폴더로 옮긴 뒤 업데이트해 주세요') }` and offer the full download link.

- [ ] Step 1: tests — `mirrorDir` on temp dirs (new file copied, changed file replaced, extra file removed, exec bit kept); failing copy leaves `to` untouched; translocated path → error status, no download started.
- [ ] Step 2: FAIL. - [ ] Step 3: implement (Windows branch untouched: tar.exe + robocopy). - [ ] Step 4: PASS.
- [ ] Step 5: commit `updater: apply on macOS with ditto, a mirrored copy and an ad-hoc re-sign`.

### Task 7: ⌘ shortcuts and the Edit menu

**Files:** Modify `src/components/TerminalPanel.tsx:124-199`, `src/Widget.tsx:194-233`, `electron/main.cjs:483-491`, tooltip strings `src/locales/widget.ts` (Ctrl+… entries), `src/Widget.tsx:969-979`. Test: create `tests/keys.test.ts`.

**Interfaces:** Create `src/keys.ts`: `appShortcut(e): 'view1'|…|'view5'|'prevTab'|'nextTab'|'newTab'|'closeTab'|'find'|'fontUp'|'fontDown'|'fontReset'|null` and `clipboardAction(e, hasSelection): 'copy'|'paste'|null`, both using `modKey`. Mac map: ⌘1–5, ⌘⇧[ / ⌘⇧], ⌘T, ⌘W, ⌘F, ⌘= / ⌘- / ⌘0; ⌘C copy (only with selection, else nothing), ⌘V paste; Ctrl+C never copies on Mac. Windows map exactly as today. Menu: on darwin keep role accelerators (no `registerAccelerator: false`) and add a Window menu (minimize ⌘M). Font size by wheel: ⌘+wheel on Mac; trackpad pinch (`ctrlKey` wheel on Mac) stepped at most once per 120 ms.

- [ ] Step 1: tests — table of key events → action for win and mac (incl. Ctrl+C on mac → null, Ctrl+V on mac → null so it reaches the pty).
- [ ] Step 2: FAIL. - [ ] Step 3: implement `keys.ts`, wire TerminalPanel and Widget to it; tooltips use `modLabel()`. - [ ] Step 4: PASS; Windows test build: Ctrl shortcuts unchanged.
- [ ] Step 5: commit `keys: one shortcut map, ⌘ on macOS`.

### Task 8: Paths and links on Mac

**Files:** Modify `src/components/TerminalPanel.tsx:381` (`FILE_REF`), `electron/main.cjs:1165-1168`. Test: extend the terminal link tests (or create `tests/file-ref.test.ts` exporting `FILE_REF` from a small module `src/fileRef.ts`).

**Interfaces:** `src/fileRef.ts` exports `FILE_REF: RegExp` (moved from TerminalPanel) matching also `/Users/me/a.ts:12` and `~/proj/a.ts`; `vscodeUrl(abs: string): string` in main → `vscode://file/` + path with forward slashes and no double slash.

- [ ] Step 1: tests — POSIX absolute and `~/` paths with `:line` linked; Windows cases unchanged; `vscodeUrl('/Users/a/x.ts')` → `vscode://file/Users/a/x.ts`; `vscodeUrl('C:\\a\\x.ts')` unchanged from today.
- [ ] Step 2–4: FAIL → implement → PASS. - [ ] Step 5: commit `terminal: link macOS paths; vscode link without a double slash`.

### Task 9: Fonts

**Files:** Modify `src/termFont.ts:17-20`, `src/styles/widget.css:36,280`, `src/styles/pokedex.css:484,571`, `src/styles/widget-expanded.css:157,298,417,439`, `electron/status-card.html:12`, `src/components/SettingsView.tsx:196-197`, `electron/settings.cjs:19`, `src/locales/settings.ts:82`. Test: extend `tests/settings.test.ts`.

**Interfaces:** every Korean stack gains `'Apple SD Gothic Neo'`, Japanese `'Hiragino Sans'`, mono `'SF Mono', Menlo`; the terminal font setting value `consolas` renders Menlo on Mac (label "Menlo" on Mac).

- [ ] Steps: test the setting label/value per platform → FAIL → implement → PASS → commit `fonts: macOS faces in every stack`.

### Task 10: Window, modes, widget, toast, shutdown on Mac

**Files:** Modify `electron/main.cjs:617-908` (window creation, modes, toast), `electron/main.cjs:704-708`, `src/Widget.tsx:985-992`, `src/styles/widget-expanded.css` (Mac rules), `index.html`/renderer root (add `is-mac` class from `isMac()`). Create `electron/macWindow.cjs`. Test: create `tests/mac-window.test.ts`.

**Interfaces:** `macWindowOptions(mode: 'widget'|'window'|'fullscreen')` → for window/fullscreen `{ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }`, for widget `{ frame: false }` (no traffic lights); `fillWorkArea(win, screen)` sets bounds to the display work area and remembers the previous bounds (our own maximize; `restore` puts them back); `dockFor(mode, dock)` hides the Dock in widget mode and shows it otherwise. CSS: `.is-mac .w-win-controls { display: none }`, header left padding 78px in window/fullscreen modes. Toast window: `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`. Widget: `setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })`. Shutdown: `powerMonitor.on('shutdown')` runs the same "keep open sessions" path as Windows session-end; the quit sequence finishes within 2 s on Mac (no long `preventDefault` at logout).

- [ ] Step 1: tests — options per mode; `fillWorkArea` then `restore` returns the original bounds (fake window/screen); `dockFor('widget')` calls `hide`, `dockFor('window')` calls `show`; none of them run on win32.
- [ ] Step 2–4: FAIL → implement → PASS; Windows test build: header, buttons, modes look and behave as before.
- [ ] Step 5: commit `mac: traffic lights, filled full screen, Dock hidden in widget mode, toast on all Spaces, shutdown kept`.

### Task 11: Words per platform

**Files:** Modify `src/locales/widget.ts:63,139,196,401`, `src/locales/settings.ts:27,76-78`, `src/components/SessionTabs.tsx:36,102`, `src/Widget.tsx:78,487`, `src/components/SettingsView.tsx:193`. Test: extend `tests/game-text.test.ts` or create `tests/platform-words.test.ts`.

**Interfaces:** `platformWord(key: 'tray'|'startup'|'taskbar'|'shell', mac: boolean)` in `src/platform.ts` returning a translation key; ko/en/ja entries: tray → "메뉴 막대" / "menu bar" / "メニューバー", startup → "로그인 시 실행" / "Open at login" / "ログイン時に起動", taskbar flash → "Dock 아이콘 튀기기" / "bounce the Dock icon" / "Dockアイコンを弾ませる", shell → basename of `$SHELL` (zsh).

- [ ] Steps: test each key in three languages for mac and win (win strings unchanged) → FAIL → implement → PASS → commit `words: menu bar, login, Dock and zsh on macOS`.

### Task 12: Mac build config and CI with a smoke launch

**Files:** Modify `package.json` (`build.mac`, `build.files` excludes per platform), create `build/icon.icns` (from `build/icon.png` 1024 via `iconutil` in CI if missing locally), `.github/workflows/mac.yml`, extend `.github/workflows/ci.yml` matrix with `macos-14`. Modify `electron/main.cjs` for a `--smoke-test` flag. Create `scripts/smoke-mac.mjs`.

**Interfaces:**
- `build.mac`: `{ target: ['dir'], icon: 'build/icon.icns', category: 'public.app-category.developer-tools', identity: null, hardenedRuntime: false }`; node-pty prebuilds of other platforms excluded (`!node_modules/node-pty/prebuilds/win32-*/**` for mac).
- `mac.yml` (workflow_dispatch input `version`, also on push to `main` for tests only): jobs `arm64` on `macos-14`, `x64` on `macos-13`: `npm ci` → `npx vitest run` → `npx tsc --noEmit` → `vite build` → `electron-builder --mac dir --<arch>` → `codesign --force --deep --sign - release/mac*/spawn.app` → `scripts/smoke-mac.mjs` → zips with `ditto -c -k` (`spawn-app-<v>-mac-<arch>.zip` = contents of `Contents/Resources/app`; `spawn-<v>-mac-<arch>.zip` = the whole `spawn.app` with `--keepParent`) → upload artifacts `mac-<arch>` (zips + screenshots + sha256s + `electron` version).
- `--smoke-test`: start, open a shell session, write `echo spawn-ok`, wait for `spawn-ok` in the pty output, switch window → widget → full screen taking `webContents.capturePage()` PNGs into `$SPAWN_SMOKE_DIR`, then quit with code 0 (non-zero on any failure). `smoke-mac.mjs` runs the app binary with that flag and a 60 s timeout and checks `spawn-helper` is executable.

- [ ] Step 1: run the workflow on a branch (`gh workflow run mac.yml --ref mac-port -f version=0.0.0-test`), expect FAIL until config exists.
- [ ] Step 2: implement; push; rerun.
- [ ] Step 3: download the artifacts (`gh run download`), look at the screenshots (window, widget, full screen), confirm `spawn-ok`, both arches green.
- [ ] Step 4: commit `mac: build config, CI build and smoke launch with screenshots`.

### Task 13: One release command for Windows and Mac

**Files:** Modify `scripts/release.mjs`. Test: extend release script unit tests (or create `tests/release-mac.test.ts` for the pure parts).

**Interfaces:** after the Windows publish, `releaseMac(version)`: `gh workflow run mac.yml -f version=<v>` → wait (`gh run watch`) → `gh run download` into `release/mac/` → for each arch `writeManifest('darwin', arch, { version, app: { file, sha256 }, full: { file }, electron, notes, notesEn, notesJa })` signed with `scripts/signing.mjs` → `gh release upload v<v>` the four zips and two manifests. Fails loudly (Windows release already out, Mac can be retried with `node scripts/release.mjs --mac-only <v>`). Test builds (no `--publish`) stay Windows-only.

- [ ] Step 1: tests — manifest content and signature verify with `verifyManifest`; asset names match Task 5 patterns.
- [ ] Step 2–4: FAIL → implement → PASS; dry run against a throwaway tag on a draft release, then delete it.
- [ ] Step 5: commit `release: Mac builds from CI signed and uploaded with the Windows release`.

### Task 14: Site — Mac download

**Files:** `Documents\spawn-site\index.html`, `assets/js/loading.js` (download links), `assets/js/i18n.js` (ko/en/ja), `assets/css/site.css`. (Outside the repo; deploy only when the user says so.)

**Interfaces:** on a Mac visitor (`navigator.userAgentData.platform === 'macOS'` or UA), the download button offers "Apple Silicon" and "Intel" (`spawn-<v>-mac-arm64.zip` / `-x64.zip`), with one line: first launch → 시스템 설정 › 개인정보 보호 및 보안 › "그래도 열기". FAQ gains "맥에서 처음 열 때 경고가 떠요". Windows visitors see what they see today.

- [ ] Steps: check in a lab copy with a spoofed UA (mac and win) at desktop and 390 px → commit nothing (not a repo) → show the user.

### Task 15: Tester checklist and handoff

**Files:** Create `docs/macos-test-checklist.md`; modify `docs/HANDOFF.md` (new 7-x entry, section 8), `CHANGELOG.md` (three sections) at release time.

**Interfaces:** the checklist, ~15 minutes, in Korean with screenshots expected: download + "Open Anyway"; Claude login and one session; Korean input with Enter mid-composition; a catch toast; ⌘C / ⌘V in the terminal and in inputs; ⌘1–5; widget mode Dock hides/returns; full screen fill and restore; menu bar icon; launch at login; an update from test version A to B (release two test versions to a draft); feedback send; quit and reopen keeps sessions.

- [ ] Steps: write → review with the user → release.
