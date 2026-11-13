'use strict'
/**
 * hook-forward.cjs — THROWAWAY: a `type: "command"` hook that forwards its
 * stdin JSON to the driver over HTTP and prints the driver's reply on stdout.
 * Needed because SessionStart (and Setup) accept only command / mcp_tool
 * hooks, not `type: "http"` (hooks reference, "SessionStart").
 * Usage in settings: {"type":"command","command":"node","args":["<this file>","http://127.0.0.1:47812/hook/SessionStart"]}
 */
const http = require('http')
let input = ''
process.stdin.on('data', d => { input += d })
process.stdin.on('end', () => {
  const req = http.request(process.argv[2], { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
    let out = ''
    res.on('data', d => { out += d })
    res.on('end', () => { if (out) process.stdout.write(out); process.exit(0) })
  })
  req.on('error', () => process.exit(0))
  req.end(input)
})
