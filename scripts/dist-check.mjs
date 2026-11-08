/**
 * dist-check.mjs — after `vite build`: every lazily loaded page whose chunk has
 * its own CSS file must list that CSS among the files loaded with it. In 1.3.18
 * one import() expression for three pages got one page's list, and the
 * notification window showed with no styles (dev mode injects CSS another way,
 * so only the build showed it).
 *
 *   missingPageCss(indexJs, assetNames) → ['Toast-x.css', …] (empty when all is well)
 */

import { readFileSync, readdirSync } from 'node:fs'
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

/** Throws when dist/ has a page that would load without its CSS */
export function checkDist(distDir) {
  const assets = readdirSync(join(distDir, 'assets'))
  const index = assets.find(n => /^index-.*\.js$/.test(n))
  if (!index) throw new Error('dist-check: no index-*.js in dist/assets')
  const missing = missingPageCss(readFileSync(join(distDir, 'assets', index), 'utf8'), assets)
  if (missing.length) throw new Error(`dist-check: these pages would load without their CSS: ${missing.join(', ')}`)
}
