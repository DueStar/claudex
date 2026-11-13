'use strict'
/**
 * timeline.cjs — THROWAWAY: print a run's merged event log (hooks, transcript
 * lines, control actions, token sightings) one line each, in time order.
 * Usage: node timeline.cjs <run-name> [fromMs] [toMs]
 */
const fs = require('fs')
const path = require('path')
const [name, from = 0, to = Infinity] = process.argv.slice(2)
const lines = fs.readFileSync(path.join(__dirname, 'runs', name, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const short = (s, n = 70) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s }
for (const e of lines) {
  if (e.dt < Number(from) || e.dt > Number(to)) continue
  let msg = ''
  if (e.src === 'hook' && e.body) {
    const b = e.body
    const bits = [b.hook_event_name || e.event]
    if (b.session_id) bits.push(`sid=${b.session_id.slice(0, 8)}`)
    if (b.tool_name) bits.push(`tool=${b.tool_name}`)
    if (b.tool_use_id) bits.push(`tuid=…${b.tool_use_id.slice(-6)}`)
    if (b.agent_id) bits.push(`agent=${String(b.agent_id).slice(0, 8)}/${b.agent_type ?? ''}`)
    if (b.source) bits.push(`source=${b.source}`)
    if (b.reason) bits.push(`reason=${b.reason}`)
    if (b.notification_type) bits.push(`ntype=${b.notification_type} msg=${short(b.message, 50)}`)
    if (b.permission_mode) bits.push(`mode=${b.permission_mode}`)
    if (b.hook_event_name === 'MessageDisplay') bits.push(`msg=${String(b.message_id).slice(0, 8)} idx=${b.index} final=${b.final} delta=${JSON.stringify(short(b.delta, 60))}`)
    if (b.prompt) bits.push(`prompt=${JSON.stringify(short(b.prompt, 50))}`)
    if (b.last_assistant_message) bits.push(`last=${JSON.stringify(short(b.last_assistant_message, 50))}`)
    if (b.transcript_path) bits.push(`tx=${path.basename(b.transcript_path).slice(0, 8)}`)
    msg = bits.join(' ')
  } else if (e.src === 'hook') {
    msg = `#${e.id} ${e.what} ${e.heldMs ?? ''}ms ${short(JSON.stringify(e.reply ?? ''), 80)}`
  } else if (e.src === 'tx') {
    msg = e.what ? `${e.what} ${e.file} ${e.oldSize ?? ''}` : `${short(e.file, 14)}#${e.n} ${e.type}${e.subtype ? '/' + e.subtype : ''} ${e.role ?? ''} ${e.msgId ? 'id=…' + e.msgId.slice(-6) : ''} ${e.stop ?? ''} ${e.sidechain ? 'SIDECHAIN' : ''}${e.meta ? 'META' : ''} ${(e.blocks || []).join(' | ')} ${e.attachment ?? ''} ${e.content ?? ''} ${e.toolUseResultKeys ? 'tUR=' + [].concat(e.toolUseResultKeys).join(',') : ''}`
  } else if (e.src === 'watch') {
    msg = `token ${e.token} first seen in ${e.source}`
  } else {
    msg = `${e.what} ${short(JSON.stringify(e.text ?? e.data ?? e.args ?? e.mode ?? e.token ?? ''), 90)}`
  }
  console.log(`${String(e.dt).padStart(7)} ${e.src.padEnd(5)} ${msg}`)
}
