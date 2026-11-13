/**
 * smoke-mac.mjs — launch the built spawn.app once with --smoke-test (electron/smoke.cjs)
 * and report: the Mac CI's check that the app starts, runs a shell through node-pty,
 * and draws its three modes. macOS only.
 *
 *   node scripts/smoke-mac.mjs <arch>      (arm64 or x64; default: this Mac's)
 *
 * Before the launch: every node-pty spawn-helper in the bundle must be executable
 * (each session starts through it). The app runs with its own temporary userData
 * and SPAWN_HOME, nothing of a real install touched, and writes its pictures and
 * smoke.json to SPAWN_SMOKE_DIR (default release/upload/smoke). Killed after 90 s
 * (the app gives itself 60, then 20 to quit; SPAWN_SMOKE_TIMEOUT_MS moves both:
 * mac-build.mjs smokeKillMs). Exits with the app's code; smoke.json is printed.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickMacApp, smokeKillMs, spawnHelperProblems } from './mac-build.mjs'

// The app's timeout (SPAWN_SMOKE_TIMEOUT_MS, 60 s by default) + its quit cap + a margin
const KILL_AFTER_MS = smokeKillMs(process.env)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const arch = process.argv[2] || process.arch

const app = pickMacApp(join(root, 'release'), arch)
if (!app) {
  console.error(`smoke: no spawn.app for ${arch} under release/mac*`)
  process.exit(1)
}
const binary = join(app, 'Contents', 'MacOS', 'spawn')
if (!existsSync(binary)) {
  console.error(`smoke: no app binary at ${binary}`)
  process.exit(1)
}
const problems = spawnHelperProblems(app)
if (problems.length) {
  console.error(`smoke: node-pty cannot start a shell in this build:\n${problems.map(p => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`smoke: spawn-helper executable in ${app}`)

const out = resolve(process.env.SPAWN_SMOKE_DIR || join(root, 'release', 'upload', 'smoke'))
mkdirSync(out, { recursive: true })
const temp = mkdtempSync(join(tmpdir(), 'spawn-smoke-'))
const env = {
  ...process.env,
  SPAWN_SMOKE_DIR: out,
  SPAWN_SMOKE_USERDATA: join(temp, 'userData'),
  SPAWN_HOME: join(temp, 'home'),
}

console.log(`smoke: ${binary} --smoke-test (output ${out})`)
const t0 = Date.now()
// Its own process group, so a kill takes the server and the shells with it
const child = spawn(binary, ['--smoke-test'], { env, stdio: 'inherit', detached: true })
let killed = false
const killer = setTimeout(() => {
  killed = true
  console.error(`smoke: still running after ${KILL_AFTER_MS / 1000} s: killed`)
  try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
}, KILL_AFTER_MS)

child.on('error', (err) => {
  clearTimeout(killer)
  console.error(`smoke: could not start the app: ${err.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  clearTimeout(killer)
  // What the app left running in its group (the server, a shell) goes too
  try { process.kill(-child.pid, 'SIGKILL') } catch {}
  console.log(`\nsmoke: the app exited with ${signal ? `signal ${signal}` : `code ${code}`} after ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  const json = join(out, 'smoke.json')
  if (existsSync(json)) console.log(`\n${json}:\n${readFileSync(json, 'utf8')}`)
  else console.error(`smoke: no smoke.json in ${out}`)
  process.exit(killed ? 124 : (code ?? 1))
})
