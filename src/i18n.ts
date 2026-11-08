/**
 * i18n — Korean, English and Japanese.
 *
 * The Korean text is the key (gettext style): `t('새 세션')` is '새 세션' in
 * Korean, 'New session' in English, '新しいセッション' in Japanese. Values go in
 * with {name} placeholders: t('{name}에게 지시하기', { name }). A phrase with no
 * translation shows in English, then Korean, so nothing is ever blank.
 *
 * The language is the 설정 › 앱 › 언어 value; 'auto' follows the system
 * (navigator.language). Pages re-render on a change because they read the
 * settings (useSettings) at the top.
 *
 * Pokémon, nature, ball and type names are the official ones (tools/fetch-i18n.mjs).
 */

import type { Lang } from './desktop'
import { getSettings, useSettings } from './settingsStore'
import DICTS from './locales'

export type { Lang }

/** The language in use: the setting, or the system's when it is 'auto' */
export function resolveLang(setting: string | undefined, system = typeof navigator !== 'undefined' ? navigator.language : 'en'): Lang {
  if (setting === 'ko' || setting === 'en' || setting === 'ja') return setting
  const s = (system || '').toLowerCase()
  return s.startsWith('ko') ? 'ko' : s.startsWith('ja') ? 'ja' : 'en'
}

export const lang = (): Lang => resolveLang(getSettings().app.language)
/** The language, re-rendering the component when it changes */
export function useLang(): Lang { return resolveLang(useSettings().app.language) }

const fill = (text: string, vars?: Record<string, string | number>) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text

/** `ko` in the language in use */
export function t(ko: string, vars?: Record<string, string | number>): string {
  const l = lang()
  if (l === 'ko') return fill(ko, vars)
  return fill(DICTS[l][ko] ?? DICTS.en[ko] ?? ko, vars)
}

/** For dates and numbers: ko-KR, en-US or ja-JP */
export const locale = (): string => ({ ko: 'ko-KR', en: 'en-US', ja: 'ja-JP' } as const)[lang()]

/** An official name from an entry that has ko / en / ja */
export function nameOf(e: { ko: string; en?: string | null; ja?: string | null } | null | undefined): string {
  if (!e) return ''
  const l = lang()
  return (l === 'ko' ? e.ko : l === 'ja' ? (e.ja || e.en) : e.en) || e.ko
}

/** Korean particles that depend on the last syllable: 이/가, 을/를, 은/는, 와/과, (으)로 */
export function josa(word: string, pair: '이가' | '을를' | '은는' | '와과' | '으로'): string {
  const c = word.charCodeAt(word.length - 1)
  const hangul = c >= 0xac00 && c <= 0xd7a3
  const final = hangul ? (c - 0xac00) % 28 : 0
  if (pair === '으로') return hangul && final !== 0 && final !== 8 ? '으로' : '로' // ㄹ takes 로
  const [withFinal, without] = { 이가: ['이', '가'], 을를: ['을', '를'], 은는: ['은', '는'], 와과: ['과', '와'] }[pair]
  return hangul && final !== 0 ? withFinal : without
}

// ---- game words used everywhere: official where the games have them ----

const TYPES: Record<string, [string, string, string]> = {
  normal: ['노말', 'Normal', 'ノーマル'], fire: ['불꽃', 'Fire', 'ほのお'], water: ['물', 'Water', 'みず'],
  grass: ['풀', 'Grass', 'くさ'], electric: ['전기', 'Electric', 'でんき'], ice: ['얼음', 'Ice', 'こおり'],
  fighting: ['격투', 'Fighting', 'かくとう'], poison: ['독', 'Poison', 'どく'], ground: ['땅', 'Ground', 'じめん'],
  flying: ['비행', 'Flying', 'ひこう'], psychic: ['에스퍼', 'Psychic', 'エスパー'], bug: ['벌레', 'Bug', 'むし'],
  rock: ['바위', 'Rock', 'いわ'], ghost: ['고스트', 'Ghost', 'ゴースト'], dragon: ['드래곤', 'Dragon', 'ドラゴン'],
  dark: ['악', 'Dark', 'あく'], steel: ['강철', 'Steel', 'はがね'], fairy: ['페어리', 'Fairy', 'フェアリー'],
}
const TIERS: Record<string, [string, string, string]> = {
  common: ['일반', 'Common', 'ふつう'], rare: ['희귀', 'Rare', 'レア'], sub: ['준전설', 'Sub-legendary', '準伝説'],
  legendary: ['전설', 'Legendary', '伝説'], mythical: ['환상', 'Mythical', '幻'],
}
// natures.json keeps the raised / lowered stat in Korean
const STATS: Record<string, [string, string]> = {
  공격: ['Attack', 'こうげき'], 방어: ['Defense', 'ぼうぎょ'], 특수공격: ['Sp. Atk', 'とくこう'],
  특수방어: ['Sp. Def', 'とくぼう'], 스피드: ['Speed', 'すばやさ'],
}
const BALL_TIERS: Record<string, [string, string]> = {
  basic: ['Common ball', 'ふつうのボール'], special: ['Special ball', 'とくしゅなボール'], apricorn: ['Apricorn ball', 'ぼんぐりボール'],
  limited: ['Limited ball', 'げんていボール'], master: ['Master Ball', 'マスターボール'], event: ['Event ball', 'イベントボール'],
}

const pickOf = (row: [string, string, string] | undefined, fallback: string) => (row ? row[{ ko: 0, en: 1, ja: 2 }[lang()]] : fallback)
export const typeName = (type: string) => pickOf(TYPES[type], type)
export const tierName = (tier: string) => pickOf(TIERS[tier], tier)
export function statName(ko: string): string {
  const l = lang()
  if (l === 'ko') return ko
  return STATS[ko.replace(/\s/g, '')]?.[l === 'en' ? 0 : 1] ?? ko
}
export function ballTierName(tier: string, ko: string): string {
  const l = lang()
  return l === 'ko' ? ko : BALL_TIERS[tier]?.[l === 'en' ? 0 : 1] ?? ko
}
