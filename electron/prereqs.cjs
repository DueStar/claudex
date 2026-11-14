'use strict'

/**
 * prereqs.cjs — what a session needs on this PC, and where to get what is
 * missing. Each tool is probed by running it (a path alone proves nothing).
 *
 *   claude  Claude Code itself: the sessions run it
 *   git     Git for Windows: Claude Code runs its shell, and so spawn's hooks,
 *           in its Git Bash (the hooks themselves run on the app: no Python)
 */

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const LINKS = Object.freeze({
  claude: 'https://docs.claude.com/en/docs/claude-code/setup',
  git: 'https://git-scm.com/downloads/win',
})

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      resolve(err ? null : `${stdout}${stderr}`.trim())
    })
  })
}

async function claudeVersion({ platform, run, home, exists }) {
  const local = path.join(home, '.local', 'bin', platform === 'win32' ? 'claude.exe' : 'claude')
  const out = (exists(local) && await run(local, ['--version'])) || await run('claude', ['--version'])
  return out ? out.split('\n')[0] : null
}

async function gitVersion({ platform, run, exists }) {
  // On the Mac `git` without the Xcode command line tools pops up an install dialog:
  // ask xcode-select first, and never run git without them. Git is optional there.
  if (platform === 'darwin' && !(await run('xcode-select', ['-p']))) return null
  const out = await run('git', ['--version'])
  if (out) return out.split('\n')[0]
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  return platform === 'win32' && exists(bash) ? 'Git Bash' : null
}

/** { claude, git } -> { ok, version, link } */
async function checkPrereqs({ platform = process.platform, run: runner = run, home = os.homedir(), exists = fs.existsSync } = {}) {
  const ctx = { platform, run: runner, home, exists }
  const [claude, git] = await Promise.all([claudeVersion(ctx), gitVersion(ctx)])
  // Debug: SPAWN_FAKE_MISSING=claude,git pretends those are not installed
  const fake = new Set(String(process.env.SPAWN_FAKE_MISSING || '').split(',').filter(Boolean))
  const item = (version, key, optional = false) => (fake.has(key) ? { ok: false, version: null, link: LINKS[key] } : { ok: optional || !!version, version, link: LINKS[key] })
  return { claude: item(claude, 'claude'), git: item(git, 'git', platform === 'darwin') }
}

module.exports = { checkPrereqs, LINKS }
