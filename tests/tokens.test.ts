/**
 * src/styles/tokens.css — the one place the calm look's design values live
 * (차분하게 2). Pins the values the plan's token table fixes, the contrast floors
 * (body text 4.5:1, secondary and meta text 3:1 on every background it sits on),
 * and that no other stylesheet redefines them.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
const css = read('src', 'styles', 'tokens.css').replace(/\/\*[\s\S]*?\*\//g, '')

/** `--name: value` pairs of the first block whose selector matches `selector` exactly */
function block(selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*{([^}]*)}`))
  if (!m) throw new Error(`no ${selector} block in tokens.css`)
  const out: Record<string, string> = {}
  for (const [, name, value] of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim()
  return out
}

const root = block(':root')

/** A token's value with var() references followed */
function resolve(name: string, depth = 0): string {
  const v = root[name]
  if (v === undefined) throw new Error(`${name} is not on :root`)
  const ref = v.match(/^var\((--[\w-]+)\)$/)
  if (ref && depth < 5) return resolve(ref[1], depth + 1)
  return v
}

// WCAG relative luminance and contrast ratio, as calm-lab/lab.js ratio()
function rgb(c: string): number[] {
  if (c.startsWith('#')) {
    const n = c.length === 4 ? c.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : c
    return [1, 3, 5].map(i => parseInt(n.substr(i, 2), 16))
  }
  throw new Error(`not an opaque hex colour: ${c}`)
}
const lum = (c: string) =>
  rgb(c)
    .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
function contrast(fg: string, bg: string): number {
  const x = lum(fg), y = lum(bg)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const TYPE = ['--t-micro', '--t-meta', '--t-ui', '--t-name', '--t-prose', '--t-num', '--t-head', '--t-big', '--t-code']
const px = (...n: number[]) => Object.fromEntries(TYPE.map((k, i) => [k, `${n[i]}px`]))

describe('tokens.css', () => {
  it('holds the three greys, the line, the radii and the measures of the table', () => {
    expect(root['--ink']).toBe('#d7dae3')
    expect(root['--ink-2']).toBe('#a4a9b6')
    expect(root['--ink-3']).toBe('#7d8291')
    expect(root['--line']).toBe('rgba(255, 255, 255, 0.07)')
    expect([root['--r-xs'], root['--r-s'], root['--r-m'], root['--r-l']]).toEqual(['3px', '4px', '6px', '8px'])
    expect(root['--side-w']).toBe('300px')
    expect(root['--head-h']).toBe('44px')
  })

  it('usage bars: grey, amber from 80 %, the danger red from 90 %', () => {
    expect(root['--bar']).toBe('var(--ink-3)')
    expect(root['--bar-warn']).toBe('var(--amber)')
    expect(root['--bar-danger']).toBe('var(--danger)')
    expect(resolve('--bar-danger')).toBe('#ff6464')
    expect(root['--bar-h']).toBe('2px')
  })

  it('holds the four text steps exactly (보통 on :root)', () => {
    const pick = (o: Record<string, string>) => Object.fromEntries(TYPE.map(k => [k, o[k]]))
    expect(pick(root)).toEqual(px(10, 11, 12, 12, 13, 12, 14, 15, 12))
    expect(block(':root.ts-small')).toEqual(px(9, 10, 11, 11, 12, 11, 13, 14, 11))
    expect(block(':root.ts-large')).toEqual(px(10, 11, 12, 13, 14, 13, 15, 16, 13))
    expect(block(':root.ts-xlarge')).toEqual(px(11, 12, 13, 14, 15, 14, 16, 17, 14))
  })

  const SURFACES = ['--bg', '--side-bg', '--card', '--card-2', '--mon-bg', '--term-bg']
  it('body text is 4.5:1 and secondary text 3:1 on every surface', () => {
    for (const bg of SURFACES) {
      expect(contrast(resolve('--ink'), resolve(bg)), `--ink on ${bg}`).toBeGreaterThanOrEqual(4.5)
      for (const fg of ['--ink-2', '--ink-3', '--red-text', '--amber', '--green', '--hp']) {
        expect(contrast(resolve(fg), resolve(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('every tier colour is 3:1 on the page, the card and the toast', () => {
    const tiers = ['common', 'rare', 'sub', 'legendary', 'mythical']
    for (const tier of tiers) {
      const colour = block(`.tier-${tier}`)['--tier']
      expect(colour, `.tier-${tier}`).toMatch(/^#[0-9a-f]{6}$/i)
      for (const bg of ['--bg', '--card', '--toast-bg']) {
        expect(contrast(colour, resolve(bg)), `.tier-${tier} on ${bg}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('a tier is a coloured dot beside its word, never a filled chip (the dot rule lives here)', () => {
    const dot = css.match(/(?:^|[}\s])\.tdot\s*{([^}]*)}/)
    expect(dot, '.tdot rule in tokens.css').not.toBeNull()
    expect(dot![1]).toMatch(/background:\s*var\(--tier\)/)
    expect(dot![1]).toMatch(/border-radius:\s*50%/)
    const dex = read('src', 'components', 'PokedexView.tsx')
    // Every tier chip: the dot, then the tier's word as text (the word keeps tiers apart without hue)
    const chip = dex.match(/<div className="dex-chips">([\s\S]*?)<\/div>/)
    expect(chip, 'the tier chips').not.toBeNull()
    expect(chip![1]).toMatch(/<i className="tdot" aria-hidden="true" \/>\s*\{TIER_LABEL\[k\]\}/)
    // The detail card's tier: the dot and the word, too
    expect(dex).toMatch(/className=\{`dex-tier tier-[^`]*`\}><i className="tdot" aria-hidden="true" \/>\{TIER_LABEL\[/)
  })

  it('no other stylesheet defines the tokens or the tier colours', () => {
    const others = readdirSync(join(ROOT, 'src', 'styles')).filter(f => f.endsWith('.css') && f !== 'tokens.css')
    expect(others.length).toBeGreaterThan(0)
    for (const f of others) {
      const text = read('src', 'styles', f).replace(/\/\*[\s\S]*?\*\//g, '')
      expect(text, `${f} defines --ink`).not.toMatch(/--ink\s*:/)
      expect(text, `${f} defines --card`).not.toMatch(/--card\s*:/)
      expect(text, `${f} defines .tier-common`).not.toMatch(/\.tier-common\s*{/)
    }
  })

  it('each page imports tokens.css before every other stylesheet', () => {
    for (const page of ['Widget.tsx', 'QaPage.tsx', 'Toast.tsx']) {
      const imports = [...read('src', page).matchAll(/^import\s+['"]([^'"]+\.css)['"]/gm)].map(m => m[1])
      expect(imports[0], page).toBe('./styles/tokens.css')
    }
  })
})
