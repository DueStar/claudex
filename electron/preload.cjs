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
    history: () => ipcRenderer.invoke('sessions:history'),
    buffer: (id) => ipcRenderer.invoke('terminals:buffer', id),
    write: (id, data) => ipcRenderer.send('terminals:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('terminals:resize', { id, cols, rows }),
    send: (id, text) => ipcRenderer.invoke('terminals:send', { id, text }),
    close: (id) => ipcRenderer.invoke('terminals:close', id),
    rename: (id, title) => ipcRenderer.invoke('terminals:rename', { id, title }),
    // A file dropped on a terminal: its path on disk (File.path is gone since Electron 32)
    pathForFile: (file) => { try { return webUtils.getPathForFile(file) || '' } catch { return '' } },
    // Ctrl+click on a link in a terminal: the user's browser opens it (http/https only)
    openUrl: (url) => ipcRenderer.invoke('terminals:open-url', String(url)),
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
  toast: {
    show: (event) => ipcRenderer.send('toast:show', event),
    done: () => ipcRenderer.send('toast:done'),
    open: (id) => ipcRenderer.send('toast:open', Number(id)),
    onEvent: (fn) => on('toast:event', fn),
  },
  game: {
    throw: (sessionId, uid) => ipcRenderer.invoke('game:throw', { sessionId, uid }),
    release: (uid) => ipcRenderer.invoke('game:release', uid),
    exchange: (boxUid, partyUid) => ipcRenderer.invoke('game:exchange', { boxUid, partyUid }),
    swap: (sessionId, uid) => ipcRenderer.invoke('game:swap', { sessionId, uid }),
  },
  update: {
    get: () => ipcRenderer.invoke('update:get'),
    install: () => ipcRenderer.invoke('update:install'),
    restart: () => ipcRenderer.invoke('update:restart'),
    onState: (fn) => on('update:state', fn),
  },
  widget: {
    hide: () => ipcRenderer.invoke('widget:hide'),
    getMode: () => ipcRenderer.invoke('widget:get-mode'),
    minimize: () => ipcRenderer.invoke('widget:minimize'),
    setMode: (mode) => ipcRenderer.invoke('widget:set-mode', String(mode)),
    onMode: (fn) => on('widget:mode', fn),
    onOpenDex: (fn) => on('widget:open-dex', fn),
    resize: (width, height) => ipcRenderer.send('widget:resize', { width, height }),
  },
})
