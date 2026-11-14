#!/usr/bin/env node
/**
 * shots.mjs — screenshots of the real built UI (dist/) with made-up sessions,
 * for comparing every restyle with the design lab. See tests/visual/README.md.
 *
 * How: the repo's own server (server/index.js) runs as a child on its own port
 * (3397) and its own home (tests/visual/.home), only to serve dist/ and the
 * Pokémon pictures. Headless Chromium (playwright-core, loaded from outside the
 * repo: no dependency) opens the app's page with a fake desktop bridge
 * (fake-bridge.js) and answers its WebSocket with the fixture snapshot
 * (fixture.mjs). No Electron, no pty, nothing of the owner's is read.
 *
 * Run `node tests/visual/shots.mjs --help` for the options.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as fixture from './fixture.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DIST = join(ROOT, 'dist')
const HOME = join(HERE, '.home')
const PORT = 3397
const BASE = `http://127.0.0.1:${PORT}`
const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE ?? 'C:/Users/hoo20/Documents/spawn-promo/video/node_modules/playwright-core'
const LAB = process.env.LAB_SHOTS ?? 'C:/Users/hoo20/Documents/spawn-site-lab/calm-lab/shots-v5'
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

/** What the Electron window paints behind the page (electron/main.cjs): window #0b0c10; the widget is see-through, so a desktop grey */
const WINDOW_BG = '#0b0c10'
const DESKTOP_BG = '#23252b'

/** No Pokémon word, name, level or "HP" in 업무 모드 — copied from tests/work-mode.test.ts (GAME) */
const GAME = /포켓몬|몬스터볼|도감|박스|잡았|포획|파티|트레이너|Lv\.|\bHP\b|Pok[eé]|Poké|Pokédex|ポケモン|図鑑|ボックス|ゲット|トレーナー|モンスターボール/i

const USAGE = `
Screenshots of the built UI (dist/) with fixture sessions.

  node tests/visual/shots.mjs [--out <dir>] [--only a,b] [--size WxH] [--check fit|work] [--flow <name>]
  node tests/visual/shots.mjs --sheet <surface>[,<surface>] [--size WxH] --out <dir>

Before: npx vite build   (the harness reads dist/, it never builds)

  --out <dir>      where the PNGs go (default tests/visual/.home/shots). Made if missing.
  --only a,b       only these surface ids (default: all of them, below)
  --size WxH       only this size (1440x900 or 1100x720); with --sheet, the size to compare
  --check fit      in every shot page: no sideways page scroll, and no child of
                   .w-term-tabs / .w-list-head / .w-sess-bar / .w-row ends past its parent
  --check work     in every -work shot: no img[src*="/sprites/pokemon"], no Pokémon word in
                   the visible text, titles or aria-labels, and the first .w-row has the same
                   left and width as in the same surface without 업무 모드 (shot too if needed)
                   (both checks may be given: --check fit --check work, or --check fit,work;
                   --check work refuses a run with no -work surface in it)
  --flow <name>    an interaction flow (exits non-zero when it finds a problem):
                   tabs-gone  close / rename / drag in 상세, 간략 and folded, the list header's
                              >_ + 간략 상세, the rail's >_, switching by rail and Ctrl+Tab, the
                              chosen row in sight among twelve, 업무 모드's header
  --sheet <s>      no shots: writes <out>/sheet-<s>[-WxH].png = before (<out>/../00-before/),
                   the lab reference, after (<out>), side by side or stacked
  --help           this

Surfaces (each at 1440x900 and 1100x720 unless noted):
  session session-compact session-12 session-12-compact size-small size-xlarge dex box log rank settings rail
  widget widget-xlarge (340x820)   toast qa (full page, 1440 wide)   status-card (300x96)
  -work: session-work session-compact-work rail-work widget-work settings-work
  -mac:  session-mac rail-mac

Files: <surface>-<W>x<H>.png (qa and toast: the PNG's real size, e.g. toast-1342x1630.png).
Exit code 0 only when every requested shot was written and every requested check passed.

Environment: PLAYWRIGHT_CORE (path to playwright-core, default the spawn-promo copy),
SHOTS_BROWSER (a browser executable to use instead of Chromium / Edge / Chrome),
LAB_SHOTS (the lab's reference folder, default calm-lab/shots-v5).
Uses port ${PORT} and tests/visual/.home only.
`

// ---------------------------------------------------------------- surfaces

/**
 * What each base surface opens. view: the carried view (spawn-carry); mode: the window
 * kind; local: extra page storage; then a step to reach it (click a cell, open 설정).
 */
const SURFACES = {
  session: { view: 'terminal' },
  'session-compact': { view: 'terminal', local: { 'spawn-list-mode': 'compact' } },
  'session-12': { view: 'terminal', twelve: true },
  'session-12-compact': { view: 'terminal', twelve: true, local: { 'spawn-list-mode': 'compact' } },
  // spawn-text-size arrives in Task 7 (harmless before); spawn-term-font is today's terminal size
  // and the key the step migrates from, so the before set shows the terminal at that size too
  'size-small': { view: 'terminal', local: { 'spawn-text-size': 'small', 'spawn-term-font': '12' } },
  'size-xlarge': { view: 'terminal', local: { 'spawn-text-size': 'xlarge', 'spawn-term-font': '17' } },
  dex: { view: 'dex', click: '.dex-grid .dex-cell.caught' },
  box: { view: 'box', click: '.box-grid .box-cell' },
  log: { view: 'today', ready: '.today' },
  // The board's own twelve rows (the viewer 7th), as the lab shows them: practice rivals hidden
  rank: { view: 'rank', ready: '.rank-name', local: { 'spawn-rank-npc': '0' } },
  settings: { view: 'terminal', settings: true },
  rail: { view: 'terminal', local: { 'spawn-side-hidden': '1' } },
  widget: { mode: 'widget', sizes: [[340, 820]] },
  'widget-xlarge': { mode: 'widget', sizes: [[340, 820]], local: { 'spawn-text-size': 'xlarge', 'spawn-term-font': '17' } },
  toast: { page: 'qa', clip: '.qa-section', sizes: [[1440, 900]] },
  qa: { page: 'qa', fullPage: true, sizes: [[1440, 900]] },
  'status-card': { page: 'status-card', sizes: [[300, 96]] },
}
const WORK = ['session', 'session-compact', 'rail', 'widget', 'settings']
const MAC = ['session', 'rail']
const SIZES = [[1440, 900], [1100, 720]]

const ALL_IDS = [...Object.keys(SURFACES), ...WORK.map(s => `${s}-work`), ...MAC.map(s => `${s}-mac`)]

/** 'session-compact-work' -> { base: 'session-compact', work: true, mac: false } */
function parseId(id) {
  let base = id, work = false, mac = false
  if (base.endsWith('-mac')) { mac = true; base = base.slice(0, -4) }
  if (base.endsWith('-work')) { work = true; base = base.slice(0, -5) }
  if (!SURFACES[base] || (work && !WORK.includes(base)) || (mac && !MAC.includes(base))) return null
  return { id, base, work, mac, ...SURFACES[base] }
}

/** The lab picture a surface is compared with (docs/superpowers/plans/2026-11-14-calm-style-2.md) */
const LAB_REF = {
  session: 's2-session-terminal.png', 'session-compact': 's2-chat-compact.png', 'session-12-compact': 's2-chat-compact.png', 'session-work': 's2-work-terminal.png',
  'size-small': 's2-size-smallest-terminal.png', 'size-xlarge': 's2-size-largest-terminal.png',
  dex: 'dex-calm2.png', box: 'box-calm2.png', log: 'log-calm2.png', rank: 'rank-calm2.png', settings: 'settings-calm2.png', toast: 'toast-calm2.png',
  widget: 'widget-calm2.png', 'widget-work': 'widget-calm2-work.png', rail: 'rail-calm2.png', 'rail-work': 'rail-calm2-work.png',
}
const LAB_1100 = new Set(['session', 'session-compact', 'session-12', 'session-12-compact', 'session-mac'])
function labRef(surface, size) {
  if (size === '1100x720' && LAB_1100.has(surface)) return 's2-chat-1100.png'
  return LAB_REF[surface] ?? LAB_REF[surface.replace(/-mac$/, '')] ?? null
}

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const o = { out: join(HOME, 'shots'), only: null, size: null, checks: new Set(), flows: [], sheets: [], help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`); return v }
    if (a === '--help' || a === '-h') o.help = true
    else if (a === '--out') o.out = resolve(val())
    else if (a === '--only') o.only = val().split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '--size') o.size = val()
    else if (a === '--check') for (const c of val().split(',')) o.checks.add(c.trim())
    else if (a === '--flow') o.flows.push(val())
    else if (a === '--sheet') o.sheets.push(...val().split(',').map(s => s.trim()).filter(Boolean))
    else fail(`unknown argument ${a} (see --help)`)
  }
  for (const c of o.checks) if (c !== 'fit' && c !== 'work') fail(`unknown check "${c}": fit or work`)
  if (o.size && !/^\d+x\d+$/.test(o.size)) fail(`--size wants WxH, e.g. 1100x720`)
  for (const id of [...(o.only ?? []), ...o.sheets]) if (!parseId(id)) fail(`unknown surface "${id}". Surfaces: ${ALL_IDS.join(' ')}`)
  for (const f of o.flows) if (!FLOWS[f]) fail(`unknown flow "${f}". Flows: ${Object.keys(FLOWS).join(' ')}`)
  return o
}

/** The server child while it runs: killed on every way out (a child outlives process.exit on Windows) */
let serverChild = null
function stopServer() {
  if (serverChild && serverChild.exitCode === null) { try { serverChild.kill() } catch { /* already gone */ } }
  serverChild = null
}
process.on('exit', stopServer)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => { stopServer(); process.exit(130) })
}
process.on('uncaughtException', err => { console.error(err); stopServer(); process.exit(1) })
process.on('unhandledRejection', err => { console.error(err); stopServer(); process.exit(1) })

function fail(msg) {
  console.error(`shots: ${msg}`)
  stopServer()
  process.exit(2)
}

// ---------------------------------------------------------------- flows

/** name -> async (ctx) => string[] (problems) */
const FLOWS = {
  /**
   * The session tab row is gone (calm-style plan, Task 5): every job it did still has a home.
   * In 상세, in 간략 and with the left panel folded: × asks 닫기 once, the ask clears when the
   * mouse leaves, a second click closes (one terminals.close with that row's terminal); rename
   * opens exactly one field and Enter sends one terminals.rename; a drag sends one
   * terminals.move. Also: the list header's >_ / + / 간략·상세, the rail's >_, switching by the
   * rail and by Ctrl+Tab / Ctrl+Shift+Tab (the header follows), the chosen row kept in sight
   * among twelve, and 업무 모드's header with no picture.
   */
  'tabs-gone': async ({ browser }) => {
    const problems = []
    const run = async (label, setup, steps) => {
      let app
      try {
        app = await openApp(browser, setup)
        await steps(app, m => problems.push(`${label}: ${m}`))
      } catch (err) {
        problems.push(`${label}: ${String(err.message).split('\n')[0]}`)
      } finally {
        if (app) await app.ctx.close()
      }
    }
    for (const [label, local] of [['상세', {}], ['간략', { 'spawn-list-mode': 'compact' }]]) {
      await run(label, { local }, async ({ page, shot }, bad) => {
        const rows = page.locator('.w-party .w-row')
        const compact = await page.locator('.w-rows.compact').count()
        if (!!compact !== (label === '간략')) bad(`.w-rows.compact is ${compact ? 'there' : 'missing'}`)
        if (await page.locator('.w-sess-tabs, .w-sess-tab').count()) bad('a session tab row is still drawn')
        if (!(await page.locator('.w-sess-bar .w-sess-head').count())) bad('no session header')
        // 간략 rows are one line: no second line, no bottom line
        if (label === '간략' && await page.locator('.w-row .w-row-line2, .w-row .w-row-bottom').count()) bad('a 간략 row has a second or bottom line')
        await closeAsksThenCloses(page, rows.nth(1), rows.nth(1).locator('.w-row-close'), shot.terminals[1].id, bad)
        // Double-click row 1's name: exactly one field, in that row; Enter renames once
        await rows.nth(0).locator('.w-row-name').dblclick()
        await renameOnce(page, rows.nth(0).locator('input.w-row-rename'), shot.terminals[0].id, '새 이름', bad)
        // Drag row 1 below row 2: one terminals.move with row 1's terminal
        const b1 = await rows.nth(0).boundingBox(), b2 = await rows.nth(1).boundingBox()
        const x = b1.x + 70, y = b1.y + b1.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
        for (let k = 1; k <= 12; k++) await page.mouse.move(x, y + ((b2.height + 6) * k) / 12)
        await page.mouse.up()
        await sleep(150)
        const moves = (await calls(page)).filter(c => c.fn === 'move')
        if (moves.length !== 1 || moves[0].args[0] !== shot.terminals[0].id) bad(`drag: expected one move of ${shot.terminals[0].id}, got ${JSON.stringify(moves)}`)
        if (label !== '상세') return
        // The list header: >_ opens a shell, + asks who goes (the picker), 간략 / 상세 switch and are kept
        await page.locator('.w-list-head .w-list-shell').click()
        await sleep(100)
        const shells = (await calls(page)).filter(c => c.fn === 'create')
        if (shells.length !== 1 || shells[0].args[0]?.tool !== 'shell') bad(`>_: expected one create { tool: 'shell' }, got ${JSON.stringify(shells)}`)
        await page.locator('.w-list-head .w-list-btn:not(.w-list-shell)').click()
        if (!(await page.locator('.resume-modal[role="dialog"]').count())) bad('+ did not open the "who goes?" picker')
        else await page.locator('.resume-backdrop').click({ position: { x: 4, y: 4 } })
        await page.locator('.w-list-mode button', { hasText: '간략' }).click()
        const kept = await page.evaluate(() => localStorage.getItem('spawn-list-mode'))
        if (!(await page.locator('.w-rows.compact').count()) || kept !== 'compact') bad(`간략 did not switch the list (stored ${kept})`)
        if (await page.locator('.w-list-mode button[aria-pressed="true"]').textContent() !== '간략') bad('간략 is not the pressed button')
        await page.locator('.w-list-mode button', { hasText: '상세' }).click()
        if (await page.locator('.w-rows.compact').count()) bad('상세 did not switch the list back')
      })
    }
    // The left panel folded: the header and the rail do it all
    await run('접힘', { local: { 'spawn-side-hidden': '1' } }, async ({ page, shot }, bad) => {
      const head = page.locator('.w-sess-head')
      await closeAsksThenCloses(page, head, head.locator('.w-sess-head-close'), shot.terminals[0].id, bad)
      await head.locator('.w-sess-head-name').dblclick()
      await renameOnce(page, head.locator('input.w-sess-head-rename'), shot.terminals[0].id, '새 이름', bad)
      const name = () => head.locator('.w-sess-head-name').textContent()
      const titles = shot.terminals.map(t => t.title ?? '새 세션')
      await page.locator('.w-rail-session').nth(1).click()
      if (await name() !== titles[1]) bad(`the rail's 2nd session: the header reads "${await name()}", not "${titles[1]}"`)
      await page.keyboard.press('Control+Tab')
      if (await name() !== titles[2]) bad(`Ctrl+Tab: the header reads "${await name()}", not "${titles[2]}"`)
      await page.keyboard.press('Control+Shift+Tab')
      await page.keyboard.press('Control+Shift+Tab')
      if (await name() !== titles[0]) bad(`Ctrl+Shift+Tab twice: the header reads "${await name()}", not "${titles[0]}"`)
      await page.locator('.w-rail .w-rail-newshell').click()
      await sleep(100)
      const shells = (await calls(page)).filter(c => c.fn === 'create')
      if (shells.length !== 1 || shells[0].args[0]?.tool !== 'shell') bad(`the rail's >_: expected one create { tool: 'shell' }, got ${JSON.stringify(shells)}`)
    })
    // Twelve sessions in a small window: the chosen row is scrolled into sight
    await run('12개', { twelve: true, size: [1100, 720] }, async ({ page, shot }, bad) => {
      await page.keyboard.press('Control+Shift+Tab')
      await sleep(300)
      const seen = await page.evaluate(() => {
        const list = document.querySelector('.w-party').getBoundingClientRect()
        const row = document.querySelector('.w-row.chosen')?.getBoundingClientRect()
        return row ? row.top >= list.top - 0.5 && row.bottom <= list.bottom + 0.5 : null
      })
      if (seen !== true) bad(`the chosen row (the last of ${shot.terminals.length}) is ${seen === null ? 'missing' : 'out of sight'} after Ctrl+Shift+Tab`)
    })
    // 업무 모드, folded: the header shows a glyph, no picture
    await run('업무 모드', { work: true, local: { 'spawn-side-hidden': '1' } }, async ({ page }, bad) => {
      if (await page.locator('.w-sess-head img').count()) bad('a picture in the session header')
      if (!(await page.locator('.w-sess-head .w-sess-head-glyph').count())) bad('no glyph in the session header')
    })
    return problems
  },
}

/** The bridge calls the page made so far (fake-bridge.js) */
const calls = page => page.evaluate(() => window.__CALLS__)

/** ×: the first click asks (닫기, nothing closed), leaving clears it, two clicks close it once */
async function closeAsksThenCloses(page, hoverOn, x, terminalId, bad) {
  await hoverOn.hover()
  await x.click()
  if ((await x.textContent()).trim() !== '닫기') bad(`× after one click reads "${(await x.textContent()).trim()}", not 닫기`)
  if ((await calls(page)).some(c => c.fn === 'close')) bad('× closed at once, without asking')
  await page.mouse.move(2, 2)
  await sleep(80)
  if ((await x.textContent()).trim() !== '×') bad('the 닫기 ask stayed after the mouse left')
  await hoverOn.hover()
  await x.click()
  await x.click()
  await sleep(80)
  const closes = (await calls(page)).filter(c => c.fn === 'close')
  if (closes.length !== 1 || closes[0].args[0] !== terminalId) bad(`× twice: expected one close of ${terminalId}, got ${JSON.stringify(closes)}`)
}

/** A rename field is open: exactly one in the page, the expected one; Enter sends one rename */
async function renameOnce(page, field, terminalId, value, bad) {
  const all = await page.locator('input.w-row-rename, input.w-sess-head-rename').count()
  if (all !== 1 || (await field.count()) !== 1) bad(`double-click: ${all} rename field(s) in the page, ${await field.count()} where expected`)
  if (!(await field.count())) return
  await field.fill(value)
  await field.press('Enter')
  await sleep(80)
  const renames = (await calls(page)).filter(c => c.fn === 'rename')
  if (renames.length !== 1 || renames[0].args[0] !== terminalId || renames[0].args[1] !== value) bad(`Enter: expected one rename of ${terminalId} to "${value}", got ${JSON.stringify(renames)}`)
  if (await page.locator('input.w-row-rename, input.w-sess-head-rename').count()) bad('the rename field stayed open after Enter')
}

/** The app with the fixture in a page of its own, for a flow (window mode) */
async function openApp(browser, { local = {}, twelve = false, size = [1440, 900], work = false } = {}) {
  const shot = {
    mode: 'window', workMode: work, version: VERSION,
    terminals: twelve ? fixture.terminals12 : fixture.terminals,
    board: fixture.board, branches: fixture.branches,
    transcript: fixture.transcript, shellTranscript: fixture.shellTranscript,
  }
  const snapshot = twelve ? fixture.snapshot12 : fixture.snapshot
  const all = {
    'spawn-carry': JSON.stringify({ view: 'terminal', target: shot.terminals[0].sessionId }),
    'spawn-side-hidden': '0', 'spawn-seen-version': VERSION, 'spawn-dex-viewed': JSON.stringify(fixture.VIEWED),
    ...local,
  }
  const ctx = await browser.newContext({
    viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    colorScheme: 'dark', bypassCSP: true,
  })
  try {
    await ctx.clock.setFixedTime(fixture.NOW)
    const page = await ctx.newPage()
    await page.addInitScript(pageSetup, { shot, local: all, mac: false, origin: BASE })
    await page.addInitScript({ path: join(HERE, 'fake-bridge.js') })
    await page.routeWebSocket(/\/ws$/, ws => {
      const send = () => ws.send(JSON.stringify(snapshot))
      send()
      ws.onMessage(send)
    })
    await page.goto(`${BASE}/?widget&mode=window`)
    await page.waitForFunction(n => document.querySelectorAll('.w-party .w-row').length === n, shot.terminals.length, { timeout: 15_000 })
    await page.waitForSelector('.w-sess-head', { timeout: 15_000 })
    return { ctx, page, shot }
  } catch (err) {
    await ctx.close()
    throw err
  }
}

// ---------------------------------------------------------------- small helpers

const sleep = ms => new Promise(r => setTimeout(r, ms))

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

async function loadPlaywright() {
  const entry = existsSync(join(PLAYWRIGHT, 'index.mjs')) ? pathToFileURL(join(PLAYWRIGHT, 'index.mjs')).href : PLAYWRIGHT
  try {
    return await import(entry)
  } catch (err) {
    fail(`cannot load playwright-core from ${PLAYWRIGHT} (${err.message}). Set PLAYWRIGHT_CORE to a playwright-core folder.`)
  }
}

/**
 * Playwright's own Chromium when its revision is installed, else the installed Edge, else Chrome;
 * SHOTS_BROWSER (a browser executable) is tried alone when set
 */
async function launchBrowser(chromium) {
  const tries = process.env.SHOTS_BROWSER
    ? [{ executablePath: process.env.SHOTS_BROWSER }]
    : [{}, { channel: 'msedge' }, { channel: 'chrome' }]
  const errors = []
  for (const opts of tries) {
    try {
      const browser = await chromium.launch({ headless: true, ...opts })
      return { browser, name: opts.executablePath ?? opts.channel ?? 'chromium' }
    } catch (err) {
      errors.push(`${opts.executablePath ?? opts.channel ?? 'chromium'}: ${String(err.message).split('\n')[0]}`)
    }
  }
  fail(`no browser could start:\n  ${errors.join('\n  ')}`)
}

// ---------------------------------------------------------------- the server

async function answers(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1000) }); return r.ok } catch { return false }
}

async function startServer() {
  if (await answers(`${BASE}/`)) fail(`port ${PORT} already answers: another harness run (or something else) is using it`)
  mkdirSync(join(HOME, 'registry'), { recursive: true })
  mkdirSync(join(HOME, 'claude'), { recursive: true })
  const env = {
    ...process.env,
    SPAWN_HOME: HOME,
    SPAWN_REGISTRY_DIR: join(HOME, 'registry'),
    SPAWN_PORT: String(PORT),
    SPAWN_UI_DIR: DIST,
    // Not the owner's: the server reads 프롬프트 숨기기 from the app's settings file, and ~/.claude
    SPAWN_SETTINGS_FILE: join(HOME, 'settings.json'),
    CLAUDE_CONFIG_DIR: join(HOME, 'claude'),
  }
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDEX_')) delete env[k]
  const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  serverChild = child
  let output = ''
  child.stdout.on('data', d => { output += d })
  child.stderr.on('data', d => { output += d })
  let exited = null
  child.on('exit', code => { exited = code })
  const until = Date.now() + 20_000
  while (Date.now() < until) {
    if (exited !== null) fail(`the server stopped (exit ${exited}):\n${output}`)
    if (await answers(`${BASE}/`)) return { child, log: () => output }
    await sleep(200)
  }
  fail(`the server did not answer on ${BASE} within 20 s:\n${output}`)
}

// ---------------------------------------------------------------- one shot

/** Runs in the page before its own code: the shot, page storage, the Mac platform */
function pageSetup({ shot, local, mac, origin }) {
  window.__SHOT__ = shot
  // The same "random" picks every run (the instruction box's line is picked at random)
  let seed = 0x2f6b1d
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  if (location.origin === origin) {
    try { for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v) } catch { /* no storage */ }
  }
  if (mac) {
    // src/platform.ts reads userAgentData.platform first, then navigator.platform
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel', configurable: true })
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ platform: 'macOS', mobile: false, brands: [] }), configurable: true })
  }
}

/** Every <img> on screen has finished (loaded or failed); lazy ones below the fold are left */
async function imagesSettled(page, timeout = 30_000) {
  await page.waitForFunction(() => [...document.images].every(img => {
    const r = img.getBoundingClientRect()
    const onScreen = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
    return !onScreen || img.complete
  }), null, { timeout, polling: 200 })
}

async function fitProblems(page) {
  return page.evaluate(() => {
    const bad = []
    const name = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`
    const sw = document.documentElement.scrollWidth
    if (sw > innerWidth) bad.push(`the page scrolls sideways: scrollWidth ${sw} > ${innerWidth}`)
    for (const parent of document.querySelectorAll('.w-term-tabs, .w-list-head, .w-sess-bar, .w-row')) {
      const pr = parent.getBoundingClientRect()
      if (!pr.width) continue
      for (const child of parent.children) {
        const cs = getComputedStyle(child)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        const r = child.getBoundingClientRect()
        if (!r.width && !r.height) continue
        if (r.right > pr.right + 0.5) bad.push(`${name(child)} ends at ${r.right.toFixed(1)}, past its parent ${name(parent)} (${pr.right.toFixed(1)})`)
      }
    }
    return bad
  })
}

/**
 * 업무 모드 problems. The 설정 dialog (.set-backdrop) is left out of the words: settings may
 * speak of the game (src/workMode.ts WORK_MODE_SETTING_TEXT — a passer-by does not open
 * them), so settings-work checks the page around it. Pictures are checked everywhere.
 */
async function workProblems(page) {
  return page.evaluate((src) => {
    const GAME = new RegExp(src, 'i')
    const bad = []
    // The mode is really on: without the class the checks below would pass for nothing
    if (!document.documentElement.classList.contains('work-mode')) bad.push('<html> has no work-mode class: 업무 모드 is not on')
    const pics = document.querySelectorAll('img[src*="/sprites/pokemon"]')
    if (pics.length) bad.push(`${pics.length} Pokémon picture(s), first ${pics[0].getAttribute('src')}`)
    // A session drawn as a picture at all (a Pokémon, or the stand-in ball while it has none)
    const sessionPics = document.querySelectorAll('img.w-row-mon, .w-row img, .w-rail-session img, .w-sess-tab img, .w-sess-head img, .w-party img')
    if (sessionPics.length) bad.push(`${sessionPics.length} picture(s) in session rows / tabs / rail / party, first ${sessionPics[0].getAttribute('src')}`)
    const balls = [...document.querySelectorAll('img[src*="/sprites/spawn-ball"]')].filter(i => { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    if (balls.length) bad.push(`${balls.length} visible Poké Ball stand-in picture(s)`)
    const dialogs = [...document.querySelectorAll('.set-backdrop')]
    const was = dialogs.map(d => d.style.display)
    dialogs.forEach(d => { d.style.display = 'none' })
    const texts = [['text', document.body.innerText]]
    dialogs.forEach((d, i) => { d.style.display = was[i] })
    for (const el of document.querySelectorAll('[title], [aria-label]')) {
      if (el.closest('.set-backdrop')) continue
      for (const attr of ['title', 'aria-label']) { const v = el.getAttribute(attr); if (v) texts.push([attr, v]) }
    }
    for (const [where, text] of texts) {
      for (const line of text.split('\n')) {
        const m = line.match(GAME)
        if (m) bad.push(`"${m[0]}" in ${where}: ${line.trim().slice(0, 90)}`)
      }
    }
    return [...new Set(bad)]
  }, GAME.source)
}

async function firstRowBox(page) {
  return page.evaluate(() => {
    const row = document.querySelector('.w-row')
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { left: r.left, width: r.width }
  })
}

async function shoot(browser, s, [W, H], opts, report) {
  const sizeName = `${W}x${H}`
  const label = `${s.id} ${sizeName}`
  const twelve = !!s.twelve
  const shot = {
    mode: s.mode ?? 'window', workMode: s.work, version: VERSION,
    terminals: twelve ? fixture.terminals12 : fixture.terminals,
    board: fixture.board, branches: fixture.branches,
    transcript: fixture.transcript, shellTranscript: fixture.shellTranscript,
  }
  const snapshot = twelve ? fixture.snapshot12 : fixture.snapshot
  const local = {
    'spawn-carry': JSON.stringify({ view: s.view ?? 'terminal', target: shot.terminals[0].sessionId }),
    'spawn-side-hidden': '0',
    // No "what's new" over the page, and every caught species opened but one (the NEW dot)
    'spawn-seen-version': VERSION,
    'spawn-dex-viewed': JSON.stringify(fixture.VIEWED),
    ...(s.local ?? {}),
  }
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    colorScheme: 'dark', bypassCSP: true, reducedMotion: 'no-preference',
  })
  const result = { id: s.id, size: sizeName, file: null, problems: [], warnings: [], row: null }
  try {
    await ctx.clock.setFixedTime(fixture.NOW)
    const page = await ctx.newPage()
    page.on('pageerror', err => result.warnings.push(`page error: ${err.message.split('\n')[0]}`))
    page.on('response', res => {
      const url = res.url()
      if (/\/sprites\/pokemon\//.test(url) && res.status() !== 200) result.warnings.push(`picture ${url.replace(BASE, '')} answered ${res.status()}${res.status() === 302 ? ` → ${res.headers().location}` : ''}`)
    })
    let wsMessages = 0
    if (s.page !== 'status-card') {
      await page.addInitScript(pageSetup, { shot, local, mac: s.mac, origin: BASE })
      await page.addInitScript({ path: join(HERE, 'fake-bridge.js') })
      // The server's first message on every connection is the snapshot; the page sends
      // nothing first, so it goes out at once, and again for anything the page says
      await page.routeWebSocket(/\/ws$/, ws => {
        const send = () => { wsMessages++; ws.send(JSON.stringify(snapshot)) }
        send()
        ws.onMessage(send)
      })
    }

    if (s.page === 'status-card') {
      await page.goto(pathToFileURL(join(ROOT, 'electron', 'status-card.html')).href + '?step=starting&lang=ko')
      await page.addStyleTag({ content: `html, body { background: ${DESKTOP_BG} !important; }` })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForFunction(() => document.getElementById('msg')?.textContent)
    } else if (s.page === 'qa') {
      await page.goto(`${BASE}/?qa`)
      await page.waitForSelector('.qa-section .w-toast', { timeout: 15_000 })
      await page.evaluate(() => document.fonts.ready)
    } else {
      await page.goto(`${BASE}/?widget&mode=${s.mode ?? 'window'}`)
      await page.addStyleTag({ content: `html { background: ${(s.mode ?? 'window') === 'widget' ? DESKTOP_BG : WINDOW_BG} !important; }` })
      // The fixture is in: a row per terminal, the usage numbers, and (outside 업무 모드) every
      // session drawn as its Pokémon rather than the stand-in ball
      await page.waitForFunction(({ rows, work }) => {
        if (document.querySelectorAll('.w-party .w-row').length !== rows) return false
        if (!document.querySelector('.w-limits:not(.idle) .w-limit:not(.loading)')) return false
        if (!work && [...document.querySelectorAll('img.w-row-mon')].some(i => /spawn-ball/.test(i.src))) return false
        return true
      }, { rows: shot.terminals.length, work: s.work }, { timeout: 15_000 })
      await page.evaluate(() => document.fonts.ready)
      const view = s.work ? 'terminal' : (s.view ?? 'terminal')
      if (s.mode !== 'widget' && view === 'terminal') {
        // The terminal in view has replayed its transcript
        await page.waitForSelector('.w-term-body .xterm', { timeout: 15_000 })
        await sleep(600)
      }
      if (s.mode !== 'widget' && view !== 'terminal' && !s.work) {
        if (s.ready) await page.waitForSelector(s.ready, { timeout: 15_000 })
        if (s.click) {
          await page.waitForSelector(s.click, { timeout: 15_000 })
          await page.locator(s.click).first().click()
          await page.waitForSelector('.dex-detail .dex-card', { timeout: 10_000 })
        }
      }
      if (s.settings) {
        await page.locator('.w-head .w-icon[aria-label="설정"]').click()
        await page.locator('.set-nav button', { hasText: /^앱$/ }).click()
        await page.waitForSelector('.set-modal', { timeout: 10_000 })
      }
      // Away from anything hovered (a tooltip or hover tools would differ run to run)
      await page.mouse.move(W - 1, H - 1)
    }
    await imagesSettled(page)
    await sleep(250)
    if (s.page !== 'status-card' && !wsMessages && s.page !== 'qa') result.warnings.push('the page never opened its WebSocket')

    // The picture
    let buf
    if (s.clip) buf = await page.locator(s.clip).first().screenshot({ animations: 'disabled', caret: 'hide' })
    else buf = await page.screenshot({ fullPage: !!s.fullPage, animations: 'disabled', caret: 'hide' })
    const { w, h } = pngSize(buf)
    const file = join(opts.out, `${s.id}-${s.clip || s.fullPage ? `${w}x${h}` : sizeName}.png`)
    writeFileSync(file, buf)
    result.file = file

    // The checks, in the same page
    if (opts.checks.has('fit')) result.problems.push(...(await fitProblems(page)).map(p => `fit: ${p}`))
    if (opts.checks.has('work') && s.work) result.problems.push(...(await workProblems(page)).map(p => `work: ${p}`))
    if (opts.checks.has('work')) result.row = await firstRowBox(page)
  } catch (err) {
    result.problems.push(`shot failed: ${String(err.message).split('\n')[0]}`)
  } finally {
    await ctx.close()
  }
  report.push(result)
  const mark = result.file && !result.problems.length ? 'ok ' : 'BAD'
  console.log(`${mark} ${label}${result.file ? `  → ${result.file}` : ''}`)
  for (const p of result.problems) console.log(`      ${p}`)
  for (const wmsg of [...new Set(result.warnings)]) console.log(`      (warning) ${wmsg}`)
}

// ---------------------------------------------------------------- sheets

function findShot(dir, surface, size) {
  if (!existsSync(dir)) return null
  if (size) { const f = join(dir, `${surface}-${size}.png`); return existsSync(f) ? f : null }
  const names = readdirSync(dir).filter(n => new RegExp(`^${surface.replace(/[-]/g, '\\-')}-\\d+x\\d+\\.png$`).test(n)).sort()
  const preferred = names.find(n => n.endsWith('-1440x900.png'))
  return preferred ? join(dir, preferred) : names[0] ? join(dir, names[0]) : null
}

async function sheet(browser, surface, opts) {
  const before = findShot(resolve(opts.out, '..', '00-before'), surface, opts.size)
  const after = findShot(opts.out, surface, opts.size)
  if (!after) return `${surface}: no after shot ${surface}-${opts.size ?? '*'}.png in ${opts.out} (take the shots first)`
  const size = /-(\d+x\d+)\.png$/.exec(after)[1]
  const labName = labRef(surface, size)
  const lab = labName && existsSync(join(LAB, labName)) ? join(LAB, labName) : null
  const dataUrl = f => `data:image/png;base64,${readFileSync(f).toString('base64')}`
  const { w, h } = pngSize(readFileSync(after))
  const stacked = w > h
  const col = (title, file, note) => `<figure><figcaption><b>${title}</b> ${note}</figcaption>${file ? `<img src="${dataUrl(file)}">` : '<div class="none">none</div>'}</figure>`
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #2a2c33; color: #e8e9ee; font: 14px/1.4 system-ui, sans-serif; }
    main { display: flex; flex-direction: ${stacked ? 'column' : 'row'}; gap: 16px; padding: 16px; align-items: flex-start; width: max-content; }
    figure { margin: 0; } figcaption { margin: 0 0 6px; color: #b9bcc6; } figcaption b { color: #fff; }
    img { display: block; ${stacked ? 'width: 1440px;' : ''} outline: 1px solid #555; }
    .none { width: ${stacked ? 1440 : w}px; height: 120px; display: grid; place-items: center; outline: 1px dashed #666; color: #999; }
  </style><main>
    ${col('before', before, before ? before.split(/[\\/]/).slice(-2).join('/') : '(no 00-before shot)')}
    ${col('lab', lab, lab ? labName : '(no lab reference for this surface)')}
    ${col('after', after, after.split(/[\\/]/).slice(-2).join('/'))}
  </main>`
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  try {
    await page.setContent(html)
    await page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))))
    const file = join(opts.out, `sheet-${surface}${opts.size ? `-${opts.size}` : ''}.png`)
    await page.locator('main').screenshot({ path: file })
    console.log(`ok  sheet ${surface} ${size}  → ${file}`)
    return null
  } finally {
    await page.close()
  }
}

// ---------------------------------------------------------------- main

/** The newest modification time of any file under dir (0 when there is none) */
function newestIn(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestIn(p) : statSync(p).mtimeMs)
  }
  return newest
}

/** dist/ built before the last change under src/: the shots would show the old UI */
function warnIfStale() {
  const built = statSync(join(DIST, 'index.html')).mtimeMs
  if (newestIn(join(ROOT, 'src')) > built) console.warn('shots: (warning) stale dist: src/ changed after the last build — run npx vite build')
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) { console.log(USAGE); return 0 }
  mkdirSync(opts.out, { recursive: true })
  const { chromium } = await loadPlaywright()

  if (opts.sheets.length) {
    const { browser } = await launchBrowser(chromium)
    try {
      const errors = []
      for (const s of opts.sheets) { const e = await sheet(browser, s, opts); if (e) { errors.push(e); console.log(`BAD ${e}`) } }
      return errors.length ? 1 : 0
    } finally {
      await browser.close()
    }
  }

  if (!existsSync(join(DIST, 'index.html'))) fail(`dist/index.html is missing: run \`npx vite build\` first`)

  // Which shots: the asked surfaces (all by default), each at its sizes; --check work also
  // needs each -work surface's plain twin to compare the first row with
  // --flow alone (no --only, no --check) runs the flow without taking every shot first
  const ids = new Set(opts.only ?? (opts.flows.length && !opts.checks.size ? [] : ALL_IDS))
  if (opts.checks.has('work')) for (const id of [...ids]) if (parseId(id).work) ids.add(id.replace(/-work(-mac)?$/, '$1'))
  const jobs = []
  for (const id of ids) {
    const s = parseId(id)
    for (const size of s.sizes ?? SIZES) if (!opts.size || opts.size === `${size[0]}x${size[1]}` || s.sizes) jobs.push([s, size])
  }
  // A work check with no 업무 모드 shot would check nothing and pass
  if (opts.checks.has('work') && !jobs.some(([s]) => s.work)) {
    fail(`--check work needs at least one -work surface (${ALL_IDS.filter(id => id.includes('-work')).join(' ')}); none is in this run`)
  }
  warnIfStale()

  // The browser first: if none starts, no server was started to leave behind
  const { browser, name } = await launchBrowser(chromium)
  let server = null
  const report = []
  try {
    server = await startServer()
    console.log(`spawn ${VERSION} · ${name} · ${BASE} · ${jobs.length} shot(s) → ${opts.out}`)
    for (const [s, size] of jobs) await shoot(browser, s, size, opts, report)
    for (const f of opts.flows) {
      const problems = await FLOWS[f]({ browser, opts, fixture, BASE })
      report.push({ id: `flow ${f}`, size: '', file: 'flow', problems, warnings: [] })
      console.log(`${problems.length ? 'BAD' : 'ok '} flow ${f}`)
      for (const p of problems) console.log(`      ${p}`)
    }
  } finally {
    stopServer()
    await browser.close().catch(() => {})
  }

  // 업무 모드 keeps the rows where they were
  if (opts.checks.has('work')) {
    for (const r of report.filter(x => parseId(x.id)?.work)) {
      const twin = report.find(x => x.id === r.id.replace(/-work(-mac)?$/, '$1') && x.size === r.size)
      if (!r.row || !twin?.row) continue
      if (Math.abs(r.row.left - twin.row.left) > 0.5 || Math.abs(r.row.width - twin.row.width) > 0.5) {
        const p = `work: the first row moved: left ${twin.row.left} → ${r.row.left}, width ${twin.row.width} → ${r.row.width}`
        r.problems.push(p)
        console.log(`BAD ${r.id} ${r.size}\n      ${p}`)
      }
    }
  }

  const bad = report.filter(r => !r.file || r.problems.length)
  console.log(`\n${report.length - bad.length} of ${report.length} passed${bad.length ? `; failed: ${bad.map(r => `${r.id} ${r.size}`.trim()).join(', ')}` : ''}`)
  return bad.length ? 1 : 0
}

main().then(code => process.exit(code), err => { console.error(err); process.exit(1) })
