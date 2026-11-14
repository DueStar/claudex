/**
 * manifest.mjs — the update manifest of one platform, as scripts/release.mjs
 * writes it into release/: latest.json for Windows (the name every installed
 * Windows app reads), latest-mac-<arch>.json for a Mac. electron/updater.cjs
 * names them (manifestName) and reads them.
 *
 * The keys always go in the same order, whatever order they are given in:
 * latest.json is written byte for byte as it was before Macs had their own.
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { manifestName, appFilePattern } = createRequire(import.meta.url)('../electron/updater.cjs')

/**
 * True when `file` is an app zip this platform and arch may be sent. Windows'
 * own rule (kept as installed apps have it) would take a Mac zip too, so
 * latest.json is kept from naming one here.
 */
function zipFits(file, platform, arch) {
  const mac = appFilePattern('darwin').exec(file)
  if (platform === 'darwin') return !!mac && mac[1] === arch
  return appFilePattern(platform).test(file) && !mac
}

/**
 * Write the manifest for `platform` and `arch` into `dir`, signed by `sign`
 * (scripts/signing.mjs's signManifest) when one is given. Returns the file
 * and what went into it.
 */
export function writeManifest(platform, arch, fields, { dir, sign = null } = {}) {
  const { version, electron, notes, notesEn, notesJa, date, app, full, ...rest } = fields
  const unsigned = { version, electron, notes, notesEn, notesJa, date, app, full, ...rest }
  const name = manifestName(platform, arch)
  if (!zipFits(String(app?.file ?? ''), platform, arch)) throw new Error(`${name} cannot name ${app?.file}: not a ${platform} ${arch} app zip`)
  const manifest = sign ? sign(unsigned) : unsigned
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify(manifest, null, 2))
  return { file, manifest }
}
