/**
 * The patch notes shown once after an update: the Claudex part of
 * CHANGELOG.md, only the versions newer than the one this PC last ran.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions, notesToShow, parseChangelog } from '../src/patchNotes'

const MD = `# Changelog

## Claudex

### 1.3.6
- 보내기 버튼이 **꽉 차요**.
- 파티가 \`SV\` 아이콘으로
  나와요.

### 1.3.5
- 업데이트를 30분마다 확인해요.

### 1.3.4
- 띵동 소리가 사라졌어요.

## Claude Office (원작)
### 1.1.1
- office
`

describe('patch notes', () => {
  it('reads the Claudex releases only, marks and line breaks off', () => {
    const r = parseChangelog(MD)
    expect(r.map(x => x.version)).toEqual(['1.3.6', '1.3.5', '1.3.4'])
    expect(r[0].notes).toEqual(['보내기 버튼이 꽉 차요.', '파티가 SV 아이콘으로 나와요.'])
  })

  it('compares versions by number', () => {
    expect(compareVersions('1.3.10', '1.3.9')).toBeGreaterThan(0)
    expect(compareVersions('1.3.5', '1.3.5')).toBe(0)
    expect(compareVersions('1.2.9', '1.3.0')).toBeLessThan(0)
  })

  it('shows what is newer than the version seen, up to this one; once seen, nothing', () => {
    const r = parseChangelog(MD)
    expect(notesToShow(r, '1.3.6', '1.3.4').map(x => x.version)).toEqual(['1.3.6', '1.3.5'])
    expect(notesToShow(r, '1.3.5', '1.3.4').map(x => x.version)).toEqual(['1.3.5'])
    expect(notesToShow(r, '1.3.6', '1.3.6')).toEqual([])
    // Nothing seen yet (a fresh install, or before this screen existed): this version only
    expect(notesToShow(r, '1.3.6', null).map(x => x.version)).toEqual(['1.3.6'])
  })

  it('the real CHANGELOG has an entry for the version in package.json', () => {
    const root = join(__dirname, '..')
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
    const r = parseChangelog(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'))
    expect(r.find(x => x.version === version)?.notes.length).toBeGreaterThan(0)
  })
})
