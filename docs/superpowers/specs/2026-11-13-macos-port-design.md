# spawn for macOS — design (2026-11-13)

## Why
The user wants a macOS build of spawn that does everything the Windows build does. The user has no Mac and can find a tester, but wants that testing kept to a minimum. Where something cannot work the same on macOS, say so before substituting, and pick the option that keeps the most working.

## Goals
- Same features as Windows: built-in Claude Code / Codex / shell terminals, party Pokémon, encounters and catches, dex, box, log, ranking, widget / window / full-screen modes, tray (menu bar), notifications and catch toasts, in-app updates, launch at login, feedback, privacy settings.
- Both Apple Silicon (arm64) and Intel (x64).
- One release command on this Windows PC ("푸시해") ships Windows and Mac together; the update signing key never leaves this PC.
- Testing mostly automated on a macOS CI runner (tests + launch the built app + screenshots I can read); one ~15-minute human checklist on a real Mac at the end.

## Non-goals (for now)
- Apple Developer ID signing and notarization. Later, before a wider public launch.
- Mac App Store.
- Changing anything about the Windows build's behaviour (Windows must stay byte-for-byte the same in what it does; shared code only gains `if mac` branches).

## Decisions (the user's, 2026-11-13)
1. **Signing**: start without an Apple Developer account. Builds are ad-hoc signed (free, required on Apple Silicon). Users open the first download once via System Settings → Privacy & Security → "Open Anyway". The site's download section says so for Mac.
2. **Updates**: changed files only, as on Windows (~16 MB `app` zip). After applying it, the app re-signs itself ad-hoc with the system `codesign` (ships with macOS, no Xcode needed) so the bundle's seal stays valid. Full-app replacement only when the Electron version changes (as `needsFull` already decides). When a Developer ID is added later, switch Mac to full replacement (a notarized app is checked on every launch; patching would break it) — noted, not built now.
3. **Window buttons**: native macOS traffic lights at top-left (window and full-screen modes); the header's brand moves right to leave room; the custom minimize / maximize / close buttons are hidden on Mac. The widget keeps its own buttons, no traffic lights.
4. **Widget mode**: hide the Dock icon while in widget mode (`app.dock.hide()`), show it again when leaving. macOS can only hide it app-wide, so it may blink once on mode change.
5. **Full screen**: same as Windows — fill the screen's work area (our own maximize). The green traffic light still gives native macOS full screen.

## Cannot be the same on macOS (already told the user)
- First launch needs "Open Anyway" once (no Developer ID).
- Dock visibility is app-wide (see 4).
- Shortcuts move from Ctrl to ⌘ (⌘C/⌘V copy and paste, ⌘1–5 views, ⌘T/⌘W tabs, ⌘ + wheel / pinch for text size). Ctrl+C is always interrupt in the terminal; Ctrl+V still goes to Claude for image paste.
- macOS asks once per protected folder (Documents, Desktop, Downloads) when a session opens there.
- Windows-only extras are dropped on Mac: taskbar shortcut icon repair, relaunch details; the taskbar flash becomes a Dock bounce.

## The work, by area (from the 2026-11-13 audit)
1. **Environment**: an app opened from Finder has a bare PATH and no LANG. At start, read the login shell's environment (`$SHELL -ilc env`, with a timeout) and merge PATH; default `LANG` to a UTF-8 locale. Find `claude` at `~/.local/bin/claude` first. Shell tab = `$SHELL` (zsh), labelled "Terminal"/"zsh" not "PowerShell". Git: optional on Mac (no Git Bash); never trigger the Xcode tools prompt.
2. **Process handling**: kill trees with process groups (`process.kill(-pid)`), not `taskkill`; quit watchdog uses SIGKILL; skip macOS temp folders in history.
3. **Updater**: unzip with `ditto`; copy with `fs.cpSync` + remove extras instead of robocopy; re-sign ad-hoc; per-platform manifests (`latest.json` stays exactly as it is for Windows; new `latest-mac-arm64.json`, `latest-mac-x64.json`) and asset names `spawn-app-<v>-mac-<arch>.zip`; `releaseFile` picks by platform and arch. Old Windows clients see nothing new.
4. **Build and release**: `mac` block in package.json (icns, `dir` target, arm64 + x64, prune other platforms' node-pty prebuilds, keep `spawn-helper` executable). A GitHub Actions macOS workflow builds both arches, runs tests, launches the app for a smoke test, uploads unsigned-manifest zips as artifacts. `release.mjs --publish` on Windows: builds and publishes Windows as now, then triggers/waits for the Mac workflow, downloads its zips, signs the Mac manifests with the local key, uploads them to the same GitHub release. Full Mac download: a zip of `spawn.app` made with `ditto` (dmg later).
5. **Window and modes**: `titleBarStyle: 'hiddenInset'` + `trafficLightPosition` for window/full-screen; hide custom buttons; brand offset; full screen = set bounds to the work area and track it ourselves (maximize events are unreliable on frameless Mac windows); widget: Dock hide/show, `setVisibleOnAllWorkspaces` so it follows Spaces; toast window uses `skipTransformProcessType: true`.
6. **Keys**: one `isMac ? metaKey : ctrlKey` helper for app shortcuts; Edit menu keeps its accelerators on Mac (copy/paste in inputs only work through the menu there) plus a Window menu; terminal copy/paste on ⌘; throttle pinch-zoom; tooltips show ⌘.
7. **Files and links**: link POSIX absolute paths and `~/…` in the terminal; fix `vscode://file/` double slash.
8. **Fonts**: add Apple SD Gothic Neo, Hiragino Sans, SF Mono / Menlo to the stacks; the "Consolas" setting becomes "Menlo" on Mac.
9. **Shutdown**: `powerMonitor 'shutdown'` freezes the reopen list; make quit fast enough not to cancel a macOS logout.
10. **Privacy bug**: `server/cloud.js` finds settings through `%APPDATA%` only, so on Mac "hide prompts" could be ignored. Pass the settings path from Electron (both platforms).
11. **Words**: per-platform strings (tray → menu bar, Windows startup → login, taskbar → Dock, PowerShell → Terminal) in ko / en / ja.
12. **Site**: download button offers Mac (Apple Silicon / Intel) when the visitor is on a Mac; a short "first launch: Open Anyway" note; FAQ line.

## Testing
- Every change keeps the Windows tests green (`vitest`, `tsc`) and a Windows test build is checked before release.
- New unit tests for: platform helpers (key mapping, path linking), manifest selection per platform/arch, PATH merge, updater copy logic (on a temp folder).
- macOS CI: the same test suite on `macos-latest`, then build `spawn.app` (arm64 on the arm runner, x64 on an Intel runner), launch it with a smoke flag that opens a shell session, runs `echo spawn-ok`, checks node-pty output, takes window screenshots of window / widget / full-screen modes, quits; screenshots uploaded as artifacts for me to review.
- Human checklist (~15 min) for the tester: install via "Open Anyway", log in to Claude, run a session, Korean input, a catch toast, ⌘C/⌘V, widget mode Dock behaviour, an in-app update from one test version to the next.

## Left to the builder
- Exact `trafficLightPosition` and brand offset, menu contents, the smoke-test flag's name, CI runner labels, whether the Mac full download is zip or dmg first (zip first is fine).

## Changes after review (2026-11-13)
- **No in-app full-screen button on a Mac.** This is the owner's decision. The page's own window buttons, the full-screen one among them, give way to the traffic lights. The work area is filled from the saved mode: macOS's zoom or its green-button full screen is taken as the fullscreen mode.
- **Fonts are bundled** (main 1.3.50: Monaspace Neon, Pretendard, Uncut Sans in `public/fonts`). A Mac renders the same faces as Windows. Its terminal stacks keep Menlo and Monaco ahead of any proportional face, in case a bundled file fails to load.
- **The Mac release is opt-in and ships as 1.4.0.** `release.mjs --publish` alone is the Windows release, as before. The Macs go out only with `--publish --with-mac`, or later with `--mac-only <version>`. CI is started on the release's tag and its run is found by the tag's commit. The first Mac release will be version 1.4.0.
- **`--mac-allow-unsmoked` is removed.** A failed or missing smoke launch always fails that arch. With mac.yml as it is, a failed smoke launch also skips the Zip step, so the flag could not have worked anyway.
