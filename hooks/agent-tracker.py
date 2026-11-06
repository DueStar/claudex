import json, sys, os, re, hashlib

# Windows: print() would end lines with \r\n, which the shell would keep in the
# event and its signature. Plain \n, UTF-8.
try:
    sys.stdout.reconfigure(encoding='utf-8', newline='\n')
except Exception:
    pass

try:
    # Bytes, decoded as UTF-8: on Windows sys.stdin would use the ANSI code page (cp949) and garble Korean
    raw = sys.stdin.buffer.read().decode('utf-8', 'replace') if hasattr(sys.stdin, 'buffer') else sys.stdin.read()
    d = json.loads(raw or '{}')
except Exception:
    sys.exit(0)
if not isinstance(d, dict):
    sys.exit(0)

hook_event = d.get('hook_event_name', '')
tool_name  = d.get('tool_name', '')

# ── Session identity — present on every hook payload Claude Code sends ──────
# session_id, transcript_path and cwd are in the base schema of all 33 hook
# events (captured 2.1.300). project is the basename of cwd: the folder the
# terminal was opened in, which is what the app shows on the session row.
def session_fields(payload):
    out = {}
    sid = payload.get('session_id')
    if sid:
        out['sessionId'] = str(sid)
    cwd = payload.get('cwd')
    if isinstance(cwd, str) and cwd:
        out['project'] = os.path.basename(cwd.rstrip('/')) or cwd
        out['cwd'] = cwd
    transcript = payload.get('transcript_path')
    if isinstance(transcript, str) and transcript:
        out['transcriptPath'] = transcript
    return out

SESSION = session_fields(d)

def _hmac_sha256_hex(key, msg):
    # HMAC-SHA256 per RFC 2104 on hashlib, which this pass already loads:
    # importing the hmac module costs ~5 ms on every hook run
    if len(key) > 64:
        key = hashlib.sha256(key).digest()
    key = key.ljust(64, b'\0')
    inner = hashlib.sha256(bytes(b ^ 0x36 for b in key) + msg).digest()
    return hashlib.sha256(bytes(b ^ 0x5c for b in key) + inner).hexdigest()

def _url_path(url):
    # The request path and query of a URL (what urlsplit gives, without
    # importing urllib.parse): http://127.0.0.1:3334/event?x -> /event?x
    rest = url.split('://', 1)[-1].split('#', 1)[0]
    i = rest.find('/')
    return rest[i:] if i >= 0 else '/'

def sign_post(body):
    # The POST /event signature, computed HERE so the common path spends no
    # extra process on signing: HMAC-SHA256(token, POST\npath\nts\nbody) with
    # the token from the environment (never argv). '' when there is no token
    # (the wrapper then POSTs unsigned and the server answers 401).
    token = os.environ.get('OFFICE_TOKEN', '')
    if not token:
        return ''
    import time
    path = _url_path(os.environ.get('OFFICE_POST_URL', ''))
    ts = str(int(time.time() * 1000))
    msg = ('POST\n' + path + '\n' + ts + '\n').encode() + body.encode()
    return ts + '\x1f' + _hmac_sha256_hex(token.encode(), msg)

def emit(event):
    # Every event the server receives says which session it belongs to
    for key, value in SESSION.items():
        event.setdefault(key, value)
    body = json.dumps(event)
    # Line 1: the event (the POST body). Line 2: its POST signature (or empty).
    print(body)
    print(sign_post(body))

# ── Session lifecycle ───────────────────────────────────────────────────────
# Captured 2.1.300 payloads (besides session_id/transcript_path/cwd):
#   SessionStart {"source": "startup"}                      first start, no model
#   SessionStart {"source": "startup", "model": "claude-haiku-5-5"}
#   SessionStart {"source": "resume", "seconds_since_last_response": 5,
#                 "context_tokens": 44052, ...}             claude -r / --continue
#   SessionStart {"source": "compact", "model": "claude-haiku-5-5", "prompt_id": ...}
#   SessionEnd   {"reason": "other"}                        every -p exit
#   SessionEnd   {"reason": "prompt_input_exit"}            /exit
# source may also be clear | fork (schema). session_title is only present
# when the session was named (--name, /rename) and becomes `title`.
if hook_event == 'SessionStart':
    event = {'type': 'session_started', 'source': str(d.get('source') or 'startup')}
    if d.get('model'):
        event['model'] = str(d['model'])
    if d.get('session_title'):
        event['title'] = str(d['session_title'])[:120]
    if SESSION.get('sessionId'):
        emit(event)
    sys.exit(0)

if hook_event == 'SessionEnd':
    if SESSION.get('sessionId'):
        emit({'type': 'session_ended', 'reason': str(d.get('reason') or 'other')})
    sys.exit(0)

# ── Subagent finished (foreground or background) — carries the subagent's
# agent_id and its final message, but no tool_name.
# The server lowers a permission hand that subagent raised. SubagentStop also
# fires for sidechains that are not workers: the compaction summariser
# (between PreCompact/PostCompact) and the prompt-suggestion pass, both with
# agent_type "". Those are phantoms, so nothing is sent for them.
if hook_event == 'SubagentStop':
    if d.get('agent_id') and d.get('agent_type'):
        emit({
            'type':    'agent_completed',
            'agentId': str(d['agent_id']),
            'result':  str(d.get('last_assistant_message') or 'done')[:120],
        })
    sys.exit(0)

# ── The session's own Claude ────────────────────────────────────────────────
# The events below describe the main thread, not a worker, and none of them
# carries a tool_name except PermissionRequest — so they sit above the
# tool_name gate. All of them need the session they belong to. Text is
# clamped HERE as well as on the server: the server clamps `text` to 2000
# characters, but an oversize body would be refused whole (413) and the state
# change lost along with the text.
def clamp(value, limit):
    return str(value if value is not None else '')[:limit]

def one_line(value, limit):
    # Labels: whitespace collapsed, then clamped
    return ' '.join(str(value if value is not None else '').split())[:limit]

def emit_session(event):
    pid = d.get('prompt_id')
    if pid:
        event['promptId'] = str(pid)[:80]
    if SESSION.get('sessionId'):
        emit(event)
    sys.exit(0)

# UserPromptSubmit {prompt, prompt_id, permission_mode} — the trainer's prompt.
# Also fired for turns Claude Code starts by itself: a background subagent
# reporting back arrives as a prompt that begins "<task-notification>" and
# names the subagent in <task-id> (captured 2.1.300: the schema's `source`
# field, which would say so, was never sent). Such a wake-up is flagged and
# only its <summary> line travels, never the XML or the agent's result.
if hook_event == 'UserPromptSubmit':
    prompt = d.get('prompt')
    prompt = prompt if isinstance(prompt, str) else ''
    event = {'type': 'session_prompt', 'text': clamp(prompt, 2000), 'isWakeup': False}
    if prompt.lstrip().startswith('<task-notification>'):
        event['isWakeup'] = True
        m = re.search(r'<task-id>\s*([^<\s]+)\s*</task-id>', prompt)
        if m:
            event['wakeupAgentId'] = m.group(1)[:80]
        m = re.search(r'<status>\s*([^<\s]+)\s*</status>', prompt)
        if m:
            event['wakeupStatus'] = m.group(1)[:40]
        m = re.search(r'<summary>(.*?)</summary>', prompt, re.S)
        event['text'] = one_line(m.group(1) if m else 'a background task finished', 2000)
    emit_session(event)

# Stop {stop_hook_active, last_assistant_message, background_tasks, session_crons}
# — Claude's turn ended. background_tasks is the in-flight background work
# ({id, type, status, description, ...} per the schema; every captured Stop
# had [] because a background subagent's finish is delivered as a new prompt,
# so "waiting on N workers" is schema-backed, not capture-backed).
# session_crons are scheduled wake-ups (/loop, CronCreate). Stop does NOT fire
# when the user rejects a permission dialog — that turn is interrupted.
if hook_event == 'Stop':
    tasks = []
    raw_tasks = d.get('background_tasks')
    for task in (raw_tasks if isinstance(raw_tasks, list) else [])[:10]:
        if not isinstance(task, dict):
            continue
        tasks.append({
            'id':          clamp(task.get('id'), 64),
            'type':        clamp(task.get('type'), 40),
            'status':      clamp(task.get('status'), 40),
            'description': one_line(task.get('description'), 120),
        })
    crons = d.get('session_crons')
    emit_session({
        'type':            'session_turn_end',
        'text':            clamp(d.get('last_assistant_message'), 2000),
        'backgroundTasks': tasks,
        'crons':           len(crons) if isinstance(crons, list) else 0,
        'stopHookActive':  bool(d.get('stop_hook_active')),
    })

# PermissionRequest {tool_name, tool_input, permission_suggestions} — Claude
# is waiting for the user's answer (no tool_use_id). In -p mode the call is
# auto-denied as soon as every PermissionRequest hook has finished;
# interactively the dialog stays up and a Notification{permission_prompt}
# follows ~6 s later (deduped server-side). A request raised inside a
# subagent would carry agent_id (schema-only, not captured); it is forwarded
# when present.
#
# Which call asked: with no tool_use_id, the only thing a PermissionRequest
# shares with its own call's PostToolUse is the tool input (captured: the
# PreToolUse, the PermissionRequest and the batch entry of one call carry the
# same tool_input). call_key hashes the tool name and that input; the
# PermissionRequest and every PostToolUse send it, so the server lowers a hand
# only on the finish of the call that raised it, not on another call of the
# same tool running beside it (`git status` next to the `git push` that asked).
# Nothing is printed: the dialog in the terminal is the one that answers.
FILE_TOOLS = ('Write', 'Edit', 'Read', 'MultiEdit', 'NotebookEdit')

def permission_summary(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    if name in FILE_TOOLS:
        path = str(inp.get('file_path') or inp.get('notebook_path') or '')
        return os.path.basename(path.rstrip('/')) or name
    if name == 'Bash':
        return one_line(inp.get('command') or inp.get('description'), 80) or name
    return name

def call_key(name, inp):
    # 16 hex characters of sha256(tool name, NUL, the input as canonical JSON)
    try:
        blob = json.dumps(inp, sort_keys=True, separators=(',', ':'), ensure_ascii=False, default=str)
    except Exception:
        return ''
    return hashlib.sha256((str(name) + '\0' + blob).encode('utf-8', 'replace')).hexdigest()[:16]

if hook_event == 'PermissionRequest':
    name = str(tool_name or 'tool')
    event = {
        'type':     'session_needs_you',
        'kind':     'permission',
        'toolName': name[:80],
        'summary':  permission_summary(name, d.get('tool_input'))[:120],
        'callKey':  call_key(name, d.get('tool_input')),
    }
    if d.get('agent_id'):
        event['agentId'] = str(d['agent_id'])
    emit_session(event)

# Notification {message, notification_type, title?} — only the types that mean
# the session is waiting on a person (or was paused by the quota) are
# forwarded; auth_success, elicitation_*, agent_completed, ... are ignored.
# permission_prompt and idle_prompt are presence-gated (they fire only when
# the user looks away from the terminal), so they are best-effort.
NOTIFICATION_KINDS = {
    'permission_prompt':           'permission',
    'idle_prompt':                 'idle',
    'quota_auto_resume_fired':     'quota',
    'quota_auto_resume_stale':     'quota',
    'quota_auto_resume_disabled':  'quota',
    'agent_needs_input':           'agent-input',
}
if hook_event == 'Notification':
    ntype = str(d.get('notification_type') or '')
    kind = NOTIFICATION_KINDS.get(ntype)
    if not kind:
        sys.exit(0)
    emit_session({
        'type':             'session_needs_you',
        'kind':             kind,
        'notificationType': ntype[:40],
        'message':          one_line(d.get('message'), 200),
    })

# StopFailure {error, error_details?, last_assistant_message?} — the turn
# ended on an API error (rate_limit, overloaded, authentication_failed, ...).
# Never captured locally; shape per the schema and the hooks reference.
if hook_event == 'StopFailure':
    detail = d.get('error_details') or d.get('last_assistant_message') or ''
    emit_session({
        'type':   'session_error',
        'error':  one_line(d.get('error') or 'unknown', 40),
        'detail': one_line(detail, 200),
    })

# PreCompact / PostCompact {trigger: manual|auto} — the summary text is not
# forwarded (it is the conversation). PreCompact fires even when compaction
# is then refused ("Not enough messages"), so a `pre` may have no `post`.
if hook_event in ('PreCompact', 'PostCompact'):
    emit_session({
        'type':    'session_compact',
        'phase':   'pre' if hook_event == 'PreCompact' else 'post',
        'trigger': one_line(d.get('trigger') or 'manual', 20),
    })

# PostToolBatch {tool_calls: [{tool_name, tool_input, tool_use_id, tool_response}]}
# — one per model turn, once every tool call of that turn has an answer
# (a denied one included). The server uses it to lower a permission hand the
# batch has answered, so a headless auto-deny (PermissionRequest, then this
# ~60 ms later) never shows. Inside a subagent (agent_id, captured) the batch
# is that worker's: it answers only a dialog the worker raised, and the
# worker's id travels so the server can tell.
if hook_event == 'PostToolBatch':
    calls = d.get('tool_calls')
    event = {'type': 'session_tool_done', 'batch': True, 'count': len(calls) if isinstance(calls, list) else 0}
    if d.get('agent_id'):
        event['agentId'] = str(d['agent_id'])
    emit_session(event)

# CwdChanged {old_cwd, new_cwd} — after a persistent `cd` in Bash. The
# session's cwd and project tag follow (the payload's own cwd is still the
# old one, so both are set explicitly before emit() fills the defaults).
if hook_event == 'CwdChanged':
    new_cwd = d.get('new_cwd')
    if isinstance(new_cwd, str) and new_cwd:
        event = {'type': 'session_cwd', 'cwd': new_cwd, 'project': os.path.basename(new_cwd.rstrip('/')) or new_cwd}
        if isinstance(d.get('old_cwd'), str) and d['old_cwd']:
            event['oldCwd'] = d['old_cwd']
        emit_session(event)
    sys.exit(0)

# PostModelSwitch {from_model, to_model, requested_model, source, context_tokens, ...}
# — /model, the picker, an SDK set_model or an automatic fallback.
if hook_event == 'PostModelSwitch':
    to_model = d.get('to_model')
    if isinstance(to_model, str) and to_model:
        event = {'type': 'session_model', 'model': to_model[:80]}
        if isinstance(d.get('from_model'), str) and d['from_model']:
            event['fromModel'] = d['from_model'][:80]
        if isinstance(d.get('source'), str) and d['source']:
            event['switchSource'] = d['source'][:20]
        emit_session(event)
    sys.exit(0)

if not tool_name:
    sys.exit(0)

# ── MCP tool calls  (tool names match pattern: mcp__<server>__<tool>) ──────
if tool_name.startswith('mcp__'):
    stripped   = tool_name[len('mcp__'):]
    # Split on first '__' to get server and tool
    parts      = stripped.split('__', 1)
    mcp_server = parts[0] if len(parts) > 0 else ''
    mcp_tool   = parts[1] if len(parts) > 1 else ''

    if hook_event == 'PreToolUse':
        emit({
            'type':   'mcp_call',
            'server': mcp_server,
            'tool':   mcp_tool,
        })
    elif hook_event in ('PostToolUse', 'PostToolUseFailure'):
        # A failed MCP call gets PostToolUseFailure instead of PostToolUse.
        # The tool, the call_key and the subagent it ran in (if any) let the
        # server lower the permission hand this call raised, as
        # session_tool_done does for other tools
        done = {
            'type':    'mcp_done',
            'server':  mcp_server,
            'tool':    mcp_tool,
            'callKey': call_key(tool_name, d.get('tool_input')),
        }
        if d.get('agent_id'):
            done['agentId'] = str(d['agent_id'])
        emit(done)
    sys.exit(0)

# Set when this hook fires for a tool call made inside a subagent
sub_agent_id = d.get('agent_id', '') or ''

def tag_subagent(event):
    # Inside a subagent: the server needs its id to tell its permission
    # dialogs from the main thread's
    if sub_agent_id:
        event['agentId'] = str(sub_agent_id)
    return event

def error_summary(err, limit=60):
    # First `limit` chars of a tool error with its newlines collapsed, e.g.
    # "Exit code 1" + newline + "cat: /x: No such file" -> "Exit code 1 cat: /x: No such file"
    return ' '.join(str(err or '').split())[:limit] or 'unknown error'

def result_text(resp):
    if isinstance(resp, dict):
        out = resp.get('output', resp.get('result', resp.get('content', 'done')))
        if isinstance(out, list):
            out = ' '.join(str(c.get('text', '')) if isinstance(c, dict) else str(c) for c in out)
        return str(out)[:120]
    if isinstance(resp, str):
        return resp[:120]
    return 'done'

# ── Background agent finished — some Claude Code versions hand the report back
# through a SubagentHandback tool call instead of (or as well as) SubagentStop
if tool_name == 'SubagentHandback' and hook_event == 'PostToolUse':
    inp = d.get('tool_input', {}) or {}
    resp = d.get('tool_response', {})
    rd = resp if isinstance(resp, dict) else {}
    subagent_id = (sub_agent_id or inp.get('agent_id') or inp.get('agentId')
                   or rd.get('agent_id') or rd.get('agentId') or '')
    if subagent_id:
        emit({
            'type':    'agent_completed',
            'agentId': str(subagent_id),
            'result':  result_text(resp),
        })
    sys.exit(0)

# ── A tool call errored — Claude Code fires PostToolUseFailure {tool_name,
# tool_input, tool_use_id, error, is_interrupt, duration_ms} and NO PostToolUse
# for that call (a non-zero Bash exit counts: error "Exit code 1\n<stderr>").
if hook_event == 'PostToolUseFailure':
    emit(tag_subagent({
        'type':   'agent_working',
        'status': f"failed: {tool_name} — {error_summary(d.get('error'))}",
        'failed': True,
        'tool':   str(tool_name)[:80],
    }))
    sys.exit(0)

# ── A tool call finished — PostToolUse of anything but the MCP tools handled
# above, on the main thread or inside a subagent (agentId). The permission
# hand this very call raised (call_key) comes down on the server: the call
# ran, so it was granted. A subagent's dialog is its own: its own finish is
# what answers it.
if hook_event == 'PostToolUse':
    done = {'type': 'session_tool_done', 'toolName': str(tool_name)[:80], 'callKey': call_key(tool_name, d.get('tool_input'))}
    if sub_agent_id:
        done['agentId'] = str(sub_agent_id)
    emit_session(done)

# ── Every tool use — a step for the session's Pokémon (server/pokedex.js
# picks the terrain from the tool: Edit grass, Bash cave, Agent the Safari
# Zone, ...) and the session's Claude seen working. The common tools get a
# specific line, which the catch log quotes; anything else a generic one.
if hook_event == 'PreToolUse':
    inp = d.get('tool_input', {})
    inp = inp if isinstance(inp, dict) else {}

    status_map = {
        'Read':  lambda i: f"reading {str(i.get('file_path') or '').replace(chr(92), '/').split('/')[-1]}",
        'Write': lambda i: f"writing {str(i.get('file_path') or '').replace(chr(92), '/').split('/')[-1]}",
        'Edit':  lambda i: f"editing {str(i.get('file_path') or '').replace(chr(92), '/').split('/')[-1]}",
        'Bash':  lambda i: f"running: {str(i.get('command') or i.get('description') or '')[:60]}",
        'Grep':  lambda i: f"searching for '{str(i.get('pattern') or '')[:30]}'",
        'Glob':  lambda i: f"finding files: {str(i.get('pattern') or '')[:40]}",
        'Skill': lambda i: f"using /{i.get('skill') or 'skill'}",
        'Agent': lambda i: f"starting a subagent: {one_line(i.get('description') or i.get('subagent_type') or '', 50)}",
        'Task':  lambda i: f"starting a subagent: {one_line(i.get('description') or i.get('subagent_type') or '', 50)}",
    }

    status_fn = status_map.get(tool_name)
    status = status_fn(inp) if status_fn else f"using {str(tool_name)[:40]}"
    emit(tag_subagent({
        'type': 'agent_working',
        'status': status,
        'tool': str(tool_name)[:80],
    }))

sys.exit(0)
