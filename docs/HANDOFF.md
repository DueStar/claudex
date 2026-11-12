# spawn(옛 이름 Claudex) 인수인계 (2026-11-12, v1.3.42)

Claude Code 세션을 포켓몬과 함께 쓰는 Windows Electron 앱이다. W17ant/Claude-Office(MIT)를 포크했다.

> **새 세션은 여기부터**: 최신 릴리스 1.3.42(2026-11-12): 나란히 크기 조절할 때 터미널 빈 화면 해결, 업데이트 재시작 1단계, 일하는 세션 빛 GPU로, 도감 빈 칸 숨김, 종료 flush 재시도(7-35). 그 전 1.3.41: 바로가기·작업 표시줄 아이콘이 업데이트를 따라감, 여러 크기 .ico로 선명하게, 패널 로고 캐시 문제, 고르지 않은 일하는 세션 회색 빛(7-34). 그 전 1.3.40: PC를 꺼도 다시 열 세션 목록 유지(7-32), 여행의 시작 친구 몬스터볼 기록·1~9세대 스타팅(7-33). 그 전 1.3.39(2026-11-11): 새 몬스터볼 아이콘(비스듬한 Dream 볼), 헤더 워드마크 spawn 복귀, 기록 화면 빈 문제 수정, 박스 칸 Lv·볼 뺌, 확률 표 비공개, 접힌 레일 구분선·프로필(7-31). 그 전 1.3.38: 모든 아이콘 Dream 몬스터볼(커밋함, NOTICE), 새 세션 버튼 +, 왼쪽 패널 이름 없앰·구분선 끝까지, 닫기 문구, 세 색 → 노랑 한 색(7-30). 그 전 1.3.37: 몬스터볼 아이콘 통일(Wikimedia CC BY-SA 4.0), 창 크기 조절 깜빡임 수정, 탭 옅은 색·일하는 세션 도는 테두리, 패널 접기 버튼 위치·호버(7-29). 그 전 1.3.36: **이름이 Claudex → spawn**(저장소 `DueStar/spawn`, 데이터 `~/.spawn`·`%APPDATA%\spawn`, 환경 변수 `SPAWN_*`, 7-28) + 조우 줄이기(7-27). 그 전 1.3.35: 앱 안 피드백, 도감 등급 다중 선택(7-26). 그 전 1.3.34: 탭 닫기·셸 버튼·랭킹 1~3위, 왼쪽 패널 접기, 업데이트 안내·시간 기록(7-25). 다음은 업데이트 재시작 수치 읽기(8번).
> 최근 변경은 아래 7-23~7-34(1.3.32~1.3.41). **다음은 8번**: 1.3.42 사용자 확인(터미널 빈 화면·빛), 그다음 업데이트 때 재시작 수치 읽기, 중복 → 새 종(사용자: "좀 더 생각해 보자"). 이름은 1.3.36부터 spawn(7-28, 옛 이름 호환 규칙은 그 항목).
> 작업 방식(사용자 요청): 무엇이든 superpowers로 계획부터 보여 주고 승인 뒤 실행, 작업마다 테스트 먼저, 리뷰 에이전트로 검토.
- 경로: `Documents\pokemon-office`
- 저장소: https://github.com/DueStar/claudex (공개, main)
- 수집이 중심이고 배틀은 없다. 비영리이고, 사용자 5만 명 이내를 목표로 한다.

## 작업 원칙
- **push**: DueStar 계정으로만 한다. chanho-byte는 이 프로젝트에 쓰지 않는다. 토큰을 직접 꺼내지 말고 gh를 자격 증명 도우미로 쓴다.
  `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin main`
- **커밋 작성자**: DueStar / hoo2031@gmail.com(저장소 로컬 설정). 커밋 끝에 Co-Authored-By 줄을 붙인다.
- **테스트 판단 기준**: `npm test`가 Windows에서도 전부 통과해야 한다(2026-11-10 기준 512 통과 / 10 건너뜀, `npx tsc --noEmit -p .`도 0). 파일 권한·getuid·심링크·pid 1처럼 Windows에 없는 것을 보는 검사만 이유를 적고 건너뛴다(Linux CI에서는 돈다). 실패가 하나라도 있으면 새로 생긴 것이다.
- **포켓몬·볼 그림은 저장소에 넣지 않는다**(DMCA 대비, .gitignore).
  - 포켓몬: 처음 볼 때 `server/sprites.js`가 PokeAPI HOME 그림을 받아 128px로 맞추고 `~/.claudex/sprites`에 저장한다.
  - 볼: 빌드할 때 넣는다. 원본은 사용자가 손으로 받은 `~/Downloads/pokeball`이고 `node tools/import-balls.mjs <폴더>`로 가져온다. 결과는 `public/sprites/balls/`이며 gitignore 대상이다.
  - 볼 그림이 없으면 PokeAPI 아이템 아이콘을 쓰고, 그것도 없으면 `claudex-ball.png`(직접 그린 그림)를 쓴다.
- **Bulbagarden Archives는 자동 다운로드를 막는다(403).** 우회하지 않는다.
- **비밀 정보**: Supabase service/secret 키와 Google client secret은 받지 않는다. 공개 키만 `server/cloud-config.json`에 둔다.
- **배포·릴리스·공개 작업은 사용자 확인 후에 한다.** "푸시해"는 버전 올리기 + CHANGELOG + 커밋·푸시 + `release.mjs --publish`까지다.
- **패치노트와 개발 기록을 나눈다**(사용자 결정, 2026-11-08):
  - `CHANGELOG.md`의 Claudex 절은 **앱 안 패치노트 창과 GitHub 릴리스 본문에 그대로 나가는 유저용 글**이다. 유저가 화면에서 체감하는 변화만 쓴다("~해요" 말투).
  - 내부 구조, 최적화, 수용 인원 같은 숫자, 확률 상수, 보장 조우(천장) 같은 규칙은 쓰지 않는다. 그런 것은 이 문서에 남긴다.
- **시험 실행은 격리한다**: `CLAUDEX_HOME=<임시 폴더> CLAUDEX_PORT=3344`로 띄우고, Vite도 `CLAUDEX_PORT=3344 npx vite --port 3333`로 띄운다(실제 서버 3334에 붙지 않게). 1.3.13부터 환경변수는 `CLAUDEX_*`만 읽는다(예전 `AGENT_OFFICE_*`·`POKEMON_OFFICE_*`는 지웠다. 데이터 폴더 `~/.agent-office` → `~/.claudex` 이전은 폴더 경로라 그대로 있다).
  - 캡처: `CLAUDEX_SCREENSHOT`(투명한 알림 창은 빈 그림이 나온다)
  - 디버그 변수: `CLAUDEX_AUTOTEST(_EXPAND/_KEYS/_WIDGET_JS)`, `CLAUDEX_CLAUDE=powershell.exe`, `CLAUDEX_FAKE_MISSING=claude,git`, `CLAUDEX_QA=1`(설치본 트레이에 QA 페이지)
  - **화면이 바뀌면 안 되는 정리 작업은 픽셀 비교로 검증한다**(5단계에서 쓴 방법): 격리 서버(3344)와 Vite(3333)를 띄우고, 작은 Electron 스크립트로 창 모드 두 너비와 위젯 모드의 도감·박스(선택 포함)·기록, QA 페이지 전체를 찍는다. 정리 전후 PNG를 `nativeImage.toBitmap()`으로 비교한다. 바꾸지 않고 두 번 찍었을 때의 차이는 0.05% 이하다. 다만 QA 마지막 화면은 페이지 길이가 그때그때 달라 50% 안팎이 나온다. 세션 줄은 테스트 데이터에 세션이 없어서 비교에 안 잡히니 따로 본다.

## 빌드·업데이트
- **업데이트 서명**(1.3.8부터): `latest.json`을 Ed25519 키로 서명하고, 앱은 `electron/update-key.cjs`의 공개 키로 확인한다(GitHub에서 받은 것만, 로컬 채널은 확인하지 않음). **개인 키는 이 PC의 `%USERPROFILE%\.claudex-release\signing-key.pem`에만 있다. 꼭 백업한다.** 다른 PC에서 릴리스하려면 이 파일을 옮기거나 `CLAUDEX_SIGNING_KEY`로 경로를 준다. 잃어버리면 새 키를 만들어야 하고(`scripts/signing-key.mjs`), 그러면 이미 설치된 앱은 앱 안 업데이트를 못 받아서 전체 zip으로 다시 설치해야 한다.
- **빌드와 릴리스**: `node scripts/release.mjs [--publish]` — `--publish`는 빌드 전에 한 번에 점검하고 하나라도 아니면 멈춘다: gh가 DueStar인지, 커밋 안 한 변경이 없는지, origin/main이 HEAD와 같은지(푸시 먼저), 태그가 아직 없는지, CHANGELOG에 버전 절이 있는지, 볼 그림 27종, 서명 키. 노트는 CHANGELOG.md의 `### <버전>` 절을 UTF-8로 직접 읽는다. 셸로 한글 노트를 넘기면 cp949로 깨진다(1.3.6에서 실제로 깨져서 릴리스 본문과 latest.json을 다시 올렸다).
  1. vite 빌드와 `electron-builder --win dir`를 실행한다.
  2. 볼 그림이 있으면 앱 아이콘을 공식 몬스터볼로 만들고, 빌드가 끝나면 `git checkout`으로 직접 그린 아이콘으로 되돌린다.
  3. `build-info.json`(빌드 날짜)을 넣는다.
  4. `release/`에 `claudex-app-<v>.zip`(앱 부분, 약 42MB), 전체 zip(약 152MB), `latest.json`을 만든다.
- **NSIS 설치 파일은 `spawn UNKNOWN`으로 실패한다.** 그래서 설치는 `release/win-unpacked`를 `%LOCALAPPDATA%\Claudex`로 robocopy하고 바탕화면 `Claudex.lnk`로 실행한다.
- **앱 안 업데이트**(`electron/updater.cjs`):
  - GitHub `releases/latest/download/latest.json`을 확인하고 sha256을 검증한다.
  - 재시작하면 `pending-update.json`을 남기고 `app.relaunch`한다. 다음 시작 때 main.cjs 맨 앞(`applyPendingUpdate`)에서 robocopy로 `resources\app`을 교체하고 한 번 더 relaunch한다. 결과는 `userData/update.log`에 남는다. 앱이 꺼진 뒤 외부 PowerShell로 교체하는 방식은 Windows에서 실행되지 않아 버렸다(detached면 아예 실행되지 않고, attached면 앱과 같이 죽는다).
  - 수동 설치: `scripts\install-local.cmd`(Claudex를 닫고 `release\win-unpacked`를 설치한 뒤 실행한다).
  - **로컬 채널**: `~/.claudex/update-dir`에 `release` 폴더 경로를 적어 두었다. 1분마다 확인하고, 같은 버전이라도 빌드 날짜가 더 새로우면 업데이트로 본다.
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
- **시작**: 스타팅(1·4·7)과 파티 6마리를 받는다. 세션은 최대 12개(`SESSION_LIMIT`)다. 파티 6마리가 다 나가 있으면 박스 포켓몬이 "조력자"로 맡는다(7-22). 셸 탭(최대 3)은 포켓몬 없이 연다.
- **조우**: 도구 호출 1번이 1걸음이다. 일하는 중(main.state working)에 1분 동안 도구 호출이 없으면 생각 걸음 1번이다(`tick`, 서버가 2초마다 부른다).
  - 걸음은 세션별 대기열에서 8초(`STEP_SPACING_MS`)마다 하나씩 처리한다. 걸음당 3%이고, 매일 첫 세션에 아직 못 잡은 종이 확정으로 나온다(출석).
  - **출석 조우에는 전설·환상이 나오지 않는다**(1.3.11, 사용자 결정). 등급은 일반·희귀·준전설만 비율대로 굴린다. 그날 천장이 차도 출석에서는 쓰지 않고 다음 야생 조우로 넘긴다. 전설·환상만 남으면 출석 조우는 없다.
  - 지형은 도구로 정한다(Edit 풀숲, Bash 동굴, Read 숲, Web 하늘길, Agent 사파리존, mcp 발전소). 밤에는 고스트·악·에스퍼가 잘 나온다.
- **등급**: 일반 74, 희귀 21, 준전설 3.6, 전설 1.0, 환상 0.4.
  - "희귀"는 공식 등급이 아니라 포획률 45 이하를 기준으로 정한 것이다.
  - 천장은 전설 150, 환상 300이다. **화면과 README에는 드러내지 않는다**(사용자 결정). 이로치 1/4096, 못 잡은 종 ×8.
  - **잡힐 확률**(`CATCH`, 2026-11-12부터): 일반 80%·희귀 70%·준전설 50%·전설 40%·환상 30%(도망 20/30/50/60/70%, 사용자: "포획률이 너무 높아 보여"). 그 전엔 90/75/50/35/30. 보장 만남은 항상 잡힘, 볼 종류는 확률과 무관. 시뮬레이션(하루 30번, 지금 169종): 전설 완료 약 11% 빨라짐, 900종·비전설 완료는 4~7일 늦어짐, 전체 완성(끝은 환상 보장 300)은 그대로.
  - **재포획 감소**: 같은 등급 안에서만, 잡은 횟수만큼 ×0.9^n, 하한 0.3(`RECATCH_FLOOR`, 약 11번째부터). **등급 확률은 고정이다.**
    - 2026-11-08에 "전체 기준 감쇠"(많이 잡은 등급의 몫이 전설·환상으로 넘어가는 방식)를 시험했다. 효과가 작아서(0.9면 나머지를 다 모았을 때 전설+환상 1.4% → 1.8%) 사용자가 등급 안 감쇠 + 하한으로 결정했다.
    - 끝판(전설·환상만 남은 단계)을 줄이는 방법은 검토만 하고 넣지 않았다. 확률 ×3은 효과가 거의 없고, 천장을 줄이거나 천장이 "못 잡은 종 확정"을 데려오게 하는 쪽이 효과가 크다. 이벤트성 보정은 사용자가 직접 정한다.
  - **완성 기간**(시뮬레이션 중앙값, 매일 사용, 진화 제외): 하루 조우 30번(많이 쓰는 날의 실제 값)이면 50%까지 22일, 90%까지 약 70일, 완성까지 약 11개월. 하루 8번이면 완성까지 약 3.9년.
    - 800종 시점에는 희귀가 가장 많이 남는다(희귀 약 210/370, 전설 6/25, 환상 3/23). 전설·환상만 남는 건 1000종쯤부터이고, 그 24종에 전체 기간의 절반 이상이 걸린다.
    - 시뮬레이터는 세션 스크래치패드에서 만든 일회용이다. 다시 하려면 `server/pokedex.js`의 rollTier, pickSpecies, 포획, 천장, 출석 규칙을 그대로 옮겨서 돌린다.
- **개체**: 성별, 성격, 잡은 경위(via), 볼, 레벨이 있다. 박스는 최대 1200이고, 넘치면 박사님께 보낸다. 놓아주기와 파티 교환을 할 수 있다.
- **레벨**: 야생은 Lv.1~55(진화 단계·등급별)로 만난다. 함께 일한 시간으로 레벨이 오른다(도구 호출 간격, 5분 넘는 쉬는 시간 제외).
  - 레벨당 걸리는 시간은 20분에서 60분까지 곡선이고, Lv.100까지 약 55시간이다.
- **진화**: 레벨업할 때만 일어난다(`evolutionFor`).
  - 본가 레벨 진화(347건)는 그 레벨에 진화한다.
  - 친밀도 등 레벨업 조건형(`level-up`)은 내가 레벨을 20(`BOND_LEVELS`) 올린 뒤 진화한다.
  - 통신 진화는 `traded` 표시가 있을 때 진화한다. swap이나 exchange를 하면 표시가 붙는다.
  - 돌 진화와 그 밖의 진화는 Lv.30/40이다.
  - 이브이: Lv.30부터 친밀도 최대면 낮은 에브이, 밤은 블래키. 숲은 리피아, 동굴+밤은 글레이시아, 그 밖에는 돌 3종과 님피아 중 무작위다(1.3.26).
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
   - 님피아(700) 진화 경로: 1.3.26부터 이브이의 무작위 진화 후보(돌 3종 + 님피아)에 들어감(사용자 결정).
2. **로컬 업데이트 버튼**: 실제로 눌러서 확인한 적이 아직 없다. 아래 "다음 할 일" 3번에서 확인한다.
3. 1.3.2에서 넣은 것
   - 레벨업 알림
   - 위젯 질문 패널: `terminals.cjs`의 ASKING 정규식으로 출력을 감지하고, Enter나 Esc를 누르면 사라진다
   - 터미널 글자 크기(`src/termFont.ts`)
   - 오늘 기록 탭(`TodayLog`, publicState.today)
   - 디자인 QA 페이지(`?qa`, 트레이 메뉴, `QaPage.tsx`)
   - 나중에 할 일: 설정 페이지(글자 크기 등을 한곳에 모으기)
   - 캡처 팁: Claudex 터미널 안에서는 Electron 창 캡처(`CLAUDEX_SCREENSHOT`)가 흰 화면으로 나온다. 오프스크린 paint 방식으로 캡처한다.
     - 격리 서버: `CLAUDEX_HOME=<임시 폴더> CLAUDEX_PORT=3344 node server/index.js` (먼저 `npx vite build`)
     - 캡처 앱: `tools/_cache/shot/`(gitignore, main.cjs + 가짜 브리지 preload.cjs). 토큰 주소는 인자로 넘기면 Git Bash에서 실행이 127로 실패하므로 환경변수로 넘긴다: `SHOT_URL="http://127.0.0.1:3344/?widget#token=<토큰>" SHOT_OUT=<png> npx electron tools/_cache/shot` (SHOT_W·SHOT_H·SHOT_JS, SHOT_VERSION은 가짜 업데이트 상태의 현재 버전)
4. **코드 서명**: 사용자는 비용을 쓸 수 없다. 무료로 할 수 있는 건 SignPath Foundation(오픈소스 무료 서명, 심사 있음, 포켓몬 IP 때문에 승인 불확실)뿐이다. 그 전까지는 서명 없이 배포하고 README에 SmartScreen 안내를 둔다. NSIS 수정도 남아 있다. macOS는 나중에 한다. 리더보드 계획은 7-9. 클라우드 동기화는 1.3.11에서 줄였다(아래 7-7).
5. **같은 세션을 일반 터미널과 Claudex에서 동시에 이어 열지 않는다**(기록이 섞인다).
6. **주기적인 "띵동" 소리** — 해결(2026-11-06, 462e17e). `electron/main.cjs`의 숨은 office 창(`show: false`)이 옛 office UI(`App.tsx`)를 돌리며 이벤트마다 `playNotification()`(880Hz→1100Hz)을 울렸다. 창과 UI를 통째로 걷어냈고 `/health`의 `clients`가 1이 됐다.

## 다음 할 일 (2026-11-06 집 PC 세션 끝, 순서대로)
이번 세션에서 한 일: 옛 office UI와 숨은 창 제거(462e17e), 서버·훅의 office 기능 제거와 better-sqlite3 삭제(2c9b529). 권한 대화상자가 15초~10분 늦던 문제, 사파리존이 안 나오던 문제, Windows에서 status-line이 CR만 보내던 문제도 함께 고쳤다. 테스트는 Windows 기준선 대비 새 실패 0(449 통과 / 55 실패, 남은 실패는 원래 있던 파일권한·심볼릭링크·uid 문제). 테스트할 때 `AGENT_OFFICE_PORT`는 바꾸지 않는다: 3344로 두면 `static-ui`의 3334 출처 테스트 3개가 403으로 실패해서 58이 된다. `AGENT_OFFICE_HOME`만 임시 폴더로 둔다.

1. **3단계: office 잔재 마저 제거**
   - 플러그인·설치기: `.claude-plugin/`, `commands/office.md`, `hooks/install-hooks.sh`(아직 19개 이벤트), `scripts/doctor.mjs`의 office 부분, 관련 테스트(`plugin`·`install-hooks`·`doctor`). 앱은 세션마다 `--settings`로 훅을 넣으므로 전역 설치기가 필요 없다. 지우기 전에 README의 플러그인 안내도 같이 정리한다.
   - 스크립트: `open-office.mjs`, `rotate-token.mjs`(남길지 결정), `check-assets.mjs`, `generate-icons/office-bg/sprites/walks.mjs`, `extract-boss-sprite.py`, `split-character.py`, `setup-character.md`, `gather-context.sh`, `sync-plugin-version.mjs`
   - `public/sprites`의 office 그림(appliances, characters, culture, decoration, effects, furniture, incident, map, 역할 PNG)
   - 1.3.7에서 지운 것: office 그림(`public/sprites`의 appliances·characters·culture·decoration·effects·furniture·incident·map·역할 PNG·ball.svg), 스크립트(check-assets·extract-boss-sprite·gather-context·generate-icons/office-bg/sprites/walks·setup-character·split-character), `docs/reference.md`·`docs/superpowers`·`docs/images`·`TEST_PLAN.md`·`office.config.example.json`·`tools/assets/tilemap.png`, CI의 check-assets 단계. 아래 남은 것은 아직이다.
   - `.github` 템플릿·워크플로, `package.json`의 scripts·repository·author(W17ant), `release.test`
   - 주석: `vite.config`, `serverUrl`, `officeToken`, `health`
   - README·CHANGELOG 갱신
2. **office → claudex 이름 바꾸기**(사용자 요청)
   - 식별자: `officeToken.ts`, `officeWsUrl`, `officeHttpBase`, `readOfficeToken`, `officeLink`, `officeProof`, 테스트의 `loadOffice`·`officeProtocols`
   - 환경변수: `CLAUDEX_*`로 바꾸고 `AGENT_OFFICE_*`도 계속 읽었다(1.3.13에서 예전 이름 읽기는 지움)
   - 프로토콜: `X-Office-*` 헤더, WS 서브프로토콜 `agent-office`, `office-health:`. 앱·서버·훅이 한 번에 같이 바뀌어야 한다(훅은 앱이 세션마다 넣으므로 같이 배포된다).
   - 데이터 폴더: `~/.agent-office` → `~/.claudex`. 첫 실행 때 자동으로 옮긴다(pokedex.json, 클라우드 세션, auth-token, update-dir). **도감 데이터가 사라지면 안 되므로** 옮기기 전에 백업하고 테스트로 확인한다.
   - 훅, 업데이터, electron의 `runtimeDirFromEnv`
3. **업데이트 버튼** — 원인 확인, 1.3.4 릴리스로 해결(2026-11-07)
   - 원인: GitHub 최신 릴리스가 v1.3.1이었고 설치본은 1.3.3이라 "최신"으로 판단했다. 로컬 채널 파일(`~/.agent-office/update-dir`)도 없었다. 위젯 버튼은 `status === 'available'`일 때만 뜬다(`src/Widget.tsx`).
   - **원칙(사용자 지시): 사용자가 "푸시해"라고 하면 버전 올리기 → `release.mjs` 빌드 → `git push` → GitHub 릴리스까지 한다.** push만 하고 멈추지 않는다.
   - `release.mjs --publish`는 이제 gh의 현재 로그인이 DueStar인지만 확인한다(`gh auth token`으로 토큰을 꺼내지 않는다).
   - 1.3.4를 올린 뒤에도 버튼이 안 뜬 이유: 앱이 켜진 채로 있었고 확인 주기가 6시간이었다(켠 뒤 15초에 한 번, 그 뒤 6시간마다). 1.3.5부터는 30분마다 확인하고, 트레이 메뉴 "업데이트 확인"으로 바로 확인할 수 있다. 최신이거나 확인에 실패하면 알림을 띄운다.
   - 이 대화(Claude Code)가 Claudex 터미널 안에서 돌 때가 많다. Claudex를 재시작하면 세션도 끊기니, 사용자에게 재시작을 부탁할 때는 작업을 먼저 끝낸다.
4. **포켓몬 교체 후 아이콘이 늦게 바뀌는 문제** — 1.3.7에서 해결. 교체를 누르면 바로 `castSession`으로 그림을 바꾸고(실패하면 되돌림), 교체 창이 열릴 때 후보의 SV 아이콘을 미리 받는다.
5. **세션 이름 유지** — 1.3.3에서 해결됨(2026-11-07 실제 `window-state.json`의 `sessionTitles`에 남는 것 확인).
6. **포켓볼 그림**(앱 안 볼, 설치 파일·작업표시줄 아이콘)
   - 원인: 볼 그림은 DMCA 때문에 `.gitignore`로 빠져 있고, 빌드하는 PC에 그림이 있어야 앱에 들어간다. 회사 노트북에는 있었지만 집 PC에는 없었다.
   - 집 PC `Downloads`에 `60px-Bag_*_SV_Sprite.png` 28개(60×60)가 있다. balls.json의 27종이 다 있고 Strange Ball 1개는 안 쓴다. 이벤트 볼도 받아만 둔다(`catch:false` 유지).
   - 한 일(2026-11-07): `import-balls.mjs`가 `60px-` 같은 썸네일 접두사를 떼고, 같은 볼이 두 크기로 있으면 원본을 고른다. 27종을 가져와 1.3.4에 넣었다.
   - 남은 일: 앱 아이콘. 아이콘은 512px로 만들기 때문에 256px보다 작은 포켓볼은 쓰지 않는다(흐려진다). 60px 썸네일뿐이라 지금은 그린 아이콘이 유지된다. 사용자가 원본 크기 `Bag_Poké_Ball_SV_Sprite.png`를 Bulbagarden "Original file" 링크로 직접 받아 `Downloads`에 두면(자동 다운로드·우회 금지) 가져오기 → 릴리스 빌드 → **전체 재설치**(exe 아이콘은 재설치해야 바뀐다).
   - **원칙: 릴리스는 볼 그림을 가져온 PC에서 만든다.** 볼 그림이 없으면 `release.mjs`가 크게 경고하고, `--publish`는 거부한다.
7. **재빌드와 재설치**(`%LOCALAPPDATA%\Claudex`). 띵동 소리가 안 나는지, `/health`의 `clients: 1`인지 확인한다. 1.3.4는 업데이트 버튼으로 받아서 업데이트 흐름도 같이 확인한다.
7-1. **세션 그림은 SV 박스 아이콘** — 1.3.5에서 적용(사용자 결정, 2026-11-07: 도감·박스는 HOME 그림, 터미널 옆 패널과 위 세션 탭은 SV 아이콘). 1.3.6에서 파티 줄과 도감 카드의 최근 잡은 포켓몬도 SV 아이콘으로 바꿨다. 교체·던지기 창과 알림은 HOME 그림 그대로다.
7-2. **1.3.6 추가**: 업데이트 후 첫 실행에 패치노트 창(`src/patchNotes.ts`, `PatchNotes.tsx`: CHANGELOG의 Claudex 부분을 앱에 넣고, 마지막으로 본 버전은 localStorage `claudex-seen-version`). 처음 보는 PC는 현재 버전만 보여준다. **그래서 CHANGELOG는 사용자에게 보이는 글이다: 릴리스마다 `### x.y.z`를 한글로 쓴다**(테스트가 package.json 버전 항목이 있는지 확인한다). 1.3.6의 직접 만든 스냅은 1.3.7에서 지웠다(아래 7-3).
7-3. **창 두 종류**(1.3.7, 사용자 결정 2026-11-07: "창 모드면 창이 떠 있는 걸 생각하지, 위젯 모드만 위젯"): 위젯 모드는 투명·항상 위·작업표시줄 없음, 창·전체 화면 모드는 불투명한 일반 창(`frame: false`라도 투명이 아니면 Windows 스냅·미리보기·크기 조절 테두리가 된다). 전체 화면 = 최대화(`maximize`/`unmaximize` 이벤트로 모드를 맞춘다). 투명 여부는 만든 뒤 못 바꾸므로 종류가 바뀌면 `swapAppWindow`가 새 창을 숨긴 채 만들어 첫 그림(`ready-to-show`)+120ms를 기다린 뒤 크로스페이드(옛 창 140ms, 새 창 200ms)하고 옛 창을 없앤다. 터미널은 main의 버퍼(세션당 20만 자)에서 다시 그려지고, 보던 탭·고른 세션·쓰던 지시는 `src/carry.ts`(localStorage `claudex-carry`)로 넘긴다. 페이지 주소의 `?widget&mode=<모드>`로 첫 그림부터 맞는 모드로 그린다. 창 최소 크기는 560×400(1/4 스냅용), 위젯은 300×540, 위젯 너비 상한 640(1.3.6이 스냅된 창 크기를 위젯 크기로 저장하던 것을 무시).
   - 개발 실행으로 확인하는 법: `CLAUDEX_PORT=3344 npx vite --port 3333 --strictPort`를 띄우고 `CLAUDEX_HOME=<임시> CLAUDEX_PORT=3344 CLAUDEX_AUTOTEST_EXPAND=1 CLAUDEX_SCREENSHOT=<png> npx electron .`. 창 캡처는 불투명한 창이면 Claudex 터미널 안에서도 된다(투명 위젯은 흰 화면). 개발 실행(`app.isPackaged`가 false)은 이제 `%APPDATA%\Claudex-dev`를 따로 쓴다(설치본의 창 상태·세션 이름·페이지 저장소를 건드리지 않는다).
   - `theme.ts`의 `iconUrl()`과 `sessionSprite()` → `/sprites/pokemon/icon/<id>.png` → `server/sprites.js`가 pokemondb에서 처음 쓸 때 받아 `<runtime dir>/sprites/icon/`에 둔다(잘라내기만 하고 키우지 않는다). 받지 못하면 HOME 그림으로 넘긴다. 그림은 각 PC가 직접 받으므로 Supabase 사용량과는 관계없다.
   - 종 번호 → 아이콘 이름은 `server/pokemon-icons.json`(`tools/fetch-pokemon-icons.py`로 생성). 폼이 있는 40종은 기본 폼 이름이다(`deoxys-normal` 등).
   - 이로치 아이콘은 없다. 이름의 ✨로 구분한다(`sessionName`).
   - 조사 기록:
   - 사용자가 원한 그림은 pokemondb.net/pokedex/all의 아이콘이다: `img.pokemondb.net/sprites/scarlet-violet/icon/<slug>.png`(스칼렛·바이올렛 박스 아이콘, 120×112, 왼쪽을 살짝 보는 외곽선 그림). 1025종이 다 있다.
   - 지금 앱은 `server/sprites.js`가 PokeAPI의 Pokémon HOME 그림(`sprites/pokemon/other/home`, 512px 정면 3D 렌더)을 받는다. `tools/fetch-pokemon-art.py`도 pokemondb의 `sprites/home`을 받는다.
   - 차이: SV 아이콘에는 이로치 버전이 없고(`icon/shiny/` 404), 실제 그림이 40~90px로 작아서 128px로 키우면 흐려진다. PokeAPI에는 SV 아이콘이 없어서 출처가 pokemondb로 바뀐다.
7-4. **푸시 권한과 남은 정리(2026-11-07)**
   - gh 로그인 토큰에 `workflow` 권한이 없어서 `.github/workflows/`를 바꾼 커밋이 거절됐다. 사용자가 `gh auth refresh -h github.com -s workflow`를 실행해 해결했고(2026-11-07), 빠졌던 `ci.yml` 정리는 e13c130으로 올렸다.
   - v1.3.7 태그는 릴리스를 만들 때 푸시가 실패해서 한 커밋 전(`ce97fd7`)에 붙었다. 앱 업데이트 파일은 1.3.7 코드로 빌드돼서 업데이트에는 문제가 없다. 사용자 승인을 받아 태그를 `5dffd22`로 옮겼다(태그 강제 푸시, 2026-11-07).
   - 교훈: `release.mjs --publish` 전에 `git push`가 성공했는지(`git status -sb`가 ahead 0인지) 꼭 확인한다.
7-5. **2026-11-07 밤 작업(1.3.7 뒤, 아직 릴리스 안 함)**
   - 도감을 대시보드로: 포획·발견·이로치·박스 칸(막대와 %), 등급별 포획 칸, 필터는 이름 붙은 묶음(세대 1~9 / 등급 / 보기 전체·잡은 것·못 잡은 것)과 이름·번호 검색(만난 종만 이름으로 찾힌다). 오른쪽 안내와 상세 정보도 칸으로. 박스 화면도 같은 필터·칸.
   - 왼쪽 패널의 최근 잡은 포켓몬과 파티 아이콘을 같은 크기(28px)·간격(6px)으로.
   - 안 쓰는 것 정리: 옛 위젯 CSS 약 150줄(하늘에 떠 있던 포켓몬, 통계 칸, 칩, 볼 그림 등)과 keyframes 6개, `GET /sprites/items`, `terminalForSession`, office 시절 이벤트 종류(agent_spawned 등 6개, 보내는 훅이 없다), 낡은 주석.
   - 개발 실행은 `%APPDATA%\Claudex-dev`를 쓴다.
   - 교훈: 서버 JS는 타입체크가 없어서 함수를 지울 때 `return { ... }` 같은 참조가 남아도 빌드가 통과한다. 전체 테스트를 기준선과 꼭 비교한다(이번에 20개가 새로 실패해서 잡았다).

7-6. **2026-11-07 개선점 12개 적용(1.3.7 뒤, 아직 릴리스 안 함)**
   - **훅이 Python 없이 돈다**: `hooks/claudex-hook.cjs`(이벤트 만들기, 예전 `agent-tracker.py`를 그대로 옮김)와 `hooks/status-line.cjs`, 둘이 쓰는 `hooks/post.cjs`(서명·POST). 세션 설정(`electron/terminals.cjs`)이 `ELECTRON_RUN_AS_NODE=1 "<Claudex.exe>" "<스크립트>"`로 부른다. Claude Code는 훅을 Git Bash에서 돌리므로 POSIX 형식이다. 실제 `claude -p` 세션으로 훅 7건이 서명된 채 들어오는 것을 확인했다. 필요 프로그램 검사에서 Python을 뺐다(Claude Code·Git만).
   - **office 잔재 제거**: 플러그인(`.claude-plugin`, `commands/`), 전역 설치기(`install-hooks.sh`, `hooks.json`), `doctor`·`open-office`·`rotate-token`·`sync-plugin-version`, office 시절 `release.yml` 워크플로, 관련 테스트. package.json의 저장소·작성자·스크립트, 이슈 템플릿, README·CONTRIBUTING도 Claudex로.
   - **이름 바꾸기**: 데이터 폴더 `~/.claudex`(`server/runtime-dir.cjs`). 첫 실행 때 `~/.agent-office`를 임시 폴더에 통째로 복사한 뒤 이름을 바꿔 넣는다. 옛 폴더는 지우지 않고 `MOVED-TO-CLAUDEX.txt`만 남긴다. 복사가 끝나기 전(실패 포함)에는 옛 폴더를 계속 쓰므로 도감이 빈 채로 시작할 일이 없다. 이 PC의 실제 데이터는 1.4MB. 환경변수 `CLAUDEX_*`(예전 이름도 읽음), 헤더 `X-Claudex-*`, WS 서브프로토콜 `claudex`, `claudex-health:`. `src/officeToken.ts` → `serverToken.ts` 등 식별자.
   - **클라우드 동기화 합치기**(`server/merge.js`, 에이전트 작업 + 검토): uid는 PC마다 따로 매기므로 개체는 "처음 받은 uid + 잡을 때 정해진 정보(시각·경위·장소·볼·만난 레벨·이로치)"(`pokedex.js` `monKey`)로 알아본다. 겹치면 먼저 잡은 쪽이 uid를 갖고 다른 쪽은 새 uid와 `originUid`. 도감은 종별 합집합(횟수는 최대, 첫 날짜는 이른 쪽). 파티는 이 PC 것. 박스 1200을 넘으면 최근 포획부터 박사님께(기록에 남김). 합치기 전 게임은 `pokedex.json.before-sync`. **놓아준 개체는 `state.released`(최근 5000)에 남겨서 다음 동기화가 클라우드 사본에서 되살리지 않게 했다**(검토 중 찾은 버그: PC 한 대에서도 놓아주기가 안 먹혔다).
   - **업데이트 서명·릴리스 점검**: 위 "빌드·업데이트" 참고. 1.3.7 설치본은 서명을 확인하지 않으므로 1.3.8은 그대로 받는다.
   - **로그**: `userData/logs/claudex.log`(1MB 넘으면 `claudex.old.log`), main 콘솔·서버 출력·페이지 오류·렌더러 종료. 트레이 "로그 폴더 열기".
   - **첫 화면**: 페이지별 지연 로딩(알림 창은 자기 코드만), 터미널·도감·박스·기록은 별도 조각을 위젯이 뜬 직후 미리 받는다. 도감 설명문은 빌드 때 따로 떼어 낸다(`vite.pokedex.ts`, `virtual:pokedex`·`virtual:pokedex-text`). 첫 조각 954KB → 146KB.
   - **도감 그리드**: 화면 밖 칸은 그리지 않음(`content-visibility`, 박스도), 방향키·Home·End로 이동(탭 정지는 하나), 창 전환 뒤에도 스크롤 위치 유지.
   - **창 전환**: 패치노트는 띄우는 순간 본 것으로 기록(전환해도 다시 안 뜸), 지시 입력 저장은 300ms마다 묶어 쓰고 전환 직전에 바로 쓴다.
   - **파일 나누기**: `server/index.js` 1793 → 1492줄(`auth.js`·`guards.js`·`events.js`·`ws-protocol.js`), `Widget.tsx`에서 교체·던지기 창을 `components/PartyPickers.tsx`로. **남은 것**: `server/index.js`의 main 상태 기계와 `processEvent`(약 600줄), `electron/main.cjs`의 창 관리(약 1050줄, `electron-helpers.test`가 main.cjs 소스 문자열을 검사하므로 옮기면 그 테스트도 같이 고쳐야 한다).
   - **Windows 테스트**: 위 "테스트 판단 기준". 레지스트리 테스트 2개는 Windows 문제가 아니라 게임·health 방송이 섞여서 깨져 있던 것이라 기대값을 고쳤다. CI는 windows-latest와 ubuntu-latest.
   - **남은 제약**: 놓아주기를 뺀 "지움"(예: 다른 PC에서의 진화 취소 같은 것)은 없다. 같은 개체를 두 PC에서 동시에 키우면 큰 쪽 걸음 수가 이긴다(더하지 않음).

7-7. **2026-11-08 작업(1.3.9 ~ 1.3.11)**
   - **1.3.9**: 세션 이름이 처음부터 기본("새 세션", 포켓몬 이름은 옆). `Ctrl+Alt+←/→`로 터미널·도감·박스·기록 차례 이동(xterm·도감 그리드가 화살표를 가져가지 않게 window 캡처 단계에서 `stopPropagation`).
   - **1.3.10**:
     - 위젯 "Claudex" 글자를 누르면 패치노트 전체(`PatchNotesHistory`). 머리 영역이 창 끌기 영역이라 그 글자만 `no-drag`.
     - **사용량 저장**: 5시간·주간 사용량은 Claudex 안에서 도는 세션의 상태줄로만 들어온다. 그래서 세션이 없거나 앱을 다시 켜면 비었다. 이제 마지막 값을 `~/.claudex/usage-limits.json`에 저장하고(`server/status.js` `limitsFile`), 스냅샷·`session_status`의 `rateLimits`로 보낸다. 화면에서는 리셋 시각이 지난 값을 0%로 본다(`meters.ts` `limitNow`).
     - 기록 탭은 저장된 log(최근 600건, `LOG_LIMIT`) 전체를 날짜별로 보여준다. 600을 늘리면 도감 방송마다 통째로 가므로 2000 정도가 상한이다.
     - 도감·박스 칸은 `minmax(…, 1fr)` + `aspect-ratio: 1`. 도감 칸의 `overflow: hidden`이 있으면 행 높이가 칸을 못 따라가서 겹친다(`overflow: visible`로 둠).
     - 대시보드에서 이로치 칸을 뺐고, 등급별 포획은 5열. "이로치" 대신 공식 용어 "색이 다른 포켓몬"(✦)을 쓴다. 박스 오른쪽 창은 고를 때만 열린다. 지시 입력칸은 포켓몬 이름으로 부르는 문구 3개 중 무작위.
   - **1.3.11**:
     - 출석 조우에서 전설·환상 제외, 재포획 하한 0.3(위 "게임 규칙").
     - **클라우드 동기화를 줄였다**(`server/cloud.js`). Supabase 무료 플랜은 DB 500MB, 내려받기 전송량 월 5GB, 월간 사용자 5만 명이다. 예전에는 툴 호출마다 저장 → 30초마다 동기화했고, 동기화마다 게임 전체(70KB~0.9MB)를 내려받아서 전송량 기준 몇 명에서 몇십 명밖에 못 받았다.
       - 이제 동기화는 log·박스·파티·놓아준 개체가 바뀔 때만 한다(`syncMark`). 걸음만으로는 하지 않는다.
       - 먼저 `select=updated_at`만 읽고, 이 PC가 마지막으로 올린 시각(`cloud-session.json.synced`)과 같으면 내려받지 않고 올리기만 한다. 업로드 응답도 `select=updated_at`만 받는다.
       - 추정: PC 한 대 사용자는 월 약 3MB, 두 대를 번갈아 쓰면 약 15MB. 전송량 기준 1,000명 이상. DB는 큰 JSON이 압축 저장되어 사용자당 150~270KB로, 약 1,000명이 한계다. 모두 박스를 꽉 채우면 빠듯해지는데, 그때 줄일 곳은 올리는 log 600건(저장의 약 1/3)이다.
       - 실제 Supabase에서 업로드 응답에 `updated_at`이 오는지는 첫 동기화 때 확인할 것. 안 오면 매번 전체를 받는 예전 동작이 될 뿐이고 데이터는 잃지 않는다.

7-8. **다음 작업 계획(2026-11-08). 1·2·3단계 완료(1.3.12), 5단계 완료(1.3.13 준비), 남은 것은 4단계(설정 화면)**
   - **진행 기록**
     - **1단계 완료**(2026-11-08, 아직 릴리스 전):
       - 트레이 "디자인 QA 페이지"는 `!app.isPackaged || CLAUDEX_QA=1`일 때만 나온다(`main.cjs` `showQa`).
       - 왼쪽 "–"는 위젯 모드에서만 보인다.
       - 창·전체 화면에서 `.w-head`와 `.w-term-tabs`를 `--head-h: 46px`로 맞췄다(`widget-expanded.css` 끝).
     - **2단계 완료**(같은 날, 아직 릴리스 전):
       - 알림 표시 시간: 일반 8초, 전설·환상·색이 다른 포켓몬 15초, 레벨업 5초(`Toast.tsx` `durationOf`). 마우스를 올리면 시간이 멈추고, 떼면 남은 시간부터 다시 간다(최소 0.8초).
       - 밀린 알림이 있으면 오른쪽 위에 "+N"을 띄운다.
       - 글자: 이름 15px·800, 본문 14px, 부가 줄 대비를 올렸다. 그림 칸은 64×60으로 고정해 글자 시작 위치를 맞췄다(`toast.css` 끝).
       - **누르면 그 포켓몬의 도감이 열린다.** 경로: `toast.open(id)` → main `openDexAt`(앱 창을 보이고 `widget:open-dex`) → `Widget.tsx`가 carry에 `dexPick: { id, at }`를 쓰고 도감 화면으로 → `PokedexView`가 필터를 풀고 그 종을 골라 가운데로 스크롤한다.
       - `dexPick`은 5초 뒤 저절로 무시된다(`carry.ts` `freshDexPick`). 위젯 → 창 전환 때 옛 창도 잠깐 창 모드로 그려지면서 값을 먼저 지워 버리는 문제가 있어서, 지우지 않고 만료되게 했다.
       - 같이 고친 숨은 버그: 위젯에서 `Ctrl+1~4`로 열면 carry에 바뀌기 전 탭이 저장됐다. `setView`가 carry용 값을 바로 갱신한다.
       - 확인: 격리 개발 앱(`CLAUDEX_HOME` 임시, 3344)에서 창 모드와 위젯 모드 둘 다 알림 클릭 경로를 캡처했다. QA 페이지 알림 카드도 확인. 실제 마우스 올림·클릭은 사람이 눌러 봐야 한다. 투명한 알림 창은 `capturePage`가 빈 그림을 준다.
       - **알림 카드 다시 짜기**(사용자: "이미지의 강약이 정리가 안 되어 있다"): 한 줄에 한 역할, 큰 것부터. ① 무슨 일(작은 라벨 "포획/진화/레벨 업/도망쳤어요" + 등급 알약 + NEW·오늘의 출석) ② 누구(이름 17px·800, 옆에 Lv 작게) ③ 볼·성격·장소 한 줄 ④ 포획 경위(가장 흐림). 그림은 72px 칸에 등급 색을 깔아 카드에서 가장 무게 있는 요소로 했다. `toast.css`를 덧씌우지 않고 통째로 새로 썼다.
     - **3단계 완료**(1.3.12):
       - 박스 그리드는 SV 아이콘이 기본(`look-icon`, 칸 최소 64px, 아이콘은 `aspect-ratio: 1`로 정사각 고정. 안 그러면 키 큰 아이콘이 칸을 늘린다). "아이콘 / 그림" 전환은 localStorage `claudex.boxLook`(설정 화면이 생기면 옮긴다).
       - 상세 카드는 항상 HOME 그림(색이 다른 포켓몬이 보이는 그림). 도감·박스 상세의 이름 옆에 SV 아이콘(`dex-card-icon`, 34px)을 붙였다. SV 아이콘에는 색이 다른 버전이 없다.
       - 박스 칸의 "일하는 중" 점을 왼쪽 아래로 옮겼다(레벨 글자와 겹쳤다).
     - **5단계 완료**(1.3.13, 사용자가 "묻지 말고 진행"이라고 해서 결정도 직접 했다):
       - **CSS**: `pokedex.css` 570 → 456줄. 같은 선택자를 덧씌운 층(도감·박스 칸만 19번)을 최종값으로 합치고, 안 쓰는 규칙을 지웠다(옛 위젯 안 알림 `.w-toast*`·`wToastIn`·`wGlow`, `dex-tierbar(s)`, `dex-tiles`, `dex-help-title`, 덮여서 안 먹던 `box-shadow`·`pixelated`). `widget.css`·`widget-expanded.css`도 같은 방식으로 합쳤다(`.w-bento`는 flex라 grid-template-rows 세 군데가 다 죽은 코드였다).
         - 정리 전후 픽셀 비교: 앱 화면 15장 0%. QA 페이지는 옛 `.w-toast {position: absolute; top: 8px}`가 QA 카드를 밀고 있었던 게 사라져서 실제 알림 창과 같아졌다(의도한 변화).
         - 주의: 안 쓰는 클래스 찾기 스크립트는 `` `name${...}` `` 꼴(대시 없이 이어 붙인 동적 클래스)을 못 본다. 그래서 `w-row-close`, `resume-item`, `pokeball`, `dex-release`, `w-conn`은 쓰는데도 안 쓰는 것으로 나온다. 한 번 잘못 지웠다가 되살렸다.
       - **중복 데이터**: `src/pokemon/balls.json`·`natures.json`을 지우고 앱도 `server/`의 파일을 import한다. `tools/fetch-pokemon-traits.py`도 `server/natures.json`만 쓴다.
       - **옛 이름**: 환경변수 대체값을 지웠다(`server/config.js` `readVar`, `runtime-dir.cjs` `envVar`, `helpers.cjs`, `vite.config.ts`). 디버그 변수는 `CLAUDEX_*`, 아무도 안 읽던 `POKEMON_OFFICE_TERMINAL`은 삭제. 테스트도 `CLAUDEX_*`로 바꿨다.
       - **Supabase 데이터**: 올리는 사본에서 이 PC만 쓰는 필드(`assign`·`projects`·`daily`·`thrownAt`, merge가 항상 로컬 값을 쓴다)를 빼고, log는 최근 200건만(`cloud.js` `cloudCopy`, `CLOUD_LOG`). 지금 실제 데이터는 log가 110건뿐이라 1%만 줄지만, log가 600건 찬 뒤에는 사용자당 약 120KB(약 20%) 줄어든다. 계획에 적은 30~40%보다 작다. 새 PC는 클라우드에서 기록을 최근 200건만 받는다.
       - **안 쓰는 함수**: 다른 파일이 안 쓰는 export 40여 개를 확인했는데, 전부 자기 파일 안에서는 쓰여서 지울 죽은 함수는 없었다(`export` 표시만 남는 것은 그대로 둠).
       - **큰 파일 나누기는 하지 않았다**: 코드 줄 수는 그대로이고 회귀 위험만 있어서, "코드는 줄이고 기능은 깔끔하게"라는 목표에 맞지 않는다고 판단했다. 필요하면 설정 화면 작업 때 `electron/main.cjs`의 창 관리부터 나눈다.
     - **업데이트 받기 길 두 개**(1.3.13): 2026-11-08에 `github.com/…/releases/download/…`가 모든 저장소에서 504를 냈다(한국 엣지, 상태 페이지는 정상). API(`api.github.com/repos/…/releases/assets/<id>`, Accept: application/octet-stream)는 됐다. 그래서 `updater.cjs` `releaseFile`이 기본 경로가 실패하면 API로 다시 받는다. API는 토큰 없이 IP당 시간에 60번이라 대체 경로로만 쓴다. 서명·sha256 검사는 그대로다. 실패하면 버튼이 빨간 "업데이트 실패 · 다시 시도"가 된다(전에는 오류가 툴팁에만 있어서 "깜빡이고 안 된다"로 보였다).
       - 손으로 업데이트하기(앱이 못 받을 때): 파일을 API로 받아 서명·sha256을 확인한다. 그다음 zip을 `%TEMP%<전용 폴더>pp`에 풀고 `%APPDATA%Claudexpending-update.json`에 `{"staged": "<그 app 폴더>", "version": "x.y.z"}`를 쓴 뒤 앱을 완전히 껐다 켠다. 켤 때 `applyPendingUpdate`가 robocopy로 바꾸고 `update.log`에 남긴다. 1.3.10 → 1.3.12를 이렇게 했다.
     - **1.3.13 묶음 (2026-11-08)**:
       - **교체는 파티 안에서만**(사용자 결정): `pokedex.swap`이 파티 밖 uid를 `not-in-party`로 거절한다. 예전에는 박스 포켓몬을 넣으면 파티 자리와 박스를 맞바꿨다. 박스 → 파티는 `exchange`(박스 상세 "파티에 넣기", 또는 박스 칸을 파티 칸으로 끌어다 놓기)로만 한다. 일하는 파티 포켓몬 칸에는 놓을 수 없다.
       - **세션 줄에 예전 포켓몬이 남던 버그**: `Widget.tsx`의 `rows` useMemo가 세션 cast(theme.ts) 버전을 의존성에 안 넣어서, 교체 뒤 터미널·세션·사용량 중 하나가 바뀔 때까지 옛 이름·아이콘이 남았다(실데이터: 웨이니발 → 리오르로 되돌린 뒤에도 웨이니발 표시). `useTheme()`의 값을 deps에 넣었다.
       - 박스 칸은 컴포넌트(`<Cell>`)가 아니라 함수(`cell(m)`)로 그린다. 렌더마다 새 컴포넌트 타입이 생기면 드래그 시작 때(setState) 칸이 다시 마운트돼 드래그가 끊긴다.
       - 박스: 한 박스 30칸(6×5), 정렬·필터 바뀌면 박스 1로.
     - **알림 창이 검은 네모로 남던 버그(1.3.15에서 고침)**: main이 알림 창의 `did-finish-load`에서 바로 `toast:event`를 보냈다. 그런데 페이지는 그 뒤에 Toast 코드(lazy import)를 불러서 리스너를 단다. 그래서 첫 알림이 사라지고, 아무것도 그리지 않은 투명 창이 떠서 Windows에서 검은 네모로 남았다(Toast에 current가 없으니 `toast:done`도 안 와서 계속 떠 있음). 이제 페이지가 리스너를 단 뒤 `toast:ready`를 보내고, 그 전 이벤트는 main의 `toastPending`(최대 20개)에서 기다린다. 검증: 테스트 창에서 did-finish-load 직후 보내면 root가 비어 있었고, ready를 기다리면 그려진다(ready는 load 뒤 약 18ms). 알림 카드 배경은 불투명(#14161c)으로 바꿨다(뒤에 겹친 카드가 비쳐 보였다).
     - **알림이 CSS 없이 깨져 나오던 버그(1.3.18, 1.3.19에서 고침)**:
       - 원인: `src/main.tsx`가 세 페이지를 `lazy(() => isQa ? import(QaPage) : isToast ? import(Toast) : import(Widget))` 한 식으로 불렀다. Vite는 이 식 하나에 의존 목록을 하나만 붙이는데(Widget 것), 그 목록에 `Toast-*.css`가 빠졌다. 그래서 빌드본에서만 알림 창에 스타일이 없었다. dev는 CSS를 다른 방식으로 넣어서 안 보였다.
       - 고침: 페이지마다 `lazy(() => import(...))`를 따로 둔다.
       - 재발 방지: `scripts/dist-check.mjs`가 빌드 뒤 "지연 로딩 페이지가 자기 CSS를 같이 받는지" 검사하고, `release.mjs`가 vite build 직후에 부른다(실패하면 릴리스 중단). 1.3.18 빌드에 돌리면 `Toast-*.css`를 잡아낸다.
     - **설정 문구 정리(1.3.19)**: 영어가 더 분명한 말은 영어로 둔다(사용자 지시). Permission mode의 선택지는 Claude Code 공식 이름인 Manual / Accept edits / Plan / Auto와 기본값이다(code.claude.com/docs/en/permission-modes; Auto는 모든 요금제, 지원 모델 필요, 최근 Claude Code의 기본 시작 모드). 그 밖에 "클라우드 동기화", "Google로 로그인", "프롬프트 숨기기", "시작 시 트레이로 최소화", "내보내기"로 바꿨다.
     - **1.3.15에서 되돌림**(사용자: "그냥 꽉 찬 UI가 나은 것 같아. 나중에 개선하자"): 박스는 1.3.12의 꽉 찬 그리드로 돌아갔다(위 파티 줄, 아래 너비를 채우는 그리드, 스크롤). 30칸 페이지·게임 PC 배치·고정 칸 크기는 모두 뺐다. 남긴 것은 박스 → 파티 드래그, 파티 안에서만 교체, 왼쪽 패널 파티 클릭 교체다. 다시 손볼 때 참고할 기록은 아래와 같다.
     - **1.3.14**: 박스를 게임 PC처럼 배치했다. 왼쪽에 파티 세로 6칸, 가운데 박스(이름표 ‹ 박스 N › + 6×5), 오른쪽에 상세. 칸 크기는 **고정**(아이콘 64px, 그림 86px, `--slot`)이다. 화면에 맞춰 키우면 SV 아이콘이 깨진다(사용자 지적). `.box-left` container query로, 640px 이하에서는 파티가 박스 위 가로줄이 되고, 470px 이하(작은 창에 상세가 열렸을 때)에서는 칸이 50px로 줄어든다(줄이는 건 안 깨짐). 왼쪽 패널의 파티 아이콘에서 쉬는 포켓몬을 누르면 지금 고른 세션(`shown`)의 포켓몬과 교체된다(`doSwap`, 교체 버튼과 같은 길).
       - 알림: 기다리는 카드는 뒤에 1~2겹(`.w-toast-behind`), ×(`onClose` = next), 밀리면 `durationOf(e, waiting)`가 일반 4초·레벨업 3초(전설·환상·색이 다른 포켓몬은 15초 그대로). 도망 알림은 등급 상관없이 띄우고 그림은 실루엣. 알림 창 172px.
   - 1단계 · 작은 화면 정리(반나절)
     - **디자인 QA 화면 숨기기**: 트레이 "디자인 QA 페이지"는 개발 실행(`!app.isPackaged`)이나 `CLAUDEX_QA=1`일 때만 보인다. Claude가 확인할 때는 그 변수로 띄운다.
     - **창·전체 화면에서 왼쪽 "–"(숨기기) 버튼 빼기**: 오른쪽에 최소화·닫기가 이미 있다(`w-win-controls`). 위젯 모드에서만 둔다.
     - **왼쪽 헤더와 오른쪽 탭 줄 높이 맞추기**: `.w-head`와 `.w-term-tabs`가 각자 padding이라 높이가 다르다. 창·전체 화면에서 공통 변수(예: `--head-h: 46px`)로 둘 다 고정한다.
   - 2단계 · 알림 디자인 QA(하루)
     - 표시 시간: 지금 일반 5.5초, 전설·환상·색이 다른 포켓몬 10초, 레벨업 3.5초(`Toast.tsx` `durationOf`) → 8초 / 15초 / 5초 정도로 늘린다. 마우스를 올리면 멈춘다.
     - 가독성: 400×138 창(`TOAST_SIZE`) 안에서 이름 크게, 등급·볼·장소 줄 대비 올리기, 줄 수 정리. 여러 개가 밀려 있으면 "+N" 표시. 누르면 그 포켓몬의 도감이나 박스로 연다.
     - QA 화면(?qa)에서 종류별로 나란히 보고 고친다.
   - 3단계 · SV 아이콘(반나절)
     - 도감·박스 상세 카드 이름 옆에 SV 아이콘(`iconUrl`)을 작게 넣는다.
     - 박스에 "그림 / 아이콘" 보기 전환을 넣는다. 아이콘 보기는 작은 칸(약 48px)으로 한 화면에 훨씬 많이 보인다. 고른 값은 기억한다(설정이 생기면 설정으로 옮긴다).
     - SV 아이콘에는 색이 다른 버전이 없다. ✦ 표시로만 구분한다.
   - 4단계 · 설정 화면(2~3일, 범위를 먼저 정한다)
     - 저장: main 프로세스의 `userData/settings.json`. 위젯·창·알림 창이 같이 읽도록 IPC로 방송한다(localStorage는 창마다 따로라 안 맞다).
     - 들어올 후보:
       - 화면: UI 글자 크기, 터미널 글꼴·크기(지금 소/중/대), 박스 보기 방식
       - 알림: 켜기/끄기, 종류별(레벨업 끄기 등), 표시 시간, 소리
       - 동작: Windows 시작 시 실행, 위젯 항상 위, 기본 작업 폴더, 닫기 = 트레이로
       - 계정·데이터: 클라우드 로그인·지금 동기화, 데이터 폴더·로그 폴더 열기
       - 정보: 버전, 패치노트, 단축키 목록, 업데이트 확인
     - 테마(라이트)와 언어(영어)는 비용이 크다. 테마는 색 토큰 정리부터, 언어는 화면 문구를 전부 뽑아내야 한다(i18n). 첫 설정 화면에서는 빼고 나중에 한다.
   - 5단계 · 코드 정리와 최적화(2~3일, 기능은 그대로 두고 코드는 줄인다)
     - **CSS**: `pokedex.css`(556줄)에 같은 선택자를 덧씌운 층이 많다(`.dex-grid`·`.dex-cell`·`.box-grid`·`.box-cell` 정의가 19번). 마지막 값으로 합쳐서 한 번씩만 남긴다. `widget*.css`도 같은 방식.
     - **중복 데이터**: `src/pokemon/balls.json`·`natures.json`이 `server/`의 같은 파일과 똑같다. 하나로 합친다.
     - **옛 이름**: 코드 22곳에 `POKEMON_OFFICE_*`·`AGENT_OFFICE_*`가 남아 있다. 테스트를 `CLAUDEX_*`로 옮기고 디버그 변수 이름을 정리한다. 데이터 폴더 이전 코드는 모두가 1.3.8 이상이 될 때까지 둔다. → **1.3.13에서 함**(아래 진행 기록).
     - **큰 파일 나누기**(7-6에서 남은 것): `server/index.js`(1492줄)의 main 상태 기계와 `processEvent`, `electron/main.cjs`(1044줄)의 창 관리. `electron-helpers.test`가 main.cjs 소스 문자열을 검사하므로 같이 고친다.
     - **Supabase 데이터 줄이기**: 이 PC에서만 의미 있는 필드(`assign`·`projects`·`thrownAt`)는 올리지 않는다. 클라우드에 올리는 log는 최근 200건만. 사용자당 저장량이 약 30~40% 줄어 DB 한계가 약 1,000명에서 1,500명 안팎으로 올라간다. merge가 그 필드를 이 PC 것으로 두는지 테스트로 확인한다.
     - 안 쓰는 export·함수 찾기(예: `ts-prune` 같은 도구를 한 번 돌리고 지움), 테스트는 전부 통과 유지.
   - 결정이 필요한 것: 알림 표시 시간 값, 박스 기본 보기(그림/아이콘), 설정 첫 범위(테마·언어 포함 여부), 정리 단계에서 파일 나누기까지 할지.

7-9. **큰 방향 계획(2026-11-08, 사용자 요청: "리더보드로 사용자끼리 경쟁심을 부추기고 싶다", "Claude로 너무 한정한 제품 아닌가", 설정 디벨롭). 아직 실행 안 함, 사용자 검토 대기**
   - **순서 제안**: ① 설정 화면 1차 → ② 리더보드 1차(MVP) → ③ 다른 AI 도구 1·2단계. 리더보드는 로그인 사용자가 늘수록 효과가 커지고, 설정의 "닉네임·공개 여부"가 먼저 있어야 해서 설정 다음에 둔다. 다른 AI 도구는 사용자 층을 넓히는 일이라 리더보드와 따로 진행할 수 있다.

   - **A. 리더보드 (경쟁심)** → **1차 구현함(2026-11-08, 1.3.17). 사용자가 `supabase/leaderboard.sql`을 실행함(2026-11-08 확인: anon으로 board 200, profile 401)**(SQL Editor → 붙여넣기 → Run. 다시 실행해도 안전함. 앱은 secret key를 쓰지 않으므로 사용자가 직접 실행한다. 실행 전에는 랭킹 탭에 "준비하고 있어요"가 뜬다).
     - DB: `leaderboard` 테이블. 숫자는 `trainers.state`가 올라올 때 트리거 `leaderboard_stats`가 계산한다.
       - 도감 = caught 키 수
       - 색이 다른 포켓몬 = mons의 shiny 수
       - 전설·환상 = caught ∩ 48종 번호(SQL 안에 배열로 있음; pokemon-data.json의 legendary/mythical과 맞춰야 함)
       - 이번 주 = mons 중 how가 wild/pity/attendance이고 at이 이번 주 월요일 0시(KST) 이후인 수
       - 놓아준 포켓몬과 박사님께 보낸 포켓몬은 빠진다
     - 그럴듯함 검사(`flagged`): 종 수가 1025보다 많거나, 색이 다른 포켓몬이 가진 포켓몬보다 많거나, 한 주 포획이 1500을 넘으면 순위에서 뺀다.
     - 테이블은 RLS로 막고 정책을 두지 않는다. 함수 세 개로만 접근한다.
       - `leaderboard_board(board)`: anon도 가능. 상위 100명과 내 순위 ±5명. rank(동점 같은 등수)와 rn(줄 번호)을 준다.
       - `leaderboard_profile()`
       - `leaderboard_set_profile(nickname, public, partner)`: 닉네임은 한글·영문·숫자·_ 2~12자, 대소문자 무시 중복 금지. 'ok'·'taken'·'bad-nickname'·'no-game'·'signed-out'을 돌려준다.
     - Supabase는 새 함수를 anon·authenticated에 기본으로 열어 주므로, revoke한 뒤 필요한 것만 grant한다.
     - 검증: PGlite(인프로세스 Postgres)에서 schema.sql과 leaderboard.sql을 두 번 실행해 숫자, 닉네임 규칙·중복, 비공개 숨김, 내 줄 표시, 불가능한 게임 flag, anon 권한을 확인했다(스크래치패드 `pgtest/run.mjs`, 저장소에는 없음).
     - 앱:
       - `server/cloud.js`: `leaderboard(board)`는 보드당 **1시간** 캐시이고(사용자 결정 2026-11-08: "1시간에 한 번 되도 돼"; 참여·수정하면 비운다), 로그인 전에는 publishable key만으로 부른다. `leaderboardProfile`, `setLeaderboardProfile`은 참여 전에 `sync()`로 게임을 먼저 올린다. 404면 'not-set-up'.
       - 서버 `POST /leaderboard`, `/leaderboard/profile`, `/leaderboard/profile/set`(토큰 필요).
       - IPC `board:*`.
       - 화면: `src/components/LeaderboardView.tsx`(랭킹 탭, Ctrl+5). 보드 4개(이번 주 포획이 기본), 내 칸(로그인 / 참여: 닉네임 + 대표 포켓몬은 파티에서 / 수정·그만두기), 목록(1~3위 색, 내 줄 강조, 순위가 끊기면 ⋯).
     - 이번에 뺀 것: 위젯의 "이번 주 12위 ▲3", 주간 리그, 친구, 시즌, 추월 알림(2차 이후).
     - **수용량 재계산(2026-11-08, 측정값)**
       - 무료 플랜 한도: DB 500MB, 전송량 월 5GB, MAU 5만.
       - DB 저장 크기(PGlite에서 jsonb TOAST 압축 후 측정):
         - 실제 사용자 사본(52종): JSON 71KB → 저장 21KB(압축률 약 0.30)
         - 박스가 꽉 찬 사본: JSON 약 405KB → 같은 비율로 약 120KB
         - 갱신 때 생기는 bloat(×1.5)와 Supabase 기본 사용량(약 50MB)을 넣어도 DB 기준 약 2,500명(전원 박스 가득) ~ 5,000명(중간 수준)이다. 예전 추정(약 1,000명)보다 여유가 있다.
       - leaderboard 테이블: 한 행에 인덱스 포함 약 250B → 1,000명이어도 0.25MB.
       - 전송량:
         - 보드 한 번 응답은 100줄에 약 8.5KB(압축 전; Supabase가 gzip하는지는 응답이 작아서 확인하지 못함).
         - 탭을 하루 3번 열고 보드 2개를 보면 월 약 1.5MB, 자주 보는 사람은 월 약 5MB.
         - 동기화는 PC 한 대 월 약 3MB, 두 대면 약 15MB(7-7).
         - 그래서 **이제 한계는 전송량이다**: PC 한 대 사용자 위주면 약 1,100명(리더보드 전 약 1,700명). 30%가 PC 두 대이거나 랭킹을 자주 보면 약 600~700명.
       - 처리 시간: 업로드 트리거 약 3ms, 보드 조회는 PGlite(WASM)에서 80ms(실제 Postgres는 훨씬 빠름). 문제없다.
       - **캐시를 1시간으로 바꾼 뒤**(1.3.18): 한 사람이 받는 랭킹은 "본 시간대 수 × 본 보드 수"가 상한이다. 보통 하루 3번(약 25KB) → 월 약 0.8MB로 줄어서, PC 한 대 사용자 위주면 약 1,350명이다.
       - 늘리는 방법(효과 큰 순):
         1. ~~보드 캐시 1분 → 5분~~ → 1시간으로 함
         2. 상위 100 → 50명
         3. 응답을 배열로 압축(약 40% 감소)
         4. PC 두 대 사용자의 동기화 전송량 줄이기
         5. Pro 플랜($25/월: 전송량 250GB, DB 8GB, 수만 명)
     - **원칙**
       - 참여는 **선택(opt-in)**이다. 공개 이름은 앱에서 정하는 **닉네임**이다. 지금 `trainers.display_name`에는 구글 실명이나 이메일이 들어가므로 절대 공개하지 않는다. 닉네임은 별도 컬럼 `nickname`에 둔다.
       - 대표 포켓몬(아이콘)을 프로필로 쓴다. 보이는 건 닉네임, 대표 포켓몬, 숫자뿐이다.
       - 점수는 **서버가 계산**한다. 지금은 클라이언트가 `caught_count`를 직접 올리는데, 이러면 조작이 쉽다. 업로드된 `state` jsonb에서 Postgres 트리거나 함수가 숫자를 뽑아 `trainer_stats`에 쓴다.
     - **순위 종류(1차)**
       - 도감 완성(잡은 종 수)
       - 색이 다른 포켓몬 수
       - 전설·환상 수
       - **이번 주 포획 수**(월요일에 초기화): 새로 온 사람도 이길 수 있는 판
       - 내 순위와 주변 ±5명, 상위 100명
     - **경쟁심을 키우는 장치(2차 이후)**
       - **주간 리그**(브론즈 → 실버 → 골드 …, 듀오링고식): 한 리그 30명 정도, 상위는 승급하고 하위는 강등한다. 매주 "올라갈 수 있다"는 동기가 생긴다.
       - **친구 리더보드**: 초대 코드로 친구를 맺고 친구끼리만 비교한다. 동료·팀 단위로 퍼지기 좋다.
       - **시즌·칭호**: 월별 시즌(예: 이번 달은 물 타입 포획 수), 시즌 배지·칭호·볼 스킨 같은 꾸미기 보상. 게임 밸런스(포획률)에는 손대지 않는다. 이벤트 내용은 사용자가 직접 정한다.
       - **추월 알림**(선택): "○○님이 이번 주 순위에서 앞질렀어요". 하루 1번 이하로만 보낸다.
       - **프로필 카드 공유 이미지**: 도감 %, 대표 포켓몬, 칭호. SNS로 퍼뜨리는 용도다.
     - **조작 방지** (완벽하게는 못 막는다는 걸 전제로 한다)
       - 포켓몬을 만나는 굴림은 클라이언트에서 하므로 `pokedex.json`을 고치면 숫자를 바꿀 수 있다.
       - 1차 방어: 서버 함수가 **그럴듯한지 검사**한다. 하루 포획 증가에 상한을 둔다(걸음당 만남 확률과 하루 작업 시간으로 계산). 전설·환상이 갑자기 늘었는지도 본다. 걸리면 순위에서 숨기고 표시해 둔다.
       - 주간 판은 매주 초기화되니 피해가 오래가지 않는다.
       - 이후에는 만남 굴림을 서버에서 하는 방법(server-authoritative)도 있지만, 무료 티어 비용 때문에 사용자가 많아진 뒤에 검토한다.
     - **사용량을 낭비하게 만들지 않기**: "많이 쓸수록 유리"하면 일부러 토큰을 태우는 사람이 생긴다.
       - 주간 순위에 반영하는 하루 걸음·포획에 상한(소프트 캡)을 둔다.
       - 이미 있는 재포획 감소(0.9ⁿ, 하한 0.3) 덕분에 같은 종을 반복해서 잡는 효율은 낮다.
     - **Supabase 무료 티어**
       - `trainer_stats`는 한 행에 수십 바이트라 1,000명이어도 아주 작다.
       - 순위 조회는 상위 100명과 내 주변만 30분마다(또는 탭을 열 때) 받는다. 한 번에 몇 KB라 egress 부담이 거의 없다.
       - 읽기는 `security definer` 함수나 뷰로 닉네임과 숫자만 공개한다. 쓰기는 트리거만 한다(RLS 유지).
     - **화면**
       - 창 모드에 탭 하나("랭킹")를 추가한다. 보드 종류를 고르고, 내 순위 줄을 강조한다.
       - 위젯 도감 카드에 "이번 주 12위 ▲3"처럼 짧게 표시한다.
     - **1차 범위(2~3일)**
       - 설정의 닉네임·공개 여부
       - `trainer_stats` 트리거(+ 그럴듯함 검사 기본형)
       - 공개 조회 함수
       - 랭킹 탭(도감 수, 색이 다른 포켓몬, 전설·환상, 이번 주 포획)
     - **결정이 필요한 것**
       - 1차 보드 종류
       - 주간 초기화 요일·시간(KST)
       - 닉네임 규칙(길이, 금칙어)
       - 비로그인 사용자에게 보여 줄지(보기만 가능 / 숨김)

   - **B. 다른 AI 도구 지원**
     - **지금 Claude에 묶인 곳**
       - `electron/terminals.cjs`: `claude` 실행
       - `hooks/*.cjs`와 Claude Code 훅 설정: 도구 사용 = 걸음, 확인 필요, 세션 시작·끝
       - `server` 세션 레지스트리(`~/.claude/sessions`)
       - 상태줄 사용량(5시간·주간)
       - `electron/history.cjs`: 대화 기록, `--resume`
       - `/rename`
       - prereqs의 claude 확인
     - **이미 도구와 무관한 곳**: 게임 코어(`server/pokedex.js`의 `noteEvent`)는 "세션 시작 / 도구 사용(tool 이름) / 끝" 신호만 쓴다.
     - **1단계(반나절~하루)**: Claude를 "어댑터 1번"으로 분리한다. 어댑터는 `{ 실행 명령, 이벤트 소스, 사용량(없을 수 있음), 이어하기(없을 수 있음) }`이다. 겉 변화는 없다.
     - **2단계(1~2일)**: "일반 터미널" 어댑터. 아무 CLI나 실행하고, PTY 출력이 활발한 구간을 걸음으로 친다. 확인 필요·사용량·이어하기는 없다. 어떤 도구든 포켓몬과 일할 수 있다.
     - **3단계(도구당 2~3일)**: Codex CLI, Gemini CLI 등 훅·알림 기능이 있는 도구의 정식 어댑터. **시작 전에 각 도구가 지금 어떤 이벤트를 내보내는지 직접 확인한다**(지식 시점 이후 변했을 수 있음).
     - **제품 표현**: 1·2단계 뒤에 README와 화면 문구의 "Claude Code 세션"을 "AI 코딩 세션"으로 바꾼다. 사용량 막대는 그 도구가 정보를 줄 때만 보인다.

   - **C. 설정 화면 (7-8의 4단계를 넓힘)** → **1차 구현함(2026-11-08, 1.3.16)**:
     - `electron/settings.cjs`: 기본값, 검사(`sanitize`: 모르는 키는 버리고 타입·값이 틀리면 기존 값), `applyPatch`, 알림 거르기 `toastAllowed`(종류, 희귀 이상만, 방해 금지 시간; 자정을 넘기는 구간 포함), `claudeArgs`(`--model`, `--permission-mode`; 메뉴에 bypassPermissions는 없다). 파일은 `%APPDATA%\Claudex\settings.json`이다.
     - main: `settings:get/set` IPC로 받고, 바뀌면 위젯과 알림 창에 `settings:changed`를 보낸다. 알림은 main의 `showToast`에서 거른다(창과 상관없이 한 곳에서). 로그인 시 실행은 `app.setLoginItemSettings`(설치본만), 위젯 항상 위는 `setAlwaysOnTop`, 트레이로 숨긴 채 시작은 `createWidgetWindow({ hidden })`. 기본 폴더와 claude 인자는 `createTerminalManager`의 `defaultCwd()`·`extraArgs()`. 백업은 `data:export`(저장 대화상자 → pokedex.json 복사). 트레이 메뉴에 "설정"이 있다.
     - 화면: `src/components/SettingsView.tsx`(알림·개인정보·세션·앱·데이터), `src/settingsStore.ts`(`useSettings`, `getSettings`). 요청 내용 숨기기는 `sourceText`가 `getSettings()`를 읽는다. Widget과 Toast가 `useSettings()`로 다시 그린다. 저장 버튼은 없고 바로 저장된다.
     - 이번에 뺀 것: "전체 화면 앱이 떠 있을 때 방해 금지"(Electron에 다른 앱의 전체 화면을 알 방법이 없어 시간대만 했다), 백업 가져오기(merge 검증과 서버 엔드포인트가 필요), 초기화.
     - **1차(추천)**
       - **알림**: 종류별 켜기·끄기(포획·도망·진화·레벨업), "희귀 이상만", 표시 시간, 방해 금지(전체 화면·시간대)
       - **개인정보**: 알림·기록에 **요청 내용(프롬프트) 숨기기**. 지금은 포획 경위에 내가 쓴 요청이 그대로 떠서 화면 공유 중에 곤란하다. 리더보드 닉네임·공개 여부도 여기에 둔다.
       - **세션**: 기본 작업 폴더, 기본 AI 도구(B를 하면), 실행 옵션(모델·권한 모드), 닫을 때 확인
       - **앱**: Windows 시작 시 실행, 트레이로 숨긴 채 시작, 위젯 항상 위
       - **데이터**: 로그인·동기화 상태, 지금 동기화, 백업 내보내기·가져오기(도감 JSON), 초기화
     - **나중**
       - 게임: 새 세션 파트너 고르는 방식(지난 파트너 / 랜덤 / 매번 묻기), 박스 기본 보기, 별명
       - 사용량 80% 알림
       - 단축키 바꾸기
       - 업데이트 채널
       - 진단: 로그 폴더, 훅 점검·재설치
       - 테마·언어
     - **배치**: 창 모드에서 왼쪽에 분류(일반·알림·세션·게임·데이터·정보), 오른쪽에 항목. 위젯 맨 위 "Claudex"나 톱니바퀴로 연다. 값은 서버의 설정 파일 한 곳에 두고 창끼리 공유한다(localStorage는 창마다 달라서 피한다).

7-10. **영어·일본어 지원(2026-11-08, 1.3.20; 사용자: "포켓몬 같은 건 다 공식으로")**
   - **이름 데이터**: `tools/fetch-i18n.mjs`가 PokeAPI에서 공식 영어·일본어 이름을 받아 기존 파일에 더한다. PokeAPI 응답은 `tools/_cache/pokeapi/`에 캐시하고 커밋하지 않는다.
     - 포켓몬 1025종의 ja 이름, genusEn/Ja, flavorEn/Ja → `src/pokemon/pokedex.json`과 `server/pokemon-data.json`
     - 성격 → `server/natures.json`
     - 볼 → `server/balls.json`
     - 일본어 도감 설명이 없는 127종(8·9세대 일부, 한국어도 없음)은 영어로 보여 준다.
     - 타입·등급·능력치·볼 등급 이름은 `src/i18n.ts`의 표(공식 표기)에서 가져온다.
   - **번역 구조**: `src/i18n.ts`의 `t(한국어, vars)`. 한국어 원문이 키다(gettext 방식).
     - 사전은 `src/locales/{widget,dex,settings}.ts`(영역별 en/ja). 키 296개를 모두 번역했다(검사 스크립트로 확인).
     - 번역이 없으면 영어, 그다음 한국어로 보여 준다.
     - 받침에 따라 바뀌는 조사는 `josa(word, '이가'|'을를'|'은는'|'와과'|'으로')`를 자리표시자로 넘긴다.
     - 이름은 `nameOf(entry)`, 날짜는 `locale()`.
     - main 프로세스는 `electron/i18n.cjs`(트레이, 대화상자). 로그인 결과 페이지는 Accept-Language를 따른다.
   - **언어 설정**: 설정 › 앱 › 언어(자동/한국어/English/日本語). 자동은 시스템 언어를 따른다(ko/ja가 아니면 en).
   - **저장되는 글자를 코드로 바꿨다(중요)**: 서버가 장소 이름과 포획 경위를 한국어로 저장하고 있었다. 이 글자는 클라우드에도 올라가고, 장소는 개체 식별(`monKey`)에도 쓰인다.
     - 이제 장소는 `@wild|<프로젝트>|<지형코드>|<도로번호>|<밤=1>`, `@attendance|<프로젝트>`, `@evolve|<프로젝트>`, `@start`로 저장한다(`server/pokedex.js` `placeCode`). 지형 코드는 grass/cave/forest/sky/safari/plant/route다.
     - 포획 경위는 도구 이름 그대로(`Bash(npm test)`, `Grep`, `Skill(/x)`)이거나 `#session-start`, `#thinking`이다.
     - 화면에서는 `src/gameText.ts`(`placeIn`, `sourceLabelIn`)가 코드도, **예전 세이브의 한국어도** 읽어서 각 언어로 보여 준다. 저장된 문자열은 절대 고쳐 쓰지 않는다(개체 식별이 바뀌므로).
     - 로그의 `name`/`fromName`(한국어)은 화면에서 쓰지 않고, id로 이름을 찾는다.
     - 업데이트 전 버전의 PC는 새 코드(`@wild|…`)를 그대로 보여 줄 수 있다. 모든 PC를 1.3.20 이상으로 올리면 해결된다.
   - **패치노트**: CHANGELOG에 `## Claudex (English)`와 `## Claudex (日本語)` 섹션을 1.3.16부터 둔다(`src/patchNotes.ts` `releasesIn`). 그 언어에 최신 버전이 없으면 영어, 그다음 한국어로 보여 준다. **릴리스마다 세 언어로 쓴다.** 업데이트 버튼 툴팁의 notes는 아직 한국어다(manifest가 한국어 notes만 담는다).
   - **리더보드 닉네임**: 히라가나·가타카나·한자도 허용한다(`supabase/leaderboard.sql` 정규식). 사용자가 SQL을 다시 실행함(2026-11-08).
   - 남은 한국어: QA 페이지(개발용). README는 1.3.23에서 `README.en.md`·`README.ja.md`를 따로 둠(맨 위 언어 링크). (클라우드 오류 문구와 업데이트 툴팁 노트는 7-11에서 처리)
   - 사용자 수 예상과 Supabase: 언어는 사용자당 용량·전송량을 바꾸지 않는다(오히려 코드가 조금 짧다). 바뀌는 건 사용자 수뿐이다. 무료 한도는 약 1,350명(전송량 기준, 7-9)이고, 그 이상이면 Pro($25/월, 전송량 250GB·DB 8GB → 수만 명)로 간다.

7-11. **2026-11-09 회사 PC 작업(1.3.21 준비, 아직 릴리스 안 함)**
   - **터미널 색이 사라지던 문제**: Claude Code는 자기가 실행하는 명령에 `NO_COLOR=1`을 건다. Claude Code 안에서 Claudex를 켜면 이게 모든 세션으로 넘어가 색·배경이 다 꺼졌다. `cleanEnv`가 `CLAUDECODE`가 있을 때만 `NO_COLOR`도 뺀다(사용자가 직접 건 `NO_COLOR`는 유지).
   - **세션 자동 복원**(사용자 요청): `userData/open-sessions.json`에 실행 중인 세션(`sessionId`, `cwd`, 최대 6개)을 목록이 바뀔 때마다 쓴다(강제 종료돼도 마지막 목록이 남는다). 종료할 때 `killAll`이 먼저 `frozen`을 걸어서, 꺼지면서 죽는 세션 때문에 목록이 지워지지 않는다. 다음 시작 때 위젯이 `terminals:restorable`로 한 번만 받아(창 전환으로 다시 열지 않음) 각 세션을 `--resume`으로 연다. 이때 그 세션의 포켓몬(`dex.remembered`)이 파티에서 쉬고 있으면 그 포켓몬이, 아니면 쉬는 파티 포켓몬이 같이 나간다. 대화 기록(`~/.claude/projects/*/<id>.jsonl`)이 없는 세션은 이어 열 수 없어서 뺀다. 설정 › 세션 › "시작할 때 세션 다시 열기"(`session.restoreOnStart`, 기본 켜짐). 꺼져 있어도 목록은 소비해서, 나중에 켰을 때 옛 목록이 열리지 않는다.
   - **번역 마무리**: `server/cloud.js`는 오류를 `{ code, detail }`로만 보내고 화면이 `cloudErrorText`(`src/cloudStore.ts`)로 각 언어 문구를 만든다. `latest.json`에 `notesEn`·`notesJa`를 넣는다(`release.mjs`가 CHANGELOG의 영어·일본어 섹션에서 읽음, 서명 범위에 포함). 업데이트 버튼 툴팁은 `updateNotes()`로 언어별 노트를 고른다. 1.3.20 이하 manifest에는 없으므로 한국어로 보인다.

7-12. **2026-11-09 1.3.22**
   - **탭 드래그**: `terminals.move(id, index)`(main의 Map 순서를 바꿈, `terminals:move`). 탭·왼쪽 줄·`open-sessions.json` 복원 순서가 모두 이 순서를 따른다. 위젯은 HTML5 드래그(`application/x-claudex-tab`, 터미널의 파일 끌어놓기와 섞이지 않음), 탭 왼쪽 절반이면 앞, 오른쪽 절반이면 뒤.
   - **Shift/Ctrl+Enter 줄바꿈**: xterm의 `attachCustomKeyEventHandler`는 keydown·keypress·keyup마다 불린다. keydown만 false로 막으면 `_keyDownHandled`가 서지 않아 keypress가 `
`을 보내 프롬프트가 전송됐다. 이제 Enter+Shift/Ctrl은 모든 이벤트에서 false, keydown에서만 ESC+CR을 쓴다. ConPTY는 ESC+CR·LF·CSI-u를 그대로 넘기고 Claude Code는 ESC+CR·LF 모두 줄바꿈으로 받는 것을 실제 claude로 확인했다.
   - **왼쪽 줄에서 바로 답하기**: 창 모드에서 확인을 기다리는(asking 또는 needs-you) 세션이 지금 보는 터미널이 아니면 그 줄 안에 작은 `TerminalView`(`focus={false}`, 쓰던 터미널의 포커스를 뺏지 않음)와 "선택 (Enter)"·"거절 (Esc)" 버튼. 위젯 모드의 `w-ask` 카드는 그대로. 배지는 "확인 필요"(누르면 그 터미널로).
   - **기록**: 하루치 레벨업을 그날 가장 최근 자리에 한 줄로(포켓몬마다 한 번, 그날 최고 레벨). 그림은 SV 아이콘(`iconUrl`, 없으면 HOME으로 대체). 실데이터 126줄 → 85줄.

7-13. **2026-11-09 1.3.23**
   - **IME 조합 중 Shift/Ctrl+Enter**: 한글 마지막 글자는 키를 누른 뒤에야 확정된다. 조합 중(`isComposing` 또는 keyCode 229)이면 textarea의 `compositionend` 뒤(xterm이 setTimeout 0으로 확정 글자를 보낸 다음, +10ms)에 ESC+CR을 보낸다. compositionend가 안 오면 300ms 뒤에 보낸다.
   - **unslop 점검(가벼운 수준)**: 사용자는 굵기는 지금이 좋다고 해서 그대로 둠. 글자 크기 18종 → 8종(10·11·12·13·14·16·20·28, 도감 칸의 큰 "?" 48만 예외, 터미널 글자 크기 버튼 미리보기도 예외). 상태 점 발광 제거(포획 카드의 등급 빛은 유지), toastIn 오버슈트 제거, 기록 NEW 배지는 연한 바탕+강조색 글자. 랭킹 빈 문구의 느낌표, 영어 포획 제목 "Caught!"의 느낌표 제거. unslop 스킬은 `.claude/skills/unslop`에 로컬로만 둠(커밋 안 함).
   - **다음 작업(사용자 결정)**: 세션 상한은 6 그대로. 서브에이전트는 박스 포켓몬이 "조력자"로 나간다. (1.3.24에서 구현)

7-14. **2026-11-09 1.3.24**
   - **조력자**(`server/pokedex.js` `helpers`): `agent_working`에 `agentId`가 있으면 `helperFor(sessionId, agentId)`가 박스에서 쉬는(busy도 다른 조력자도 아닌) 포켓몬을 무작위로 하나 붙인다. 그 호출의 `workStep`(성장·레벨·진화, `lastWorkAt` 키는 `세션
에이전트`)과 걸음 대기열의 조우(`step.uid`)는 조력자 몫. `agent_completed`(SubagentStop), `session_ended`, 10분 무활동(`HELPER_IDLE_MS`, tick)에 박스로 돌아간다. 저장하지 않는다(실행 중에만). 박스가 비면 예전처럼 파티 포켓몬이 맡는다. 조력자는 놓아주기·교환 불가(`busy`). `publicState().helpers`: sessionId → uid[]. 위젯 줄에 아이콘 최대 3개 +N, 박스는 working 점. 로그·토스트는 없음(`kind: 'helper'` 이벤트만 방송).
   - **왼쪽 줄 확인 카드**: 1.3.22의 줄 안 작은 `TerminalView`를 없앴다. 300px 폭 터미널이 세션 PTY 폭을 줄여 Claude Code가 좁게 다시 그렸다. 이제 `main.needsYou`의 `toolName · summary`(없으면 message) 한 줄 + 권한(kind permission)이면 허용(Enter)·거절(Esc)·터미널에서 보기, 그 밖(선택지 질문, terminal.asking)은 "터미널에서 답하기"만(Enter가 모르는 첫 답을 고르지 않게). 포켓몬 스프라이트가 통통 튄다(`wMonHop`, needs-you·asking일 때만, reduced-motion이면 없음).
   - **박스 아이콘**: SV 아이콘(pokemondb)은 포켓몬 실제 크기로 잘려 있어 작은 종은 30px 안팎이다. 칸에 맞춰 키우던 것을 원래 크기 이하로만(최대 48px) 보이게 했다. 더 좋은 일관된 아이콘 출처는 찾지 못함. 칸 padding 14~16, gap 10~12, 칸 76(아이콘)·96(그림).
   - **위쪽 탭**: 포켓몬 이름(`w-term-tab-project`) 제거, 스프라이트 title로.

7-15. **2026-11-09 1.3.25**
   - **세션 탭**(`src/components/SessionTabs.tsx`): 뷰 바 아래 별도 줄(`.w-sess-tabs`), 터미널 화면에서만. 1.3.25의 브라우저 탭 모양(터미널과 이어지는 탭, 늘어나는 폭)은 사용자가 거절해 1.3.26에서 예전 탭 모양(내용 폭, gap 4, 선택 탭은 card-2 배경+테두리)으로 되돌림. 사용자 요청은 '방식만' 바꾸는 것이었다: 디자인 변경은 요청받은 범위만. 끌기는 HTML5 DnD가 아니라 pointer capture: 4px 넘게 움직이면 드래그, 시작 때 잰 탭 rect로 목적 슬롯(다른 탭 가운데를 몇 개 지났나)을 계산, 다른 탭은 transform으로 비켜남(0.15s). 놓으면 `terminals.move(id, to)`, main의 목록이 따라올 때까지(최대 1.5s) 낙관적 순서(`order`)로 그린다. 드래그 뒤 click은 무시.
   - **교체**: 줄 버튼은 ⇄ 아이콘(`SwapIcon`). `SwapPicker`는 파티 + 박스(아이콘 그리드, 레벨순, 이름 검색), 일하는 포켓몬·조력자는 흐리게 disabled. 서버 `swap(sessionId, uid)`가 박스 포켓몬도 받는다: 지금 포켓몬의 파티 칸에 들어가고 지금 포켓몬은 박스의 그 자리로.
   - **쉬는 세션의 교환**: `exchange(boxUid, partyUid)`는 파티 포켓몬의 세션이 쉬는 중(`sessionResting`: working·compacting·waiting 아님, hard needs-you 아님)이면 허용하고 그 세션을 박스 포켓몬에게 넘긴다(`assign[sid] = boxUid`). 위젯은 `restingUids`(mood idle·error 줄)를 `BoxView`에 넘겨 드래그·교환 버튼을 연다.
   - 도감·박스 칸 테두리는 등급색 대신 `rgba(255,255,255,0.1)`. 한도 라벨 칸 34→44px + nowrap(영어 "5-hour").

7-16. **2026-11-09 1.3.26**
   - 탭은 1.3.24 모양으로 되돌림(7-15 참고), 박스 안 끌어서 끼워넣기(`arrangeBox(order)`, `/pokedex/arrange`·`game:arrange`, 정렬 "내 순서" `mine`은 localStorage `claudex-box-sort`, 왼쪽/오른쪽 절반으로 앞·뒤 막대, 검색·이로치 필터 중엔 끔. 동기화(merge.js)는 이 PC의 박스 순서를 먼저 둔다). 이브이 무작위 진화에 님피아(700) 추가.
   - **다른 AI 도구 1·2단계(7-9 B)**: `electron/adapters.cjs`. Claude Code는 `CLAUDE` 어댑터(events 'hooks', canResume). 설정 › AI 도구(`session.tools` [{id,name,command}] 최대 12, `session.defaultTool`)의 도구는 `terminalAdapter`(events 'pty'): 명령은 `splitCommand`(큰따옴표), Windows에서 .exe가 PATH에 없으면 `cmd.exe /d /s /c`로(npm .cmd 심). 이벤트는 `createActivity`가 PTY 출력으로 만든다: 출력 시작 때와 이어지는 동안 15초마다 `agent_working`(tool=도구 이름 → 지형은 도로), 8초 조용하면 `session_turn_end`, 키 입력 후 250ms 안의 짧은 출력은 에코라 무시, 10분마다 `session_cwd`(2시간 stale sweep 방지). main이 `serverPost('/event')`로 보낸다. 확인 필요는 `GENERIC_ASKING`(Codex·Gemini 승인 문구 포함) → terminal.asking. 이어하기 없음: 시작 시 복원은 같은 폴더에서 새로 연다(`open-sessions.json`에 tool). 새 세션 창(`ThrowPicker`)에 도구 고르기(도구가 하나라도 있을 때만). 왼쪽 줄에 도구 이름 태그. 실제 Electron에서 PowerShell로 확인(이벤트 3종, asking).
   - **3단계 조사(2026-11-09, 에이전트, 공식 문서 기준)**:
     - Codex CLI: Claude Code와 거의 같은 훅(`SessionStart/End`, `UserPromptSubmit`, `Pre/PostToolUse`(tool_name), `PermissionRequest`, `Stop`, `SubagentStart/Stop` …), stdin JSON, `commandWindows`. hooks.json/`[hooks]`(~/.codex 또는 <repo>/.codex). 비관리 훅은 `/hooks`에서 신뢰 승인 필요(`--dangerously-bypass-hook-trust`). `-c`로 훅 주입 가능한지 미확인. 세션 id를 미리 정할 수 없음(SessionStart에서 받음), `codex resume <id>`. 사용량은 커스텀 상태줄 없음(rollout JSONL `rate_limits` 또는 `codex app-server`의 `account/rateLimits/read`). 승인 문구 "Would you like to run the following command?" 등.
     - Gemini CLI: 2026-06-18부터 개인(무료·AI Pro/Ultra) 계정은 사용 불가, Antigravity CLI(`agy`)로 이전. 훅은 있음(`BeforeTool/AfterTool`, `AfterAgent`=턴 끝, `Notification`(ToolPermission)), stdin JSON. `GEMINI_CLI_SYSTEM_SETTINGS_PATH`로 사용자 파일을 안 건드리고 주입할 수 있어 보임(미검증). `agy`의 훅 형식은 확인 못 함.
     - 결론(사용자 결정): Claude Code가 기본, 정식 지원은 Codex만. Gemini·agy는 하지 않는다(설정의 빠른 추가도 Codex만). 목표: 도구가 바뀌어도 화면은 똑같이(걸음·확인 필요·사용량·이어하기).
   - **효과음**(`src/sounds.ts`): 파일 없이 Web Audio로 합성(포획: 두 음 올라감 + 희귀 이상 한 음 + 전설·환상 한 음, 도망: 내려가는 글리산도, 레벨 업: 짧은 3음, 진화: 5음, 이로치는 반짝임). 알림 창이 카드를 띄울 때 재생(`settings.notify.sound`, 기본 켬). 알림 창 `autoplayPolicy: 'no-user-gesture-required'`.

7-17. **2026-11-09 1.3.27**
   - 왼쪽 패널 접기: 위쪽 줄 맨 왼쪽 `w-side-toggle`(`SidePanelIcon`), `.widget.expanded.side-hidden .w-side { display: none }`, localStorage `claudex-side-hidden`. 단축키는 없음(Ctrl+B는 터미널 안에서 Claude Code가 쓴다).
   - Codex CLI 0.167.0을 이 PC에 설치함(`npm i -g @openai/codex`). 로그인은 사용자가 `codex login`. 다음: Codex 정식 어댑터(3단계), 개발자 관점 개선 목록(터미널 검색, 파일 경로 Ctrl+클릭, Ctrl+Tab/T/W, 턴 끝·확인 필요 OS 알림, git 브랜치 표시, 스크롤백 설정, 터미널 글꼴, README에 훅 공존·데이터 표).

7-18. **2026-11-09 1.3.28**
   - **랭킹 연습 상대(NPC)** `src/npcTrainers.ts`: 시드 고정 108명(한국 약 70%, 일·영), 2026-11-09 기준 도감 8~180에서 시작해 시간당 움직인다(트레이너마다 pace, 도감이 찰수록 느려짐, 이번 주는 월요일 KST 리셋, 이로치·전설도 조금씩). DB에는 넣지 않고 화면에서만 섞는다. **실제 참여자 3명마다 1명씩 빠지고**(`PEOPLE_PER_NPC`) 324명이면 0. 기본 켜짐, "연습 상대" 버튼으로 끔(localStorage `claudex-rank-npc`). 행에는 표시 없음, 랭킹 설명 줄 끝에 작고 흐리게 "일부 연습 상대가 포함되어 있어요"(사용자와 합의한 공개 방식 — 이 문구는 빼지 않는다). 시상대(2·1·3, 메달·받침대·왕관).
   - **`src/useDragOrder.ts`**: 탭(`SessionTabs`, x축)과 왼쪽 줄(y축)이 같이 쓰는 포인터 끌기. 4px 넘게 움직여야 시작하고 그때 pointer capture(안의 버튼·입력은 그대로). 앞 가장자리가 이웃의 가운데를 지나면 자리 바뀜(넓은 탭을 좁은 첫 탭 자리로 못 옮기던 버그 원인: 가운데 기준이었음). 놓은 뒤 main 목록이 올 때까지 낙관적 순서.
   - **편집 메뉴 단축키**: `role: 'editMenu'`가 Ctrl+X/Z/Y/A를 가로채 터미널에 안 갔다. 같은 항목을 `registerAccelerator: false`로 둔다. Claude Code에서 Ctrl+S는 입력 보관(stash), Ctrl+X는 조합 시작 키(실제 claude로 확인).
   - 위쪽 뷰 전환 아이콘만(`w-view-icons`), 바는 overflow hidden. 위젯·알림 카드 그림자 제거(투명 창 경계에서 잘림), 알림 뒤 대기 카드 대신 +N. 컨텍스트 막대 accent, 기록 구분선, 확률표 라벨 칸 max-content(영어 Sub-legendary).
   - **Codex 정식 어댑터(3단계) 진행 중**: 이 PC에 codex-cli 0.167.0 설치·로그인됨. 확인한 것: `-c hooks.<Event>=[{hooks=[{type="command",command="..."}]}]`로 사용자 config를 안 건드리고 훅을 넣을 수 있다. 처음엔 "Hooks need review … 2. Trust all and continue"가 뜨고 한 번 승인하면 해시로 기억(`--dangerously-bypass-hook-trust`는 다른 미검토 훅도 돌려서 쓰지 않기로). 그다음 Windows 첫 실행에 "Set up default sandbox (requires Administrator)" 메뉴 — 사용자가 Codex 세션에서 한 번 설정해야 함. 남은 확인: Windows에서 훅 command가 어떤 셸로 도는지(cmd/PowerShell/직접), 그에 맞는 `command_windows`(ELECTRON_RUN_AS_NODE로 Claudex.exe를 노드로), session id는 SessionStart 훅에서 받기(미리 정할 수 없음), 이어하기 `codex resume <id>`, 사용량은 rollout JSONL `rate_limits` 또는 `codex app-server`. 목표: 도구가 바뀌어도 화면 동일.

7-19. **2026-11-09 1.3.29 (1)**
   - 탭 끌기 회귀 수정: `useDragOrder`의 "안쪽 버튼이면 끌기 안 함"이 탭 자신(button)까지 걸렀다 → `inner !== currentTarget && currentTarget.contains(inner)`일 때만.
   - 뷰 전환: 평소엔 아이콘+글자, 위쪽 바가 넘칠 때만 아이콘(`viewsCompact`, ResizeObserver, 넘칠 때의 scrollWidth를 기억했다가 그만큼 넓어지면 글자 복귀). 사용자 의도: "스크롤 생길 때만 최소화".
   - Ctrl/Shift+Enter: 조합 중이 아니어도 줄바꿈을 15ms 늦게 보냄(조합이 막 끝난 글자를 xterm이 setTimeout(0)으로 보내기 때문), 조합 중 key 'Process'(229)도 `e.code === 'Enter'`로 인식.
   - **개발자 개선(추천 1·2·4·5)**: ① Ctrl+F 터미널 검색(`@xterm/addon-search` 0.16.0, 오른쪽 위 바, Enter/Shift+Enter/Esc, 노란 하이라이트) ② 출력의 파일 경로 Ctrl+클릭(`registerLinkProvider` + `FILE_REF`, 넓은 글자 셀 보정) → main `terminals:open-path`: 세션 cwd 기준으로 풀고 존재하는 파일만, `app.getApplicationNameForProtocol`로 vscode:// → cursor:// → `shell.openPath` 순(명령줄 실행 없음) ④ Ctrl+Tab/Ctrl+Shift+Tab 세션 이동, Ctrl+Shift+T 새 세션, Ctrl+Shift+W 닫기(Ctrl+T/W는 Claude Code 몫이라 비움, Widget의 capture keydown) ⑤ 세션 알림: 줄 mood가 needs-you가 되거나 working→idle이면 `widget:alert` → main이 창이 앞에 없을 때만 Notification(클릭 시 창 표시) + flashFrame. 설정 `notify.sessions`(기본 켬).
   - **컨텍스트 = HP**: 왼쪽 줄 막대가 남은 컨텍스트(100-used)로 줄어든다. 초록 >50%, 노랑 ≤50, 빨강 ≤20(포켓몬 HP 규칙), 앞에 작은 "HP". 숫자는 남은 토큰(`tokens()`: 124K, 1.2M; size가 없으면 남은 %), 툴팁 "남은 컨텍스트 124K / 200K (62%)". 모델명(`modelLabel`: 상태줄 display_name, 없으면 id를 "Opus 5.5"로)은 숫자 바로 왼쪽.
   - 시상대: 사다리꼴 윗면·그라데이션 제거, 둥근 평면 블록 + 메달색 윗선, 단색 메달. 기록 줄 padding 12px(레벨업 줄 8px).
   - 다음: 남은 개발자 개선 ③ 일반 셸 탭(보여줄 방식 상의) ⑥ git 브랜치 ⑦ 스크롤백 설정 ⑧ 터미널 글꼴 ⑨⑩ README 보강, 그리고 Codex 3단계(사용자 샌드박스 설정 대기).

7-20. **2026-11-09 1.3.29 (2)**
   - **`/clear` 버그**: `/clear`는 같은 터미널에서 새 session_id로 대화를 시작한다(SessionEnd `clear` → SessionStart `clear`). 앱은 터미널을 처음 id로 추적해서 줄이 "종료"가 되고 컨텍스트 HP가 옛 대화에 멈췄다. 이제 터미널이 claude를 띄울 때 env `CLAUDEX_SESSION_ID`(터미널 id)·`CLAUDEX_LINK_FILE`을 넣고, `claudex-hook.cjs`·`status-line.cjs`가 어떤 대화든 터미널 id로 보고한다. 앱 터미널의 SessionEnd `clear`는 보내지 않고, 서버는 SessionStart `clear`에서 main 상태·확인 필요를 초기화. 훅이 SessionStart마다 지금 대화 id를 `userData/session-links/<터미널 id>`에 써 두고, 다시 열 때(`terminals.create`의 resume) 그 대화로 `--resume`(`linkedConversation`). 업데이트 전에 열린 세션에는 env가 없어서 예전 동작.
   - **한글 끝 글자 + Ctrl/Shift+Enter 줄바꿈 두 번**: 한글 IME는 조합 중 Enter에 keydown을 두 번 준다(229 조합 중 → 확정 뒤 Enter). 둘 다 줄바꿈을 보냈다. 조합 경로에서 `imeEnterAt`을 찍고 150ms 안의 비조합 Enter는 무시.
   - 입력창의 글자를 덮는 네모 커서는 Claude Code가 진짜 커서를 숨기고(`?25l`) 직접 그리는 것(Windows Terminal도 같음). 앱에서 바꿀 수 없다고 안내함.
   - **랭킹**: 시상대 제거(사용자: "어색하다, 나중에 디벨롭"). 1~3위는 큰 줄(`.rank-row.top topN`: 메달 동그라미 순위, 아이콘 48/1위 60px, 금·은·동 옅은 배경 + 왼쪽 선). 동점은 같은 메달. 시상대 코드는 1afa7b7에 있음.
   - **왼쪽 줄 버튼**: 교체(⇄)·닫기(×)도 수정(✎)처럼 줄에 마우스를 올렸을 때만(opacity, 자리는 유지). "닫기?" 확인 중엔 보임, 키보드 focus-visible도 보임.

7-21. **2026-11-10 1.3.30 — 업데이트 뒤 세션이 안 열리던 문제**
   - 증상: 1.3.29로 업데이트하고 켜니 파티 6마리가 다 "일하는 중", 새 세션·이어하기 모두 막힘(복원도 안 됨). 사용자는 PowerShell로 옮겨 작업.
   - 원인: 서버의 `THROW_HOLD_MS`(던진 뒤 10분 동안 그 포켓몬을 붙잡음, `state.thrownAt`은 pokedex.json에 저장)를 `session_ended`가 풀어야 하는데, `before-quit`이 `postSessionEnded`를 보내자마자 `stopServer()`해서 신호가 도착하지 못했다. 09:16에 6개 복원 → 09:18 업데이트 재시작이라 6개 모두 hold 중이었다. 복원 루프도 `dex.assign` 전체를 used로 봐서 자기 자신이 가진 포켓몬을 못 받았다. 1.3.29 변경 탓은 아님(원래 있던 버그, 빠른 재시작에서만 드러남).
   - 수정: ① 서버 시작 시 `thrownAt` 비움(앱과 터미널은 서버와 함께 재시작되므로 지난 실행의 hold는 의미 없음) ② `before-quit`이 끝남 POST를 기다린 뒤(최대 2초) 서버 정지, `postSessionEnded`는 Promise ③ 복원은 돌아오는 세션의 기존 배정을 used에서 뺌. 회귀 테스트 `pokedex.test.ts` "a throw held by the last run…".

7-22. **2026-11-10 1.3.31**
   - **조력자 세션(사용자 결정: 상한 12, 조우는 평소와 같게 — "세션을 많이 여는 건 더 많이 일한 것")**: `server/pokedex.js` `SESSION_LIMIT = 12`. 파티가 다 나가 있으면 `ensureAssigned`가 쉬는 박스 포켓몬(일 안 하고 서브에이전트 조력자도 아닌)을 무작위로, `throwBall`은 박스 uid를 파티가 다 나간 뒤에만(`party-free`)·12 안에서만(`full`) 받음. 파티는 6 그대로. `swap`: 조력자 세션(일꾼이 박스에 있음)은 자리를 바꾸지 않고 일꾼만 교체. `exchange`: 자기 세션을 맡은 박스 포켓몬은 다른 세션을 못 넘겨받음. 클라이언트 `freeSessionCount`/`freeBoxUids`/`isHelperSession`(`pokedexStore.ts`), ThrowPicker는 파티가 다 나가면 박스 그리드(검색), 왼쪽 줄에 "조력자" 태그(묶음 대신 태그: 끌기 순서와 충돌), 복원 12개(`readOpenSessions` slice 12). 조우는 걸음(실제 작업)에 비례하므로 세션 수 보정 없음.
   - **셸 탭(③)**: `adapters.cjs` 내장 `SHELL`(id `shell`, events `none`, PowerShell `-NoLogo`, 예약 id라 `validTool`이 거부). 서버에 아무것도 안 보내므로 포켓몬 없음. 탭 줄 `>_` 버튼(`onNewShell`), 줄·탭에 `>_` 표시, HP줄·상태 알약 없음, 알림 제외, 최대 3(세션 12 + 셸 3 + 확인 카드 = WebGL ~16). 복원 시 같은 폴더에서 새 셸.
   - **git 브랜치(⑥)**: `terminals.cjs` `gitBranch(dir)`(위로 올라가며 .git, worktree의 .git 파일, detached면 짧은 해시; git 실행 없음) → IPC `terminals:branches`(최대 24폴더) → Widget이 15초마다, 세션 cwd(서버) 기준. 줄에 `⎇ 브랜치`, 탭 툴팁.
   - **설정(⑦⑧, 서브에이전트)**: `settings.terminal = { scrollback: 1000|5000|10000|50000, font: default|consolas|cascadia|d2coding }`(`electron/settings.cjs` 검사, `termFont.ts` `TERM_FONT_STACKS` — 모든 스택 끝에 Pretendard·맑은 고딕, 미설치 글꼴은 Consolas로). 설정 › 앱 맨 아래, 열린 터미널에 바로 적용.
   - **README(⑨⑩, 서브에이전트)**: "내 Claude Code 훅과 같이 쓰기", "저장하는 것과 보내는 것"(한국어 README만, en/ja 아직).
   - 테스트: 스크립트 테스트가 앱 터미널 안에서 돌면 `CLAUDEX_SESSION_ID`가 섞여 실패 → 테스트 env에서 비움.
   - **서브에이전트가 찾은 것(결정 대기)**: 설정 "요청 내용 숨기기"(`privacy.hidePrompts`)는 화면에서만 가림 — 포획 기록 `via.prompt`(요청 앞 40자)·프로젝트 폴더 이름·도구 인자 앞부분이 게임 사본으로 클라우드(Supabase)에 올라감. `cleanEnv`가 사용자가 둔 `CLAUDE_CODE_*`도 뺌. `server/pokedex.js` 주석의 "logPrompts setting"은 없는 설정.
   - **다음(사용자 합의, 2026-11-10)**: ① 서비스 전체 코드 리뷰 ② 개발 실행으로 화면 확인(조력자 태그·셸 탭·브랜치·설정) ③ README.en/ja에 같은 섹션. 앞으로 모든 작업은 superpowers로 계획 먼저.

7-23. **2026-11-10 1.3.32 — 최적화 리뷰와 멈춘 종료 수정 (branch perf/optimization, 계획 `docs/superpowers/plans/2026-11-10-claudex-optimization.md`)**
   - 진행: 사용자 요청 "서비스 전체 코드 리뷰, 목적은 최적화". 읽기 전용 리뷰어 3명(화면/서버/본체·훅) → 계획(사용자 승인, 결정 A 걸음 저장 30초, B 비동기 훅은 PreToolUse·PostToolUse·PostToolBatch만, C 스크롤 1000/5000/10000, D 멈춘 인스턴스 종료) → 구현은 메인 세션, 작업마다 새 리뷰어 + 브랜치 전체 최종 리뷰(opus).
   - **멈춘 종료(실측)**: 11-09 16:59 업데이트 재시작 때 이전 main이 네이티브 정리 단계에서 멈춰 ~550MB를 쥐고 relauncher와 함께 하루 넘게 남음(파이프 동기 읽기에 막힌 스레드). 원인: `before-quit`이 node-pty의 비동기 kill(콘솔 목록 에이전트 fork, conout 워커 정리) 도중 앱을 끝냄, 그리고 node-pty는 프로세스가 스스로 끝나면 가상 콘솔·conout 워커를 닫지 않음. 수정: `terminals.shutdown()` = taskkill /T /F로 트리 종료 → 종료 대기(한 기한 3초) → 모든 pty `kill()`(ClosePseudoConsole) → 1.2초 드레인. `close()`도 끝난 세션의 pty를 닫음. `main.cjs` before-quit: 창 숨김 → [session_ended POST → `POST /flush`] ∥ shutdown → 서버 정지 → quit. 패키지 빌드는 `quitWatchdog.cjs`(노드 모드 별도 프로세스, 10초 뒤 main 강제 종료). 14:54 재시작 때도 이전 빌드(수정 전)가 같은 식으로 남음 → 수정은 14:56 빌드부터, 실제 재시작 확인은 사용자 대기.
   - **서버**: 도감 걸음만 바뀐 저장은 30초 묶음(`saveSoon`/`flush`, 포획·레벨 등은 300ms 그대로), agents.json은 실제 상태 변화 때만(활동 시각만 → 5초), 등록부 전용 세션은 저장 안 함, `writePrivate` tmp+rename, 상태줄이 같으면 방송·로그 안 함, 클라우드는 400/401만 로그아웃(그 외 `offline`, 5분 뒤 재시도)·요청 15초 제한·동기화 겹침 없음, 로그 파일에서 `#token=` 지움(옛 로그 포함).
   - **터미널**: 출력 16ms 묶음 + 묶음 번호(`seq`), 버퍼는 보낸 조각만(200KB, 조각 배열), 탭 열기는 `terminalReplay.ts` 게이트(겹침·누락 없음), 화면은 터미널별 IPC 라우팅(`onTerminalData`), WebGL은 보이는 터미널만(숨기면 30초 뒤 해제).
   - **화면**: 도감·박스·오늘·랭킹 `React.memo` + `useLang()`(설정 오버레이에서 언어 바꿀 때), 박스의 resting Set 안정화, 같은 상태줄이면 meters 상태 그대로.
   - **훅**: PreToolUse·PostToolUse·PostToolBatch에 `async: true`(Claude Code 문서 확인: hooks "Run hooks in the background"). 모든 이벤트에 `at`(훅 시작 시각). 서버는 메인 스레드 상태 변화(`main.since`)보다 오래된 도구 호출, 대기(`needsYou.since`)보다 오래된 도구 결과·서브에이전트 도구 호출을 무시.
   - **세션 카드**: 두 줄(1줄 이름+상태, 2줄 Lv·폴더·도구·브랜치·조력자 상자 아이콘 `HelperIcon`), 버튼은 2줄 끝에 겹쳐 뜸(`--row-bg`).
   - 측정 기준(작업 전): Claudex 프로세스 합 약 2.2GB(멈춘 인스턴스 포함), 훅 1회 중앙값 183ms(Claudex.exe 노드 모드 시작 140ms).
   - **미뤄 둔 것(사용자: "이후에 해결")**: 늦은 서브에이전트 호출이 조력자를 10분 다시 불러냄(`pokedex.js` helperFor), 백업 내보내기 전에 `/flush` 안 함(최대 30초 걸음 빠짐), 종료 중 트레이·알림 클릭으로 창이 다시 뜸. 그 밖의 작은 것은 계획 워크스페이스 장부에 있었음(브랜치 머지 후 삭제).
   - 사용자 문의 답: 같은 종 재포획 가능(새 종 ×8, 잡을 때마다 ×0.9, 최저 0.3) — 지금 일반 등급 중복 확률 약 2.3%. 도감 완성 기대값(시뮬 40회) 약 9,000마리 포획·1만 번 조우, 하루 31번이면 약 11개월(병목은 환상 23종).
   - Codex: 로그인은 사용자가 11-09에 `codex login`한 `~/.codex/auth.json`을 Codex CLI가 재사용(Claudex는 관여 안 함). 사용량·HP는 Codex에 상태줄·훅이 없어 비어 있음 → `~/.codex/sessions` 기록에서 읽는 기능은 다음 후보(계획 먼저).

7-24. **2026-11-10 1.3.33 — Codex 정식 연동, 백그라운드 셸, 미뤄 둔 것**
   - **백그라운드 셸**: Port Congestion 세션이 `pnpm dev`(run_in_background) 때문에 턴이 끝나도 `waiting`(= 일하는 중 표시)에 머묾. 사용자 결정 "셸은 쉬는 중": `server/index.js` `TASK_SHELL`(shell|bash|local_bash)은 `waitingOn`에서 뺌, 서브에이전트만 waiting.
   - **Codex(사용자: "모든 기능 호환")**: `electron/codexWatch.cjs`가 `~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread>.jsonl`을 1초마다 따라 읽음 → session_prompt(사용자 메시지, `<…>`·"# AGENTS.md instructions"는 제외)·agent_working(exec→Bash, apply_patch→Edit 등)·session_turn_end(task_complete)·session_model(turn_context)·`POST /status`(token_count: 컨텍스트 = last_token_usage.total/model_context_window, `codexLimits` primary/secondary). 어댑터 `kind: 'codex'`(`codexTool`: 명령이 codex/codex.cmd/codex.exe), `canResume`, `codex … resume <thread>`; 스레드 id는 `session-links/<탭 id>`(UUID 검사). 기록을 찾으면 출력 기반 활동은 `mute()`(진행 중이던 턴은 끝냄).
     - 기록 찾기: 공유 매처 — 기록 머리의 시각은 그 Codex 시작 시각(파일은 첫 요청 때 생김). 탭을 연 뒤 -2초~+5분 안에 시작한 기록만, 그중 가장 최근에 연 탭에(10초 안에 함께 연 탭끼리는 연 순서). 닫은 탭의 기록은 retired(새 탭에 안 넘김, 이어 열기는 가능). 이어 열기는 날짜 폴더 전체에서 스레드 파일을 찾고, 10초 못 찾으면 새 기록을 따라감. 머리 줄 최대 32MB까지 읽음, UTF-8은 StringDecoder, 1분 넘게 못 찾으면 5초 간격.
     - 서버 `status.js`: `codexLimits`는 Claude 한도와 따로(전역 + at), summary·스냅숏·이벤트에 포함. 화면: 사용량 카드에 Codex 줄(기간 길이로 이름: 300분 5시간, 1주 주간, 28~31일 월간 — 사용자 계정은 실제로 30일 창), Claude 줄은 Claude 한도가 있거나 Claude 세션이 열려 있을 때만.
     - 복원: 셸 말고 모든 탭이 resume 경로(`create({resume, tool})`)로 같은 id를 유지(이어 못 하는 도구는 같은 id로 새로 시작, 설정에서 지운 도구는 새 Claude).
     - 한계: 이어하기 목록은 Claude만, Codex 안 `/new`는 첫 대화를 계속 따라감, 권한 확인은 화면 문구 감지 그대로.
   - **프롬프트 숨기기**: 서버가 `CLAUDEX_SETTINGS_FILE`(없으면 %APPDATA%\Claudex\settings.json)에서 읽어, 켜져 있으면 클라우드 사본의 log·caught·mons의 `via`에서 prompt와 도구 인자 제거(`cloudCopy(game, { hidePrompts })`). 로컬 pokedex.json은 그대로. 설정 설명 문구 3개 언어 갱신.
   - **미뤄 둔 것**: 늦은 서브에이전트 호출이 끝난 조력자를 다시 부르지 않음(`pokedex.js` finishedAt), 백업 내보내기 전에 `/flush`, 종료 중 `createWidgetWindow`·`setWidgetMode`·`revealToast`·`ensureToastWindow`·창 전환 대기열·알림 클릭이 창을 만들거나 보이지 않음.
   - README: 영어·일본어에 "Using it with your own Claude Code hooks"/"What is stored and what is sent" 섹션, 세 언어 모두 async 훅·Codex·프롬프트 숨기기 반영.
   - 리뷰: opus 리뷰(중요 6) → 재검토(중요 1 남음: 놀고 있는 탭이 나중 탭의 기록을 가져감) → 재검토(닫은 탭 기록 재사용 불가, 30초 창이 너무 좁음) → 마지막 매칭 규칙(가장 최근 탭, 10초 안 FIFO, 5분 창)은 테스트로만 확인.

7-25. **2026-11-11 — 탭 닫기·셸 버튼·랭킹 1~3위(branch `ui/rank-tabs`), 업데이트 재시작·시작 카드(branch `perf/restart-startup`, 계획 `docs/superpowers/plans/2026-11-11-restart-and-startup.md`, 설계 `docs/superpowers/specs/2026-11-11-restart-and-startup-design.md`). 1.3.34로 릴리스(2026-11-11)**
   - **UI(사용자 요청)**: 위 세션 탭에 마우스를 올리면 상태 점 자리에 ×(세션 카드 닫기와 같은 동작, '닫기 전에 확인'이면 "닫기?"), ×는 span(버튼 안 버튼 불가)이고 pointerdown을 막아 끌기가 시작되지 않음. 셸(>_) 버튼은 탭 줄 오른쪽 끝에 테두리 버튼으로 고정(`.w-sess-bar` 안에서 탭만 스크롤), +는 마지막 탭 뒤 그대로(사용자: "새 세션은 동일한 위치"). 랭킹 1~3위는 포켓몬·글자 크기를 4위 이하와 같게, 행만 살짝 높게(10px), 금속색 배경 6%, 왼쪽 3px 선은 남기되 왼쪽 모서리를 각지게(사용자: 둥근 모서리에 선이 잘려 보이는 게 별로).
   - **측정(1.3.33 실제 로그)**: 업데이트 재시작 클릭 → 새 창 약 17초 = 종료 3.5초 + 옛 main 종료·두 번째 실행·robocopy 2.7초 + **설명 안 되는 9.3초**(두 번째 실행의 staged 폴더 삭제 ~1.9초 포함) + 새 앱 1.9초. robocopy는 이미 바뀐 파일만 복사(바뀐 게 없으면 0.4초, zip이 원래 mtime을 지켜서). 부팅 직후 첫 실행은 서버 준비까지 9초 동안 화면에 아무것도 없었음. 나머지 미룬 최적화 5개(바뀐 부분만 방송, 오래된 세션 정리 1.8KB, 스프라이트 워커, 트레이 메뉴, 로그 스트림)는 수치상 효과가 작아 **하지 않기로 함**(사용자 동의).
   - **세 프로세스**: 업데이트 재시작은 p1(옛 앱 종료) → p2(`updateRunner.cjs`: 안내 후 robocopy) → p3(새 앱). p1·p2는 투명한 창에 글자만 있는 안내(`statusCard.cjs` + `status-card.html`, 300×96, 앱 창 가운데, 작업표시줄·포커스 없음, 설정 언어: "Claudex 업데이트하는 중이에요…")를 띄움. 사용자 결정(2026-11-11): 디자인 없이 간단히, **시작할 때는 아무 카드도 없음**. **p1·p2는 이미 설치된 옛 코드가 돌리므로, 이 버전을 설치한 다음 업데이트부터 보인다.**
   - p2: `main.cjs` 맨 위 `if (app.isPackaged && hasPendingUpdate(...)) { runPendingUpdate(...); return }`(CJS 최상위 return, 앱의 나머지는 안 돎). 표시 파일을 먼저 지움(반복 방지), Electron 준비 후 카드, robocopy 비동기(인자 그대로), staged 폴더는 지우지 않음, `--claudex-updated`를 붙여 다시 실행. 실패해도 옛 코드로 한 번 실행.
   - p3/모든 시작: 창 상태 읽기·트레이를 서버보다 먼저(시작 카드는 만들었다가 사용자 요청으로 뺌). 첫 페이지 로드 10초 뒤 `%TEMP%claudex-update-*` 중 이번 실행 것이 아닌 걸 백그라운드로 지움(`cleanupStaleUpdates`, 설치본에서만).
   - **시간 기록**: `%APPDATA%\Claudex\update.log`에 `pid=<pid> p1|p2|p3 <단계> +<직전부터>ms total=<처음부터>ms`. p1: quit-start, sessions-posted, flushed, sessions-ended, server-stopped. p2: p2-start, robocopy-start, robocopy-end(code), relaunch. p3(업데이트 직후만): start, lock(waits), server-spawned, server-ready, window-loaded. 보통 시작도 `claudex.log`에 `[main] startup: …`.
   - **왼쪽 패널 접기(사용자 요청)**: 예전엔 `display:none`으로 통째로 사라짐 → 창·전체 화면 모드에서 폭 56px 세로 레일(`.w-rail`, Widget.tsx): 로고(패치노트, 연결 점), 업데이트 있을 때 ↑, 새 세션·폴더·이어하기, 열린 세션(포켓몬+상태 점, 누르면 열림, 많으면 이 부분만 스크롤), 사용량 막대 2개(5시간·주간, 없으면 Codex 앞의 두 줄), 설정. 로그인·도감 수·파티·지시 입력은 펼쳐야 보임.
   - README 세 언어의 "세션 최대 6개"를 12개(조력자)로 고침.
   - **측정 절차**: 이 코드를 담은 테스트 빌드로 한 번 재시작(이때는 옛 p1·p2가 돎) → 두 번째 테스트 빌드로 한 번 더 재시작 → update.log의 p1/p2/p3 줄로 9.3초가 어디서 나오는지 확인 → 그 수치로 3단계(고칠 것)를 작은 계획으로.
   - 리뷰(opus) 반영: 정리는 설치본에서만, updater가 만든 순간부터 그 폴더는 제외, 10분 안에 만든 폴더도 제외(압축 푸는 중인 업데이트를 지우면 반쯤 적용됨). robocopy는 stdio 무시(안 읽는 파이프가 차면 멈춤). 표시 파일을 못 지우면 이름 바꾸기, 그것도 안 되면 다시 실행하지 않음(반복 방지). p1이 카드 위치·언어를 표시 파일에 적어 p2가 같은 자리·언어로. 종료 중 window-all-closed 무시. 시작 중 예외에도 카드 닫힘.

7-26. **2026-11-11 — 앱 안 피드백, 도감 등급 다중 선택(branch `feat/feedback-pin`). 1.3.35로 릴리스(2026-11-11)**
   - **피드백(사용자 요청)**: 헤더 설정 옆·접힌 레일에 말풍선 버튼 → `FeedbackPin.tsx`가 바로 글쓰기 창("Claudex에 바라는 점", 종류 fix/add/direction/like)을 엶. **위치 찍기와 화면 첨부는 선택**(사용자: "선택적으로"): "화면에서 위치 찍기"를 누르면 핀 모드(아래 화면 안 눌림, Esc·오른쪽 클릭이면 글쓰기로 돌아감) → 핀 둘레의 알맞은 크기 요소(80×48~900×560, 아니면 520×320 상자)를 `capturePage`로 찍어 미리 보기 + "이 부분 화면도 같이 보내기" 체크. 터미널 화면(또는 `.xterm` 안)은 체크가 꺼진 채 시작하고 경고, 터미널 글자는 이슈에 안 적음.
   - 보내기: `electron/feedback.cjs`가 제목·본문(종류, From app, 화면, 요소 경로, 그 자리 글자, 창 크기, 언어, 앱 버전, OS)을 만들고 **주소는 main이 `DueStar/claudex/issues/new`로 고정**(페이지가 다른 주소를 못 엶). 그림은 새 이슈 링크에 못 실어서 클립보드에(본문에 숨은 주석으로 Ctrl+V 안내). 복사는 글만 클립보드. IPC `feedback:capture|send|copy`, 테스트 `tests/feedback.test.ts`. 라벨 `feedback`은 권한 없는 사람이 올리면 GitHub가 뺌 → 제목 `[feedback]`으로 찾기.
   - 소개 사이트(`Documents\spawn-site\`)의 "의견 보내기"도 같은 형식(`[feedback]`, From website). 사용자 뜻: 사이트가 아니라 **서비스에 대한 의견·방향·고칠 것·추가할 것**을 받는 곳. 나중에 `gh issue list --search "[feedback]"`로 읽고 고친 뒤 닫는 흐름.
   - **도감 등급**: 하나만 → 여러 개 함께(`tiers: Tier[]`, 아무것도 안 고르면 전체, `aria-pressed`).

7-27. **2026-11-11 — 조우 줄이기(완성 약 2년 3개월), 피드백은 설정으로, 접힌 패널 다듬기(branch `tune/encounters`, 1.3.36에 포함)**
   - **조우(사용자 요청: "조우가 너무 잦다", 900종은 조금 늦게·완성은 조금 빨리, 전설·환상은 끝에 남되 그 구간이 너무 비지 않게, 보장 수치는 원래대로)**: 실제 기록(5일, 야생 만남 하루 약 34번, 148종)으로 게임 규칙을 그대로 돌린 시뮬레이션(100~200회). 바꾼 것: `ENCOUNTER_PER_STEP` 0.03→**0.01**(하루 약 11번), `NEW_SPECIES_BOOST` 8→**3**, **보장(전설 150·환상 300, 그대로)으로 나오는 건 아직 못 잡은 종**(남은 게 없으면 예전처럼 그 등급 아무거나). 중앙값: 900종 약 166일, 전설·환상 빼고 전부 약 246일, 전설 다 약 584일, **완성 약 822일(2년 3개월)**, 끝에 남는 건 환상. 끝판이 길던 원인은 이미 잡은 전설·환상이 다시 나오는 것(환상 1종 남았을 때 보장이 새 종일 확률 약 29%). 같이 본 안: 도망간 전설·환상이 배회하다 다시 나오게(완성 약 663일) — 사용자가 고르지 않음. README 세 언어 "걸음마다 3%"→1%.
   - 피드백 버튼은 헤더·레일에서 빼고 **설정 › 앱 › 의견 보내기**로(사용자 요청). 누르면 설정이 닫히고 같은 글쓰기 창.
   - 접힌 레일: 초록 막대(사용량 5시간·주간)가 뭔지 모르겠다고 해서 아래에 "사용량" 글자. 열린 세션(포켓몬) 사이 간격 4px→9px.

7-28. **2026-11-11 — 이름 Claudex → spawn (branch `rename/spawn`, 계획 `docs/superpowers/plans/2026-11-11-rename-spawn.md`). 1.3.36으로 릴리스**
   - 사용자 결정: 표기는 어디서나 소문자 `spawn`, 내부 이름·데이터·GitHub 저장소까지 전부, 앱 아이콘은 `spawn-app-icon-white-gradient`(바뀔 수 있음). 브랜드 원본은 `%USERPROFILE%\Downloads\spawn-brand\`(색: Crescent #F2C94C, Aurora Pink #F49AC1, Dream Sky #7FC2E8, Ink #111111, 워드마크 Uncut Sans 570 -3%).
   - **데이터 이사(복사만, 지우지 않음)**: `server/runtime-dir.cjs` — `~/.spawn`, 없으면 `~/.claudex` → `~/.agent-office` 순으로 가장 새 것을 한 번 복사(임시 폴더 → rename, 옛 폴더에 `MOVED-TO-SPAWN.txt`). `SPAWN_HOME`, 없으면 `CLAUDEX_HOME`. `electron/userDataMigration.cjs` — `%APPDATA%\Claudex`(dev는 `Claudex-dev`) → `%APPDATA%\spawn`을 main.cjs 맨 처음(업데이트 표시 확인보다 먼저) 한 번 복사, 캐시·`pending-update.json`은 뺌. 페이지 저장값 `claudex-…`/`claudex.…` → `spawn-…`은 `src/storageMigration.ts`(main.tsx 첫 import)가 한 번 복사.
   - **옛 이름도 계속 읽음**: 환경 변수 `CLAUDEX_*` → `adoptLegacyEnv`(main 시작 때 `SPAWN_*`로 복사) + `envVar` 폴백. 세션에는 `SPAWN_SESSION_ID`와 `CLAUDEX_SESSION_ID` 둘 다(사용자 훅용). 서버 확인 `spawn-health:`·`claudex-health:` 둘 다. 업데이트 재시작 플래그 `--spawn-updated`·`--claudex-updated` 둘 다(p3 시간 기록), 임시 폴더 정리 `spawn-update-*`·`claudex-update-*` 둘 다. 로그인 항목은 시작 때 옛 `electron.app.Claudex` Run 값을 지우고 설정대로 새 이름으로.
   - **업데이트 호환(중요)**: 1.3.35 이하는 `app.file`이 `claudex-app-`으로 시작해야만 받음 → **앱 zip 이름은 계속 `claudex-app-<v>.zip`**(release.mjs), 새 버전은 `(spawn|claudex)-app-` 둘 다 받음(나중에 바꿀 때를 위해). 전체 zip은 `spawn-<v>-win-x64.zip`. 옛 앱은 `DueStar/claudex` 주소를 GitHub의 이름 변경 리다이렉트로 따라감 → **`DueStar/claudex`라는 저장소를 새로 만들면 안 됨.** 서명 키는 그대로 `~/.claudex-release/signing-key.pem`(`SPAWN_SIGNING_KEY`/`CLAUDEX_SIGNING_KEY`).
   - 실행 파일: 업데이트로 받은 설치는 계속 `%LOCALAPPDATA%\Claudex\Claudex.exe`(앱 업데이트는 resources/app만 바꿈), 새로 받은 전체 zip은 `spawn.exe`. `install-local.cmd`는 둘 다 닫음.
   - **브랜드 5차(2026-11-11, 최종)**: 사용자 결정 "모든 아이콘을 그냥 Dream Poké Ball로, 개인용이고 문제 소지 있으면 내릴 의향" → `DownloadspokeballDream_Poké_Ball_Sprite.png`(원본 127px, 볼만 90px)를 잘라 앱·창 아이콘(512), 트레이 16/32/48, macOS 템플릿(볼 모양 검정), `public/sprites/spawn-ball.png`로 **저장소에 커밋**(NOTICE.md에 닌텐도 그림·비영리·요청 시 내림 명시). `PokeBall`은 게임 볼 그림(`poke-ball`, 같은 Dream 볼), 없으면 spawn-ball.png. Wikimedia 아이콘(`public/brand/`)과 빌드 때 아이콘 바꾸기는 없앰. "새로운 세션 시작하기" 버튼은 + 아이콘.
   - **브랜드 4차(2026-11-11, 사용자: "공개된 아이콘으로 다 통일")**: Wikimedia Commons "Poké Ball icon"(Andreuvv, **CC BY-SA 4.0**, NOTICE.md에 출처·라이선스·변경 내용) → `public/brand/pokeball.svg`(여백 잘라냄), 앱·창 아이콘 `build/icon.png`·`electron/assets/icon.png`(512), 트레이 16/32/48, macOS 템플릿(검정 외곽선), 대체 그림 `public/sprites/spawn-ball.png`. `PokeBall`은 `ball`이 없으면 이 아이콘(헤더·레일·새 세션 버튼), `ball`이 있으면 그 볼의 게임 그림 그대로. release.mjs는 더 이상 빌드 때 아이콘을 바꾸지 않음. 렌더는 임시 폴더에서 `@resvg/resvg-js`로 했음(저장소 의존성 아님).
   - **브랜드 3차(2026-11-11, 사용자: "심볼이 너무 구리다, 몬스터볼로")**: 매듭 심볼은 모두 뺌. 앱·창·트레이 아이콘은 이름 변경 전 몬스터볼(`git checkout 31eb9ba --` 아이콘 파일들), release.mjs는 다시 `build-icons.py --official`로 게임 몬스터볼을 빌드 때 넣었다가 되돌림, 헤더·접힌 레일은 `PokeBall`(둘 다 20px, 같은 자리), `public/brand/`·`SpawnMark`·`.ico` 삭제, 바로가기 아이콘은 exe 아이콘. 이름 `spawn`은 그대로. 로고 색에서 온 탭 면·일하는 세션 테두리는 남겨 둠(사용자 확인 대기). 아래 2차·1차 내용은 이걸로 대체됨.
   - **브랜드 2차(2026-11-11, 3D Toon 심볼로 바뀐 brand 폴더)**: 앱 아이콘 = `app-icon/spawn-app-icon-512.png`(검정 배경 둥근 모서리), Windows 실행 파일 아이콘 = `desktop/spawn.ico`(`build/icon.ico`, package.json win.icon), 창 아이콘도 `electron/assets/icon.ico`(업데이트로 받은 설치는 Claudex.exe를 계속 써서 실행 파일 아이콘이 옛 몬스터볼 → 창 아이콘으로 작업 표시줄은 새 아이콘), 트레이 16/32/48 = `symbol/spawn-symbol-<n>.png`(3D 컬러, 밝은·어두운 작업 표시줄 둘 다 보이게), 헤더·레일 = `symbol-mono/spawn-symbol-white.svg`(32px 이하 단색 규칙), 큰 곳용 `public/brand/spawn-symbol.png`. `desktop-shortcut.ps1`은 Claudex.exe도 찾고 아이콘은 `resourcesappelectronassetsicon.ico`. 아래 1차 내용은 이걸로 대체됨.
   - 로고: `public/brand/spawn-symbol-white.svg`·`-color.svg`, `SpawnMark`(Icons.tsx)를 헤더·접힌 레일에(24px 이하 단색 규칙). 앱 아이콘 `build/icon.png`·`electron/assets/icon.png` = white-gradient 512, 트레이 16/32/48 = 컬러 심볼, macOS 템플릿 = 검정 심볼. release.mjs는 더 이상 build-icons.py로 몬스터볼 아이콘을 그리지 않음. 게임 안 몬스터볼 그림(`public/sprites/spawn-ball.png`, 옛 claudex-ball.png)은 그대로.
   - **실제 업데이트에서 잡은 버그(테스트 빌드, 2026-11-11 14:52)**: 첫 1.3.36 시작 때 `%APPDATA%Claudex`가 아직 바빠서(업데이트 복사 단계의 옛 프로세스가 끝나는 중) 설정 폴더 복사가 실패 → 앱이 로그용으로 `%APPDATA%spawn`을 만들고 "폴더가 있으니 끝"으로 판단 → 세션 자동 열기·세션 이름이 빠짐(데이터는 옛 폴더에 그대로). 고침: 끝남은 표시 파일(`.copied-from-claudex.json`)로, 항목마다 따로 복사·3초 안에서 재시도, 실패한 항목은 다음 시작에 다시, 복사 없이 시작한 새 폴더보다 옛 상태가 이김, update.log는 이어 붙임, 결과를 spawn.log에 남김. 이 PC는 다음 테스트 빌드 재시작 때 옛 상태(세션 이름 9개, 다시 열 세션 8개)가 돌아와야 함.
   - 가끔 실패하던 `cleanupStaleUpdates` 테스트의 원인: 정확히 10분 경계(파일 시각이 ms보다 잘게 기록됨) → 여유 1초.
   - 바깥에 남은 것: Google/Supabase 로그인 동의 화면 앱 이름, 로컬 폴더 이름 `Documents\pokemon-office`(사이트·홍보 폴더는 2026-11-12에 `spawn-site`·`spawn-site-backup`·`spawn-promo`로 바꿈).

7-29. **2026-11-11 — 1.3.37 (branch `brand/logo-gradient`)**
   - 로고·아이콘은 7-28의 "브랜드 4차"대로(Wikimedia Commons Poké Ball icon). 매듭 심볼과 3D 아이콘은 모두 뺌.
   - 그라데이션 시안(`Documents\spawn-brand-samples\gradient.html`) 중 사용자 결정: 버튼은 노랑 한 색(A), 그라데이션 글자·진행 막대·포획 알림·포커스는 기각, **탭은 C(옅은 세 색 면, `--brand-soft`)**, **세션 카드는 A+C(고른 세션은 노랑 테두리, 고른 세션이 일하는 중이면 도는 세 색 테두리, `.w-row.chosen.mood-working::before`, @property --w-spin)**, 큰 화면 빛은 사이트에만. 세 색(#F2C94C/#F49AC1/#7FC2E8)을 심볼 없이도 유지할지는 **사용자 확인 대기**.
   - **창 크기 조절 깜빡임(사용자 제보)**: 원인은 1px마다 fit + pty resize → Claude Code가 매번 화면 전체를 지우고 다시 그림 → 깜빡임, 나란히 조절할 때 창이 그림을 못 따라가 빈 화면. 고침: TerminalPanel은 ResizeObserver를 프레임당 한 번으로, pty 크기는 드래그가 멈추고 150ms 뒤 한 번(같은 크기면 안 보냄), terminals.cjs도 같은 크기는 pty.resize를 건너뜀(테스트). **실제 드래그 확인은 사용자 몫(아직 결과 못 들음)**.
   - 패널 접기 버튼: 탭 줄 왼쪽 → 펼쳤을 땐 왼쪽 패널 헤더(설정 옆), 접었을 땐 레일의 로고 아래. 탭·글자 크기·화면 모드 버튼 호버.
   - 업데이트 재시작이 3분 걸린 일(06:52, 중복 빌드가 동시에 돌던 때): p1 server-stopped 뒤 2분 15초 동안 옛 프로세스가 안 꺼짐(세션 5개 stuck), robocopy 30초(/R:20 재시도로 보임). 3단계 재시작 속도 작업 때 원인부터.
   - 소개 사이트(`Documents\spawn-site\`)는 Subframe 느낌으로 개편 중(서브에이전트, 저장소 밖). 개편 전 백업 `Documents\spawn-site-backup\`.

7-30. **2026-11-11 — 1.3.38 (branch `brand/dream-ball`)**
   - 아이콘: 7-28 "브랜드 5차" 그대로(Dream World Poké Ball, 저장소에 커밋, NOTICE에 비영리·요청 시 내림). 업데이트로 받은 설치는 Claudex.exe/spawn.exe 내장 아이콘이 안 바뀜 → 창 아이콘(`APP_ICON` png)으로 작업 표시줄은 바뀜, 실행 파일 아이콘은 새로 설치(`install-local.cmd` 또는 Releases 전체 zip). 이 PC는 Windows 아이콘 캐시가 예전 그림을 붙잡고 있어서 `ie4uinit -show`로 안 되고 탐색기 재시작 + `%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db` 삭제로 해결.
   - 세 색(매듭 심볼 팔레트)은 사용자 결정으로 **노랑 한 색**: 고른 탭은 원래 노랑 면(`--accent-soft`), 일하는 고른 세션은 노란 빛이 테두리를 따라 도는 conic(`.w-row.chosen.mood-working::before`), 사이트 `--hero-glow`도 노랑 계열.
   - 왼쪽 패널 헤더: "spawn" 글자 없이 볼만(`.w-brand` 버튼 안의 PokeBall, 패치노트), `.w-side` 좌우 패딩 0 + 칸마다 14px(구분선이 끝까지), 헤더 padding-left 18px(볼 가운데 28px, 레일과 같은 자리). 닫기 확인 문구 `닫기?` → `닫기`(위 탭 ×도).

7-31. **2026-11-11 — 1.3.39**
   - 아이콘: 사용자가 만든 `Downloads\pokeball\Dream_Poke_Ball_y-12_p-16_r0_{128,256,512}.png`(비스듬히 본 Dream 볼). 볼만 남게 잘라서 512 원본 → 앱·창 아이콘 512, 256 → 화면용 128(`public/sprites/spawn-ball.png`, gitignored `public/sprites/balls/poke-ball.png`, 사이트 `spawn-site/assets/img/poke-ball-dream.png`), 128 → 트레이 16/32/48, macOS 템플릿은 512에서 검은 볼에 휜 띠·버튼 둘레를 비움. `front` 폴더(정면 그림)는 쓰지 않음. `poke-ball.png`는 저장소에 없으니 릴리스는 이 PC에서 빌드.
   - 헤더 워드마크(사용자가 비교 화면에서 고름): Uncut Sans 600, 17px, 자간 -2%, 볼 20 옆 6px. 소문자 몸통 가운데가 볼 가운데보다 1.5px 아래 → 사용자가 +0.75 내림을 골라 `.w-brand-name { transform: translateY(-0.75px) }`. 레일(접힌 패널)은 볼만.
   - 기록 화면이 빈 원인: `publicState().log`가 최근 30개만 보냈고, 재시작·세션 열기로 sendout이 쌓이면(이날 105개) 기록 화면이 sendout을 숨겨 거의 비어 보였음. 서버에서 sendout·swap·exchange를 먼저 빼고 최근 200개(`PUBLIC_LOG`). 저장 파일은 멀쩡했음.
   - 박스 칸 Lv·볼 표시 제거(상세 카드에는 남김). 도감 확률 표·툴팁의 "만날 확률" 제거, `TIER_RATE` 삭제(사용자: 비공개가 낫다). 확률 표가 있던 도감 오른쪽 칸은 아무것도 안 고르면 비어 있음 — 숨길지 사용자 결정 대기.
   - 접힌 레일: 구분선 `align-self: stretch`(끝까지), "사용량" 글자 제거, 설정 아래 프로필(`.w-rail-account`, 누르면 패널 펼치고 계정 카드) / 로그아웃 상태면 "로그인". 헤더의 패널 접기 버튼 색을 설정 톱니와 같게(`--ink-2`).

7-32. **2026-11-12 — PC를 끄면 다시 열 세션 목록이 비던 문제 (branch `fix/keep-sessions-on-shutdown`, 1.3.40)**
   - 사용자 제보: "업데이트에서 세션 목록이 또 싹 사라지고 다시 켜면 새 세션으로 켜진다". 증거: 11-11 17:29 server exit code 1073807364(0x40010004, Windows 종료·로그오프가 강제로 끔), 11-12 01:12 1.3.38 시작 때 복원 없음, 바로 뒤 업데이트 p1 `sessions-posted n=0`. 세션 이름(window-state 9개)은 남음.
   - 원인: `terminals.cjs`의 `rememberOpen`이 세션이 끝날 때마다 open-sessions.json을 바로 다시 씀. Windows는 앱을 죽이기 전에 세션 프로세스들을 하나씩 끝내고, 앱의 종료(before-quit → shutdown → frozen)는 돌지 않음 → 한 개씩 빠지다 []로 저장.
   - 고침: 스스로 끝난 세션은 5초(`exitGraceMs`) 뒤에 목록에서 빠짐(그 사이 앱이 죽으면 목록 그대로), 탭을 직접 닫거나 열거나 옮길 때는 바로 씀. `freeze()`를 내보내고 main에서 창의 `query-session-end`·`session-end`(Windows 전용)에 연결. 테스트 3개(하나씩 끝나도 목록 유지, freeze 뒤 안 비워짐, 직접 닫기는 즉시).
   - 이미 사라진 이 PC의 목록은 되살릴 수 없음 → "이어하기"(예전 세션 목록, 이름은 남아 있음)로 다시 열기.

7-33. **2026-11-12 — 여행의 시작 친구들 (같은 branch, 1.3.40)**
   - 사용자: "여행의 시작부터 함께 한 친구들도 몬스터볼을 배정, 기본 몬스터볼. 시작은 스타팅으로 분류되는 애들 중 1마리 + 일반 5마리, 모두 Lv.5. 이미 있는 애 레벨은 내리지 말고."
   - 확인: 개체(mons)에는 이미 poke-ball·metLevel 5가 있었음. 빈 곳은 **도감 기록(caught)의 ball**(볼을 저장하기 전 버전이 만든 시작 친구 기록). → `upgradeMons`에서 how가 starter/gift인 caught에 ball이 없으면 'poke-ball'(불러올 때와 동기화 때 둘 다). 레벨은 손대지 않음.
   - `STARTERS`를 1~9세대 첫 단계 27마리로(데이터에 있는 것만 후보), 시작 파티는 스타팅 1 + 일반 등급 기본형(진화 가능) 5, 모두 `ball: 'poke-ball', level: STARTER_LEVEL(5)`. README 세 언어 고침. 테스트 3개.

7-34. **2026-11-12 — 아이콘이 업데이트를 따라가게, 선명하게 (main, 1.3.41)**
   - 사용자: "데스크탑 아이콘이나 작업표시줄 아이콘 적용이 안 된 것 같다, 화질 저하도", "다른 트레이 아이콘들은 16px보다 훨씬 커 보여", "왼쪽 패널 로고는 아직 변경이 안 됐네", "활성화된 세션은 아니지만 일하는 세션은 연한 회색으로 그라데이션 돌려줘".
   - 원인 1: 앱 안 업데이트는 `resourcesapp`만 바꾸므로 `spawn.exe`와 그 안의 아이콘은 처음 설치 그대로(이 PC는 정면 볼). 바탕화면 바로가기는 `spawn.exe,0`이었고, 바로가기로 연 창의 작업 표시줄 버튼도 그 아이콘을 따름(창 아이콘 icon.png는 이미 새 그림이었음).
   - 원인 2: electron-builder가 만든 .ico에 256px 한 장뿐 → Windows가 즉석에서 줄여 뭉갬. 트레이는 16px PNG 한 장 → 150%(이 PC 2560×1600)에서 24px로 늘려 흐림. 트레이 기준 16px은 100% 기준이고 배율만큼 커짐(150%=24, 200%=32).
   - 고침: `scripts/make-win-icon.ps1`이 `electron/assets/icon.png`(512)에서 16·20·24·32·40·48·64·96·128·256을 각각 고품질로 줄여 PNG 항목 .ico로 `electron/assets/icon.ico`·`build/icon.ico`에 씀. exe(`win.icon`)·창(`APP_ICON`, Windows만)·트레이(Windows만)가 이 .ico. `electron/shortcutIcon.cjs`: 패키지 앱이 켜지고 5초 뒤 바탕화면·시작 메뉴·작업 표시줄 고정의 spawn.lnk/Claudex.lnk 중 이 exe를 여는 것만 `shell.writeShortcutLink(update, icon=icon.ico)`, 바꿨으면 `ie4uinit -show`. 창에 `setAppDetails`(고정했을 때 아이콘·다시 열기). `desktop-shortcut.ps1`도 .ico를 가리킴. 테스트 `tests/shortcut-icon.test.ts` 5개. 사용자가 이 PC에서 확인함("적용 잘됐어").
   - 패널 로고: 그림 파일은 이미 새 볼이었는데 서버가 `/sprites/balls/*`에 `max-age=86400`이라 브라우저 캐시의 옛 그림이 보였음. `ballUrl`에 빌드마다 바뀌는 `?v=`(`VITE_ASSET_REV`, vite.config.ts) 붙임.
   - 일하는 세션 빛: 모든 일하는 행에, 색만 변수(`--spin-head/--spin-tail`): 고른 세션 노랑, 나머지 흰색 50%→7%. (7-35에서 `::before`+`@property` 대신 `.w-glint` 요소를 GPU로 돌리는 방식으로 바뀜)
   - 사용자 질문(파이리 볼): 데이터는 caught[4]·m1(리자몽) 모두 poke-ball. 도감 카드엔 볼 칸이 없고 보유 개체 줄에만 있어 진화한 파이리 카드엔 안 보였음 → 사용자: "그럼 필요없다". 본가 도감도 '본 적/잡은 적' 둘뿐이고 진화·교환으로 떠나도 잡은 기록은 남는다고 설명함.
   - 밖: `Documentsclaudex-site`·`-backup`·`claudex-promo` → `spawn-site`·`spawn-site-backup`·`spawn-promo`. 서명키(`~/.claudex-release`, `claudex-signing-key.enc`)는 그대로.

7-35. **2026-11-12 — 터미널 빈 화면, 재시작 1단계, 가벼운 빛 (main, 1.3.42)**
   - 도감: 아무것도 안 골랐을 때 오른쪽 빈 칸 숨김(`.dex-detail.empty`). 사용자 결정 "안 골랐을 때 빈칸 숨기자".
   - **창 크기 조절 빈 화면 해결(원인 확인)**: 사용자 A/B로 "터미널일 때만" 확인. xterm WebGL 캔버스는 크기가 바뀔 때마다 지워지고 다음 프레임에 다시 그려지는데, ResizeObserver가 끄는 동안 매 프레임 fit()을 불렀음. → 크기 변화가 120ms(FIT_REST_MS) 멈춘 뒤 한 번만 fit, 그동안 .term-view overflow hidden(글자가 잠깐 잘려 보이는 건 정상). 사용자 확인 대기(테스트 빌드).
   - **업데이트 재시작 1단계**: 업데이트 재시작이면 서버가 flush·정지한 뒤 saveState·flushStorageData·app.exit(0)(Electron 기본 종료가 0.8~17초 걸려 다음 단계를 막았음). robocopy /MT:8. update.log에 p3 boot=(Windows가 프로세스를 띄운 뒤 걸린 시간), 감시 프로세스가 "p1 main-gone +Nms (watchdog)". ⚠️ p1·p2 코드는 **이걸 담은 업데이트의 다음 업데이트부터** 효과(옛 앱이 옛 코드로 종료함). 계획의 3번(서버와 창 동시에 만들기)은 효과가 작아 뺌.
   - 리뷰 에이전트 결과(6a9508b..): 큰 문제 없음. 고친 것: 종료 때 /flush가 1.5초 안에 답하지 않으면 그냥 서버를 죽이던 것(예전부터) → 3초로 한 번 더, 실패하면 update.log에 "flushed failed=…". 남은 것(낮음): 종료 직전 바뀐 도감은 클라우드에 다음 실행 때 올라감(로컬은 안전), 업데이트 종료 경로(main before-quit)에 테스트 없음.
   - **일하는 세션 빛 가볍게**: @property --w-spin 각도를 애니메이션하면 행마다 매 프레임 다시 그림. → 행 안 <span class="w-glint">(테두리 모양 마스크) 안에서 멈춘 conic을 rotate로 돌림(GPU). 12행 실험(Electron 33, scratchpad): 렌더러 CPU 33%→10~16%, GPU 66%→34~45%, 그림은 같음. 창이 최소화·트레이면 Chromium이 이미 멈춤(backgroundThrottling 기본값).
   - 쉬는 동안 자원(2026-11-12 13시, 창 열림·세션 작업 중, 빛 개선 전): 프로세스 7개, 사설 메모리 합 약 680MB(GPU 289, main 157, 렌더러 102+34, 서버 75), 10초 CPU: GPU 13%, 렌더러 11%. 빛 개선 뒤 다시 재서 비교.
   - 사이트: 안 쓰는 spawn-site/assets/img/claudex-ball.png 지움(백업 폴더엔 남음). PokeAPI·pokemondb 그림을 github.io Referer로 받아 보니 셋 다 200 → Pages에서도 될 것. 사이트 안 링크는 모두 DueStar/spawn.
   - 중복 포켓몬 → 새 종, 본가 방식 아이디어: docs/superpowers/specs/2026-11-12-mainline-duplicates-idea.md(안 1 게임 내 교환 추천, 2 GTS, 3 파견, 4 미라클 교환). 사용자: 대량발생·산책 코스·박사님 평가는 "중복을 처리하며 다른 포켓몬을 얻는 방식이 없다"며 이 방향을 원함. 세션 수 상한은 두지 않음("그만큼 일했다는 소리").

7-36. **2026-11-12 — 도망 확률 (main, 아직 릴리스 안 함)**
   - 사용자: "도망칠 확률을 일반 20, 희귀 30, 준전설 50, 전설 60, 환상 70으로", 환상 보장 간격은 그대로. `CATCH` 0.8/0.7/0.5/0.4/0.3, 테스트 1개.
   - 사이트(1.3.42 뒤): 제목 "기다리던 시간을 / 모험으로"(EN "All that waiting, / now an adventure", JA "待っていた時間を / 冒険に"), 설명 "에이전트가 일하는 동안, 야생 포켓몬을 만나 도감을 완성해 보세요.", 데모의 새 세션이 몬스터볼 없이 바로 포켓몬은 gh-pages로 올림. 큰 제목 줄 간격 조금 넓힌 것(.display 1.1, 한국어 1.16, h2 1.12, 일본어 1.24)은 로컬 spawn-site에만, 올리기 확인 대기.

8. **다음에 할 일 (2026-11-12 오후, 1.3.41 + 7-35 로컬 기준)**
   - 1.3.42는 테스트 빌드 확인 없이 사용자 "푸시하자"로 릴리스함 → 사용자 확인: 나란히 놓고 경계 끌기(터미널 안 비는지), 도감 빈 칸, 일하는 세션 빛.
   - 1.3.42 뒤 그다음 업데이트 때 update.log로 재시작 1단계 효과 읽기 → 2단계 후보: 서버 파일 묶기(차가운 디스크 server-ready 5~7초), robocopy가 새 앱 직접 띄우기, 바뀐 파일만 복사. asar 묶기는 옛 업데이트 경로와 얽혀 따로 계획.
   - **사용자 결정 대기**: 중복 → 새 종(위 문서, 사용자 2026-11-12: "좀 더 생각해 보자"), 도감 플러그인 모드에서 외부 터미널 포획 알림을 어디에 띄울지.
   - **소개 사이트 배포 끝(2026-11-12)**: https://duestar.github.io/spawn/ — DueStar/spawn의 gh-pages 브랜치(원본은 저장소 밖 Documentsspawn-site, .nojekyll). 다시 올릴 때는 그 폴더를 gh-pages에 push(공개 작업이라 먼저 확인). 저장소 About의 홈페이지 링크는 아직 비어 있음.
   - **사용자가 직접(자동 권한이 삭제를 막음)**: 예전 폴더를 휴지통으로 — %LOCALAPPDATA%\Claudex(옛 설치 307MB), %APPDATA%\Claudex, %APPDATA%\Claudex-dev, ~/.claudex, ~/.agent-office, 바탕화면 옛 Claudex 바로가기.
   - **확인 대기(1.3.40)**: 세션을 열어 둔 채 PC를 껐다 켜면 다시 열리는지(7-32). spawn.log에 "[main] Windows is ending the session: open sessions kept".
   - 확인 대기(예전부터): Codex 탭의 "Codex 월간" 줄·codex resume, pnpm dev 띄운 세션이 턴 끝나면 '쉬는 중'으로 바뀌는지.
   - **알려진 한계(사용자에게 말함)**: 예전 세션 이어하기 목록은 Claude만, Codex 안 /new는 그 탭이 첫 대화를 계속 따라감, Codex 권한 확인은 화면 문구 감지, Codex 한도는 서버 재시작 뒤 Codex가 다시 보고할 때까지 비어 있음.
   - unslop 스킬은 .claude/skills/unslop에 로컬만(.git/info/exclude).

9. **나중에**
   - **확률형 교환 요소** (사용자 아이디어, 2026-11-11): 중복 포켓몬을 보내 새 종을 데려오는 장치로 3년짜리 완성을 조금 당기되 전설·환상 희소성은 지키기. **아이디어 정리: `docs/superpowers/specs/2026-11-11-trade-idea.md`**(안 A 박사님 교환 6:1 추천, B 사탕, C 키우미집 알, D 이상한 교환; 사용자가 정할 것 4가지). 정하면 시뮬레이션 → 계획.
   - **도감만 쓰는 방식(플러그인화)** (사용자 요청, 2026-11-11): 터미널은 자기가 원하는 곳(Windows Terminal, VS Code 등)에서 쓰고 도감 수집만 하고 싶은 사람을 위한 방식. 아직 검토 전. 출발점: 앱은 이미 세션마다 `--settings`로 훅을 넣고 서버(127.0.0.1:3334)가 훅 이벤트로 게임을 돌리므로, 외부 터미널의 Claude Code에 같은 훅을 넣는 Claude Code 플러그인(옛 `.claude-plugin`은 1.3.7에서 지웠음) + 트레이/위젯만 뜨는 "도감 전용" 모드가 후보. 같은 세션을 양쪽에서 동시에 여는 문제(위 5번)와 훅 서명·토큰 처리도 같이 봐야 함. 계획부터.
   - 코드 서명은 하지 않기로 함(사용자 결정, 2026-11-09). (설정·리더보드·다른 AI 도구는 7-9로 옮김)
   - Windows 개발자 모드(사용자가 관리자로 켜야 함, 심볼릭링크 테스트용)
