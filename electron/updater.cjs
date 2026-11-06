/**
 * updater.cjs — "업데이트" in the widget: checks GitHub Releases for a newer
 * Claudex, downloads only the app part (resources/app, a few MB to tens of
 * MB; the Electron runtime rarely changes), verifies it, and swaps it in
 * after the app quits.
 *
 * A release carries two files (scripts/release.mjs makes them):
 *   latest.json              { version, electron, notes, app: { file, sha256, size }, full }
 *   claudex-app-<v>.zip      the resources/app folder
 * They are read from https://github.com/<repo>/releases/latest/download/, a
 * plain download (no API rate limit, no token: the repository is public).
 *
 * When the new release needs another Electron version the app part is not
 * enough; the widget then links to the full download instead.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const https = require('https')
const { spawn } = require('child_process')

const REPO = 'DueStar/claudex'
const LATEST = `https://github.com/${REPO}/releases/latest/download/latest.json`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

/** a > b for dotted versions ("0.10.0" > "0.9.3") */
function newer(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y
  }
  return false
}

/** GET with redirects (GitHub release downloads redirect to their CDN) */
function get(url, { onProgress, maxBytes = 300 * 1024 * 1024 } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Claudex-updater' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume()
        resolve(get(new URL(res.headers.location, url).toString(), { onProgress, maxBytes }, hops + 1))
        return
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return }
      const total = Number(res.headers['content-length']) || 0
      const chunks = []
      let got = 0
      res.on('data', (c) => {
        got += c.length
        if (got > maxBytes) { req.destroy(new Error('too large')); return }
        chunks.push(c)
        if (onProgress && total) onProgress(got / total)
      })
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

function createUpdater({ app, send, isPackaged }) {
  let state = { status: 'idle', current: app.getVersion(), latest: null, notes: '', progress: 0, error: null, needsFull: false, page: RELEASES_PAGE }
  let manifest = null
  const publish = (patch) => { state = { ...state, ...patch }; send('update:state', state) }

  async function check() {
    if (state.status === 'downloading' || state.status === 'ready') return state
    try {
      const m = JSON.parse((await get(LATEST, { maxBytes: 64 * 1024 })).toString('utf8'))
      if (!m || typeof m.version !== 'string') throw new Error('bad manifest')
      if (!newer(m.version, state.current)) { publish({ status: 'current', latest: m.version, error: null }); return state }
      manifest = m
      publish({
        status: 'available', latest: m.version, notes: String(m.notes ?? '').slice(0, 2000), error: null,
        needsFull: !!m.electron && m.electron !== process.versions.electron,
      })
    } catch (err) {
      // Offline, or no public release yet: quietly stay as we are
      publish({ status: 'idle', error: err.message })
    }
    return state
  }

  /** Download, verify and unpack the app part; then quit and let the swap script finish */
  async function install() {
    if (!manifest || state.status !== 'available') return state
    if (state.needsFull) return state
    if (!isPackaged) { publish({ error: '개발 실행에서는 업데이트하지 않아요' }); return state }
    const appFile = String(manifest.app?.file ?? '')
    if (!/^claudex-app-[\w.-]+\.zip$/.test(appFile)) { publish({ status: 'available', error: 'bad manifest' }); return state }
    publish({ status: 'downloading', progress: 0, error: null })
    try {
      const url = `https://github.com/${REPO}/releases/download/v${manifest.version}/${appFile}`
      const zip = await get(url, { onProgress: (p) => publish({ progress: p }) })
      const sha = crypto.createHash('sha256').update(zip).digest('hex')
      if (sha !== String(manifest.app?.sha256 ?? '').toLowerCase()) throw new Error('checksum mismatch')

      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'claudex-update-'))
      const zipPath = path.join(work, appFile)
      fs.writeFileSync(zipPath, zip)
      const staged = path.join(work, 'app')
      fs.mkdirSync(staged)
      // Windows 10+ ships bsdtar, which reads zip
      await new Promise((resolve, reject) => {
        const tar = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe')
        const t = spawn(tar, ['-xf', zipPath, '-C', staged], { windowsHide: true })
        t.on('error', reject)
        t.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unpack failed (${code})`))))
      })
      if (!fs.existsSync(path.join(staged, 'package.json'))) throw new Error('package.json missing in update')
      manifest.staged = staged
      publish({ status: 'ready', progress: 1 })
    } catch (err) {
      publish({ status: 'available', error: err.message })
    }
    return state
  }

  /**
   * Quit, and swap resources/app for the staged one once this process is gone
   * (the native modules are locked while it runs), then start Claudex again.
   * An inline PowerShell command, not a script file: nothing new to run.
   */
  function restart() {
    if (state.status !== 'ready' || !manifest?.staged) return false
    const target = path.join(process.resourcesPath, 'app')
    const exe = process.execPath
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`
    const ps = [
      `$ErrorActionPreference = 'Stop'`,
      `try { Wait-Process -Id ${process.pid} -Timeout 60 -ErrorAction SilentlyContinue } catch {}`,
      `Start-Sleep -Milliseconds 800`,
      `robocopy ${q(manifest.staged)} ${q(target)} /MIR /R:5 /W:1 /NFL /NDL /NJH /NJS | Out-Null`,
      `Start-Process -FilePath ${q(exe)}`,
    ].join('; ')
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    app.quit()
    return true
  }

  return { check, install, restart, getState: () => state }
}

module.exports = { createUpdater, newer, REPO }
