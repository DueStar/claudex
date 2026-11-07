/**
 * PatchNotes — after an update, the first start shows once what is new
 * (the CHANGELOG entries since the version this PC last ran).
 */

import React, { useEffect, useState } from 'react'
import changelog from '../../CHANGELOG.md?raw'
import { bridge } from '../desktop'
import { notesToShow, parseChangelog, readSeenVersion, writeSeenVersion, type Release } from '../patchNotes'

export const PatchNotes: React.FC = () => {
  const [show, setShow] = useState<{ current: string; releases: Release[] } | null>(null)

  useEffect(() => {
    let alive = true
    bridge?.update.get().then(state => {
      const current = state?.current
      if (!alive || !current) return
      const releases = notesToShow(parseChangelog(changelog), current, readSeenVersion())
      // Seen as soon as it is shown: a widget <-> window swap builds a new page,
      // which must not open the same notes again
      writeSeenVersion(current)
      if (releases.length) setShow({ current, releases })
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!show) return null
  const close = () => setShow(null)
  return (
    <div className="resume-backdrop" onClick={close}>
      <div className="resume-modal w-notes" onClick={e => e.stopPropagation()} role="dialog" aria-label="업데이트 소식">
        <div className="resume-head">
          <span>Claudex {show.current} 새 소식</span>
          <button onClick={close} aria-label="닫기">×</button>
        </div>
        <div className="w-notes-body">
          {show.releases.map(r => (
            <section key={r.version}>
              <h3>{r.version}</h3>
              <ul>{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </section>
          ))}
        </div>
        <div className="w-notes-foot">
          <button className="w-notes-ok" onClick={close} autoFocus>확인</button>
        </div>
      </div>
    </div>
  )
}

export default PatchNotes
