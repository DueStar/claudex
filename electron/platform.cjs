/**
 * electron/platform.cjs — which OS we run on, and where per-user data lives.
 * The platform is a parameter so both branches can be tested on any OS.
 */

const os = require('node:os')
const path = require('node:path')

const isMac = (platform = process.platform) => platform === 'darwin'
const isWin = (platform = process.platform) => platform === 'win32'

/** Per-user data folder: %APPDATA%\spawn, ~/Library/Application Support/spawn, ~/.config/spawn. */
function appSupportDir(home = os.homedir(), platform = process.platform, env = process.env) {
  if (isMac(platform)) return path.posix.join(home, 'Library', 'Application Support', 'spawn')
  if (isWin(platform)) {
    const base = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming')
    return path.win32.join(base, 'spawn')
  }
  return path.posix.join(home, '.config', 'spawn')
}

module.exports = { isMac, isWin, appSupportDir }
