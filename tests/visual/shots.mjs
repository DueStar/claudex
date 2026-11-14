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

  node tests/visual/shots.mjs [--out <dir>] [--only a,b] [--size WxH] [--side <px>] [--text <step>] [--check fit|work] [--flow <name>]
  node tests/visual/shots.mjs --sheet <surface>[,<surface>] [--size WxH] --out <dir>

Before: npx vite build   (the harness reads dist/, it never builds)

  --out <dir>      where the PNGs go (default tests/visual/.home/shots). Made if missing.
  --only a,b       only these surface ids (default: all of them, below)
  --size WxH       only this size (1440x900 or 1100x720); with --sheet, the size to compare
  --side <px>      the left panel at this width (seeds spawn-side-w); the files end in -side<px>
  --text <step>    every shot at this text step: small, large or xlarge (seeds spawn-text-size);
                   the files end in -ts-<step> (--only dex --text xlarge → dex-1440x900-ts-xlarge.png)
  --check fit      in every shot page: no sideways page scroll, and no child of
                   .w-term-tabs / .w-list-head / .w-sess-bar / .w-row, or of a row in 도감 / 박스 /
                   기록 / 랭킹 (numbers, filters, toolbars, list rows), ends past its parent
  --check work     in every -work shot: no img[src*="/sprites/pokemon"], no Pokémon word in
                   the visible text, titles or aria-labels, and the first .w-row has the same
                   left and width as in the same surface without 업무 모드 (shot too if needed);
                   folded, every rail item keeps its place and size (the ball's slot stays, empty)
                   (both checks may be given: --check fit --check work, or --check fit,work;
                   --check work refuses a run with no -work surface in it)
  --flow <name>    an interaction flow (exits non-zero when it finds a problem):
                   tabs-gone  close / rename / drag in 상세, 간략 and folded, the list header's
                              >_ + 간략 상세, the rail's >_, switching by rail and Ctrl+Tab, the
                              chosen row in sight among twelve, 업무 모드's header
                   side-resize  the left panel's edge: drag (clamped 240–420, remembered, the
                              terminal refits once), double-click and Home reset, ← / →,
                              a narrow window, hidden when folded and in widget mode
                   text-size  the one text step: where a page starts (migration from the old
                              terminal size), its class, the terminal's px; Ctrl/⌘ += - 0 once per
                              press, the wheel, − 가 + and its menu, 설정's row (with --out: a
                              picture of the open menu, flow-text-size-menu.png)
                   narrow     560 and 640 wide, Windows and Mac, the panel open and folded: the top
                              bar fits (the window buttons whole, the text size folded to 가 when it
                              must, its menu inside the window), the Mac's 78px room, the fit check
                              (with --out: flow-narrow-<win|mac>-<open|folded>-<width>.png)
  --sheet <s>      no shots: writes <out>/sheet-<s>[-WxH].png = before (<out>/../00-before/),
                   the lab reference, after (<out>), side by side or stacked
  --help           this

Surfaces (each at 1440x900 and 1100x720 unless noted):
  session session-compact session-12 session-12-compact size-small size-xlarge dex box log rank settings rail
  resume throw swap notes find   (opened by a click: 이어하기, 던지기, 교체, 패치노트, the terminal's find bar)
  widget widget-plain widget-xlarge (340x820; widget-plain: nobody waiting, no question card, as the lab)   toast qa (full page, 1440 wide)   status-card (300x96)
  -work: session-work session-compact-work rail-work widget-work widget-plain-work settings-work
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
  // The pickers and dialogs, opened by a click as a user would (window mode, the session view)
  resume: { view: 'terminal', open: async page => { await page.locator('.w-side .w-launch-alt').nth(1).click() }, ready: '.resume-item' },
  throw: { view: 'terminal', open: async page => { await page.locator('.w-side .w-launch-main').click() }, ready: '.w-swap-item' },
  swap: {
    view: 'terminal', ready: '.w-swap-item',
    open: async page => { const row = page.locator('.w-party .w-row').first(); await row.hover(); await row.locator('.w-row-swap').click() },
  },
  notes: { view: 'terminal', open: async page => { await page.locator('.w-side .w-brand').click() }, ready: '.w-notes-body h3' },
  find: {
    view: 'terminal', ready: '.term-search',
    open: async page => { await page.locator('.w-term-body .xterm').first().click(); await page.keyboard.press('Control+f'); await page.locator('.term-search input').fill('login') },
  },
  rail: { view: 'terminal', local: { 'spawn-side-hidden': '1' } },
  widget: { mode: 'widget', sizes: [[340, 820]] },
  // The lab's widget has no session waiting: no question card over the lower rows (the plain widget above keeps one)
  'widget-plain': { mode: 'widget', sizes: [[340, 820]], plain: true },
  'widget-xlarge': { mode: 'widget', sizes: [[340, 820]], local: { 'spawn-text-size': 'xlarge', 'spawn-term-font': '17' } },
  toast: { page: 'qa', clip: '.qa-section', sizes: [[1440, 900]] },
  qa: { page: 'qa', fullPage: true, sizes: [[1440, 900]] },
  'status-card': { page: 'status-card', sizes: [[300, 96]] },
}
const WORK = ['session', 'session-compact', 'rail', 'widget', 'widget-plain', 'settings']
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
  widget: 'widget-calm2.png', 'widget-work': 'widget-calm2-work.png', 'widget-plain': 'widget-calm2.png', 'widget-plain-work': 'widget-calm2-work.png', rail: 'rail-calm2.png', 'rail-work': 'rail-calm2-work.png',
}
const LAB_1100 = new Set(['session', 'session-compact', 'session-12', 'session-12-compact', 'session-mac'])
function labRef(surface, size) {
  if (size === '1100x720' && LAB_1100.has(surface)) return 's2-chat-1100.png'
  return LAB_REF[surface] ?? LAB_REF[surface.replace(/-mac$/, '')] ?? null
}

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const o = { out: join(HOME, 'shots'), only: null, size: null, side: null, text: null,checks: new Set(), flows: [], sheets: [], help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`); return v }
    if (a === '--help' || a === '-h') o.help = true
    else if (a === '--out') o.out = resolve(val())
    else if (a === '--only') o.only = val().split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '--size') o.size = val()
    else if (a === '--side') o.side = val()
    else if (a === '--text') o.text = val()
    else if (a === '--check') for (const c of val().split(',')) o.checks.add(c.trim())
    else if (a === '--flow') o.flows.push(val())
    else if (a === '--sheet') o.sheets.push(...val().split(',').map(s => s.trim()).filter(Boolean))
    else fail(`unknown argument ${a} (see --help)`)
  }
  for (const c of o.checks) if (c !== 'fit' && c !== 'work') fail(`unknown check "${c}": fit or work`)
  if (o.size && !/^\d+x\d+$/.test(o.size)) fail(`--size wants WxH, e.g. 1100x720`)
  if (o.side !== null && !/^\d+$/.test(o.side)) fail(`--side wants a width in px, e.g. 240`)
  if (o.text !== null && !['small', 'large', 'xlarge'].includes(o.text)) fail(`--text wants small, large or xlarge`)
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
        if (label === '간략') {
          // The status is a plain dot (확인 필요 too: hovered, the × takes its place, so no button there)
          if (await page.locator('.w-rows.compact button.w-pill').count()) bad('a 간략 row draws its status as a button')
          // The name has no tooltip of its own (it would hide the row's); the row's says how to rename
          if (await page.locator('.w-rows.compact .w-row-name[title]').count()) bad("a 간략 row's name has its own tooltip")
          const tip = await rows.nth(0).getAttribute('title')
          if (!tip?.includes('\n더블클릭해서 세션 이름 바꾸기')) bad(`the 간략 row's tooltip does not say how to rename: ${JSON.stringify(tip)}`)
        }
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
      // The header's rename field open, then another session shown: the field goes and does not come
      // back with the first session (the rename state is cleared, nothing renamed)
      const renamesBefore = (await calls(page)).filter(c => c.fn === 'rename').length
      await head.locator('.w-sess-head-name').dblclick()
      if (!(await head.locator('input.w-sess-head-rename').count())) bad('double-click on the header name opened no field')
      await page.keyboard.press('Control+Tab')
      await sleep(80)
      if (await page.locator('input.w-sess-head-rename, input.w-row-rename').count()) bad('a rename field is open after Ctrl+Tab to another session')
      await page.keyboard.press('Control+Shift+Tab')
      await sleep(80)
      if (await page.locator('input.w-sess-head-rename, input.w-row-rename').count()) bad('the header rename field came back with the first session (stale rename state)')
      if ((await calls(page)).filter(c => c.fn === 'rename').length !== renamesBefore) bad('switching away from an open rename field renamed the session')
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
    // The same picked with the panel folded: unfolding it brings the chosen row into sight
    await run('12개 접힘', { twelve: true, size: [1100, 720], local: { 'spawn-side-hidden': '1' } }, async ({ page, shot }, bad) => {
      await page.keyboard.press('Control+Shift+Tab')
      await sleep(200)
      await page.locator('.w-rail .w-side-toggle').click()
      await sleep(300)
      const seen = await page.evaluate(() => {
        const list = document.querySelector('.w-party').getBoundingClientRect()
        const row = document.querySelector('.w-row.chosen')?.getBoundingClientRect()
        return row ? row.top >= list.top - 0.5 && row.bottom <= list.bottom + 0.5 : null
      })
      if (seen !== true) bad(`unfolded: the chosen row (the last of ${shot.terminals.length}) is ${seen === null ? 'missing' : 'out of sight'}`)
    })
    // 간략 in the widget: a click on a session waiting on you opens its terminal (the 확인 필요 button's job in 상세)
    await run('간략 위젯', { mode: 'widget', size: [340, 820], local: { 'spawn-list-mode': 'compact' } }, async ({ page }, bad) => {
      const row = page.locator('.w-rows.compact .w-row.mood-needs-you').first()
      if (!(await row.count())) { bad('no needs-you row in the fixture'); return }
      await row.locator('.w-row-name').click()
      await sleep(200)
      if (!(await page.locator('.widget.mode-window').count())) bad('a click on the needs-you row did not open the window')
      else if (!(await page.locator('.w-sess-bar .w-sess-head').count())) bad('the window opened, but not on the sessions view')
    })
    // 업무 모드, folded: the header shows a glyph, no picture
    await run('업무 모드', { work: true, local: { 'spawn-side-hidden': '1' } }, async ({ page }, bad) => {
      if (await page.locator('.w-sess-head img').count()) bad('a picture in the session header')
      if (!(await page.locator('.w-sess-head .w-sess-head-glyph').count())) bad('no glyph in the session header')
    })
    return problems
  },

  /**
   * The left panel's right edge (calm-style plan, Task 6): 300px at first, dragged to a width
   * clamped to 240–420 and remembered (spawn-side-w), the terminal fitted again once it rests
   * (fewer columns, and the session told the new size); double-click and Home go back to 300
   * and forget it; ← / → move 16px; a window too narrow keeps the terminal 320px; no edge
   * when the panel is folded or in widget mode. The centre line shows only while dragged or hovered.
   */
  'side-resize': async ({ browser }) => {
    const problems = []
    let app
    try {
      app = await openApp(browser, { smoke: true, commits: true })
      const { page, shot } = app
      const bad = m => problems.push(m)
      const id = shot.terminals[0].id
      const width = () => page.evaluate(() => document.querySelector('.w-side').getBoundingClientRect().width)
      const stored = () => page.evaluate(() => localStorage.getItem('spawn-side-w'))
      const line = () => page.evaluate(() => getComputedStyle(document.querySelector('.w-side-resize'), '::after').backgroundColor)
      const near = (a, b) => Math.abs(a - b) <= 1
      const handle = page.locator('.w-side-resize')
      if ((await handle.count()) !== 1) { bad(`${await handle.count()} resize edge(s)`); return problems }
      if (!near(await width(), 300)) bad(`the panel starts at ${await width()}px, not 300`)
      if ((await line()) !== 'rgba(0, 0, 0, 0)') bad(`the edge's line shows at rest (${await line()})`)
      await sleep(400)
      const cols0 = await termCols(page, id)
      if (!cols0) bad('no terminal metrics (spawnTermMetrics)')
      const commits = () => page.evaluate(() => window.__COMMITS__ ?? null)
      const drag = async (toX, check, { cancel = false } = {}) => {
        const b = await handle.boundingBox()
        const x = b.x + b.width / 2, y = b.y + 300
        await page.mouse.move(x, y)
        await page.mouse.down()
        await sleep(50)
        const c0 = await commits()
        for (let k = 1; k <= 8; k++) await page.mouse.move(x + ((toX - x) * k) / 8, y)
        // The page is not drawn again for each move: the edge sets the width itself and React hears once, on release
        const during = (await commits()) - c0
        if (c0 !== null && during > 2) bad(`dragging re-rendered the app ${during} times for 8 moves`)
        if (check) await check()
        // A cancelled drag (the system took the pointer): the panel goes back to the stored width
        if (cancel) await handle.evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })))
        await page.mouse.up()
        await sleep(400)
      }
      await drag(350, null, { cancel: true })
      if (await page.locator('.widget.resizing').count()) bad('.widget.resizing stayed after a cancelled drag')
      if (!near(await width(), 300) || await stored() !== null) bad(`a cancelled drag: the panel is ${await width()}px, stored ${await stored()} (want 300, none: the screen as stored)`)
      // Focused (keyboard), the edge's line is visible: 3:1 against the panel beside it
      await handle.focus()
      const focusLine = await page.evaluate(() => {
        const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
        const line = getComputedStyle(document.querySelector('.w-side-resize'), '::after').backgroundColor
        const side = getComputedStyle(document.querySelector('.w-side')).backgroundColor
        const a = Number((line.match(/[\d.]+/g) ?? [])[3] ?? 1)
        const [l, s] = [line, side].map(c => c.match(/[\d.]+/g).slice(0, 3).map(Number))
        const mixed = `rgb(${l.map((v, i) => Math.round(v * a + s[i] * (1 - a))).join(',')})`
        const x = lum(mixed), y = lum(side)
        return { line, ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
      })
      if (focusLine.ratio < 3) bad(`the focused edge's line (${focusLine.line}) is ${focusLine.ratio.toFixed(2)}:1 on the panel, under 3:1`)
      await handle.blur()
      const before = (await calls(page)).length
      await drag(380, async () => {
        if (!(await page.locator('.widget.resizing').count())) bad('no .widget.resizing while dragging')
        if ((await line()) === 'rgba(0, 0, 0, 0)') bad("the edge's line is hidden while dragging")
        if (!near(await width(), 380)) bad(`while dragging to 380 the panel is ${await width()}px`)
      })
      if (await page.locator('.widget.resizing').count()) bad('.widget.resizing stayed after the drag')
      if (!near(await width(), 380)) bad(`dragged to 380: the panel is ${await width()}px`)
      if (await stored() !== '380') bad(`dragged to 380: spawn-side-w is ${await stored()}`)
      const cols1 = await termCols(page, id)
      if (!(cols1 < cols0)) bad(`the terminal did not fit again: ${cols0} → ${cols1} columns`)
      const sizes = (await calls(page)).slice(before).filter(c => c.fn === 'resize' && c.args[0] === id)
      if (sizes.length !== 1 || sizes[0].args[1] !== cols1) bad(`the session was not told ${cols1} columns once: ${JSON.stringify(sizes)}`)
      await drag(900)
      if (!near(await width(), 420) || await stored() !== '420') bad(`dragged far right: ${await width()}px, stored ${await stored()} (want 420)`)
      await drag(40)
      if (!near(await width(), 240) || await stored() !== '240') bad(`dragged far left: ${await width()}px, stored ${await stored()} (want 240)`)
      await handle.dblclick()
      await sleep(100)
      if (!near(await width(), 300) || await stored() !== null) bad(`double-click: ${await width()}px, stored ${await stored()} (want 300, none)`)
      await handle.focus()
      await page.keyboard.press('ArrowRight')
      if (!near(await width(), 316) || await stored() !== '316') bad(`→: ${await width()}px, stored ${await stored()} (want 316)`)
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      if (!near(await width(), 284) || await stored() !== '284') bad(`← twice: ${await width()}px, stored ${await stored()} (want 284)`)
      if (await handle.getAttribute('aria-valuenow') !== '284') bad(`aria-valuenow ${await handle.getAttribute('aria-valuenow')}, not 284`)
      await page.keyboard.press('Home')
      if (!near(await width(), 300) || await stored() !== null) bad(`Home: ${await width()}px, stored ${await stored()} (want 300, none)`)
      // A narrow window: the terminal keeps 320px, the panel never under 240
      for (let k = 0; k < 10; k++) await page.keyboard.press('ArrowRight')
      if (await stored() !== '420') bad(`→ ten times: stored ${await stored()} (want 420)`)
      await page.setViewportSize({ width: 700, height: 720 })
      await sleep(400)
      if (!near(await width(), 380)) bad(`420 in a 700px window: the panel is ${await width()}px, not 380`)
      await page.setViewportSize({ width: 560, height: 720 })
      await sleep(400)
      if (!near(await width(), 240)) bad(`in a 560px window: the panel is ${await width()}px, not 240`)
      await page.setViewportSize({ width: 1440, height: 900 })
      await sleep(400)
      if (!near(await width(), 420)) bad(`back to 1440: the panel is ${await width()}px, not the remembered 420`)
      // Folded and widget mode: no edge
      await page.locator('.w-head .w-side-toggle').click()
      if (await handle.count()) bad('an edge while the panel is folded')
      await page.locator('.w-rail .w-side-toggle').click()
      if ((await handle.count()) !== 1) bad('no edge after unfolding')
      await page.locator('.w-widget-toggle').click()
      await sleep(200)
      if (!(await page.locator('.widget.mode-widget').count())) bad('the widget toggle did not switch to widget mode')
      if (await handle.count()) bad('an edge in widget mode')
    } catch (err) {
      problems.push(String(err.message).split('\n')[0])
    } finally {
      if (app) await app.ctx.close()
    }
    return problems
  },

  /**
   * One text step for the UI and the terminal (calm-style plan, Task 7): the step a page
   * starts on (picked, or carried over from the old terminal size, nearest step, ties larger,
   * nothing written), its <html> class, the terminal's px, the UI's name size, the lockup the
   * same at every step, and the terminal's rows inside its box (measured with the bundled face).
   */
  'text-size': async ({ browser, opts }) => {
    const problems = []
    const cases = [
      ['nothing stored', {}, 'normal'],
      ['old 12px', { 'spawn-term-font': '12' }, 'small'],
      ['old 14px (a tie)', { 'spawn-term-font': '14' }, 'large'],
      ['old 17px', { 'spawn-term-font': '17' }, 'xlarge'],
      ['old 20px', { 'spawn-term-font': '20' }, 'xlarge'],
      ['old garbage', { 'spawn-term-font': 'abc' }, 'normal'],
      ['picked 크게 over old 12px', { 'spawn-text-size': 'large', 'spawn-term-font': '12' }, 'large'],
    ]
    const TERM = { small: 12, normal: 13, large: 15, xlarge: 17 }
    const NAME = { small: 11, normal: 12, large: 13, xlarge: 14 }
    let lockup = null
    for (const [label, local, want] of cases) {
      let app
      const bad = m => problems.push(`${label}: ${m}`)
      try {
        app = await openApp(browser, { local, smoke: true })
        const { page, shot } = app
        await sleep(500)
        const got = await textState(page, shot.terminals[0].id)
        if (got.cls !== (want === 'normal' ? '' : `ts-${want}`)) bad(`<html> has "${got.cls}", want ${want}`)
        if (got.term?.fontSize !== TERM[want]) bad(`the terminal is ${got.term?.fontSize}px, want ${TERM[want]}`)
        if (got.name !== `${NAME[want]}px`) bad(`--t-name is ${got.name}, want ${NAME[want]}px`)
        if (got.stored !== (local['spawn-text-size'] ?? null)) bad(`spawn-text-size was written: ${got.stored}`)
        if (got.old !== (local['spawn-term-font'] ?? null)) bad(`spawn-term-font changed: ${got.old}`)
        if (!got.fits) bad(`the terminal's rows overflow its box: ${JSON.stringify(got.box)}`)
        lockup ??= got.lockup
        if (JSON.stringify(got.lockup) !== JSON.stringify(lockup)) bad(`the lockup changed: ${JSON.stringify(got.lockup)} vs ${JSON.stringify(lockup)}`)
        console.log(`      ${label}: ${got.cls || '(보통)'} · terminal ${got.term?.fontSize}px ${got.term?.cols}×${got.term?.rows} · --t-name ${got.name} · lockup ${got.lockup.font} ${got.lockup.w}px`)
      } catch (err) {
        bad(String(err.message).split('\n')[0])
      } finally {
        if (app) await app.ctx.close()
      }
    }
    // Task 8: the keys, the wheel and the − 가 + control move the same step, once per press
    for (const mac of [false, true]) {
      let app
      const label = mac ? 'Mac' : 'Windows'
      const bad = m => problems.push(`${label}: ${m}`)
      const mod = mac ? 'Meta' : 'Control'
      try {
        app = await openApp(browser, { smoke: true, mac })
        const { page, shot } = app
        const id = shot.terminals[0].id
        const cls = async () => (await textState(page, id)).cls || '(보통)'
        const expectStep = async (want, after) => {
          await sleep(350)
          const got = await textState(page, id)
          const c = got.cls || '(보통)'
          if (c !== want) bad(`${after}: <html> is ${c}, want ${want}`)
          const step = want === '(보통)' ? 'normal' : want.slice(3)
          if (got.term?.fontSize !== TERM[step]) bad(`${after}: the terminal is ${got.term?.fontSize}px, want ${TERM[step]}`)
          if (!got.fits) bad(`${after}: the terminal's rows overflow its box ${JSON.stringify(got.box)}`)
        }
        const control = page.locator('.w-term-tabs .w-textsize')
        if ((await control.count()) !== 1) bad(`${await control.count()} text-size control(s) in the bar`)
        const curText = async () => (await control.locator('.w-textsize-cur').textContent()).trim()
        if (await curText() !== '가보통') bad(`the control reads "${await curText()}", not 가 보통`)
        const tip = await control.locator('.w-textsize-cur').getAttribute('title')
        if (!tip.includes(mac ? '⌘+=' : 'Ctrl+=') || (mac && tip.includes('Ctrl'))) bad(`the tooltip names the wrong key: ${tip}`)
        // Keys with the terminal focused: one step per press, the terminal's own handler never doubles it
        await page.locator('.w-term-body .xterm-helper-textarea').first().focus()
        await page.keyboard.press(`${mod}+Equal`)
        await expectStep('ts-large', `${mod}+= once in the terminal`)
        await page.keyboard.press(`${mod}+Equal`)
        await expectStep('ts-xlarge', `${mod}+= twice in the terminal`)
        if (await curText() !== '가아주 크게') bad(`at 아주 크게 the control reads "${await curText()}"`)
        if (!(await control.locator('.w-textsize-step').last().isDisabled())) bad('+ is not disabled at 아주 크게')
        // Another view: the keys still act (held at the top)
        await page.locator('.w-view-tabs button').nth(1).click()
        await page.waitForSelector('.w-dex-body', { timeout: 10_000 })
        await page.keyboard.press(`${mod}+Equal`)
        if (await cls() !== 'ts-xlarge') bad(`${mod}+= on 도감 at the top: ${await cls()}`)
        await page.keyboard.press(`${mod}+Minus`)
        if (await cls() !== 'ts-large') bad(`${mod}+- on 도감: ${await cls()}, want ts-large`)
        await page.keyboard.press(`${mod}+Digit0`)
        if (await cls() !== '(보통)') bad(`${mod}+0 on 도감: ${await cls()}, want no ts- class`)
        await page.locator('.w-view-tabs button').nth(0).click()
        await sleep(200)
        // The wheel with the modifier: over the list (the window's listener) and over the terminal (the terminal's), once each
        await page.locator('.w-party .w-row').first().hover()
        await page.keyboard.down(mod)
        await page.mouse.wheel(0, -100)
        await page.keyboard.up(mod)
        await expectStep('ts-large', `${mod}+wheel up over the list`)
        await page.locator('.w-term-body .term-view').first().hover({ position: { x: 200, y: 200 } })
        await page.keyboard.down(mod)
        await page.mouse.wheel(0, 100)
        await page.keyboard.up(mod)
        await expectStep('(보통)', `${mod}+wheel down over the terminal`)
        // A plain wheel is a scroll, not a step
        await page.locator('.w-party .w-row').first().hover()
        await page.mouse.wheel(0, -100)
        await expectStep('(보통)', 'a plain wheel')
        // The control: − / +, the menu (pick, Esc, outside press)
        await control.locator('.w-textsize-step').first().click()
        await expectStep('ts-small', '− once')
        if (!(await control.locator('.w-textsize-step').first().isDisabled())) bad('− is not disabled at 작게')
        await control.locator('.w-textsize-step').last().click()
        await expectStep('(보통)', '+ once')
        await control.locator('.w-textsize-cur').click()
        const menu = control.locator('.w-textsize-menu')
        if (!(await menu.count())) bad('the middle button did not open the menu')
        else {
          const items = await menu.locator('.w-textsize-item').allTextContents()
          if (items.join('|') !== '작게화면 11 · 터미널 12|보통화면 12 · 터미널 13|크게화면 13 · 터미널 15|아주 크게화면 14 · 터미널 17') bad(`the menu rows: ${items.join(' | ')}`)
          if ((await menu.locator('.w-textsize-item.on').textContent()).indexOf('보통') !== 0) bad('보통 is not the checked row')
          const mb = await menu.boundingBox(), term = await page.locator('.w-term').boundingBox()
          if (mb.x + mb.width > term.x + term.width + 0.5 || mb.width !== 220) bad(`the menu is ${mb.width}px wide, ends at ${mb.x + mb.width} (card ${term.x + term.width})`)
          const top = await page.evaluate(() => { const m = document.querySelector('.w-textsize-menu').getBoundingClientRect(); const el = document.elementFromPoint(m.left + 20, m.bottom - 12); return !!el?.closest('.w-textsize-menu') })
          if (!top) bad('the menu is covered by something (the terminal?)')
          // A picture of the open menu, for the record
          if (opts?.out) await page.screenshot({ path: join(opts.out, `flow-text-size-menu${mac ? '-mac' : ''}.png`), animations: 'disabled', caret: 'hide' })
          await menu.locator('.w-textsize-item', { hasText: '아주 크게' }).click()
          await expectStep('ts-xlarge', 'picking 아주 크게')
          if (await menu.count()) bad('the menu stayed open after a pick')
        }
        await control.locator('.w-textsize-cur').click()
        await page.keyboard.press('Escape')
        if (await menu.count()) bad('Esc did not close the menu')
        await control.locator('.w-textsize-cur').click()
        await page.mouse.click(700, 500)
        if (await menu.count()) bad('a press outside did not close the menu')
        if (await page.evaluate(() => localStorage.getItem('spawn-text-size')) !== 'xlarge') bad('the step was not remembered')
        // The bar never scrolls: at 아주 크게 the views drop to icons when it is narrow
        await page.setViewportSize({ width: 900, height: 700 })
        await sleep(300)
        const bar = await page.evaluate(() => { const b = document.querySelector('.w-term-tabs'); return { sw: b.scrollWidth, cw: b.clientWidth, icons: !!b.querySelector('.w-view-icons') } })
        if (bar.sw > bar.cw + 1) bad(`at 900px the bar overflows: ${bar.sw} > ${bar.cw}`)
        console.log(`      ${label}: keys, wheel, − 가 + and the menu checked; at 900px the bar is ${bar.cw}px, views ${bar.icons ? 'icons only' : 'named'}`)
        // Narrower still: the views must drop to icons (the bar's level reads scrollWidth, the bar is overflow: visible).
        // (Near the window's 560px minimum the text size folds and the widget toggle goes: --flow narrow)
        await page.setViewportSize({ width: 640, height: 700 })
        await sleep(400)
        const narrow = await page.evaluate(() => { const b = document.querySelector('.w-term-tabs'); return { sw: b.scrollWidth, cw: b.clientWidth, icons: !!b.querySelector('.w-view-icons'), kids: [...b.children].map(c => `${c.className.split(' ')[0]}:${Math.round(c.getBoundingClientRect().width)}`).join(' ') } })
        if (!narrow.icons) bad(`at 640px the views kept their names: bar ${narrow.sw} / ${narrow.cw} (${narrow.kids})`)
        console.log(`      ${label}: at 640px the bar is ${narrow.cw}px, views ${narrow.icons ? 'icons only' : 'named'}; content ${narrow.sw}px (${narrow.kids})`)
        // 설정 › 앱: the 글자 크기 row follows and sets the same step
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.locator('.w-head .w-icon[aria-label="설정"]').click()
        await page.locator('.set-nav button', { hasText: /^앱$/ }).click()
        const row = page.locator('.set-row', { hasText: '글자 크기' })
        if ((await row.locator('button.on').textContent()) !== '아주 크게') bad(`설정 shows ${await row.locator('button.on').textContent()}, not 아주 크게`)
        await row.locator('button', { hasText: /^작게$/ }).click()
        if (await cls() !== 'ts-small') bad(`설정's 작게: ${await cls()}`)
      } catch (err) {
        bad(String(err.message).split('\n')[0])
      } finally {
        if (app) await app.ctx.close()
      }
    }
    return problems
  },

  /**
   * A narrow window (calm-style plan, Task 14): at 560 (the window's minimum) and 640 wide, on
   * Windows and on a Mac, the left panel open and folded, the top bar fits its card — nothing
   * past the bar's end, the window buttons whole and on top (Windows), the text size still
   * reachable (folded to one 가 button when it must, its menu inside the window), the traffic
   * lights' 78px left room kept (Mac), and the page's own fit check.
   */
  narrow: async ({ browser, opts }) => {
    const problems = []
    for (const mac of [false, true]) for (const folded of [false, true]) for (const width of [560, 640]) {
      const label = `${mac ? 'Mac' : 'Windows'} ${folded ? 'folded' : 'open'} ${width}`
      const bad = m => problems.push(`${label}: ${m}`)
      let app
      try {
        app = await openApp(browser, { mac, size: [width, 720], local: { 'spawn-side-hidden': folded ? '1' : '0' } })
        const { page } = app
        await sleep(400)
        const got = await page.evaluate(() => {
          const bar = document.querySelector('.w-term-tabs')
          const card = document.querySelector('.w-term').getBoundingClientRect()
          const br = bar.getBoundingClientRect()
          const past = []
          // inside the bar's right padding too (8px: the close button never touches the window's edge)
          const end = Math.min(card.right, br.right - parseFloat(getComputedStyle(bar).paddingRight), innerWidth)
          for (const el of bar.querySelectorAll('button, .w-textsize, .w-win-controls, .w-view-switch')) {
            const cs = getComputedStyle(el)
            const r = el.getBoundingClientRect()
            if (cs.display === 'none' || !r.width) continue
            if (r.right > end + 0.5) past.push(`${el.className || el.tagName} ends at ${r.right.toFixed(1)} (bar content ends ${end.toFixed(1)}, card ${card.right.toFixed(1)})`)
          }
          const close = document.querySelector('.w-win-close')
          const cr = close && getComputedStyle(close.parentElement).display !== 'none' ? close.getBoundingClientRect() : null
          const onTop = cr ? document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2)?.closest('.w-win-close') === close : null
          const ts = document.querySelector('.w-term-tabs .w-textsize')
          const first = folded => {
            const host = folded ? bar : document.querySelector('.w-side .w-head')
            const kid = [...host.children].find(c => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width)
            return kid ? kid.getBoundingClientRect().left : null
          }
          return {
            sw: bar.scrollWidth, cw: bar.clientWidth, past,
            close: cr ? { left: cr.left, right: cr.right, w: cr.width, h: cr.height } : null, onTop,
            textsize: ts ? (ts.classList.contains('compact') ? 'compact' : 'full') : 'none',
            toggle: !!document.querySelector('.w-term-tabs .w-widget-toggle'),
            views: document.querySelector('.w-view-icons') ? 'icons' : 'named',
            firstOpen: first(false), firstFolded: first(true),
            sideW: document.querySelector('.w-side').getBoundingClientRect().width,
          }
        }, folded)
        if (got.sw > got.cw + 1) bad(`the bar's content is ${got.sw}px in a ${got.cw}px bar`)
        for (const p of got.past) bad(p)
        if (!mac) {
          if (!got.close) bad('no window close button')
          else {
            if (got.close.w < 30 - 0.5 || got.close.h < 28 - 0.5) bad(`the close button is ${got.close.w}×${got.close.h}, not 30×28`)
            if (!got.onTop) bad('the close button is covered at its centre')
          }
        } else if (got.close) bad('a Mac shows the page\'s own window buttons')
        if (got.textsize === 'none') bad('no text-size control')
        // Mac: nothing under the traffic lights (x 14–68): the panel's header starts 78px in; folded, the bar 78px in
        if (mac && !folded && got.firstOpen !== null && got.firstOpen < 78 - 0.5) bad(`the panel header's first item starts at ${got.firstOpen}, under the traffic lights`)
        if (mac && folded && got.firstFolded !== null && got.firstFolded < 78 - 0.5) bad(`the bar's first item starts at ${got.firstFolded}, under the traffic lights`)
        // The text size still works: the menu opens inside the window and sets a step
        await page.locator('.w-term-tabs .w-textsize-cur').click()
        const mb = await page.locator('.w-textsize-menu').boundingBox()
        if (!mb) bad('the text-size menu did not open')
        else {
          if (mb.x < -0.5 || mb.x + mb.width > width + 0.5) bad(`the text-size menu runs out of the window: ${mb.x.toFixed(1)}–${(mb.x + mb.width).toFixed(1)}`)
          await page.locator('.w-textsize-item', { hasText: '크게' }).first().click()
          const cls = await page.evaluate(() => document.documentElement.className)
          if (!/ts-large/.test(cls)) bad(`picking 크게 in the menu left <html class="${cls}">`)
        }
        for (const p of await fitProblems(page)) bad(`fit: ${p}`)
        if (opts?.out) await page.screenshot({ path: join(opts.out, `flow-narrow-${mac ? 'mac' : 'win'}-${folded ? 'folded' : 'open'}-${width}.png`), animations: 'disabled', caret: 'hide' })
        console.log(`      ${label}: panel ${Math.round(got.sideW)}px, bar ${got.cw}px (content ${got.sw}), views ${got.views}, text size ${got.textsize}, widget toggle ${got.toggle ? 'shown' : 'hidden'}${got.close ? `, close at ${got.close.left.toFixed(0)}–${got.close.right.toFixed(0)}` : ''}`)
      } catch (err) {
        bad(String(err.message).split('\n')[0])
      } finally {
        if (app) await app.ctx.close()
      }
    }
    return problems
  },
}

/**
 * The text step as the page shows it: the <html> class, the stored keys, --t-name, the
 * lockup's size, the terminal's metrics and whether its rows fit its box
 */
async function textState(page, id) {
  return page.evaluate(i => {
    const html = document.documentElement
    const term = (window.spawnTermMetrics?.() ?? []).find(m => m.id === i) ?? null
    const view = document.querySelector('.w-term-body .term-view:not([style*="display: none"])') ?? document.querySelector('.w-term-body .term-view')
    const screen = view?.querySelector('.xterm-screen')
    const box = view ? { view: view.clientHeight, screen: screen?.getBoundingClientRect().height ?? null, rows: term?.rows, cell: term?.cellHeight } : null
    const brand = document.querySelector('.w-brand-name')
    const b = brand?.getBoundingClientRect()
    return {
      cls: [...html.classList].filter(c => c.startsWith('ts-')).join(' '),
      stored: localStorage.getItem('spawn-text-size'),
      old: localStorage.getItem('spawn-term-font'),
      name: getComputedStyle(html).getPropertyValue('--t-name').trim(),
      term,
      box,
      fits: !!(term && box && term.rows * term.cellHeight <= box.view + 0.5),
      lockup: brand ? { font: getComputedStyle(brand).fontSize, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 } : null,
    }
  }, id)
}

/** The bridge calls the page made so far (fake-bridge.js) */
const calls = page => page.evaluate(() => window.__CALLS__)

/** A terminal's metrics (src/termMetrics.ts; the page opened with &smoke): its font size and columns */
const termInfo = (page, id) => page.evaluate(i => (window.spawnTermMetrics?.() ?? []).find(m => m.id === i) ?? null, id)
const termCols = async (page, id) => (await termInfo(page, id))?.cols ?? null

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

/** Page errors seen by the flows' pages (openApp) */
const flowPageErrors = []

/** The app with the fixture in a page of its own, for a flow (window mode) */
async function openApp(browser, { local = {}, twelve = false, size = [1440, 900], work = false, mac = false, smoke = false, mode = 'window', commits = false } = {}) {
  const shot = {
    mode, workMode: work, version: VERSION,
    terminals: twelve ? fixture.terminals12 : fixture.terminals,
    board: fixture.board, branches: fixture.branches, history: fixture.history,
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
    // A page error during a flow fails the flow (main reads this list after each one)
    page.on('pageerror', err => flowPageErrors.push(`page error: ${String(err.message).split('\n')[0]}`))
    await page.addInitScript(pageSetup, { shot, local: all, mac, origin: BASE })
    // commits: React's commits counted in window.__COMMITS__ (a stand-in for the DevTools hook,
    // which React calls on every commit, production build included)
    if (commits) {
      await page.addInitScript(() => {
        window.__COMMITS__ = 0
        window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
          isDisabled: false, supportsFiber: true, renderers: new Map(),
          inject() { return 1 }, checkDCE() {},
          onCommitFiberRoot() { window.__COMMITS__++ }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {},
        }
      })
    }
    await page.addInitScript({ path: join(HERE, 'fake-bridge.js') })
    await page.routeWebSocket(/\/ws$/, ws => {
      const send = () => ws.send(JSON.stringify(snapshot))
      send()
      ws.onMessage(send)
    })
    // &smoke: the page offers window.spawnTermMetrics() (src/termMetrics.ts): each terminal's font size and columns
    await page.goto(`${BASE}/?widget&mode=${mode}${smoke ? '&smoke' : ''}`)
    await page.waitForFunction(n => document.querySelectorAll('.w-party .w-row').length === n, shot.terminals.length, { timeout: 15_000 })
    if (mode !== 'widget') await page.waitForSelector('.w-sess-head', { timeout: 15_000 })
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
    const ROWS = '.w-head, .w-term-tabs, .w-list-head, .w-sess-bar, .w-row, ' +
      // the views: 도감's numbers and filters, 박스's bars, 기록's summary and rows, 랭킹's rows
      '.dex-stats, .dex-stat, .dex-tiers, .dex-tiercol, .dex-filterbar, .dex-fgroup, .dex-card-tags, .dex-owned-top, ' +
      '.box-party, .box-party-row, .box-toolbar, .box-tools, .box-actions, .today-sum, .today-row, .today-text, ' +
      '.rank-top, .rank-me, .rank-row'
    for (const parent of document.querySelectorAll(ROWS)) {
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
    // One line each: a label that wraps (the header's 로그인, 기록's time) or a dot squeezed out of its row
    const lineOf = el => { const cs = getComputedStyle(el); return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3 }
    for (const el of document.querySelectorAll('.w-head .w-signin, .w-head .w-update, .today-time, .w-list-count, .w-sess-head-proj')) {
      const r = el.getBoundingClientRect()
      if (r.width && r.height > lineOf(el) * 1.6 + 6) bad.push(`${name(el)} wraps: ${r.height.toFixed(1)}px tall (${el.textContent.trim().slice(0, 20)})`)
    }
    for (const el of document.querySelectorAll('.w-head .w-conn, .w-row-tick, .w-pill-dot, .w-rail-dot')) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (cs.display !== 'none' && el.offsetParent && r.width < parseFloat(cs.height) - 0.5) bad.push(`${name(el)} squeezed to ${r.width.toFixed(1)}px wide`)
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

/**
 * Where things sit, to compare a -work shot with its plain twin: the first row's left and width,
 * and with the panel folded every rail item's box (the first slot is the ball, or the empty slot
 * kept for it in 업무 모드), the open sessions one by one
 */
async function firstRowBox(page) {
  return page.evaluate(() => {
    const row = document.querySelector('.w-row')
    const r = row?.getBoundingClientRect()
    const rail = document.querySelector('.w-rail')
    const items = rail ? [...rail.children].flatMap(el => el.classList.contains('w-rail-sessions') ? [el, ...el.children] : [el]) : []
    return {
      left: r?.left ?? null, width: r?.width ?? null,
      rail: rail ? items.map(el => { const b = el.getBoundingClientRect(); return { name: el.className.split(' ').filter(c => c !== 'w-rail-btn' && !c.startsWith('mood-')).join('.') || el.tagName, top: b.top, left: b.left, w: b.width, h: b.height } }) : null,
    }
  })
}

/** Rail items that moved or changed size between the plain shot and its -work twin (the first slot's content may differ, not its box) */
function railMoves(plain, work) {
  if (!plain || !work) return []
  if (plain.length !== work.length) return [`the rail has ${work.length} items in 업무 모드, ${plain.length} without`]
  const out = []
  plain.forEach((a, i) => {
    const b = work[i]
    if (['top', 'left', 'w', 'h'].some(k => Math.abs(a[k] - b[k]) > 0.5)) out.push(`rail item ${i} (${a.name} → ${b.name}) moved: ${a.left},${a.top} ${a.w}×${a.h} → ${b.left},${b.top} ${b.w}×${b.h}`)
  })
  return out
}

async function shoot(browser, s, [W, H], opts, report) {
  const sizeName = `${W}x${H}`
  const label = `${s.id} ${sizeName}`
  const twelve = !!s.twelve
  const shot = {
    mode: s.mode ?? 'window', workMode: s.work, version: VERSION,
    terminals: twelve ? fixture.terminals12 : fixture.terminals,
    board: fixture.board, branches: fixture.branches, history: fixture.history,
    transcript: fixture.transcript, shellTranscript: fixture.shellTranscript,
  }
  const snapshot = twelve ? fixture.snapshot12 : s.plain ? fixture.snapshotPlain : fixture.snapshot
  const local = {
    'spawn-carry': JSON.stringify({ view: s.view ?? 'terminal', target: shot.terminals[0].sessionId }),
    'spawn-side-hidden': '0',
    // No "what's new" over the page, and every caught species opened but one (the NEW dot)
    'spawn-seen-version': VERSION,
    'spawn-dex-viewed': JSON.stringify(fixture.VIEWED),
    ...(s.local ?? {}),
    ...(opts.side ? { 'spawn-side-w': opts.side } : {}),
    ...(opts.text ? { 'spawn-text-size': opts.text } : {}),
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
      if (s.open) {
        await s.open(page)
        await page.waitForSelector(s.ready, { timeout: 10_000 })
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
    const file = join(opts.out, `${s.id}-${s.clip || s.fullPage ? `${w}x${h}` : sizeName}${opts.side ? `-side${opts.side}` : ''}${opts.text ? `-ts-${opts.text}` : ''}.png`)
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
      flowPageErrors.length = 0
      const problems = await FLOWS[f]({ browser, opts, fixture, BASE })
      problems.push(...new Set(flowPageErrors))
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
      const moved = railMoves(twin.row.rail, r.row.rail).map(m => `work: ${m}`)
      if (Math.abs(r.row.left - twin.row.left) > 0.5 || Math.abs(r.row.width - twin.row.width) > 0.5) {
        moved.unshift(`work: the first row moved: left ${twin.row.left} → ${r.row.left}, width ${twin.row.width} → ${r.row.width}`)
      }
      if (moved.length) {
        r.problems.push(...moved)
        console.log(`BAD ${r.id} ${r.size}\n      ${moved.join('\n      ')}`)
      }
    }
  }

  const bad = report.filter(r => !r.file || r.problems.length)
  console.log(`\n${report.length - bad.length} of ${report.length} passed${bad.length ? `; failed: ${bad.map(r => `${r.id} ${r.size}`.trim()).join(', ')}` : ''}`)
  return bad.length ? 1 : 0
}

main().then(code => process.exit(code), err => { console.error(err); process.exit(1) })
