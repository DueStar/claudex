/**
 * PatchNotes — after an update, the first start shows once what is new
 * (the CHANGELOG entries since the version this PC last ran).
 * PatchNotesHistory — every release, opened from the Claudex name in the header.
 */

import React, { useEffect, useState } from 'react'
import changelog from '../../CHANGELOG.md?raw'
import { bridge } from '../desktop'
import { t, lang } from '../i18n'
import { notesToShow, releasesIn, readSeenVersion, writeSeenVersion, type Release } from '../patchNotes'

export const PatchNotes: React.FC = () => {
  const [show, setShow] = useState<{ current: string; releases: Release[] } | null>(null)

  useEffect(() => {
    let alive = true
    bridge?.update.get().then(state => {
      const current = state?.current
      if (!alive || !current) return
      const releases = notesToShow(releasesIn(changelog, lang()), current, readSeenVersion())
      // Seen as soon as it is shown: a widget <-> window swap builds a new page,
      // which must not open the same notes again
      writeSeenVersion(current)
      if (releases.length) setShow({ current, releases })
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!show) return null
  return <NotesModal title={t('Claudex {version} 새 소식', { version: show.current })} releases={show.releases} onClose={() => setShow(null)} />
}

export const PatchNotesHistory: React.FC<{ onClose: () => void }> = ({ onClose }) =>
  <NotesModal title={t('패치노트')} releases={releasesIn(changelog, lang())} onClose={onClose} />

const NotesModal: React.FC<{ title: string; releases: Release[]; onClose: () => void }> = ({ title, releases, onClose: close }) => {
  return (
    <div className="resume-backdrop" onClick={close}>
      <div className="resume-modal w-notes" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="resume-head">
          <span>{title}</span>
          <button onClick={close} aria-label={t('닫기')}>×</button>
        </div>
        <div className="w-notes-body">
          {releases.map(r => (
            <section key={r.version}>
              <h3>{r.version}</h3>
              <ul>{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </section>
          ))}
        </div>
        <div className="w-notes-foot">
          <button className="w-notes-ok" onClick={close} autoFocus>{t('확인')}</button>
        </div>
      </div>
    </div>
  )
}

export default PatchNotes
