'use strict'

/**
 * prereqs.cjs — what a session needs on this PC, and where to get what is
 * missing. Each tool is probed by running it (a Windows Store "python3" stub
 * resolves on PATH without Python installed, so a path alone proves nothing).
 *
 *   claude  Claude Code itself: the sessions run it
 *   git     Git for Windows: Claude Code and Claudex's hooks run in its Git Bash
 *   python  Python 3: Claudex's hooks build their events with it
 */

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const LINKS = Object.freeze({
  claude: 'https://docs.claude.com/en/docs/claude-code/setup',
  git: 'https://git-scm.com/downloads/win',
  python: 'https://www.python.org/downloads/windows/',
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

async function pythonVersion() {
  for (const cmd of ['python3', 'python', 'py']) {
    const out = await run(cmd, ['--version'])
    if (out && /Python 3\./.test(out)) return out.split('\n')[0]
  }
  return null
}

/** { claude, git, python } -> { ok, version, link } */
async function checkPrereqs() {
  const [claude, git, python] = await Promise.all([claudeVersion(), gitVersion(), pythonVersion()])
  // Debug: POKEMON_OFFICE_FAKE_MISSING=python,git pretends those are not installed
  const fake = new Set(String(process.env.POKEMON_OFFICE_FAKE_MISSING || '').split(',').filter(Boolean))
  const item = (version, key) => (fake.has(key) ? { ok: false, version: null, link: LINKS[key] } : { ok: !!version, version, link: LINKS[key] })
  return { claude: item(claude, 'claude'), git: item(git, 'git'), python: item(python, 'python') }
}

module.exports = { checkPrereqs, LINKS }
