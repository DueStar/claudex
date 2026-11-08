/**
 * All translations, merged: one file per area so they can be edited apart.
 * Keys are the Korean text (src/i18n.ts).
 */

import widget from './widget'
import dex from './dex'
import settings from './settings'

const parts = [widget, dex, settings]
const merge = (lang: 'en' | 'ja') => Object.assign({}, ...parts.map(p => p[lang])) as Record<string, string>

const DICTS = { en: merge('en'), ja: merge('ja') }
export default DICTS
