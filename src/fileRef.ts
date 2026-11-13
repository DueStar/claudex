/**
 * A file reference in terminal output: a path with a folder part or a drive (src/app.ts,
 * ./x.js, C:\a\b.py) or a bare file name followed by a line (app.ts:12), then :line and
 * :column. Opened in the code editor with Ctrl+click (TerminalPanel).
 */

import { isMac } from './platform'

/** Every platform's paths: also absolute (/Users/me/a.ts:12) and home (~/proj/a.ts) ones */
export const FILE_REF = /(?<![\w/\:.@~-])((?:[A-Za-z]:[\\/]|~\/|\/|\.{1,2}[\\/]|[\w@.-]+[\\/])[\w@.\-\\/]*\.[A-Za-z0-9]{1,8}|[\w@.-]+\.[A-Za-z0-9]{1,8}(?=:\d))(?::(\d+))?(?::(\d+))?/g

/** Windows, as it has always been: a / or ~ path there is not a file of this PC */
const WIN_FILE_REF = /(?<![\w/\:.@-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\w@.-]+[\\/])[\w@.\-\\/]*\.[A-Za-z0-9]{1,8}|[\w@.-]+\.[A-Za-z0-9]{1,8}(?=:\d))(?::(\d+))?(?::(\d+))?/g

/** The pattern for this platform (global: use it with matchAll) */
export function fileRefPattern(): RegExp {
  return isMac() ? FILE_REF : WIN_FILE_REF
}
