'use strict'
/**
 * samples.cjs — THROWAWAY: print short, truncated samples of the transcript
 * entry kinds a chat renderer cares about, plus hook payload key sets from a
 * run, to build the minimal schema in FINDINGS.md.
 * Usage: node samples.cjs <transcript.jsonl> [run-name]
 */
const fs = require('fs')
const path = require('path')
const [file, run] = process.argv.slice(2)
const DROP = new Set(['userType', 'entrypoint', 'cwd', 'sessionId', 'session_id', 'version', 'gitBranch', 'slug', 'usage', 'requestId', 'requestRef', 'serverClassifierRequest', 'advisorModel', 'promptCacheRequested', 'container', 'diagnostics', 'context_management', 'input_transformations', 'stop_details', 'stop_sequence', 'signature'])
const trunc = (o, n = 90) => {
  if (typeof o === 'string') return o.length > n ? `${o.slice(0, n)}…[${o.length}]` : o
  if (Array.isArray(o)) return o.slice(0, 8).map(x => trunc(x, n))
  if (o && typeof o === 'object') { const r = {}; for (const k in o) if (!DROP.has(k)) r[k] = trunc(o[k], n); return r }
  return o
}
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const shown = new Set()
for (const o of lines) {
  const c = Array.isArray(o.message?.content) ? o.message.content : []
  const kind = o.type === 'assistant' ? `assistant:${c.map(b => b.type === 'tool_use' ? `tool_use(${b.name})` : b.type).join('+')}`
    : o.type === 'user' ? `user:${o.isMeta ? 'meta' : ''}${c.map(b => b.type === 'tool_result' ? 'tool_result' : b.type).join('+') || typeof o.message?.content}${o.toolUseResult ? `/${Object.keys(o.toolUseResult).slice(0, 3).join(',')}` : ''}`
      : `${o.type}${o.subtype ? '/' + o.subtype : ''}${o.attachment ? ':' + o.attachment.type : ''}`
  if (shown.has(kind)) continue
  shown.add(kind)
  console.log(`\n## ${kind}\n${JSON.stringify(trunc(o))}`)
}
if (run) {
  const ev = fs.readFileSync(path.join(__dirname, 'runs', run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  const keys = {}
  for (const e of ev) if (e.src === 'hook' && e.body) keys[e.event] = [...new Set([...(keys[e.event] || []), ...Object.keys(e.body)])]
  console.log('\n## hook payload keys\n' + Object.entries(keys).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n'))
  const post = ev.find(e => e.event === 'PostToolUse' && e.body?.tool_name === 'Bash')
  if (post) console.log('\n## PostToolUse(Bash) tool_response\n' + JSON.stringify(trunc(post.body.tool_response)))
}
