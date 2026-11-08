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

/** Claude Code's own mode names (code.claude.com/docs/en/permission-modes), one line on what each does */
const PERMISSION_HINT: Record<AppSettings['session']['permissionMode'], string> = {
  '': 'Claude Code 설정을 따라요',
  default: '파일 수정, 명령 실행 전에 매번 확인해요',
  acceptEdits: '작업 폴더 안의 파일 수정은 확인 없이 바로 적용해요',
  plan: '파일을 수정하지 않고 계획만 세워요. 계획을 승인하면 진행해요',
  auto: '별도 모델이 작업을 검토한 뒤 확인 없이 실행해요',
}
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
    setNote(r.ok ? `내보냈어요: ${r.path}` : r.reason === 'canceled' ? null : r.reason === 'no-data' ? '아직 저장된 도감이 없어요' : `내보내지 못했어요 (${r.reason})`)
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
            <p className="set-lead">화면 오른쪽 아래에 표시되는 알림을 설정해요.</p>
            <Toggle label="포획" on={s.notify.catch} onChange={v => set('notify', { catch: v })} />
            <Toggle label="도망" hint="놓친 포켓몬은 실루엣으로 표시돼요" on={s.notify.flee} onChange={v => set('notify', { flee: v })} />
            <Toggle label="진화" on={s.notify.evolve} onChange={v => set('notify', { evolve: v })} />
            <Toggle label="레벨 업" on={s.notify.levelup} onChange={v => set('notify', { levelup: v })} />
            <Toggle label="희귀 등급 이상만" hint="포획·도망 알림은 희귀 등급 이상이거나 색이 다른 포켓몬일 때만 표시해요" on={s.notify.rareOnly} onChange={v => set('notify', { rareOnly: v })} />
            <Choice label="표시 시간" value={s.notify.duration} options={[['short', '짧게'], ['normal', '보통'], ['long', '길게']]} onChange={v => set('notify', { duration: v })} />
            <Toggle label="방해 금지" hint="정한 시간에는 알림을 띄우지 않아요. 기록에는 그대로 남아요" on={s.notify.quiet} onChange={v => set('notify', { quiet: v })} />
            <div className={`set-row set-sub${s.notify.quiet ? '' : ' off'}`}>
              <span className="set-text"><b>예약 시간</b></span>
              <span className="set-times">
                <input type="time" aria-label="시작" value={s.notify.quietFrom} disabled={!s.notify.quiet} onChange={e => e.target.value && set('notify', { quietFrom: e.target.value })} />
                <span>~</span>
                <input type="time" aria-label="종료" value={s.notify.quietTo} disabled={!s.notify.quiet} onChange={e => e.target.value && set('notify', { quietTo: e.target.value })} />
              </span>
            </div>
          </>}

          {section === 'privacy' && <>
            <h3>개인정보</h3>
            <p className="set-lead">화면을 공유하거나 녹화할 때 보이지 않았으면 하는 내용을 숨겨요.</p>
            <Toggle label="프롬프트 숨기기" hint="알림·도감·박스·기록에서 프롬프트 내용 대신 사용한 도구만 표시해요" on={s.privacy.hidePrompts} onChange={v => set('privacy', { hidePrompts: v })} />
          </>}

          {section === 'session' && <>
            <h3>세션</h3>
            <p className="set-lead">새로 여는 Claude Code 세션부터 적용돼요. 이미 열린 세션은 바뀌지 않아요.</p>
            <div className="set-row">
              <span className="set-text"><b>기본 작업 폴더</b><small>{s.session.defaultCwd || '문서 (기본값)'}</small></span>
              <span className="set-actions">
                {s.session.defaultCwd && <button className="set-btn ghost" onClick={() => set('session', { defaultCwd: '' })}>초기화</button>}
                <button className="set-btn" onClick={pickFolder}>폴더 선택</button>
              </span>
            </div>
            <Choice label="모델" hint="기본값은 Claude Code 설정을 따라요" value={s.session.model} options={[['', '기본값'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']]} onChange={v => set('session', { model: v })} />
            <Choice label="Permission mode" hint={PERMISSION_HINT[s.session.permissionMode]} value={s.session.permissionMode} options={[['', '기본값'], ['default', 'Manual'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['auto', 'Auto']]} onChange={v => set('session', { permissionMode: v })} />
            <Toggle label="세션 닫기 전 확인" hint="끄면 × 한 번으로 바로 닫혀요" on={s.session.confirmClose} onChange={v => set('session', { confirmClose: v })} />
          </>}

          {section === 'app' && <>
            <h3>앱</h3>
            <Toggle label="Windows 시작 시 실행" on={s.app.openAtLogin} onChange={v => set('app', { openAtLogin: v })} />
            <Toggle label="시작 시 트레이로 최소화" hint="창을 띄우지 않고 시작해요. 작업 표시줄 트레이의 몬스터볼로 열 수 있어요" on={s.app.startHidden} onChange={v => set('app', { startHidden: v })} />
            <Toggle label="위젯 항상 위에 표시" hint="위젯 모드에서 다른 창 위에 고정돼요" on={s.app.widgetOnTop} onChange={v => set('app', { widgetOnTop: v })} />
          </>}

          {section === 'data' && <>
            <h3>데이터</h3>
            <div className="set-row">
              <span className="set-text">
                <b>클라우드 동기화</b>
                <small>{!cloud?.enabled ? '이 버전에서는 사용할 수 없어요'
                  : !cloud.user ? 'Google 계정으로 로그인하면 여러 PC에서 도감이 동기화돼요'
                  : cloud.error ? cloud.error
                  : cloud.lastSyncAt ? `${cloud.user.email ?? ''} · 마지막 동기화 ${new Date(cloud.lastSyncAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                  : `${cloud.user.email ?? ''} · 아직 동기화하지 않았어요`}</small>
              </span>
              <span className="set-actions">
                {cloud?.enabled && (cloud.user
                  ? <><button className="set-btn" onClick={() => bridge?.cloud.sync()}>지금 동기화</button><button className="set-btn ghost" onClick={() => bridge?.cloud.signOut()}>로그아웃</button></>
                  : <button className="set-btn" onClick={() => bridge?.cloud.signIn()}>Google로 로그인</button>)}
              </span>
            </div>
            <div className="set-row">
              <span className="set-text"><b>백업</b><small>도감과 기록을 JSON 파일로 내보내요</small></span>
              <button className="set-btn" onClick={exportBackup}>내보내기</button>
            </div>
            <div className="set-row">
              <span className="set-text"><b>데이터 폴더</b><small>pokedex.json이 저장된 폴더예요</small></span>
              <button className="set-btn ghost" onClick={() => bridge?.data.openFolder()}>열기</button>
            </div>
            {note && <p className="set-note">{note}</p>}
          </>}
        </div>
      </div>
    </div>
  )
}

export default SettingsView
