/**
 * status-line.cjs — the `statusLine` command of the app's sessions.
 *
 * Claude Code runs it after each assistant message with the session's
 * numbers on stdin (model, cost, context window, rate limits). It POSTs them
 * to the server's /status (signed, like the hook) for the usage cards, and
 * prints a short default line for the terminal's status bar:
 *   Claude Opus 5.5 · ctx 42% · $1.23
 */

/** A finite number, else null (booleans and strings are not numbers here) */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function text(v, limit = 120) {
  if (typeof v === 'string') return Array.from(v).slice(0, limit).join('')
  if (typeof v === 'number' && Number.isFinite(v)) return String(v).slice(0, limit)
  return ''
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

/** { event, line }: the /status body (null without a session id) and the line to print */
function buildStatus(d, env = process.env) {
  d = obj(d)
  // In an app terminal the numbers belong to the terminal's session, also after /clear (see claudex-hook.cjs)
  const own = String(env.CLAUDEX_SESSION_ID || '')
  const sessionId = text(d.session_id, 200) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(own) ? own : text(d.session_id, 200)
  const model = obj(d.model)
  const cost = obj(d.cost)
  const ctx = obj(d.context_window)
  const rl = obj(d.rate_limits)
  const ws = obj(d.workspace)
  const projectDir = text(ws.project_dir, 400) || text(ws.current_dir, 400) || text(d.cwd, 400)
  const project = projectDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || projectDir
  const modelName = text(model.display_name) || text(model.id) || 'Claude'
  const totalCost = num(cost.total_cost_usd) || 0
  const used = num(ctx.used_percentage)

  const event = {
    type: 'session_status',
    sessionId,
    project,
    model: modelName,
    modelId: text(model.id),
    context: {
      used,
      size: num(ctx.context_window_size),
      input: num(ctx.total_input_tokens) || 0,
      output: num(ctx.total_output_tokens) || 0,
    },
  }
  const limits = {}
  for (const [src, dst] of [['five_hour', 'fiveHour'], ['seven_day', 'sevenDay'], ['spend_limit', 'spendLimit']]) {
    const window = rl[src]
    if (!window || typeof window !== 'object' || Array.isArray(window)) continue
    const pct = num(window.used_percentage)
    if (pct !== null) limits[dst] = pct
    const resets = num(window.resets_at)
    if (resets !== null) limits[`${dst}ResetsAt`] = resets
  }
  if (Object.keys(limits).length) event.rateLimits = limits

  const line = `${modelName} · ctx ${used !== null ? Math.round(used) : 0}% · $${totalCost.toFixed(2)}`
  return { event: sessionId ? event : null, line }
}

async function main() {
  const { readStdin, postJson, serverUrl } = require('./post.cjs')
  const raw = await readStdin()
  if (!raw) process.exit(0)
  let payload = {}
  try { payload = JSON.parse(raw) } catch { /* the line still prints */ }
  const { event, line } = buildStatus(payload)
  if (event) await postJson(serverUrl('status'), JSON.stringify(event))
  // Exit only once the line is out: on POSIX a pipe write can still be pending
  process.stdout.write(`${line}\n`, () => process.exit(0))
}

if (require.main === module) main()

module.exports = { buildStatus }
