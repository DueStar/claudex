/**
 * latest.json signing: scripts/signing.mjs signs, electron/updater.cjs verifies.
 * The two must agree byte for byte, and any change to the manifest (the
 * version, the zip's sha256) must break the signature.
 */

import { generateKeyPairSync } from 'node:crypto'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without types
import { signManifest } from '../scripts/signing.mjs'

const require = createRequire(import.meta.url)
const { verifyManifest } = require('../electron/updater.cjs')
const shippedKey: string = require('../electron/update-key.cjs')

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const manifest = {
  version: '9.9.9',
  electron: '33.4.11',
  notes: '- 한글 노트도 그대로',
  date: '2026-11-07T00:00:00.000Z',
  app: { file: 'claudex-app-9.9.9.zip', sha256: 'ab'.repeat(32), size: 123 },
  full: { file: 'Claudex-9.9.9-win-x64.zip', size: 456 },
}

describe('latest.json signature', () => {
  it('verifies after a round trip through JSON, as the app reads it', () => {
    const signed = signManifest(manifest, pem)
    expect(typeof signed.signature).toBe('string')
    const fromDisk = JSON.parse(JSON.stringify(signed, null, 2))
    expect(verifyManifest(fromDisk, pub)).toBe(true)
  })

  it('fails when anything in it changes', () => {
    const signed = signManifest(manifest, pem)
    expect(verifyManifest({ ...signed, version: '9.9.10' }, pub)).toBe(false)
    expect(verifyManifest({ ...signed, app: { ...signed.app, sha256: 'cd'.repeat(32) } }, pub)).toBe(false)
  })

  it('fails without a signature, or with another key', () => {
    expect(verifyManifest(manifest, pub)).toBe(false)
    const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(verifyManifest(signManifest(manifest, other), pub)).toBe(false)
  })

  it('re-signing replaces the old signature instead of signing it', () => {
    const twice = signManifest(signManifest(manifest, pem), pem)
    expect(verifyManifest(twice, pub)).toBe(true)
  })

  it('ships a real Ed25519 public key', () => {
    expect(shippedKey).toMatch(/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=]+\n-----END PUBLIC KEY-----\n$/)
    expect(verifyManifest(signManifest(manifest, pem), shippedKey)).toBe(false)
  })
})
