/*
 * fake-bridge.js — a stand-in for the desktop bridge (electron/preload.cjs →
 * window.spawn, typed as spawnBridge in src/desktop.ts), injected by
 * tests/visual/shots.mjs with page.addInitScript before the app's code runs.
 *
 * It reads window.__SHOT__ = { mode, workMode, terminals, board, branches,
 * transcript, shellTranscript, version } (set by an earlier init script) and
 * answers every bridge call from it. Nothing touches the network or a disk; no
 * pty. Calls that would change something (terminals.move / close / rename /
 * create / send / write / resize) do nothing but are recorded, in order, in
 * window.__CALLS__ as { fn, args } so a harness flow can assert on them.
 */
(() => {
  const shot = window.__SHOT__ || {}
  const calls = (window.__CALLS__ = [])
  const record = (fn, args) => { calls.push({ fn, args: JSON.parse(JSON.stringify(args)) }) }
  const ok = (extra) => Promise.resolve(Object.assign({ ok: true }, extra || {}))
  const noop = () => {}
  const off = () => noop

  // DEFAULT_SETTINGS in src/settingsStore.ts, with 업무 모드 from the shot
  let settings = {
    notify: { catch: true, flee: true, evolve: true, levelup: true, rareOnly: false, duration: 'normal', quiet: false, quietFrom: '23:00', quietTo: '08:00', sound: true, sessions: true },
    privacy: { hidePrompts: false },
    session: { defaultCwd: '', model: '', permissionMode: '', confirmClose: true, restoreOnStart: true, tools: [], defaultTool: 'claude' },
    app: { openAtLogin: false, startHidden: false, widgetOnTop: true, language: 'auto', workMode: !!shot.workMode },
    terminal: { scrollback: 5000, font: 'default' },
  }
  const settingsListeners = new Set()

  const terminals = (shot.terminals || []).map(t => Object.assign({}, t))
  let mode = shot.mode || 'window'
  const modeListeners = new Set()
  const update = { status: 'idle', current: shot.version || '0.0.0', latest: null, notes: '', progress: 0, error: null, needsFull: false, page: '' }

  window.spawn = {
    isDesktop: true,
    terminals: {
      list: () => Promise.resolve(terminals.map(t => Object.assign({}, t))),
      create: (opts) => { record('create', [opts]); return Promise.resolve({ error: 'harness: no pty' }) },
      pickFolder: () => Promise.resolve(null),
      restorable: () => Promise.resolve([]),
      branches: (dirs) => Promise.resolve(Object.fromEntries((dirs || []).map(d => [d, (shot.branches || {})[d] ?? null]))),
      history: () => Promise.resolve([]),
      buffer: (id) => {
        const t = terminals.find(x => x.id === id)
        return Promise.resolve({ data: (t && t.tool === 'shell' ? shot.shellTranscript : shot.transcript) || '', seq: 1 })
      },
      write: (id, data) => record('write', [id, data]),
      resize: (id, cols, rows) => record('resize', [id, cols, rows]),
      send: (id, text) => { record('send', [id, text]); return ok() },
      close: (id) => { record('close', [id]); return Promise.resolve() },
      rename: (id, title) => { record('rename', [id, title]); return Promise.resolve(true) },
      move: (id, index) => { record('move', [id, index]); return Promise.resolve(true) },
      pathForFile: () => '',
      openUrl: () => Promise.resolve(),
      openPath: () => Promise.resolve(false),
      onData: off,
      onList: off,
    },
    cloud: {
      signIn: () => Promise.resolve({ ok: false, reason: 'harness' }),
      signOut: () => ok(),
      sync: () => Promise.resolve({ ok: false, reason: 'harness' }),
    },
    settings: {
      get: () => Promise.resolve(settings),
      set: (patch) => {
        const next = {}
        for (const k of Object.keys(settings)) next[k] = Object.assign({}, settings[k], (patch || {})[k] || {})
        settings = next
        settingsListeners.forEach(fn => fn(settings))
        return Promise.resolve(settings)
      },
      onChange: (fn) => { settingsListeners.add(fn); return () => settingsListeners.delete(fn) },
      onOpen: off,
      workModeAtLoad: !!shot.workMode,
    },
    board: {
      get: () => ok({ rows: (shot.board || []).map(r => Object.assign({}, r)) }),
      profile: () => ok({ profile: null }),
      setProfile: () => Promise.resolve({ ok: false, reason: 'harness' }),
    },
    data: {
      exportBackup: () => Promise.resolve({ ok: false, reason: 'harness' }),
      openFolder: () => Promise.resolve(false),
    },
    env: {
      check: () => Promise.resolve({
        claude: { ok: true, version: '2.1.0', link: '' },
        git: { ok: true, version: '2.47.0', link: '' },
      }),
      openLink: () => Promise.resolve(),
    },
    toast: { show: noop, done: noop, ready: noop, open: noop, onEvent: off },
    game: {
      throw: () => Promise.resolve({ ok: false, reason: 'harness' }),
      release: () => Promise.resolve({ ok: false, reason: 'harness' }),
      exchange: () => Promise.resolve({ ok: false, reason: 'harness' }),
      arrange: () => ok(),
      swap: () => Promise.resolve({ ok: false, reason: 'harness' }),
    },
    update: {
      get: () => Promise.resolve(Object.assign({}, update)),
      install: () => Promise.resolve(Object.assign({}, update)),
      restart: () => Promise.resolve(false),
      onState: off,
    },
    feedback: {
      capture: () => Promise.resolve(null),
      send: () => Promise.resolve({ ok: false, reason: 'harness' }),
      copy: () => Promise.resolve({ ok: false, reason: 'harness' }),
    },
    widget: {
      hide: () => Promise.resolve(),
      getMode: () => Promise.resolve(mode),
      minimize: () => Promise.resolve(),
      setMode: (m) => { mode = m; modeListeners.forEach(fn => fn(m)); return Promise.resolve(m) },
      onMode: (fn) => { modeListeners.add(fn); return () => modeListeners.delete(fn) },
      onOpenDex: off,
      resize: noop,
      alert: noop,
    },
  }
})()
