'use strict'

/**
 * mirrorDir.cjs — make one folder the same as another: how a Mac lays a staged
 * update over Contents/Resources/app (Windows does it with robocopy /MIR).
 *
 * Nothing in `to` changes until every file of `from` has been copied in beside
 * the one it replaces (<name>.spawn-new, keeping its mode). When a copy fails,
 * those copies and the folders made for them go again and the error is thrown:
 * `to` is as it was. Then each copy is renamed over its file (a new file, never
 * one rewritten in place: macOS kills a signed binary that was written over),
 * and only after that is what `from` does not have removed from `to`.
 */

const fs = require('fs')
const path = require('path')

const NEW = '.spawn-new'

const kindOfStat = (st) => (st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'file')

/** 'dir', 'link' or 'file', or null when nothing is there */
function kindOf(fsx, file) {
  try { return kindOfStat(fsx.lstatSync(file)) } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null
    throw err
  }
}

/** Returns how many files were copied and how many entries of `to` were removed. */
function mirrorDir(from, to, fsx = fs) {
  // What the update has, each folder before what is in it (a missing `from` throws here)
  const entries = []
  const walk = (rel) => {
    for (const name of fsx.readdirSync(path.join(from, rel)).sort()) {
      const r = path.join(rel, name)
      const st = fsx.lstatSync(path.join(from, r))
      const kind = kindOfStat(st)
      entries.push({ rel: r, kind, mode: st.mode & 0o7777 })
      if (kind === 'dir') walk(r)
    }
  }
  walk('')

  // Copy everything in beside what it replaces; on any failure take it all back out
  const made = []
  const copies = []
  try {
    if (!kindOf(fsx, to)) { fsx.mkdirSync(to, { recursive: true }); made.push(to) }
    for (const e of entries) {
      const src = path.join(from, e.rel)
      const dest = path.join(to, e.rel)
      const there = kindOf(fsx, dest)
      if (e.kind === 'dir') {
        if (there === 'dir') continue
        if (there) throw new Error(`mirror: ${dest} is a file where the update has a folder`)
        fsx.mkdirSync(dest)
        made.push(dest)
        continue
      }
      if (there === 'dir') throw new Error(`mirror: ${dest} is a folder where the update has a file`)
      const tmp = dest + NEW
      fsx.rmSync(tmp, { force: true }) // left by a run that stopped halfway
      copies.push([tmp, dest])
      if (e.kind === 'link') fsx.symlinkSync(fsx.readlinkSync(src), tmp)
      else {
        fsx.copyFileSync(src, tmp)
        fsx.chmodSync(tmp, e.mode)
      }
    }
  } catch (err) {
    for (const [tmp] of copies) { try { fsx.rmSync(tmp, { force: true }) } catch {} }
    for (const dir of made.reverse()) { try { fsx.rmdirSync(dir) } catch {} }
    throw err
  }

  // Every copy is in: each goes over its file
  for (const [tmp, dest] of copies) fsx.renameSync(tmp, dest)

  // Only now: what the update no longer has. A name the update has in another
  // case is kept (on a Mac's case-insensitive disk it is the same file).
  const kinds = new Map(entries.map(e => [e.rel, e.kind]))
  const lower = new Set(entries.map(e => e.rel.toLowerCase()))
  let removed = 0
  const prune = (rel) => {
    for (const name of fsx.readdirSync(path.join(to, rel))) {
      const r = path.join(rel, name)
      if (kinds.get(r) === 'dir') { prune(r); continue }
      if (kinds.has(r) || lower.has(r.toLowerCase())) continue
      fsx.rmSync(path.join(to, r), { recursive: true, force: true })
      removed++
    }
  }
  prune('')
  return { copied: copies.length, removed }
}

module.exports = { mirrorDir }
