// 언어 전환(i18n) 모듈 — SPEC_M4.md §1.4. M3까지는 영어 문구에 한국어 괄호 주석을 붙이는
// 방식(gloss)이었는데, 한 줄에 두 언어가 섞이니 둘 다 잘 안 읽혔다(§1.1). 그 방식을 폐기하고
// 완전한 한국어판/영어판 두 벌을 만든 뒤 토글로 전환하는 방식으로 바꾼다.
//
// 이 파일은 사전(dictionary)을 "누가 관리하느냐"에는 관여하지 않는다 — 문자열은 그 문자열을
// 쓰는 모듈(results-panel.js, analysis-view.js, main.js, inference.js 등)이 각자 import 시점에
// register()로 등록한다. 이 파일 하나에 모든 문자열을 모아두면 여러 사람이 동시에 이 파일을
// 고치게 되어 병합 충돌이 보장되므로(SPEC_M4 §1.4), 그 구조를 절대 따르지 않는다.

const table = { ko: {}, en: {} };

// 이미 한 번 경고한 누락 키는 다시 콘솔을 어지럽히지 않는다.
const missingLogged = new Set();

// 언어 변경을 구독하는 콜백들. onLangChange()가 반환하는 함수로 각자 구독을 해지한다.
const subscribers = new Set();

/** localStorage 접근은 이 두 함수로만 한다 — 일부 임베디드 환경에서 접근 자체가 예외를 던진다(SPEC §1.3). */
function readStoredLang() {
  try {
    const v = localStorage.getItem("gtc.lang");
    return v === "ko" || v === "en" ? v : null;
  } catch {
    return null;
  }
}
function writeStoredLang(lang) {
  try {
    localStorage.setItem("gtc.lang", lang);
  } catch {
    // 저장 실패는 조용히 무시한다 — 이번 세션 동안만 선택이 유지된다.
  }
}

/** 기본 언어: 명시적으로 고른 적이 있으면 그 값이 최우선, 없으면 브라우저 언어가 ko로 시작하는지로 결정(SPEC §1.3). */
function detectDefaultLang() {
  const stored = readStoredLang();
  if (stored) return stored;
  const nav = (typeof navigator !== "undefined" && navigator.language) || "";
  return nav.startsWith("ko") ? "ko" : "en";
}

let currentLang = detectDefaultLang();

/**
 * 여러 모듈에서 나눠 등록한 사전 조각을 하나로 합친다. 같은 키를 두 번 등록하면 나중 것이 이긴다
 * (모듈끼리 네임스페이스(res.*, anl.* 등)로 키를 나누는 게 규칙이라 실제로는 거의 일어나지 않는다).
 * @param {{ko?: Record<string,string>, en?: Record<string,string>}} dict
 */
export function register(dict) {
  if (dict && dict.ko) Object.assign(table.ko, dict.ko);
  if (dict && dict.en) Object.assign(table.en, dict.en);
}

/**
 * key를 현재 언어 문자열로 바꾼다. vars가 있으면 "{name}" 자리표시자를 치환한다.
 * 등록되지 않은 키는 절대 빈 문자열이나 예외가 아니라 key 그 자체를 돌려준다 — 화면에 빈칸이
 * 뜨는 것보다 "res.title" 같은 키가 그대로 보이는 편이 무엇이 빠졌는지 알아채기 쉽다.
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const dict = table[currentLang] || {};
  let str = dict[key];
  if (str == null) {
    if (!missingLogged.has(key)) {
      missingLogged.add(key);
      console.warn("[i18n] missing key:", key, "(lang=" + currentLang + ")");
    }
    return key;
  }
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/** @returns {"ko"|"en"} 현재 언어. */
export function getLang() {
  return currentLang;
}

/**
 * 언어를 바꾸고 localStorage에 저장한 뒤 구독자 전원에게 알린다. 시뮬레이션 상태·시간창·스코프·
 * 선택은 이 함수가 절대 건드리지 않는다 — 언어는 어디까지나 표시(presentation)일 뿐이고,
 * 무엇을 다시 그릴지는 구독자(각 뷰)의 몫이다(SPEC §1.5).
 * @param {"ko"|"en"} lang
 */
export function setLang(lang) {
  if (lang !== "ko" && lang !== "en") return; // 잘못된 값은 조용히 무시 — 알 수 없는 언어로 넘어가지 않는다
  if (lang === currentLang) return;
  currentLang = lang;
  writeStoredLang(lang);
  subscribers.forEach((cb) => {
    try {
      cb(currentLang);
    } catch (err) {
      console.error("[i18n] onLangChange 구독자에서 예외 발생", err);
    }
  });
}

/**
 * 언어가 바뀔 때마다 cb(lang)을 부른다.
 * @param {(lang: "ko"|"en") => void} cb
 * @returns {() => void} 구독 해지 함수
 */
export function onLangChange(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
