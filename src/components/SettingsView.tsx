/**
 * SettingsView — 설정: categories on the left, their items on the right.
 * Every change is saved at once by the main process (electron/settings.cjs)
 * and reaches every window; there is no "save" button.
 */

import React, { useState } from 'react'
import { bridge, type AppSettings, type SettingsPatch } from '../desktop'
import { useSettings, changeSettings } from '../settingsStore'
import { cloudErrorText, useCloud } from '../cloudStore'
import { CloseIcon } from './Icons'
import { t, locale } from '../i18n'

type Section = 'notify' | 'privacy' | 'session' | 'tools' | 'app' | 'data'

/** Claude Code's own mode names (code.claude.com/docs/en/permission-modes), one line on what each does; shown through t() */
const PERMISSION_HINT: Record<AppSettings['session']['permissionMode'], string> = {
  '': 'Claude Code 설정을 따라요',
  default: '파일 수정, 명령 실행 전에 매번 확인해요',
  acceptEdits: '작업 폴더 안의 파일 수정은 확인 없이 바로 적용해요',
  plan: '파일을 수정하지 않고 계획만 세워요. 계획을 승인하면 진행해요',
  auto: '별도 모델이 작업을 검토한 뒤 확인 없이 실행해요',
}
/** 설정 › 앱 › 스크롤 기록: the lines a terminal keeps (electron/settings.cjs checks the same list) */
const SCROLLBACKS: AppSettings['terminal']['scrollback'][] = [1000, 5000, 10000]
// The names go through t() when shown, so a language change re-renders them
const SECTIONS: [Section, string][] = [['notify', '알림'], ['privacy', '개인정보'], ['session', '세션'], ['tools', 'AI 도구'], ['app', '앱'], ['data', '데이터']]

/**
 * The tools Claudex supports by name: one click fills the form (the trainer
 * installs them). Claude Code is the default; Codex CLI is the other one
 * people use most. Gemini CLI is left out on purpose: individual accounts
 * moved to Antigravity CLI in 2026-06 and it behaves differently.
 */
const PRESETS: { name: string; command: string }[] = [
  { name: 'Codex CLI', command: 'codex' },
]

/** A tool's id from its name: lowercase letters, digits and dashes, unique in the list */
function toolId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'tool'
  let id = base === 'claude' ? 'claude-2' : base
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 20)}-${n}`
  return id
}

/** 설정 › AI 도구: Claude Code and the other terminal tools a session can run */
const ToolsSection: React.FC<{ s: AppSettings; set: (part: Partial<AppSettings['session']>) => void }> = ({ s, set }) => {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const tools = s.session.tools
  const add = () => {
    const n = name.trim(); const c = command.trim()
    if (!n || !c) return
    const id = toolId(n, new Set(['claude', ...tools.map(x => x.id)]))
    set({ tools: [...tools, { id, name: n.slice(0, 30), command: c.slice(0, 300) }] })
    setName(''); setCommand('')
  }
  const remove = (id: string) => set({ tools: tools.filter(x => x.id !== id), ...(s.session.defaultTool === id ? { defaultTool: 'claude' } : {}) })
  const isDefault = (id: string) => s.session.defaultTool === id || (id === 'claude' && !tools.some(x => x.id === s.session.defaultTool))
  return <>
    <h3>{t('AI 도구')}</h3>
    <p className="set-lead">{t('Claude Code 말고도 터미널에서 도는 AI 도구를 세션으로 열 수 있어요. 새 세션을 열 때 고를 수 있어요.')}</p>
    <div className="set-row">
      <span className="set-text"><b>Claude Code</b><small>{t('훅으로 도구 사용, 확인 필요, 사용량, 이어하기까지 모두 연결돼요')}</small></span>
      <span className="set-actions">{isDefault('claude') ? <span className="set-tag">{t('기본')}</span> : <button className="set-btn ghost" onClick={() => set({ defaultTool: 'claude' })}>{t('기본으로')}</button>}</span>
    </div>
    {tools.map(x => (
      <div className="set-row" key={x.id}>
        <span className="set-text"><b>{x.name}</b><small className="set-mono">{x.command}</small></span>
        <span className="set-actions">
          {isDefault(x.id) ? <span className="set-tag">{t('기본')}</span> : <button className="set-btn ghost" onClick={() => set({ defaultTool: x.id })}>{t('기본으로')}</button>}
          <button className="set-btn ghost" onClick={() => remove(x.id)}>{t('삭제')}</button>
        </span>
      </div>
    ))}
    {tools.length < 12 && (
      <div className="set-row set-tool-add">
        <span className="set-text">
          <b>{t('도구 추가')}</b>
          <small>{t('터미널에서 그 도구를 실행하는 명령을 적어 주세요. 도구는 직접 설치해야 해요.')}</small>
          <span className="set-presets">{PRESETS.filter(p => !tools.some(x => x.command === p.command)).map(p => (
            <button key={p.command} className="set-btn ghost" onClick={() => { setName(p.name); setCommand(p.command) }}>{p.name}</button>
          ))}</span>
        </span>
        <span className="set-tool-form">
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('이름')} aria-label={t('이름')} maxLength={30} />
          <input className="set-mono" value={command} onChange={e => setCommand(e.target.value)} placeholder={t('명령 (예: codex)')} aria-label={t('명령')} maxLength={300}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add() }} />
          <button className="set-btn" onClick={add} disabled={!name.trim() || !command.trim()}>{t('추가')}</button>
        </span>
      </div>
    )}
    <p className="set-lead set-foot">{t('Claude Code가 아닌 도구는 터미널 출력으로 일하는지 알아채요. 출력이 이어지는 동안 걸음이 쌓이고, 조용해지면 쉬는 중이 돼요. 사용량과 이어하기는 아직 없어요.')}</p>
  </>
}

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

const SettingsView: React.FC<{ onClose: () => void; version?: string; onFeedback?: () => void }> = ({ onClose, version, onFeedback }) => {
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
    setNote(r.ok ? t('내보냈어요: {path}', { path: r.path ?? '' }) : r.reason === 'canceled' ? null : r.reason === 'no-data' ? t('아직 저장된 도감이 없어요') : t('내보내지 못했어요 ({reason})', { reason: r.reason ?? '' }))
  }

  return (
    <div className="set-backdrop" onClick={onClose}>
      <div className="set-modal" role="dialog" aria-label={t('설정')} onClick={e => e.stopPropagation()}>
        <nav className="set-nav">
          <div className="set-title">{t('설정')}</div>
          {SECTIONS.map(([k, label]) => <button key={k} className={section === k ? 'on' : ''} onClick={() => { setSection(k); setNote(null) }}>{t(label)}</button>)}
          {version && <div className="set-version">Claudex {version}</div>}
        </nav>
        <div className="set-body">
          <button className="set-close w-icon" onClick={onClose} aria-label={t('닫기')} title={t('닫기')}><CloseIcon size={14} /></button>

          {section === 'notify' && <>
            <h3>{t('알림')}</h3>
            <p className="set-lead">{t('화면 오른쪽 아래에 표시되는 알림을 설정해요.')}</p>
            <Toggle label={t('포획')} on={s.notify.catch} onChange={v => set('notify', { catch: v })} />
            <Toggle label={t('도망')} hint={t('놓친 포켓몬은 실루엣으로 표시돼요')} on={s.notify.flee} onChange={v => set('notify', { flee: v })} />
            <Toggle label={t('진화')} on={s.notify.evolve} onChange={v => set('notify', { evolve: v })} />
            <Toggle label={t('레벨 업')} on={s.notify.levelup} onChange={v => set('notify', { levelup: v })} />
            <Toggle label={t('희귀 등급 이상만')} hint={t('포획·도망 알림은 희귀 등급 이상이거나 색이 다른 포켓몬일 때만 표시해요')} on={s.notify.rareOnly} onChange={v => set('notify', { rareOnly: v })} />
            <Toggle label={t('세션 알림')} hint={t('앱을 보고 있지 않을 때 세션이 일을 마치거나 확인이 필요하면 Windows 알림을 띄우고 작업 표시줄을 깜빡여요')} on={s.notify.sessions} onChange={v => set('notify', { sessions: v })} />
            <Toggle label={t('효과음')} hint={t('알림이 뜰 때 짧은 소리를 내요 (포획, 도망, 레벨 업, 진화)')} on={s.notify.sound} onChange={v => set('notify', { sound: v })} />
            <Choice label={t('표시 시간')} value={s.notify.duration} options={[['short', t('짧게')], ['normal', t('보통')], ['long', t('길게')]]} onChange={v => set('notify', { duration: v })} />
            <Toggle label={t('방해 금지')} hint={t('정한 시간에는 알림을 띄우지 않아요. 기록에는 그대로 남아요')} on={s.notify.quiet} onChange={v => set('notify', { quiet: v })} />
            <div className={`set-row set-sub${s.notify.quiet ? '' : ' off'}`}>
              <span className="set-text"><b>{t('예약 시간')}</b></span>
              <span className="set-times">
                <input type="time" aria-label={t('시작')} value={s.notify.quietFrom} disabled={!s.notify.quiet} onChange={e => e.target.value && set('notify', { quietFrom: e.target.value })} />
                <span>~</span>
                <input type="time" aria-label={t('종료')} value={s.notify.quietTo} disabled={!s.notify.quiet} onChange={e => e.target.value && set('notify', { quietTo: e.target.value })} />
              </span>
            </div>
          </>}

          {section === 'privacy' && <>
            <h3>{t('개인정보')}</h3>
            <p className="set-lead">{t('화면을 공유하거나 녹화할 때 보이지 않았으면 하는 내용을 숨겨요.')}</p>
            <Toggle label={t('프롬프트 숨기기')} hint={t('알림·도감·박스·기록에서 프롬프트 내용 대신 사용한 도구만 표시하고, 클라우드 백업에도 프롬프트를 올리지 않아요')} on={s.privacy.hidePrompts} onChange={v => set('privacy', { hidePrompts: v })} />
          </>}

          {section === 'session' && <>
            <h3>{t('세션')}</h3>
            <p className="set-lead">{t('새로 여는 Claude Code 세션부터 적용돼요. 이미 열린 세션은 바뀌지 않아요.')}</p>
            <div className="set-row">
              <span className="set-text"><b>{t('기본 작업 폴더')}</b><small>{s.session.defaultCwd || t('문서 (기본값)')}</small></span>
              <span className="set-actions">
                {s.session.defaultCwd && <button className="set-btn ghost" onClick={() => set('session', { defaultCwd: '' })}>{t('초기화')}</button>}
                <button className="set-btn" onClick={pickFolder}>{t('폴더 선택')}</button>
              </span>
            </div>
            <Choice label={t('모델')} hint={t('기본값은 Claude Code 설정을 따라요')} value={s.session.model} options={[['', t('기본값')], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']]} onChange={v => set('session', { model: v })} />
            <Choice label="Permission mode" hint={t(PERMISSION_HINT[s.session.permissionMode])} value={s.session.permissionMode} options={[['', t('기본값')], ['default', 'Manual'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['auto', 'Auto']]} onChange={v => set('session', { permissionMode: v })} />
            <Toggle label={t('세션 닫기 전 확인')} hint={t('끄면 × 한 번으로 바로 닫혀요')} on={s.session.confirmClose} onChange={v => set('session', { confirmClose: v })} />
            <Toggle label={t('시작할 때 세션 다시 열기')} hint={t('앱을 닫을 때 열려 있던 세션을 다음에 켤 때 이어서 열어요')} on={s.session.restoreOnStart} onChange={v => set('session', { restoreOnStart: v })} />
          </>}

          {section === 'tools' && <ToolsSection s={s} set={part => set('session', part)} />}

          {section === 'app' && <>
            <h3>{t('앱')}</h3>
            <Choice label={t('언어')} hint={s.app.language === 'auto' ? t('시스템 언어를 따라요') : undefined} value={s.app.language} options={[['auto', t('자동')], ['ko', '한국어'], ['en', 'English'], ['ja', '日本語']]} onChange={v => set('app', { language: v })} />
            <Toggle label={t('Windows 시작 시 실행')} on={s.app.openAtLogin} onChange={v => set('app', { openAtLogin: v })} />
            <Toggle label={t('시작 시 트레이로 최소화')} hint={t('창을 띄우지 않고 시작해요. 작업 표시줄 트레이의 몬스터볼로 열 수 있어요')} on={s.app.startHidden} onChange={v => set('app', { startHidden: v })} />
            <Toggle label={t('위젯 항상 위에 표시')} hint={t('위젯 모드에서 다른 창 위에 고정돼요')} on={s.app.widgetOnTop} onChange={v => set('app', { widgetOnTop: v })} />
            <Choice label={t('터미널 글꼴')} hint={t('열린 터미널에도 바로 적용돼요. 설치되지 않은 글꼴은 Consolas로 보여요')} value={s.terminal.font}
              options={[['default', 'Monaspace'], ['consolas', 'Consolas'], ['cascadia', 'Cascadia'], ['d2coding', 'D2Coding']]} onChange={v => set('terminal', { font: v })} />
            <Choice label={t('스크롤 기록')} hint={t('터미널마다 위로 올려 볼 수 있는 줄 수예요. 많을수록 메모리를 더 써요')} value={String(s.terminal.scrollback)}
              options={SCROLLBACKS.map(n => [String(n), t('{n}줄', { n: n.toLocaleString(locale()) })])} onChange={v => set('terminal', { scrollback: Number(v) as AppSettings['terminal']['scrollback'] })} />
            {onFeedback && (
              <div className="set-row">
                <span className="set-text"><b>{t('의견 보내기')}</b><small>{t('고쳤으면 하는 것, 더해졌으면 하는 것을 GitHub 이슈로 보내요. 원하면 화면 위치도 찍을 수 있어요')}</small></span>
                <button className="set-btn" onClick={onFeedback}>{t('보내기')}</button>
              </div>
            )}
          </>}

          {section === 'data' && <>
            <h3>{t('데이터')}</h3>
            <div className="set-row">
              <span className="set-text">
                <b>{t('클라우드 동기화')}</b>
                <small>{!cloud?.enabled ? t('이 버전에서는 사용할 수 없어요')
                  : !cloud.user ? t('Google 계정으로 로그인하면 여러 PC에서 도감이 동기화돼요')
                  : cloud.error ? cloudErrorText(cloud.error)
                  : cloud.lastSyncAt ? `${cloud.user.email ?? ''} · ${t('마지막 동기화 {time}', { time: new Date(cloud.lastSyncAt).toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}`
                  : `${cloud.user.email ?? ''} · ${t('아직 동기화하지 않았어요')}`}</small>
              </span>
              <span className="set-actions">
                {cloud?.enabled && (cloud.user
                  ? <><button className="set-btn" onClick={() => bridge?.cloud.sync()}>{t('지금 동기화')}</button><button className="set-btn ghost" onClick={() => bridge?.cloud.signOut()}>{t('로그아웃')}</button></>
                  : <button className="set-btn" onClick={() => bridge?.cloud.signIn()}>{t('Google로 로그인')}</button>)}
              </span>
            </div>
            <div className="set-row">
              <span className="set-text"><b>{t('백업')}</b><small>{t('도감과 기록을 JSON 파일로 내보내요')}</small></span>
              <button className="set-btn" onClick={exportBackup}>{t('내보내기')}</button>
            </div>
            <div className="set-row">
              <span className="set-text"><b>{t('데이터 폴더')}</b><small>{t('pokedex.json이 저장된 폴더예요')}</small></span>
              <button className="set-btn ghost" onClick={() => bridge?.data.openFolder()}>{t('열기')}</button>
            </div>
            {note && <p className="set-note">{note}</p>}
          </>}
        </div>
      </div>
    </div>
  )
}

export default SettingsView
