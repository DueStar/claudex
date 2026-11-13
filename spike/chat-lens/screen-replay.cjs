'use strict'
/**
 * screen-replay.cjs — THROWAWAY: replay a run's raw pty output into an
 * off-screen @xterm/headless terminal and answer "when did X first show on
 * the screen", or dump the screen at given times. Also tries the "cut the
 * in-progress assistant message out of the TUI frame" extraction (option 3b).
 *
 * Usage:
 *   node screen-replay.cjs <run> words <fromMs> <word> [word…]
 *   node screen-replay.cjs <run> dump <ms> [ms…]
 *   node screen-replay.cjs <run> extract <fromMs> <toMs>     (3b: live text every 250 ms)
 */
const fs = require('fs')
const path = require('path')
const { Terminal } = require('@xterm/headless')
const [run, mode, ...rest] = process.argv.slice(2)
const dir = path.join(__dirname, 'runs', run)
const ev = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const T0 = ev[0].t - ev[0].dt
const spawnEv = ev.find(e => e.what === 'spawn')
const chunks = fs.readFileSync(path.join(dir, 'pty.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
let cols = Number(process.env.COLS || 100), rows = Number(process.env.ROWS || 30)
const resizes = ev.filter(e => e.what === 'resize')
const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 5000 })
const write = (d) => new Promise(r => term.write(d, r))
function screen() {
  const b = term.buffer.active
  const out = []
  for (let i = 0; i < term.rows; i++) out.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? '')
  return out
}

/**
 * 3b heuristic: the assistant's in-progress message is the block of lines
 * that starts at the LAST line beginning with "●" (Claude Code's message
 * bullet) and ends before the spinner / input box / status rows at the bottom
 * (the first line starting with a spinner glyph, "✻", "─" rule, or "❯").
 */
const SPINNER = /^[✻✶✳✢·✽*⏺◐◓◑◒]\s|^─{10,}|^❯|^\s*⏵⏵|^\s*⎿/
function extractLive(lines) {
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) if (/^● /.test(lines[i])) { start = i; break }
  if (start < 0) return null
  const out = []
  for (let i = start; i < lines.length; i++) {
    if (i > start && (SPINNER.test(lines[i].trimStart()) || /^● /.test(lines[i]))) break
    out.push(i === start ? lines[i].replace(/^● /, '') : lines[i].replace(/^  /, ''))
  }
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.join('\n')
}

;(async () => {
  let ri = 0
  if (mode === 'words') {
    const from = Number(rest[0]); const words = rest.slice(1); const found = {}
    for (const c of chunks) {
      while (ri < resizes.length && resizes[ri].t <= c.t) { term.resize(resizes[ri].cols, resizes[ri].rows); ri++ }
      await write(c.data)
      if (c.t - T0 < from) continue
      const s = screen().join('\n')
      for (const w of words) if (!found[w] && s.includes(w)) found[w] = c.t - T0
    }
    for (const w of words) console.log(w.padEnd(20), found[w] ?? '-')
  } else if (mode === 'dump') {
    const at = rest.map(Number).sort((a, b) => a - b); let k = 0
    for (const c of chunks) {
      while (k < at.length && c.t - T0 > at[k]) { console.log(`===== screen at ${at[k]} ms =====\n${screen().join('\n')}`); k++ }
      while (ri < resizes.length && resizes[ri].t <= c.t) { term.resize(resizes[ri].cols, resizes[ri].rows); ri++ }
      await write(c.data)
    }
    while (k < at.length) { console.log(`===== screen at ${at[k]} ms (end) =====\n${screen().join('\n')}`); k++ }
  } else if (mode === 'extract') {
    const from = Number(rest[0]), to = Number(rest[1]); let next = from, last = null
    for (const c of chunks) {
      while (ri < resizes.length && resizes[ri].t <= c.t) { term.resize(resizes[ri].cols, resizes[ri].rows); ri++ }
      await write(c.data)
      const dt = c.t - T0
      if (dt < next || dt > to) continue
      next = dt + 250
      const live = extractLive(screen())
      if (live !== last) { console.log(`--- ${dt} ms (${live ? live.length : 0} chars) ---\n${live ?? '(no ● block on screen)'}`); last = live }
    }
  }
})()
