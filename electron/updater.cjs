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
 * When that path fails (it answered 504 for every repository on 2026-11-08
 * while the API worked), the same file comes through the API instead.
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
const { t } = require('./i18n.cjs')

const REPO = 'DueStar/claudex'
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

/**
 * One file of a release ('latest' or a tag like 'v1.3.12'): the plain download
 * first, then the API (60 calls an hour per IP without a token, plenty for a
 * fallback). What comes back is checked by the caller either way (signature, sha256).
 */
async function releaseFile(tag, file, opts = {}, fetch = get) {
  const base = `https://github.com/${REPO}/releases`
  try {
    return await fetch(tag === 'latest' ? `${base}/latest/download/${file}` : `${base}/download/${tag}/${file}`, opts)
  } catch (err) {
    const api = `https://api.github.com/repos/${REPO}/releases`
    const release = JSON.parse((await fetch(tag === 'latest' ? `${api}/latest` : `${api}/tags/${tag}`, { maxBytes: 1024 * 1024, headers: { Accept: 'application/vnd.github+json' } })).toString('utf8'))
    const asset = (release?.assets ?? []).find(a => a?.name === file)
    if (!asset || !Number.isInteger(asset.id)) throw err
    return fetch(`${api}/assets/${asset.id}`, { ...opts, headers: { Accept: 'application/octet-stream' } })
  }
}

/**
 * True when `manifest.signature` is the release key's Ed25519 signature over
 * the rest of the manifest (scripts/signing.mjs signs JSON.stringify of it
 * without the signature; JSON.parse keeps key order, so this re-serialises
 * the same bytes). The zip's sha256 is inside, so the zip is covered too.
 */
function verifyManifest(manifest, publicKey = require('./update-key.cjs')) {
  if (!manifest || typeof manifest.signature !== 'string') return false
  const { signature, ...body } = manifest
  try {
    return crypto.verify(null, Buffer.from(JSON.stringify(body), 'utf8'), crypto.createPublicKey(publicKey), Buffer.from(signature, 'base64'))
  } catch { return false }
}

/** GET with redirects (GitHub release downloads redirect to their CDN) */
function get(url, { onProgress, maxBytes = 300 * 1024 * 1024, headers = {} } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Claudex-updater', ...headers }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume()
        resolve(get(new URL(res.headers.location, url).toString(), { onProgress, maxBytes, headers }, hops + 1))
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

/**
 * A local channel for whoever builds Claudex on this PC: when
 * ~/.claudex/update-dir (or CLAUDEX_UPDATE_DIR) names a folder, the update
 * comes from that folder's latest.json and zip (what scripts/release.mjs leaves
 * in release/), checked every minute, and a build counts as newer by its date
 * even when the version number is the same. No GitHub release is needed.
 */
function localUpdateDir() {
  if (process.env.CLAUDEX_UPDATE_DIR) return process.env.CLAUDEX_UPDATE_DIR
  try {
    const home = require('../server/runtime-dir.cjs').runtimeDir()
    const dir = fs.readFileSync(path.join(home, 'update-dir'), 'utf8').trim()
    return dir && fs.existsSync(path.join(dir, 'latest.json')) ? dir : null
  } catch { return null }
}

/** When this copy of the app was built (scripts/release.mjs writes build-info.json) */
function ownBuildDate(app) {
  try { return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'build-info.json'), 'utf8')).date ?? null } catch { return null }
}

function createUpdater({ app, send, isPackaged }) {
  let state = { status: 'idle', current: app.getVersion(), latest: null, notes: '', notesEn: '', notesJa: '', progress: 0, error: null, needsFull: false, page: RELEASES_PAGE }
  let manifest = null
  const publish = (patch) => { state = { ...state, ...patch }; send('update:state', state) }

  const builtAt = ownBuildDate(app)
  /** Newer by version, or the same version built later (local builds) */
  const isNewer = (m) => newer(m.version, state.current) || (m.version === state.current && !!m.date && !!builtAt && Date.parse(m.date) > Date.parse(builtAt))

  async function check() {
    if (state.status === 'downloading' || state.status === 'ready') return state
    try {
      const local = localUpdateDir()
      const m = local
        ? { ...JSON.parse(fs.readFileSync(path.join(local, 'latest.json'), 'utf8')), localDir: local }
        : JSON.parse((await releaseFile('latest', 'latest.json', { maxBytes: 64 * 1024 })).toString('utf8'))
      if (!m || typeof m.version !== 'string') throw new Error('bad manifest')
      // GitHub's manifest must carry the release key's signature. The local
      // channel is a folder on this PC that the user pointed the app at, so
      // an unsigned build there (no key on this PC) is still accepted.
      if (!local && !verifyManifest(m)) throw new Error('unsigned or tampered manifest')
      if (!isNewer(m)) { publish({ status: 'current', latest: m.version, error: null }); return state }
      manifest = m
      publish({
        status: 'available', latest: m.version, notes: String(m.notes ?? '').slice(0, 2000),
        // English and Japanese notes (1.3.21+ manifests); the page picks by its language
        notesEn: String(m.notesEn ?? '').slice(0, 2000), notesJa: String(m.notesJa ?? '').slice(0, 2000), error: null,
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
    if (!isPackaged) { publish({ error: t('개발 실행에서는 업데이트하지 않아요') }); return state }
    const appFile = String(manifest.app?.file ?? '')
    if (!/^claudex-app-[\w.-]+\.zip$/.test(appFile)) { publish({ status: 'available', error: 'bad manifest' }); return state }
    publish({ status: 'downloading', progress: 0, error: null })
    try {
      const zip = manifest.localDir
        ? fs.readFileSync(path.join(manifest.localDir, appFile))
        : await releaseFile(`v${manifest.version}`, appFile, { onProgress: (p) => publish({ progress: p }) })
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
   * Restart into the new version. The swap happens in the next start, before
   * it loads anything (applyPendingUpdate): a script left behind to do it after
   * the app quits does not survive on Windows (a detached PowerShell never
   * runs; an attached one dies with the app).
   */
  function restart() {
    if (state.status !== 'ready' || !manifest?.staged) return false
    fs.writeFileSync(pendingFile(app), JSON.stringify({ staged: manifest.staged, version: manifest.version }))
    app.relaunch()
    app.quit()
    return true
  }

  return { check, install, restart, getState: () => state, usesLocal: () => !!localUpdateDir() }
}

const pendingFile = (app) => path.join(app.getPath('userData'), 'pending-update.json')

/**
 * Called first thing in main.cjs: when the last run left an update staged,
 * mirror it over resources/app (robocopy retries while the old run's processes
 * let go of their files) and report true, so main restarts into the new code.
 * The marker is removed before trying, so a bad update can never loop.
 */
function applyPendingUpdate(app) {
  const file = pendingFile(app)
  if (!fs.existsSync(file)) return false
  let pending = null
  try { pending = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  fs.rmSync(file, { force: true })
  const staged = pending?.staged
  if (!app.isPackaged || !staged || !fs.existsSync(path.join(staged, 'package.json'))) return false
  const target = path.join(process.resourcesPath, 'app')
  const { spawnSync } = require('child_process')
  const r = spawnSync('robocopy', [staged, target, '/MIR', '/R:20', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { windowsHide: true })
  const ok = typeof r.status === 'number' && r.status < 8 // robocopy: 0–7 copied or nothing to do, 8+ failed
  const log = path.join(app.getPath('userData'), 'update.log')
  try { fs.appendFileSync(log, `${new Date().toISOString()} ${pending.version}: robocopy ${r.status}${r.error ? ` ${r.error.message}` : ''}
`) } catch {}
  if (ok) { try { fs.rmSync(path.dirname(staged), { recursive: true, force: true }) } catch {} }
  return ok
}

module.exports = { createUpdater, applyPendingUpdate, newer, verifyManifest, releaseFile, REPO }
