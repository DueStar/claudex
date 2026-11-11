/**
 * spawn-hook.cjs — Claude Code hook -> the spawn server.
 *
 * Claude Code passes the hook event as JSON on stdin. buildEvent turns it into
 * one server event (or nothing), which is POSTed, signed with the server
 * token, to http://127.0.0.1:3334/event (SPAWN_PORT / SPAWN_EVENT_URL move
 * it). The app's sessions get this hook through their --settings file
 * (electron/terminals.cjs), run by the app itself in Node mode.
 *
 * Hook events handled:
 *   PreToolUse         a tool call: a step for the session's Pokémon, and the
 *                      session's Claude seen working
 *   PostToolUse        a call finished: lowers the permission hand that very
 *                      call raised (main thread or subagent)
 *   PostToolUseFailure a tool call errored (a non-zero Bash exit lands here and
 *                      gets NO PostToolUse)
 *   SubagentStop       a subagent finished (lowers a hand it raised)
 *   SessionStart/End   the session began (startup/resume/compact/clear/fork) / exited
 *   UserPromptSubmit   the trainer's prompt (or a background task waking Claude)
 *   Stop               Claude's turn ended: its reply + the background work still running
 *   PermissionRequest  Claude is waiting for a permission answer
 *   Notification       permission_prompt / idle_prompt / quota_* / agent_needs_input
 *   StopFailure        the turn ended on an API error
 *   PreCompact/PostCompact  context compaction started / finished
 *   PostToolBatch      a batch of tool calls finished
 *   CwdChanged         the session cd'd somewhere else (the project tag follows)
 *   PostModelSwitch    the session runs another model now
 *
 * Every event carries the session it came from: sessionId (session_id),
 * project (the cwd's last folder), cwd and transcriptPath.
 *
 * Nothing is ever printed on stdout: on UserPromptSubmit it would be injected
 * into Claude's context, on PermissionRequest it would answer the dialog. The
 * exit code is always 0, and a stopped server costs at most the 1 s timeout.
 *
 * The payload shapes are the ones Claude Code 2.1.300 was observed sending
 * (tests/hook-script.test.ts holds verbatim captures).
 */

const { createHash } = require('crypto')

// ── Python-like helpers: the event shapes were defined by the earlier Python
// hook, whose truthiness and code-point slicing these keep

/** Python truthiness: '', 0, false, null, [] and {} are false */
function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}
const or = (...vals) => vals.find(truthy) ?? vals[vals.length - 1]
const str = (v) => (v === null || v === undefined ? '' : String(v))
const isStr = (v) => typeof v === 'string'
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** The first `limit` characters, counting an emoji as one (never half a surrogate pair) */
function cut(s, limit) {
  s = str(s)
  if (s.length <= limit) return s
  const chars = Array.from(s)
  return chars.length > limit ? chars.slice(0, limit).join('') : s
}
const clamp = (v, limit) => cut(str(v), limit)
/** Labels: whitespace collapsed, then clamped */
const oneLine = (v, limit) => cut(str(v).split(/\s+/).filter(Boolean).join(' '), limit)

/** The last folder of a path, either slash: /x/proj/ -> proj */
function baseName(p) {
  const t = str(p).replace(/[\\/]+$/, '')
  return t.split(/[\\/]/).pop() || ''
}

/** Canonical JSON: keys sorted, no spaces */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * Which call asked: a PermissionRequest has no tool_use_id, and the only thing
 * it shares with its own call's PostToolUse is the tool input. call_key hashes
 * the tool name and that input, so the server lowers a hand only on the finish
 * of the call that raised it, not on another call of the same tool beside it.
 */
function callKey(name, input) {
  return createHash('sha256').update(`${str(name)}\0${canonical(input)}`, 'utf8').digest('hex').slice(0, 16)
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'Read', 'MultiEdit', 'NotebookEdit'])

function permissionSummary(name, inp) {
  inp = isObj(inp) ? inp : {}
  if (FILE_TOOLS.has(name)) return baseName(or(inp.file_path, inp.notebook_path, '')) || name
  if (name === 'Bash') return oneLine(or(inp.command, inp.description), 80) || name
  return name
}

/** Notification types that mean the session waits on a person (or was paused by the quota) */
const NOTIFICATION_KINDS = {
  permission_prompt: 'permission',
  idle_prompt: 'idle',
  quota_auto_resume_fired: 'quota',
  quota_auto_resume_stale: 'quota',
  quota_auto_resume_disabled: 'quota',
  agent_needs_input: 'agent-input',
}

function errorSummary(err, limit = 60) {
  return oneLine(or(err, ''), limit) || 'unknown error'
}

function resultText(resp) {
  if (isObj(resp)) {
    let out = 'output' in resp ? resp.output : 'result' in resp ? resp.result : 'content' in resp ? resp.content : 'done'
    if (Array.isArray(out)) out = out.map(c => (isObj(c) ? str(c.text) : str(c))).join(' ')
    return cut(str(out), 120)
  }
  if (isStr(resp)) return cut(resp, 120)
  return 'done'
}

const fileOf = (i) => str(or(i.file_path, '')).replace(/\\/g, '/').split('/').pop()
const STATUS = {
  Read: (i) => `reading ${fileOf(i)}`,
  Write: (i) => `writing ${fileOf(i)}`,
  Edit: (i) => `editing ${fileOf(i)}`,
  Bash: (i) => `running: ${cut(str(or(i.command, i.description, '')), 60)}`,
  Grep: (i) => `searching for '${cut(str(or(i.pattern, '')), 30)}'`,
  Glob: (i) => `finding files: ${cut(str(or(i.pattern, '')), 40)}`,
  Skill: (i) => `using /${str(or(i.skill, 'skill'))}`,
  Agent: (i) => `starting a subagent: ${oneLine(or(i.description, i.subagent_type, ''), 50)}`,
  Task: (i) => `starting a subagent: ${oneLine(or(i.description, i.subagent_type, ''), 50)}`,
}

/**
 * The server event for a hook payload, or null when there is nothing to send.
 * Text is clamped HERE as well as on the server: an oversize body would be
 * refused whole (413) and the state change lost along with the text.
 */
/** An app session's own id (the terminal's), set in its environment by the app; else '' */
function terminalSessionId(env = process.env) {
  const id = String(env.SPAWN_SESSION_ID || '')
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : ''
}

/**
 * `terminalId`: the app terminal this Claude Code runs in. /clear gives the
 * conversation a new session_id in the same terminal (SessionEnd 'clear', then
 * SessionStart 'clear'): everything is reported under the terminal's id, so its
 * row and Pokémon carry on instead of showing the session as ended.
 */
function buildEvent(d, terminalId = terminalSessionId()) {
  if (!isObj(d)) return null
  const hookEvent = str(d.hook_event_name)
  const toolName = str(d.tool_name)

  // Session identity: session_id, transcript_path and cwd are in the base
  // schema of every hook event (captured 2.1.300)
  const session = {}
  if (truthy(d.session_id)) session.sessionId = str(d.session_id)
  if (terminalId && session.sessionId) session.sessionId = terminalId
  if (isStr(d.cwd) && d.cwd) {
    session.project = baseName(d.cwd) || d.cwd
    session.cwd = d.cwd
  }
  if (isStr(d.transcript_path) && d.transcript_path) session.transcriptPath = d.transcript_path

  const emit = (event) => {
    for (const [k, v] of Object.entries(session)) if (!(k in event)) event[k] = v
    return event
  }
  // The main thread's events all need the session they belong to
  const emitSession = (event) => {
    if (truthy(d.prompt_id)) event.promptId = cut(str(d.prompt_id), 80)
    return session.sessionId ? emit(event) : null
  }

  switch (hookEvent) {
    // SessionStart {source, model?, session_title?}; SessionEnd {reason}
    case 'SessionStart': {
      const event = { type: 'session_started', source: str(or(d.source, 'startup')) }
      if (truthy(d.model)) event.model = str(d.model)
      if (truthy(d.session_title)) event.title = cut(str(d.session_title), 120)
      return session.sessionId ? emit(event) : null
    }
    case 'SessionEnd':
      // In an app terminal /clear ends only the conversation: the session goes on
      if (terminalId && d.reason === 'clear') return null
      return session.sessionId ? emit({ type: 'session_ended', reason: str(or(d.reason, 'other')) }) : null

    // A subagent finished. SubagentStop also fires for sidechains that are not
    // workers (the compaction summariser, the prompt-suggestion pass), both
    // with agent_type "": phantoms, nothing is sent for them.
    case 'SubagentStop':
      if (truthy(d.agent_id) && truthy(d.agent_type)) {
        return emit({ type: 'agent_completed', agentId: str(d.agent_id), result: cut(str(or(d.last_assistant_message, 'done')), 120) })
      }
      return null

    // The trainer's prompt. A background subagent reporting back arrives as a
    // prompt that begins "<task-notification>"; such a wake-up is flagged and
    // only its <summary> line travels, never the XML or the agent's result.
    case 'UserPromptSubmit': {
      const prompt = isStr(d.prompt) ? d.prompt : ''
      const event = { type: 'session_prompt', text: clamp(prompt, 2000), isWakeup: false }
      if (prompt.trimStart().startsWith('<task-notification>')) {
        event.isWakeup = true
        let m = prompt.match(/<task-id>\s*([^<\s]+)\s*<\/task-id>/)
        if (m) event.wakeupAgentId = cut(m[1], 80)
        m = prompt.match(/<status>\s*([^<\s]+)\s*<\/status>/)
        if (m) event.wakeupStatus = cut(m[1], 40)
        m = prompt.match(/<summary>([\s\S]*?)<\/summary>/)
        event.text = oneLine(m ? m[1] : 'a background task finished', 2000)
      }
      return emitSession(event)
    }

    // Claude's turn ended: its reply, the background work still in flight and
    // the scheduled wake-ups (/loop, CronCreate)
    case 'Stop': {
      const tasks = (Array.isArray(d.background_tasks) ? d.background_tasks : []).slice(0, 10).filter(isObj).map(t => ({
        id: clamp(t.id, 64),
        type: clamp(t.type, 40),
        status: clamp(t.status, 40),
        description: oneLine(t.description, 120),
      }))
      return emitSession({
        type: 'session_turn_end',
        text: clamp(d.last_assistant_message, 2000),
        backgroundTasks: tasks,
        crons: Array.isArray(d.session_crons) ? d.session_crons.length : 0,
        stopHookActive: truthy(d.stop_hook_active),
      })
    }

    // Claude waits for the user's answer (no tool_use_id; callKey ties it to its call)
    case 'PermissionRequest': {
      const name = toolName || 'tool'
      const event = {
        type: 'session_needs_you',
        kind: 'permission',
        toolName: cut(name, 80),
        summary: cut(permissionSummary(name, d.tool_input), 120),
        callKey: callKey(name, d.tool_input),
      }
      if (truthy(d.agent_id)) event.agentId = str(d.agent_id)
      return emitSession(event)
    }

    case 'Notification': {
      const ntype = str(d.notification_type)
      const kind = NOTIFICATION_KINDS[ntype]
      if (!kind) return null
      return emitSession({ type: 'session_needs_you', kind, notificationType: cut(ntype, 40), message: oneLine(d.message, 200) })
    }

    case 'StopFailure':
      return emitSession({
        type: 'session_error',
        error: oneLine(or(d.error, 'unknown'), 40),
        detail: oneLine(or(d.error_details, d.last_assistant_message, ''), 200),
      })

    // The summary text is not forwarded (it is the conversation)
    case 'PreCompact':
    case 'PostCompact':
      return emitSession({ type: 'session_compact', phase: hookEvent === 'PreCompact' ? 'pre' : 'post', trigger: oneLine(or(d.trigger, 'manual'), 20) })

    // Once every tool call of a turn has an answer: the server lowers a
    // permission hand the batch has answered (a headless auto-deny never shows)
    case 'PostToolBatch': {
      const event = { type: 'session_tool_done', batch: true, count: Array.isArray(d.tool_calls) ? d.tool_calls.length : 0 }
      if (truthy(d.agent_id)) event.agentId = str(d.agent_id)
      return emitSession(event)
    }

    // The payload's own cwd is still the old one, so both are set here
    case 'CwdChanged': {
      if (!isStr(d.new_cwd) || !d.new_cwd) return null
      const event = { type: 'session_cwd', cwd: d.new_cwd, project: baseName(d.new_cwd) || d.new_cwd }
      if (isStr(d.old_cwd) && d.old_cwd) event.oldCwd = d.old_cwd
      return emitSession(event)
    }

    case 'PostModelSwitch': {
      if (!isStr(d.to_model) || !d.to_model) return null
      const event = { type: 'session_model', model: cut(d.to_model, 80) }
      if (isStr(d.from_model) && d.from_model) event.fromModel = cut(d.from_model, 80)
      if (isStr(d.source) && d.source) event.switchSource = cut(d.source, 20)
      return emitSession(event)
    }
  }

  if (!toolName) return null
  const subAgentId = truthy(d.agent_id) ? str(d.agent_id) : ''
  const tagSubagent = (event) => { if (subAgentId) event.agentId = subAgentId; return event }

  // MCP tool calls: mcp__<server>__<tool>
  if (toolName.startsWith('mcp__')) {
    const stripped = toolName.slice('mcp__'.length)
    const at = stripped.indexOf('__')
    const server = at < 0 ? stripped : stripped.slice(0, at)
    const tool = at < 0 ? '' : stripped.slice(at + 2)
    if (hookEvent === 'PreToolUse') return emit({ type: 'mcp_call', server, tool })
    if (hookEvent === 'PostToolUse' || hookEvent === 'PostToolUseFailure') {
      // A failed MCP call gets PostToolUseFailure instead; either lowers the hand it raised
      return emit(tagSubagent({ type: 'mcp_done', server, tool, callKey: callKey(toolName, d.tool_input) }))
    }
    return null
  }

  // Some Claude Code versions hand a background agent's report back through a
  // SubagentHandback tool call instead of (or as well as) SubagentStop
  if (toolName === 'SubagentHandback' && hookEvent === 'PostToolUse') {
    const inp = isObj(d.tool_input) ? d.tool_input : {}
    const resp = d.tool_response
    const rd = isObj(resp) ? resp : {}
    const id = or(subAgentId, inp.agent_id, inp.agentId, rd.agent_id, rd.agentId, '')
    return truthy(id) ? emit({ type: 'agent_completed', agentId: str(id), result: resultText(resp) }) : null
  }

  if (hookEvent === 'PostToolUseFailure') {
    return emit(tagSubagent({
      type: 'agent_working',
      status: `failed: ${toolName} — ${errorSummary(d.error)}`,
      failed: true,
      tool: cut(toolName, 80),
    }))
  }

  // A call finished: the hand this very call raised comes down (it ran, so it was granted)
  if (hookEvent === 'PostToolUse') {
    return emitSession(tagSubagent({ type: 'session_tool_done', toolName: cut(toolName, 80), callKey: callKey(toolName, d.tool_input) }))
  }

  // Every tool use: a step for the session's Pokémon (server/pokedex.js picks
  // the terrain from the tool) and the session's Claude seen working
  if (hookEvent === 'PreToolUse') {
    const inp = isObj(d.tool_input) ? d.tool_input : {}
    const status = STATUS[toolName] ? STATUS[toolName](inp) : `using ${cut(toolName, 40)}`
    return emit(tagSubagent({ type: 'agent_working', status, tool: cut(toolName, 80) }))
  }
  return null
}

/** stdin -> event -> signed POST; always exits 0, prints nothing */
async function main() {
  // When the hook started: a tool-call hook runs in the background (async), so its event can
  // reach the server after a later one; the server tells by this time
  const startedAt = Date.now()
  const { readStdin, postJson, serverUrl } = require('./post.cjs')
  let event = null
  let d = null
  try { d = JSON.parse((await readStdin()) || '{}') } catch { /* not JSON: nothing to send */ }
  if (d) {
    event = buildEvent(d)
    // The conversation now going on in this app terminal (another one after /clear): what reopening it resumes
    const link = process.env.SPAWN_LINK_FILE
    if (link && isObj(d) && d.hook_event_name === 'SessionStart' && terminalSessionId() && /^[0-9a-f-]{36}$/i.test(String(d.session_id))) {
      try { require('fs').writeFileSync(link, String(d.session_id)) } catch { /* not worth failing the hook */ }
    }
  }
  if (event) await postJson(serverUrl('event'), JSON.stringify({ ...event, at: startedAt }))
  process.exit(0)
}

if (require.main === module) main()

module.exports = { buildEvent, callKey, canonical, terminalSessionId }
