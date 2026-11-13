/**
 * dist-check.mjs — after `vite build`: every lazily loaded page whose chunk has
 * its own CSS file must list that CSS among the files loaded with it. In 1.3.18
 * one import() expression for three pages got one page's list, and the
 * notification window showed with no styles (dev mode injects CSS another way,
 * so only the build showed it).
 *
 *   missingPageCss(indexJs, assetNames) → ['Toast-x.css', …] (empty when all is well)
 *
 * Also the app's bundled fonts (public/fonts, copied into dist/fonts): the
 * stylesheet, every file it names, and the licences that must ship with them.
 *
 *   missingFonts(distDir) → ['fonts/X.woff2', …] (empty when all is well)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function missingPageCss(indexJs, assetNames) {
  const files = indexJs.match(/m\.f=\[([^\]]*)\]/)?.[1].split(',').map(s => s.trim().replace(/^"|"$/g, '').replace(/^assets\//, '')) ?? []
  const missing = []
  // Each dynamic import is preloaded with the next dependency list after it (the call it sits in)
  for (const m of indexJs.matchAll(/import\("\.\/([A-Za-z]+)-[\w-]+\.js"\)/g)) {
    const css = assetNames.find(n => n.startsWith(`${m[1]}-`) && n.endsWith('.css'))
    if (!css) continue
    const deps = indexJs.slice(m.index).match(/__vite__mapDeps\(\[([\d,]*)\]\)/)?.[1] ?? ''
    const listed = deps.split(',').filter(Boolean).map(i => files[Number(i)])
    if (!listed.includes(css)) missing.push(css)
  }
  return missing
}

/** The OFL licence texts that ship beside the fonts (public/fonts) */
export const FONT_LICENCES = ['LICENSE-Monaspace.txt', 'LICENSE-Pretendard.txt', 'LICENSE-UncutSans.txt']

/** The font files a fonts.css names in its url(...) sources, each once */
export function fontUrls(css) {
  return [...new Set([...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1]))]
}

/** What dist/fonts lacks: fonts.css, a font file it names (or one suspiciously small), a licence */
export function missingFonts(distDir) {
  const dir = join(distDir, 'fonts')
  const css = join(dir, 'fonts.css')
  if (!existsSync(css)) return ['fonts/fonts.css']
  const missing = []
  for (const file of fontUrls(readFileSync(css, 'utf8'))) {
    const at = join(dir, file)
    if (!existsSync(at) || statSync(at).size < 10_000) missing.push(`fonts/${file}`)
  }
  for (const file of FONT_LICENCES) if (!existsSync(join(dir, file))) missing.push(`fonts/${file}`)
  return missing
}

/** Throws when dist/ has a page that would load without its CSS, or lacks the bundled fonts */
export function checkDist(distDir) {
  const fonts = missingFonts(distDir)
  if (fonts.length) throw new Error(`dist-check: the build lacks the app's fonts: ${fonts.join(', ')}`)
  const assets = readdirSync(join(distDir, 'assets'))
  const index = assets.find(n => /^index-.*\.js$/.test(n))
  if (!index) throw new Error('dist-check: no index-*.js in dist/assets')
  const missing = missingPageCss(readFileSync(join(distDir, 'assets', index), 'utf8'), assets)
  if (missing.length) throw new Error(`dist-check: these pages would load without their CSS: ${missing.join(', ')}`)
}
