/**
 * fixture.mjs — the made-up state the screenshot harness (shots.mjs) shows:
 * the same four sessions, usage and game as the design lab
 * (spawn-site-lab/calm-lab/app.js, views.js), so a sheet compares like with like.
 *
 *   snapshot / terminals       four Claude Code sessions + one shell
 *   snapshot12 / terminals12   twelve sessions (two with very long names) + the shell
 *   branches                   each session folder's git branch (terminals.branches)
 *   board                      랭킹: twelve rows, the viewer 7th
 *   NOW                        the moment every page is pinned to (page.clock)
 *   VIEWED                     the caught species already opened (all but one: the NEW dot)
 *
 * `snapshot` is the server's first WebSocket message (SnapshotMessage in
 * src/hooks/useAgentSocket.ts); `pokedex` in it is a DexState (src/pokedexStore.ts),
 * `terminals` are TerminalInfo[] (src/desktop.ts). Pure data: no clock, no randomness.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SPECIES = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/pokemon/pokedex.json', import.meta.url)), 'utf8'))
const TIER = new Map(SPECIES.map(p => [p.id, p.tier ?? 'common']))
const tierOf = id => TIER.get(id) ?? 'common'

/** 2026-11-14 14:30 in Seoul (the harness runs the page in Asia/Seoul) */
export const NOW = Date.parse('2026-11-14T14:30:00+09:00')
const at = (hhmm, day = 0) => Date.parse(`2026-11-${14 + day}T${hhmm}:00+09:00`)
const sec = ms => Math.floor(ms / 1000)

const sid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SHELL_SID = 'shell-0000-4000-8000-000000000099'

// ---------------------------------------------------------------- sessions

/**
 * One session: its Pokémon (dex id, level), project, folder, branch, mood, context used %,
 * model. `mood` is the server's main.state ('needs-you' carries a permission request).
 */
const BASE = [
  { n: 1, title: '로그인 리다이렉트 고치기', dex: 27, lv: 17, project: 'shop-web', cwd: 'C:\\Users\\me\\code\\shop-web', branch: 'fix/login-redirect', mood: 'needs-you', used: 38, model: 'Opus 5.5', modelId: 'claude-opus-5-5' },
  { n: 2, title: 'README 영어 번역', dex: 120, lv: 12, project: 'docs', cwd: 'C:\\Users\\me\\code\\docs', branch: 'main', mood: 'working', used: 12, model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5' },
  { n: 3, title: '결제 테스트 보강', dex: 270, lv: 8, project: 'shop-web', cwd: 'C:\\Users\\me\\code\\worktrees\\shop-web', branch: 'test/checkout', mood: 'working', used: 66, model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5' },
  { n: 4, title: '타입 정리', dex: 74, lv: 21, project: 'shop-api', cwd: 'C:\\Users\\me\\code\\shop-api', branch: 'main', mood: 'idle', used: 0, model: 'Opus 5.5', modelId: 'claude-opus-5-5' },
]

/** Eight more for the twelve-session set; two names that cannot fit a row */
const MORE = [
  { n: 5, title: '아주아주 긴 한국어 세션 이름이 한 줄을 넘어가면 어떻게 되는지 보는 세션', dex: 722, lv: 9, project: 'shop-web', cwd: 'C:\\Users\\me\\code\\shop-web-2', branch: 'feat/very-long-branch-name-for-layout', mood: 'working', used: 51, model: 'Opus 5.5', modelId: 'claude-opus-5-5' },
  { n: 6, title: 'refactor/extremely-long-english-session-name-without-spaces-0123456789', dex: 54, lv: 14, project: 'shop-api', cwd: 'C:\\Users\\me\\code\\shop-api-2', branch: 'refactor/names', mood: 'idle', used: 83, model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5' },
  { n: 7, title: '배포 스크립트 점검', dex: 129, lv: 6, project: 'infra', cwd: 'C:\\Users\\me\\code\\infra', branch: 'main', mood: 'working', used: 22, model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5' },
  { n: 8, title: '이미지 최적화', dex: 41, lv: 11, project: 'shop-web', cwd: 'C:\\Users\\me\\code\\shop-web-3', branch: 'perf/images', mood: 'error', used: 47, model: 'Opus 5.5', modelId: 'claude-opus-5-5' },
  { n: 9, title: null, dex: 43, lv: 5, project: 'notes', cwd: 'C:\\Users\\me\\code\\notes', branch: null, mood: 'idle', used: null, model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5' },
  { n: 10, title: '검색 API 페이지네이션', dex: 19, lv: 7, project: 'shop-api', cwd: 'C:\\Users\\me\\code\\shop-api-3', branch: 'feat/search-paging', mood: 'working', used: 91, model: 'Opus 5.5', modelId: 'claude-opus-5-5' },
  { n: 11, title: '접근성 점검', dex: 16, lv: 10, project: 'shop-web', cwd: 'C:\\Users\\me\\code\\shop-web-4', branch: 'a11y/audit', mood: 'idle', used: 30, model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5' },
  { n: 12, title: 'CI 캐시 정리', dex: 10, lv: 4, project: 'infra', cwd: 'C:\\Users\\me\\code\\infra-2', branch: 'ci/cache', mood: 'working', used: 8, model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5' },
]

const SHELL = { cwd: 'C:\\Users\\me\\code\\shop-web', project: 'shop-web' }

function terminalOf(s) {
  return {
    id: `t${s.n}`, sessionId: sid(s.n), cwd: s.cwd, project: s.project, status: 'running',
    createdAt: at('09:00') + s.n * 60_000, exitCode: null, title: s.title,
    asking: false, tool: 'claude', toolName: 'Claude Code', canResume: true,
  }
}
const shellTerminal = {
  id: 'tshell', sessionId: SHELL_SID, cwd: SHELL.cwd, project: SHELL.project, status: 'running',
  createdAt: at('09:30'), exitCode: null, title: null, asking: false, tool: 'shell', toolName: 'PowerShell', canResume: false,
}

function sessionOf(s) {
  const main = { state: s.mood, since: at('14:20') }
  if (s.mood === 'needs-you') main.needsYou = { kind: 'permission', toolName: 'Bash', summary: 'npm run build', since: at('14:26') }
  if (s.mood === 'error') main.error = { error: 'rate_limit', detail: 'API Error: 529 Overloaded', since: at('14:10') }
  return {
    id: sid(s.n), project: s.project, cwd: s.cwd, title: s.title ?? undefined, model: s.modelId, source: 'startup',
    state: 'active', startedAt: at('09:00') + s.n * 60_000, lastActivityAt: at('14:25'), hooked: true, main,
  }
}

const CONTEXT_SIZE = 200_000
function statusOf(s) {
  return {
    sessionId: sid(s.n), project: s.project, model: s.model, modelId: s.modelId,
    context: { used: s.used, size: s.used === null ? null : CONTEXT_SIZE, input: s.used === null ? 0 : Math.round(CONTEXT_SIZE * s.used / 100), output: 900 },
    updatedAt: at('14:25') - s.n * 1000,
  }
}

/** Usage: 5 hours at 46 % (resets 16:20), the week at 82 % (resets 11/17 17:00) */
const rateLimits = { fiveHour: 46, sevenDay: 82, fiveHourResetsAt: sec(at('16:20')), sevenDayResetsAt: sec(at('17:00', 3)), at: at('14:25') }

// ---------------------------------------------------------------- the game

const mon = (uid, dex, lv, extra = {}) => ({
  uid, dex, steps: lv * 40, evos: 0, shiny: false, how: 'wild', place: 'shop-web 숲', at: at('10:00', -3),
  gender: 'male', nature: 3, ball: 'poke-ball', metLevel: lv, workMs: 0, level: lv, ...extra,
})

/** The party: 모래두지, 별가사리, 연꽃몬, 꼬마돌 (out with sessions 1–4), 나몰빼미, 고라파덕 */
const PARTY = [[27, 17], [120, 12], [270, 8], [74, 21], [722, 9], [54, 14]]
const partyMons = PARTY.map(([dex, lv], i) => mon(`p${i + 1}`, dex, lv, i === 4 ? { how: 'starter', place: 'spawn' } : {}))

/** 40 in the box: a fixed list of early species, one shiny */
const BOX_DEX = [25, 1, 4, 7, 133, 37, 95, 18, 6, 12, 43, 41, 129, 19, 16, 10, 11, 13, 21, 23, 35, 39, 46, 48, 50, 52, 56, 58, 60, 63, 66, 69, 72, 77, 79, 81, 84, 86, 88, 92]
const boxMons = BOX_DEX.map((dex, i) => mon(`b${i + 1}`, dex, 5 + (i % 17), { shiny: dex === 133, at: at('10:00', -(i % 9)) }))

/**
 * 185 species caught of 1025: every party, box and log species, then a fixed
 * walk through the national dex (dense early, sparse late) until 185.
 */
function caughtIds() {
  const ids = new Set([...PARTY.map(p => p[0]), ...BOX_DEX, 8, 9, 2, 3, 5, 17, 20, 26])
  for (let id = 1; ids.size < 185 && id <= 1025; id += id < 160 ? 1 : id < 400 ? 3 : 11) {
    if (id < 160 && id % 7 === 3) continue // a few holes in Kanto, as in the lab
    ids.add(id)
  }
  return [...ids].sort((a, b) => a - b)
}
const CAUGHT_IDS = caughtIds()
/** Seen but not caught: 30 more */
const SEEN_ONLY = [], caughtSet = new Set(CAUGHT_IDS)
for (let id = 3; SEEN_ONLY.length < 30; id += 5) if (!caughtSet.has(id)) SEEN_ONLY.push(id)

const caught = {}
for (const id of CAUGHT_IDS) {
  caught[id] = {
    count: id === 25 || id === 16 ? 2 : 1, firstAt: at('12:18', -1 - (id % 20)), lastAt: at('12:18', -1 - (id % 20)),
    place: 'shop-web 숲', how: id === 722 ? 'starter' : 'wild', shiny: id === 133, ball: 'poke-ball', metLevel: 5 + (id % 20),
    via: { tool: 'Read', label: 'Read(todo.js)', prompt: 'README.md와 todo.js를 읽고 설치 방법 정리' },
  }
}
const seen = {}
for (const id of [...CAUGHT_IDS, ...SEEN_ONLY]) seen[id] = 1

/** The log, oldest first (the app reverses it): yesterday's two, then today's */
const via = (title, label) => ({ tool: label.split('(')[0], label, prompt: title })
const log = [
  { kind: 'flee', id: 10, name: '캐터피', tier: 'common', place: 'docs 숲', at: at('17:10', -1) },
  { kind: 'catch', id: 43, name: '뚜벅쵸', tier: 'common', place: 'shop-web 숲 (밤)', ball: 'poke-ball', level: 6, gender: 'female', nature: 7, at: at('18:44', -1) },
  { kind: 'catch', id: 10, name: '캐터피', tier: 'common', place: 'docs 숲', ball: 'poke-ball', level: 3, gender: 'male', nature: 2, at: at('18:50', -1) },
  { kind: 'catch', id: 16, name: '구구', tier: 'common', place: 'spawn (오늘의 출석)', ball: 'great-ball', level: 9, attendance: true, gender: 'male', nature: 5, via: via(null, '세션 시작'), at: at('09:02') },
  { kind: 'catch', id: 129, name: '잉어킹', tier: 'common', place: 'docs 물가', ball: 'great-ball', level: 11, gender: 'male', nature: 4, via: via('README 영어 번역', 'Edit(README.md)'), at: at('12:18') },
  { kind: 'evolve', id: 8, from: 7, name: '어니부기', fromName: '꼬부기', at: at('12:50') },
  { kind: 'catch', id: 41, name: '주뱃', tier: 'common', place: 'shop-api 동굴 (밤)', ball: 'poke-ball', level: 8, newSpecies: true, gender: 'female', nature: 9, via: via('타입 정리', 'Bash(npm run typecheck)'), at: at('13:21') },
  { kind: 'flee', id: 16, name: '구구', tier: 'common', place: 'shop-web 초원', at: at('13:40') },
  { kind: 'levelup', id: 270, name: '연꽃몬', level: 8, uid: 'p3', at: at('13:56') },
  { kind: 'levelup', id: 120, name: '별가사리', level: 12, uid: 'p2', at: at('13:57') },
  { kind: 'levelup', id: 27, name: '모래두지', level: 17, uid: 'p1', at: at('13:58') },
  { kind: 'catch', id: 19, name: '꼬렛', tier: 'common', place: 'shop-web 숲', ball: 'poke-ball', level: 4, newSpecies: true, gender: 'male', nature: 1, via: via('로그인 리다이렉트 고치기', 'Edit(middleware.ts)'), uid: 'b14', at: at('14:12') },
].map(e => ({ shiny: false, ...e, tier: e.tier ?? (e.kind === 'catch' || e.kind === 'flee' ? tierOf(e.id) : undefined) }))

/** The newest catch, never opened: the NEW dot on 도감 */
export const NEW_SPECIES = 19
export const VIEWED = CAUGHT_IDS.filter(id => id !== NEW_SPECIES)

function dexState(sessions) {
  const mons = {}
  for (const m of [...partyMons, ...boxMons]) mons[m.uid] = { ...m }
  const assign = {}
  // Sessions 1–6 take the party in order; past six a box Pokémon works the session as a helper
  const helperUids = boxMons.map(m => m.uid)
  sessions.forEach((s, i) => {
    if (i < 6) { assign[sid(s.n)] = partyMons.find(m => m.dex === s.dex)?.uid ?? partyMons[i].uid; return }
    const m = boxMons.find(b => b.dex === s.dex) ?? mons[helperUids[i]]
    assign[sid(s.n)] = m.uid
  })
  // Levels shown in the rows come from the Pokémon: make each match its session's
  for (const s of sessions) { const m = mons[assign[sid(s.n)]]; if (m) { m.metLevel = s.lv; m.level = s.lv } }
  return {
    caught, seen, trainer: { starter: 722, since: at('09:00', -40) }, mons,
    party: partyMons.map(m => m.uid), box: boxMons.map(m => m.uid),
    assign, remembered: { ...assign }, helpers: {},
    partySize: 6, sessionLimit: 12, boxLimit: 1200,
    encounters: 412, sinceLegend: 37, sinceMythical: 120, pity: 4, pityMythical: 9,
    total: 1025, log, today: log.filter(e => e.at >= at('00:00')),
  }
}

const cloud = { enabled: true, user: null, lastSyncAt: null, error: null }

function snapshotOf(sessions) {
  return {
    type: 'snapshot',
    sessions: sessions.map(sessionOf),
    statuses: { sessions: sessions.map(statusOf), rateLimits },
    pokedex: dexState(sessions),
    cloud,
  }
}

const TWELVE = [...BASE, ...MORE]

export const snapshot = snapshotOf(BASE)
export const terminals = [...BASE.map(terminalOf), shellTerminal]
export const snapshot12 = snapshotOf(TWELVE)
export const terminals12 = [...TWELVE.map(terminalOf), shellTerminal]

/** cwd -> branch, for terminals.branches() */
export const branches = Object.fromEntries([...TWELVE.map(s => [s.cwd, s.branch]), [SHELL.cwd, 'fix/login-redirect']])

/** 랭킹 (board.get): twelve trainers, the viewer 7th */
const RANK = [['지우', 25, 61], ['이슬', 120, 57], ['웅', 95, 52], ['그린', 133, 49], ['단풍', 37, 47], ['하늘', 18, 44], ['솔바람', 27, 41], ['레드', 6, 39], ['바람', 12, 36], ['민트', 43, 33], ['새벽', 41, 30], ['솔', 1, 28]]
export const board = RANK.map(([nickname, partner, value], i) => ({ place: i + 1, rn: i + 1, nickname, partner, value, me: i === 6 }))

/** 이어하기 (terminals.history): past sessions, newest first — one open in the app, one running elsewhere */
export const history = [
  { id: sid(1), cwd: BASE[0].cwd, project: 'shop-web', title: BASE[0].title, updatedAt: at('14:28'), sizeKb: 412, running: true },
  { id: sid(41), cwd: 'C:\\Users\\me\\code\\shop-api', project: 'shop-api', title: '주문 API 응답 시간 줄이기', updatedAt: at('13:40'), sizeKb: 230, running: true },
  { id: sid(42), cwd: 'C:\\Users\\me\\code\\docs', project: 'docs', title: '설치 문서 정리', updatedAt: at('11:05'), sizeKb: 96, running: false },
  { id: sid(43), cwd: 'C:\\Users\\me\\code\\shop-web', project: 'shop-web', title: '장바구니 수량 버그: 0개로 바꾸면 결제 버튼이 그대로 남는 문제', updatedAt: at('17:20', -1), sizeKb: 640, running: false },
  { id: sid(44), cwd: 'C:\\Users\\me\\code\\infra', project: 'infra', title: 'CI 캐시 키 정리', updatedAt: at('10:12', -3), sizeKb: 58, running: false },
]

/** What a Claude Code terminal replays (any terminal: the harness has no pty) */
const E = '\x1b['
export const transcript = [
  `${E}38;5;174m✻${E}0m Welcome to ${E}1mClaude Code${E}0m!`,
  '',
  `  ${E}2m/help for help, /status for your current setup${E}0m`,
  '',
  `  ${E}2mcwd: C:\\Users\\me\\code\\shop-web${E}0m`,
  '',
  `${E}1m>${E}0m 로그인하고 나면 원래 보던 페이지로 돌아가게 고쳐줘. 바깥 주소로는 못 가게.`,
  '',
  `${E}38;5;114m●${E}0m 로그인 뒤 이동 경로를 확인해 볼게요.`,
  '',
  `${E}38;5;114m●${E}0m ${E}1mRead${E}0m(src/middleware.ts)`,
  `  ${E}2m⎿  Read 48 lines${E}0m`,
  '',
  `${E}38;5;114m●${E}0m ${E}1mRead${E}0m(src/app/login/actions.ts)`,
  `  ${E}2m⎿  Read 27 lines${E}0m`,
  '',
  `${E}38;5;114m●${E}0m ${E}1mWrite${E}0m(src/lib/safe-redirect.ts)`,
  `  ${E}2m⎿  Wrote 11 lines to src/lib/safe-redirect.ts${E}0m`,
  `     ${E}38;5;71m1 + /** 같은 사이트 안의 경로만 돌려준다. 나머지는 fallback. */${E}0m`,
  `     ${E}38;5;71m2 + export function safeRedirect(next: string | null, fallback = '/'): string {${E}0m`,
  '',
  `${E}38;5;114m●${E}0m ${E}1mUpdate${E}0m(src/middleware.ts)`,
  `  ${E}2m⎿  Updated src/middleware.ts with 2 additions and 2 removals${E}0m`,
  `    ${E}38;5;167m40 -     return NextResponse.redirect(new URL(next))${E}0m`,
  `    ${E}38;5;71m40 +     return NextResponse.redirect(new URL(next, req.url))${E}0m`,
  '',
  `${E}38;5;114m●${E}0m ${E}1mBash${E}0m(npm run build)`,
  `  ${E}38;5;179m⎿  Do you want to proceed?${E}0m`,
  `  ${E}1m❯ 1. Yes${E}0m`,
  '    2. No, and tell Claude what to do differently (esc)',
].join('\r\n') + '\r\n'

/** What the shell terminal replays */
export const shellTranscript = [
  'PowerShell 7.5.2',
  '',
  `${E}32mPS C:\\Users\\me\\code\\shop-web>${E}0m git status`,
  'On branch fix/login-redirect',
  'Changes not staged for commit:',
  `        ${E}31mmodified:   src/middleware.ts${E}0m`,
  '',
  `${E}32mPS C:\\Users\\me\\code\\shop-web>${E}0m `,
].join('\r\n')
