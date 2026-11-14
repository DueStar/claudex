/**
 * QaPage (?qa) — every design that only shows up in a particular moment,
 * laid out at once for design QA: each kind of catch notification, flees,
 * evolutions, level-ups, the widget's question panel and update button.
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
import { pokemonById } from './theme'
import { ToastCard } from './Toast'
import TodayLog from './components/TodayLog'
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
  { title: '포획 · 박스 가득', note: '박사님께 보냄', e: catchOf(19, 'common', { toProfessor: true, uid: undefined, level: 4 }) },
  { title: '도망 · 일반', note: '실루엣만', e: { kind: 'flee', id: 52, name: name(52), tier: 'common', shiny: false, place: 'spawn 풀숲', nature: 7, at } as DexEvent },
  { title: '도망 · 준전설', note: '실루엣만', e: { kind: 'flee', id: 145, name: name(145), tier: 'sub', shiny: false, place: 'spawn 하늘길', at } as DexEvent },
  { title: '진화', note: '레벨업 때', e: { kind: 'evolve', id: 5, from: 4, name: name(5), fromName: name(4), tier: undefined, shiny: false, at } as unknown as DexEvent },
  { title: '레벨업', note: '5초', e: { kind: 'levelup', id: 6, name: name(6), level: 36, shiny: false, at } as unknown as DexEvent },
]

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
