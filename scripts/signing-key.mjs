/**
 * signing-key.mjs — make the Ed25519 key that signs latest.json.
 *
 *   node scripts/signing-key.mjs
 *
 * Writes the private key to ~/.claudex-release/signing-key.pem (or the path in
 * CLAUDEX_SIGNING_KEY) and prints the public key for electron/update-key.cjs.
 * Refuses to overwrite an existing key: every installed Claudex trusts the
 * public key it shipped with, so a new key means in-app updates stop working
 * for everyone until they reinstall from the full zip. Back the key up.
 */

import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { signingKeyPath } from './signing.mjs'

const file = signingKeyPath()
if (existsSync(file)) {
  console.error(`A signing key already exists: ${file}\nRemove it by hand only if you mean to replace the key every installed app trusts.`)
  process.exit(1)
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
console.log(`Private key: ${file}  (back it up; never commit it)`)
console.log('Public key for electron/update-key.cjs:\n')
console.log(publicKey.export({ type: 'spki', format: 'pem' }))
