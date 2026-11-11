'use strict'

// The page's only door to the app: a narrow API over IPC (contextIsolation +
// sandbox stay on, the page never gets Node). Exposed as window.claudex.

const { contextBridge, ipcRenderer, webUtils } = require('electron')

function on(channel, fn) {
  const listener = (_event, payload) => fn(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('claudex', {
  isDesktop: true,
  terminals: {
    list: () => ipcRenderer.invoke('terminals:list'),
    create: (opts) => ipcRenderer.invoke('terminals:create', opts ?? {}),
    pickFolder: () => ipcRenderer.invoke('terminals:pick-folder'),
    restorable: () => ipcRenderer.invoke('terminals:restorable'),
    branches: (dirs) => ipcRenderer.invoke('terminals:branches', dirs),
    history: () => ipcRenderer.invoke('sessions:history'),
    buffer: (id) => ipcRenderer.invoke('terminals:buffer', id),
    write: (id, data) => ipcRenderer.send('terminals:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('terminals:resize', { id, cols, rows }),
    send: (id, text) => ipcRenderer.invoke('terminals:send', { id, text }),
    close: (id) => ipcRenderer.invoke('terminals:close', id),
    rename: (id, title) => ipcRenderer.invoke('terminals:rename', { id, title }),
    move: (id, index) => ipcRenderer.invoke('terminals:move', { id, index }),
    // A file dropped on a terminal: its path on disk (File.path is gone since Electron 32)
    pathForFile: (file) => { try { return webUtils.getPathForFile(file) || '' } catch { return '' } },
    // Ctrl+click on a link in a terminal: the user's browser opens it (http/https only)
    openUrl: (url) => ipcRenderer.invoke('terminals:open-url', String(url)),
    openPath: (id, file, line, col) => ipcRenderer.invoke('terminals:open-path', { id, file, line, col }),
    onData: (fn) => on('terminals:data', fn),
    onList: (fn) => on('terminals:list', fn),
  },
  cloud: {
    signIn: () => ipcRenderer.invoke('cloud:signin'),
    signOut: () => ipcRenderer.invoke('cloud:signout'),
    sync: () => ipcRenderer.invoke('cloud:sync'),
  },
  env: {
    check: () => ipcRenderer.invoke('env:check'),
    openLink: (key) => ipcRenderer.invoke('env:open-link', key),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: (fn) => on('settings:changed', fn),
    onOpen: (fn) => on('settings:open', fn),
  },
  board: {
    get: (board) => ipcRenderer.invoke('board:get', String(board)),
    profile: () => ipcRenderer.invoke('board:profile'),
    setProfile: (p) => ipcRenderer.invoke('board:set-profile', p),
  },
  data: {
    exportBackup: () => ipcRenderer.invoke('data:export'),
    openFolder: () => ipcRenderer.invoke('data:open-folder'),
  },
  toast: {
    show: (event) => ipcRenderer.send('toast:show', event),
    done: () => ipcRenderer.send('toast:done'),
    ready: () => ipcRenderer.send('toast:ready'),
    open: (id) => ipcRenderer.send('toast:open', Number(id)),
    onEvent: (fn) => on('toast:event', fn),
  },
  game: {
    throw: (sessionId, uid) => ipcRenderer.invoke('game:throw', { sessionId, uid }),
    release: (uid) => ipcRenderer.invoke('game:release', uid),
    exchange: (boxUid, partyUid) => ipcRenderer.invoke('game:exchange', { boxUid, partyUid }),
    arrange: (order) => ipcRenderer.invoke('game:arrange', order),
    swap: (sessionId, uid) => ipcRenderer.invoke('game:swap', { sessionId, uid }),
  },
  update: {
    get: () => ipcRenderer.invoke('update:get'),
    install: () => ipcRenderer.invoke('update:install'),
    restart: () => ipcRenderer.invoke('update:restart'),
    onState: (fn) => on('update:state', fn),
  },
  feedback: {
    capture: (rect) => ipcRenderer.invoke('feedback:capture', rect),
    send: (note) => ipcRenderer.invoke('feedback:send', note),
    copy: (note) => ipcRenderer.invoke('feedback:copy', note),
  },
  widget: {
    hide: () => ipcRenderer.invoke('widget:hide'),
    getMode: () => ipcRenderer.invoke('widget:get-mode'),
    minimize: () => ipcRenderer.invoke('widget:minimize'),
    setMode: (mode) => ipcRenderer.invoke('widget:set-mode', String(mode)),
    onMode: (fn) => on('widget:mode', fn),
    onOpenDex: (fn) => on('widget:open-dex', fn),
    resize: (width, height) => ipcRenderer.send('widget:resize', { width, height }),
    alert: (title, body) => ipcRenderer.send('widget:alert', { title, body }),
  },
})
