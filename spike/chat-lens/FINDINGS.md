# Chat lens spike — findings (2026-11-13)

Claude Code 2.1.323, Windows, the owner's real settings (fullscreen TUI). 19 short Sonnet turns in five runs (r1–r5). Scripts in this folder reproduce them: `lens-driver.cjs` (claude in a node-pty; hooks, transcript lines and screen on one clock; can hold a hook open until an answer is posted), `hook-forward.cjs`, `timeline.cjs`, `screen-replay.cjs`, `samples.cjs`. `runs/` and `node_modules/` are git-ignored (runs hold account ids).

## Verdicts

| Capability | Verdict |
|---|---|
| Transcript as the display source | Works with caveats |
| Hooks as live events (tool running → done) | Works |
| Streaming text via the `MessageDisplay` hook | Works |
| Streaming by reading the terminal screen | Not workable |
| Permission buttons (held `PermissionRequest` hook) | Works |
| "Always allow" (`updatedPermissions` session rule) | Works |
| Answering by typing keys into the terminal | Works with caveats (menus differ per tool) |
| Multiple-choice question answered from the chat | Works with caveats (invisible in the terminal while held) |
| Plan approval | Detection works; answering from a hook not tested |
| Sending prompts into the terminal | Works with caveats (leading `!` `/` `@` `#`) |
| Queued messages, Esc interrupt | Works |
| `/model`, `/clear`, `/resume` typed in | Work; `/compact` not tested |
| Images | Path paste, Alt+V and `@path` work; Ctrl+V did nothing |
| Diffs from the transcript | Works (`structuredPatch`) |
| Chat and terminal on one session | Works with caveats (one shared input box) |

## 1. Transcript
- Path `~/.claude/projects/<cwd, non-alphanumerics → ->/<session-id>.jsonl`; `--session-id` sets the name; the file appears at the first prompt, not at launch. Every hook payload carries `transcript_path` and `session_id`. `/clear` starts a new id and file (SessionEnd reason=clear → SessionStart source=clear with the new path). Follow the newest hook `transcript_path`; the `--session-id` path is the first guess.
- Append-only (no line rewritten over ~500 KB/session).
- One line per content block, written once and complete: text, tool_use and thinking are separate `type:"assistant"` lines sharing `message.id`. Thinking text is empty.
- Latency: text line 18–156 ms after the terminal shows the message, 112–275 ms after Stop; tool_use 166–520 ms after PreToolUse; tool_result 104–475 ms after PostToolUse.
- Noise: ~30 bookkeeping lines per turn; attachments are large (~290 KB of skill listings); 451 KB after one turn. Keep only user / assistant / system and selected attachment lines.
- Esc during text: partial text with `stop_reason:null`, then user line `[Request interrupted by user]`. Esc on a dialog: tool_result `is_error`, `toolUseResult:"User rejected tool use"`, then `[Request interrupted by user for tool use]`.
- Queued message: a `queue-operation` enqueue line; the real user line when it runs.
- Sub-agent: `<sid>/subagents/agent-<agentId>.jsonl` (+ `.meta.json`), lines `isSidechain:true`; main file gets an `Agent` tool_result `{isAsync, status:"async_launched", agentId, outputFile}`, later a task-notification prompt and reply.
- Slash commands: user lines with command-name / local-command-stdout, or `system/local_command`. Turn end: `system/turn_duration`.
- Fields a renderer needs: `type, uuid, parentUuid, isSidechain, isMeta, timestamp`, `message.{id, model, stop_reason, content[text | tool_use{id,name,input} | tool_result{tool_use_id,content,is_error} | image{base64}]}`, `toolUseResult`, `permissionDecision{source}`.

## 2. Hooks
- Order: UserPromptSubmit → PreToolUse (`tool_use_id`, `tool_input`) → [PermissionRequest] → transcript tool_use → PostToolUse (`tool_response`, `duration_ms`) → PostToolBatch → transcript tool_result → MessageDisplay × n → Stop (`last_assistant_message`) → transcript text. A tool row can show running → done 100–500 ms before the transcript.
- PermissionRequest has no `tool_use_id`: pair with the matching PreToolUse (spawn's `callKey`).
- Subagent events carry `agent_id`, `agent_type`; SubagentStop gives `agent_transcript_path`.
- `Notification` permission_prompt fires only after ~6 s idle; idle_prompt after ~60 s.
- SessionStart works only as a command hook, not HTTP.

## 3. Streaming
- Screen reading fails for a basic reason: in this version the terminal shows no assistant text until the message is complete (only a spinner).
- `MessageDisplay` hook sends complete lines in batches (`delta`, `index`, `final`): first ~1.5 s after Enter, then every 100–300 ms; the full text 4.7–6.3 s before the screen shows it. No `final` after Esc. Its `message_id` does not match the transcript: match by `prompt_id` + text prefix. Claude Code waits for each batch's hook (10 s timeout) → must be an HTTP hook that answers at once.
- Recommendation: "working… Ns" from hooks + a provisional bubble fed by MessageDisplay, replaced by the transcript line.

## 4. Permissions
- Holding `PermissionRequest`: the terminal shows its own dialog too; the first answer wins. `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` closed the dialog ("Allowed by PermissionRequest hook"). `updatedPermissions:[{type:"addRules", rules:[{toolName:"Bash", ruleContent:"node *"}], behavior:"allow", destination:"session"}]` stopped the next matching ask. Per-hook `timeout` configurable (default 600 s). A late answer after the terminal answered is ignored → drop the pending request when the call resolves elsewhere.
- Typing keys: "1" approves, Esc rejects, but menus differ (Edit 3 options, Bash 4, sub-agent 3) → "No" has no fixed number. Use the hook.

## 5. Questions and plan mode
- AskUserQuestion: holding `PreToolUse` and replying allow + `updatedInput {questions, answers}` worked, but meanwhile the terminal shows only "running PreToolUse hook" (no question). Whether the question also raises `PermissionRequest` was not tested.
- Plan mode: Shift+Tab cycles manual → accept edits → plan → auto. ExitPlanMode raises PreToolUse then PermissionRequest carrying the plan text and file path. Terminal dialog: 1 yes+auto / 2 yes+manual / 3 tell Claude what to change; Esc rejects. Approving from the hook not tested.

## 6. Input
- Text then `\r` 150 ms later worked every time. Bracketed paste does not escape special first characters (`!` shell mode, `/` command list): prefix a space when text starts with `!`, `/`, `@`, `#` and it is meant literally.
- Typing while busy queues; UserPromptSubmit fires at enqueue time.
- Esc interrupts: no Stop hook; transcript marker as above.
- `/model x` opens a confirm dialog and SAVES THE DEFAULT in `~/.claude/settings.json`. `/clear` new id+file. `/resume` opens a picker.
- Idle after: Stop, StopFailure, an interrupt line, or turn_duration. The input box can show a greyed suggestion.

## 7. Images
- Pasting an absolute image path (bracketed paste) becomes an `[Image #n]` attachment — recommended (no clipboard). Clipboard + Alt+V works. Clipboard + Ctrl+V (`\x16`) did nothing, twice (spawn's TerminalPanel sends `\x16` for image paste — check in the app). `@file.png` also attaches. Transcript: user content `[text, image{base64}]`, `imagePasteIds`, meta line `[Image: source: <path>]`.

## 8. Diffs
- Edit `toolUseResult`: `filePath, oldString, newString, originalFile, structuredPatch[{oldStart, oldLines, newStart, newLines, lines}], userModified, replaceAll`. Write (new): `{type:"create", filePath, content, structuredPatch:[], originalFile:null}`. Enough for a diff and +N/−N without the disk. Not checked: MultiEdit, Write over an existing file.

## 9. Two views
- One shared input box: check the prompt row is empty before sending. Dialogs belong to the terminal; the chat marks them pending/resolved from hooks and transcript. Derive everything else from transcript + hooks. Resizing writes nothing to the transcript.

## 10. Robustness
| Assumption | Catch |
|---|---|
| Transcript path | Prefer the hook's `transcript_path`; no file 5 s after a prompt → banner |
| Entry shapes (internal) | Validate each line; canary: Stop text with no matching transcript text in 3 s → banner, terminal view |
| Append-only | Hash what was read; rebuild on mismatch |
| Interrupt/queue/command wording | Busy that never ends falls back to turn_duration / idle |
| Hook fields | Check the Claude Code version range at start |
| PermissionRequest races the dialog | Hold with a timeout |
| MessageDisplay batching | Cosmetic; transcript replaces it |
| Keys | Check the echo after each write; else "send it from the terminal" |
| `/model` persists | The chat never sends config commands itself |

## 11. Reuse in spawn
- Reuse: `--session-id`, `--settings` via `writeSessionSettings`, `SPAWN_SESSION_ID`, `SPAWN_LINK_FILE` / session-links (tracks the id after `/clear`), IPC `terminals:write` and `terminals:send` (`sendInstruction`), `callKey` in `hooks/spawn-hook.cjs`, transcript reading in `electron/history.cjs`.
- Do not send chat content through `server/` `/event` (it clamps text and drops tool input/response).
- Add: `electron/chatLens.cjs` (transcript tailer with schema checks; a 127.0.0.1 HTTP hook endpoint with a token), HTTP hooks MessageDisplay and PermissionRequest (held) in `writeSessionSettings`, IPC `chat:update / chat:answer / chat:send / chat:interrupt`, a `ChatView` beside `TerminalPanel` with banner + fallback.

## Risks, ranked
1. Internal, noisy, large transcript format that may change.
2. A question answered through a held PreToolUse is invisible in the terminal view.
3. Both views write into one input box; `!` `/` `@` at the start change meaning.
4. Commands typed for the user have side effects (`/model` saves a default).
5. A stalled hook endpoint delays the terminal's own display (MessageDisplay holds up to 10 s).

## Not tested
Plan approval from a hook; deny+message through PermissionRequest; whether a question raises PermissionRequest; `/compact`; `/resume` switching; a held HTTP hook at its timeout; the HTTP hook auth header; MessageDisplay with the endpoint down; TUI settings other than fullscreen; Edit/Write payloads in PostToolUse; MultiEdit; Ctrl+V inside spawn's real terminal.

## Side effects of this spike
- `/model haiku` test saved `"model": "haiku"` in the owner's `~/.claude/settings.json` (was `"fable"`) — reported to the owner.
- A plan file `~/.claude/plans/plan-do-not-do-logical-river.md` and six test sessions under `~/.claude/projects/…chat-spike-demo-project/`.
