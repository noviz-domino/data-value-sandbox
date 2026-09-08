// 분석(ANL) 뷰. analysis.js의 runAblation()을 한 번 실행해 캐싱하고, SPEC.md §13/§15에 따라
// 조직별 recall 회복(headline), floor/ceiling 경계가 있는 accuracy 트랙, run 비교 표,
// run별 confusion matrix 히트맵을 렌더링한다. BUILD_PLAN M2-T2.
//
// 디자인 원칙(SPEC §15): 채도(saturation)는 조직 색상에만 쓴다. 나머지는 --ink 계열 중립색.
// accuracy 숫자는 절대 단독으로 나오지 않는다 — floor/ceiling이 항상 같은 시각 그룹 안에 붙는다.

import { ORGS } from "./organizations.js";
import { runAblation } from "./analysis.js";
// map.js/main.js와 같은 palette.js를 쓴다(M3-T4) — 조직 색이 지도·카드·이 뷰에서
// 서로 어긋나지 않도록 한 곳에서만 정의한다.
import { ORG_COLORS } from "./palette.js";
// i18n (SPEC_M4 §1.4): 이 뷰가 그리는 문자열은 이 파일이 직접 register() 한다.
import { t, register, onLangChange } from "./i18n.js";

register({
  ko: {
    "anl.recoveryTitle": "조직별 recall 회복 (A → B → C)",
    "anl.boundedTitle": "경계 지어진 정확도 — 무작위 기준선 · 달성값 · 상한",
    "anl.tableTitle": "실행 비교",
    "anl.cmTitle": "오차 행렬",
    "anl.cmRunLabel": "실행 {run}",
    "anl.cmSubtitle": "실제(행) vs 예측(열)",
    "anl.trackFloor": "기준선 {v}",
    "anl.trackAcc": "정확도 {v}",
    "anl.trackCeil": "상한 {v}",
    "anl.trackRecovered": "회복률 {v}%",
    "anl.recallDeltaLabel": "{label} recall",
    "anl.tableHeadRun": "실행",
    "anl.tableHeadFeatures": "특징",
    "anl.tableHeadFloor": "기준선",
    "anl.tableHeadAccuracy": "정확도",
    "anl.tableHeadCeiling": "상한",
    "anl.tableHeadRecovered": "회복률",
    "anl.caption":
      "day-of-year(연중 날짜)를 추가하면 TIDEBREAK의 이동하는 셀이 회복됩니다(recall {tbA}% → {tbB}%). " +
      "target 유형과 month를 추가하면 DRYSTONE의 계절성 셀이 회복됩니다(recall {dsB}% → {dsC}%). " +
      "전체 accuracy는 거의 움직이지 않는데({accA}% → {accC}%), 어떤 feature 조합도 oracle 상한({ceiling}%)에 " +
      "도달하지 못하기 때문입니다 — 나머지는 조직들의 활동 구역이 겹치는, 줄일 수 없는 부분입니다.",
  },
  en: {
    "anl.recoveryTitle": "Per-organisation recall recovery (A → B → C)",
    "anl.boundedTitle": "Bounded accuracy — floor · achieved · ceiling",
    "anl.tableTitle": "Run comparison",
    "anl.cmTitle": "Confusion matrices",
    "anl.cmRunLabel": "Run {run}",
    "anl.cmSubtitle": "actual (rows) vs predicted (cols)",
    "anl.trackFloor": "floor {v}",
    "anl.trackAcc": "acc {v}",
    "anl.trackCeil": "ceiling {v}",
    "anl.trackRecovered": "recovered {v}%",
    "anl.recallDeltaLabel": "recall {label}",
    "anl.tableHeadRun": "Run",
    "anl.tableHeadFeatures": "Features",
    "anl.tableHeadFloor": "Floor",
    "anl.tableHeadAccuracy": "Accuracy",
    "anl.tableHeadCeiling": "Ceiling",
    "anl.tableHeadRecovered": "Recovered",
    "anl.caption":
      "Adding day-of-year recovers TIDEBREAK's drifting cell (recall {tbA}% → {tbB}%); adding target type and " +
      "month recovers DRYSTONE's seasonal cell (recall {dsB}% → {dsC}%). Overall accuracy barely moves " +
      "({accA}% → {accC}%) because no feature set reaches the oracle ceiling ({ceiling}%) — the rest is " +
      "irreducible overlap between organisations' operating areas.",
  },
});

const RUN_KEYS = ["A", "B", "C"];
// 각 run이 실제로 어떤 필드(스키마 컬럼명)를 쓰는지 나열한 목록이다 — lat/lon/day/target/month는
// events.csv 컬럼 "내용"이 아니라 "이름"이라 dataset value는 아니지만, 그렇다고 자연어 단어도
// 아니라서 번역하지 않는다(SPEC_M4 §1.2 "column headers translate; contents do not"의 취지를
// 그대로 따르되, 여기 A/B/C 라벨은 헤더 자체가 아니라 헤더 이름들을 나열한 것이라 원문 유지).
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
        '<div class="anl-org-delta">' + t("anl.recallDeltaLabel", { label: bestLabel }) +
          ' <b style="color:' + color + '">' + sign + Math.abs(bestDelta * 100).toFixed(1) + "pp</b></div>" +
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
        '<span class="anl-num-floor">' + t("anl.trackFloor", { v: pct1(run.floor) }) + "</span>" +
        '<span class="anl-num-acc">' + t("anl.trackAcc", { v: pct1(run.accuracy) }) + "</span>" +
        '<span class="anl-num-ceil">' + t("anl.trackCeil", { v: pct1(run.ceiling) }) + "</span>" +
        '<span class="anl-num-rec">' + t("anl.trackRecovered", { v: pct1(run.recovered) }) + "</span>" +
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
      "<th>" + t("anl.tableHeadRun") + "</th><th>" + t("anl.tableHeadFeatures") + "</th><th>" +
      t("anl.tableHeadFloor") + "</th><th>" + t("anl.tableHeadAccuracy") + "</th><th>" +
      t("anl.tableHeadCeiling") + "</th>" +
      '<th class="anl-recovered-cell">' + t("anl.tableHeadRecovered") + "</th>" +
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
        '<div class="anl-cm-title">' + esc(t("anl.cmRunLabel", { run: k })) +
          '<span> · ' + esc(t("anl.cmSubtitle")) + "</span></div>" +
        '<div class="anl-cm-grid" style="grid-template-columns:44px repeat(' + classes.length + ", 1fr)\">" +
          gridCells +
        "</div>" +
      "</div>"
    );
  }).join("");
}

// ── caption: 실제 숫자로부터 생성되는 한 줄 설명 ─────────────────────────────────────────
function renderCaption(result) {
  // TIDEBREAK/DRYSTONE은 조직명(dataset value)이라 언어와 무관하게 원문 그대로 두고, "anl.caption"
  // 번역 문자열 안에도 그대로 하드코딩되어 있다(SPEC_M4 §1.2).
  const tbA = result.A.confusion.perClass.TIDEBREAK.recall;
  const tbB = result.B.confusion.perClass.TIDEBREAK.recall;
  const dsB = result.B.confusion.perClass.DRYSTONE.recall;
  const dsC = result.C.confusion.perClass.DRYSTONE.recall;
  const accA = result.A.accuracy;
  const accC = result.C.accuracy;
  const ceiling = result.A.ceiling;
  return t("anl.caption", {
    tbA: pct1(tbA), tbB: pct1(tbB), dsB: pct1(dsB), dsC: pct1(dsC),
    accA: pct1(accA), accC: pct1(accC), ceiling: pct1(ceiling),
  });
}

/**
 * ANL 뷰를 container 안에 그린다. runAblation은 한 번만 실행해 결과를 캐싱한다.
 * @param {HTMLElement} container
 * @param {{events:object[], periods:object[]}} args
 */
export function createAnalysisView(container, initialArgs) {
  // M4 Fix2: events/periods를 재대입 가능한 지역 변수로 둔다 — main.js가 org-view의 "적용"으로
  // 앱을 재실행(rerun)하면 setData()가 이 값을 새 run 것으로 바꾸고 캐시를 버린다.
  let events = initialArgs.events;
  let periods = initialArgs.periods;
  let result = null;

  function render() {
    if (!result) {
      result = runAblation({ events, periods });
    }
    container.innerHTML =
      '<div class="anl">' +
        '<section class="anl-panel">' +
          '<div class="eyebrow">' + t("anl.recoveryTitle") + "</div>" +
          renderRecoveryPanel(result) +
          '<div class="anl-caption">' + esc(renderCaption(result)) + "</div>" +
        "</section>" +
        '<section class="anl-panel">' +
          '<div class="eyebrow">' + t("anl.boundedTitle") + "</div>" +
          renderBoundedPanel(result) +
        "</section>" +
        '<section class="anl-panel">' +
          '<div class="eyebrow">' + t("anl.tableTitle") + "</div>" +
          renderTable(result) +
        "</section>" +
        '<section class="anl-panel">' +
          '<div class="eyebrow">' + t("anl.cmTitle") + "</div>" +
          '<div class="anl-cm-row">' + renderConfusionPanelSafe(result) + "</div>" +
        "</section>" +
      "</div>";
  }

  // 언어가 바뀌면 캐싱해둔 result로 다시 그리기만 한다 — runAblation()을 다시 부르지 않는다(§1.5).
  onLangChange(() => {
    if (result) render();
  });

  /**
   * M4 Fix2 — 재실행(rerun) 뒤 main.js가 부른다. events/periods를 새 run 것으로 바꾸고 캐싱된
   * result를 버려 다음 render()가 runAblation()을 새로 돌리게 한다. 이 뷰가 이미 한 번이라도
   * 그려진 적 있으면(container.innerHTML이 비어있지 않으면) 지금 당장 다시 그린다 — 탭을 벗어나
   * 있어도 CSS로 숨겨질 뿐 DOM 내용은 남아 있으므로, 다음에 그 탭을 열었을 때 낡은 숫자가 아니라
   * 새 run 결과가 보이게 하려면 여기서 즉시 갱신해야 한다.
   * @param {{events:object[], periods:object[]}} next
   */
  function setData(next) {
    events = next.events;
    periods = next.periods;
    result = null;
    if (container.innerHTML) render();
  }

  return { render, setData };
}
