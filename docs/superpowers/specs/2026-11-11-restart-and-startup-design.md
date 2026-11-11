# Faster update restart and a window before the server — design

Date: 2026-11-11. Agreed in chat with the user ("웅 그렇게 진행하자") after the
measurements below. Follows the 2026-11-10 optimization (HANDOFF 7-23), whose
"deferred big items" list this replaces: only A and B are kept; the other five
(diff broadcasts, old-session cleanup, sprite worker, tray menu rebuilds,
streamed logs) were dropped because the numbers show they cost almost nothing.

## Why

What the user feels is time with no Claudex on screen:

- **Update restart: about 17 s** from clicking restart to the new window
  (installed 1.3.33, 2026-11-11 01:39:44Z → 01:40:01.98Z in
  `%APPDATA%\Claudex\logs\claudex.log` and `update.log`).
- **Cold start after Windows boot: about 11 s** with nothing visible, of
  which 9 s is waiting for the server (01:15:39.97Z start → 01:15:49.04Z
  server ready → 01:15:51.22Z window). A normal start is about 2 s.

## Measurements (2026-11-11)

Update restart, one run, real app, 12 sessions open:

| step | from → to | time |
|---|---|---|
| quit sequence (sessions ended, server told, `terminals.shutdown(3000)`) | 44.6 → 48.1 | 3.5 s |
| old main exits, relaunched process 2 starts, robocopy (`update.log` 50.77) | 48.1 → 50.8 | 2.7 s |
| **unexplained**: process 2 deletes the staged folder, relaunches; process 3 starts and writes its first log line | 50.8 → 00.08 | **9.3 s** |
| process 3: server ready, page loaded | 00.08 → 01.98 | 1.9 s |

Side measurements (copy of the installed `resources/app`: 9,096 files,
39 MB, 9,005 of them in `node_modules`):

- robocopy `/MIR` when nothing changed: 0.4 s. Unchanged files keep their
  original timestamps through the zip (8,472 files dated 2026-11-05), so
  robocopy already copies only the ~140 changed files. **"Copy only changed
  files" is already true — no work needed there.**
- `fs.rmSync` of the 9,096-file staged folder: 1.9 s (runs synchronously in
  process 2 before it relaunches, `electron/updater.cjs:235`).
- A full copy of the same tree: 24 s (Windows Defender scanning new files).
  This is why freshly copied files are a suspect for the rest of the 9.3 s.

## Goals

- **A.** Update restart from ~17 s to **about 7 s or less**, click to window.
- **B.** A Claudex window on screen **within about 1 s of launch**, also on a
  cold boot, showing that it is starting; the real page replaces it as soon
  as the server is ready.

## Non-goals

- No change to what the app looks like or does once it is up.
- No change to the update format, signing, channels or `release.mjs`.
- Not reworking the quit sequence's safety (the stuck-quit fix of 1.3.32:
  tree kill → wait → pty `kill()` → drain → watchdog) — only shortening waits
  that the measurements prove are idle.

## Anti-goals (a failure even if it is faster)

- An update that applies half-way, loops, or loses `pokedex.json` / window
  state / session names.
- An old Claudex process left running after a restart (the 1.3.32 bug).
- A loading window that flashes, appears in the wrong place or mode, shows
  when the user chose "start in the tray", or stays up when the server fails
  (today's error dialog + quit must still happen).
- A second window or a window that cannot be closed.

## A. Update restart

1. **Measure first (stage 1).** Add timestamps to `update.log` for every
   step, each process writing its own line with its pid: restart clicked;
   quit sequence start/end and each part (sessions posted, flush,
   `terminals.shutdown`, server stop); process 2 start; robocopy start/end and
   exit code; staged-folder removal start/end; relaunch called; process 3
   start (first line of `main.cjs`), instance lock taken (and how many 250 ms
   waits `takeInstanceLock` needed), server spawned, server ready, window
   loaded. The user runs one real update restart with this build (two test
   builds: one to install the logging, one to restart into) and we read the
   numbers before choosing what to change.
2. **Known fix: take the staged-folder deletion off the critical path.**
   Process 2 renames the staged folder's parent to a "to delete" name next to
   it (instant) instead of `fs.rmSync`; process 3 deletes it in the
   background some seconds after its window is up (async, errors ignored,
   retried on the next start if anything is left). Saves ~2 s.
3. **Then fix what stage 1 shows**, for the likely causes:
   - (not the lock wait: `takeInstanceLock` runs after process 3's first log
     line, so it is outside the 9.3 s; stage 1 still logs it, since it adds
     to the time before the window)
   - process 2's exit and Electron's relauncher waiting on it;
   - Defender / cold disk reading the copied files → nothing to copy less of,
     but it can be overlapped (B makes this time visible as a loading window
     instead of nothing);
   - process 2 being a full Electron start just to run robocopy → possible,
     but only if numbers say it matters;
   - quit sequence 3.5 s → only waits shown to be idle (e.g. the server flush
     or session posts waiting their full timeout).
   Each change goes in only with its measured saving.

## B. Window before the server

- At launch, as soon as the app is ready (after the instance lock and
  window-state read), show a **small status card** (the same card as C):
  a local page shipped with the app (no server needed) with the app's drawn
  ball icon and "준비하고 있어요" (Korean / English / Japanese, following
  설정 › 앱 › 언어), in the app's dark colours, centred where the app window
  will open. (Claude's call, revised after the builder check: a small card
  instead of a full-size placeholder window, so the same card serves A/B/C and
  the widget's transparent window never shows a half-drawn page.)
- When the server is ready and the token checked (today's code path), the
  real app window is built hidden as today, and when it shows itself
  (`ready-to-show`) the card goes. No flash: the card stays until the real
  window is on screen.
- "Start in the tray" (`app.startHidden`): no loading window at all,
  behaviour as today.
- Server fails to start: the loading window closes, today's error dialog and
  quit happen.
- Dev runs (`electron .`, Vite) behave the same, so it can be checked in the
  isolated setup.

## C. An "updating" window through the whole update restart (user: "업데이트중 창까지 이번에 넣고 다 하자")

- From "restart" clicked until the real page is back, a small Claudex card
  stays on screen: "업데이트하는 중이에요" (process 1 while it quits, process 2
  while it copies), then "준비하고 있어요" (process 3, = B's loading window).
  Same card, same place (centred on where the app window was), so the hand-off
  between processes reads as one window, not three.
- Process 1 and process 2 run the *previously installed* code, so their part
  shows from the update after the one that ships this; process 3's part shows
  at once. Said plainly in the release notes for the developer (HANDOFF), not
  as a user-facing promise.
- Process 2 must wait for Electron to be ready to show a window, so its copy
  runs asynchronously; nothing else of the app (log tee, lock, server,
  tray) starts in process 2.
- The card is not a way into the app: no buttons; closing it does nothing
  harmful (process 1/2 keep going and the card simply goes).

## Constraints

- Windows only (the app ships for Windows); Electron 33, CommonJS main.
- Tests first for logic that can be tested (`tests/*.test.ts`, vitest,
  Windows must pass: 512 passed / 10 skipped baseline,
  `npx tsc --noEmit -p .` = 0).
- Screens checked with the isolated capture setup (HANDOFF "시험 실행은
  격리한다"); the real update path can only be checked by the user's own
  restart, so stage 1 needs two test builds and one user restart.
- Release only when the user says "푸시해".

## Decisions made by Claude (the user can overrule)

- **What "window" means in goal A**: the real page, usable (the loading
  window counts as progress, not the finish). Measured from "restart clicked"
  to "App window loaded" of the real page.
- **Stages and builds**: this plan covers stage 1 logging + A.2 (rename) + B
  in one test build. The user restarts into it once (that restart still runs
  the old code), then restarts once more into a second test build — that
  second restart runs the new process-2 code and gives the numbers, each step
  separately logged, so the savings stay separable. Stage 3 (fixes chosen from
  the numbers) is planned after that, as its own small plan.
- **Closing the loading window**: same as closing the app window today (it
  hides; the tray brings it back). To make that safe, the tray is created at
  launch, before waiting for the server, and a reopen during startup shows
  the loading window instead of doing nothing.

## Left to the builder

- Exact log line format; where the timing helper lives.
- How the loading page is built (static HTML file vs a small page in the Vite
  build) as long as it needs no server and uses the app's look.
- How to hand the window from the loading page to the real page.
- Naming and location of the "to delete" folder.
