# Update Restart, Startup Card and Timings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Something Claudex-shaped is on screen from the moment an update restart is clicked (or the app is launched) until the real window is up, the staged-folder deletion leaves the restart path, and every step of an update restart is timed in `update.log`.

**Architecture:** Three small CommonJS modules in `electron/` — a status card window (`statusCard.cjs` + `status-card.html`), a step timer (`updateTiming.cjs`), and the process-2 update runner (`updateRunner.cjs`, taking over `applyPendingUpdate`) — wired into `main.cjs` at three points: top of file (process 2), `startApp` (card + tray before the server), and `before-quit` (card during an update quit). Pure parts get vitest tests with injected deps; window behaviour is checked with the isolated capture setup.

**Tech Stack:** Electron 33 (CommonJS main), Node child_process (robocopy), vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-restart-and-startup-design.md`

## Global Constraints

- Windows only; Electron 33; CommonJS in `electron/`.
- `npm test` all pass on Windows (baseline 512 passed / 10 skipped) and `npx tsc --noEmit -p .` = 0 after every task.
- No change to the update format, signing, channels, `release.mjs`, or the quit safety steps (tree kill → wait → pty `kill()` → drain → watchdog).
- Card copy: ko "업데이트하는 중이에요" / en "Updating…" / ja "アップデート中です"; ko "준비하고 있어요" / en "Getting ready…" / ja "準備しています".
- Card: no buttons, not in the taskbar, not focusable, the app's dark colours (`WINDOW_BACKGROUND` `#0b0c10` family, ink and amber tokens from `src/styles`), the drawn icon `electron/assets/icon.png`.
- "Start in the tray" (`app.startHidden`) shows no card at launch.
- Release only on "푸시해".

## Review Focus

- **Server never comes up** (port taken, crash): the card must close before today's error dialog, and the app must quit; no card left behind. → Task 4 manual check + `closeStatusCard` idempotent test (Task 1).
- **Pending marker but bad staged folder** (missing, no package.json, robocopy ≥ 8): process 2 must not loop; it relaunches into the old code once, marker gone, and logs why. → Task 3 tests.
- **Second launch while the card is up** (user double-clicks the shortcut during a slow cold boot): it should bring the card forward, not do nothing and not start a second server. → Task 4 `reopenAction` test.
- **User closes / Alt+F4s the card**: nothing else happens; startup or update keeps going; the real window still appears. → Task 1 (card `closable` false is not used; closing just destroys it) + Task 4 manual check.
- **Stale `claudex-update-*` folders in %TEMP%** from failed or older updates: cleaned in the background after the window is up, never the one a download in this run just made. → Task 3 `cleanupStaleUpdates` test.

---

### Task 1: Status card window

**Files:**
- Create: `electron/statusCard.cjs`, `electron/status-card.html`
- Modify: `electron/i18n.cjs` (the two strings, en + ja)
- Test: `tests/status-card.test.ts`

**Interfaces:**
- Produces:
  - `cardBounds(near: {x,y,width,height} | null, workArea: {x,y,width,height}) => {x,y,width,height}` — 300×96, centred on `near` (else on `workArea`), clamped inside `workArea`.
  - `cardUrl(htmlPath: string, step: 'updating'|'starting', lang: 'ko'|'en'|'ja') => string` — `file://` URL with `?step=&lang=`.
  - `openStatusCard({ BrowserWindow, screen, near, step, lang }) => { win, setStep(step), close() }` — frameless, transparent, `skipTaskbar`, `focusable:false`, `resizable:false`, shows on `ready-to-show`; `close()` is idempotent and safe after the window is destroyed.
- `status-card.html`: self-contained (inline CSS, no network), reads `step`/`lang` from the query, icon `assets/icon.png` relative, a small pulsing dot (respects `prefers-reduced-motion`), text from an inline ko/en/ja table (copy from Global Constraints).

- [ ] **Step 1: Write failing tests** — `cardBounds` centres on a 1200×760 window at (100,100) → `{x:550, y:432, width:300, height:96}`; with `near:null` centres on the work area; a `near` hanging off the work area's right edge is clamped so `x + 300 <= workArea.x + workArea.width`. `cardUrl('C:\\a\\status-card.html','updating','ja')` starts with `file:///` and ends with `?step=updating&lang=ja`. `openStatusCard` with a fake `BrowserWindow` class: options include `skipTaskbar:true, focusable:false, frame:false, transparent:true, show:false`; calling `close()` twice calls `destroy` once; `close()` after the fake reports `isDestroyed()` true does nothing.
- [ ] **Step 2:** `npx vitest run tests/status-card.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `statusCard.cjs` and `status-card.html`; add the two strings to `i18n.cjs` en/ja.
- [ ] **Step 4:** `npx vitest run tests/status-card.test.ts` → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(update): a small status card window for updating/starting`.

### Task 2: Step timer

**Files:**
- Create: `electron/updateTiming.cjs`
- Test: `tests/update-timing.test.ts`

**Interfaces:**
- Produces: `createStepTimer({ file: string, label: string, now = Date.now, pid = process.pid }) => { mark(step: string, extra?: string): void }` — appends one line per mark to `file`: `<ISO time> pid=<pid> <label> <step> +<ms since previous mark>ms[ total=<ms since first>ms][ <extra>]`; never throws (fs errors swallowed).

- [ ] **Step 1: Write failing tests** — with `now` stepping 1000, 1250, 1900 and a temp file: three marks produce three lines; line 2 contains `pid=42 quit sessions-ended +250ms total=250ms`; line 3 `+650ms total=900ms`; `extra` is appended; a `file` in a missing folder → `mark` does not throw.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** Commit `feat(update): step timer lines in update.log`.

### Task 3: Process-2 update runner and stale-folder cleanup

**Files:**
- Create: `electron/updateRunner.cjs`
- Modify: `electron/updater.cjs:212-239` (remove `applyPendingUpdate`; `pendingFile` exported for the runner and `restart()`), `electron/main.cjs:43`
- Test: `tests/update-runner.test.ts`

**Interfaces:**
- Consumes: `openStatusCard` (Task 1), `createStepTimer` (Task 2).
- Produces:
  - `hasPendingUpdate(userData: string) => boolean`
  - `runPendingUpdate({ app, isPackaged, resourcesPath, userData, readNear, lang, spawn, openCard, timer }) => Promise<{ ok: boolean, reason?: string }>` — reads and removes `pending-update.json` first (no loop), validates `staged/package.json`; if packaged and valid: opens the `updating` card (via `openCard`, after `app.whenReady()`), runs robocopy **asynchronously** with today's arguments (`/MIR /R:20 /W:1 /NFL /NDL /NJH /NJS /NP`), `ok = code < 8`; does **not** delete the staged folder; marks `p2-start`, `robocopy-start`, `robocopy-end` (extra `code=<n>`), `relaunch`; then `app.relaunch({ args: [...process.argv.slice(1), '--claudex-updated'] })` and `app.exit(0)` — both when ok and when not (not ok = start the old code once, reason logged).
  - `cleanupStaleUpdates({ tmpdir: string, keep?: string|null, rm = fs.promises.rm }) => Promise<number>` — removes every `claudex-update-*` folder in `tmpdir` except `keep`; returns how many it removed; errors per folder ignored.
- `main.cjs:43` becomes: `if (hasPendingUpdate(app.getPath('userData'))) { runPendingUpdate({...}).catch(() => { app.relaunch(); app.exit(0) }); return }` — top-level `return` (CJS) so nothing else in main runs in process 2. `readNear` reads `window-state.json` bounds (`widgetBounds`) without the rest of main; `lang` from `settings.json` `app.language` ('auto' → `app.getLocale()` mapped to ko/en/ja).

- [ ] **Step 1: Write failing tests** (fake `app` with `whenReady`, `relaunch`, `exit` spies; fake `spawn` returning an EventEmitter that emits `exit` with a code; temp userData):
  - no marker → `hasPendingUpdate` false.
  - marker + valid staged + code 1 → `{ok:true}`; marker file gone; card opened with step `updating` then closed; spawn called with `robocopy` and the staged + `<resourcesPath>/app` args; staged folder still exists; `relaunch` called with args containing `--claudex-updated`; `exit(0)` called; timer marks in order `p2-start, robocopy-start, robocopy-end, relaunch`.
  - marker + valid staged + code 8 → `{ok:false}`; still relaunch + exit once; marker gone.
  - marker pointing at a missing folder → `{ok:false, reason:'no staged app'}`, spawn not called, relaunch + exit once.
  - `isPackaged:false` → spawn not called, `{ok:false}`.
  - `cleanupStaleUpdates`: tmpdir with `claudex-update-a`, `claudex-update-b`, `other` and `keep = …/claudex-update-b` → removes only `a`, returns 1.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement `updateRunner.cjs`; change `updater.cjs` and `main.cjs:43`.
- [ ] **Step 4:** `npx vitest run tests/update-runner.test.ts` → PASS; `npm test` all pass (`update-download`/`update-signing` unchanged).
- [ ] **Step 5:** Commit `feat(update): copy the update behind a status card, leave the staged folder for later`.

### Task 4: Card at startup, tray first, timings, cleanup, card during an update quit

**Files:**
- Modify: `electron/main.cjs` (`startApp` 453-512, `buildAppWindow` ready-to-show 647-654, `before-quit` 1205-1231, `reopen` 1165-1174), `electron/helpers.cjs:137-141`
- Test: `tests/electron-helpers.test.ts:322-327`

**Interfaces:**
- Consumes: Tasks 1–3.
- `reopenAction` returns a new value `'card'` when `starting` and `hasCard`: signature `reopenAction({ quitting, starting, hasWindow, windowCount, hasCard = false })`.
- Process 3 timer: `createStepTimer({ file: <userData>/update.log, label: 'p3' })` used only when `process.argv` includes `--claudex-updated`; otherwise startup marks go to `claudex.log` via `console.log('[main] startup: <step> +<ms>ms')`. Steps: `start`, `lock`(extra `waits=<n>`; `takeInstanceLock` returns the count), `server-spawned`, `server-ready`, `window-loaded`.
- Process 1 timer (label `p1`) only when the quit is an update restart (`pending-update.json` exists at `before-quit`): `quit-start`, `sessions-posted`, `flushed`, `sessions-ended`, `server-stopped`.

- [ ] **Step 1: Update the `reopenAction` test** — add `expect(h.reopenAction({ starting: true, hasWindow: false, windowCount: 0, hasCard: true })).toBe('card')`; keep the four existing assertions.
- [ ] **Step 2:** run `npx vitest run tests/electron-helpers.test.ts` → FAIL.
- [ ] **Step 3:** Implement:
  - `helpers.reopenAction` `'card'`; `reopen` in main: `'card'` → `startupCard.win.show()`.
  - `startApp`: before `probeServer`: read window state, `refreshMenus()`, `createTrayIcon()`, and unless `startHidden` open the `starting` card near `boundsFor(kindOf(modeNow()))`. Remove the later `refreshMenus/createTrayIcon` calls. On every failure path (`conflict`, server not ready in packaged) close the card before the dialog.
  - Close the card when the app window first shows (`win.once('show')` on the window `startApp` creates) and also if `startHidden`/hidden path; `maybeCaptureScreenshot` unaffected.
  - 10 s after `window-loaded`: `cleanupStaleUpdates({ tmpdir: os.tmpdir() })` (no `keep`: nothing has been downloaded yet in this run's first 25 s — the first update check is at 15 s, so run cleanup at 10 s after load but pass `keep` = the updater's current work folder if any).
  - `before-quit`: if the quit is an update restart, after hiding the windows open the `updating` card near the app window's last bounds; it is destroyed with the process. Timer marks as above.
- [ ] **Step 4:** `npm test` → all pass; `npx tsc --noEmit -p .` → 0.
- [ ] **Step 5: Isolated check** (HANDOFF "시험 실행은 격리한다"): `CLAUDEX_PORT=3344 npx vite --port 3333 --strictPort` and `CLAUDEX_HOME=<tmp> CLAUDEX_PORT=3344 CLAUDEX_SCREENSHOT_DELAY_MS=… npx electron .`: the card shows immediately, the real window replaces it, the card is gone after; capture the card alone by delaying the server (e.g. a `CLAUDEX_DEBUG_SERVER_DELAY_MS` read only when `!app.isPackaged`) for a screenshot of both languages ko/ja. Check the error path by occupying port 3344 with a non-Claudex server → card closes, dialog shows.
- [ ] **Step 6:** Commit `feat(startup): a starting card and the tray before the server; update steps timed; old update folders cleaned later`.

### Task 5: Review, test builds, HANDOFF

- [ ] **Step 1:** Fresh reviewer (opus) on the branch diff, with the spec; fix real findings (tests first).
- [ ] **Step 2:** HANDOFF 7-25 entry: what changed, the two-restart measurement procedure (restart 1 installs this code, restart 2 runs the new process-2 code; read `update.log` lines `p1`/`p2`/`p3`), the known "process 1/2 card shows from the next update" note; section 8 updated.
- [ ] **Step 3:** Test build (`node scripts/release.mjs "test build: …"`, needs the user's permission in this session) → user restarts twice → read `update.log` → stage 3 is a new small plan from those numbers.
