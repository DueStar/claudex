'use strict'

/**
 * history.cjs — past Claude Code sessions, from every project, for the app's
 * "이어하기" (resume) picker. Read-only: it lists transcripts under
 * ~/.claude/projects and checks ~/.claude/sessions for the ones still running.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const HEAD_BYTES = 512 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function readHead(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

/** The first thing a person typed: a string, or the first text block, skipping command/system wrappers. */
function promptText(message) {
  const c = message && message.content
  const text = typeof c === 'string' ? c
    : Array.isArray(c) ? (c.find(b => b && b.type === 'text' && typeof b.text === 'string') || {}).text : null
  if (!text) return null
  const t = text.trim()
  if (!t || t.startsWith('<') || t.startsWith('Caveat:')) return null
  return t.replace(/\s+/g, ' ').slice(0, 120)
}

/** cwd, title and first prompt of one transcript, from its first 512 KB. */
function describe(file) {
  let cwd = null
  let first = null
  let title = null
  for (const line of readHead(file).split('\n')) {
    if (!line || line[0] !== '{') continue
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    if (!cwd && typeof rec.cwd === 'string') cwd = rec.cwd
    if (!title && (rec.type === 'custom-title' || rec.type === 'summary')) title = rec.customTitle || rec.summary || null
    if (!first && rec.type === 'user' && !rec.isMeta && !rec.isSidechain) first = promptText(rec.message)
    if (cwd && first && title) break
  }
  return { cwd, first, title }
}

/** Session ids whose Claude Code process is alive, from the session registry. */
function runningSessions() {
  const out = new Set()
  const dir = path.join(claudeDir(), 'sessions')
  let names = []
  try { names = fs.readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      if (!rec.sessionId || !rec.pid) continue
      process.kill(rec.pid, 0) // throws when the process is gone
      out.add(rec.sessionId)
    } catch {}
  }
  return out
}

/**
 * The most recently used sessions across all projects (newest first). Skips
 * claude-mem's observer folder and empty transcripts.
 */
function listHistory({ limit = 40 } = {}) {
  const root = path.join(claudeDir(), 'projects')
  const files = []
  let projects = []
  try { projects = fs.readdirSync(root, { withFileTypes: true }) } catch { return [] }
  for (const p of projects) {
    if (!p.isDirectory() || p.name.includes('claude-mem-observer')) continue
    let entries = []
    try { entries = fs.readdirSync(path.join(root, p.name)) } catch { continue }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue
      const id = name.slice(0, -6)
      if (!UUID.test(id)) continue
      const file = path.join(root, p.name, name)
      try {
        const st = fs.statSync(file)
        if (st.size > 0) files.push({ id, file, mtime: st.mtimeMs, size: st.size })
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const running = runningSessions()
  const out = []
  for (const f of files) {
    if (out.length >= limit) break
    let d
    try { d = describe(f.file) } catch { continue }
    if (!d.cwd || !d.first) continue // nothing a person said: not worth resuming
    if (isTempCwd(d.cwd)) continue // throwaway temp folders
    out.push({
      id: f.id, cwd: d.cwd, project: path.basename(d.cwd), title: d.title || d.first,
      updatedAt: f.mtime, sizeKb: Math.round(f.size / 1024), running: running.has(f.id),
    })
  }
  return out
}

/** Throwaway temp folders (Windows %TEMP%, macOS /var/folders): sessions started there are not worth resuming */
function isTempCwd(cwd) {
  return /[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(cwd) || /^(\/private)?\/var\/folders\//.test(cwd)
}

module.exports = { listHistory, promptText, isTempCwd }
