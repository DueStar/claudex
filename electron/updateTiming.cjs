'use strict'

/**
 * updateTiming.cjs — how long each step of an update restart takes.
 *
 * An update restart runs in three processes (the old app quitting, a short
 * run copying the files, the new app starting); each writes its steps to
 * userData/update.log with its pid, so one restart can be read end to end:
 *   <time> pid=<pid> <label> <step> +<since the step before>ms total=<since the first>ms [extra]
 */

const fs = require('fs')

function createStepTimer({ file, label, now = Date.now, pid = process.pid }) {
  let first = null
  let last = null
  return {
    mark(step, extra = '') {
      try {
        const t = now()
        if (first === null) { first = t; last = t }
        const line = `${new Date(t).toISOString()} pid=${pid} ${label} ${step} +${t - last}ms total=${t - first}ms${extra ? ` ${extra}` : ''}\n`
        last = t
        fs.appendFileSync(file, line)
      } catch { /* timing must never get in the way of the update */ }
    },
  }
}

module.exports = { createStepTimer }
