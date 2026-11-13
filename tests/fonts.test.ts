/**
 * The app's typefaces ship with it (public/fonts) so every PC renders the same,
 * whatever fonts it has installed. Read from the repository only: nothing here
 * depends on the fonts this PC has.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TERM_FONT_STACKS } from '../src/termFont'
// @ts-expect-error plain ESM script without types
import { FONT_LICENCES, fontUrls, missingFonts } from '../scripts/dist-check.mjs'

const FONTS = join(__dirname, '..', 'public', 'fonts')
const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8')
const fontsCss = read('public', 'fonts', 'fonts.css')

type Face = { family: string; src: string[]; weight: string; style: string; display: string }
const faces: Face[] = [...fontsCss.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => {
  const prop = (name: string) => body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].trim() ?? ''
  return {
    family: prop('font-family').replace(/^['"]|['"]$/g, ''),
    src: prop('src').split(/,(?![^(]*\))/).map(s => s.trim()),
    weight: prop('font-weight'),
    style: prop('font-style'),
    display: prop('font-display'),
  }
})
const bundled = new Set(faces.map(f => f.family))
const families = (stack: string) => stack.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))

// Monospace faces a terminal stack may name: the bundled ones, Windows' own, the optional choices
const MONO = /^(Monaspace Neon( Var)?|Consolas|Cascadia (Mono|Code)|D2Coding( ligature)?|monospace)$/
// On every Windows PC (Consolas) or shipped with the app
const ALWAYS_MONO = (f: string) => f === 'Consolas' || (bundled.has(f) && /^Monaspace/.test(f))

describe('bundled fonts', () => {
  it('the font files are there, real woff2 and not tiny', () => {
    const files = readdirSync(FONTS).filter(n => n.endsWith('.woff2'))
    expect(files.sort()).toEqual(['MonaspaceNeonVar.woff2', 'PretendardVariable.woff2', 'UncutSansVariable.woff2'])
    for (const f of files) {
      const buf = readFileSync(join(FONTS, f))
      expect(buf.subarray(0, 4).toString('latin1'), f).toBe('wOF2')
      expect(statSync(join(FONTS, f)).size, f).toBeGreaterThan(50_000)
    }
  })

  it('every face loads the bundled file first, and that file exists', () => {
    expect(faces.length).toBeGreaterThanOrEqual(6)
    for (const face of faces) {
      expect(face.src[0], face.family).toMatch(/^url\('[^']+\.woff2'\) format\('woff2'\)$/)
      for (const url of fontUrls(face.src[0])) expect(statSync(join(FONTS, url)).size).toBeGreaterThan(50_000)
      expect(face.weight, face.family).toMatch(/^\d+ \d+$/) // a range: the variable weight axis
      // spelled out: left out (auto) Chromium would draw italic from the slant axis, unlike before
      expect(face.style, face.family).toBe('normal')
    }
    expect(fontUrls(fontsCss).sort()).toEqual(['MonaspaceNeonVar.woff2', 'PretendardVariable.woff2', 'UncutSansVariable.woff2'])
  })

  it('declares the names the code uses, the UI aliases with their weights unchanged', () => {
    for (const name of ['Monaspace Neon Var', 'Monaspace Neon', 'Pretendard Variable', 'W Pretendard', 'Uncut Sans Variable', 'W Uncut']) {
      expect(bundled.has(name), name).toBe(true)
    }
    expect(faces.find(f => f.family === 'W Uncut')!.weight).toBe('100 900')
    expect(faces.find(f => f.family === 'W Pretendard')!.weight).toBe('45 920')
    // the wordmark's 570 is inside the Uncut faces' range
    for (const f of faces.filter(f => /Uncut/.test(f.family))) {
      const [lo, hi] = f.weight.split(' ').map(Number)
      expect(lo <= 570 && 570 <= hi).toBe(true)
    }
  })

  it('the terminal faces block until loaded (xterm must not measure a stand-in)', () => {
    for (const f of faces.filter(f => /^Monaspace/.test(f.family))) expect(f.display, f.family).toBe('block')
  })

  it('the default terminal font is bundled; the optional ones stay installed-only', () => {
    expect(bundled.has(families(TERM_FONT_STACKS.default)[0])).toBe(true)
    for (const name of ['Consolas', 'Cascadia Mono', 'Cascadia Code', 'D2Coding']) expect(bundled.has(name), name).toBe(false)
  })

  it('in every terminal stack a monospace face that is always there comes before any proportional or CJK face', () => {
    for (const [choice, stack] of Object.entries(TERM_FONT_STACKS)) {
      const list = families(stack)
      const first = list.findIndex(ALWAYS_MONO)
      expect(first, choice).toBeGreaterThanOrEqual(0)
      for (const f of list.slice(0, first + 1)) expect(f, `${choice}: ${f}`).toMatch(MONO)
      // Korean still has a face after it
      expect(list.slice(first), choice).toContain('Pretendard Variable')
    }
  })

  it('every face a stylesheet names first is bundled (no page relies on an installed font)', () => {
    const sheets = readdirSync(join(__dirname, '..', 'src', 'styles')).map(n => read('src', 'styles', n))
    const firsts = new Set<string>()
    for (const css of [...sheets, read('electron', 'status-card.html')]) {
      for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) firsts.add(families(m[1])[0])
      for (const m of css.matchAll(/\bfont\s*:\s*[^;}]*?\d+px(?:\/[\d.]+)?\s+([^;}]+)/g)) firsts.add(families(m[1])[0])
    }
    firsts.delete('inherit')
    expect(firsts.size).toBeGreaterThan(0)
    for (const f of firsts) expect(bundled.has(f), f).toBe(true)
    // the faces live in one place: no stylesheet declares its own
    for (const css of sheets) expect(css).not.toMatch(/@font-face/)
  })

  it('every page loads the shared stylesheet', () => {
    expect(read('index.html')).toMatch(/<link rel="stylesheet" href="\/fonts\/fonts\.css"/)
    const card = read('electron', 'status-card.html')
    expect(card).toMatch(/<link rel="stylesheet" href="\.\.\/dist\/fonts\/fonts\.css">/)
    // the card's CSP lets it read the stylesheet and the fonts from disk
    const csp = card.match(/Content-Security-Policy" content="([^"]+)"/)![1]
    expect(csp).toMatch(/style-src [^;]*file:/)
    expect(csp).toMatch(/font-src file:/)
  })

  it('the OFL licences ship beside the fonts, and NOTICE names each font', () => {
    const notice = read('NOTICE.md')
    for (const file of FONT_LICENCES as string[]) {
      const text = readFileSync(join(FONTS, file), 'utf8')
      expect(text, file).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i)
      expect(text, file).toMatch(/Copyright/)
      expect(notice).toContain(`public/fonts/${file}`)
    }
    for (const name of ['Monaspace', 'Pretendard', 'Uncut Sans']) expect(notice).toContain(name)
  })
})

describe('dist-check: the fonts in a build', () => {
  it('finds a build without the fonts, and passes one that has them all', () => {
    const dist = mkdtempSync(join(tmpdir(), 'spawn-dist-fonts-'))
    try {
      expect(missingFonts(dist)).toEqual(['fonts/fonts.css'])
      mkdirSync(join(dist, 'fonts'))
      writeFileSync(join(dist, 'fonts', 'fonts.css'), fontsCss)
      writeFileSync(join(dist, 'fonts', 'PretendardVariable.woff2'), 'tiny')
      const missing = missingFonts(dist)
      expect(missing).toContain('fonts/MonaspaceNeonVar.woff2')
      expect(missing).toContain('fonts/PretendardVariable.woff2') // too small to be the font
      expect(missing).toContain('fonts/LICENSE-Pretendard.txt')
      for (const f of readdirSync(FONTS)) writeFileSync(join(dist, 'fonts', f), readFileSync(join(FONTS, f)))
      expect(missingFonts(dist)).toEqual([])
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })
})
