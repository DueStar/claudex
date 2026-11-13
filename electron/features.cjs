'use strict'

/**
 * features.cjs — switches for whole features, read from features.json (the
 * page reads the same file through src/features.ts, so there is one value).
 *
 * OTHER_TOOLS: AI tools other than Claude Code (Codex CLI, tools added in
 * 설정 › AI 도구). Hidden on 2026-11-13 at the owner's request: off, every
 * session runs Claude Code (or the plain shell), the 설정 section, the tool
 * picker, Codex's usage rows and its log watcher are gone, and the stored
 * tools / default tool / Codex tabs in the reopen list are kept as they are.
 * Flip `otherTools` to true in features.json to bring it all back.
 */

const FEATURES = require('./features.json')

const OTHER_TOOLS = FEATURES.otherTools === true

module.exports = { OTHER_TOOLS }
