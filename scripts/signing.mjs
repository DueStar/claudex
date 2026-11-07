/**
 * signing.mjs — the latest.json signature, shared by scripts/release.mjs and
 * the tests. electron/updater.cjs verifies it with the same rule.
 *
 * The signature covers JSON.stringify of the manifest without its `signature`
 * field. JSON.parse keeps key order and every value in the manifest is a
 * string or an integer, so the app re-serialises the very same bytes.
 */

import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const signingKeyPath = () => process.env.CLAUDEX_SIGNING_KEY || join(homedir(), '.claudex-release', 'signing-key.pem')

/** The manifest with a base64 Ed25519 `signature` added */
export function signManifest(manifest, pem = readFileSync(signingKeyPath(), 'utf8')) {
  const { signature: _drop, ...body } = manifest
  const sig = sign(null, Buffer.from(JSON.stringify(body), 'utf8'), createPrivateKey(pem))
  return { ...body, signature: sig.toString('base64') }
}
