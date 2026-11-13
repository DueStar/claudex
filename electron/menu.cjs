/**
 * electron/menu.cjs — the application menu's template. The platform is a parameter so
 * both menus can be tested on any OS.
 */

const { isMac } = require('./platform.cjs')

const EDIT_ROLES = ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'separator', 'selectAll']

function menuTemplate({ platform = process.platform, appName, t, toggleWidget }) {
  const mac = isMac(platform)
  return [
    ...(mac ? [{ role: 'appMenu' }] : []),
    {
      label: appName,
      submenu: [
        { label: t('보이기/숨기기'), click: toggleWidget },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        ...(mac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    // Windows: the edit menu's shortcuts are not registered (registerAccelerator: false):
    // registered, they caught Ctrl+X / Ctrl+Z / Ctrl+A before the terminal, so Claude Code never
    // got them (Ctrl+X starts its chords). Text fields still cut, undo and select all by
    // themselves; the terminal copies and pastes in its own key handler (TerminalPanel).
    // macOS: ⌘ keys are not Claude Code's, and text fields only get ⌘C / ⌘V / ⌘Z from this
    // menu, so its shortcuts are registered. The page sees each key first: a ⌘ key the app
    // takes itself (⌘V in the terminal, ⌘W) is stopped there and never reaches the menu.
    {
      label: t('편집'),
      submenu: EDIT_ROLES.map(role => (role === 'separator' ? { type: 'separator' } : mac ? { role } : { role, registerAccelerator: false })),
    },
    ...(mac ? [{
      label: t('창'),
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }],
    }] : []),
  ]
}

module.exports = { menuTemplate }
