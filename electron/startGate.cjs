'use strict'

/**
 * electron/startGate.cjs — what the app's start waits for before it opens anything.
 *
 * On a Mac the start reads the login shell's environment first (shellEnv.cjs, up to
 * 3 s): the server and the terminals take PATH and LANG from it. A Dock click
 * (`activate`) or a second launch in those seconds also asks for the start, and must
 * wait for the same read: run(fn) waits until open() is called. On Windows there is
 * nothing to wait for and run(fn) calls fn at once, in the same tick, as before.
 */

function createStartGate(platform = process.platform) {
  if (platform !== 'darwin') return { run: (fn) => fn(), open: () => {}, waits: false }
  let release
  const ready = new Promise((resolve) => { release = resolve })
  return { run: (fn) => ready.then(() => fn()), open: () => release(), waits: true }
}

module.exports = { createStartGate }
