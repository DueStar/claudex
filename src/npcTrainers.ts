/**
 * npcTrainers.ts — the board's NPC trainers: 108 rivals, like the trainers a
 * Pokémon game puts on the road, so a new board is not empty and there is
 * always someone just ahead to catch up with. They are drawn here, never
 * stored in the database, and every one is marked NPC on the board: they are
 * not presented as people.
 *
 * They play too: each has a pace (keen, steady, now and then, gone quiet), so
 * their numbers grow hour by hour, slower as their Pokédex fills; the week's
 * catches start over every Monday (KST) with that week's own mood. Seeded,
 * so every PC sees the same trainers with the same numbers at the same hour.
 *
 * As real trainers join, NPCs step aside: one for every three people
 * (npcsFor), none left once 324 real trainers are on a board.
 */

import type { BoardKind } from './desktop'

export interface NpcTrainer {
  nickname: string
  partner: number
  /** Where it stood on 2026-11-09 */
  caught0: number; shiny0: number; legends0: number
  /** New species a day while fresh (slows as the Pokédex fills) */
  pace: number
  /** Share of new species that are legendary or mythical, and of catches that are shiny */
  legendRate: number; shinyRate: number
  /** Which NPCs step aside first as people join (low goes first) */
  stay: number
}

export interface NpcNow { nickname: string; partner: number; caught: number; week: number; shiny: number; legends: number }

/** A small seeded generator (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KO_A = ['새벽', '야근', '퇴근', '출근', '주말', '커피', '라면', '졸린', '배고픈', '느긋한', '성실한', '용감한', '조용한', '밤샘', '월요', '금요', '초보', '고인물', '코딩', '버그']
const KO_B = ['코더', '트레이너', '개발자', '디자이너', '곰', '고양이', '여우', '펭귄', '마스터', '수집가', '탐험가', '장인', '박사', '요정', '용사', '꼬마', '선배', '후배', '연구원', '여행자']
const JA_A = ['ねむい', 'よふかし', 'コーヒー', 'しずかな', 'げんきな', 'ゆるい', 'まじめな', '週末', '新人', 'ベテラン']
const JA_B = ['エンジニア', 'トレーナー', 'デザイナー', 'ネコ', 'キツネ', '職人', '博士', '旅人', 'マスター', 'コレクター']
const EN_A = ['night', 'coffee', 'lazy', 'brave', 'quiet', 'pixel', 'bug', 'merge', 'sleepy', 'rapid', 'cozy', 'lofi']
const EN_B = ['owl', 'coder', 'trainer', 'dev', 'fox', 'cat', 'smith', 'ranger', 'hunter', 'pilot', 'maker', 'kid']
/** Starters and favourites lean in as partners, like real trainers' picks */
const FAVOURITES = [1, 4, 7, 25, 133, 150, 151, 155, 158, 249, 250, 258, 282, 384, 393, 448, 445, 570, 658, 700, 778, 887, 906, 909, 912, 937, 1000]

export const NPC_COUNT = 108
/** One NPC steps aside for every this many real trainers */
export const PEOPLE_PER_NPC = 3
/** 2026-11-09 00:00 KST: where their numbers start */
const EPOCH = Date.UTC(2026, 10, 8, 15)
const DAY = 86_400_000
const HOUR = 3_600_000
/** The Pokédex's size, and how far an NPC ever gets */
const DEX_MAX = 1025
const NPC_CEILING = 900

function makeNpcs(): NpcTrainer[] {
  const r = rng(20261109)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const taken = new Set<string>()
  const out: NpcTrainer[] = []
  while (out.length < NPC_COUNT) {
    const roll = r()
    let nickname: string
    if (roll < 0.7) nickname = pick(KO_A) + pick(KO_B)
    else if (roll < 0.85) nickname = pick(JA_A) + pick(JA_B)
    else nickname = `${pick(EN_A)}_${pick(EN_B)}`
    if (r() < 0.3) nickname += String(Math.floor(r() * 99) + 1)
    nickname = nickname.slice(0, 12)
    if (taken.has(nickname)) continue
    taken.add(nickname)
    // Pokédex today: a bell around 90, a tail up to 180
    const bell = (r() + r() + r()) / 3
    const caught0 = Math.max(8, Math.min(180, Math.round(bell * 160 + 10 + (r() < 0.1 ? r() * 60 : 0))))
    const legends0 = Math.floor((caught0 / 180) * 8 * r())
    const shiny0 = r() < Math.min(0.6, caught0 / 260) ? 1 + Math.floor(r() * 2) : 0
    // keen 15%, steady 45%, now and then 30%, gone quiet 10%
    const mood = r()
    const pace = mood < 0.15 ? 4 + r() * 4 : mood < 0.6 ? 1.5 + r() * 2 : mood < 0.9 ? 0.3 + r() * 0.9 : r() * 0.08
    const partner = r() < 0.4 ? pick(FAVOURITES) : 1 + Math.floor(r() * DEX_MAX)
    out.push({ nickname, partner, caught0, shiny0, legends0, pace, legendRate: 0.004 + r() * 0.01, shinyRate: 0.001 + r() * 0.002, stay: r() })
  }
  return out
}

export const NPC_TRAINERS: readonly NpcTrainer[] = makeNpcs()

/** Species gained after `days`: the pace, slowing as the Pokédex fills */
function gained(n: NpcTrainer, days: number): number {
  if (days <= 0) return 0
  const room = NPC_CEILING - n.caught0
  return Math.floor(room * (1 - Math.exp(-(n.pace * days) / room)))
}

/** An NPC's numbers at `now` (they move by the hour) */
export function npcAt(n: NpcTrainer, now: number, index: number): NpcNow {
  const hours = Math.floor((now - EPOCH) / HOUR)
  const days = Math.max(0, hours) / 24
  const gain = gained(n, days)
  const caught = Math.min(DEX_MAX, n.caught0 + gain)
  // This week (from Monday 00:00 KST): its own mood, catches spread over the days so far
  const kst = new Date(now + 9 * HOUR)
  const sinceMonday = ((kst.getUTCDay() + 6) % 7) + kst.getUTCHours() / 24
  const weekNo = Math.floor((now + 9 * HOUR - Date.UTC(2026, 10, 9)) / (7 * DAY))
  const wr = rng(Math.imul(weekNo + 1000, 2654435761) ^ index)
  const busy = wr() < 0.15 ? 0 : 0.4 + wr() * 1.2 // some weeks off
  // A catch a species: duplicates count too, about two catches for each new species
  const week = Math.floor(busy * n.pace * 2.2 * sinceMonday)
  const legends = n.legends0 + Math.floor(gain * n.legendRate)
  const shiny = n.shiny0 + Math.floor(gain * 2.2 * n.shinyRate)
  return { nickname: n.nickname, partner: n.partner, caught, week, shiny, legends }
}

/** The NPCs on the board for `people` real trainers: one steps aside for every three */
export function npcsFor(people: number, now = Date.now()): NpcNow[] {
  const keep = Math.max(0, NPC_COUNT - Math.floor(people / PEOPLE_PER_NPC))
  return NPC_TRAINERS
    .map((n, i) => ({ n, i }))
    .sort((a, b) => b.n.stay - a.n.stay)
    .slice(0, keep)
    .map(({ n, i }) => npcAt(n, now, i))
}

/** An NPC's number on one board */
export function npcValue(n: NpcNow, board: BoardKind): number {
  return board === 'caught' ? n.caught : board === 'week' ? n.week : board === 'shiny' ? n.shiny : n.legends
}
