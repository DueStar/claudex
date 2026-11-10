# Claudex Optimization (phases 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claudex cheap to leave open all day and stop old instances from hanging after a quit/update, without changing what the user sees (apart from the scrollback choices).

**Architecture:** Three layers, each fixed where the cost is created: the Electron main (quit sequence, PTY data path, hook settings), the local server (save/broadcast frequency, cloud robustness), and the renderer (render churn, WebGL contexts). Behaviour stays identical; writes and messages that carry no change are dropped or batched.

**Tech Stack:** Electron 33 (CommonJS main), node-pty 1.1 (ConPTY), Express + ws server (ESM), React 18 + xterm 6 renderer, vitest.

**Spec:** the review and decisions agreed in chat on 2026-11-10 (summarised below, decisions A–D copied verbatim in meaning). Reviews: three read-only reviewers (renderer, server, main+hooks).

## Global Constraints

- Code, comments, commit messages in English; nothing user-visible changes except the 스크롤 기록 options (Task 11).
- Decision A: step-only Pokédex changes are saved at most every **30 s**; meaningful changes (catch, level-up, swap, release, exchange, arrange, sendout, helper) keep the existing **300 ms** save.
- Decision B: Claude Code hooks run with `"async": true` for **PreToolUse, PostToolUse, PostToolBatch only**; every other hook event stays blocking.
- Decision C: scrollback choices become **1000 / 5000 / 10000**; a saved 50000 becomes 10000.
- Quit must never take longer than about **6 s** in total (2 s session posts + 1.5 s flush + 3 s PTY exit, overlapping where possible).
- No commit/push/release without the user's word; commits are local per task. `git status` clean between tasks.
- Every task ends with `npx tsc --noEmit -p .` (exit 0) and `npx vitest run` (all pass).

## Review Focus

- Quit while a session is mid-output, or right after an update is staged (`update:restart`): the old main must be gone within ~6 s and the relaunched app must start (Task 1 test pins the shutdown sequencing; manual check in the phase-1 test build).
- App crashes / is killed between step saves: at most 30 s of steps lost, never a catch (Task 5 test: a catch after steps writes within 300 ms including the pending steps).
- A terminal opened (or a widget↔window swap) while output streams: no duplicated or missing text in the replayed buffer (Task 8 test: `buffer()` only ever contains data already sent).
- Network down for over an hour while signed in: the user stays signed in and sync resumes when the network returns (Task 4 test).
- An async PreToolUse arriving after the turn's Stop must not flip the session back to 일하는 중 (Task 12 test).

---

## Phase 1 — bugs and safety

### Task 0: Commit the session-card layout (already implemented, tested, test-built)

**Files:** `src/Widget.tsx`, `src/components/Icons.tsx`, `src/styles/widget.css`, `src/styles/widget-expanded.css`, `src/styles/pokedex.css`

- [ ] **Step 1:** `npx tsc --noEmit -p . && npx vitest run` → exit 0, all pass.
- [ ] **Step 2:** Commit: `feat(widget): two-line session card — name owns line 1, Lv/folder/tool/branch on line 2, helper as an icon`

### Task 1: Quit and update-restart always finish (the stuck old instance)

**Files:**
- Create: `electron/quitWatchdog.cjs`
- Modify: `electron/terminals.cjs` (`createTerminalManager` options, `killAll` → `shutdown`), `electron/main.cjs:1183-1202` (`before-quit`), `electron/main.cjs:945` (`serverPost` timeout parameter)
- Test: `tests/terminals.test.ts`, `tests/quit-watchdog.test.ts`

**Interfaces:**
- Produces: `createTerminalManager({ ..., pty?: { spawn }, killTree?: (pid: number) => void })` — both optional, defaults `loadPty()` and a `taskkill /T /F /PID <pid>` (`execFile`, `windowsHide: true`, errors ignored).
- Produces: `terminals.shutdown(timeoutMs = 3000): Promise<{ exited: number, stuck: number }>` — sets `frozen`, for each running terminal calls `killTree(t.pty.pid)` then `try { t.pty.kill() } catch {}`, resolves when every one of them has fired `onExit` or the timeout passes (`stuck` = those that did not). `killAll` is removed (only `main.cjs` used it).
- Produces: `startQuitWatchdog(pid: number, ms = 10000, runtime = process.execPath): void` in `quitWatchdog.cjs` — spawns `runtime` with `ELECTRON_RUN_AS_NODE=1`, `-e <script>`, `detached: true, stdio: 'ignore', windowsHide: true`, then `unref()`. The script polls every 500 ms with `process.kill(pid, 0)`; exits when the pid is gone; after `ms` calls `process.kill(pid)` once and exits.
- Produces: `serverPost(pathname, body = {}, timeoutMs = 15000)`.

- [ ] **Step 1: Failing tests** in `tests/terminals.test.ts`:
  - `'shutdown kills each running session's process tree and waits for its exit'`: fake pty module whose `spawn` returns `{ pid, onData, onExit(cb), kill(), write(), resize() }` capturing the exit callback; `killTree` spy fires that pty's exit callback; create 2 terminals (`CLAUDEX_CLAUDE` not needed — pass `pty`), `await shutdown(1000)` → `{ exited: 2, stuck: 0 }`, `killTree` called with both pids.
  - `'shutdown gives up after the timeout and reports the stuck ones'`: `killTree` does nothing → `await shutdown(50)` → `{ exited: 0, stuck: 1 }`.
  - `tests/quit-watchdog.test.ts` `'the watchdog ends a process that outlives its deadline and leaves alone one that exits'`: spawn `node -e "setInterval(()=>{},1000)"`, `startQuitWatchdog(child.pid, 300, process.execPath)`, expect the child to exit within 3 s; a second child that exits by itself at 100 ms → watchdog process exits too (poll its pid gone within 2 s).
- [ ] **Step 2:** `npx vitest run tests/terminals.test.ts tests/quit-watchdog.test.ts` → FAIL (`shutdown is not a function`, module not found).
- [ ] **Step 3:** Implement the interfaces above. In `main.cjs` `before-quit`, replace the first-pass logic with one deferred sequence (always `preventDefault()` on the first pass, guard with `endingSessions`):
  1. `startQuitWatchdog(process.pid)` (packaged only — `app.isPackaged`);
  2. `Promise.race([Promise.all(running.map(postSessionEnded)), sleep(2000)])`;
  3. `await serverPost('/flush', {}, 1500)` (Task 5 adds the route; a 404 is harmless);
  4. `await terminals.shutdown(3000)` — log `[main] quit: N session(s) did not exit` when `stuck > 0`;
  5. tray dispose, `stopServer()`, then `app.quit()`; the second pass returns immediately.
  `updater.restart()` already goes through `app.quit()`, so it gets the same sequence; add one line to its comment saying so.
- [ ] **Step 4:** Run the two test files → PASS; full `npx vitest run` → PASS.
- [ ] **Step 5:** Commit `fix(quit): kill session trees and wait for them before quitting; watchdog ends a hung main`.

### Task 2: The auth token never reaches the log file

**Files:** Modify `server/index.js:~1472` (the `Page:` line), `electron/logs.cjs` (startup scrub). Test: `tests/logs.test.ts`.

**Interfaces:** Produces `scrubSecrets(text: string): string` exported from `electron/logs.cjs` — replaces `#token=<anything up to whitespace>` with `#token=…`.

- [ ] **Step 1: Failing test** `'secrets are scrubbed from log lines and from logs left by older versions'`: `scrubSecrets('Page: http://127.0.0.1:3334/#token=abc123 x')` → `'Page: http://127.0.0.1:3334/#token=… x'`; a temp log dir with `claudex.log` and `claudex.old.log` containing a token → after the logger is created both files no longer contain `abc123`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `logs.cjs`: apply `scrubSecrets` to every written chunk, and once at creation rewrite existing `claudex.log`/`claudex.old.log` when they contain `#token=`. `server/index.js`: print `Page: ${base}/` plus `(token: <TOKEN_FILE path>)` instead of `appLink(base)`.
- [ ] **Step 4:** Run → PASS; full suite PASS.
- [ ] **Step 5:** Commit `fix(logs): keep the server token out of the log files`.

### Task 3: Private files are written atomically

**Files:** Modify `server/auth.js:57-60` (`writePrivate`). Test: `tests/hardening.test.ts` (or the file that already covers `writePrivate`; grep first).

- [ ] **Step 1: Failing test** `'writePrivate never leaves a half-written file: a write that fails keeps the old content'`: write `a`; then make the target's `.tmp` path a directory (so writing the tmp throws) and call `writePrivate(file, 'b')` expecting a throw; the file still reads `a`. A second write after removing the directory reads `b` and leaves no `.tmp`.
- [ ] **Step 2:** Run → FAIL (today the target is written in place, so there is no tmp to block and the file becomes `b`).
- [ ] **Step 3:** `writePrivate(path, data)`: write `${path}.tmp` with `{ mode: 0o600 }`, `renameSync(tmp, path)`, then the existing `chmodSync`.
- [ ] **Step 4:** Full suite PASS.
- [ ] **Step 5:** Commit `fix(server): write agents.json and the token file atomically`.

### Task 4: Being offline never signs the user out; cloud requests time out

**Files:** Modify `server/cloud.js` (`authRequest:122-131`, `accessToken:161-171`, `noteGameChanged:240-252`, every `fetchImpl` call). Test: `tests/cloud.test.ts`.

**Interfaces:** `authRequest` throws an `Error` carrying `status: number | undefined` (undefined for a network failure). All `fetchImpl` calls pass `signal: AbortSignal.timeout(15000)`.

- [ ] **Step 1: Failing tests:**
  - `'a refresh that fails on the network keeps the session and reports offline'`: session expiring in 10 s, `fetchImpl` rejects (`TypeError('fetch failed')`) → `accessToken()` path (via `sync()`/status) leaves the session file in place; status `lastError.code === 'offline'`.
  - `'a refresh the auth server rejects (400/401) signs out'`: `fetchImpl` returns `{ ok: false, status: 400, json: () => ({ error: 'invalid_grant' }) }` → session cleared, `lastError.code === 'session-expired'` (existing behaviour).
  - `'syncs never overlap'`: a `fetchImpl` that hangs until released; trigger two debounced syncs → only one request in flight.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: sign out only when `err.status === 400 || err.status === 401`; otherwise `lastError = { code: 'offline' }`, `publish()`, return null. Add `let syncing = false` around the debounced `sync()`; a change noted while syncing re-arms the timer after it finishes. Add the `signal` to every request.
- [ ] **Step 4:** Run → PASS; full suite PASS. Check that `lastError.code === 'offline'` has a message in the settings UI (grep `session-expired` in `src/`); if the UI maps codes to text, add `offline` with ko/en/ja strings ("오프라인이라 잠시 동기화를 미뤘어요" / "Offline — sync will retry" / "オフラインのため同期を後で再試行します").
- [ ] **Step 5:** Commit `fix(cloud): stay signed in while offline; time out requests; no overlapping syncs`.

**Phase 1 checkpoint:** local test build (`node scripts/release.mjs "test build: …"`), the user updates; check `Get-CimInstance Win32_Process -Filter "Name='Claudex.exe'"` shows no process older than the update.

---

## Phase 2 — the all-day cost

### Task 5: Step-only Pokédex saves every 30 s; a flush route for quitting

**Files:** Modify `server/pokedex.js:322-337` (save), `:845-850` (step branch), the returned API (`:995`); `server/index.js` (new route next to `/event`, `:846`). Test: `tests/pokedex.test.ts`.

**Interfaces:**
- Produces: `createPokedex({ ..., stepSaveMs = 30_000 })`; internal `saveSoon()` (one timer, `stepSaveMs`, `unref`); `save()` cancels a pending `saveSoon` timer (its write includes the steps). Returned API gains `flush(): void` — writes synchronously now if either timer is pending.
- Produces: `POST /flush` (`requireToken`) → `pokedex.flush(); flushSessions(); res.json({ ok: true })` (`flushSessions` from Task 6; until then just the pokedex).

- [ ] **Step 1: Failing tests** (fake timers):
  - `'a plain step is saved within 30 s, not right away'`: note an `agent_working` step → file unchanged after 1 s, written by 30 s.
  - `'a catch after steps saves within 300 ms and includes the steps'`.
  - `'flush writes pending steps at once'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; the step branch calls `saveSoon()` instead of `save()`.
- [ ] **Step 4:** PASS; full suite PASS.
- [ ] **Step 5:** Commit `perf(pokedex): batch step-only saves (30 s), flush on quit`.

### Task 6: agents.json only when something worth keeping changed

**Files:** Modify `server/index.js` (`saveSessions:586`, the `agent_working` case `:938`, `forgetSession:547`, `endSession:562`). Test: `tests/sessions.test.ts`.

**Interfaces:** Produces `saveSessionsSoon()` (5 s debounce, `unref`) and `flushSessions()` (write now if pending). `saveSessions()` cancels a pending soon-save.

- [ ] **Step 1: Failing tests:**
  - `'a tool call that changes nothing but activity does not rewrite agents.json at once'`: two `agent_working` events on a working session → file mtime/content unchanged immediately, updated after 5 s (fake timers) — follow the existing sessions tests' way of driving the server.
  - `'an unhooked (registry-only) session ending does not write agents.json'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `agent_working` main-thread branch: `mainWorking(...) ? saveSessions() : saveSessionsSoon()`. `endSession`/`forgetSession`: skip the save when `session.hooked === false`. `/flush` calls `flushSessions()`.
- [ ] **Step 4:** PASS; full suite PASS.
- [ ] **Step 5:** Commit `perf(server): save sessions on real changes only`.

### Task 7: An unchanged status line costs nothing

**Files:** Modify `server/status.js:75-111` (`ingest`), its route caller (skip broadcast when `ingest` returns null); `src/meters.ts:108-122` (`reduceMeters`). Tests: `tests/status.test.ts`, `tests/meters-store.test.ts`.

**Interfaces:** `ingest(body, t)` returns `null` when the new record equals the previous one ignoring `updatedAt`/`firstSeenAt` (it still stores the new `updatedAt`, so expiry keeps working). `reduceMeters` returns `prev` (same reference) when the incoming record equals the stored one ignoring `updatedAt`, and `limits` are equal.

- [ ] **Step 1: Failing tests:** status: same body twice → second `ingest` returns null and logs nothing; changed `context.used` → event. Meters: same `session_status` twice → `reduceMeters(prev, e) === prev`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with a small `sameStatus(a, b)` comparing `JSON.stringify` of the record minus the two timestamps (records are small and flat).
- [ ] **Step 4:** PASS; full suite PASS.
- [ ] **Step 5:** Commit `perf: drop status-line updates that change nothing`.

### Task 8: Terminal output — O(1) buffer, 16 ms batches, one IPC route

**Files:** Modify `electron/terminals.cjs:236-250` (`t.buffer`, `onData`), `buffer()`; `src/desktop.ts` (bridge wrapper for `onData`); `src/components/TerminalPanel.tsx:134`. Tests: `tests/terminals.test.ts`.

**Interfaces:**
- Main: each terminal keeps `chunks: string[]`, `size: number`, `pending: string`, one flush timer. `onData` appends to `pending` and arms a 16 ms timer; the flush sends one `terminals:data` `{ id, data: pending }`, then appends it to `chunks` (trim whole chunks from the front while `size - chunks[0].length >= MAX_BUFFER`). `buffer(id)` returns `chunks.join('').slice(-MAX_BUFFER)` — only data already sent. Exit flushes `pending` first.
- Renderer: `bridge.terminals.onDataFor(id: string, fn: (data: string) => void): () => void` in `src/desktop.ts` — a single underlying `onData` subscription created on first use, routing through `Map<string, Set<fn>>`. `TerminalPanel` uses it instead of filtering every message.

- [ ] **Step 1: Failing tests** (fake pty from Task 1, fake timers): `'output within 16 ms goes out as one message'`; `'the replay buffer holds only output already sent, at most MAX_BUFFER characters'` (300 000 chars in 3 000 chunks → `buffer().length === 200000` and ends with the last chunk); `'a session's last output is sent before its exit is reported'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `t.scan`/`asking`/`activity.output` keep running per raw chunk (unchanged timing for the asking detector).
- [ ] **Step 4:** PASS; full suite PASS; `npx tsc --noEmit -p .` exit 0.
- [ ] **Step 5:** Commit `perf(terminals): batch PTY output, keep scrollback as chunks, route data per terminal`.

### Task 9: Heavy views don't re-render on every server message

**Files:** Modify `src/components/PokedexView.tsx:316`, `BoxView.tsx:267`, `TodayLog.tsx:143`, `LeaderboardView.tsx:182` (export `React.memo(...)`), `src/Widget.tsx:405` (`restingUids`).

- [ ] **Step 1:** Wrap the four default exports in `React.memo`. `restingUids`: compute the sorted uid list, `useMemo` the `Set` on its `join(',')` key so the same members give the same Set.
- [ ] **Step 2:** `npx tsc --noEmit -p .` exit 0; full suite PASS. (No unit test: the effect is render counts; verified in the phase-2 test build with React DevTools "highlight updates" off — open 도감 while a session works; the grid must not flash.)
- [ ] **Step 3:** Commit `perf(widget): memoize the dex, box, today and ranking views`.

### Task 10: WebGL only for the terminal on screen

**Files:** Modify `src/components/TerminalPanel.tsx:65-69` and the `active` handling.

**Interfaces:** inside `TerminalView`: `webglRef: WebglAddon | null`; effect on `[active]`: when active and none → load one (same try/catch + `onContextLoss`); when inactive → dispose 30 s later (timer cleared if it becomes active again). Dispose on unmount as today.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npx tsc --noEmit -p .` exit 0; full suite PASS.
- [ ] **Step 3:** Verify in the phase-2 test build: switch between 3+ terminals — text stays crisp on the grid (Hangul included) when a terminal comes back; no blank frame longer than a moment.
- [ ] **Step 4:** Commit `perf(terminal): WebGL renderer only for the visible terminal`.

### Task 11: Scrollback choices 1000 / 5000 / 10000

**Files:** Modify `electron/settings.cjs:18,50` (+ `sanitize` mapping 50000 → 10000), `src/desktop.ts:160`, `src/components/SettingsView.tsx:25`. Test: `tests/settings.test.ts`.

- [ ] **Step 1: Failing test** `'a saved 50000-line scrollback becomes 10000'` and `'scrollback choices are 1000, 5000 and 10000'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (type becomes `1000 | 5000 | 10000`).
- [ ] **Step 4:** PASS; tsc exit 0; full suite PASS.
- [ ] **Step 5:** Commit `perf(settings): cap terminal scrollback at 10000 lines`.

**Phase 2 checkpoint:** local test build; the user works normally for a while; compare `pokedex.json` mtime churn and Claudex CPU/memory (`Get-Process Claudex`) against today's 2.2 GB / ~5 % baseline.

---

## Phase 3 — felt speed

### Task 12: Tool hooks don't block Claude; late ones can't undo a Stop

**Files:** Modify `electron/terminals.cjs:57-60` (`writeSessionSettings`), `hooks/claudex-hook.cjs` (add `at`), `server/index.js` (`agent_working` main-thread branch `:938`). Tests: `tests/terminals.test.ts`, `tests/hook-script.test.ts`, `tests/turn-events.test.ts` (or wherever main-state transitions are tested; grep `mainWorking`).

**Interfaces:**
- `ASYNC_HOOKS = new Set(['PreToolUse', 'PostToolUse', 'PostToolBatch'])`; those entries get `{ type: 'command', command: hook, async: true }`.
- Every event the hook posts carries `at: number` (ms, taken when the hook started reading stdin).
- Server: in the main-thread `agent_working` branch, if `typeof body.at === 'number' && body.at < mainOf(session).since && mainOf(session).state !== 'working'` → skip `mainWorking` (the step still counts for the Pokédex, which reads the event separately — keep that path untouched).

- [ ] **Step 1: Failing tests:** settings — PreToolUse/PostToolUse/PostToolBatch have `async: true`, Stop/PermissionRequest/SessionStart/SessionEnd/UserPromptSubmit don't; hook — posted body has a numeric `at`; server — Stop at t=100, then `agent_working` with `at: 90` → state stays idle; with `at: 110` → working.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; full suite PASS.
- [ ] **Step 5:** Manual check in the test build: a session runs several tools; 일하는 중 / 쉬는 중 / 확인 필요 switch as before; a permission prompt still shows 확인 필요; the Pokédex still counts steps.
- [ ] **Step 6:** Commit `perf(hooks): run tool hooks in the background; ignore tool events older than the last state change`.

**Phase 3 checkpoint:** local test build; the user confirms it feels faster and states are right. Then, on "푸시해": version bump, CHANGELOG ko/en/ja, HANDOFF 7-23, release.

## Deferred (agreed, not in this plan)

Delta broadcasts of the game state; faster update restart (async cleanup, changed-files-only); window before server boot; pruning `assign`/`projects`; sprite fitting in a worker; tray menu rebuilds; streamed log writes; finite loading shimmer / needs-you hop.
