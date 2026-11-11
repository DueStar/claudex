/**
 * patchNotes — what changed since the version this PC last ran, shown once
 * after an update (PatchNotes.tsx). The notes are the spawn part of
 * CHANGELOG.md, bundled into the app; the last version seen is kept in
 * localStorage.
 */

export interface Release { version: string; notes: string[] }

/** Compare two x.y.z versions: negative when a is older. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** The section heading per language: "## spawn" (Korean), "## spawn (English)", "## spawn (日本語)" */
const SECTION = { ko: 'spawn', en: 'spawn (English)', ja: 'spawn (日本語)' } as const

/** The releases under a "## <section>" heading (each "### x.y.z" and its bullets), newest first as written. */
export function parseChangelog(md: string, section: string = SECTION.ko): Release[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex(l => /^##\s/.test(l) && l.replace(/^##\s+/, '').trim() === section)
  if (start < 0) return []
  const out: Release[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^##\s/.test(line)) break
    const head = /^###\s+v?(\d+\.\d+\.\d+)/.exec(line)
    if (head) { out.push({ version: head[1], notes: [] }); continue }
    const bullet = /^-\s+(.*)$/.exec(line)
    const cur = out[out.length - 1]
    if (!cur) continue
    if (bullet) cur.notes.push(plain(bullet[1]))
    else if (/^\s+\S/.test(line) && cur.notes.length) cur.notes[cur.notes.length - 1] += ` ${plain(line.trim())}`
  }
  return out
}

/**
 * The releases in a language. English and Japanese notes start at 1.3.16 (the
 * earlier ones are only in Korean); the newest release always has an entry,
 * falling back to English and then Korean when its own language has none.
 */
export function releasesIn(md: string, lang: 'ko' | 'en' | 'ja'): Release[] {
  const own = parseChangelog(md, SECTION[lang])
  if (lang === 'ko') return own
  const newest = parseChangelog(md, SECTION.ko)[0]
  if (newest && !own.some(r => r.version === newest.version)) {
    const fallback = parseChangelog(md, SECTION.en).find(r => r.version === newest.version) ?? newest
    return [fallback, ...own]
  }
  return own
}

/** Markdown marks off: **bold**, `code`, [text](link). */
function plain(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
}

/**
 * The releases to show: those after `seen` up to `current`. With nothing
 * seen yet (a fresh install, or the version before this screen existed)
 * only `current`. None when `seen` is `current` already.
 */
export function notesToShow(releases: Release[], current: string, seen: string | null): Release[] {
  if (!current || seen === current) return []
  return releases.filter(r => compareVersions(r.version, current) <= 0
    && (seen ? compareVersions(r.version, seen) > 0 : r.version === current))
}

const SEEN_KEY = 'spawn-seen-version'
export function readSeenVersion(): string | null {
  try { return localStorage.getItem(SEEN_KEY) } catch { return null }
}
export function writeSeenVersion(v: string) {
  try { localStorage.setItem(SEEN_KEY, v) } catch { /* private mode: shown again next time */ }
}
