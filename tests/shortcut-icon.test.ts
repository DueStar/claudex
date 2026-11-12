/**
 * electron/shortcutIcon.cjs — the Windows shortcuts that open spawn.exe are
 * pointed at the icon file shipped with app updates; others are left alone.
 */

import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { pointShortcutsAtIcon, shortcutDirs } = require('../electron/shortcutIcon.cjs')

const EXE = path.resolve('/apps/spawn/spawn.exe')
const ICO = path.resolve('/apps/spawn/resources/app/electron/assets/icon.ico')
const DESK = path.resolve('/home/Desktop')
const START = path.resolve('/home/Start')

function fakeShell(links: Record<string, { target: string, icon?: string, iconIndex?: number }>) {
  const writes: Array<{ link: string, op: string, opts: unknown }> = []
  return {
    writes,
    readShortcutLink: (link: string) => { if (!links[link]) throw new Error('no link'); return links[link] },
    writeShortcutLink: (link: string, op: string, opts: unknown) => { writes.push({ link, op, opts }); return true },
  }
}
const fakeFs = (files: string[]) => ({ existsSync: (p: string) => files.includes(p) })

describe('shortcut icon', () => {
  it('points a shortcut that opens the exe at the shipped icon', () => {
    const link = path.join(DESK, 'spawn.lnk')
    const shell = fakeShell({ [link]: { target: EXE, icon: EXE, iconIndex: 0 } })
    const changed = pointShortcutsAtIcon({ shell, fs: fakeFs([ICO, link]), exePath: EXE, iconPath: ICO, dirs: [DESK] })
    expect(changed).toEqual([link])
    expect(shell.writes).toEqual([{ link, op: 'update', opts: { icon: ICO, iconIndex: 0 } }])
  })

  it('also fixes an old Claudex shortcut, matching the exe path case-insensitively', () => {
    const link = path.join(START, 'Claudex.lnk')
    const shell = fakeShell({ [link]: { target: EXE.toUpperCase() } })
    const changed = pointShortcutsAtIcon({ shell, fs: fakeFs([ICO, link]), exePath: EXE, iconPath: ICO, dirs: [START] })
    expect(changed).toEqual([link])
  })

  it('leaves shortcuts to another program, and ones already right, alone', () => {
    const other = path.join(DESK, 'spawn.lnk')
    const done = path.join(START, 'spawn.lnk')
    const shell = fakeShell({
      [other]: { target: path.resolve('/elsewhere/spawn.exe') },
      [done]: { target: EXE, icon: ICO, iconIndex: 0 },
    })
    const changed = pointShortcutsAtIcon({ shell, fs: fakeFs([ICO, other, done]), exePath: EXE, iconPath: ICO, dirs: [DESK, START] })
    expect(changed).toEqual([])
    expect(shell.writes).toEqual([])
  })

  it('does nothing when the icon file is missing', () => {
    const link = path.join(DESK, 'spawn.lnk')
    const shell = fakeShell({ [link]: { target: EXE } })
    expect(pointShortcutsAtIcon({ shell, fs: fakeFs([link]), exePath: EXE, iconPath: ICO, dirs: [DESK] })).toEqual([])
  })

  it('looks on the Desktop, in the Start menu and among pinned taskbar items', () => {
    const dirs = shortcutDirs({ desktop: DESK, appData: path.resolve('/home/AppData/Roaming') })
    expect(dirs[0]).toBe(DESK)
    expect(dirs.some((d: string) => d.endsWith(path.join('Start Menu', 'Programs')))).toBe(true)
    expect(dirs.some((d: string) => d.endsWith(path.join('User Pinned', 'TaskBar')))).toBe(true)
  })
})
