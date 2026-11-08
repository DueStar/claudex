/**
 * scripts/dist-check.mjs — a lazily loaded page must load its own CSS. The
 * broken case is the 1.3.18 build: one import() expression for three pages.
 */

import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without types
import { missingPageCss, checkDist } from '../scripts/dist-check.mjs'

const files = 'm.f=["assets/QaPage-a.js","assets/Icons-b.js","assets/Icons-c.css","assets/Toast-d.js","assets/Toast-e.css","assets/Widget-f.js","assets/Widget-g.css"]'
const assets = ['QaPage-a.js', 'Icons-b.js', 'Icons-c.css', 'Toast-d.js', 'Toast-e.css', 'Widget-f.js', 'Widget-g.css', 'index-h.js']

describe('dist-check', () => {
  it('finds a page loaded without its CSS (one import() for three pages, 1.3.18)', () => {
    const broken = `${files};lazy(()=>wl(q?()=>import("./QaPage-a.js"):t?()=>import("./Toast-d.js"):()=>import("./Widget-f.js"),__vite__mapDeps([5,1,2,6])))`
    expect(missingPageCss(broken, assets)).toEqual(['Toast-e.css'])
  })

  it('passes when each page lists its own CSS', () => {
    const fixed = `${files};lazy(()=>wl(()=>import("./QaPage-a.js"),__vite__mapDeps([0,1,2,3,4])));lazy(()=>wl(()=>import("./Toast-d.js"),__vite__mapDeps([3,1,2,4])));lazy(()=>wl(()=>import("./Widget-f.js"),__vite__mapDeps([5,1,2,6])))`
    expect(missingPageCss(fixed, assets)).toEqual([])
  })

  it('the current build passes', () => {
    expect(() => checkDist('dist')).not.toThrow()
  })
})
