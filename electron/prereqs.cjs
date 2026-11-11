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

async function claudeVersion() {
  const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
  const out = (fs.existsSync(local) && await run(local, ['--version'])) || await run('claude', ['--version'])
  return out ? out.split('\n')[0] : null
}

async function gitVersion() {
  const out = await run('git', ['--version'])
  if (out) return out.split('\n')[0]
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  return process.platform === 'win32' && fs.existsSync(bash) ? 'Git Bash' : null
}

/** { claude, git } -> { ok, version, link } */
async function checkPrereqs() {
  const [claude, git] = await Promise.all([claudeVersion(), gitVersion()])
  // Debug: SPAWN_FAKE_MISSING=claude,git pretends those are not installed
  const fake = new Set(String(process.env.SPAWN_FAKE_MISSING || '').split(',').filter(Boolean))
  const item = (version, key) => (fake.has(key) ? { ok: false, version: null, link: LINKS[key] } : { ok: !!version, version, link: LINKS[key] })
  return { claude: item(claude, 'claude'), git: item(git, 'git') }
}

module.exports = { checkPrereqs, LINKS }
