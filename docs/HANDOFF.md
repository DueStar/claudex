# Claudex 인수인계 (2026-11-06, v1.3.2)

Claude Code 세션을 포켓몬과 함께 쓰는 Windows Electron 앱이다. W17ant/Claude-Office(MIT)를 포크했다.
- 경로: `Documents\pokemon-office`
- 저장소: https://github.com/DueStar/claudex (공개, main)
- 수집이 중심이고 배틀은 없다. 비영리이고, 사용자 5만 명 이내를 목표로 한다.

## 작업 원칙
- **push**: DueStar 계정으로만 한다. chanho-byte는 이 프로젝트에 쓰지 않는다. 토큰을 직접 꺼내지 말고 gh를 자격 증명 도우미로 쓴다.
  `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin main`
- **커밋 작성자**: DueStar / hoo2031@gmail.com(저장소 로컬 설정). 커밋 끝에 Co-Authored-By 줄을 붙인다.
- **테스트 판단 기준**: Windows에서는 원래 실패하는 테스트가 있다(파일권한·심링크·uid). 2c9b529 기준 449 통과 / 55 실패이고, "새 실패 0"이면 통과로 본다.
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
- **빌드와 릴리스**: `node scripts/release.mjs [--publish]` — 노트는 CHANGELOG.md의 `### <버전>` 절을 UTF-8로 직접 읽는다. 셸로 한글 노트를 넘기면 cp949로 깨진다(1.3.6에서 실제로 깨져서 릴리스 본문과 latest.json을 다시 올렸다).
  1. vite 빌드와 `electron-builder --win dir`를 실행한다.
  2. 볼 그림이 있으면 앱 아이콘을 공식 몬스터볼로 만들고, 빌드가 끝나면 `git checkout`으로 직접 그린 아이콘으로 되돌린다.
  3. `build-info.json`(빌드 날짜)을 넣는다.
  4. `release/`에 `claudex-app-<v>.zip`(앱 부분, 약 42MB), 전체 zip(약 152MB), `latest.json`을 만든다.
- **NSIS 설치 파일은 `spawn UNKNOWN`으로 실패한다.** 그래서 설치는 `release/win-unpacked`를 `%LOCALAPPDATA%\Claudex`로 robocopy하고 바탕화면 `Claudex.lnk`로 실행한다.
- **앱 안 업데이트**(`electron/updater.cjs`):
  - GitHub `releases/latest/download/latest.json`을 확인하고 sha256을 검증한다.
  - 재시작하면 `pending-update.json`을 남기고 `app.relaunch`한다. 다음 시작 때 main.cjs 맨 앞(`applyPendingUpdate`)에서 robocopy로 `resources\app`을 교체하고 한 번 더 relaunch한다. 결과는 `userData/update.log`에 남는다. 앱이 꺼진 뒤 외부 PowerShell로 교체하는 방식은 Windows에서 실행되지 않아 버렸다(detached면 아예 실행되지 않고, attached면 앱과 같이 죽는다).
  - 수동 설치: `scripts\install-local.cmd`(Claudex를 닫고 `release\win-unpacked`를 설치한 뒤 실행한다).
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
- **조우**: 도구 호출 1번이 1걸음이다. 일하는 중(main.state working)에 1분 동안 도구 호출이 없으면 생각 걸음 1번이다(`tick`, 서버가 2초마다 부른다).
  - 걸음은 세션별 대기열에서 8초(`STEP_SPACING_MS`)마다 하나씩 처리한다. 걸음당 3%이고, 매일 첫 세션에 아직 못 잡은 종이 확정으로 나온다(출석).
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
2. **로컬 업데이트 버튼**: 실제로 눌러서 확인한 적이 아직 없다. 아래 "다음 할 일" 3번에서 확인한다.
3. 1.3.2에서 넣은 것
   - 레벨업 알림
   - 위젯 질문 패널: `terminals.cjs`의 ASKING 정규식으로 출력을 감지하고, Enter나 Esc를 누르면 사라진다
   - 터미널 글자 크기(`src/termFont.ts`)
   - 오늘 기록 탭(`TodayLog`, publicState.today)
   - 디자인 QA 페이지(`?qa`, 트레이 메뉴, `QaPage.tsx`)
   - 나중에 할 일: 설정 페이지(글자 크기 등을 한곳에 모으기)
   - 캡처 팁: Claudex 터미널 안에서는 Electron 창 캡처(`AGENT_OFFICE_SCREENSHOT`)가 흰 화면으로 나온다. 오프스크린 paint 방식으로 캡처한다.
     - 격리 서버: `AGENT_OFFICE_HOME=<임시 폴더> AGENT_OFFICE_PORT=3344 node server/index.js` (먼저 `npx vite build`)
     - 캡처 앱: `tools/_cache/shot/`(gitignore, main.cjs + 가짜 브리지 preload.cjs). 토큰 주소는 인자로 넘기면 Git Bash에서 실행이 127로 실패하므로 환경변수로 넘긴다: `SHOT_URL="http://127.0.0.1:3344/?widget#token=<토큰>" SHOT_OUT=<png> npx electron tools/_cache/shot` (SHOT_W·SHOT_H·SHOT_JS, SHOT_VERSION은 가짜 업데이트 상태의 현재 버전)
4. **코드 서명**: 사용자는 비용을 쓸 수 없다. 무료로 할 수 있는 건 SignPath Foundation(오픈소스 무료 서명, 심사 있음, 포켓몬 IP 때문에 승인 불확실)뿐이다. 그 전까지는 서명 없이 배포하고 README에 SmartScreen 안내를 둔다. NSIS 수정도 남아 있다. macOS와 리더보드는 나중에 한다. 클라우드 저장 축소는 사용자가 고민 중이다.
5. **이벤트 볼 지급 방식**(업적 보상 등)은 아직 미정이다.
6. **같은 세션을 일반 터미널과 Claudex에서 동시에 이어 열지 않는다**(기록이 섞인다).
7. **포켓몬 공식 효과음은 보류한다**(사용자 결정, 2026-11-06). 게임 효과음은 저작물이고 스프라이트의 PokeAPI 같은 정당한 자동 취득처가 없어서, 넣으려면 저장소에 직접 담아야 한다(그림을 저장소에 넣지 않는 원칙과 충돌). 소리를 넣게 되면 `src/sounds.ts`처럼 WebAudio로 합성한 오리지널 소리(포획·도감)로 한다.
8. **주기적인 "띵동" 소리** — 해결(2026-11-06, 462e17e). `electron/main.cjs`의 숨은 office 창(`show: false`)이 옛 office UI(`App.tsx`)를 돌리며 이벤트마다 `playNotification()`(880Hz→1100Hz)을 울렸다. 창과 UI를 통째로 걷어냈고 `/health`의 `clients`가 1이 됐다.

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
   - 환경변수: `CLAUDEX_*`로 바꾸고 `AGENT_OFFICE_*`도 계속 읽는다
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
   - 개발 실행으로 확인하는 법: `AGENT_OFFICE_PORT=3344 npx vite --port 3333 --strictPort`를 띄우고 `AGENT_OFFICE_HOME=<임시> AGENT_OFFICE_PORT=3344 POKEMON_OFFICE_AUTOTEST_EXPAND=1 AGENT_OFFICE_SCREENSHOT=<png> npx electron .`. 창 캡처는 불투명한 창이면 Claudex 터미널 안에서도 된다(투명 위젯은 흰 화면). 개발 실행(`app.isPackaged`가 false)은 이제 `%APPDATA%\Claudex-dev`를 따로 쓴다(설치본의 창 상태·세션 이름·페이지 저장소를 건드리지 않는다).
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

## 개선점 (2026-11-07 전체 점검, 중요한 순서)
1. **Python 의존성 없애기**: 훅(`agent-tracker.py`/`.sh`)과 상태 줄이 Git Bash와 `python3`를 요구한다. Windows에는 `python3.exe`가 없어서 셔임을 만들어야 했다(이 PC도 그랬다). 훅을 Node로 옮기고 Claudex.exe를 `ELECTRON_RUN_AS_NODE=1`로 부르면 설치할 것이 Claude Code 하나로 줄어든다. 사용자에게 가장 큰 개선이다.
2. **클라우드 동기화 병합**: 지금은 잡은 종이 많은 쪽이 통째로 덮어쓴다(`server/cloud.js`). 두 PC에서 따로 잡은 개체가 사라질 수 있다. 개체 uid 기준 합집합, 도감은 종별 최초 포획일·횟수 합치기로 바꾼다.
3. **업데이트 진위 확인**: `latest.json`의 sha256은 같은 릴리스에서 오므로 무결성만 보장한다. 릴리스 계정이 털리면 그대로 통과한다. minisign 같은 서명 키로 `latest.json`을 서명하고 앱에 공개 키를 넣는다(코드 서명이 없을 때의 최소한).
4. **office 잔재 3단계·이름 바꾸기**(위 1·2번): 플러그인·설치기·doctor, `X-Office-*`·`agent-office` 프로토콜, `~/.agent-office` → `~/.claudex` 이전. `doctor.test`·`install-hooks.test`·`plugin.test`·`open-office.test`가 같이 사라진다.
5. **Windows 테스트 기준선 51개 실패**: 파일 권한(0600)·심링크·uid·`sleep` 같은 Unix 전제 테스트다. `process.platform === 'win32'`에서 이유를 적고 건너뛰게 하면 "새 실패 0" 비교 없이 `npm test`가 초록이 된다. CI에 windows-latest도 추가한다.
6. **큰 파일 나누기**: `server/index.js` 1800줄(세션·main 상태 / 이벤트 처리 / 저장 / 라우트), `electron/main.cjs` 1000줄(창 관리는 `windows.cjs`로), `src/Widget.tsx` 690줄(사이드바·지시 입력·교체/던지기 창을 컴포넌트로). 지금 구조에서 실수가 잘 난다(이번 obtainItem처럼).
7. **번들 1MB 한 덩어리**: 도감 데이터(`pokedex.json`)가 첫 화면에 같이 실린다. 도감·박스 화면과 데이터를 `import()`로 나누면 위젯 첫 표시가 빨라진다.
8. **로그 파일**: 업데이트(`update.log`) 말고는 앱·서버 로그가 남지 않는다. Claudex 터미널 안에서는 Electron 출력도 안 보인다. `userData/logs/`에 크기 제한을 둔 로그를 남기고 트레이에 "로그 폴더 열기"를 둔다. 사용자 문의 대응이 쉬워진다.
9. **창 전환 다듬기**: 위젯↔창 전환 중 패치노트 창이 새 창에서 다시 뜰 수 있다(확인 전이면). 스크롤 위치도 맨 아래로 간다. 지시 입력 저장(`claudex-carry`)은 글자마다 localStorage에 쓴다(가볍게 묶어 쓰기).
10. **도감 그리드 성능**: 1025칸을 한 번에 그린다. 아직 문제는 없지만 이미지가 늘면 가상 스크롤(보이는 줄만)로 바꾼다. 키보드로 칸을 옮겨 다니는 접근성도 없다.
11. **릴리스 자동 점검**: `release.mjs --publish` 앞에 "push가 끝났는지(ahead 0)", "CHANGELOG에 이 버전이 있는지", "볼 그림 27종"을 한 번에 확인하고 하나라도 아니면 멈추게 한다(v1.3.7 태그 사고 재발 방지).
12. **낡은 주석·이름**: `server/index.js`의 Host 헤더 설명(`GET /agents`), 곳곳의 "office" 표현은 2번 이름 바꾸기 때 같이 정리한다.

8. **나중에**
   - 클라우드 동기화를 합집합 병합으로 바꾼다(지금은 잡은 종이 많은 쪽이 통째로 덮어쓴다).
   - 설정 페이지, 진화의 돌·님피아, 이벤트 볼 지급, 코드 서명
   - Windows 개발자 모드(사용자가 관리자로 켜야 함, 심볼릭링크 테스트용)
   - 공식 효과음은 보류(7번)
