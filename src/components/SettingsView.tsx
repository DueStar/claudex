/**
 * SettingsView — 설정: categories on the left, their items on the right.
 * Every change is saved at once by the main process (electron/settings.cjs)
 * and reaches every window; there is no "save" button.
 */

import React, { useState } from 'react'
import { bridge, type AppSettings, type SettingsPatch } from '../desktop'
import { useSettings, changeSettings } from '../settingsStore'
import { useCloud } from '../cloudStore'
import { CloseIcon } from './Icons'

type Section = 'notify' | 'privacy' | 'session' | 'app' | 'data'
const SECTIONS: [Section, string][] = [['notify', '알림'], ['privacy', '개인정보'], ['session', '세션'], ['app', '앱'], ['data', '데이터']]

const Toggle: React.FC<{ label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ label, hint, on, onChange, disabled }) => (
  <label className={`set-row${disabled ? ' off' : ''}`}>
    <span className="set-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
    <button type="button" role="switch" aria-checked={on} disabled={disabled} className={`set-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}><i /></button>
  </label>
)

function Choice<T extends string>({ label, hint, value, options, onChange }: { label: string; hint?: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="set-row">
      <span className="set-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <div className="dex-seg">
        {options.map(([v, text]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>)}
      </div>
    </div>
  )
}

const SettingsView: React.FC<{ onClose: () => void; version?: string }> = ({ onClose, version }) => {
  const s = useSettings()
  const cloud = useCloud()
  const [section, setSection] = useState<Section>('notify')
  const [note, setNote] = useState<string | null>(null)
  const set = <G extends keyof AppSettings>(group: G, part: Partial<AppSettings[G]>) => { changeSettings({ [group]: part } as SettingsPatch) }

  const pickFolder = async () => {
    const dir = await bridge?.terminals.pickFolder()
    if (dir) set('session', { defaultCwd: dir })
  }
  const exportBackup = async () => {
    const r = await bridge?.data.exportBackup()
    if (!r) return
    setNote(r.ok ? `백업을 저장했어요: ${r.path}` : r.reason === 'canceled' ? null : r.reason === 'no-data' ? '아직 저장된 도감이 없어요' : `저장하지 못했어요 (${r.reason})`)
  }

  return (
    <div className="set-backdrop" onClick={onClose}>
      <div className="set-modal" role="dialog" aria-label="설정" onClick={e => e.stopPropagation()}>
        <nav className="set-nav">
          <div className="set-title">설정</div>
          {SECTIONS.map(([k, label]) => <button key={k} className={section === k ? 'on' : ''} onClick={() => { setSection(k); setNote(null) }}>{label}</button>)}
          {version && <div className="set-version">Claudex {version}</div>}
        </nav>
        <div className="set-body">
          <button className="set-close w-icon" onClick={onClose} aria-label="닫기" title="닫기"><CloseIcon size={14} /></button>

          {section === 'notify' && <>
            <h3>알림</h3>
            <p className="set-lead">화면 오른쪽 아래에 뜨는 알림이에요.</p>
            <Toggle label="포획" on={s.notify.catch} onChange={v => set('notify', { catch: v })} />
            <Toggle label="도망" hint="놓친 포켓몬은 실루엣으로 보여요" on={s.notify.flee} onChange={v => set('notify', { flee: v })} />
            <Toggle label="진화" on={s.notify.evolve} onChange={v => set('notify', { evolve: v })} />
            <Toggle label="레벨 업" on={s.notify.levelup} onChange={v => set('notify', { levelup: v })} />
            <Toggle label="희귀 이상만" hint="포획·도망은 희귀·준전설·전설·환상, 색이 다른 포켓몬일 때만 알려줘요" on={s.notify.rareOnly} onChange={v => set('notify', { rareOnly: v })} />
            <Choice label="표시 시간" value={s.notify.duration} options={[['short', '짧게'], ['normal', '보통'], ['long', '길게']]} onChange={v => set('notify', { duration: v })} />
            <Toggle label="방해 금지 시간" hint="이 시간에는 알림을 띄우지 않아요. 기록에는 그대로 남아요" on={s.notify.quiet} onChange={v => set('notify', { quiet: v })} />
            <div className={`set-row set-sub${s.notify.quiet ? '' : ' off'}`}>
              <span className="set-text"><b>시간</b></span>
              <span className="set-times">
                <input type="time" value={s.notify.quietFrom} disabled={!s.notify.quiet} onChange={e => e.target.value && set('notify', { quietFrom: e.target.value })} />
                <span>부터</span>
                <input type="time" value={s.notify.quietTo} disabled={!s.notify.quiet} onChange={e => e.target.value && set('notify', { quietTo: e.target.value })} />
                <span>까지</span>
              </span>
            </div>
          </>}

          {section === 'privacy' && <>
            <h3>개인정보</h3>
            <p className="set-lead">화면 공유나 회의 중에 보이면 곤란한 내용을 가려요.</p>
            <Toggle label="요청 내용 숨기기" hint="알림·도감·박스·기록의 포획 경위에서 내가 쓴 요청을 빼고, 도구 이름만 보여줘요" on={s.privacy.hidePrompts} onChange={v => set('privacy', { hidePrompts: v })} />
          </>}

          {section === 'session' && <>
            <h3>세션</h3>
            <p className="set-lead">새로 여는 Claude Code 세션에 적용돼요. 이미 열린 세션은 그대로예요.</p>
            <div className="set-row">
              <span className="set-text"><b>기본 작업 폴더</b><small>{s.session.defaultCwd || '문서 폴더'}</small></span>
              <span className="set-actions">
                {s.session.defaultCwd && <button className="set-btn ghost" onClick={() => set('session', { defaultCwd: '' })}>기본값</button>}
                <button className="set-btn" onClick={pickFolder}>폴더 고르기</button>
              </span>
            </div>
            <Choice label="모델" hint="Claude Code 기본값은 계정 설정을 따라요" value={s.session.model} options={[['', '기본'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']]} onChange={v => set('session', { model: v })} />
            <Choice label="권한 모드" hint="자동 수락은 파일 수정을 묻지 않고 해요. 계획은 수정 없이 계획만 세워요" value={s.session.permissionMode} options={[['', '기본'], ['acceptEdits', '수정 자동 수락'], ['plan', '계획']]} onChange={v => set('session', { permissionMode: v })} />
            <Toggle label="세션 닫을 때 한 번 더 묻기" hint="끄면 × 한 번에 바로 닫혀요" on={s.session.confirmClose} onChange={v => set('session', { confirmClose: v })} />
          </>}

          {section === 'app' && <>
            <h3>앱</h3>
            <Toggle label="Windows 시작 시 실행" on={s.app.openAtLogin} onChange={v => set('app', { openAtLogin: v })} />
            <Toggle label="트레이로 숨긴 채 시작" hint="켤 때 창을 띄우지 않아요. 작업 표시줄 트레이의 몬스터볼로 열어요" on={s.app.startHidden} onChange={v => set('app', { startHidden: v })} />
            <Toggle label="위젯 항상 위에" hint="위젯 모드에서 다른 창보다 위에 떠 있어요" on={s.app.widgetOnTop} onChange={v => set('app', { widgetOnTop: v })} />
          </>}

          {section === 'data' && <>
            <h3>데이터</h3>
            <div className="set-row">
              <span className="set-text">
                <b>클라우드 저장</b>
                <small>{!cloud?.enabled ? '이 버전에서는 쓸 수 없어요'
                  : !cloud.user ? '로그인하면 도감이 클라우드에 저장돼요'
                  : cloud.error ? cloud.error
                  : cloud.lastSyncAt ? `${cloud.user.email ?? ''} · ${new Date(cloud.lastSyncAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 저장됨`
                  : `${cloud.user.email ?? ''} · 아직 저장 전`}</small>
              </span>
              <span className="set-actions">
                {cloud?.enabled && (cloud.user
                  ? <><button className="set-btn" onClick={() => bridge?.cloud.sync()}>지금 저장</button><button className="set-btn ghost" onClick={() => bridge?.cloud.signOut()}>로그아웃</button></>
                  : <button className="set-btn" onClick={() => bridge?.cloud.signIn()}>구글로 로그인</button>)}
              </span>
            </div>
            <div className="set-row">
              <span className="set-text"><b>도감 백업</b><small>잡은 포켓몬과 기록을 파일 하나로 저장해요</small></span>
              <button className="set-btn" onClick={exportBackup}>백업 파일 저장</button>
            </div>
            <div className="set-row">
              <span className="set-text"><b>데이터 폴더</b><small>도감 파일(pokedex.json)이 있는 곳이에요</small></span>
              <button className="set-btn ghost" onClick={() => bridge?.data.openFolder()}>폴더 열기</button>
            </div>
            {note && <p className="set-note">{note}</p>}
          </>}
        </div>
      </div>
    </div>
  )
}

export default SettingsView
