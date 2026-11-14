/**
 * QaPage (?qa) — every design that only shows up in a particular moment,
 * laid out at once for design QA: each kind of catch notification, flees,
 * evolutions, level-ups, the widget's question panel and update button, the session
 * rows in every mood (상세 and 간략) and the text-size control.
 * "띄우기" sends the same event to the real notification window.
 */

import React from 'react'
import './styles/tokens.css'
import './styles/widget.css'
import './styles/widget-expanded.css'
import './styles/pokedex.css'
import './styles/toast.css'
import { bridge } from './desktop'
import { usageTone } from './meters'
import { iconUrl, pokemonById } from './theme'
import { ToastCard } from './Toast'
import TodayLog from './components/TodayLog'
import { TextSizeControl } from './components/TextSizeControl'
import { hpTone } from './sessionList'
import type { DexEvent, Tier } from './pokedexStore'

const at = Date.now()
const name = (id: number) => pokemonById(id)?.ko ?? `#${id}`
const via = (label: string, prompt = '로그인 화면 버그 고쳐줘') => ({ tool: label.split('(')[0], label, prompt })

function catchOf(id: number, tier: Tier, extra: Partial<DexEvent> = {}): DexEvent {
  return {
    kind: 'catch', id, name: name(id), tier, shiny: false, place: 'spawn 동굴', at,
    via: via('Bash(npm test)'), gender: 'male', nature: 3, ball: 'poke-ball', level: 12, uid: 'qa', ...extra,
  } as DexEvent
}

const SAMPLES: { title: string; note: string; e: DexEvent }[] = [
  { title: '포획 · 일반', note: '가장 흔한 알림', e: catchOf(16, 'common', { level: 7 }) },
  { title: '포획 · 희귀', note: '포획률 45 이하', e: catchOf(147, 'rare', { ball: 'dusk-ball', level: 15, place: 'spawn 동굴 (밤)' }) },
  { title: '포획 · 준전설', note: '보라 테두리', e: catchOf(144, 'sub', { ball: 'timer-ball', level: 50, gender: 'none' }) },
  { title: '포획 · 전설 (마스터볼)', note: '금색 빛, 15초', e: catchOf(150, 'legendary', { ball: 'master-ball', level: 55, gender: 'none' }) },
  { title: '포획 · 환상', note: '분홍 빛, 15초', e: catchOf(151, 'mythical', { ball: 'quick-ball', level: 48, gender: 'none', pity: true }) },
  { title: '포획 · 색이 다른 포켓몬', note: '✦ 빛나는', e: catchOf(25, 'common', { shiny: true, ball: 'luxury-ball', level: 22, gender: 'female', via: via('Edit(Widget.tsx)') }) },
  { title: '포획 · 출석 조우', note: '하루 첫 세션', e: catchOf(133, 'common', { attendance: true, place: 'spawn (오늘의 출석)', ball: 'great-ball', via: via('세션 시작'), level: 9 }) },
  { title: '포획 · 울트라비스트', note: '울트라볼', e: catchOf(793, 'sub', { ball: 'beast-ball', level: 55, gender: 'none', via: via('Grep 검색') }) },
  { title: '포획 · 처음 보는 종', note: 'NEW · 긴 장소는 말줄임', e: catchOf(37, 'rare', { newSpecies: true, ball: 'great-ball', level: 11, gender: 'female', place: 'shop-web-checkout-service 깊은 동굴 안쪽의 숨은 샘터 (밤)' }) },
  { title: '포획 · 박스 가득', note: '박사님께 보냄', e: catchOf(19, 'common', { toProfessor: true, uid: undefined, level: 4 }) },
  { title: '도망 · 일반', note: '실루엣만', e: { kind: 'flee', id: 52, name: name(52), tier: 'common', shiny: false, place: 'spawn 풀숲', nature: 7, at } as DexEvent },
  { title: '도망 · 준전설', note: '실루엣만', e: { kind: 'flee', id: 145, name: name(145), tier: 'sub', shiny: false, place: 'spawn 하늘길', at } as DexEvent },
  { title: '진화', note: '레벨업 때', e: { kind: 'evolve', id: 5, from: 4, name: name(5), fromName: name(4), tier: undefined, shiny: false, at } as unknown as DexEvent },
  { title: '레벨업', note: '5초', e: { kind: 'levelup', id: 6, name: name(6), level: 36, shiny: false, at } as unknown as DexEvent },
]

/** The session rows in each mood, as the left list draws them (Widget.tsx), and a shell */
type QaMood = 'working' | 'needs-you' | 'idle' | 'error' | 'ended'
const MOOD_WORDS: Record<QaMood, string> = { working: '일하는 중', 'needs-you': '확인 필요', idle: '쉬는 중', error: '오류', ended: '종료' }
const ROWS: { mood: QaMood; title: string; dex: number; lv: number; project: string; branch: string; left: number; model: string; num: string }[] = [
  { mood: 'working', title: 'README 영어 번역', dex: 120, lv: 12, project: 'docs', branch: 'main', left: 88, model: 'Sonnet 5.5', num: '176K' },
  { mood: 'needs-you', title: '로그인 리다이렉트 고치기', dex: 27, lv: 17, project: 'shop-web', branch: 'fix/login-redirect', left: 62, model: 'Opus 5.5', num: '124K' },
  { mood: 'idle', title: '타입 정리', dex: 74, lv: 21, project: 'shop-api', branch: 'main', left: 100, model: 'Opus 5.5', num: '200K' },
  { mood: 'error', title: '이미지 최적화', dex: 41, lv: 11, project: 'shop-web', branch: 'perf/images', left: 34, model: 'Opus 5.5', num: '68K' },
  { mood: 'ended', title: '아주아주 긴 한국어 세션 이름이 한 줄을 넘어가면 어떻게 되는지 보는 세션', dex: 129, lv: 6, project: 'infra', branch: 'feat/very-long-branch-name-for-layout', left: 14, model: 'Sonnet 5.5', num: '28K' },
]
const Pill: React.FC<{ mood: QaMood }> = ({ mood }) => <span className={`w-pill mood-${mood}`}><i className="w-pill-dot" /><span className="w-pill-text">{MOOD_WORDS[mood]}</span></span>

const QaRows: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <section className="w-card w-party qa-rows">
    <div className={`w-rows${compact ? ' compact' : ''}`}>
      {ROWS.map((r, i) => (
        <div key={r.mood} className={`w-row mood-${r.mood}${i === 0 ? ' chosen' : ''}`}>
          <div className="w-row-head">
            <img className="w-row-mon" src={iconUrl(r.dex)} alt="" />
            {compact ? (
              <div className="w-row-line1">
                <span className="w-row-name">{r.title}</span>
                <span className={`w-row-tick ${hpTone(r.left)}`} aria-hidden="true" />
                <span className="w-row-state"><Pill mood={r.mood} /></span>
              </div>
            ) : <>
              <div className="w-row-line1"><span className="w-row-name">{r.title}</span><Pill mood={r.mood} /></div>
              <div className="w-row-line2">
                <span className="w-row-lv">Lv.{r.lv}</span>
                <span className="w-row-meta"><span className="w-row-project">{r.project}</span><span className="w-row-branch">{r.branch}</span></span>
              </div>
            </>}
          </div>
          {!compact && (
            <div className="w-row-bottom">
              <span className="w-hp-label" aria-hidden="true">HP</span>
              <div className={`w-ctx w-hp ${hpTone(r.left)}`}><span style={{ width: `${r.left}%` }} /></div>
              <span className="w-row-model">{r.model}</span>
              <span className="w-row-num">{r.num}</span>
            </div>
          )}
        </div>
      ))}
      {/* A plain shell: the prompt mark where the Pokémon would be, no context bar */}
      <div className="w-row mood-idle">
        <div className="w-row-head">
          <span className="w-row-mon w-row-shell" aria-hidden="true">&gt;_</span>
          {compact ? (
            <div className="w-row-line1"><span className="w-row-name">새 세션</span><span className="w-row-state"><Pill mood="idle" /></span></div>
          ) : <>
            <div className="w-row-line1"><span className="w-row-name">새 세션</span></div>
            <div className="w-row-line2"><span className="w-row-meta"><span className="w-row-project">shop-web</span><span className="w-row-tool">PowerShell</span><span className="w-row-branch">fix/login-redirect</span></span></div>
          </>}
        </div>
      </div>
    </div>
  </section>
)

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="qa-section">
    <h2>{title}</h2>
    <div className="qa-grid">{children}</div>
  </section>
)

const QaPage: React.FC = () => (
  <div className="widget qa">
    <header className="qa-head">
      <h1>spawn 디자인 QA</h1>
      <p>특정 상황에서만 보이는 화면을 한곳에 모았어요. <b>띄우기</b>를 누르면 실제 알림 창에 떠요.</p>
    </header>

    <Section title="알림 카드">
      {SAMPLES.map(s => (
        <div key={s.title} className="qa-item">
          <div className="qa-label">
            <b>{s.title}</b><span>{s.note}</span>
            <button className="qa-fire" onClick={() => bridge?.toast.show({ ...s.e, at: Date.now() })} disabled={!bridge}>띄우기</button>
          </div>
          <div className="widget toast-host qa-toast"><ToastCard t={s.e} /></div>
        </div>
      ))}
      <div className="qa-item">
        <div className="qa-label"><b>연달아 오는 알림</b><span>뒤에 겹쳐 쌓이고, 밀리면 짧게 · ×로 넘기기</span>
          <button className="qa-fire" disabled={!bridge} onClick={() => SAMPLES.slice(0, 4).forEach(s => bridge?.toast.show({ ...s.e, at: Date.now() }))}>4개 띄우기</button>
        </div>
        <div className="widget toast-host qa-toast"><ToastCard t={SAMPLES[1].e} waiting={3} /></div>
      </div>
    </Section>

    <Section title="세션 줄">
      <div className="qa-item qa-narrow">
        <div className="qa-label"><b>상세</b><span>일하는 중 · 확인 필요 · 쉬는 중 · 오류 · 종료 · 셸 (맨 위가 고른 세션)</span></div>
        <QaRows />
      </div>
      <div className="qa-item qa-narrow">
        <div className="qa-label"><b>간략</b><span>한 줄: 이름, 컨텍스트 눈금, 상태 점</span></div>
        <QaRows compact />
      </div>
    </Section>

    <Section title="글자 크기">
      <div className="qa-item qa-row">
        <TextSizeControl />
        <span className="qa-label"><span>목록·패널·터미널이 함께 바뀌어요. 알림 카드는 고정 크기라 따라가지 않아요</span></span>
      </div>
    </Section>

    <Section title="위젯: 확인이 필요한 세션">
      <div className="qa-item qa-narrow">
        <section className="w-card w-ask" role="alert">
          <div className="w-ask-head">
            <span className="w-ask-dot" /><b>로그인 버그</b><span>의 확인이 필요해요</span>
            <button className="w-ask-open">펼치기</button>
          </div>
          <div className="w-ask-term qa-fake-term">
            <pre>{'Do you trust the files in this folder?\n\n  C:\\Users\\me\\project\n\n❯ 1. Yes, proceed\n  2. No, exit'}</pre>
          </div>
          <div className="w-ask-hint">↑↓로 고르고 Enter, 그만두려면 Esc</div>
        </section>
      </div>
    </Section>

    <Section title="위젯: 사용량">
      <div className="qa-item qa-narrow">
        <section className="w-card w-limits idle"><span className="w-label">사용량</span><span className="w-limits-hint">세션을 열면 5시간·주간 사용량을 볼 수 있어요</span></section>
      </div>
      <div className="qa-item qa-narrow">
        <section className="w-card w-limits">
          {['5시간', '주간'].map(l => (
            <div key={l} className="w-limit tone-ok loading"><span className="w-label">{l}</span><div className="w-bar"><span style={{ width: 0 }} /></div><span className="w-limit-pct" /><span className="w-limit-reset" /></div>
          ))}
        </section>
      </div>
      <div className="qa-item qa-narrow">
        <section className="w-card w-limits">
          {/* the three tones: grey, amber from 80 %, red from 90 % (usageTone) */}
          {([['5시간', 43, '↻ 15:20'], ['주간', 82, '↻ 11/9'], ['Codex 주간', 93, '↻ 11/12']] as const).map(([l, v, r]) => (
            <div key={l} className={`w-limit tone-${usageTone(v)}`}><span className="w-label">{l}</span><div className="w-bar"><span style={{ width: `${v}%` }} /></div><span className="w-limit-pct">{v}<small>%</small></span><span className="w-limit-reset">{r}</span></div>
          ))}
        </section>
      </div>
    </Section>

    <section className="qa-section">
      <h2>오늘 기록 (실제 데이터)</h2>
      <div className="qa-today"><TodayLog /></div>
    </section>

    <Section title="위젯: 업데이트 버튼">
      <div className="qa-item qa-row">
        <button className="w-update available">업데이트</button>
        <button className="w-update downloading" disabled>받는 중 42%</button>
        <button className="w-update ready">재시작해서 적용</button>
        <button className="w-update available">새 버전 받기</button>
      </div>
    </Section>
  </div>
)

export default QaPage
