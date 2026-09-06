// 결과(results) 패널 — 스코프 안 후보 시설을 확률 순으로 나열한다 (SPEC_M3.md §6.4).
// analysis-view.js와 같은 하우스 스타일: createXxx(container, opts) -> { render(state) }.
//
// 정답지 분리(ground truth separation): 이 패널은 inferTargets()의 출력(facilityId/score/prob)과
// facilities.json의 lat/lon/kind만 쓴다. org/campaignId는 이 파일 어디에도 등장하지 않는다 — 후보
// 시설이 "실제로" 어느 캠페인의 표적이었는지는 reveal 토글이 켜졌을 때만 별도로(선택적으로) 표시한다.
// reveal이 꺼져 있으면 호출자(main.js)는 revealTargetIds를 아예 null로 넘긴다 — 이 파일은 그
// 경우 답 관련 마크업을 단 한 글자도 만들지 않는다(배지도, 빈 스코프 안내문도 DOM에 없다).

import { haversineKm } from "./geo.js";

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
  function render(state) {
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

    const warningsHtml = warnings.length
      ? '<div class="res-warn">' +
          warnings.map((w) => '<div class="res-warn-item">⚠ ' + esc(w) + "</div>").join("") +
        "</div>"
      : "";

    // 대표 탐지율은 밀도를 맞춘 값이다. 맞추지 않은 값을 함께 적어, 그 차이가 "캠페인 창이
    // 그냥 더 붐벼서" 벌어들인 몫이라는 걸 읽는 사람이 볼 수 있게 한다 (SPEC_M3 §5.3).
    const falseAlarmHtml =
      evaluation == null
        ? ""
        : '<div class="res-fa">5-seed eval (PEC) · detection (탐지율) <b>' + pct1(evaluation.detection) +
            "%</b> at " + pct1(evaluation.operatingFalseAlarmRate) + "% false-alarm rate (오탐률)" +
            '<span class="res-fa-sub">density-matched controls (밀도 맞춘 대조군) · ' +
            pct1(evaluation.detectionUnmatched) + "% unmatched — 사건 수가 부풀린 값</span></div>";

    // reveal이 켜졌는데 이 스코프·시간창에 활성 캠페인이 하나도 없는 경우 — "정답 없음"도
    // 정보다(오경보가 어떻게 생겼는지 보여준다). revealSet===null(=reveal 꺼짐)일 때는 이 줄
    // 자체를 만들지 않는다 — 빈 Set(size 0)일 때만 표시한다.
    const answerKeyEmptyHtml =
      revealSet && revealSet.size === 0
        ? '<div class="res-answer-empty">ANSWER KEY: no campaign in this scope/window (이 범위·기간에는 캠페인 없음)</div>'
        : "";

    const rowsHtml = ranked
      .map((r) => {
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
              (isTruth ? '<span class="res-truth">ANSWER KEY</span>' : "") +
            "</div>" +
            '<div class="res-bar-track"><div class="res-bar-fill" style="width:' + (r.prob * 100).toFixed(1) + '%"></div>' +
              '<div class="res-bar-floor" style="left:' + (floor * 100).toFixed(1) + '%"></div></div>' +
            '<div class="res-prob">' + pct1(r.prob) + "% <span>(floor " + pct1(floor) + "%)</span></div>" +
          "</div>"
        );
      })
      .join("");

    container.innerHTML =
      '<div class="eyebrow">Target candidates (목표 후보)</div>' +
      '<div class="res-meta">' +
        '<span>' + eventCount + " events in scope (범위 안 사건)</span>" +
        '<span>radius ' + Math.round(radiusKm) + " km</span>" +
        '<span>' + ranked.length + " candidates · floor (무작위 기준선) " + pct1(floor) + "%</span>" +
      "</div>" +
      warningsHtml + falseAlarmHtml + answerKeyEmptyHtml +
      '<div class="res-list">' + (rowsHtml || '<div class="res-empty">Drag on the map to set a scope. (지도에서 드래그해 범위를 정하세요)</div>') + "</div>";

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
