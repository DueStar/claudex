/**
 * src/mainState.ts — whether a waiting session needs a person now, and a
 * session's project from its cwd.
 */

import { describe, expect, it } from 'vitest'
import { isHardNeedsYou, projectFromCwd } from '../src/mainState'

describe('mainState helpers', () => {
  it('tells hard needs-you kinds (a person must act) from soft ones', () => {
    expect(isHardNeedsYou({ kind: 'permission' })).toBe(true)
    expect(isHardNeedsYou({ kind: 'agent-input' })).toBe(true)
    // An unhooked session the registry marks "waiting" has a dialog on its screen
    expect(isHardNeedsYou({ kind: 'registry' })).toBe(true)
    expect(isHardNeedsYou({ kind: 'idle' })).toBe(false)
    expect(isHardNeedsYou({ kind: 'quota' })).toBe(false)
    expect(isHardNeedsYou(undefined)).toBe(false)
  })

  it('derives a project from a cwd on either platform', () => {
    expect(projectFromCwd('/home/me/claudex/')).toBe('claudex')
    expect(projectFromCwd('C:\\src\\api')).toBe('api')
    expect(projectFromCwd('C:\\src\\api\\')).toBe('api')
    expect(projectFromCwd(undefined)).toBeUndefined()
  })
})
