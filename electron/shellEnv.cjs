'use strict'

/**
 * electron/shellEnv.cjs — the environment of a login shell, for an app started
 * from Finder. Finder gives an app launchd's bare PATH (/usr/bin:/bin:…), so
 * claude, git and Homebrew tools are not found; the user's shell knows better.
 * Mac only: anywhere else the environment is returned as it is.
 */

const { execFile } = require('node:child_process')
const path = require('node:path')

const SHELL_VARS = ['LANG', 'LC_ALL', 'LC_CTYPE']

/** `env -0` output (NUL separated NAME=value) -> object */
function parseEnv(output) {
  const out = {}
  for (const entry of String(output ?? '').split('\0')) {
    const i = entry.indexOf('=')
    if (i > 0) out[entry.slice(0, i)] = entry.slice(i + 1)
  }
  return out
}

/** Directories to try when the login shell cannot be asked */
function fallbackDirs(home) {
  return ['/opt/homebrew/bin', '/usr/local/bin', path.posix.join(home, '.local', 'bin')]
}

function mergePath(...lists) {
  const seen = new Set()
  const dirs = []
  for (const list of lists) {
    for (const d of String(list ?? '').split(':')) {
      if (d && !seen.has(d)) { seen.add(d); dirs.push(d) }
    }
  }
  return dirs.join(':')
}

function runShell(shell, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(shell, args, { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

/**
 * env with the login shell's PATH (then what PATH already had, then the usual
 * Homebrew / ~/.local/bin dirs) and a UTF-8 LANG. Never throws and never waits
 * longer than timeoutMs: if the shell fails or hangs, the fallback dirs stand in.
 */
async function mergeLoginEnv({ env = process.env, run = runShell, timeoutMs = 3000, home = require('node:os').homedir(), platform = process.platform, shell } = {}) {
  if (platform !== 'darwin') return env
  const fallback = fallbackDirs(home)
  let login = null
  try {
    const sh = shell || env.SHELL || '/bin/zsh'
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('login shell timed out')), timeoutMs) })
    try {
      login = parseEnv(await Promise.race([run(sh, ['-ilc', 'env -0'], timeoutMs), timeout]))
    } finally {
      clearTimeout(timer)
    }
  } catch {
    login = null
  }
  const merged = { ...env, PATH: mergePath(login?.PATH, env.PATH, fallback.join(':')) }
  for (const k of SHELL_VARS) if (!merged[k] && login?.[k]) merged[k] = login[k]
  if (!merged.LANG && !merged.LC_ALL && !merged.LC_CTYPE) merged.LANG = 'en_US.UTF-8'
  return merged
}

module.exports = { parseEnv, mergeLoginEnv }
