/**
 * logs.cjs — what the app and its server print, kept in userData/logs so a
 * problem can be looked at after the fact (inside a Claudex terminal, or from
 * the shortcut, nobody sees the console). The tray's "로그 폴더 열기" opens it.
 *
 * One file, claudex.log; past maxBytes it becomes claudex.old.log and a new
 * one starts, so the folder never holds more than about twice that.
 */

const fs = require('fs')
const path = require('path')
const util = require('util')

function createLog(dir, { maxBytes = 1024 * 1024 } = {}) {
  const file = path.join(dir, 'claudex.log')
  const old = path.join(dir, 'claudex.old.log')
  let size = 0
  try {
    fs.mkdirSync(dir, { recursive: true })
    size = fs.existsSync(file) ? fs.statSync(file).size : 0
  } catch { /* logging must never stop the app */ }

  function write(text) {
    const lines = String(text).replace(/\r?\n$/, '').split(/\r?\n/)
    const stamp = new Date().toISOString()
    const chunk = lines.map(l => `${stamp} ${l}\n`).join('')
    try {
      if (size + chunk.length > maxBytes) {
        fs.rmSync(old, { force: true })
        if (fs.existsSync(file)) fs.renameSync(file, old)
        size = 0
      }
      fs.appendFileSync(file, chunk)
      size += Buffer.byteLength(chunk)
    } catch { /* a full or locked disk: the console still has it */ }
  }

  return { dir, file, write }
}

/** console.log/info/warn/error keep printing, and go to the log as well */
function teeConsole(log) {
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      original(...args)
      log.write(`${level === 'log' || level === 'info' ? '' : `[${level}] `}${util.format(...args)}`)
    }
  }
}

module.exports = { createLog, teeConsole }
