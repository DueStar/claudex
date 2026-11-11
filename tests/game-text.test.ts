/**
 * src/gameText.ts — saved place names and catch sources in each language:
 * the codes the server saves now, and the Korean words of older saves.
 */

import { describe, expect, it } from 'vitest'
import { placeIn, placeParts, sourceLabelIn } from '../src/gameText'
// @ts-expect-error plain ESM without types
import { placeCode, catchSource } from '../server/pokedex.js'

describe('place names', () => {
  it('reads the codes the server saves', () => {
    const cave = placeCode.wild('spawn', { code: 'cave' }, 12, true)
    expect(cave).toBe('@wild|spawn|cave||1')
    expect(placeIn(cave, 'ko')).toBe('spawn 동굴 (밤)')
    expect(placeIn(cave, 'en')).toBe('spawn Cave (night)')
    expect(placeIn(cave, 'ja')).toBe('spawn どうくつ（夜）')
    const route = placeCode.wild('', { code: 'route' }, 17, false)
    expect(placeIn(route, 'ko')).toBe('이름 없는 마을 17번도로')
    expect(placeIn(route, 'en')).toBe('Nameless Town Route 17')
    expect(placeIn(route, 'ja')).toBe('名もなき町 17番道路')
    expect(placeIn(placeCode.attendance('web'), 'en')).toBe('web (daily encounter)')
    expect(placeIn(placeCode.evolve(''), 'ja')).toBe('どこか（進化）')
    expect(placeIn(placeCode.start(), 'en')).toBe('Journey’s start')
    // a project name with | in it cannot break the code apart
    expect(placeParts(placeCode.attendance('a|b'))).toEqual({ kind: 'attendance', project: 'a/b' })
  })

  it('reads the Korean names older saves hold, and shows them as they were in Korean', () => {
    for (const old of ['spawn 동굴 (밤)', 'system32 17번도로', '이름 없는 마을 하늘길', 'web (오늘의 출석)', '어딘가 (진화)', '여행의 시작']) {
      expect(placeIn(old, 'ko')).toBe(old)
    }
    expect(placeIn('system32 17번도로 (밤)', 'en')).toBe('system32 Route 17 (night)')
    expect(placeIn('이름 없는 마을 사파리존', 'ja')).toBe('名もなき町 サファリゾーン')
    expect(placeIn('spawn (오늘의 출석)', 'en')).toBe('spawn (daily encounter)')
    expect(placeIn('something else', 'en')).toBe('something else')
  })
})

describe('catch sources', () => {
  it('keeps tool calls and translates the game words, old Korean ones included', () => {
    expect(sourceLabelIn('Bash(npm test)', 'ja')).toBe('Bash(npm test)')
    expect(sourceLabelIn(catchSource({ tool: '' }, {}).label, 'ko')).toBe('세션 시작')
    expect(sourceLabelIn('#thinking', 'en')).toBe('thinking')
    expect(sourceLabelIn('생각하는 중', 'ja')).toBe('考え中')
    expect(sourceLabelIn('frontend-design 스킬', 'en')).toBe('Skill(/frontend-design)')
    expect(sourceLabelIn('Grep 검색', 'en')).toBe('Grep')
    expect(sourceLabelIn('Bash(명령)', 'en')).toBe('Bash')
    expect(sourceLabelIn('frontend-design 스킬', 'ko')).toBe('frontend-design 스킬')
  })
})
