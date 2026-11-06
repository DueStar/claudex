# Claudex 인수인계 (구 Pokémon Office) (2026-11-06)

W17ant/Claude-Office를 포크한 개인용 Windows Electron 앱이다. 경로는 `Documents\pokemon-office`이고 git은 없다. 닌텐도 IP라 비공개로만 쓴다.

## 구조
- **앱 = 위젯**: 투명한 항상-위 창(`?widget`, `src/Widget.tsx`)이다.
  - 벤또 카드: 계정, 한도, 금액, 몬스터볼 던지기(파티에서 골라 세션 시작), 도감(박스 n/1200), 파티(세션별 교체·닫기), 지시 입력.
  - 포획 알림은 별도 최상단 창(`?toast`, `src/Toast.tsx`)이다. 터미널 폰트는 Monaspace Neon.
  - ⇤로 펼치면 터미널/도감 카드가 붙는다. 맵 창은 트레이에서만 연다.
- **터미널**: `electron/terminals.cjs`가 node-pty로 `claude --session-id <uuid> --settings <훅 파일>`을 실행한다.
  - 전역 설정은 건드리지 않고, 기본 폴더는 Documents다.
  - 이어하기는 `electron/history.cjs`가 맡는다.
  - 터미널이 끝나면 main이 `session_ended`를 보낸다.
- **IPC**: `preload.cjs`의 `window.pokeOffice`로 terminals, widget, cloud, env, toast, game(throw·release·swap)을 제공한다. 지시 전송은 IPC로만 한다.
- **서버**: 포트 3334에서 훅 이벤트를 받는다.
- **Windows 훅 수정**: 파이썬을 `hooks/agent-tracker.py`로 분리했고, 표준입력은 UTF-8, 출력 줄바꿈은 LF로 고정했다. 세션을 띄울 때 `CLAUDE_CODE_*` 환경변수를 제거한다.
- **폰트**: Uncut Sans Variable과 Pretendard Variable

## 게임 (`server/pokedex.js` → `~/.agent-office/pokedex.json` v2)
- **첫 실행**: 스타팅(1·4·7 중 무작위)과 진화 가능한 일반 기본형 5마리로 파티 6마리를 받는다.
- **세션 배정**: 쉬는 파티 포켓몬이 배정되고 스타팅이 먼저 나간다. 7번째 세션은 막고, 세션이 끝나면 포켓몬이 돌아온다.
- **성장**: 함께 일한 시간으로 레벨이 오른다(20→60분 곡선, 최대 100). 본가 진화 레벨에서 진화한다.
- **교체**: 쉬는 보유 포켓몬 아무나(`POST /pokedex/swap`). 세션별 포켓몬은 기억돼 이어하기에 쓰인다.
- **개체**: 성별(공식 gender rate), 성격(25종), 포획 경위 `via`(요청 앞 40자 + 도구·스킬 라벨, `catchSource`).
- **박스 상한 1200**: 꽉 차면 도감만 등록하고 개체는 박사님께(`toProfessor`). 도감에서 놓아주기(`/pokedex/release`, 파티·작업 중 불가).
- **조우**: 걸음당 3%다. 매일 첫 세션 이벤트에 **출석 조우**(미포획 종 확정 등장, 포획률은 평소대로)가 1회 있다. 지형은 도구로 정한다(Edit 풀숲, Bash 동굴, Read 숲, Web 하늘길, Agent 사파리존, mcp 발전소). 지형 타입은 3배, 밤에는 고스트·악·에스퍼가 더 잘 나온다.
- **확률(E안)**: 일반 74%(포획 90), 희귀 21%(75), 준전설 3.6%(50), 전설 1.0%(35), 환상 0.4%(30)
- **보정과 천장**: 미포획 종 8배, 전설 천장 150, 환상 천장 300(천장은 포획 확정), 이로치 1/4096
- **근거**: 시뮬레이션 기준 Max 약 10개월, Pro 약 2년이다(출석 전에는 약 5배 차이였다).
- **등급**: PokeAPI의 전설/환상 플래그와 상자 전설 목록, 포획률 45 기준으로 나눴다.

## 에셋과 데이터
- 1~1025번 HOME 일러스트를 여백을 자르고 128px로 맞췄다(`public/sprites/pokemon/art`, `art-shiny`, 40MB). 배정 전에는 `ball.png`를 쓴다.
- `src/pokemon/pokedex.json`(이름, 분류, 설명, 타입, 키, 세대, 등급)과 `server/pokemon-data.json`
- 스크립트: `tools/fetch-pokemon*.py`, `fetch-pokemon-art.py`, `build-map.py`, `build-icons.py`
- `src/theme.ts`
  - `displayHeight()`: 실제 키에 √를 적용한 표시 크기
  - 캐스팅: 세션은 서버 배정, 보스는 피카츄, 서브에이전트는 보유 포켓몬
  - 캐시 키: `pokemon-office-cast-v2`

## 빌드와 테스트
- 빌드: `npx vite build && npx electron-builder --win nsis --x64` → `release/`. winCodeSign 캐시는 수동으로 풀어둔 상태다.
- 설치 파일(nsis) 빌드는 `spawn UNKNOWN`으로 계속 실패한다. 임시 실행 파일 실행이 막히는 것으로 추정하며, Windows 보안이 원인일 가능성이 있지만 확인하지 않았다.
- 포터블 실행 파일은 켤 때마다 압축을 풀어서 너무 느리다. 대신 `--win dir`로 만든 `release/win-unpacked`를 `%LOCALAPPDATA%\Claudex`에 복사하고 바탕화면 `Claudex` 바로가기로 실행한다. 앱 이름은 **Claudex**로 바꿨다.
- 디버그: `AGENT_OFFICE_SCREENSHOT`, `POKEMON_OFFICE_CLAUDE=powershell.exe`, `POKEMON_OFFICE_AUTOTEST="cwd|지시"`, `_EXPAND`, `_KEYS`, `_JS`
- 격리 테스트: `AGENT_OFFICE_HOME=임시폴더 AGENT_OFFICE_PORT=3344 AGENT_OFFICE_UI_PORT=3345 node server/index.js`, 그리고 `AGENT_OFFICE_PORT=3344 npx vite --port 3345`
- 관련 테스트는 통과한다. 그 밖의 실패는 원본의 Windows 환경 문제다.

## 미결
1. 클라우드: Supabase(`server/cloud.js`, `server/cloud-config.json`, `supabase/schema.sql`) 구현 완료. 구글 로그인 실 테스트 대기.
5. 스마트 앱 컨트롤이 서명 없는 exe를 막는다 → 배포 전 코드 서명 필요(Azure Trusted Signing 등).
6. 제안 대기: 변하지않는돌·분기 진화 선택, 클라우드 저장 축소.
2. 출석 조우는 적용했다. 주간 탐험 보너스와 알 부화는 보류 중이다.
3. 맵 창은 도트, 위젯은 일러스트라 스타일이 섞여 있다(우선순위 낮음).
4. 배포: 비영리, 5만 명 이내. `electron/prereqs.cjs`가 Claude Code, Git, Python을 확인하고 없으면 설치 링크 카드를 띄운다. macOS는 나중에 한다. 로그인은 Supabase와 Google로 하며 콜백은 `127.0.0.1:3334/auth/callback`이다.
