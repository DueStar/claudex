/**
 * status.js — each Claude Code session's context window and the
 * subscription's usage limits, live.
 *
 * Fed by hooks/status-line.cjs, the `statusLine` command Claude Code runs on
 * every state change of an interactive session (the app's sessions get it
 * through their --settings file, electron/terminals.cjs): the numbers are the
 * ones Claude Code hands its status line.
 *
 *   POST /status  { type: 'session_status', sessionId, project, model, modelId,
 *                   context: { used, size, input, output },
 *                   rateLimits?: { fiveHour, sevenDay, spendLimit, <window>ResetsAt } }
 *   GET  /status  → { sessions: [...] }
 *
 * Same token check as POST /event: server/index.js passes its `requireToken`
 * middleware in. Broadcasts `session_status` (one session); the WS snapshot
 * carries the whole summary as `statuses`. Memory only; a session nothing has
 * been heard from for `staleMs` is dropped (a `removed` session_status).
 */

const MAX_STRING_LEN = 200

function clampString(val, max = MAX_STRING_LEN) {
  if (typeof val !== 'string') return undefined
  return val.slice(0, max)
}

/** A finite number clamped to [min, max], else null. */
function clampNumber(val, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null
  return Math.min(max, Math.max(min, val))
}

/** Body check for POST /status: an error string, or null when it can be ingested. */
export function validateStatus(body) {
  if (!body || typeof body !== 'object') return 'Missing body'
  if (!body.type || typeof body.type !== 'string') return 'Missing event type'
  if (body.type !== 'session_status') return `Unknown status type: ${body.type}`
  if (!body.sessionId || typeof body.sessionId !== 'string') return 'Missing sessionId'
  return null
}

function sanitiseRateLimits(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const out = {}
  for (const window of ['fiveHour', 'sevenDay', 'spendLimit']) {
    // used_percentage runs 0-100; spend_limit can run past 100 once exceeded
    const pct = clampNumber(raw[window], 0, 999)
    if (pct !== null) out[window] = pct
    const resets = clampNumber(raw[`${window}ResetsAt`])
    if (resets !== null) out[`${window}ResetsAt`] = resets
  }
  return Object.keys(out).length ? out : undefined
}

/** The store: statuses keyed by session id. `now` is injectable for tests. */
export function createStatusStore({ staleMs = 120 * 60_000, now = () => Date.now() } = {}) {
  /** @type {Map<string, object>} sessionId -> status record */
  const statuses = new Map()

  /** Ingest a validated body; returns the event to broadcast. */
  function ingest(body, t = now()) {
    const id = clampString(body.sessionId)
    const prev = statuses.get(id)
    const ctx = body.context && typeof body.context === 'object' ? body.context : {}
    const rec = {
      sessionId: id,
      project: clampString(body.project) || prev?.project,
      model: clampString(body.model) || prev?.model,
      modelId: clampString(body.modelId) || prev?.modelId,
      context: {
        used: clampNumber(ctx.used, 0, 100),
        size: clampNumber(ctx.size),
        input: clampNumber(ctx.input) ?? 0,
        output: clampNumber(ctx.output) ?? 0,
      },
      rateLimits: sanitiseRateLimits(body.rateLimits),
      firstSeenAt: prev?.firstSeenAt ?? t,
      updatedAt: t,
    }
    statuses.set(id, rec)
    const used = rec.context.used
    console.log(
      `[status] ${rec.project ?? id} · ${rec.model ?? '?'}` +
      ` · ctx ${used === null ? '?' : Math.round(used) + '%'}` +
      (rec.rateLimits?.fiveHour !== undefined ? ` · 5h ${rec.rateLimits.fiveHour}%` : '') +
      (rec.rateLimits?.sevenDay !== undefined ? ` · 7d ${rec.rateLimits.sevenDay}%` : ''),
    )
    return { type: 'session_status', sessionId: id, session: { ...rec }, timestamp: t }
  }

  /** Drop sessions quiet for staleMs; returns the removal events to broadcast. */
  function expireStale(t = now()) {
    const events = []
    for (const [id, rec] of statuses) {
      if (rec.updatedAt >= t - staleMs) continue
      statuses.delete(id)
      console.log(`[status] forgot ${rec.project ?? id}: quiet for ${Math.round(staleMs / 60_000)} min`)
      events.push({ type: 'session_status', sessionId: id, removed: true, timestamp: t })
    }
    return events
  }

  function summary() {
    const list = Array.from(statuses.values())
      .map(rec => ({ ...rec }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { sessions: list }
  }

  return {
    ingest,
    expireStale,
    summary,
    get: id => statuses.get(id),
    has: id => statuses.has(id),
    get size() { return statuses.size },
  }
}

/**
 * Mount POST /status + GET /status on an Express app. `requireToken` is the
 * server's token middleware (server/index.js), handed in rather than imported
 * so this module never pulls in index.js. Returns the store, which is also
 * reachable as app.locals.status. The stale sweep runs every `sweepMs` on an
 * unref'd timer, so importing the server never keeps a process alive.
 */
export function mountStatus(app, { requireToken, broadcast, staleMs, sweepMs = 60_000, now = () => Date.now() } = {}) {
  if (typeof requireToken !== 'function') throw new TypeError('mountStatus needs the requireToken middleware')
  const store = createStatusStore({ staleMs, now })
  app.locals.status = store

  app.post('/status', requireToken, (req, res) => {
    const validationError = validateStatus(req.body)
    if (validationError) {
      return res.status(400).json({ error: validationError })
    }
    broadcast(store.ingest(req.body))
    res.json({ ok: true })
  })

  app.get('/status', (_req, res) => {
    res.json(store.summary())
  })

  const timer = setInterval(() => {
    for (const event of store.expireStale()) broadcast(event)
  }, sweepMs)
  timer.unref?.()

  return store
}
