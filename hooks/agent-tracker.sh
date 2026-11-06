#!/usr/bin/env bash
# =============================================================================
# agent-tracker.sh — Claude Code hook → the Claudex server
#
# Claude Code passes hook event JSON on stdin. This script turns it into one
# event (agent-tracker.py next to it) and POSTs that to the server at
# http://127.0.0.1:3334/event (AGENT_OFFICE_PORT or AGENT_OFFICE_EVENT_URL
# move it; see SERVER_URL below). The app's sessions get it through their
# --settings file (electron/terminals.cjs, hooks/hooks.json).
#
# Hook events handled:
#   PreToolUse         — a tool call: a step for the session's Pokémon, and
#                        the session's Claude seen working
#   PostToolUse        — a call finished: lowers the permission hand that very
#                        call raised (main thread or subagent)
#   PostToolUseFailure — a tool call errored (a non-zero Bash exit lands here
#                        and gets NO PostToolUse)
#   SubagentStop       — a subagent finished (lowers a hand it raised)
#   SessionStart       — a Claude Code session began (startup/resume/compact/clear/fork)
#   SessionEnd         — that session exited
#   UserPromptSubmit   — the trainer's prompt (or a background task waking Claude)
#   Stop               — Claude's turn ended: its reply + the background work still running
#   PermissionRequest  — Claude is waiting for a permission answer
#   Notification       — permission_prompt / idle_prompt / quota_* / agent_needs_input
#   StopFailure        — the turn ended on an API error
#   PreCompact /
#   PostCompact        — context compaction started / finished
#   PostToolBatch      — a batch of tool calls finished (lowers a permission
#                        hand that thread raised)
#   CwdChanged         — the session cd'd somewhere else (project tag follows)
#   PostModelSwitch    — the session runs another model now
#
# Every event carries the session it came from: sessionId (session_id),
# project (basename of cwd), cwd and transcriptPath.
#
# Nothing is ever printed on stdout: on UserPromptSubmit it would be injected
# into Claude's context, on PermissionRequest it would answer the dialog. The
# event is POSTed in the background and the script exits 0 at once, so a
# stopped server never slows a session down.
#
# The payload shapes handled are the ones Claude Code 2.1.300 was observed
# sending (see tests/hook-script.test.ts for verbatim captures).
# =============================================================================

# Where the server listens: AGENT_OFFICE_EVENT_URL wins, else the port from
# AGENT_OFFICE_PORT, default 3334. The default host is 127.0.0.1, not
# 'localhost': 'localhost' can resolve to ::1 first, which would let a
# squatter on [::1] win the name even while the real server runs on 127.0.0.1.
SERVER_URL="${AGENT_OFFICE_EVENT_URL:-http://127.0.0.1:${AGENT_OFFICE_PORT:-3334}/event}"

# Read the hook payload from stdin
PAYLOAD=$(cat)

# The token. It is NEVER put on curl's command line (every local user can read
# argv in `ps` / /proc), and the token file is stable across restarts, so a
# leak would stay valid. The event builder SIGNS the request with it instead:
# the token travels to python through the environment, never argv.
TOKEN=""
TOKEN_FILE="${AGENT_OFFICE_HOME:-$HOME/.agent-office}/auth-token"
if [ -f "$TOKEN_FILE" ]; then
    TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null)
fi

# The event builder lives in agent-tracker.py next to this script: Git Bash on
# Windows deadlocks reading a big heredoc, and a big `python3 -c` argument is
# over Windows' 32 KB command line. The payload goes to it on stdin, never
# through an environment variable or an argument (a PostToolUse carrying a
# 300 KB file read is over the single-argument limit).
PY_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/agent-tracker.py"

# -I: ignore PYTHON* env vars and the user site, and keep the cwd (the
# project Claude is working in) off sys.path. Line 1 is the event, line 2
# its POST signature ("ts<US>sig", or empty without a token).
PY_OUT=$(printf '%s' "$PAYLOAD" | OFFICE_TOKEN="$TOKEN" OFFICE_POST_URL="$SERVER_URL" python3 -I "$PY_FILE")
EVENT_JSON=$(printf '%s\n' "$PY_OUT" | sed -n 1p)
POST_SIG_LINE=$(printf '%s\n' "$PY_OUT" | sed -n 2p)

# If Python produced no output, nothing to send
if [ -z "$EVENT_JSON" ]; then
    exit 0
fi
IFS=$'\x1f' read -r POST_TS POST_SIG <<EOF
$POST_SIG_LINE
EOF

# Send the event, signed (the body on stdin so neither the token nor the
# event text is ever on curl's argv). No token: it goes out unsigned and the
# server answers 401, which this backgrounded, output-discarding call ignores.
if [ -n "$POST_SIG" ]; then
    printf '%s' "$EVENT_JSON" | curl -sf -X POST "$SERVER_URL" \
        -H "Content-Type: application/json" \
        -H "X-Office-Timestamp: $POST_TS" \
        -H "X-Office-Signature: $POST_SIG" \
        --data-binary @- \
        --max-time 1 \
        > /dev/null 2>&1 &
else
    printf '%s' "$EVENT_JSON" | curl -sf -X POST "$SERVER_URL" \
        -H "Content-Type: application/json" \
        --data-binary @- \
        --max-time 1 \
        > /dev/null 2>&1 &
fi

exit 0
