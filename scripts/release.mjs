/**
 * release.mjs — build spawn for Windows and lay out a GitHub release.
 *
 *   node scripts/release.mjs [--publish]          notes from CHANGELOG.md "### <version>"
 *   node scripts/release.mjs "notes…"            build into release/, publish nothing
 *   node scripts/release.mjs "notes…" --publish  also create the GitHub release v<version>
 *
 * Files (release/):
 *   claudex-app-<v>.zip        resources/app only: what the in-app update downloads
 *                              (still the old name: 1.3.35 and older accept only claudex-app-*.zip;
 *                              newer clients accept spawn-app-*.zip too, for a later switch)
 *   spawn-<v>-win-x64.zip      the whole app, for a first install
 *   latest.json                  read by electron/updater.cjs
 *
 * The version comes from package.json; bump it first. Pokémon artwork is never
 * in a release (package.json build.files excludes it; the app fetches it).
 * latest.json is signed with the release key (scripts/signing.mjs; make it
 * once with scripts/signing-key.mjs) and the app ignores a GitHub manifest the
 * key does not verify.
 *
 * --publish checks everything first and stops before building when any of it
 * is off (preflight below): gh logged in as DueStar, the working tree clean
 * and pushed (the release tag goes on GitHub's main, so an unpushed commit
 * would tag the wrong one — v1.3.7 did), no v<version> release yet, a
 * CHANGELOG section for the version, every Poké Ball's art imported
 * (tools/import-balls.mjs: releases are built on a PC that has it), and the
 * signing key.
 */

import { execFileSync } from 'node:child_process'
import { checkDist } from './dist-check.mjs'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signManifest, signingKeyPath } from './signing.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const given = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim()
// Without notes on the command line, the release says what CHANGELOG.md says
// under "### <version>" (read here as UTF-8: notes piped through a Windows
// shell can arrive in the console code page and show as mojibake)
const notes = given || changelogNotes(version)
// The update button's tooltip shows the notes in the app's language
const notesEn = given ? '' : changelogNotes(version, 'spawn (English)')
const notesJa = given ? '' : changelogNotes(version, 'spawn (日本語)')
/** The "### <v>" notes in the "## <section>" part of CHANGELOG.md (by default the first, Korean, one) */
function changelogNotes(v, section = null) {
  let md = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n?/g, '\n')
  if (section) {
    const s = md.indexOf(`\n## ${section}\n`)
    if (s < 0) return ''
    md = md.slice(s + section.length + 4)
    const next = md.search(/^## /m)
    if (next >= 0) md = md.slice(0, next)
    md = `\n${md}`
  }
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

console.log(`\n== spawn ${version}`)
const ballDir = join(root, 'public', 'sprites', 'balls')
const ballIds = JSON.parse(readFileSync(join(root, 'server', 'balls.json'), 'utf8')).balls.map(b => b.id)
const missingBalls = ballIds.filter(id => !existsSync(join(ballDir, `${id}.png`)))
const balls = ballIds.length - missingBalls.length
const hasKey = existsSync(signingKeyPath())

if (publish) preflight()
/** Everything --publish needs, checked before a minute of building: all problems at once, then stop */
function preflight() {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const problems = []
  try {
    const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim()
    if (login !== 'DueStar') problems.push(`gh is logged in as ${login} (gh auth switch -u DueStar)`)
  } catch { problems.push('gh is not logged in') }
  if (git('status', '--porcelain', '--untracked-files=no')) problems.push('uncommitted changes (the build would ship code that is not on GitHub)')
  const head = git('rev-parse', 'HEAD')
  let remote = ''
  try { remote = (git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0] || '') } catch {}
  if (remote !== head) problems.push(`origin/main is ${remote.slice(0, 7) || '?'} but HEAD is ${head.slice(0, 7)}: push first (the release tag goes on GitHub's main)`)
  try { if (git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`)) problems.push(`tag v${version} already exists: bump the version`) } catch {}
  if (!changelogNotes(version)) problems.push(`CHANGELOG.md has no "### ${version}" section (the app shows it as patch notes)`)
  if (missingBalls.length) problems.push(`Poké Ball art missing: ${missingBalls.join(', ')} (node tools/import-balls.mjs <folder>)`)
  if (!hasKey) problems.push(`no signing key at ${signingKeyPath()} (copy it from the PC that has it; make a new one only with scripts/signing-key.mjs, which breaks in-app updates for installed apps)`)
  if (problems.length) {
    console.error(`\nNot publishing ${version}:\n${problems.map(p => `  - ${p}`).join('\n')}\n`)
    process.exit(1)
  }
  console.log('Preflight: all checks passed')
}

if (missingBalls.length === 0) console.log(`Poké Ball art: all ${balls} bundled`)
else if (balls) console.warn(`Poké Ball art: ${balls} bundled, missing ${missingBalls.join(', ')}`)
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
}
// The app, window and tray icons are committed as they ship: the Dream World Poké Ball (NOTICE.md)
run('npx', ['vite', 'build'])
checkDist(join(root, 'dist')) // every page loads its own CSS (scripts/dist-check.mjs)
run('npx', ['electron-builder', '--win', 'dir', '--x64'])

// Nothing of Nintendo's may ride along
const appDir = join(unpacked, 'resources', 'app')
for (const banned of [join(appDir, 'dist', 'sprites', 'pokemon'), join(appDir, 'public', 'sprites', 'pokemon')]) {
  if (existsSync(banned) && readdirSync(banned).length) throw new Error(`Pokémon artwork in the build: ${banned}`)
}

// When this build was made: the app reads it to tell a newer local build of the same version
const builtAt = new Date().toISOString()
writeFileSync(join(appDir, 'build-info.json'), JSON.stringify({ version, date: builtAt }))

const appZip = `claudex-app-${version}.zip` // see the note at the top: old clients need this name
const fullZip = `spawn-${version}-win-x64.zip`
for (const f of [appZip, fullZip]) rmSync(join(out, f), { force: true })
// bsdtar (Windows 10+) writes zip when the name ends in .zip and -a is given
run(TAR, ['-a', '-c', '-f', join(out, appZip), '-C', appDir, '.'], { shell: false })
run(TAR, ['-a', '-c', '-f', join(out, fullZip), '-C', out, 'win-unpacked'], { shell: false })

const sha = createHash('sha256').update(readFileSync(join(out, appZip))).digest('hex')
const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
const unsigned = {
  version,
  electron: electronVersion,
  notes,
  notesEn,
  notesJa,
  date: builtAt,
  app: { file: appZip, sha256: sha, size: statSync(join(out, appZip)).size },
  full: { file: fullZip, size: statSync(join(out, fullZip)).size },
}
// Signed when the key is on this PC (always, for --publish: preflight). An
// unsigned build still serves the local update channel.
const manifest = hasKey ? signManifest(unsigned) : unsigned
if (!hasKey) console.warn('latest.json is NOT signed (no signing key): installed apps would refuse it from GitHub')
writeFileSync(join(out, 'latest.json'), JSON.stringify(manifest, null, 2))
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
console.log(`\napp update ${appZip} ${mb(manifest.app.size)} · full ${fullZip} ${mb(manifest.full.size)} · electron ${electronVersion}`)

if (publish) {
  // DueStar's login was checked in preflight (the gh CLI's active login, never its token)
  run('gh', ['release', 'create', `v${version}`, '--repo', 'DueStar/spawn', '--title', `spawn ${version}`, '--notes', notes || `spawn ${version}`,
    join(out, 'latest.json'), join(out, appZip), join(out, fullZip)], { shell: false })
} else {
  console.log('Not published. Add --publish to create the GitHub release.')
}
