'use strict'

// The page's only door to the app: a narrow API over IPC (contextIsolation +
// sandbox stay on, the page never gets Node). Exposed as window.pokeOffice.

const { contextBridge, ipcRenderer } = require('electron')

function on(channel, fn) {
  const listener = (_event, payload) => fn(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('pokeOffice', {
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
    setDex: (id, dex) => ipcRenderer.invoke('terminals:set-dex', { id, dex }),
    close: (id) => ipcRenderer.invoke('terminals:close', id),
    onData: (fn) => on('terminals:data', fn),
    onList: (fn) => on('terminals:list', fn),
    onFocus: (fn) => on('terminals:focus', fn),
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
    onEvent: (fn) => on('toast:event', fn),
  },
  game: {
    throw: (sessionId, uid) => ipcRenderer.invoke('game:throw', { sessionId, uid }),
    release: (uid) => ipcRenderer.invoke('game:release', uid),
    exchange: (boxUid, partyUid) => ipcRenderer.invoke('game:exchange', { boxUid, partyUid }),
    swap: (sessionId, uid) => ipcRenderer.invoke('game:swap', { sessionId, uid }),
  },
  widget: {
    toggle: () => ipcRenderer.invoke('widget:toggle'),
    hide: () => ipcRenderer.invoke('widget:hide'),
    getExpanded: () => ipcRenderer.invoke('widget:get-expanded'),
    setExpanded: (flag) => ipcRenderer.invoke('widget:set-expanded', !!flag),
    getMode: () => ipcRenderer.invoke('widget:get-mode'),
    setMode: (mode) => ipcRenderer.invoke('widget:set-mode', String(mode)),
    onMode: (fn) => on('widget:mode', fn),
    onExpanded: (fn) => on('widget:expanded', fn),
    resize: (width, height) => ipcRenderer.send('widget:resize', { width, height }),
    showOffice: (terminalId) => ipcRenderer.invoke('widget:show-office', terminalId ?? null),
  },
})
