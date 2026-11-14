/**
 * A file reference in terminal output: a path with a folder part or a drive (src/app.ts,
 * ./x.js, C:\a\b.py) or a bare file name followed by a line (app.ts:12), then :line and
 * :column. Opened in the code editor with Ctrl+click (TerminalPanel).
 */

import { isMac } from './platform'

/** Windows, as it has always been: a / or ~ path there is not a file of this PC */
const WIN_SOURCE = String.raw`(?<![\w/\:.@-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\w@.-]+[\\/])[\w@.\-\\/]*\.[A-Za-z0-9]{1,8}|[\w@.-]+\.[A-Za-z0-9]{1,8}(?=:\d))(?::(\d+))?(?::(\d+))?`

/** Two edits of the Windows pattern: ~ cannot come just before a match, and a path may start with ~/ or / */
function withPosixPaths(source: string): string {
  const out = source
    .replace(String.raw`(?<![\w/\:.@-])`, String.raw`(?<![\w/\:.@~-])`)
    .replace(String.raw`((?:[A-Za-z]:[\\/]|`, String.raw`((?:[A-Za-z]:[\\/]|~\/|\/|`)
  if (out === source || (out.match(/~/g) ?? []).length !== 2) throw new Error('fileRef: the Windows pattern changed; update withPosixPaths')
  return out
}

const WIN_FILE_REF = new RegExp(WIN_SOURCE, 'g')
/** Every platform's paths: also absolute (/Users/me/a.ts:12) and home (~/proj/a.ts) ones */
export const FILE_REF = new RegExp(withPosixPaths(WIN_SOURCE), 'g')

/** The pattern for this platform (global: use it with matchAll) */
export function fileRefPattern(): RegExp {
  return isMac() ? FILE_REF : WIN_FILE_REF
}
