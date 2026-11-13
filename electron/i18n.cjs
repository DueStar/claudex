/**
 * The main process's words in Korean, English and Japanese — the same idea as
 * src/i18n.ts: the Korean text is the key, values go in as {name}.
 *
 * The language is 설정 › 앱 › 언어; main.cjs hands over where to read it
 * (`useLanguage`). 'auto' follows app.getLocale(). Until then it is Korean.
 */

const en = {
  '서버에 연결할 수 없어요': "Can't reach the server",
  '열린 세션 없음': 'No open sessions',
  '세션 {n}개': 'Sessions: {n}',
  '{n}개 일하는 중': 'Working: {n}',
  '{n}개 확인 필요': 'Needs you: {n}',
  '숨기기': 'Hide',
  '보이기': 'Show',
  '보이기/숨기기': 'Show/Hide',
  '설정': 'Settings',
  '편집': 'Edit',
  '창': 'Window',
  '업데이트 확인': 'Check for updates',
  '로그 폴더 열기': 'Open logs folder',
  '디자인 QA 페이지': 'Design QA page',
  '{app} 끝내기': 'Quit {app}',
  '최신 버전이에요 ({version})': "You're up to date ({version})",
  '업데이트를 확인하지 못했어요': "Couldn't check for updates",
  '도감 백업 저장': 'Save Pokédex backup',
  '포켓몬이 일할 폴더 선택': 'Choose a folder for your Pokémon to work in',
  'spawn 디자인 QA': 'spawn Design QA',
  '개발 실행에서는 업데이트하지 않아요': "Updates are off in a development run",
  '맥: 앱을 응용 프로그램 폴더로 옮긴 뒤 업데이트해 주세요': 'Mac: move the app to the Applications folder, then update',
  '맥: 이 위치의 앱은 직접 업데이트할 수 없어요. 새 버전을 받아 주세요': "Mac: the app can't update itself where it is. Please download the new version",
  '맥: 업데이트를 적용하지 못했어요. 새 버전을 받아 주세요': "Mac: the update couldn't be applied. Please download the new version",
}

const ja = {
  '서버에 연결할 수 없어요': 'サーバーに接続できません',
  '열린 세션 없음': '開いているセッションはありません',
  '세션 {n}개': 'セッション {n}件',
  '{n}개 일하는 중': '作業中 {n}件',
  '{n}개 확인 필요': '確認待ち {n}件',
  '숨기기': '隠す',
  '보이기': '表示',
  '보이기/숨기기': '表示/隠す',
  '설정': '設定',
  '편집': '編集',
  '창': 'ウィンドウ',
  '업데이트 확인': 'アップデートを確認',
  '로그 폴더 열기': 'ログフォルダを開く',
  '디자인 QA 페이지': 'デザイン QA ページ',
  '{app} 끝내기': '{app} を終了',
  '최신 버전이에요 ({version})': '最新バージョンです ({version})',
  '업데이트를 확인하지 못했어요': 'アップデートを確認できませんでした',
  '도감 백업 저장': '図鑑のバックアップを保存',
  '포켓몬이 일할 폴더 선택': 'ポケモンが作業するフォルダを選択',
  'spawn 디자인 QA': 'spawn デザイン QA',
  '개발 실행에서는 업데이트하지 않아요': '開発版ではアップデートしません',
  '맥: 앱을 응용 프로그램 폴더로 옮긴 뒤 업데이트해 주세요': 'Mac: アプリを「アプリケーション」フォルダに移してからアップデートしてください',
  '맥: 이 위치의 앱은 직접 업데이트할 수 없어요. 새 버전을 받아 주세요': 'Mac: この場所のアプリは直接アップデートできません。新しいバージョンをダウンロードしてください',
  '맥: 업데이트를 적용하지 못했어요. 새 버전을 받아 주세요': 'Mac: アップデートを適用できませんでした。新しいバージョンをダウンロードしてください',
}

const DICTS = { en, ja }

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text)

/** 'ko' | 'en' | 'ja' from the setting; 'auto' takes the system locale */
function resolveLang(setting, system) {
  if (setting === 'ko' || setting === 'en' || setting === 'ja') return setting
  const s = String(system || '').toLowerCase()
  return s.startsWith('ko') ? 'ko' : s.startsWith('ja') ? 'ja' : 'en'
}

/** A t(ko, vars) for one fixed language (tests, and the Korean default) */
const translator = (lang) => (ko, vars) => fill((lang !== 'ko' && DICTS[lang]?.[ko]) || ko, vars)

let current = () => 'ko'
/** Read the language from here on: getSetting() is the setting, getSystem() the OS locale */
function useLanguage(getSetting, getSystem) {
  current = () => resolveLang(getSetting(), getSystem())
}

/** `ko` in the language in use */
const t = (ko, vars) => translator(current())(ko, vars)

module.exports = { t, translator, resolveLang, useLanguage }
