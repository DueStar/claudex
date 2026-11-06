// node tools/simulate-balls.mjs — a year of play (Max and Pro) through the real game code: which balls catches come in, Master Ball counts, levels
// A year of play through the real game code (server/pokedex.js), to see which balls catches come in
import { createPokedex } from '../server/pokedex.js'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
const R = fileURLToPath(new URL('../server/', import.meta.url))
const species = JSON.parse(readFileSync(R + 'pokemon-data.json', 'utf8'))
const natures = JSON.parse(readFileSync(R + 'natures.json', 'utf8'))
const ballData = JSON.parse(readFileSync(R + 'balls.json', 'utf8'))
const TOOLS = [['Bash', 30], ['Edit', 25], ['Read', 25], ['Grep', 6], ['Glob', 4], ['WebFetch', 3], ['Agent', 4], ['mcp__x__y', 3]]
const pickTool = () => { let r = Math.random() * 100; for (const [t, w] of TOOLS) { r -= w; if (r < 0) return t } return 'Bash' }

function year(stepsPerDay, sessionsPerDay, days = 365) {
  let t = new Date('2026-01-01T09:00:00').getTime()
  const dir = mkdtempSync(join(tmpdir(), 'ballsim-'))
  const events = []
  const ended = new Set()
  const dex = createPokedex({ file: join(dir, 'p.json'), species, natures, balls: ballData.balls, broadcast: (m) => { if (m.event) events.push(m.event) }, now: () => t, isActive: (sid) => !ended.has(sid) })
  let sid = 0
  for (let d = 0; d < days; d++) {
    const dayStart = new Date('2026-01-01T00:00:00').getTime() + d * 86400000
    const per = Math.round(stepsPerDay / sessionsPerDay)
    for (let s = 0; s < sessionsPerDay; s++) {
      // sessions spread over 9:00–25:00
      t = dayStart + (9 + s * (16 / sessionsPerDay) + Math.random() * 1.5) * 3600000
      const id = `s${++sid}`
      dex.noteEvent({ type: 'session_started', sessionId: id }, {})
      for (let k = 0; k < per; k++) {
        t += (20 + Math.random() * 40) * 1000 // a tool call every 20–60 s
        if (Math.random() < 0.08) t += (6 + Math.random() * 20) * 60000 // now and then a break
        dex.noteEvent({ type: 'agent_working', sessionId: id, tool: pickTool() }, {})
      }
      ended.add(id); dex.noteEvent({ type: 'session_ended', sessionId: id }, {})
    }
  }
  const st = dex.publicState()
  rmSync(dir, { recursive: true, force: true })
  return { events, st }
}

for (const [name, perWeek, sessions, trainers] of [['Max', 2500, 4, 8], ['Pro', 500, 2, 16]]) {
  const count = {}, byTier = {}
  let catches = 0, mythMaster = 0, legMaster = 0, master = 0, levels = []
  const t0 = Date.now()
  for (let i = 0; i < trainers; i++) {
    const { events, st } = year(Math.round(perWeek / 7), sessions)
    for (const e of events) {
      if (e.kind !== 'catch') continue
      catches++
      count[e.ball] = (count[e.ball] ?? 0) + 1
      if (e.ball === 'master-ball') { master++; if (e.tier === 'mythical') mythMaster++; if (e.tier === 'legendary') legMaster++ }
    }
    for (const uid of st.party) { const m = st.mons[uid]; levels.push(Math.min(100, (m.metLevel ?? 5) + Math.floor((m.workMs ?? 0) / 1800000))) }
  }
  const tierOf = Object.fromEntries(ballData.balls.map(b => [b.id, b.tier]))
  for (const [id, n] of Object.entries(count)) byTier[tierOf[id]] = (byTier[tierOf[id]] ?? 0) + n
  const ko = Object.fromEntries(ballData.balls.map(b => [b.id, b.ko]))
  console.log(`\n== ${name}: ${trainers} trainers × 1 year (${((Date.now() - t0) / 1000).toFixed(0)}s), ${(catches / trainers).toFixed(0)} catches/year each`)
  console.log('ball tiers:', Object.fromEntries(Object.entries(byTier).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, (100 * v / catches).toFixed(1) + '%'])))
  console.log('balls:', Object.entries(count).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${ko[id]} ${(100 * n / catches).toFixed(2)}%`).join(', '))
  console.log(`master/year ${(master / trainers).toFixed(2)}, of which legendary ${(legMaster / trainers).toFixed(2)}, mythical ${(mythMaster / trainers).toFixed(2)}`)
  console.log(`party levels after a year: median ${levels.sort((a, b) => a - b)[Math.floor(levels.length / 2)]}, max ${levels.at(-1)}`)
}
