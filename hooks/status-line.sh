#!/usr/bin/env bash
# =============================================================================
# status-line.sh — Claude Code statusLine → the Claudex server
#
# Claude Code runs the configured `statusLine.command` on every state change
# of an interactive session (new assistant message, /compact, permission-mode
# change, ...) with a JSON object on stdin (Claude Code 2.1.300, see
# https://code.claude.com/docs/en/statusline):
#   session_id, transcript_path, cwd, version, model{id,display_name},
#   workspace{current_dir,project_dir}, cost{total_cost_usd,total_duration_ms,
#   total_api_duration_ms,total_lines_added,total_lines_removed},
#   context_window{total_input_tokens,total_output_tokens,context_window_size,
#   used_percentage,current_usage}, exceeds_200k_tokens, effort{level},
#   rate_limits{five_hour{used_percentage,resets_at},seven_day{...},spend_limit{...}}
#   (rate_limits only for Pro/Max subscribers, and only after the first API
#   response; used_percentage may be null early in the session)
#
# This script POSTs a compact summary to the server (POST /status: the
# context window and the 5-hour / weekly limits the app shows) and prints the
# status line Claude Code displays:  <model> · ctx <used>% · $<cost>
# The app's sessions get it through their --settings file
# (electron/terminals.cjs).
#
# Bash 3.2 compatible; one python3 -I call (no cwd imports, no PYTHON* env);
# curl runs in the background with a 1 s cap, so a stopped server costs
# nothing and never blocks the status line.
# =============================================================================

# Where the server listens: AGENT_OFFICE_STATUS_URL wins, else the port from
# AGENT_OFFICE_PORT (the same knob as agent-tracker.sh), default 3334
SERVER_URL="${AGENT_OFFICE_STATUS_URL:-http://127.0.0.1:${AGENT_OFFICE_PORT:-3334}/status}"
OFFICE_HOME="${AGENT_OFFICE_HOME:-$HOME/.agent-office}"

PAYLOAD=$(cat)
if [ -z "$PAYLOAD" ]; then
    exit 0
fi

# Auth token (written by the server on start; optional — the same lookup as
# agent-tracker.sh). The token is NEVER put on curl's argv, where every local
# user can read it in `ps`: this script SIGNS its POST with the token instead
# (sign_headers below) and sends the signature as a header. The token stays in
# this variable and this process's memory (owner-readable only), reaching the
# signing python through the environment, never argv.
TOKEN=""
TOKEN_FILE="$OFFICE_HOME/auth-token"
if [ -f "$TOKEN_FILE" ]; then
    TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null)
fi

# Given a method and the request URL (via the environment, so the token never
# reaches argv) and the body on stdin, print "<timestamp><US><signature>",
# the HMAC-SHA256(token, method\npath\ntimestamp\nbody) the server verifies.
# Nothing is printed when there is no token (the POST then goes out unsigned
# and the server answers 401, which the backgrounded call ignores).
PY_SIGN='
import os, sys, time, hashlib
token = os.environ.get("OFFICE_TOKEN", "")
if not token:
    sys.exit(0)
def _hmac_sha256_hex(key, msg):
    # HMAC-SHA256 per RFC 2104 on hashlib: the hmac module costs ~5 ms to import
    if len(key) > 64:
        key = hashlib.sha256(key).digest()
    key = key.ljust(64, b"\0")
    inner = hashlib.sha256(bytes(b ^ 0x36 for b in key) + msg).digest()
    return hashlib.sha256(bytes(b ^ 0x5c for b in key) + inner).hexdigest()
def _url_path(url):
    # Path and query of the URL, as urlsplit gives them, without importing urllib.parse
    rest = url.split("://", 1)[-1].split("#", 1)[0]
    i = rest.find("/")
    return rest[i:] if i >= 0 else "/"
method = os.environ.get("OFFICE_METHOD", "")
path = _url_path(os.environ.get("OFFICE_URL", ""))
body = sys.stdin.buffer.read()
ts = str(int(time.time() * 1000))
msg = (method + "\n" + path + "\n" + ts + "\n").encode() + body
sig = _hmac_sha256_hex(token.encode(), msg)
sys.stdout.write(ts + "\x1f" + sig)
'
# Prints "<timestamp><US><signature>" for a request. $1 method, $2 URL; body on stdin.
sign_headers() {
    OFFICE_TOKEN="$TOKEN" OFFICE_METHOD="$1" OFFICE_URL="$2" python3 -I -c "$PY_SIGN"
}

# One Python pass. Line 1 is the event to POST (empty = nothing to send), the
# rest is the default status line. The payload travels through the
# environment, never through the Python source.
OUT=$(STATUS_PAYLOAD="$PAYLOAD" python3 -I - <<'PYEOF'
import json, os, sys

try:
    # Windows: plain LF line ends, or the empty first line (nothing to post)
    # would be a lone CR, which the shell then POSTs as the event
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', newline='\n')
except Exception:
    pass

def num(v):
    # A finite number, or None (bool is not a number here)
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if v != v or v in (float('inf'), float('-inf')):
        return None
    return v

def text(v, limit=120):
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        return ''
    return str(v)[:limit]

try:
    d = json.loads(os.environ.get('STATUS_PAYLOAD', '') or '{}')
    if not isinstance(d, dict):
        d = {}
except Exception:
    d = {}

session_id = text(d.get('session_id'), 200)

# ── The session's context window and rate limits ────────────────────────────
def obj(key):
    v = d.get(key)
    return v if isinstance(v, dict) else {}

model, cost, ctx, rl, ws = (obj(k) for k in ('model', 'cost', 'context_window', 'rate_limits', 'workspace'))

project_dir = text(ws.get('project_dir'), 400) or text(ws.get('current_dir'), 400) or text(d.get('cwd'), 400)
project = os.path.basename(project_dir.rstrip('/')) or project_dir

model_name = text(model.get('display_name')) or text(model.get('id')) or 'Claude'
total_cost = num(cost.get('total_cost_usd')) or 0
used = num(ctx.get('used_percentage'))

event = {
    'type':         'session_status',
    'sessionId':    session_id,
    'project':      project,
    'model':        model_name,
    'modelId':      text(model.get('id')),
    'context': {
        'used':   used,
        'size':   num(ctx.get('context_window_size')),
        'input':  num(ctx.get('total_input_tokens')) or 0,
        'output': num(ctx.get('total_output_tokens')) or 0,
    },
}

# Each window is independently absent; used_percentage runs 0-100 (spend_limit
# can exceed 100 once over the limit), resets_at is Unix epoch seconds
limits = {}
for src, dst in (('five_hour', 'fiveHour'), ('seven_day', 'sevenDay'), ('spend_limit', 'spendLimit')):
    window = rl.get(src)
    if not isinstance(window, dict):
        continue
    pct = num(window.get('used_percentage'))
    if pct is not None:
        limits[dst] = pct
    resets = num(window.get('resets_at'))
    if resets is not None:
        limits[dst + 'ResetsAt'] = resets
if limits:
    event['rateLimits'] = limits

print(json.dumps(event, separators=(',', ':')) if session_id else '')
print('%s · ctx %s%% · $%.2f' % (model_name, ('%d' % round(used)) if used is not None else '0', total_cost))
PYEOF
)

NL='
'
EVENT_JSON="${OUT%%"$NL"*}"
DEFAULT_LINE="${OUT#*"$NL"}"
if [ "$DEFAULT_LINE" = "$OUT" ]; then
    DEFAULT_LINE=""
fi

# Send the event in the background (never waits on the server), signed so the
# token is never on curl's argv and the body goes in on stdin.
if [ -n "$EVENT_JSON" ]; then
    STATUS_TS_SIG=$(printf '%s' "$EVENT_JSON" | sign_headers POST "$SERVER_URL")
    IFS=$'\x1f' read -r STATUS_TS STATUS_SIG <<EOF
$STATUS_TS_SIG
EOF
    if [ -n "$STATUS_SIG" ]; then
        printf '%s' "$EVENT_JSON" | curl -sf -X POST "$SERVER_URL" \
            -H "Content-Type: application/json" \
            -H "X-Office-Timestamp: $STATUS_TS" \
            -H "X-Office-Signature: $STATUS_SIG" \
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
fi

if [ -n "$DEFAULT_LINE" ]; then
    printf '%s\n' "$DEFAULT_LINE"
fi
exit 0
