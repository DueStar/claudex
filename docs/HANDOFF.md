# Claudex 인수인계 (2026-11-06, v1.3.2)

Claude Code 세션을 포켓몬과 함께 쓰는 Windows Electron 앱이다. W17ant/Claude-Office(MIT)를 포크했다.
- 경로: `Documents\pokemon-office`
- 저장소: https://github.com/DueStar/claudex (공개, main)
- 수집이 중심이고 배틀은 없다. 비영리이고, 사용자 5만 명 이내를 목표로 한다.

## 작업 원칙
- **push**: gh에 로그인된 DueStar 계정 토큰으로 한다. 기본 활성 계정(chanho-byte)은 바꾸지 않는다.
  `T=$(gh auth token -u DueStar); git -c credential.helper= -c "credential.helper=!f() { echo username=x-access-token; echo password=$T; }; f" push`
- **커밋 작성자**: DueStar / hoo2031@gmail.com. 커밋 끝에 Claude-Session 줄을 붙인다.
- **포켓몬·볼 그림은 저장소에 넣지 않는다**(DMCA 대비, .gitignore).
  - 포켓몬: 처음 볼 때 `server/sprites.js`가 PokeAPI HOME 그림을 받아 128px로 맞추고 `~/.agent-office/sprites`에 저장한다.
  - 볼: 빌드할 때 넣는다. 원본은 사용자가 손으로 받은 `~/Downloads/pokeball`이고 `node tools/import-balls.mjs <폴더>`로 가져온다. 결과는 `public/sprites/balls/`이며 gitignore 대상이다.
  - 볼 그림이 없으면 PokeAPI 아이템 아이콘을 쓰고, 그것도 없으면 `claudex-ball.png`(직접 그린 그림)를 쓴다.
- **Bulbagarden Archives는 자동 다운로드를 막는다(403).** 우회하지 않는다.
- **비밀 정보**: Supabase service/secret 키와 Google client secret은 받지 않는다. 공개 키만 `server/cloud-config.json`에 둔다.
- **배포·릴리스·공개 작업은 사용자 확인 후에 한다.**
- **시험 실행은 격리한다**: `AGENT_OFFICE_HOME=<임시 폴더> AGENT_OFFICE_PORT=3344`로 띄우고, Vite도 `AGENT_OFFICE_PORT=3344 npx vite --port 3333`로 띄운다(실제 서버 3334에 붙지 않게).
  - 캡처: `AGENT_OFFICE_SCREENSHOT`
  - 디버그 변수: `POKEMON_OFFICE_AUTOTEST(_EXPAND/_KEYS/_WIDGET_JS)`, `POKEMON_OFFICE_CLAUDE=powershell.exe`

## 빌드·업데이트
- **빌드와 릴리스**: `node scripts/release.mjs "노트" [--publish]`
  1. vite 빌드와 `electron-builder --win dir`를 실행한다.
  2. 볼 그림이 있으면 앱 아이콘을 공식 몬스터볼로 만들고, 빌드가 끝나면 `git checkout`으로 직접 그린 아이콘으로 되돌린다.
  3. `build-info.json`(빌드 날짜)을 넣는다.
  4. `release/`에 `claudex-app-<v>.zip`(앱 부분, 약 42MB), 전체 zip(약 152MB), `latest.json`을 만든다.
- **NSIS 설치 파일은 `spawn UNKNOWN`으로 실패한다.** 그래서 설치는 `release/win-unpacked`를 `%LOCALAPPDATA%\Claudex`로 robocopy하고 바탕화면 `Claudex.lnk`로 실행한다.
- **앱 안 업데이트**(`electron/updater.cjs`):
  - GitHub `releases/latest/download/latest.json`을 확인하고 sha256을 검증한다.
  - 앱을 끈 뒤 PowerShell이 `resources\app`을 교체하고 다시 실행한다.
  - **로컬 채널**: `~/.agent-office/update-dir`에 `release` 폴더 경로를 적어 두었다. 1분마다 확인하고, 같은 버전이라도 빌드 날짜가 더 새로우면 업데이트로 본다.
  - **exe는 바뀌지 않는다.** 아이콘처럼 exe에 들어가는 변경은 전체 설치가 필요하다.
- **스마트 앱 컨트롤**: 서명이 없어서 막힌다. 해결하려면 코드 서명이 필요하다(Certum 오픈소스 인증서가 현실적). 아직 구매하지 않았다.

## 구조
- **electron**
  - `main.cjs`: 위젯 창이 곧 앱이다. 모드는 위젯 / 창 / 전체화면(workArea)이다. 알림 창, IPC guard. 크기 조절은 화면에 보이는 창의 요청만 받는다.
  - `terminals.cjs`: node-pty로 `claude --session-id --settings <훅 파일>`을 실행한다. 세션 이름을 바꿀 수 있다.
  - `updater.cjs`, `history.cjs`, `prereqs.cjs`
- **server**
  - `index.js`: 127.0.0.1:3334
  - `pokedex.js`: 게임 로직
  - `sprites.js`, `cloud.js`(Supabase와 Google 로그인. 동작한다)
  - `balls.json`
  - `pokemon-data.json`: 이름, 타입, 등급, 포획률, 성비, 스피드, 몸무게(kg), 진화 레벨(evolveLevel/How)
- **src**
  - `Widget.tsx`: 사용량(5시간·주간) 카드, New session, 파티, 세션 줄(이름 바꾸기, Lv 표시), 지시 입력
  - `components/`: TerminalPanel(xterm WebGL, Ctrl+클릭 링크, 파일 끌어놓기, Shift+Enter=ESC+CR, 이미지 붙여넣기), PokedexView(빨간 점은 열어보지 않은 포켓몬), BoxView, Icons
  - `Toast.tsx`, `pokedexStore.ts`
- **tools**
  - `fetch-pokemon*.py`: traits, stats, evolution
  - `import-balls.mjs`, `build-icons.py`, `simulate-balls.mjs`(실제 코드로 1년 시뮬레이션)
- **디자인**
  - 노랑 강조색 #f2c94c와 검은 글씨. 꽉 찬 노랑은 보내기 버튼에만 쓴다.
  - 폰트: Uncut Sans, Pretendard. 터미널은 Monaspace Neon에 한글은 Pretendard.

## 게임 규칙 (server/pokedex.js)
- **시작**: 스타팅(1·4·7)과 파티 6마리를 받는다. 세션은 최대 6개이고, New session에서 파티 포켓몬을 골라 던진다.
- **조우**: 도구 호출 1번이 1걸음이다. 걸음당 3%이고, 매일 첫 세션에 아직 못 잡은 종이 확정으로 나온다(출석).
  - 지형은 도구로 정한다(Edit 풀숲, Bash 동굴, Read 숲, Web 하늘길, Agent 사파리존, mcp 발전소). 밤에는 고스트·악·에스퍼가 잘 나온다.
- **등급**: 일반 74, 희귀 21, 준전설 3.6, 전설 1.0, 환상 0.4.
  - "희귀"는 공식 등급이 아니라 포획률 45 이하를 기준으로 정한 것이다.
  - 천장은 전설 150, 환상 300이다. **화면과 README에는 드러내지 않는다**(사용자 결정). 이로치 1/4096, 못 잡은 종 ×8.
  - **재포획 감소**: 잡은 횟수만큼 ×0.9^n.
- **개체**: 성별, 성격, 잡은 경위(via), 볼, 레벨이 있다. 박스는 최대 1200이고, 넘치면 박사님께 보낸다. 놓아주기와 파티 교환을 할 수 있다.
- **레벨**: 야생은 Lv.1~55(진화 단계·등급별)로 만난다. 함께 일한 시간으로 레벨이 오른다(도구 호출 간격, 5분 넘는 쉬는 시간 제외).
  - 레벨당 걸리는 시간은 20분에서 60분까지 곡선이고, Lv.100까지 약 55시간이다.
- **진화**: 레벨업할 때만 일어난다(`evolutionFor`).
  - 본가 레벨 진화(347건)는 그 레벨에 진화한다.
  - 친밀도 등 레벨업 조건형(`level-up`)은 내가 레벨을 20(`BOND_LEVELS`) 올린 뒤 진화한다.
  - 통신 진화는 `traded` 표시가 있을 때 진화한다. swap이나 exchange를 하면 표시가 붙는다.
  - 돌 진화와 그 밖의 진화는 Lv.30/40이다.
  - 이브이: Lv.30부터 친밀도 최대면 낮은 에브이, 밤은 블래키. 숲은 리피아, 동굴+밤은 글레이시아, 그 밖에는 돌 3종 중 무작위다.
- **볼** (balls.json, 합계 100%)
  - 흔한 볼 60, 특수 볼 29.4, 규격 외 볼 8.4, 한정 볼 2.0(사파리 1.2, 울트라볼 0.8), 마스터볼 0.2. 전설·환상은 마스터볼 1%.
  - 이벤트 볼(컴퍼티션·파크·드림·프레셔스)은 야생에서 나오지 않는다.
  - 상황 배율(`ballBoosts`):
    - ×3: 네트·다이브(타입), 리피트, 다크(밤·동굴), 프리미어(그날 10번째 포획), 레벨, 러브러브, 문(보름달 밤), 사파리, 루어(Grep·Glob), 스피드 100+
    - 네스트: ×3 → ×0.5(야생 레벨)
    - 타이머: ×0.5 → ×3(세션 2시간). 퀵은 첫 조우 ×3, 이후 타이머의 반대
    - 럭셔리·프렌드: 함께 올린 레벨 10이면 ×1.5, 20이면 ×2
    - 헤비: 100 / 200 / 300kg
    - 울트라볼: 울트라비스트 ×50
- **시뮬레이션**(Max 하루 약 357걸음, Pro 약 71걸음)
  - 포획: Max 약 3500, Pro 약 970마리/년
  - 볼 순위: 몬스터 26%, 슈퍼 15%, 하이퍼 8%, 그다음이 리피트·타이머·다크·네스트·퀵 4~6%
  - 마스터볼 환상 포켓몬: Max 약 8년, Pro 약 17년에 한 번

## 남은 일과 결정 대기
1. **나중에 할 일**
   - 진화의 돌 아이템: 조우나 출석에서 돌을 얻어 쓰는 방식. 지금은 돌 진화를 Lv.30(두 번째 40) 고정으로 둔다.
   - 님피아(700) 진화 경로: 지금은 진화할 방법이 없다. 돌 아이템을 할 때 같이 정한다.
   - 이벤트 볼(컴퍼티션·파크·드림·프레셔스) 지급 방식: 아직 정하지 않았다.
2. **로컬 업데이트 버튼**: 실제로 눌러서 확인한 적이 아직 없다. 이제부터 Claudex 안에서 작업하므로 첫 빌드 때 확인한다.
3. 1.3.2에서 넣은 것
   - 레벨업 알림
   - 위젯 질문 패널: `terminals.cjs`의 ASKING 정규식으로 출력을 감지하고, Enter나 Esc를 누르면 사라진다
   - 터미널 글자 크기(`src/termFont.ts`)
   - 오늘 기록 탭(`TodayLog`, publicState.today)
   - 디자인 QA 페이지(`?qa`, 트레이 메뉴, `QaPage.tsx`)
   - 나중에 할 일: 설정 페이지(글자 크기 등을 한곳에 모으기)
   - 캡처 팁: Claudex 터미널 안에서는 Electron 출력이 보이지 않는다. 오프스크린 paint 방식으로 캡처한다.
4. **코드 서명**: 사용자는 비용을 쓸 수 없다. 무료로 할 수 있는 건 SignPath Foundation(오픈소스 무료 서명, 심사 있음, 포켓몬 IP 때문에 승인 불확실)뿐이다. 그 전까지는 서명 없이 배포하고 README에 SmartScreen 안내를 둔다. NSIS 수정도 남아 있다. macOS와 리더보드는 나중에 한다. 클라우드 저장 축소는 사용자가 고민 중이다.
5. **이벤트 볼 지급 방식**(업적 보상 등)은 아직 미정이다.
6. **같은 세션을 일반 터미널과 Claudex에서 동시에 이어 열지 않는다**(기록이 섞인다).
