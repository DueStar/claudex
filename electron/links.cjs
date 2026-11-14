/**
 * electron/links.cjs — a file named in a session's output: where it is, and the editor link
 * that opens it. The platform is a parameter so both can be tested on any OS.
 */

const os = require('node:os')
const path = require('node:path')
const { isMac } = require('./platform.cjs')

/**
 * The file a clicked reference means: resolved against the session's folder; on macOS a
 * ~/ path is in the home folder
 */
function resolveRef(cwd, file, { platform = process.platform, home = os.homedir() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix
  if (isMac(platform) && file.startsWith('~/')) return p.join(home, file.slice(2))
  return p.resolve(cwd, file)
}

/**
 * vscode://file/C:/a/x.ts or vscode://file/Users/a/x.ts (cursor:// the same): each part of
 * the path encoded, forward slashes, and no double slash after file/ for a / path
 */
function vscodeUrl(abs, { scheme = 'vscode', platform = process.platform } = {}) {
  const parts = abs.split(platform === 'win32' ? /[\\/]/ : '/')
  const joined = parts.map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')
  return `${scheme}://file/${abs.startsWith('/') ? joined.slice(1) : joined}`
}

module.exports = { resolveRef, vscodeUrl }
