/** Renderer-side platform check: ⌘ on Mac, Ctrl elsewhere. */

let override: string | null = null

/** Tests pin the platform ('mac' / 'win'); null goes back to detection. */
export function setPlatformForTest(p: string | null): void {
  override = p
}

export function isMac(): boolean {
  if (override !== null) return /mac/i.test(override)
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return /mac/i.test(nav.userAgentData?.platform || nav.platform || '')
}

/** True when the platform's command modifier is held (⌘ on Mac, Ctrl elsewhere). */
export function modKey(e: Pick<KeyboardEvent | MouseEvent | WheelEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return isMac() ? e.metaKey : e.ctrlKey
}

export function modLabel(): '⌘' | 'Ctrl' {
  return isMac() ? '⌘' : 'Ctrl'
}

/** A key with the platform's modifier, as tooltips name it: ⌘1 on Mac, Ctrl+1 elsewhere */
export function modCombo(key: string): string {
  return isMac() ? `⌘${key}` : `Ctrl+${key}`
}

/**
 * The words that differ per platform, as translation keys (Korean text, run
 * through t()). The shell on a Mac is the login shell, which main labels with
 * its basename; zsh is the macOS default, so it names the word here.
 */
export function platformWord(key: 'tray' | 'startup' | 'taskbar' | 'shell', mac: boolean): string {
  const words = {
    tray: ['트레이', '메뉴 막대'],
    startup: ['Windows 시작 시 실행', '로그인 시 실행'],
    taskbar: ['작업 표시줄 깜빡이기', 'Dock 아이콘 튀기기'],
    shell: ['PowerShell', 'zsh'],
  } as const
  return words[key][mac ? 1 : 0]
}
