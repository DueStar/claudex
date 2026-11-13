/**
 * updater.cjs — "업데이트" in the widget: checks GitHub Releases for a newer
 * spawn, downloads only the app part (resources/app, a few MB to tens of
 * MB; the Electron runtime rarely changes), verifies it, and swaps it in
 * after the app quits.
 *
 * A release carries two files (scripts/release.mjs makes them):
 *   latest.json              { version, electron, notes, app: { file, sha256, size }, full }
 *   claudex-app-<v>.zip    the resources/app folder (the old name, which 1.3.35 and older
 *                          require; spawn-app-<v>.zip is accepted too, for a later switch)
 * A Mac reads its own pair instead: latest-mac-<arch>.json and
 * spawn-app-<v>-mac-<arch>.zip (manifestName, appFilePattern).
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
const childProcess = require('child_process')
const { t } = require('./i18n.cjs')
const { pendingFile: runnerPendingFile, bundlePath } = require('./updateRunner.cjs')
const { isMac } = require('./platform.cjs')

const REPO = 'DueStar/spawn'
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

/** The manifest this platform reads: latest.json on Windows (as always), latest-mac-<arch>.json on a Mac */
const manifestName = (platform = process.platform, arch = process.arch) => (isMac(platform) ? `latest-mac-${arch}.json` : 'latest.json')

/** The app zips this platform takes: Windows' rule as it always was, and a Mac only its own */
const appFilePattern = (platform = process.platform) => (isMac(platform) ? /^spawn-app-[\w.-]+-mac-(arm64|x64)\.zip$/ : /^(spawn|claudex)-app-[\w.-]+\.zip$/)

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
    const req = https.get(url, { headers: { 'User-Agent': 'spawn-updater', ...headers }, timeout: 30000 }, (res) => {
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
 * A local channel for whoever builds spawn on this PC: when
 * ~/.spawn/update-dir (or SPAWN_UPDATE_DIR) names a folder, the update
 * comes from that folder's manifest (`name`: latest.json, or a Mac's own) and
 * zip (what scripts/release.mjs leaves in release/), checked every minute, and
 * a build counts as newer by its date even when the version number is the
 * same. No GitHub release is needed.
 */
function localUpdateDir(name = manifestName()) {
  if (process.env.SPAWN_UPDATE_DIR) return process.env.SPAWN_UPDATE_DIR
  try {
    const home = require('../server/runtime-dir.cjs').runtimeDir()
    const dir = fs.readFileSync(path.join(home, 'update-dir'), 'utf8').trim()
    return dir && fs.existsSync(path.join(dir, name)) ? dir : null
  } catch { return null }
}

/**
 * True when a Mac update can go into this app: not translocated (macOS runs an
 * app opened from Downloads from a read-only copy under /private/var/folders)
 * and the bundle and its Contents/Resources/app writable by this user.
 */
function macBundleWritable(resourcesPath, fsx = fs) {
  const bundle = bundlePath(resourcesPath)
  if (bundle.startsWith('/private/var/folders/')) return false
  try {
    fsx.accessSync(bundle, fs.constants.W_OK)
    fsx.accessSync(path.posix.join(resourcesPath, 'app'), fs.constants.W_OK)
    return true
  } catch { return false }
}

/** When this copy of the app was built (scripts/release.mjs writes build-info.json) */
function ownBuildDate(app) {
  try { return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'build-info.json'), 'utf8')).date ?? null } catch { return null }
}

/**
 * platform, arch, fetch, spawn, localDir, resourcesPath and fsx (the
 * writable check) are this process's own unless a test hands in others (the
 * Mac paths are tested on Windows that way).
 */
function createUpdater({
  app, send, isPackaged,
  platform = process.platform,
  arch = process.arch,
  fetch = get,
  spawn = childProcess.spawn,
  localDir = localUpdateDir,
  resourcesPath = process.resourcesPath,
  fsx = fs,
}) {
  const manifestFile = manifestName(platform, arch)
  let state = { status: 'idle', current: app.getVersion(), latest: null, notes: '', notesEn: '', notesJa: '', progress: 0, error: null, needsFull: false, page: RELEASES_PAGE }
  let manifest = null
  let workFolder = null
  const publish = (patch) => { state = { ...state, ...patch }; send('update:state', state) }

  const builtAt = ownBuildDate(app)
  /** Newer by version, or the same version built later (local builds) */
  const isNewer = (m) => newer(m.version, state.current) || (m.version === state.current && !!m.date && !!builtAt && Date.parse(m.date) > Date.parse(builtAt))

  async function check() {
    if (state.status === 'downloading' || state.status === 'ready') return state
    try {
      const local = localDir(manifestFile)
      const m = local
        ? { ...JSON.parse(fs.readFileSync(path.join(local, manifestFile), 'utf8')), localDir: local }
        : JSON.parse((await releaseFile('latest', manifestFile, { maxBytes: 64 * 1024 }, fetch)).toString('utf8'))
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
    if (!appFilePattern(platform).test(appFile)) { publish({ status: 'available', error: 'bad manifest' }); return state }
    // A Mac app the update could not write into (run from Downloads, or put in
    // Applications by another user) is sent to the full download, before any of it is fetched
    if (isMac(platform) && !macBundleWritable(resourcesPath, fsx)) {
      publish({ status: 'available', error: t('맥: 앱을 응용 프로그램 폴더로 옮긴 뒤 업데이트해 주세요'), needsFull: true })
      return state
    }
    publish({ status: 'downloading', progress: 0, error: null })
    try {
      const zip = manifest.localDir
        ? fs.readFileSync(path.join(manifest.localDir, appFile))
        : await releaseFile(`v${manifest.version}`, appFile, { onProgress: (p) => publish({ progress: p }) }, fetch)
      const sha = crypto.createHash('sha256').update(zip).digest('hex')
      if (sha !== String(manifest.app?.sha256 ?? '').toLowerCase()) throw new Error('checksum mismatch')

      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-update-'))
      workFolder = work // known from now, so the stale-folder cleanup leaves it alone while it fills
      const zipPath = path.join(work, appFile)
      fs.writeFileSync(zipPath, zip)
      const staged = path.join(work, 'app')
      fs.mkdirSync(staged)
      if (isMac(platform)) {
        // macOS's own unzip, which keeps modes and links
        await new Promise((resolve, reject) => {
          const d = spawn('ditto', ['-x', '-k', zipPath, staged], { stdio: 'ignore' })
          d.on('error', reject)
          d.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unpack failed (${code})`))))
        })
      } else {
        // Windows 10+ ships bsdtar, which reads zip
        await new Promise((resolve, reject) => {
          const tar = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe')
          const t = spawn(tar, ['-xf', zipPath, '-C', staged], { windowsHide: true })
          t.on('error', reject)
          t.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unpack failed (${code})`))))
        })
      }
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
   * it loads anything (updateRunner.cjs): a script left behind to do it after
   * the app quits does not survive on Windows (a detached PowerShell never
   * runs; an attached one dies with the app). app.quit() runs main.cjs's quit
   * sequence (sessions ended and waited for, server stopped), as any quit does.
   */
  function restart() {
    if (state.status !== 'ready' || !manifest?.staged) return false
    fs.writeFileSync(pendingFile(app), JSON.stringify({ staged: manifest.staged, version: manifest.version }))
    app.relaunch()
    app.quit()
    return true
  }

  // workDir: the spawn-update-* folder this run is downloading or unpacking into, or has staged (kept by the stale-folder cleanup)
  return { check, install, restart, getState: () => state, usesLocal: () => !!localDir(manifestFile), workDir: () => workFolder }
}

const pendingFile = (app) => runnerPendingFile(app.getPath('userData'))

module.exports = { createUpdater, newer, verifyManifest, releaseFile, manifestName, appFilePattern, localUpdateDir, REPO }
