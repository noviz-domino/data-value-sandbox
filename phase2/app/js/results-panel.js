// 결과(results) 패널 — 스코프 안 후보 시설을 확률 순으로 나열한다 (SPEC_M3.md §6.4).
// analysis-view.js와 같은 하우스 스타일: createXxx(container, opts) -> { render(state) }.
//
// 정답지 분리(ground truth separation): 이 패널은 inferTargets()의 출력(facilityId/score/prob)과
// facilities.json의 lat/lon/kind만 쓴다. org/campaignId는 이 파일 어디에도 등장하지 않는다 — 후보
// 시설이 "실제로" 어느 캠페인의 표적이었는지는 reveal 토글이 켜졌을 때만 별도로(선택적으로) 표시한다.

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
      evaluation = null, // { operatingFalseAlarmRate, detectionAt10FAR } | null (evaluateInference 결과, §5.3)
      revealTargetId = null, // reveal이 켜졌을 때만 넘어오는 정답 facilityId (없으면 null)
    } = state || {};

    // 스코프 상대 floor (§6.4): "1 / (스코프 안 후보 수)". 후보가 창마다 달라지므로 전역 0.63%를
    // 쓰면 안 된다는 게 이 프로젝트의 핵심 교훈(SPEC_M3 §5.3) — 결과 패널에서도 그대로 지킨다.
    const floor = ranked.length ? 1 / ranked.length : 0;

    const warningsHtml = warnings.length
      ? '<div class="res-warn">' +
          warnings.map((w) => '<div class="res-warn-item">⚠ ' + esc(w) + "</div>").join("") +
        "</div>"
      : "";

    const falseAlarmHtml =
      evaluation == null
        ? ""
        : '<div class="res-fa">직전 5-seed 평가(PEC) — 오경보율 ' + pct1(evaluation.operatingFalseAlarmRate) +
            "% 문턱에서 탐지율 <b>" + pct1(evaluation.detectionAt10FAR) + "%</b></div>";

    const rowsHtml = ranked
      .map((r) => {
        const f = facilitiesById.get(r.facilityId);
        const kind = f ? f.kind : "?";
        const dist = f && state.scopeCenter
          ? haversineKm(state.scopeCenter.lat, state.scopeCenter.lon, f.lat, f.lon).toFixed(0) + " km"
          : "--";
        const isSel = r.facilityId === selectedFacilityId;
        const isTruth = revealTargetId && r.facilityId === revealTargetId;
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
      '<div class="eyebrow">Target candidates</div>' +
      '<div class="res-meta">' +
        '<span>' + eventCount + " events in scope</span>" +
        '<span>radius ' + Math.round(radiusKm) + " km</span>" +
        '<span>' + ranked.length + " candidates · floor " + pct1(floor) + "%</span>" +
      "</div>" +
      warningsHtml + falseAlarmHtml +
      '<div class="res-list">' + (rowsHtml || '<div class="res-empty">스코프를 지도에 지정하세요.</div>') + "</div>";

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
