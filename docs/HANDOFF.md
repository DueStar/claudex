# Claudex 인수인계 (2026-11-08, v1.3.11)

Claude Code 세션을 포켓몬과 함께 쓰는 Windows Electron 앱이다. W17ant/Claude-Office(MIT)를 포크했다.
- 경로: `Documents\pokemon-office`
- 저장소: https://github.com/DueStar/claudex (공개, main)
- 수집이 중심이고 배틀은 없다. 비영리이고, 사용자 5만 명 이내를 목표로 한다.

## 작업 원칙
- **push**: DueStar 계정으로만 한다. chanho-byte는 이 프로젝트에 쓰지 않는다. 토큰을 직접 꺼내지 말고 gh를 자격 증명 도우미로 쓴다.
  `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin main`
- **커밋 작성자**: DueStar / hoo2031@gmail.com(저장소 로컬 설정). 커밋 끝에 Co-Authored-By 줄을 붙인다.
- **테스트 판단 기준**: `npm test`가 Windows에서도 전부 통과해야 한다(2026-11-07부터, 395 통과 / 10 건너뜀). 파일 권한·getuid·심링크·pid 1처럼 Windows에 없는 것을 보는 검사만 이유를 적고 건너뛴다(Linux CI에서는 돈다). 실패가 하나라도 있으면 새로 생긴 것이다.
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
- **시작**: 스타팅(1·4·7)과 파티 6마리를 받는다. 세션은 최대 6개이고, New session에서 파티 포켓몬을 골라 던진다.
- **조우**: 도구 호출 1번이 1걸음이다. 일하는 중(main.state working)에 1분 동안 도구 호출이 없으면 생각 걸음 1번이다(`tick`, 서버가 2초마다 부른다).
  - 걸음은 세션별 대기열에서 8초(`STEP_SPACING_MS`)마다 하나씩 처리한다. 걸음당 3%이고, 매일 첫 세션에 아직 못 잡은 종이 확정으로 나온다(출석).
  - **출석 조우에는 전설·환상이 나오지 않는다**(1.3.11, 사용자 결정). 등급은 일반·희귀·준전설만 비율대로 굴린다. 그날 천장이 차도 출석에서는 쓰지 않고 다음 야생 조우로 넘긴다. 전설·환상만 남으면 출석 조우는 없다.
  - 지형은 도구로 정한다(Edit 풀숲, Bash 동굴, Read 숲, Web 하늘길, Agent 사파리존, mcp 발전소). 밤에는 고스트·악·에스퍼가 잘 나온다.
- **등급**: 일반 74, 희귀 21, 준전설 3.6, 전설 1.0, 환상 0.4.
  - "희귀"는 공식 등급이 아니라 포획률 45 이하를 기준으로 정한 것이다.
  - 천장은 전설 150, 환상 300이다. **화면과 README에는 드러내지 않는다**(사용자 결정). 이로치 1/4096, 못 잡은 종 ×8.
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
   - 캡처 팁: Claudex 터미널 안에서는 Electron 창 캡처(`CLAUDEX_SCREENSHOT`)가 흰 화면으로 나온다. 오프스크린 paint 방식으로 캡처한다.
     - 격리 서버: `CLAUDEX_HOME=<임시 폴더> CLAUDEX_PORT=3344 node server/index.js` (먼저 `npx vite build`)
     - 캡처 앱: `tools/_cache/shot/`(gitignore, main.cjs + 가짜 브리지 preload.cjs). 토큰 주소는 인자로 넘기면 Git Bash에서 실행이 127로 실패하므로 환경변수로 넘긴다: `SHOT_URL="http://127.0.0.1:3344/?widget#token=<토큰>" SHOT_OUT=<png> npx electron tools/_cache/shot` (SHOT_W·SHOT_H·SHOT_JS, SHOT_VERSION은 가짜 업데이트 상태의 현재 버전)
4. **코드 서명**: 사용자는 비용을 쓸 수 없다. 무료로 할 수 있는 건 SignPath Foundation(오픈소스 무료 서명, 심사 있음, 포켓몬 IP 때문에 승인 불확실)뿐이다. 그 전까지는 서명 없이 배포하고 README에 SmartScreen 안내를 둔다. NSIS 수정도 남아 있다. macOS는 나중에 한다. 리더보드 계획은 7-9. 클라우드 동기화는 1.3.11에서 줄였다(아래 7-7).
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

   - **A. 리더보드 (경쟁심)**
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

   - **C. 설정 화면 (7-8의 4단계를 넓힘)**
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

8. **나중에**
   - 진화의 돌·님피아, 이벤트 볼 지급, 코드 서명 (설정·리더보드·다른 AI 도구는 7-9로 옮김)
   - Windows 개발자 모드(사용자가 관리자로 켜야 함, 심볼릭링크 테스트용)
   - 공식 효과음은 보류(7번)
