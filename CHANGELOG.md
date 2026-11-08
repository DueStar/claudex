# Changelog

## Claudex

### 1.3.15
- 알림 창이 내용 없이 검은 네모로 남던 문제를 고쳤어요.
- 박스를 예전처럼 화면을 꽉 채우는 모양으로 되돌렸어요. 박스 포켓몬을 파티 칸으로 끌어다 바꾸는 기능은 그대로예요.

### 1.3.14
- 박스를 게임 PC처럼 배치했어요. 왼쪽에 파티, 가운데에 박스 이름표와 30칸, 오른쪽에 고른 포켓몬 정보가 보여요.
- 박스 칸을 예전 크기로 되돌려서 아이콘이 깨지지 않아요. 창이 좁으면 파티가 박스 위로 올라가요.
- 왼쪽 패널의 파티에서 쉬고 있는 포켓몬을 누르면, 지금 고른 세션의 포켓몬과 바로 교체돼요.

### 1.3.13
- 알림이 밀리면 "+2" 대신 카드가 뒤로 겹쳐 쌓여 보여요. ×로 지금 알림을 닫으면 다음 알림이 올라오고, 밀려 있을 땐 하나하나가 조금 짧게 떠요.
- 도망친 포켓몬도 등급과 상관없이 알림으로 알려줘요. 못 잡은 포켓몬이라 실루엣으로만 보여요.
- 알림 카드에 여백을 더 줘서 덜 답답해요.
- 박스가 게임처럼 한 박스에 30마리(6×5)씩 보여요. ‹ › 버튼이나 ←/→ 키로 박스를 넘겨요.
- 박스의 포켓몬을 위쪽 파티 칸으로 끌어다 놓으면 서로 자리를 바꿔요.
- 세션의 포켓몬 교체는 파티 안에서만 할 수 있어요. 박스의 포켓몬은 먼저 파티로 데려오세요.
- 포켓몬을 교체한 뒤에도 세션 목록에 예전 포켓몬이 보이던 문제를 고쳤어요.
- 도감 위 등급별 숫자를 다른 숫자들과 같은 줄에 맞추고, 등급 필터를 세대·보기와 같은 줄로 올렸어요.
- 업데이트 버튼을 눌러도 받지 못하면 "업데이트 실패 · 다시 시도"로 알려줘요. GitHub 다운로드가 막혀도 다른 길로 받아요.

### 1.3.12
- 알림이 더 오래 떠요. 마우스를 올려 두면 사라지지 않고, 밀린 알림이 있으면 "+2"처럼 보여줘요.
- 알림을 누르면 그 포켓몬의 도감이 바로 열려요.
- 알림 디자인을 다시 정리했어요. 무슨 일인지, 어떤 포켓몬인지가 먼저 눈에 들어와요.
- 박스가 기본으로 작은 아이콘으로 보여서 한 화면에 훨씬 많이 보여요. "그림"으로 바꿔 큰 그림으로 볼 수도 있어요.
- 도감과 박스의 포켓몬 정보에 아이콘이 함께 보여요.
- 창 모드에서 왼쪽 위 숨기기 버튼을 없애고, 왼쪽과 오른쪽 윗줄 높이를 맞췄어요.

### 1.3.11
- 매일 첫 만남(출석)에서는 전설·환상 포켓몬이 나오지 않아요. 전설과 환상은 야생에서만 만날 수 있어요.
- 여러 번 잡은 포켓몬도 너무 드물어지지 않게 조정했어요.

### 1.3.10
- 사용량이 세션을 닫거나 앱을 다시 켜도 사라지지 않아요. 마지막으로 받은 5시간·주간 사용량을 기억하고, 리셋 시각이 지나면 0%로 보여줘요.
- 기록 탭이 오늘만이 아니라 저장된 기록 전체를 날짜별로 보여줘요(최근 600건).
- 도감·박스 칸이 화면 너비에 맞춰 꽉 차요. 좌우 여백이 들쭉날쭉하지 않아요.
- 도감 위 숫자를 키우고, 등급별 포획을 등급마다 한 칸씩 보여줘요. 오른쪽에는 등급별 만날 확률만 남겼어요.
- "이로치" 대신 게임에서 쓰는 "색이 다른 포켓몬"(✦)으로 불러요.
- 박스: 검색창에 돋보기가 생기고, 포켓몬을 골랐을 때만 오른쪽 정보 창이 열려요(다시 누르거나 ×로 닫아요).
- 왼쪽 패널을 간단하게: 박스 수·오늘 잡은 수, "N마리 대기" 문구를 뺐어요.
- 지시 입력칸이 포켓몬 이름으로 불러요. "피카츄가 기다리고 있어요" 같은 문구가 바뀌어 가며 떠요.
- 위젯 맨 위 "Claudex"를 누르면 지금까지의 패치노트를 모두 볼 수 있어요.

### 1.3.9
- 세션 목록과 터미널 탭에 처음부터 세션 이름이 보여요. 이름을 짓기 전에는 "새 세션"으로, 포켓몬 이름은 옆에 작게 붙어요.
- `Ctrl+Alt+←` / `Ctrl+Alt+→`로 터미널·도감·박스·기록을 차례로 오갈 수 있어요(`Ctrl+1~4`도 그대로예요).

### 1.3.8
- 도감이 한눈에 보이게 바뀌었어요. 포획·발견·이로치·박스를 칸과 진행 막대로, 등급별로 몇 종 잡았는지도 보여줘요.
- 도감 필터를 세대·등급·보기(전체·잡은 것·못 잡은 것)로 묶고, 이름이나 번호로 찾을 수 있어요(만난 포켓몬만 이름으로 찾혀요).
- 포켓몬을 고르면 키·몸무게·잡은 곳 같은 정보가 칸으로 정리돼 보여요. 박스 화면도 같은 모양이에요.
- 왼쪽 패널의 최근 잡은 포켓몬과 파티 아이콘의 크기와 간격을 맞췄어요.
- 이제 Python이 없어도 돼요. 세션 기록(훅)을 Claudex가 직접 돌려요. 필요한 건 Claude Code와 Git뿐이에요.
- 두 PC에서 따로 잡은 포켓몬이 클라우드 동기화 때 사라지지 않아요. 한쪽이 덮어쓰지 않고 양쪽 기록을 합쳐요. 합치기 전 기록은 `pokedex.json.before-sync`로 남겨요.
- 데이터 폴더가 `~/.claudex`로 바뀌었어요. 첫 실행 때 예전 폴더(`~/.agent-office`)를 그대로 복사하고, 예전 폴더는 지우지 않아요.
- 업데이트 파일이 진짜 Claudex 릴리스인지 서명으로 확인해요.
- 트레이 메뉴에 "로그 폴더 열기"가 생겼어요. 문제가 생기면 `claudex.log`를 보내 주세요.
- 첫 화면이 더 빨리 떠요. 알림 창도 필요한 것만 불러와요.
- 도감에서 방향키로 포켓몬을 옮겨 다닐 수 있어요. 창 모드를 바꿔도 도감 스크롤 위치가 그대로예요.
- 패치노트 창은 업데이트마다 한 번만 떠요. 창 모드를 바꿔도 다시 뜨지 않아요.
- 쓰지 않는 옛 코드(옛 설치 도구, 플러그인 등)를 정리했어요.

### 1.3.7
- 창 모드와 전체 화면이 보통 프로그램 창이 됐어요. 화면 끝으로 끌면 Windows 스냅이 미리보기와 함께 그대로 동작하고(반 화면, 1/4 화면, 옆에 둘 창 고르기, Win+화살표), 테두리를 끌어 크기를 바꿀 수 있어요. 전체 화면은 Windows의 최대화예요(제목 줄 더블클릭도 돼요).
- 위젯 모드만 바탕화면 위에 떠 있는 투명한 위젯이에요. 위젯과 창을 오갈 때는 부드럽게 바뀌고, 터미널 내용·보던 탭·고른 세션·쓰던 지시는 그대로 남아요.
- 보내기 버튼이 지시를 쓰기 전에도 보여요(쓰기 전에는 회색, 보낼 수 있으면 노랑).
- 포켓몬을 교체하면 세션 그림이 바로 바뀌어요.
- 창을 반 화면으로 맞춘 뒤 위젯으로 돌아가면 위젯이 지나치게 넓어지던 문제를 고쳤어요.
- 옛 office의 그림·스크립트·문서를 정리했어요.

### 1.3.6
- 업데이트한 뒤 처음 켜면 새로 바뀐 내용을 작은 창으로 한 번 보여줘요.
- 창 모드·전체 화면에서 창을 화면 왼쪽이나 오른쪽 끝으로 끌어다 놓으면 그쪽 반을 차지하고, 위쪽 끝에 놓으면 화면을 꽉 채워요(Windows 스냅처럼). 맞춰진 창을 다시 끌어내면 원래 크기로 돌아와요.
- 보내기 버튼이 입력창 안 오른쪽 아래의 작은 종이비행기 아이콘이 됐어요. Enter로 보내는 건 그대로예요.
- 파티 줄과 도감 카드의 '최근 잡은 포켓몬'도 스칼렛·바이올렛 박스 아이콘으로 나와요.
- 포켓몬 교체·던지기·예전 세션 이어하기 창의 머리 부분이 빨간색으로 나오던 문제를 고쳤어요. 옛 office의 색이 남아 있었어요.

### 1.3.5
- 터미널 옆 세션 패널과 터미널 위 세션 탭의 포켓몬이 스칼렛·바이올렛 박스 아이콘(왼쪽을 살짝 보는 작은 그림)으로 나와요. 도감·박스·알림은 지금처럼 HOME 그림이에요. 게임에 이로치 아이콘이 없어서, 이로치는 이름 앞의 ✨로 알 수 있어요.
- 업데이트를 30분마다 확인해요(전에는 6시간). 트레이 메뉴의 '업데이트 확인'으로 바로 확인할 수도 있어요.

### 1.3.4
- 몇 분마다 울리던 "띵동" 소리가 사라졌어요. 화면에 안 보이는 옛 office 창이 이벤트마다 알림음을 내고 있었어요. 그 창과 옛 office UI를 통째로 걷어냈어요.
- 권한 확인 창이 15초~10분 늦게 뜨던 문제를 고쳤어요. 훅이 office의 답을 기다리느라 멈춰 있었어요.
- 사파리존이 다시 열려요. 서브에이전트(Agent 도구) 호출도 한 걸음으로 세요.
- Windows에서 상태 줄이 서버에 빈 값을 보내던 문제를 고쳤어요.
- 앱 안의 포켓볼이 게임 그림으로 나와요(27종).
- 지시 입력창의 보내기 버튼이 입력창 아래로 갔어요.
- 서버에서 쓰지 않는 office 기능(채팅, 작업 보드, 설정 페이지 등)과 better-sqlite3를 뺐어요.

### 1.3.3
- 세션 이름이 다시 켜도 유지돼요(앱 상태 저장이 이름과 위젯 모드·크기를 버리고 있었어요). 이름을 바꾸면 Claude Code 쪽 세션 이름도 /rename으로 같이 바뀌어요(일하는 중이면 끝난 뒤에).
- 위젯은 화면 오른쪽에 위아래로 꽉 차게 붙어서 열려요.
- 탭 이동 단축키: Ctrl+1 터미널, Ctrl+2 도감, Ctrl+3 박스, Ctrl+4 기록. '오늘' 탭은 '기록'으로 이름을 바꿨어요.
- '새로운 세션 시작하기' 버튼, 터미널 탭 옆의 + 버튼, 글자 크기는 Aa 버튼. 오른쪽 끝에 최소화·닫기 버튼.
- 지시 입력: 안내 문구는 입력창 위에 나오고 몇 초 뒤 사라져요. 보내기 버튼은 아래쪽에 붙어요. 문구도 자연스럽게 다듬었어요.
- 세션 줄의 × 버튼이 오른쪽 끝으로 갔어요.

### 1.3.2
- 업데이트 적용을 고쳤어요. 예전에는 앱이 꺼진 뒤 파일을 바꾸는 스크립트가 실행되지 않아서 업데이트가 안 되고 다시 켜지지도 않았어요. 이제 다시 켜질 때 앱이 직접 새 파일로 바꾸고 한 번 더 켜져요(app.relaunch).
- 레벨업하면 화면 맨 위에 짧은 알림이 떠요(3.5초). 같은 걸음에 포켓몬을 만나면 레벨업 알림이 먼저 떠요.
- 위젯 모드에서 Claude Code가 질문을 기다리면(폴더 신뢰, 권한 확인, 선택지) 위젯 안에 작은 터미널이 열려서 바로 답할 수 있어요. 답하면 사라져요.
- 터미널 글자 크기: 소·중·대 버튼, Ctrl+휠, Ctrl+= / Ctrl+- / Ctrl+0.
- 오늘 기록 탭: 오늘 잡은 포켓몬(새로운 종 표시), 놓친 포켓몬, 진화, 레벨업을 시간순으로 보여줘요. 위젯 도감 카드에 오늘 잡은 수도 보여요.
- 디자인 QA 페이지: 트레이 메뉴 → 디자인 QA 페이지. 모든 알림 카드를 펼쳐 보고, 띄우기로 실제 알림을 띄울 수 있어요.
- 창·전체화면에서 지시 입력창이 커졌고, 스크롤바를 앱 디자인에 맞췄어요.
- 포획 알림에서 볼 아이콘이 크게 나오던 문제를 고쳤어요.
- 생각 걸음: Claude가 일하는 중인데 1분 동안 도구를 안 쓰면 한 걸음으로 쳐요(조우 확률 3% 그대로, 레벨 시간에도 들어가요).
- 걸음 대기열: 걸음은 세션마다 줄을 서서 8초 간격으로 하나씩 처리돼요. 도구 호출이 몰려도 포획이 연달아 터지지 않고 걸음은 버려지지 않아요.
- 위젯·도감·알림·오늘 기록에서 천장 표시를 없앴어요. 확률 보정은 그대로 동작하고 화면에는 드러나지 않아요.
- 도감·박스 칸을 키웠어요(포켓몬 그림 크기는 그대로). 터미널 위 세션 탭의 포켓몬은 작게 했어요.

### 1.3.1
- 진화 조건을 본가에 가깝게 바꿨어요.
  - 친밀도 진화(피츄→피카츄 등): 내가 레벨을 20 올리면 친밀도 최대로 보고, 다음 레벨업에 진화해요.
  - 통신 진화(윤겔라→후딘 등): 세션 포켓몬 교체나 박스↔파티 교환을 통신으로 보고, 다음 레벨업에 진화해요.
  - 이브이: Lv.30부터 친밀도 최대면 낮엔 에브이, 밤엔 블래키예요. 숲(Read)에서는 리피아, 동굴(Bash)+밤에는 글레이시아, 그 밖에는 돌 진화 3종 중 하나예요.
  - 진화의 돌 진화는 Lv.30(두 번째 진화는 40) 그대로예요.

### 1.3.0
- 포켓몬을 잡은 볼이 기록돼요. 게임에서 구하기 쉬운 정도에 따라 확률이 정해져요 (server/balls.json): 흔한 볼 60%, 특수 볼 29.4%, 규격 외 볼 8.4%, 한정 볼 2.0%, 마스터볼 0.2%. 전설·환상은 1% 확률로 마스터볼에 잡혀요.
- 파크볼·드림볼·프레셔스볼은 이벤트 전용이라 야생 포획에서 빠졌어요.
- 한 번 잡은 종은 다시 만날 확률이 잡을 때마다 ×0.9가 돼요.
- 레벨: 야생 포켓몬은 Lv.1~55로 만나고(진화 단계·등급별), 함께 일한 시간으로 레벨이 올라요. 처음 20분에서 높은 레벨 60분까지 곡선이고 최대 100이에요. 5분 넘게 쉰 시간은 빠져요.
- 진화: 걸음 수 대신 본가 진화 레벨(PokeAPI)로 진화해요. 레벨이 없는 진화는 Lv.30/40이에요.
- 상황별 볼: 네트·다이브(타입), 네스트(낮은 레벨 ×3 → 높은 레벨 ×0.5), 리피트(잡아본 종), 타이머(세션 시간 ×0.5→×3), 퀵(첫 조우 ×3, 시간이 갈수록 ×0.5), 다크(밤·동굴), 프리미어(그날 10번째마다), 럭셔리·프렌드(함께 올린 레벨 10/20), 레벨(내 포켓몬 레벨이 더 높음), 러브러브(같은 종·반대 성별), 문(보름달 밤), 사파리(사파리존), 루어(검색 도구), 스피드(스피드 100+), 헤비(100/200/300kg), 울트라볼(울트라비스트 ×50).
- 컴퍼티션볼도 이벤트 볼로 옮겼어요. tools/simulate-balls.mjs로 1년치 볼 분포를 볼 수 있어요.
- 이 PC에서 빌드하면 업데이트 버튼이 바로 떠요 (~/.agent-office/update-dir, 로컬 업데이트 채널).
- 알림, 박스, 도감의 보유 개체 목록에 볼이 보여요.
- 볼 그림: 게임의 고화질 그림(tools/import-balls.mjs로 넣은 경우)이 있으면 그걸 쓰고, 없으면 PokeAPI 아이콘을 받아 써요.
- 사용량 카드: 세션을 열기 전에는 안내 문구가 나오고, 세션이 시작되는 동안에는 막대가 한 줄을 꽉 채워 반짝여요.
- README와 NOTICE를 Claudex에 맞게 새로 썼어요.

### 1.2.0
- 첫 공개 릴리스.

## Claude Office (원작)

All notable changes to Claude Office. Numbers refer to pull requests.

### Unreleased

- Prod Is Down now sounds the alarm: as an incident starts the room flashes deep red three times over 1.8 s (under the 3-a-second photosensitivity limit), then settles into a darker red tint. A reload halfway through an incident, a mini-incident from a random event, and reduced-motion settings get no flash.

## 1.1.1 — 2026-10-15

### Fixes
- Speech bubbles are readable again: while a character speaks it is drawn in front of everyone else, so the name tags and typing dots of whoever stands in front no longer cover the boss's prompt, and long bubble text wraps onto two lines instead of running off as one (#49).
- The boss no longer gets stuck mid-errand: sent to far-off furniture (the kanban board from his desk is a 17-second walk), he used to stand there with no line posted; his errand is now timed against the route he actually walks, and if it gives up he walks back to his desk (#57).

### Documentation
- The README is back to its original shape and length, with a short 1.1 update, GIFs of the new features and the Claude crab; the hook details, settings, security model and feature internals move to `docs/reference.md` (#49–#56).

## 1.1.0 — 2026-10-15

### Truthful office
- Subagents are linked to their worker the moment Claude Code starts them (`SubagentStart`); phantom `SubagentStop` events from the compaction and prompt-suggestion sidechains are ignored; a tool call that errors (`PostToolUseFailure`) shows as `failed:` on the agent that made it; nested spawns record their parent (#10).
- The office is session-aware: every hook event carries the Claude Code session and project, `SessionStart`/`SessionEnd` open and close sessions, one pill per terminal in the title bar, `GET /sessions`, sessions survive a server restart (#12).
- Payroll, electricity and memory meters fed by the Claude Code status line (and the subagent status line): cost, $/min, tokens per minute, context-window fill per session, a five-hour rate-limit pill, and a "desk is getting cluttered" warning past 85 % (#15).
- The MEMORY meter works without the status line: for a session with hooks but no status-line report (the plugin install, headless `claude -p`) the server estimates the context fill from the last reply's usage in the session transcript, against the model's window (Claude Code's own table: 1M for a `[1m]` tag or a native-1M model, 200k for the rest, 200k marked approximate for an unknown model), refreshed on that session's hook events at most once per 5 s from the end of the file and after the hook has its answer; it travels as `source: 'transcript'` with an `estimate` block, the panel marks it *est.* with a tooltip saying why, a real status-line report wins at once and for good, and PAYROLL and ELECTRICITY are never estimated — they say *needs the status line* with `npm run install-hooks` in the tooltip.
- Faithful worker lifecycle: event handling moved into a pure `officeReducer`; workers arrive before they work; when desks run out new arrivals wait in a lobby by the door; reconnects reconcile with the server snapshot; duplicate chat lines, dropped side effects and a sprite-lagging CSS transition are gone (#19).
- The session's own Claude is a first-class record (`main` on each session): the hook forwards the main thread's turn — `UserPromptSubmit` (incl. a background worker's wake-up), `Stop`, `PermissionRequest`, `Notification`, `StopFailure`, `PreCompact`/`PostCompact`, `PostToolBatch`, `CwdChanged`, `PostModelSwitch` — as `session_*` events; the server keeps working / waiting / idle / needs-you / error / compacting per session with a debounced, deduped permission wait that the granted tool or the batch end lowers; prompts and replies are stored as Boss/Claude chat rows at the `logPrompts` level (off / summary / full, `GET`/`POST /settings`) and stay behind the token on `GET /chat` and `GET /sessions`; the hook reads its payload from stdin (a 300 KB tool result used to fail with E2BIG) and honours `AGENT_OFFICE_EVENT_URL` / `AGENT_OFFICE_PORT`; a foreground agent's completion carries its tokens, duration, tool count and model.
- The office acts the turn out: one Claude per session (the first seated next to the boss), the boss walks over and hands each prompt across in a speech bubble, Claude types while it works and its own tool calls are its status line (never a random worker's), its reply is a tagged chat row, it dozes off 30 s after an idle turn end, holds a glass of water while background workers are out, sweeps its desk during a compaction, wears a red badge after an API error, and raises a hand — with a chime, an amber pill and a ✋ window-title prefix — while it waits on you (idle prompts and quota pauses are soft); the session pill shows the title, a model badge, the main state and the waiting count; a worker's completion reads `✅ done · 42k tok · 3m12s`; the chat header shows the `logPrompts` level; every transition is a reducer case with tests, and the reducer's purity test is deterministic.
- Sessions appear before (or without) the hooks: the server watches Claude Code's own session registry (`~/.claude/sessions/<pid>.json`, `server/sessions.js`) and joins it to the hooked sessions by session id; a session only the registry knows is a grey, dashed *not hooked* pill named after its registry entry, with the registry status (`busy` / `shell` / `idle` / `waiting`, the last as amber needs-you) as its dot and a tooltip saying how to hook it, no Claude on the floor; the first hook event from it flips it to hooked with the same id; `hooked` and `registry` travel on `GET /sessions`, the snapshot and every `session_*` broadcast (`session_registry` for a registry change), `GET /registry` shows the directory as read, a session with a live process is never swept as stale, and the chat bot's own `claude -p` calls are named `agent-office-bot` so the roster skips them.
- Answer a permission dialog from the office: while a session waits on `PermissionRequest` a card beside the chat shows what Claude wants to run or write with Allow / Allow & remember (the dialog's own suggestion, e.g. switch to accept-edits) / Deny and `y` / `n`; the tracker POSTs that one event in the foreground and long-polls `GET /permission/:id` until the office decides, then prints the exact hook output (never an `updatedInput`), so the real dialog in that terminal is answered; any later activity of the session releases the wait (`resolved_elsewhere`) because the terminal always wins; a pending permission expires after 15 s (a headless `-p` session would stall otherwise) or 10 min once a `Notification` has shown the session is interactive; `permission_request` / `permission_extended` / `permission_resolved` broadcasts and `pendingPermissions` on the snapshot; a per-process UI token on the origin-gated snapshot opens `POST /permission/:id` and `POST /settings` to the page; the `answerPermissions` setting (default on, an "Answer here" toggle in the chat header) is mirrored as the `answer-permissions` marker file the hook checks, so off means the hook is exactly what it was.
- Click a character to inspect it: a card over the room says what it is and what it has done — name, role, task, state, project and session, how long it has been at it, the tools it used (a count per tool and the last ten calls, failed ones marked), tokens / duration / tool uses / model once it has finished (for a background agent, whose `SubagentStop` reports none, the office derives them — tokens and model from its transcript's last message, the same sum Claude Code reports as `totalTokens` — and the card says which), its parent and unread messages; a session's Claude shows its main state (working, waiting on N workers, idle, needs-you and why, API error, compacting), model, crons, context fill and the last prompt and reply, and an Agent launch counts as a tool call of whoever made it; under that a transcript tail — the last things the agent itself said and the tools it called, read from the end of its own transcript file, never the whole of it — at the detail `logPrompts` allows (off: hidden; summary: 200 characters per entry; full: 2000). Served by `GET /agents/:id` (open on loopback like `GET /agents`, `main-<sessionId>` for a session's Claude; the transcript tail and the prompt / reply text go only to the office page, which sends the UI token, or a token holder — anyone else gets the history, counts and stats with `transcriptReason: 'needs the office token'`) from a per-agent 50-entry activity buffer that stays out of `agents.json`; the hook now sends the tool name with every tool call and the worker's transcript path on `SubagentStop`; the sprite itself is the click target, so badges and bubbles still never block the furniture; the card opens top-left of the room, or on its right side when the character stands where the card would hide it.
- Background agents stay at their desk until they finish, and agents survive a server restart (#5, #6).
- A subagent known only by its type is bound to a launch of that type from the last minute (five for the first-tool-call fallback when no `SubagentStart` arrived), earliest first so parallel launches keep their order; a launch whose start never came no longer captures the next subagent of its type minutes later, and agents restored from `agents.json` are never guessed onto a new subagent.
- The kanban whiteboard shows each session's real task list (Claude Code's `TaskCreate` / `TaskUpdate` tools): the server watches `~/.claude/tasks/<session id>/` for the sessions it knows (`server/tasks.js`, `fs.watch` plus a 2 s poll, `AGENT_OFFICE_TASKS_DIR`) and broadcasts a debounced `task_board` on change (and `taskBoards` on the snapshot) without the task descriptions, which `GET /tasks` serves only with the token; the hook forwards `TaskCreated` / `TaskCompleted` (installer and plugin now register 19 events) so the server looks at once; post-its in To do / In progress / Done with a red pin when blocked, "+N" past six, a flash when one goes in progress and a slide into Done; the board follows the session that changed last and a click pages through several; the board's hotspot reads it out instead of its old flavour lines, which stay when no session has tasks, as does the decorative board.
- Second bug hunt, server state: a permission hand and its office card belong to the call that asked — the hook hashes the call's tool input into a `callKey` that the `PermissionRequest` and the call's own `PostToolUse` both carry, so another call of the same tool finishing beside it (`git status` next to the `git push` that asked) no longer lowers or answers it; a dialog a subagent raised is lowered and released by that subagent's own `PostToolUse` / `PostToolBatch` (the hook now sends them), its next tool call past the race window or its finish, and never by main-thread activity; an MCP tool's dialog by that call's `mcp_done`; Claude Code's session registry leaving `waiting` (Yes, or an Esc that fires no hook) releases the card as answered in the terminal and lowers the hand, so a late office click is a 409 instead of a reported answer; a needs-you restored from `agents.json` gets what is left of its ten-minute timeout; lowering `logPrompts` (and `/clear`) also trims the last prompt and reply each session already holds; the ELECTRICITY and $/min burn decays to zero for a session that goes quiet; `costToday` counts a session that drops off and reports again the same day once; a registry file whose pid now belongs to another process (after a crash and a reboot or a pid wrap) is no longer a session, checked by the process start time as Claude Code checks it.
- Second bug hunt, client side: a second needs-you of the same kind is announced again instead of swallowed; a session the snapshot reports ended lowers its hand and title prefix at once; a stale end-of-session timer no longer clocks out a resumed Claude; a prompt that arrives while the boss walks back from a hand-over turns him round; a session Claude's status line is never overwritten by an arrival; on reload the Claudes are seated before their workers; the boss's furniture errands wait as long as his walk actually takes.

### Incident mode
- "Prod Is Down": three failed tool calls in five minutes turn the office red (night room, pulsing tint, beacon over the door, rollback on the TV, days-since sign at 0, live timer) with `/incident`, `/all-clear`, `?variant=incident` and a postmortem card (#11).
- The signal bus: the hook classifies the Bash commands that deploy, build, test or push (`classify_command`, a pattern table in `hooks/agent-tracker.sh` behind a word prefilter, so ordinary commands never load it) and sends their start, success or failure — with the first meaningful error line, the exit code and a count like *3 failing* — as `signals` on the event the call sends anyway; the server validates them, keeps the last 100 in memory per session and overall (`GET /signals`, the last 20 on the WebSocket snapshot, nothing persisted) and broadcasts one `signal` per signal right after the carrying event. A failed deploy opens incident mode at once, a failed build or test run counts toward the threshold under its own name (and never twice), a landed deploy or the last red run going green resolves it, and the postmortem names the root cause; in the office a deploy in flight shows a rocket over whoever runs it, a landed deploy and a push to main get a cheer, a red run flashes red, and system chat lines say what happened.

### Agent-to-agent messaging
- Directed messages with recipient, type and reply threading; per-agent inbox files; unread badges over the recipient's head; an A2A JSON-RPC `message/send` endpoint and agent cards; self-message and loop-budget guards (#5, #7).

### Distribution and reliability
- The production build works again (#8).
- Vitest harness and GitHub Actions CI; the server is importable without side effects and every runtime path honours `AGENT_OFFICE_HOME` (#9).
- The server serves the built UI on one port and the Electron bundle is self-contained: it spawns the server with its own Node, ships the Electron-ABI `better-sqlite3`, and no longer needs `node` on the PATH (#13).
- Scripts hardening: the chat watcher no longer answers its own replies or the office's announcements, runs `claude -p` with `--safe-mode` so it cannot fire the office hooks, always releases its lock, is rate-capped; `stop-office.sh` only stops what `start-office.sh` started; Linux start works; `notify.sh` passes text as arguments (#14).
- Server hardening: bearer token on every route that acts as an agent or destroys state, constant-time compare, token written only after the port is bound, private file modes, JSON error middleware, lifecycle and input fixes (#16, #17).
- The installer registers all hook events idempotently, adds the status line (chaining an existing one), repairs entries from a moved checkout and tolerates malformed settings files (#5, #15, #18).
- `bash hooks/install-hooks.sh --uninstall` (`npm run uninstall-hooks`) takes the office back out of `~/.claude/settings.json`: every `agent-tracker.sh` hook goes (stale paths and duplicates included, empty groups/events/`hooks` dropped), a chained status line is put back from the saved command and the saved files are deleted, foreign hooks and settings are untouched, nothing of ours means exit 0 and no write; backup first (#25).
- Installer safety: a `settings.json` that is not valid JSON is refused with the parse error's line and column, before any backup, instead of being replaced by `{}` (install, status line and `--uninstall` alike); the installer and uninstaller write `$CLAUDE_CONFIG_DIR/settings.json` when that is set, as Claude Code, the server and the doctor read it; an entry is the office's only when its command runs a path ending in `hooks/agent-tracker.sh` / `hooks/status-line.sh`, so a `my-status-line.sh` or `~/.claude/status-line.sh` of your own is chained, not overwritten or uninstalled; backups get `.1`, `.2`, … within one second and are never overwritten; `--status-line-only` (`npm run install-status-line`) gives plugin users the meters without registering every hook a second time, and the plugin's `/agent-office:office`, the README, the doctor and the meters' tooltips now point there.
- Desktop app and chat bot fixes from the second bug hunt: startup runs once however often macOS activates the app (it used to spawn a second server and leave an orphan), the packaged app refuses a server on its port that has no office page, Reset window size is reachable without the menu bar (tray, right-click, `Cmd/Ctrl+Shift+0`); the chat bot answers a message typed while it was replying, rejects a corrupt or future watermark, and its `claude -p` dies with it on Linux.
- Security follow-up: `npm run open`, `start-office.sh` and the desktop app hand out the office token only to a server that answers a fresh `/health` challenge with `HMAC-SHA256(token, "office-health:" + challenge)`, so a process squatting the port while the office is down is never given the link; the dev page, Vite, the openers, the desktop app and the status line use `127.0.0.1` instead of `localhost` (which may resolve to `[::1]`, where another user could listen while the office binds `127.0.0.1` only); the inspector history, open without a token, no longer carries a signal's error line or detail (command output, which can hold credentials); a failed `&&` chain is no longer blamed on its deploy, push or test segment when an unclassified command in the chain could have been the one that failed, so `npm ci && vercel deploy` failing on npm no longer opens "Prod Is Down".
- Security, third bug hunt: the hook and the status line no longer put the office token on curl's command line (every local user could read it in `ps`, and it is stable across restarts). They **sign** each request — `HMAC-SHA256(token, method + path + timestamp + body)`, sent as `X-Office-Timestamp` / `X-Office-Signature` headers — and the server accepts a valid bearer token (still used by the Python scripts and A2A clients, from their own memory) **or** a valid signature within ±60 s, verified over the raw body in constant time. A permission dialog is answered only when the office **proves it holds the token**: the hook sends a nonce, builds the hook output itself from a decision word (`allow` | `allow-remember` | `deny`) — never server JSON, never an `updatedInput`, `allow-remember` echoing only the dialog's own suggestions — and prints nothing unless the reply carries `HMAC(token, nonce + permissionId + decision)`, so a process squatting the port while the office is down cannot answer or collect the token; the `answer-permissions` marker is removed when the office stops. A **Host-header guard** (first middleware and the WebSocket handler) serves only loopback host names, closing the DNS-rebinding read of the open GETs. `chat.db` and its `-wal` / `-shm` files are created `0600` and the runtime dir forced to `0700`, repairing an install that left them world-readable. The hook's default server URL is pinned to `127.0.0.1`.
- Desktop app: the window opens at the office's own 1056×682 and zooms the office to fit any size, remembers its bounds in `window-state.json` and restores them clamped to the display; a tray / menu-bar icon shows how many agents are working (and who needs you) with Show/Hide, Compact widget, Always on top, Open in browser and Quit; the compact widget is a small always-on-top window showing just the room; app and tray icons are generated by `scripts/generate-icons.mjs` (#27).
- Pipeline health: `GET /health` reports hooks seen since boot, the last hook's time, sessions, agents, clients, version and uptime, and the server sends it in the WebSocket snapshot and as a throttled `health` broadcast; a status strip along the bottom of the office shows online / reconnecting / offline, `hooks: last seen 12 s ago` (or, after a minute with nothing heard, the installer command), the session count and the version; `npm run doctor` prints PASS / WARN / FAIL for node, the hook entries (or the plugin), the status line, `python3` / `bash` / `curl`, the server and whether hooks reach it, the auth token's mode and `dist/`, then the install / uninstall / start commands, exit 1 on any FAIL (#28).
- Tagged releases: pushing a `v*` tag runs `.github/workflows/release.yml`, which builds unsigned installers on macOS (`.dmg`, Apple silicon and Intel), Windows (NSIS `.exe`) and Linux (`.AppImage`), named `Agent-Office-<version>-<os>-<arch>`, and attaches them to a draft GitHub release for the owner to publish; `npm version` now moves `.claude-plugin/plugin.json` to the same version (#30).
- Asset diet: the two office rooms are exported at twice the size they are drawn at (1508×1126 instead of 4800×3584; 19 MB → 2 MB each, no visible change at 1x or 2x), 28 walk-frame sprites nothing loaded are gone, and `npm run check-assets` (also a CI step) fails on a referenced-but-missing asset or when `public/` grows past its size budget, listing files nothing references; `public/` and `dist/` go from 87 MB to 46 MB.
- Runtime config: `AGENT_OFFICE_PORT` works end to end — the server binds it (an invalid value warns and falls back to 3334) and builds its origin allowlist and A2A URLs from it; the hook, the status line (`AGENT_OFFICE_STATUS_URL` still wins), the scripts, the Vite dev proxy, the desktop app, its server child and the tray all follow it; the page derives the server address from where it was loaded (`src/serverUrl.ts`) instead of ten hard-coded `3334` URLs; `GET /config` reports the port, host, version and the boss from `office.config.json`, read at runtime, so renaming the boss needs a reload, not a rebuild (the bundled copy stays the fallback for `?sim` and a server that is down); `AGENT_OFFICE_HOST` accepts `127.0.0.1` or `localhost` (both bind `127.0.0.1`, which every client dials; `::1` is refused with its own reason) and refuses anything else with the reason, binding `127.0.0.1`; the README's new Configuration section lists every environment variable.
- The status strip counts sessions from the list the title bar draws and adds what wants attention: `3 sessions · 1 not hooked · 2 need you`, not hooked in amber and need you in the session pills' needs-you colour, each part left out at zero; its tooltip names the unhooked sessions and says what each waiting one waits on.

### Security
- The WebSocket no longer hands the conversation, or the UI token that answers a permission dialog, to any local process: the Origin check keeps other web pages out but a local process sends whatever Origin it likes, so another local user could read prompts, replies and the command a dialog asks about, and answer that dialog in someone else's Claude Code session. Each connection now authenticates at the handshake with the office token from the `0600` auth-token file (sent as a `Sec-WebSocket-Protocol` value); without it the office is still shown, read-only — no UI token, no prompt / reply text, no permission command line or suggestions, no signal output — and `GET /permissions` and `GET /signals` leave those out too. The page gets the token from a link the server prints at start (`http://127.0.0.1:3334/#token=…`; the fragment never reaches a server), keeps it per browser and strips it from the address bar; `npm run open`, `start-office.sh` and the desktop app open that link for you (a browser is handed a `0600` redirect page, so the token is never on a command line in `ps`). The token is now reused across restarts while its file is still safe to trust, `npm run rotate-token` retires it, and a page without it says *read-only* in the status strip and offers no answer buttons.

### Documentation
- README leads with the product; NOTICE for the fan-art skin; CONTRIBUTING and issue templates (#20).

## 1.0.0

Initial release: pixel-art office driven by Claude Code hooks, Slack-style chat, Dunder Mifflin skin, Electron wrapper.
