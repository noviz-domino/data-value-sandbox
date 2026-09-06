// 결과(results) 패널 — 스코프 안 후보 시설을 확률 순으로 나열한다 (SPEC_M3.md §6.4).
// M4-T2(SPEC_M4 §2)부터: 이 패널이 "분석관이 실제로 쓰는 흐름"의 중심이 된다.
//   1) 스코프/시간창을 바꿀 때마다 오는 가벼운 미리보기(scopePreview) — 비용이 큰 inferTargets는
//      아직 돌리지 않은 상태에서도 "범위 안 사건 수"를 계속 보여준다.
//   2) Analyze — 명시적으로 눌러야 실제 순위(mode:"analyzed")가 나온다.
//   3) Scan — 스코프가 없을 때, 지금 화면을 격자로 훑은 상위 10개(mode:"scanning"/"scanned").
// analysis-view.js와 같은 하우스 스타일: createXxx(container, opts) -> { render(state) }.
//
// 정답지 분리(ground truth separation): 이 패널은 inferTargets()/scan.js의 출력(facilityId/
// score/prob/z)과 facilities.json의 lat/lon/kind만 쓴다. org/campaignId는 이 파일 어디에도
// 등장하지 않는다 — 후보 시설이 "실제로" 어느 캠페인의 표적이었는지는 reveal 토글이 켜졌을 때만
// 별도로(선택적으로) 표시한다. reveal이 꺼져 있으면 호출자(main.js)는 revealTargetIds를 아예
// null로 넘긴다 — 이 파일은 그 경우 답 관련 마크업을 단 한 글자도 만들지 않는다.

import { haversineKm } from "./geo.js";
// i18n (SPEC_M4 §1.4): 이 모듈이 그리는 문자열은 이 모듈이 직접 register() 한다.
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
    // ── M4-T2 신규: Analyze/Scan 행동, 대기(idle) 상태, 스캔 결과 ──────────────────
    "res.analyzeBtn": "분석 실행",
    "res.scanBtn": "주변 스캔",
    "res.scanBtnBusy": "스캔 중…",
    "res.idlePrompt": "범위(스코프)와 기간을 정한 뒤 “분석 실행”을 누르면 표적 후보를 계산합니다. 어디를 볼지 아직 정하지 못했다면 “주변 스캔”으로 지금 화면에서 가장 두드러지는 곳을 찾아보세요.",
    "res.scanProgress": "{done}/{total} 지점 확인 중",
    "res.scanTitle": "주변 스캔 결과 (상위 {n})",
    "res.scanEmpty": "지금 화면에서 뚜렷하게 두드러지는 지점을 찾지 못함",
    "res.scanHint": "이 방법이 이 합성 데이터에서 구조를 찾아낸 지점을 보여줄 뿐입니다 — 실제 장소에 대한 경고가 아닙니다.",
    "res.scanWeak": "약한 신호",
    "res.scanZ": "z {z}",
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
    "res.analyzeBtn": "Analyze",
    "res.scanBtn": "Scan area",
    "res.scanBtnBusy": "Scanning…",
    "res.idlePrompt": "Set a scope and time window, then press “Analyze” to compute target candidates. If you don't yet know where to look, press “Scan area” to find what stands out most in the current view.",
    "res.scanProgress": "Checking {done}/{total} points",
    "res.scanTitle": "Scan results (top {n})",
    "res.scanEmpty": "Nothing in the current view stands out",
    "res.scanHint": "This shows where the method finds structure in this synthetic dataset — it is not a warning about a real place.",
    "res.scanWeak": "weak signal",
    "res.scanZ": "z {z}",
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
 * @param {{ onSelectCandidate: (facilityId: string|null) => void,
 *   onAnalyze: () => void, onScan: () => void,
 *   onSelectScanHit: (hit: object) => void }} opts
 */
export function createResultsPanel(container, { onSelectCandidate, onAnalyze, onScan, onSelectScanHit } = {}) {
  // 언어가 바뀌면 마지막으로 받은 state로 그대로 다시 그린다 — 스코프·시간창·선택은 main.js가
  // 들고 있는 상태이지 여기서 재계산하지 않으므로, 이 재호출은 추론을 다시 돌리지 않는다(§1.5).
  let lastState = null;
  onLangChange(() => {
    if (lastState) render(lastState);
  });

  /** 후보 목록(ranked) 행 하나. Analyze 결과와 Scan 결과 모두 이 모양을 재사용한다. */
  function candidateRowsHtml(ranked, { facilitiesById, selectedFacilityId, scopeCenter, revealSet }) {
    const floor = ranked.length ? 1 / ranked.length : 0;
    const rowsHtml = ranked
      .map((r) => {
        // facility의 kind/id는 데이터셋 값이라 언어와 무관하게 항상 원문 그대로 둔다(SPEC_M4 §1.2).
        const f = facilitiesById.get(r.facilityId);
        const kind = f ? f.kind : "?";
        const dist = f && scopeCenter
          ? haversineKm(scopeCenter.lat, scopeCenter.lon, f.lat, f.lon).toFixed(0) + " km"
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
    return { rowsHtml, floor };
  }

  /** Analyze 결과 본문(mode:"analyzed"). M3까지 이 파일의 render()가 하던 일 그대로다. */
  function analyzedBodyHtml(a) {
    const {
      ranked = [],
      eventCount = 0,
      warnings = [],
      facilitiesById = new Map(),
      selectedFacilityId = null,
      evaluation = null,
      revealTargetIds = null,
      scopeCenter = null,
    } = a;
    const revealSet = revealTargetIds ? new Set(revealTargetIds) : null;

    const warningsHtml = warnings.length
      ? '<div class="res-warn">' +
          warnings.map((w) => '<div class="res-warn-item">⚠ ' + esc(t(w)) + "</div>").join("") +
        "</div>"
      : "";

    const falseAlarmHtml =
      evaluation == null
        ? ""
        : '<div class="res-fa">' +
            t("res.evalLine", { det: pct1(evaluation.detection), far: pct1(evaluation.operatingFalseAlarmRate) }) +
            '<span class="res-fa-sub">' +
              t("res.evalSub", { unmatched: pct1(evaluation.detectionUnmatched) }) +
            "</span></div>";

    const answerKeyEmptyHtml =
      revealSet && revealSet.size === 0
        ? '<div class="res-answer-empty">' + t("res.answerKeyEmpty") + "</div>"
        : "";

    const { rowsHtml, floor } = candidateRowsHtml(ranked, { facilitiesById, selectedFacilityId, scopeCenter, revealSet });

    return (
      '<div class="res-meta">' +
        '<span>' + t("res.eventsInScope", { n: eventCount }) + "</span>" +
        '<span>' + t("res.candidatesFloor", { n: ranked.length, floor: pct1(floor) }) + "</span>" +
      "</div>" +
      warningsHtml + falseAlarmHtml + answerKeyEmptyHtml +
      '<div class="res-list">' + (rowsHtml || '<div class="res-empty">' + t("res.emptyPrompt") + "</div>") + "</div>"
    );
  }

  /** Scan 결과 본문(mode:"scanning"/"scanned"). Analyze와 같은 행 스타일을 재사용하되 z를 덧붙인다. */
  function scanBodyHtml(scan) {
    const { progress = null, hits = [], facilitiesById = new Map(), selectedFacilityId = null } = scan || {};
    if (progress) {
      const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
      return (
        '<div class="res-scan-progress">' +
          t("res.scanProgress", { done: progress.done, total: progress.total }) +
          '<div class="res-scan-progress-track"><div class="res-scan-progress-fill" style="width:' + pct + '%"></div></div>' +
        "</div>"
      );
    }
    if (!hits.length) {
      return '<div class="res-empty">' + t("res.scanEmpty") + "</div>";
    }
    const rowsHtml = hits
      .map((h) => {
        const f = facilitiesById.get(h.facilityId);
        const kind = f ? f.kind : "?";
        const dist = f ? haversineKm(h.point.lat, h.point.lon, f.lat, f.lon).toFixed(0) + " km" : "--";
        const isSel = h.facilityId === selectedFacilityId;
        const isWeak = h.prob < 0.15; // inference.js의 "돋보이는 후보 없음" 문턱(§5.2)과 같은 값
        const floor = 1 / h.candidateCount;
        return (
          '<div class="res-row' + (isSel ? " sel" : "") + '" data-scan-fid="' + esc(h.facilityId) + '" tabindex="0">' +
            '<div class="res-row-head">' +
              '<span class="res-fid">' + esc(h.facilityId) + "</span>" +
              '<span class="res-kind">' + esc(kind) + "</span>" +
              '<span class="res-dist">' + dist + "</span>" +
              (isWeak ? '<span class="res-scan-weak">' + t("res.scanWeak") + "</span>" : "") +
            "</div>" +
            '<div class="res-bar-track"><div class="res-bar-fill" style="width:' + (h.prob * 100).toFixed(1) + '%"></div>' +
              '<div class="res-bar-floor" style="left:' + (floor * 100).toFixed(1) + '%"></div></div>' +
            '<div class="res-prob">' + pct1(h.prob) + "% <span>(" + t("res.floorInline", { floor: pct1(floor) }) +
              ") · " + t("res.scanZ", { z: h.z.toFixed(2) }) + " · " + h.eventCount + "</span></div>" +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="res-scan-hint">' + t("res.scanHint") + "</div>" +
      '<div class="eyebrow" style="margin-bottom:6px">' + t("res.scanTitle", { n: hits.length }) + "</div>" +
      '<div class="res-list">' + rowsHtml + "</div>"
    );
  }

  function render(state) {
    lastState = state;
    const {
      mode = "idle", // "idle" | "analyzed" | "scanning" | "scanned"
      scopePreview = { eventCount: 0, candidateCount: 0, radiusKm: 0 },
      analyze = null,
      scan = null,
    } = state || {};

    const liveHtml =
      '<div class="res-scope-live">' +
        '<span>' + t("res.eventsInScope", { n: scopePreview.eventCount }) + "</span>" +
        '<span>' + t("res.radius", { km: Math.round(scopePreview.radiusKm) }) + "</span>" +
        '<span>' + t("res.candidatesFloor", {
          n: scopePreview.candidateCount,
          floor: pct1(scopePreview.candidateCount ? 1 / scopePreview.candidateCount : 0),
        }) + "</span>" +
      "</div>";

    const scanning = mode === "scanning";
    const actionsHtml =
      '<div class="res-actions">' +
        '<button class="res-btn res-btn-analyze" id="res-analyze-btn" type="button">' + t("res.analyzeBtn") + "</button>" +
        '<button class="res-btn res-btn-scan' + (scanning ? " busy" : "") + '" id="res-scan-btn" type="button"' +
          (scanning ? " disabled" : "") + ">" + t(scanning ? "res.scanBtnBusy" : "res.scanBtn") + "</button>" +
      "</div>";

    let bodyHtml;
    if (mode === "analyzed" && analyze) {
      bodyHtml = analyzedBodyHtml(analyze);
    } else if (mode === "scanning" || mode === "scanned") {
      bodyHtml = scanBodyHtml(scan);
    } else {
      bodyHtml = '<div class="res-idle">' + t("res.idlePrompt") + "</div>";
    }

    container.innerHTML =
      '<div class="eyebrow">' + t("res.title") + "</div>" +
      liveHtml + actionsHtml + bodyHtml;

    const analyzeBtn = container.querySelector("#res-analyze-btn");
    if (analyzeBtn) analyzeBtn.onclick = () => onAnalyze && onAnalyze();
    const scanBtn = container.querySelector("#res-scan-btn");
    if (scanBtn) scanBtn.onclick = () => onScan && onScan();

    container.querySelectorAll("[data-fid]").forEach((el) => {
      const fid = el.dataset.fid;
      const selectedFacilityId = analyze ? analyze.selectedFacilityId : null;
      const fire = () => onSelectCandidate && onSelectCandidate(fid === selectedFacilityId ? null : fid);
      el.onclick = fire;
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(); }
      };
    });
    container.querySelectorAll("[data-scan-fid]").forEach((el) => {
      const hit = (scan && scan.hits ? scan.hits : []).find((h) => h.facilityId === el.dataset.scanFid);
      if (!hit) return;
      const fire = () => onSelectScanHit && onSelectScanHit(hit);
      el.onclick = fire;
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(); }
      };
    });
  }

  return { render };
}
