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
