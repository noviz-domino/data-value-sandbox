// 결과(results) 패널 — 스코프 안 후보 시설을 확률 순으로 나열한다 (SPEC_M3.md §6.4).
// analysis-view.js와 같은 하우스 스타일: createXxx(container, opts) -> { render(state) }.
//
// 정답지 분리(ground truth separation): 이 패널은 inferTargets()의 출력(facilityId/score/prob)과
// facilities.json의 lat/lon/kind만 쓴다. org/campaignId는 이 파일 어디에도 등장하지 않는다 — 후보
// 시설이 "실제로" 어느 캠페인의 표적이었는지는 reveal 토글이 켜졌을 때만 별도로(선택적으로) 표시한다.
// reveal이 꺼져 있으면 호출자(main.js)는 revealTargetIds를 아예 null로 넘긴다 — 이 파일은 그
// 경우 답 관련 마크업을 단 한 글자도 만들지 않는다(배지도, 빈 스코프 안내문도 DOM에 없다).

import { haversineKm } from "./geo.js";
// i18n (SPEC_M4 §1.4): 이 모듈이 그리는 문자열은 이 모듈이 직접 register() 한다. M3에서 썼던
// "영어 (한국어 괄호)" gloss는 여기서 전부 폐기한다(§1.1) — floor/오탐률/범위 같은 개념어를
// 완전한 한국어 문장으로 다시 쓴다.
import { t, register, onLangChange } from "./i18n.js";

register({
  ko: {
    "res.title": "표적 후보",
    "res.eventsInScope": "범위 안 사건 {n}건",
    "res.radius": "반경 {km}km",
    "res.candidatesFloor": "후보 {n}개 · 무작위 기준선 {floor}%",
    "res.evalLine": "5시드 평가(PEC) · 오탐률 {far}%에서 탐지율 {det}%",
    "res.evalSub": "밀도 맞춘 대조군 · 미매칭 {unmatched}% — 사건 수로 부풀려진 값",
    "res.answerKeyEmpty": "정답: 이 범위·기간에는 캠페인 없음",
    "res.answerKeyBadge": "정답",
    "res.floorInline": "무작위 기준선 {floor}%",
    "res.emptyPrompt": "지도에서 드래그해 범위를 지정하세요.",
  },
  en: {
    "res.title": "Target candidates",
    "res.eventsInScope": "{n} events in scope",
    "res.radius": "radius {km} km",
    "res.candidatesFloor": "{n} candidates · floor {floor}%",
    "res.evalLine": "5-seed eval (PEC) · detection {det}% at {far}% false-alarm rate",
    "res.evalSub": "density-matched controls · {unmatched}% unmatched — inflated by event count",
    "res.answerKeyEmpty": "ANSWER KEY: no campaign in this scope/window",
    "res.answerKeyBadge": "ANSWER KEY",
    "res.floorInline": "floor {floor}%",
    "res.emptyPrompt": "Drag on the map to set a scope.",
  },
});

/** 0.4083 -> "40.8" (소수 첫째자리, % 기호 없이). */
function pct1(x) {
  return (x * 100).toFixed(1);
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/**
 * @param {HTMLElement} container
 * @param {{ onSelect: (facilityId: string|null) => void }} opts
 */
export function createResultsPanel(container, { onSelect } = {}) {
  // 언어가 바뀌면 마지막으로 받은 state로 그대로 다시 그린다 — 스코프·시간창·선택은 main.js가
  // 들고 있는 상태이지 여기서 재계산하지 않으므로, 이 재호출은 추론을 다시 돌리지 않는다(§1.5).
  let lastState = null;
  onLangChange(() => {
    if (lastState) render(lastState);
  });

  function render(state) {
    lastState = state;
    const {
      ranked = [],
      eventCount = 0,
      warnings = [],
      radiusKm = 0,
      facilitiesById = new Map(),
      selectedFacilityId = null,
      evaluation = null, // { operatingFalseAlarmRate, detection, detectionUnmatched, unmatchedShare } | null (§5.3)
      // reveal이 켜졌을 때만 넘어오는 정답 facilityId들의 Set(또는 배열) — 여러 캠페인이 동시에
      // 활성일 수 있으므로 단수(revealTargetId)가 아니라 복수로 받는다. reveal이 꺼져 있으면
      // main.js가 아예 이 필드를 넘기지 않으므로(undefined -> null) 여기서도 항상 null이다.
      revealTargetIds = null,
    } = state || {};
    // Set이든 배열이든 받아들이되, 내부에서는 Set으로 통일해 매 행마다 O(1)로 조회한다.
    const revealSet = revealTargetIds ? new Set(revealTargetIds) : null;

    // 스코프 상대 floor (§6.4): "1 / (스코프 안 후보 수)". 후보가 창마다 달라지므로 전역 0.63%를
    // 쓰면 안 된다는 게 이 프로젝트의 핵심 교훈(SPEC_M3 §5.3) — 결과 패널에서도 그대로 지킨다.
    const floor = ranked.length ? 1 / ranked.length : 0;

    // warnings는 inference.js가 남긴 i18n 키 문자열("inf.tooFewEvents" 등)이다 — 여기서 t()로
    // 언어에 맞는 문구로 바꾼 뒤에야 그린다. inference.js는 언어를 모르는 순수 함수라 키만 준다.
    const warningsHtml = warnings.length
      ? '<div class="res-warn">' +
          warnings.map((w) => '<div class="res-warn-item">⚠ ' + esc(t(w)) + "</div>").join("") +
        "</div>"
      : "";

    // 대표 탐지율은 밀도를 맞춘 값이다. 맞추지 않은 값을 함께 적어, 그 차이가 "캠페인 창이
    // 그냥 더 붐벼서" 벌어들인 몫이라는 걸 읽는 사람이 볼 수 있게 한다 (SPEC_M3 §5.3).
    const falseAlarmHtml =
      evaluation == null
        ? ""
        : '<div class="res-fa">' +
            t("res.evalLine", { det: pct1(evaluation.detection), far: pct1(evaluation.operatingFalseAlarmRate) }) +
            '<span class="res-fa-sub">' +
              t("res.evalSub", { unmatched: pct1(evaluation.detectionUnmatched) }) +
            "</span></div>";

    // reveal이 켜졌는데 이 스코프·시간창에 활성 캠페인이 하나도 없는 경우 — "정답 없음"도
    // 정보다(오경보가 어떻게 생겼는지 보여준다). revealSet===null(=reveal 꺼짐)일 때는 이 줄
    // 자체를 만들지 않는다 — 빈 Set(size 0)일 때만 표시한다.
    const answerKeyEmptyHtml =
      revealSet && revealSet.size === 0
        ? '<div class="res-answer-empty">' + t("res.answerKeyEmpty") + "</div>"
        : "";

    const rowsHtml = ranked
      .map((r) => {
        // facility의 kind/id는 데이터셋 값이라 언어와 무관하게 항상 원문 그대로 둔다(SPEC_M4 §1.2) —
        // events.csv/ground_truth.json에 그대로 나가는 값이라 번역하면 화면과 파일이 어긋난다.
        const f = facilitiesById.get(r.facilityId);
        const kind = f ? f.kind : "?";
        const dist = f && state.scopeCenter
          ? haversineKm(state.scopeCenter.lat, state.scopeCenter.lon, f.lat, f.lon).toFixed(0) + " km"
          : "--";
        const isSel = r.facilityId === selectedFacilityId;
        const isTruth = revealSet ? revealSet.has(r.facilityId) : false;
        return (
          '<div class="res-row' + (isSel ? " sel" : "") + '" data-fid="' + esc(r.facilityId) + '" tabindex="0">' +
            '<div class="res-row-head">' +
              '<span class="res-fid">' + esc(r.facilityId) + "</span>" +
              '<span class="res-kind">' + esc(kind) + "</span>" +
              '<span class="res-dist">' + dist + "</span>" +
              (isTruth ? '<span class="res-truth">' + t("res.answerKeyBadge") + "</span>" : "") +
            "</div>" +
            '<div class="res-bar-track"><div class="res-bar-fill" style="width:' + (r.prob * 100).toFixed(1) + '%"></div>' +
              '<div class="res-bar-floor" style="left:' + (floor * 100).toFixed(1) + '%"></div></div>' +
            '<div class="res-prob">' + pct1(r.prob) + "% <span>(" + t("res.floorInline", { floor: pct1(floor) }) + ")</span></div>" +
          "</div>"
        );
      })
      .join("");

    container.innerHTML =
      '<div class="eyebrow">' + t("res.title") + "</div>" +
      '<div class="res-meta">' +
        '<span>' + t("res.eventsInScope", { n: eventCount }) + "</span>" +
        '<span>' + t("res.radius", { km: Math.round(radiusKm) }) + "</span>" +
        '<span>' + t("res.candidatesFloor", { n: ranked.length, floor: pct1(floor) }) + "</span>" +
      "</div>" +
      warningsHtml + falseAlarmHtml + answerKeyEmptyHtml +
      '<div class="res-list">' + (rowsHtml || '<div class="res-empty">' + t("res.emptyPrompt") + "</div>") + "</div>";

    container.querySelectorAll("[data-fid]").forEach((el) => {
      const fire = () => onSelect && onSelect(el.dataset.fid === selectedFacilityId ? null : el.dataset.fid);
      el.onclick = fire;
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(); }
      };
    });
  }

  return { render };
}
