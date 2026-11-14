# Chat view and the calm redesign — design (2026-11-13)

Branch `chat-view` (worktree `Documents\spawn-chat-view`). Common app updates keep landing on `main` and are merged into this branch. This is the next big version of spawn.

## Why
The owner, on the terminal view: "우선 일단 흑백으로만 되어있는 데다가, 테이블이나 링크나왔을때도 불편하고, og 이미지가 떠주는것도 아니고 이모저모로 불편해." Images and screenshots cannot be sent; the side panel's input and the terminal's input feel like two different things. And on the whole app: "폰트단계를 전반적으로 한단계작게, 그리고 강조를 조금 줄이고 차분하게, 조금 정돈된 느낌으로… 우리걸 보면 너무 강조되는게 많다고 느껴진달까."

Other agent GUIs show a session as a conversation. Their users' top complaint is that the GUI lags behind the CLI (missing slash commands, hooks) and gets slow in long sessions. The owner's answer to that: "어쨌든 터미널에서 할수있는 이점도 누리면 좋겠어… 그 명령만 터미널로 보내는것처럼 작동해도되는거아냐?"

## What it is
1. **A chat view of a Claude Code session** — a second way to look at the same session that the terminal shows. The real, interactive Claude Code keeps running in the pty (the engine). The chat view is a lens: it types the user's input into that terminal and draws the conversation from structured data (the session transcript + hooks). One click flips the same session between 채팅 and 터미널.
2. **The calm style ("차분하게 2") across the whole app** — session view, 도감, 박스, 기록, 랭킹, 설정, widget, folded rail, toast.
3. **One composer** for a session, with image paste, replacing the side panel's separate input.

Claude Code only (other AI tools are hidden: `electron/features.json`).

## Goals
- Conversation readable at a glance: who said what, what was run, what changed — by shape and restrained colour, not a wall of grey text.
- Real markdown: tables, lists, headings, code blocks with a copy button, links that look like links, link preview cards (title, description, site, image).
- Tool activity as collapsed one-line rows that expand; failures visible; sub-agent work nested.
- File edits as diffs with `+N −N`, and a 변경 사항 side panel (file tree + selected file's diff).
- Permission requests and multiple-choice questions answered with buttons, impossible to miss.
- Images/screenshots attached by paste or drop into the composer.
- Everything the terminal can do stays available: the terminal view of the same session is one click away, and anything the lens cannot show falls back to it.
- The app reads as calm and ordered; Pokémon are the only vivid thing.
- Text size adjustable by the user, one control for chat and terminal.

## Non-goals
- Re-implementing Claude Code. No headless mode, no Agent SDK, no API keys, no handling of the user's login. (The Agent SDK terms do not allow third parties to offer claude.ai login; this design never touches credentials — it is the user's own installed, logged-in `claude`, as today.)
- Token-by-token streaming fidelity. A provisional bubble is enough.
- Codex / other tools in the chat view.
- A kanban of sessions, multi-agent handoff, remote/mobile access.
- Imitating Claude Code's own visual design, or using "Claude Code" as a product name (Anthropic branding rules). This is spawn's look.

## Anti-goals (would make it a failure even if it works)
- A chat view that silently shows a stale or wrong conversation. When in doubt it must say so and offer the terminal.
- Losing a terminal capability because the chat view exists.
- Sending commands on the user's behalf that change their settings (the spike's `/model` test rewrote the default model).
- A permission request hidden inside a collapsed group, or an approval that times out silently.
- Slowness in long sessions.

## How it works (decided; verified in `spike/chat-lens/FINDINGS.md`, Claude Code 2.1.323)
- **Display source**: the session transcript `…/.claude/projects/<project>/<session-id>.jsonl`, found via the hook payloads' `transcript_path` (first guess: the `--session-id` path; `/clear` starts a new file and the hooks announce it). Append-only; one line per content block. Keep only user / assistant / system lines and selected attachments; the rest is bookkeeping (≈30 lines and hundreds of KB per turn).
- **Live state**: hooks (PreToolUse → PostToolUse give a tool row "running → done" 100–500 ms before the transcript; Stop / interrupt / turn_duration give idle).
- **Streaming feel**: the `MessageDisplay` hook delivers the assistant's text in line batches seconds before the terminal draws it → a provisional bubble, replaced by the transcript line when it lands; plus "working… Ns". Reading the terminal screen is not workable (the TUI shows no text until the message is complete).
- **Permissions**: a held `PermissionRequest` HTTP hook → 허용 / 항상 허용 (a session rule via `updatedPermissions`) / 거부 buttons. The terminal shows its own dialog at the same time; whichever is answered first wins, and the other side drops its pending state.
- **Questions / plan approval**: detected from hooks. Answering from the chat is proven for questions only by holding `PreToolUse` (then the terminal shows nothing while held) — so: hold only while the chat view is the visible view of that session, with a timeout, else leave it to the terminal. Plan approval from a hook is untested → first version shows the plan as a card with "터미널에서 답하기" unless the plan-phase test (see Phases) proves the hook route.
- **Input**: text typed into the pty (`terminals:send`), after checking the prompt row is empty; a leading space when the text starts with `!` `/` `@` `#` and is meant literally; slash commands the user types are passed through as they are. Messages sent while Claude works are queued by Claude Code itself and shown as "대기 중". Esc = 멈추기.
- **Images**: saved to a temp file and its absolute path pasted into the prompt (becomes an image attachment; no clipboard side effects).
- **Diffs**: from the transcript's `structuredPatch` / `originalFile` (no disk reads).
- **Fallback**: schema checks on every transcript line + a canary (a finished turn with no matching transcript text within 3 s) → banner "이 세션을 채팅으로 읽지 못하고 있어요" with 터미널로 보기. The supported Claude Code version range is checked at session start.
- **Not through the game server**: chat content never goes through `server/` `/event` (it clamps text and drops tool input). A new main-process module reads the transcript and receives the chat hooks on a 127.0.0.1 endpoint with a token; the game keeps its own hooks.
- The chat never sends configuration commands (`/model`, `/config` …) by itself.

## The look: 차분하게 2 (chosen 2026-11-13)
Reference implementation: the design lab `Documents\spawn-site-lab\calm-lab\` — `tokens.css` (the 차분하게 2 block is the source of values), the drawer's 원칙 and the screenshots in `shots-v5\`. The owner went 지금 → asked for "1.8" → saw both → chose 2. Principles:
1. 포켓몬만 선명하게 — only Pokémon art and tier colours keep colour; the rest is three greys (#d7dae3 · #a4a9b6 · #7d8291).
2. 노랑은 '고른 것'과 '보내기'에만 — the selected session's 2px left bar, the selected dex/box cell's 1px outline, the send button. Other selections are a 6 % white background.
3. 칠하지 않고 선으로 — no filled cards, pills or chips; 1px hairlines (white 7 %) and 4/8px spacing; radii 3/4/6/8.
4. 글자는 한 단계 작게, 굵기는 400과 500 — 600 only for the wordmark and section headings.
5. 숫자는 굵기 대신 밝기로 — primary ink and tabular figures; bars 2px grey, amber from 80 %.
6. 상태는 점 하나와 조용한 글자 — green working, amber needs you, grey idle. Exception by the owner's request: **HP keeps its green bar** (3px; amber ≤50 %, red ≤20 %) with the "HP" label.
7. 보상은 살아 있게 — the catch toast, medals and NEW stay lively inside the same type system.
Contrast floor: body ≥ 4.5:1, secondary ≥ 3:1 on every background used (measured in the lab).

The owner's specific decisions, all in the lab:
- The lockup (Dream Ball + "spawn") exactly as in the app today; never re-proportioned.
- First view tab renamed 터미널 → **세션** (it holds both chat and terminal).
- No session tab row above the conversation. The left list has **상세** (default) and **간략** modes (간략: one line; status and context as colour only), remembered; the plain shell (`>_`) and `+` live in the list header; a session header above the conversation names the open session.
- A little more space between session rows; session Pokémon slightly smaller.
- Left panel and 변경 사항 panel resizable (remembered); the left panel auto-folds to the rail when the window is narrow and the changes panel is open. Conversation column default width 840px.
- **글자 크기**: one in-app control (`− 가 +`: 작게 / 보통 / 크게 / 아주 크게) that sizes chat, lists, panels and the terminal together; Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+wheel act on the same step.
- **업무 모드** (already on main, `app.workMode`, Ctrl+Shift+H): hides everything Pokémon incl. the lockup; the profile moves left. The chat view must honour it: neutral glyphs, "에이전트", no wild-Pokémon rows or step counts, "컨텍스트" instead of "HP".

## The chat view's parts (all mocked in the lab)
Conversation: user message (with image thumbnails; hover: 복사 / 다시 보내기), assistant turn (the session's Pokémon once per turn), prose in Pretendard, tables, code blocks, links + **link preview cards**, file-path chips, collapsed tool rows (reads/searches grouped; expandable; failed row with "고쳐 달라고 하기"; nested sub-agent group), diff block with `+N −N` chip → opens the file in 변경 사항, permission card, question card, todo chip ("3/5" → checklist), **wild-Pokémon row** in the flow ("야생의 ○○가 나타났다 → 잡았다"), turn summary (time · tools · files · 걸음), working state with 멈추기, "새 메시지 N개" jump pill, empty state for a new session (suggested prompts), read-failed banner. Density: 기본 / 생각 포함 / 전부 (errors and permission asks never collapse).
Composer: multiline, placeholder "○○에게 지시하기…", pasted-image chips + lightbox, `/` menu built from Claude Code's own command list, `@` file mention, queued message strip ("대기 중 1" · 지금 보내기), and a quiet control row: 모델, 권한 모드, HP(컨텍스트), 사용량. Model and permission mode are **display + a link to do it in the terminal** in the first version (the chat does not change settings by itself).
Link preview cards: fetched by the main process (not the page), with a timeout and size cap, cached; can be turned off in settings (privacy: fetching a URL tells that site someone looked). No fetch for private/local addresses.

## Constraints
- Windows behaviour of everything outside this work stays as it is; the terminal view keeps working exactly as today and remains the default until the chat view is judged ready (a setting chooses the default view per the owner's later decision).
- Long sessions: the conversation list is virtualised; stored tool output is capped; nothing large in localStorage.
- Fonts: the bundled Monaspace / Pretendard / Uncut Sans only.
- ko / en / ja for every string.
- Tests: pure functions for transcript parsing, hook pairing, input escaping, diff building, schema checks — with real (redacted) samples from the spike as fixtures.

## Phases (each ends with something the owner can try in a test build)
1. **Calm style in the existing app** (no chat yet): tokens, session view, side panel modes (상세/간략), resizable panels, unified text-size control, tab rename, then the other views (도감, 박스, 기록, 랭킹, 설정, widget, rail, toast). Work mode honoured throughout. Could ship on its own.
2. **Read-only lens**: transcript tailer + hook endpoint + ChatView that renders the conversation, tools, diffs, markdown, with the fallback banner; flip between 채팅 and 터미널. Input still via the terminal or the old send path.
3. **The composer**: sending, queueing, interrupt, slash menu passthrough, image paste, empty/idle checks.
4. **Buttons**: permission cards (held PermissionRequest), then questions; plan approval after testing the hook route.
5. **변경 사항 panel**, link preview cards, turn summary, wild-Pokémon rows, density levels, find.
6. Hardening: long-session performance, version canary, en/ja, accessibility, the insight-log records and screen archive for each phase.

## Open questions for the owner
- Default view for a new session once the chat view is ready: 채팅 or 터미널?
- Link preview cards on by default, or opt-in?
- While the chat view is open, may a question from Claude be answerable only in the chat (the terminal then shows nothing until answered or timed out)?
- Version number for this release (the Mac release was to be 1.4.0; the owner said the chat view is also a version-raising update).

## Left to the builder
Module boundaries inside `electron/chatLens.cjs` and the renderer, the markdown renderer choice (must be safe: no raw HTML), virtualisation approach, exact fixture set, the IPC names.
