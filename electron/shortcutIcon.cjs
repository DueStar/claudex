/**
 * electron/shortcutIcon.cjs — points the app's Windows shortcuts at the icon
 * file that ships with app updates.
 *
 * An in-app update replaces resources/app only; spawn.exe, and the icon built
 * into it, stays whatever the first install put there. The Desktop and Start
 * menu shortcuts showed that exe's icon ("spawn.exe,0"), and the taskbar button
 * of a window opened from a shortcut shows the shortcut's icon, so a new app
 * icon never reached either. Each start, a shortcut that opens this exe is
 * pointed at resources/app/electron/assets/icon.ico instead; shortcuts that
 * open anything else are left alone.
 */

const path = require('path')

const SHORTCUT_NAMES = ['spawn.lnk', 'Claudex.lnk']

/** Where the app's shortcuts can be: Desktop, Start menu, pinned taskbar. */
function shortcutDirs({ desktop, appData }) {
  const dirs = []
  if (desktop) dirs.push(desktop)
  if (appData) {
    dirs.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
    dirs.push(path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'))
  }
  return dirs
}

const samePath = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/**
 * Update the shortcuts that open `exePath` so they show `iconPath`. Returns the
 * shortcuts changed. `shell` is Electron's (readShortcutLink/writeShortcutLink).
 */
function pointShortcutsAtIcon({ shell, fs, exePath, iconPath, dirs }) {
  const changed = []
  if (!fs.existsSync(iconPath)) return changed
  for (const dir of dirs) {
    for (const name of SHORTCUT_NAMES) {
      const link = path.join(dir, name)
      if (!fs.existsSync(link)) continue
      let details
      try { details = shell.readShortcutLink(link) } catch { continue }
      if (!samePath(details.target, exePath)) continue
      if (samePath(details.icon, iconPath) && !details.iconIndex) continue
      try {
        if (shell.writeShortcutLink(link, 'update', { icon: iconPath, iconIndex: 0 })) changed.push(link)
      } catch {}
    }
  }
  return changed
}

/**
 * The packaged Windows app's start-up step: fix the shortcuts, then ask the
 * shell to redraw icons (ie4uinit -show) when one changed.
 */
function refreshShortcutIcons({ app, shell, fs = require('fs'), spawn = require('child_process').spawn, log = console }) {
  if (process.platform !== 'win32' || !app.isPackaged) return []
  const iconPath = path.join(__dirname, 'assets', 'icon.ico')
  const dirs = shortcutDirs({ desktop: app.getPath('desktop'), appData: app.getPath('appData') })
  const changed = pointShortcutsAtIcon({ shell, fs, exePath: process.execPath, iconPath, dirs })
  if (changed.length) {
    log.log(`[main] Shortcut icon updated: ${changed.map(l => path.basename(path.dirname(l)) + '\\' + path.basename(l)).join(', ')}`)
    try {
      const sys = process.env.SystemRoot || 'C:\\Windows'
      const child = spawn(path.join(sys, 'System32', 'ie4uinit.exe'), ['-show'], { windowsHide: true, detached: true, stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
    } catch {}
  }
  return changed
}

module.exports = { SHORTCUT_NAMES, shortcutDirs, pointShortcutsAtIcon, refreshShortcutIcons }
