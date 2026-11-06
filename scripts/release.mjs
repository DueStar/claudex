/**
 * release.mjs — build Claudex for Windows and lay out a GitHub release.
 *
 *   node scripts/release.mjs [--publish]          notes from CHANGELOG.md "### <version>"
 *   node scripts/release.mjs "notes…"            build into release/, publish nothing
 *   node scripts/release.mjs "notes…" --publish  also create the GitHub release v<version>
 *
 * Files (release/):
 *   claudex-app-<v>.zip          resources/app only: what the in-app update downloads
 *   Claudex-<v>-win-x64.zip      the whole app, for a first install
 *   latest.json                  read by electron/updater.cjs
 *
 * The version comes from package.json; bump it first. Pokémon artwork is never
 * in a release (package.json build.files excludes it; the app fetches it).
 * --publish needs the gh CLI logged in as DueStar, and refuses to run without the
 * Poké Ball art (tools/import-balls.mjs): releases are built on a PC that has it.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const given = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim()
// Without notes on the command line, the release says what CHANGELOG.md says
// under "### <version>" (read here as UTF-8: notes piped through a Windows
// shell can arrive in the console code page and show as mojibake)
const notes = given || changelogNotes(version)
function changelogNotes(v) {
  const md = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n?/g, '\n')
  const head = `\n### ${v}\n`
  const at = md.indexOf(head)
  if (at < 0) return ''
  const rest = md.slice(at + head.length)
  const end = rest.search(/^#{2,3} /m)
  return (end < 0 ? rest : rest.slice(0, end)).trim()
}
if (!notes) console.warn(`No notes: CHANGELOG.md has no "### ${version}" section`)
const publish = process.argv.includes('--publish')
const out = join(root, 'release')
const unpacked = join(out, 'win-unpacked')

// Windows' own bsdtar (Git's GNU tar would read C: as a host name)
const TAR = join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts })

console.log(`\n== Claudex ${version}`)
const ballDir = join(root, 'public', 'sprites', 'balls')
const balls = existsSync(ballDir) ? readdirSync(ballDir).length : 0
if (balls) console.log(`Poké Ball art: ${balls} bundled`)
else {
  // Ball art is gitignored (it is Nintendo's), so only a PC that imported it can bundle it.
  // A release built without it ships the small PokeAPI item icons to everyone.
  const bar = '!'.repeat(72)
  console.warn(`
${bar}
  NO POKÉ BALL ART on this PC: the build falls back to PokeAPI's small item icons.
  Import it first: node tools/import-balls.mjs <folder with Bag_*_SV_Sprite.png>
${bar}
`)
  if (publish) { console.error('Refusing to publish a release without the ball art.'); process.exit(1) }
}
// The games' Poké Ball as the app icon when its art was imported; the drawn icons come back after
const ICONS = ['build/icon.png', 'electron/assets/icon.png', 'electron/assets/tray-16.png', 'electron/assets/tray-32.png', 'electron/assets/tray-48.png']
run('python', ['-I', join(root, 'tools', 'build-icons.py'), root, '--official'], { shell: false })
try {
  run('npx', ['vite', 'build'])
  run('npx', ['electron-builder', '--win', 'dir', '--x64'])
} finally {
  execFileSync('git', ['checkout', '--', ...ICONS], { cwd: root, stdio: 'inherit' })
}

// Nothing of Nintendo's may ride along
const appDir = join(unpacked, 'resources', 'app')
for (const banned of [join(appDir, 'dist', 'sprites', 'pokemon'), join(appDir, 'public', 'sprites', 'pokemon')]) {
  if (existsSync(banned) && readdirSync(banned).length) throw new Error(`Pokémon artwork in the build: ${banned}`)
}

// When this build was made: the app reads it to tell a newer local build of the same version
const builtAt = new Date().toISOString()
writeFileSync(join(appDir, 'build-info.json'), JSON.stringify({ version, date: builtAt }))

const appZip = `claudex-app-${version}.zip`
const fullZip = `Claudex-${version}-win-x64.zip`
for (const f of [appZip, fullZip]) rmSync(join(out, f), { force: true })
// bsdtar (Windows 10+) writes zip when the name ends in .zip and -a is given
run(TAR, ['-a', '-c', '-f', join(out, appZip), '-C', appDir, '.'], { shell: false })
run(TAR, ['-a', '-c', '-f', join(out, fullZip), '-C', out, 'win-unpacked'], { shell: false })

const sha = createHash('sha256').update(readFileSync(join(out, appZip))).digest('hex')
const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
const manifest = {
  version,
  electron: electronVersion,
  notes,
  date: builtAt,
  app: { file: appZip, sha256: sha, size: statSync(join(out, appZip)).size },
  full: { file: fullZip, size: statSync(join(out, fullZip)).size },
}
writeFileSync(join(out, 'latest.json'), JSON.stringify(manifest, null, 2))
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
console.log(`\napp update ${appZip} ${mb(manifest.app.size)} · full ${fullZip} ${mb(manifest.full.size)} · electron ${electronVersion}`)

if (publish) {
  // Releases go out as DueStar only: check the gh CLI's active login instead of pulling its token
  const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim()
  if (login !== 'DueStar') { console.error(`gh is logged in as ${login}; switch with: gh auth switch -u DueStar`); process.exit(1) }
  run('gh', ['release', 'create', `v${version}`, '--repo', 'DueStar/claudex', '--title', `Claudex ${version}`, '--notes', notes || `Claudex ${version}`,
    join(out, 'latest.json'), join(out, appZip), join(out, fullZip)], { shell: false })
} else {
  console.log('Not published. Add --publish to create the GitHub release.')
}
