/**
 * gameText — the game's saved words in the language in use.
 *
 * The server saves place names and catch sources as codes (server/pokedex.js
 * placeCode, catchSource): @wild|<project>|<terrain>|<route>|<night>,
 * @attendance|<project>, @evolve|<project>, @start, and '#session-start' /
 * '#thinking'. Saves from before 1.3.20 hold the Korean words; those are read
 * back into the same parts, so they show in every language too. The saved
 * string itself is never rewritten (it is part of a Pokémon's identity in the
 * cloud merge).
 */

import type { Lang } from './desktop'

type Parts =
  | { kind: 'wild'; project: string; terrain: string; route: string; night: boolean }
  | { kind: 'attendance' | 'evolve'; project: string }
  | { kind: 'start' }
  | { kind: 'text'; text: string }

const TERRAINS: Record<string, [string, string, string]> = {
  grass: ['풀숲', 'Tall Grass', 'くさむら'], cave: ['동굴', 'Cave', 'どうくつ'], forest: ['숲', 'Forest', 'もり'],
  sky: ['하늘길', 'Sky Path', 'そらのみち'], safari: ['사파리존', 'Safari Zone', 'サファリゾーン'], plant: ['발전소', 'Power Plant', 'はつでんしょ'],
}
const TERRAIN_BY_KO = Object.fromEntries(Object.entries(TERRAINS).map(([code, [ko]]) => [ko, code]))
const NO_NAME_TOWN = '이름 없는 마을'
const SOMEWHERE = '어딘가'

/** A saved place name (a code or an old Korean one) taken apart */
export function placeParts(place: string): Parts {
  if (place.startsWith('@')) {
    const [kind, project = '', terrain = '', route = '', night = '0'] = place.slice(1).split('|')
    if (kind === 'wild') return { kind, project, terrain, route, night: night === '1' }
    if (kind === 'attendance' || kind === 'evolve') return { kind, project }
    if (kind === 'start') return { kind }
    return { kind: 'text', text: place }
  }
  // Korean, from before the codes
  if (place === '여행의 시작') return { kind: 'start' }
  let m = place.match(/^(.*) \(오늘의 출석\)$/)
  if (m) return { kind: 'attendance', project: m[1] === NO_NAME_TOWN ? '' : m[1] }
  m = place.match(/^(.*) \(진화\)$/)
  if (m) return { kind: 'evolve', project: m[1] === SOMEWHERE ? '' : m[1] }
  m = place.match(/^(.*) (?:(\d+)번도로|(풀숲|동굴|숲|하늘길|사파리존|발전소))( \(밤\))?$/)
  if (m) return { kind: 'wild', project: m[1] === NO_NAME_TOWN ? '' : m[1], terrain: m[2] ? 'route' : TERRAIN_BY_KO[m[3]], route: m[2] ?? '', night: !!m[4] }
  return { kind: 'text', text: place }
}

const I = { ko: 0, en: 1, ja: 2 } as const

/** A saved place name in `lang` */
export function placeIn(place: string | null | undefined, lang: Lang): string {
  if (!place) return ''
  const p = placeParts(place)
  const pick = (ko: string, en: string, ja: string) => [ko, en, ja][I[lang]]
  switch (p.kind) {
    case 'start': return pick('여행의 시작', 'Journey’s start', '旅立ち')
    case 'attendance': return pick(`${p.project || NO_NAME_TOWN} (오늘의 출석)`, `${p.project || 'Nameless Town'} (daily encounter)`, `${p.project || '名もなき町'}（今日の出会い）`)
    case 'evolve': return pick(`${p.project || SOMEWHERE} (진화)`, `${p.project || 'Somewhere'} (evolved)`, `${p.project || 'どこか'}（進化）`)
    case 'wild': {
      const town = p.project || pick(NO_NAME_TOWN, 'Nameless Town', '名もなき町')
      const where = p.terrain === 'route' ? pick(`${p.route}번도로`, `Route ${p.route}`, `${p.route}番道路`) : TERRAINS[p.terrain]?.[I[lang]] ?? p.terrain
      return `${town} ${where}${p.night ? pick(' (밤)', ' (night)', '（夜）') : ''}`
    }
    default: return p.text
  }
}

// ---- catch sources: a tool call stays as it is; the game's own words are translated ----

const SOURCE_WORDS: Record<string, [string, string, string]> = {
  'session-start': ['세션 시작', 'session start', 'セッション開始'],
  thinking: ['생각하는 중', 'thinking', '考え中'],
  skill: ['스킬', 'skill', 'スキル'],
  subagent: ['서브에이전트', 'subagent', 'サブエージェント'],
}
const SOURCE_BY_KO = Object.fromEntries(Object.entries(SOURCE_WORDS).map(([code, [ko]]) => [ko, code]))

/** A saved catch-source label in `lang` */
export function sourceLabelIn(label: string, lang: Lang): string {
  if (label.startsWith('#')) return SOURCE_WORDS[label.slice(1)]?.[I[lang]] ?? label.slice(1)
  if (lang === 'ko') return label
  // Korean labels from before the codes
  if (SOURCE_BY_KO[label]) return SOURCE_WORDS[SOURCE_BY_KO[label]][I[lang]]
  let m = label.match(/^(.+) 스킬$/)
  if (m) return `Skill(/${m[1]})`
  m = label.match(/^(\w+) 검색$/)
  if (m) return m[1]
  return label.replace(/\((명령|파일)\)$/, '')
}
