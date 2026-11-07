/**
 * events.js — the events POST /event accepts (hooks/claudex-hook.cjs sends
 * them) and how their fields are clamped before the server keeps them.
 */

export const KNOWN_EVENT_TYPES = new Set([
  'agent_working',   // a tool call: the main thread's, or a subagent's (agentId)
  'agent_completed', // a subagent finished (agentId)
  'mcp_call',
  'mcp_done',
  'session_started',
  'session_ended',
  // The session's own Claude (`main` on each session, server/index.js)
  'session_prompt',
  'session_turn_end',
  'session_needs_you',
  'session_tool_done',
  'session_error',
  'session_compact',
  'session_cwd',
  'session_model',
])

export const MAX_STRING_LEN = 200
// A prompt or a reply as the hook sends it
export const MAX_TEXT_LEN = 2000
// How much of a prompt or reply the server keeps (the catch log quotes the prompt)
export const PROMPT_TEXT_MAX = 200

export function clampString(val, max = MAX_STRING_LEN) {
  if (typeof val !== 'string') return undefined
  return val.slice(0, max)
}

/** A count from a hook payload: a non-negative integer, else undefined. */
export function clampCount(val, max = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(val) && val >= 0 ? Math.min(val, max) : undefined
}

/** Prompt / reply text as kept: its first PROMPT_TEXT_MAX characters. */
export function transcriptText(text) {
  return String(text ?? '').slice(0, PROMPT_TEXT_MAX)
}

/** Stop.background_tasks as forwarded by the tracker: at most 10, four clamped strings each. */
export function sanitiseTasks(list) {
  if (!Array.isArray(list)) return undefined
  return list.slice(0, 10).filter(t => t && typeof t === 'object').map(t => ({
    id:          clampString(t.id, 64) ?? '',
    type:        clampString(t.type, 40) ?? '',
    status:      clampString(t.status, 40) ?? '',
    description: clampString(t.description, 120) ?? '',
  }))
}

export function validateEvent(body) {
  if (!body || typeof body !== 'object') return 'Missing body'
  if (!body.type || typeof body.type !== 'string') return 'Missing event type'
  if (!KNOWN_EVENT_TYPES.has(body.type)) return `Unknown event type: ${body.type}`
  return null
}
