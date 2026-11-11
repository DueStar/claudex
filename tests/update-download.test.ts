/**
 * Release downloads: github.com's plain download first, the API when it fails
 * (it answered 504 for every repository on 2026-11-08 while the API worked).
 */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { releaseFile } = require('../electron/updater.cjs')

const api = 'https://api.github.com/repos/DueStar/spawn/releases'

describe('releaseFile', () => {
  it('uses the plain download when it works', async () => {
    const seen: string[] = []
    const out = await releaseFile('v1.2.3', 'a.zip', {}, async (url: string) => { seen.push(url); return Buffer.from('zip') })
    expect(out.toString()).toBe('zip')
    expect(seen).toEqual(['https://github.com/DueStar/spawn/releases/download/v1.2.3/a.zip'])
  })

  it('falls back to the API asset when the plain download fails', async () => {
    const seen: Array<[string, unknown]> = []
    const fetch = async (url: string, opts: { headers?: Record<string, string> }) => {
      seen.push([url, opts.headers?.Accept])
      if (url.startsWith('https://github.com/')) throw new Error('HTTP 504')
      if (url === `${api}/latest`) return Buffer.from(JSON.stringify({ assets: [{ name: 'x.zip', id: 1 }, { name: 'latest.json', id: 42 }] }))
      if (url === `${api}/assets/42`) return Buffer.from('{"version":"1"}')
      throw new Error(`unexpected ${url}`)
    }
    const out = await releaseFile('latest', 'latest.json', { maxBytes: 10 }, fetch)
    expect(out.toString()).toBe('{"version":"1"}')
    expect(seen.map(s => s[0])).toEqual(['https://github.com/DueStar/spawn/releases/latest/download/latest.json', `${api}/latest`, `${api}/assets/42`])
    expect(seen[2][1]).toBe('application/octet-stream')
  })

  it('keeps the first error when the release has no such file', async () => {
    const fetch = async (url: string) => {
      if (url.startsWith('https://github.com/')) throw new Error('HTTP 504')
      return Buffer.from(JSON.stringify({ assets: [] }))
    }
    await expect(releaseFile('v1.2.3', 'a.zip', {}, fetch)).rejects.toThrow('HTTP 504')
  })
})
