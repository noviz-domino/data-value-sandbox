// 데이터(DAT) 뷰 — SPEC_M4.md §4 / SPEC.md §14: 전체 사건 표(정렬/필터) + events.csv·
// ground_truth.json 내보내기.
//
// 하우스 스타일(analysis-view.js/results-panel.js와 동일): createXxx(container, deps) -> { render() }.
// 컨테이너는 main.js가 이미 갖고 있는 #view-dat 다.
//
// ── deps 계약 (org-view.js 상단 주석과 토씨 하나까지 동일하게 유지할 것 — 세 에이전트가 서로
//    대화하지 않으므로, 여기서 다르게 적으면 그 자체가 버그의 씨앗이다) ──────────────────────
//
//   deps = {
//     result: {
//       events: object[],       // { id, day, lat, lon, org, branch, method, target, success, casualties }
//       campaigns: object[],    // { id, org, targetId, startDay, endDay, eventIds }
//       facilities: object[],   // facilities.json의 facilities 배열 { id, kind, lat, lon }
//       periods: object[],      // { org, directive, startDay, endDay }
//       days: number,           // 시뮬레이션 총 일수 (1826)
//       startDate: number,      // Date.UTC(...) 원시값 — day 0의 실제 날짜. CSV의 date 컬럼은
//                                // 여기서부터 day를 더해 ISO 날짜로 만든다(SPEC_M4 §4).
//     },
//     seed: number,
//     queryEvents: (args: { scope?: {lat,lon,radiusKm}, window?: {startDay,endDay} }) => object[],
//     getState: () => ({ window: { startDay: number, endDay: number }, scope: {lat,lon,radiusKm} | null }),
//     onStateChange: (cb: (state: ReturnType<getState>) => void) => (() => void),
//     requestRerun: (opts?: { seed?: number }) => void,
//   }
//
// 정답지 분리 주의(SPEC_M3 §3): 이 뷰는 result.campaigns를 "표시"하고 ground_truth.json으로
// "내보내는" 것까지는 허용되지만(SPEC_M4 §6 "the data view may display ground truth and export
// it as a separate file"), 그 값이 추론 경로(inference.js/scan.js)로 흘러들어가게 만들면 안 된다.
// 이 파일은 그 경로를 아예 import하지 않는다.
//
// ── 판단(judgement call) — org 신원(identity) 표시 여부 (작업 지시 §3) ──────────────────────
// main.js는 지도 전역에 "reveal" 토글(기본 OFF)을 갖고 있고, 꺼져 있으면 사건의 org 태그·조직
// 기지/반경·지침 상태를 화면 어디에도 내지 않는다(main.js "Job1" 주석 참고). 그런데 viewDeps
// 계약(위)에는 그 reveal 상태가 없다 — main.js/index.html을 건드릴 수 없는 이 작업의 파일
// 경계상, 전역 reveal을 읽어올 통로가 아예 없다.
//
// 그렇다고 이 표를 늘 무조건 완전히 열어두는 쪽을 고르지는 않았다. 이 뷰의 "존재 이유"는
// 정답지를 보여주고 내보내는 것이지만, 지도에서 무심코 DAT 탭을 눌러 들어온 사용자는 방금
// reveal OFF 상태로 "누가 저질렀는지 모르는 채" 탐색하고 있었을 사람이다 — 탭 하나로 그 노력이
// 무효화되면 안 된다. 그래서 이 뷰는 **자기만의 로컬 reveal 토글**을 두고, 기본값을 앱 전역
// 기본값과 똑같이 OFF로 맞춘다(전역 상태를 실제로 읽을 수는 없지만, "기본은 가림"이라는 원칙은
// 그대로 따른다). 로컬 토글을 켜면 표의 org 열과 org 필터가 즉시 열린다 — 원하면 언제든 한 클릭.
//
// CSV/ground_truth.json 내보내기는 이 로컬 토글과 무관하게 **항상 실제 값**을 담는다. 내보내기
// 파일이 바로 이 프로젝트의 "정답지"이므로, 화면 가림과 파일 내용을 같은 것으로 취급하면 안 된다
// (하나는 실수로 눈에 들어오는 것을 막는 화면 배려, 하나는 채점기가 실제로 써야 하는 데이터).
import { t, register, onLangChange } from "./i18n.js";
// ORGS/DIRECTIVES는 시뮬레이터가 규칙을 만드는 데 쓰는 정적 설정값이지 추론 결과가 아니다 —
// inference.js/scan.js가 아니므로 이 import는 "정답지가 추론 경로로 흘러든다"는 금지에 해당하지
// 않는다. ground_truth.json에 organisations/directives를 채우기 위해서만 읽는다(§4.6 모양).
import { ORGS, DIRECTIVES } from "./organizations.js";

register({
  ko: {
    "dat.title": "데이터",
    "dat.subtitle": "전체 사건 표 · 필터 · 내보내기",
    "dat.revealOff": "조직 신원 가림",
    "dat.revealOn": "조직 신원 표시",
    "dat.revealNote":
      "지도 화면의 reveal 토글과 별개인 이 뷰 전용 스위치입니다. 지도에서 조직 신원을 가려 둔 채 넘어온 경우를 위해 기본은 가림(OFF)이며, 켜면 org 열과 org 필터가 열립니다. 내보내기 파일(events.csv/ground_truth.json)에는 이 스위치와 무관하게 항상 실제 값이 들어갑니다.",
    "dat.masked": "•••",
    "dat.filterOrg": "조직",
    "dat.filterOrgMasked": "가려짐",
    "dat.filterBranch": "파벌",
    "dat.filterMethod": "수법",
    "dat.filterTarget": "표적",
    "dat.filterAll": "전체",
    "dat.dateFrom": "시작일",
    "dat.dateTo": "종료일",
    "dat.resetFilters": "필터 초기화",
    "dat.rowCount": "{shown} / {total}건",
    "dat.activeFilters": "적용된 필터: {list}",
    "dat.noActiveFilters": "적용된 필터 없음",
    "dat.colId": "ID",
    "dat.colDay": "일차",
    "dat.colDate": "날짜",
    "dat.colLat": "위도",
    "dat.colLon": "경도",
    "dat.colOrg": "조직",
    "dat.colBranch": "파벌",
    "dat.colMethod": "수법",
    "dat.colTarget": "표적",
    "dat.colSuccess": "성공",
    "dat.colCasualties": "사상자",
    "dat.yes": "예",
    "dat.no": "아니오",
    "dat.exportEvents": "events.csv 내보내기",
    "dat.exportGroundTruth": "ground_truth.json 내보내기",
    "dat.exportNote":
      "두 파일은 절대 하나로 합치지 않습니다. events.csv는 모델이 보는 사건 기록이고, ground_truth.json은 채점 전용 정답지입니다 — 어떤 모델링 코드도 ground_truth.json을 읽어서는 안 됩니다.",
    "dat.exportSeparateHeading": "내보내기",
    "dat.tableHeading": "사건 표",
    "dat.timingNote": "필터 {ms}ms",
  },
  en: {
    "dat.title": "Data",
    "dat.subtitle": "Full event table · filters · export",
    "dat.revealOff": "Organisation identity hidden",
    "dat.revealOn": "Organisation identity shown",
    "dat.revealNote":
      "A switch local to this view, separate from the map's reveal toggle. It defaults to OFF in case you arrived here with organisation identity still hidden on the map — turning it on opens the org column and org filter. The exported files (events.csv/ground_truth.json) always contain the real values regardless of this switch.",
    "dat.masked": "•••",
    "dat.filterOrg": "Organisation",
    "dat.filterOrgMasked": "hidden",
    "dat.filterBranch": "Branch",
    "dat.filterMethod": "Method",
    "dat.filterTarget": "Target",
    "dat.filterAll": "All",
    "dat.dateFrom": "From",
    "dat.dateTo": "To",
    "dat.resetFilters": "Reset filters",
    "dat.rowCount": "{shown} / {total} events",
    "dat.activeFilters": "Active filters: {list}",
    "dat.noActiveFilters": "No active filters",
    "dat.colId": "ID",
    "dat.colDay": "Day",
    "dat.colDate": "Date",
    "dat.colLat": "Lat",
    "dat.colLon": "Lon",
    "dat.colOrg": "Org",
    "dat.colBranch": "Branch",
    "dat.colMethod": "Method",
    "dat.colTarget": "Target",
    "dat.colSuccess": "Success",
    "dat.colCasualties": "Casualties",
    "dat.yes": "Yes",
    "dat.no": "No",
    "dat.exportEvents": "Export events.csv",
    "dat.exportGroundTruth": "Export ground_truth.json",
    "dat.exportNote":
      "The two files are never combined. events.csv is what a model sees; ground_truth.json is the answer key for scoring only — no modelling code may ever read ground_truth.json.",
    "dat.exportSeparateHeading": "Export",
    "dat.tableHeading": "Event table",
    "dat.timingNote": "filter pass {ms}ms",
  },
});

// 컬럼 정의 — 헤더(i18n 키)와 CSV 컬럼 순서(SPEC_M4 §4)를 한 자리에서 관리한다.
// key: 정렬/필터가 event[key]를 직접 읽는 이름. csv: true인 컬럼만 events.csv에 그 순서대로 나간다.
const COLUMNS = [
  { key: "id", labelKey: "dat.colId", type: "num" },
  { key: "day", labelKey: "dat.colDay", type: "num" },
  { key: "date", labelKey: "dat.colDate", type: "str" }, // day에서 파생 — 정렬은 day와 동치
  { key: "lat", labelKey: "dat.colLat", type: "num" },
  { key: "lon", labelKey: "dat.colLon", type: "num" },
  { key: "org", labelKey: "dat.colOrg", type: "str", maskable: true },
  { key: "branch", labelKey: "dat.colBranch", type: "str" },
  { key: "method", labelKey: "dat.colMethod", type: "str" },
  { key: "target", labelKey: "dat.colTarget", type: "str" },
  { key: "success", labelKey: "dat.colSuccess", type: "bool" },
  { key: "casualties", labelKey: "dat.colCasualties", type: "num" },
];
const CSV_COLUMNS = ["id", "day", "date", "lat", "lon", "org", "branch", "method", "target", "success", "casualties"];

/**
 * @param {HTMLElement} container - #view-dat
 * @param {object} deps - 위 계약 참고
 */
export function createDataView(container, deps) {
  const events = deps.result.events;
  const startDate = deps.result.startDate;

  // day -> "YYYY-MM-DD" (UTC). CSV의 date 컬럼과 표의 날짜 컬럼이 항상 같은 값을 쓰도록
  // 이 한 함수로만 계산한다.
  const dayCache = new Map();
  function dayToISO(day) {
    let iso = dayCache.get(day);
    if (iso == null) {
      iso = new Date(startDate + day * 86400000).toISOString().slice(0, 10);
      dayCache.set(day, iso);
    }
    return iso;
  }

  // events에 date 필드를 미리 붙여둔 뷰용 사본 — 원본 배열/객체는 건드리지 않는다(다른 뷰가
  // 같은 참조를 들고 있을 수 있으므로 side effect 금지).
  const rows = events.map((e) => ({ ...e, date: dayToISO(e.day) }));

  // 필터 드롭다운에 쓸 고유값 목록 — 한 번만 계산(events 순회 3000건, 매 렌더 반복할 이유 없음).
  const uniq = { org: new Set(), branch: new Set(), method: new Set(), target: new Set() };
  for (const e of events) {
    uniq.org.add(e.org);
    uniq.branch.add(e.branch);
    uniq.method.add(e.method);
    uniq.target.add(e.target);
  }
  const orgOptions = [...uniq.org].sort();
  const branchOptions = [...uniq.branch].sort();
  const methodOptions = [...uniq.method].sort();
  const targetOptions = [...uniq.target].sort();

  // ── 뷰 상태 (언어 전환/재렌더에도 유지되어야 하므로 클로저 변수) ────────────────────────
  const state = {
    filters: { org: "", branch: "", method: "", target: "", dateFrom: "", dateTo: "" },
    sortKey: "day",
    sortDir: "asc",
    revealOrg: false, // 로컬 전용 토글 — 위 판단 주석 참고. 기본 OFF.
  };

  // ── 필터 메모이제이션 (SPEC_M4 §4: 100ms 넘으면 memoise) ───────────────────────────────
  let filterCache = { key: null, rows: null };
  function getFiltered() {
    const f = state.filters;
    const key = JSON.stringify(f);
    if (filterCache.key === key) return filterCache.rows; // 필터가 안 바뀌었으면 재계산하지 않는다
    const t0 = performance.now();
    const dayFrom = f.dateFrom ? Math.round((Date.parse(f.dateFrom + "T00:00:00Z") - startDate) / 86400000) : -Infinity;
    const dayTo = f.dateTo ? Math.round((Date.parse(f.dateTo + "T00:00:00Z") - startDate) / 86400000) : Infinity;
    const out = rows.filter((e) => {
      if (f.org && e.org !== f.org) return false;
      if (f.branch && e.branch !== f.branch) return false;
      if (f.method && e.method !== f.method) return false;
      if (f.target && e.target !== f.target) return false;
      if (e.day < dayFrom || e.day > dayTo) return false;
      return true;
    });
    lastFilterMs = performance.now() - t0;
    filterCache = { key, rows: out };
    return out;
  }
  let lastFilterMs = 0;

  // ── 정렬 메모이제이션 — 필터 결과(참조)와 정렬키가 둘 다 같으면 재사용 ───────────────────
  let sortCache = { filteredRef: null, key: null, rows: null };
  function getSorted() {
    const filtered = getFiltered();
    const key = state.sortKey + "|" + state.sortDir;
    if (sortCache.filteredRef === filtered && sortCache.key === key) return sortCache.rows;
    const col = COLUMNS.find((c) => c.key === state.sortKey) || COLUMNS[1];
    const dir = state.sortDir === "asc" ? 1 : -1;
    const sorted = filtered.slice().sort((a, b) => {
      let av = a[col.key];
      let bv = b[col.key];
      if (col.type === "bool") { av = av ? 1 : 0; bv = bv ? 1 : 0; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.id - b.id; // 동점자는 id로 안정 정렬
    });
    sortCache = { filteredRef: filtered, key, rows: sorted };
    return sorted;
  }

  // ── 다운로드 헬퍼 — Blob + object URL, 클릭 후 즉시 revoke ─────────────────────────────
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // CSV 문자열 만들기 — 필요한 셀만 따옴표(콤마/따옴표/개행 포함 시), \n 줄바꿈.
  function csvCell(v) {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }
  function exportEventsCsv() {
    const lines = [CSV_COLUMNS.join(",")];
    for (const e of rows) { // 항상 전체 events — 화면 필터/로컬 reveal과 무관하게 내보내기는 전량(SPEC_M4 §4)
      lines.push(CSV_COLUMNS.map((k) => csvCell(e[k])).join(","));
    }
    download("events.csv", lines.join("\n"), "text/csv");
  }
  function exportGroundTruth() {
    const gt = {
      seed: deps.seed,
      days: deps.result.days,
      startDate: deps.result.startDate,
      organisations: ORGS,
      directives: DIRECTIVES,
      periods: deps.result.periods,
      campaigns: deps.result.campaigns,
      facilities: deps.result.facilities,
    };
    download("ground_truth.json", JSON.stringify(gt, null, 2), "application/json");
  }

  // ── 표 렌더링 ───────────────────────────────────────────────────────────────────────
  function renderRow(e) {
    const cells = COLUMNS.map((c) => {
      let v = e[c.key];
      if (c.key === "org" && !state.revealOrg) v = t("dat.masked");
      else if (c.type === "bool") v = v ? t("dat.yes") : t("dat.no");
      else if (c.type === "num" && typeof v === "number" && !Number.isInteger(v)) v = v.toFixed(4);
      return "<td>" + v + "</td>";
    });
    return "<tr>" + cells.join("") + "</tr>";
  }

  function activeFilterSummary() {
    const f = state.filters;
    const parts = [];
    if (f.org) parts.push(t("dat.filterOrg") + "=" + f.org);
    if (f.branch) parts.push(t("dat.filterBranch") + "=" + f.branch);
    if (f.method) parts.push(t("dat.filterMethod") + "=" + f.method);
    if (f.target) parts.push(t("dat.filterTarget") + "=" + f.target);
    if (f.dateFrom) parts.push(t("dat.dateFrom") + "=" + f.dateFrom);
    if (f.dateTo) parts.push(t("dat.dateTo") + "=" + f.dateTo);
    return parts.length ? t("dat.activeFilters", { list: parts.join(", ") }) : t("dat.noActiveFilters");
  }

  function optionsHtml(options, current, allLabel) {
    let html = '<option value="">' + allLabel + "</option>";
    for (const o of options) {
      html += '<option value="' + o + '"' + (o === current ? " selected" : "") + ">" + o + "</option>";
    }
    return html;
  }

  function headerHtml(col) {
    const active = state.sortKey === col.key;
    const arrow = active ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    return (
      '<th class="dat-th' + (active ? " on" : "") + '" data-sort="' + col.key + '">' +
      t(col.labelKey) + arrow +
      "</th>"
    );
  }

  function render() {
    const sorted = getSorted();
    const orgFilterDisabled = !state.revealOrg;

    container.innerHTML =
      '<div class="dat">' +
        '<div class="dat-panel">' +
          '<div class="eyebrow">' + t("dat.title") + "</div>" +
          '<div class="dat-subtitle">' + t("dat.subtitle") + "</div>" +

          '<div class="dat-reveal-row">' +
            '<button class="btn dat-reveal-btn' + (state.revealOrg ? " on" : "") + '" id="dat-reveal-toggle">' +
              (state.revealOrg ? t("dat.revealOn") : t("dat.revealOff")) +
            "</button>" +
            '<div class="dat-reveal-note">' + t("dat.revealNote") + "</div>" +
          "</div>" +

          '<div class="dat-filters">' +
            '<label class="dat-field">' + t("dat.filterOrg") +
              '<select id="dat-f-org"' + (orgFilterDisabled ? " disabled" : "") + ">" +
                (orgFilterDisabled
                  ? '<option value="">' + t("dat.filterOrgMasked") + "</option>"
                  : optionsHtml(orgOptions, state.filters.org, t("dat.filterAll"))) +
              "</select>" +
            "</label>" +
            '<label class="dat-field">' + t("dat.filterBranch") +
              '<select id="dat-f-branch">' + optionsHtml(branchOptions, state.filters.branch, t("dat.filterAll")) + "</select>" +
            "</label>" +
            '<label class="dat-field">' + t("dat.filterMethod") +
              '<select id="dat-f-method">' + optionsHtml(methodOptions, state.filters.method, t("dat.filterAll")) + "</select>" +
            "</label>" +
            '<label class="dat-field">' + t("dat.filterTarget") +
              '<select id="dat-f-target">' + optionsHtml(targetOptions, state.filters.target, t("dat.filterAll")) + "</select>" +
            "</label>" +
            '<label class="dat-field">' + t("dat.dateFrom") +
              '<input type="date" id="dat-f-from" value="' + state.filters.dateFrom + '">' +
            "</label>" +
            '<label class="dat-field">' + t("dat.dateTo") +
              '<input type="date" id="dat-f-to" value="' + state.filters.dateTo + '">' +
            "</label>" +
            '<button class="btn" id="dat-f-reset">' + t("dat.resetFilters") + "</button>" +
          "</div>" +

          '<div class="dat-summary">' +
            '<span class="dat-count">' + t("dat.rowCount", { shown: sorted.length, total: events.length }) + "</span>" +
            '<span class="dat-active">' + activeFilterSummary() + "</span>" +
            '<span class="dat-timing">' + t("dat.timingNote", { ms: lastFilterMs.toFixed(1) }) + "</span>" +
          "</div>" +

          '<div class="dat-table-wrap">' +
            "<table class=\"dat-table\"><thead><tr>" +
              COLUMNS.map(headerHtml).join("") +
            "</tr></thead><tbody>" +
              sorted.map(renderRow).join("") +
            "</tbody></table>" +
          "</div>" +
        "</div>" +

        '<div class="dat-panel dat-export-panel">' +
          '<div class="eyebrow">' + t("dat.exportSeparateHeading") + "</div>" +
          '<div class="dat-export-row">' +
            '<button class="btn" id="dat-export-events">' + t("dat.exportEvents") + "</button>" +
            '<button class="btn" id="dat-export-gt">' + t("dat.exportGroundTruth") + "</button>" +
          "</div>" +
          '<div class="dat-export-note">' + t("dat.exportNote") + "</div>" +
        "</div>" +
      "</div>";

    // ── 이벤트 위임: 헤더 클릭(정렬), 필터 select/input(change), reset/export/reveal 버튼 ──
    container.querySelectorAll(".dat-th").forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = key; state.sortDir = "asc"; }
        render();
      };
    });
    const bindSelect = (id, field) => {
      const el = container.querySelector(id);
      if (el) el.onchange = () => { state.filters[field] = el.value; render(); };
    };
    bindSelect("#dat-f-org", "org");
    bindSelect("#dat-f-branch", "branch");
    bindSelect("#dat-f-method", "method");
    bindSelect("#dat-f-target", "target");
    bindSelect("#dat-f-from", "dateFrom");
    bindSelect("#dat-f-to", "dateTo");
    const resetBtn = container.querySelector("#dat-f-reset");
    if (resetBtn) resetBtn.onclick = () => {
      state.filters = { org: "", branch: "", method: "", target: "", dateFrom: "", dateTo: "" };
      render();
    };
    const revealBtn = container.querySelector("#dat-reveal-toggle");
    if (revealBtn) revealBtn.onclick = () => {
      state.revealOrg = !state.revealOrg;
      if (!state.revealOrg) state.filters.org = ""; // 다시 가릴 때 org 필터도 함께 초기화
      render();
    };
    const expEvents = container.querySelector("#dat-export-events");
    if (expEvents) expEvents.onclick = exportEventsCsv;
    const expGt = container.querySelector("#dat-export-gt");
    if (expGt) expGt.onclick = exportGroundTruth;
  }

  onLangChange(render);

  return { render };
}
