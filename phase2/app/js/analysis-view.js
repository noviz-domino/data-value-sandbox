// 분석(ANL) 뷰. analysis.js의 runAblation()을 한 번 실행해 캐싱하고, SPEC.md §13/§15에 따라
// 조직별 recall 회복(headline), floor/ceiling 경계가 있는 accuracy 트랙, run 비교 표,
// run별 confusion matrix 히트맵을 렌더링한다. BUILD_PLAN M2-T2.
//
// 디자인 원칙(SPEC §15): 채도(saturation)는 조직 색상에만 쓴다. 나머지는 --ink 계열 중립색.
// accuracy 숫자는 절대 단독으로 나오지 않는다 — floor/ceiling이 항상 같은 시각 그룹 안에 붙는다.

import { ORGS } from "./organizations.js";
import { runAblation } from "./analysis.js";

// map.js/main.js와 동일한 실측 팔레트(§15.1의 --org-* 변수와 다르므로 여기서도 맞춰 정의).
const ORG_COLORS = {
  NORTHWIND: "#57C7EA",
  TIDEBREAK: "#F2A03D",
  DRYSTONE: "#C77DD8",
};
const RUN_KEYS = ["A", "B", "C"];
const RUN_LABELS = {
  A: "A · lat, lon",
  B: "B · lat, lon, day",
  C: "C · lat, lon, day, target, month",
};

/** 0.6083 -> "60.8" 처럼 소수 첫째자리까지 반올림한 문자열(퍼센트 기호 없이). */
function pct1(x) {
  return (x * 100).toFixed(1);
}

/** SVG 요소를 문자열 템플릿으로 짓기 위한 최소한의 escape (org 키/라벨은 내부 상수라 굳이 필요 없지만 습관적으로). */
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

// ── (a) 조직별 recall 회복: org마다 A/B/C 막대 3개짜리 small-multiple ─────────────────────
function renderRecoveryPanel(result) {
  const w = 168;
  const h = 108;
  const barW = 30;
  const gap = 14;
  const baseX = 14;
  const baseY = 84;
  const maxBarH = 64;

  const orgsHtml = ORGS.map((org) => {
    const color = ORG_COLORS[org.key];
    const bars = RUN_KEYS.map((run, i) => {
      const recall = result[run].confusion.perClass[org.key].recall;
      const barH = Math.max(2, recall * maxBarH);
      const x = baseX + i * (barW + gap);
      const y = baseY - barH;
      return (
        '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + barH +
        '" fill="' + color + '" opacity="' + (0.45 + i * 0.275) + '"></rect>' +
        '<text x="' + (x + barW / 2) + '" y="' + (y - 5) + '" text-anchor="middle" class="anl-bar-val">' +
          pct1(recall) + "</text>" +
        '<text x="' + (x + barW / 2) + '" y="' + (baseY + 13) + '" text-anchor="middle" class="anl-bar-run">' +
          run + "</text>"
      );
    }).join("");
    const deltaAB = result.B.confusion.perClass[org.key].recall - result.A.confusion.perClass[org.key].recall;
    const deltaBC = result.C.confusion.perClass[org.key].recall - result.B.confusion.perClass[org.key].recall;
    const bestDelta = Math.abs(deltaAB) >= Math.abs(deltaBC) ? deltaAB : deltaBC;
    const bestLabel = Math.abs(deltaAB) >= Math.abs(deltaBC) ? "A→B" : "B→C";
    const sign = bestDelta >= 0 ? "+" : "−";
    return (
      '<div class="anl-org-cell">' +
        '<div class="anl-org-name" style="color:' + color + '">' + org.key + "</div>" +
        '<svg viewBox="0 0 ' + w + " " + h + '" class="anl-org-svg">' +
          '<line x1="' + baseX + '" y1="' + baseY + '" x2="' + (baseX + 3 * barW + 2 * gap) + '" y2="' + baseY +
            '" class="anl-axis"></line>' +
          bars +
        "</svg>" +
        '<div class="anl-org-delta">recall ' + bestLabel + " <b style=\"color:" + color + '">' + sign +
          Math.abs(bestDelta * 100).toFixed(1) + "pp</b></div>" +
      "</div>"
    );
  }).join("");

  return '<div class="anl-org-row">' + orgsHtml + "</div>";
}

// ── (b) run별 bounded-accuracy 트랙: floor/achieved/ceiling ─────────────────────────────
function renderBoundedTrack(run, key) {
  const trackW = 100; // % 단위를 그대로 x좌표로 씀 (viewBox 0..100)
  const floorX = run.floor * 100;
  const ceilX = run.ceiling * 100;
  const accX = run.accuracy * 100;
  return (
    '<div class="anl-track-row">' +
      '<div class="anl-track-label">' + key + '<span>' + RUN_LABELS[key].slice(4) + "</span></div>" +
      '<svg viewBox="0 0 100 22" preserveAspectRatio="none" class="anl-track-svg">' +
        '<rect x="0" y="8" width="100" height="6" class="anl-track-bg"></rect>' +
        '<rect x="' + floorX + '" y="8" width="' + (ceilX - floorX) + '" height="6" class="anl-track-range"></rect>' +
        '<rect x="0" y="8" width="' + accX + '" height="6" class="anl-track-fill"></rect>' +
        '<line x1="' + floorX + '" y1="4" x2="' + floorX + '" y2="18" class="anl-track-tick anl-track-floor"></line>' +
        '<line x1="' + ceilX + '" y1="4" x2="' + ceilX + '" y2="18" class="anl-track-tick anl-track-ceil"></line>' +
        '<circle cx="' + accX + '" cy="11" r="3.2" class="anl-track-dot"></circle>' +
      "</svg>" +
      '<div class="anl-track-nums">' +
        '<span class="anl-num-floor">floor ' + pct1(run.floor) + "</span>" +
        '<span class="anl-num-acc">acc ' + pct1(run.accuracy) + "</span>" +
        '<span class="anl-num-ceil">ceiling ' + pct1(run.ceiling) + "</span>" +
        '<span class="anl-num-rec">recovered ' + pct1(run.recovered) + "%</span>" +
      "</div>" +
    "</div>"
  );
}

function renderBoundedPanel(result) {
  return RUN_KEYS.map((k) => renderBoundedTrack(result[k], k)).join("");
}

// ── (c) run 비교 표 ─────────────────────────────────────────────────────────────────────
function renderTable(result) {
  const rows = RUN_KEYS.map((k) => {
    const r = result[k];
    return (
      "<tr><td>" + k + "</td><td>" + esc(r.features.join(", ")) + "</td><td>" + pct1(r.floor) +
      "</td><td>" + pct1(r.accuracy) + "</td><td>" + pct1(r.ceiling) +
      '</td><td class="anl-recovered-cell">' + pct1(r.recovered) + "%</td></tr>"
    );
  }).join("");
  return (
    '<table class="anl-table"><thead><tr>' +
      "<th>Run</th><th>Features</th><th>Floor</th><th>Accuracy</th><th>Ceiling</th>" +
      '<th class="anl-recovered-cell">Recovered</th>' +
    "</tr></thead><tbody>" + rows + "</tbody></table>"
  );
}

// ── (d) run별 confusion matrix 히트맵 ────────────────────────────────────────────────────
// 행 단위로 직접 셀 문자열을 조립한다(actual=행, predicted=열). 셀 배경은 실제-라벨 org 색상에
// 행 기준 비율(frac = count/rowSum)로 alpha를 줘 히트맵처럼 보이게 한다.
function renderConfusionPanelSafe(result) {
  const classes = ORGS.map((o) => o.key);
  return RUN_KEYS.map((k) => {
    const m = result[k].confusion.matrix;
    let gridCells = '<div class="anl-cm-corner"></div>';
    for (const c of classes) {
      gridCells += '<div class="anl-cm-axis" style="color:' + ORG_COLORS[c] + '">' + c.slice(0, 4) + "</div>";
    }
    classes.forEach((actualOrg, ri) => {
      const rowSum = m[ri].reduce((a, b) => a + b, 0) || 1;
      gridCells += '<div class="anl-cm-axis" style="color:' + ORG_COLORS[actualOrg] + '">' + actualOrg.slice(0, 4) + "</div>";
      classes.forEach((predOrg, ci) => {
        const v = m[ri][ci];
        const frac = v / rowSum;
        const alphaHex = Math.round(frac * 210 + 20).toString(16).padStart(2, "0");
        gridCells +=
          '<div class="anl-cm-cell" style="background:' + ORG_COLORS[actualOrg] + alphaHex + '"><span>' + v + "</span></div>";
      });
    });
    return (
      '<div class="anl-cm">' +
        '<div class="anl-cm-title">Run ' + k + '<span> · actual (rows) vs predicted (cols)</span></div>' +
        '<div class="anl-cm-grid" style="grid-template-columns:44px repeat(' + classes.length + ", 1fr)\">" +
          gridCells +
        "</div>" +
      "</div>"
    );
  }).join("");
}

// ── caption: 실제 숫자로부터 생성되는 한 줄 설명 ─────────────────────────────────────────
function renderCaption(result) {
  const tbA = result.A.confusion.perClass.TIDEBREAK.recall;
  const tbB = result.B.confusion.perClass.TIDEBREAK.recall;
  const dsB = result.B.confusion.perClass.DRYSTONE.recall;
  const dsC = result.C.confusion.perClass.DRYSTONE.recall;
  const accA = result.A.accuracy;
  const accC = result.C.accuracy;
  const ceiling = result.A.ceiling;
  return (
    "Adding day-of-year recovers TIDEBREAK’s drifting cell (recall " + pct1(tbA) + "% → " + pct1(tbB) +
    "%); adding target type and month recovers DRYSTONE’s seasonal cell (recall " + pct1(dsB) + "% → " +
    pct1(dsC) + "%). Overall accuracy barely moves (" + pct1(accA) + "% → " + pct1(accC) +
    "%) because no feature set reaches the oracle ceiling (" + pct1(ceiling) +
    "%) — the rest is irreducible overlap between organisations’ operating areas."
  );
}

/**
 * ANL 뷰를 container 안에 그린다. runAblation은 한 번만 실행해 결과를 캐싱한다.
 * @param {HTMLElement} container
 * @param {{events:object[], periods:object[]}} args
 */
export function createAnalysisView(container, { events, periods }) {
  let result = null;

  function render() {
    if (!result) {
      result = runAblation({ events, periods });
    }
    container.innerHTML =
      '<div class="anl">' +
        '<section class="anl-panel">' +
          '<div class="eyebrow">Per-organisation recall recovery (A → B → C)</div>' +
          renderRecoveryPanel(result) +
          '<div class="anl-caption">' + renderCaption(result) + "</div>" +
        "</section>" +
        '<section class="anl-panel">' +
          '<div class="eyebrow">Bounded accuracy — floor · achieved · ceiling</div>' +
          renderBoundedPanel(result) +
        "</section>" +
        '<section class="anl-panel">' +
          '<div class="eyebrow">Run comparison</div>' +
          renderTable(result) +
        "</section>" +
        '<section class="anl-panel">' +
          '<div class="eyebrow">Confusion matrices</div>' +
          '<div class="anl-cm-row">' + renderConfusionPanelSafe(result) + "</div>" +
        "</section>" +
      "</div>";
  }

  return { render };
}
