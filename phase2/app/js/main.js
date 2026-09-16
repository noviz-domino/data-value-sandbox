// 최종 배선(wiring) 모듈 — 모든 조각(rng/geo/organizations/simulation/map/window-control)을
// 하나의 실행되는 앱으로 연결한다. phase2/prototype/index.html의 검증된 재생 루프·크롬(chrome)
// 갱신·부트 시퀀스·활동 피드·조직 카드·컨트롤 로직을 그대로 포팅하되, Canvas 2D 직접 그리기
// 대신 map.js(deck.gl)·window-control.js(Canvas 시간창만) 모듈을 호출하도록 다시 배선했다.
// BUILD_PLAN.md T5. (M3-T3에서 timeline.js를 시간창 컨트롤로 교체하고 삭제했다 — SPEC_M3 §6.1.)
//
// M3-T3(SPEC_M3.md §6)부터: 타임라인 바를 시간창(window) 컨트롤로 바꾸고(§6.1), 이벤트 접근을
// queryEvents() seam 하나로 모으고(§6.2), 지도에 스코프(scope) 선택과 결과(results) 패널을
// 얹어 표적 추론(target inference)을 실제로 조작할 수 있게 한다(§6.3~6.4).

import { makeLandTest, haversineKm } from "./geo.js";
import { ORGS, DIRECTIVES } from "./organizations.js";
import { simulate } from "./simulation.js";
import { createMap } from "./map.js";
import { createWindowControl } from "./window-control.js";
import { createAnalysisView } from "./analysis-view.js";
import { createEventQuery } from "./query.js";
import { createResultsPanel } from "./results-panel.js";
// 정답지 분리(ground truth separation, SPEC_M3 §3): 이 앱에서 추론 관련 함수를 부르는 곳은
// 여기(main.js)뿐이다. inference.js 자체는 절대 손대지 않는다(다른 에이전트가 편집 중).
import { projectForInference, scopeFacilities, inferTargets, evaluateInference } from "./inference.js";
// 주변 스캔(scan, SPEC_M4 §2 항목4) — 스코프를 아직 안 골랐을 때 지금 화면을 격자로 훑는다.
// 이 모듈도 inference.js의 순수 함수만 써서 정답지 분리 경계를 그대로 지킨다(scan.js 상단 주석 참고).
import { computeScanGrid, runScan } from "./scan.js";
// M4 seam 분리(scaffold): 조직/데이터 뷰·투어는 각자 자기 모듈+CSS만 건드리도록 미리 잘라둔다.
// 세 파일 모두 지금은 "coming soon" 스텁이고, 실제 구현은 뒤이은 별도 작업에서 채운다.
// deps 계약은 세 모듈 상단 주석에 동일하게 적혀 있다(org-view.js 참고).
import { createOrgView } from "./org-view.js";
import { createDataView } from "./data-view.js";
import { createTour } from "./tour.js";
// ── 조직 팔레트 ────────────────────────────────────────────────────────────
// M3-T4부터는 palette.js가 유일한 색상 소스다(map.js/analysis-view.js와 공유). 카드/
// 타임라인/피드가 지도와 다른 색을 쓰는 어긋남을 palette.js 하나로 없앤다.
// HEX.evt — reveal이 꺼졌을 때 활동 피드가 쓰는 "조직 무관" 중립색(map.js의 RGB.evt와 같은 값,
// 여기는 <div style="color:...">에 바로 쓸 CSS 색 문자열이 필요해 HEX 쪽을 가져온다).
import { ORG_COLORS, HEX } from "./palette.js";
// i18n (SPEC_M4 §1.4): 이 파일이 직접 그리는(index.html 정적 라벨 포함) 문자열은 이 파일이
// register() 한다. M3까지의 "영어 (한국어 괄호)" gloss는 여기서도 전부 폐기한다(§1.1).
import { t, getLang, setLang, onLangChange, register } from "./i18n.js";

register({
  ko: {
    "app.seed": "시드",
    "app.cells": "셀",
    "app.events": "사건",
    "app.span": "구간",
    "app.running": "진행 중",
    "app.hold": "대기",
    "app.navSim": "시뮬",
    "app.navOrg": "조직",
    "app.navAnl": "분석",
    "app.navDat": "자료",
    "app.reveal": "지휘 계층 공개",
    "app.readoutCur": "현재",
    "app.readoutZoom": "줌",
    "app.readoutProj": "투영",
    "app.zoomWorld": "세계",
    "app.zoomOutAria": "축소",
    "app.zoomInAria": "확대",
    "app.setScope": "범위 지정",
    "app.activityFeed": "활동 피드",
    "app.pause": "일시정지",
    "app.play": "재생",
    "app.timeWindow": "기간",
    "app.winStart": "시작",
    "app.winEnd": "종료",
    "app.cellEv": "사건",
    "app.cellRad": "반경",
    // reveal 꺼짐 상태에서 #cells가 조직 카드 대신 보여주는 중립 요약(Job1) — 조직 신원·개수·
    // 반경은 전혀 드러내지 않고, 분석관이 실제로 가진 두 수치(시간창 내 전체 사건 수, 지금
    // 스코프 안 후보 시설 수)만 보여준다.
    "app.cellsNeutralEvents": "시간창 내 사건",
    "app.cellsNeutralFacilities": "범위 내 후보 시설",
    "app.daysLeft": "{days}일 남음",
    "app.bootTerrain": "지형 마스크",
    "app.bootLoaded": "로드됨",
    "app.bootSeed": "PRNG 시드 {seed}",
    "app.bootLocked": "고정됨",
    "app.bootHierarchy": "행위자 계층 / 셀 {n}개",
    "app.bootReady": "준비됨",
    "app.bootSpan": "시뮬레이션 구간 / {days}일",
    "app.bootBuilt": "생성됨",
    "app.bootInference": "표적 추론 / 후보 {n}개",
    "app.bootCommand": "지휘 계층",
    "app.bootWithheld": "비공개",
    // 재실행(rerun) 진행 배너 (M4 Fix2) — org-view의 "적용"이 앱 전체를 다시 돌리는 동안 표시.
    "app.rerunBanner": "재실행 중 — 새 설정으로 지도·시간창·분석을 다시 계산하고 있다…",
  },
  en: {
    "app.seed": "Seed",
    "app.cells": "Cells",
    "app.events": "Events",
    "app.span": "Span",
    "app.running": "RUNNING",
    "app.hold": "HOLD",
    "app.navSim": "SIM",
    "app.navOrg": "ORG",
    "app.navAnl": "ANL",
    "app.navDat": "DAT",
    "app.reveal": "Reveal command layer",
    "app.readoutCur": "CUR",
    "app.readoutZoom": "ZOOM",
    "app.readoutProj": "PROJ",
    "app.zoomWorld": "World",
    "app.zoomOutAria": "Zoom out",
    "app.zoomInAria": "Zoom in",
    "app.setScope": "Set scope",
    "app.activityFeed": "Activity feed",
    "app.pause": "PAUSE",
    "app.play": "PLAY",
    "app.timeWindow": "Time window",
    "app.winStart": "START",
    "app.winEnd": "END",
    "app.cellEv": "EV",
    "app.cellRad": "RAD",
    "app.cellsNeutralEvents": "EVENTS IN WINDOW",
    "app.cellsNeutralFacilities": "CANDIDATE FACILITIES IN SCOPE",
    "app.daysLeft": "{days}D LEFT",
    "app.bootTerrain": "TERRAIN MASK",
    "app.bootLoaded": "LOADED",
    "app.bootSeed": "PRNG SEED {seed}",
    "app.bootLocked": "LOCKED",
    "app.bootHierarchy": "AGENT HIERARCHY / {n} CELLS",
    "app.bootReady": "READY",
    "app.bootSpan": "SIMULATION SPAN / {days} DAYS",
    "app.bootBuilt": "BUILT",
    "app.bootInference": "TARGET INFERENCE / {n} CANDIDATES",
    "app.bootCommand": "COMMAND LAYER",
    "app.bootWithheld": "WITHHELD",
    "app.rerunBanner": "RE-RUNNING — recomputing map, window and analysis with the new configuration…",
  },
});
// "AO"(Area of Operations)와 부트 타이틀("GROUND TRUTH CONSOLE"/"v0.9.1")은 두 언어에서 동일한
// 값이라 사전에 넣지 않고 그대로 하드코딩한다 — 군사 약어/제품명은 번역해도 똑같기 때문이다.

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const D0 = Date.UTC(2026, 0, 1);

const SEED = 20260903;

// 결과 패널이 항상 켜는 전체 특징 집합(P+E+C) — 실제 분석관이라면 가진 신호를 다 쓸 것이므로,
// 라이브 UI에서는 사다리(P/PE/PEC)를 굳이 토글하지 않는다(사다리 비교는 evaluateInference의 몫).
const FULL_FEATURES = { proximity: true, encirclement: true, convergence: true };

// 결과 패널/지도 강조에서 "in-band 이벤트"를 뽑기 위한 시각화 전용 상수. inference.js §5.2의
// 고리형(ring) 커널을 그대로 미러링한 값이지만(peak 14km, sigma 11km, 문턱 0.15), 이건 표시용
// 필터일 뿐 softmax·encirclement·convergence 같은 실제 채점 로직은 전혀 재구현하지 않는다 —
// "어느 이벤트를 하이라이트할지" 정도만 결정한다.
const RING_PEAK_KM = 14;
const RING_SIGMA_KM = 11;
const IN_BAND_WEIGHT = 0.15;
function ringWeight(d) {
  const z = d - RING_PEAK_KM;
  return Math.exp(-(z * z) / (2 * RING_SIGMA_KM * RING_SIGMA_KM));
}
/** facility를 뒷받침하는 in-band 이벤트만 골라낸다(표시용). events는 이미 projectForInference()를 거친 것. */
function inBandEventsFor(facility, events) {
  if (!facility) return [];
  return events.filter((e) => ringWeight(haversineKm(facility.lat, facility.lon, e.lat, e.lon)) > IN_BAND_WEIGHT);
}

/** "01" 처럼 두 자리로 왼쪽을 0으로 채운다. String(n).padStart(w,"0")의 짧은 래퍼. */
const pad = (n, w) => String(n).padStart(w, "0");

// ── 부트: GeoJSON·facilities.json을 fetch하고, 코스 land test를 만들고, simulate()를 실행한다 ──
async function boot() {
  // index.html 기준 상대 경로. phase2/app/data/에 T1/M3-T0에서 이미 커밋되어 있다.
  const [ne50land, ne50coast, ne110land, facilitiesRaw] = await Promise.all([
    fetch("data/ne_50m_land.geojson").then((r) => r.json()),
    fetch("data/ne_50m_coastline.geojson").then((r) => r.json()),
    fetch("data/ne_110m_land.geojson").then((r) => r.json()),
    fetch("data/facilities.json").then((r) => r.json()),
  ]);

  // 이벤트 생성 시 안/밖 판정에 쓰는 코스(coarse) 육지 테스트. 화면 표시는 ne50land/ne50coast를
  // map.js에 그대로 넘겨 따로 쓴다(T1 주석대로 "생성용"과 "표시용"을 분리).
  const landTest = makeLandTest(ne110land);
  // withCampaigns:true — M3의 표적 추론 기능을 켠다(SPEC_M3 §4). facilities는 simulate()가
  // JSON.parse된 원본 객체를 그대로 기대한다(내부에서 .facilities로 배열을 꺼낸다).
  // evaluateInference(§5.3 재작성판)는 시드마다 스스로 simulate()를 다시 돌리므로(내부에서
  // 5개 시드를 파생), 같은 조립을 하는 simulateFn을 만들어 넘긴다 — inference.js는 손대지 않는다.
  const simulateFn = (seed) => simulate({ seed, landTest, facilities: facilitiesRaw, withCampaigns: true });
  const { events, periods, byDay, days, campaigns, facilities } = simulateFn(SEED);

  // byDay[day][orgIndex]의 전체 최댓값 — 카드/시간창의 스케일링 참고용으로 남겨둔다.
  let maxPerDay = 0;
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < ORGS.length; i++) {
      if (byDay[d][i] > maxPerDay) maxPerDay = byDay[d][i];
    }
  }

  runApp({
    events, periods, byDay, days, maxPerDay, campaigns, facilities, simulateFn,
    landGeo: ne50land, coastGeo: ne50coast,
    // M4 Fix2(진짜 requestRerun): 이 둘을 넘겨야 runApp 안에서도 org-view의 오버라이드로
    // simulate()를 직접 다시 돌릴 수 있다(boot()가 이미 fetch/변환해 둔 것을 재사용 — 다시
    // fetch하지 않는다).
    landTest, facilitiesRaw,
  });
}

function runApp({ events, periods, byDay, days, maxPerDay, campaigns, facilities, simulateFn, landGeo, coastGeo, landTest, facilitiesRaw }) {
  // ── DOM 참조 ─────────────────────────────────────────────────────────
  const mapEl = document.getElementById("map");
  const wac = document.getElementById("wac");
  const winStartEl = document.getElementById("win-start");
  const winEndEl = document.getElementById("win-end");
  const cellsEl = document.getElementById("cells");
  // 상태바의 "Cells 3" — 조직 개수도 지휘 계층 정보라 reveal이 꺼지면 블록째 숨긴다(Job1).
  const statCellsEl = document.getElementById("stat-cells");
  const resultsEl = document.getElementById("results");
  const feedEl = document.getElementById("feed");
  const bootEl = document.getElementById("boot");
  const rPosEl = document.getElementById("r-pos");
  const rSclEl = document.getElementById("r-scl");
  const dtgEl = document.getElementById("dtg");
  const sEvEl = document.getElementById("s-ev");
  const sDotEl = document.getElementById("s-dot");
  const sModeEl = document.getElementById("s-mode");
  const ppEl = document.getElementById("pp");
  const rvEl = document.getElementById("rv");
  const scopeBtnEl = document.getElementById("scope-btn");
  const scopeRadiusEl = document.getElementById("scope-radius");
  // ── i18n 대상 정적 라벨 DOM 참조 (M4-T1) ────────────────────────────────
  const rvLabelEl = document.getElementById("rv-label");
  const langToggleEl = document.getElementById("langtoggle");
  const zOutEl = document.getElementById("z-out");
  const zInEl = document.getElementById("z-in");
  const zWorldEl = document.getElementById("z-world");

  // ── 데이터 접근 seam (SPEC_M3 §6.2) ───────────────────────────────────
  // 이 앱의 모든 뷰는 이제부터 events 배열을 직접 filter/index하지 않고 queryEvents()만 부른다.
  // M4 Fix2: 재실행(rerun) 뒤 events 배열 자체가 통째로 새 참조로 바뀌므로, 이 색인들은 전부
  // let으로 두고 applyNewRun()에서 다시 만든다(createEventQuery(events)가 인자를 클로저로 붙잡아
  // 두기 때문에, events만 재대입해서는 자동으로 갱신되지 않는다 — queryEvents 자체를 다시 만들어야 한다).
  let queryEvents = createEventQuery(events).queryEvents;
  let facilitiesById = new Map(facilities.map((f) => [f.id, f]));
  // 답 배지(§answer-key 블록) 전용 색인 — campaign.eventIds로 좌표를 다시 찾아 centroid를 낼 때만 쓴다.
  let eventsById = new Map(events.map((e) => [e.id, e]));

  // ── M4 Fix2: 실제 재실행(requestRerun)이 앱 전체에 적용한 설정 ─────────────────────────
  // committedOverrides는 지금 지도/피드/ANL/결과 패널이 보고 있는 run을 만든 overrides다.
  // null이면 기본(§7 커밋된 데이터셋)과 완전히 같은 경로 — simulate()에 overrides를 아예 안 넘긴
  // 부팅 경로와 동일한 결과가 나온다(byte-identical 보장의 핵심).
  let committedOverrides = null;
  // 지도(map.js)·이 파일의 카드 표시(chrome())가 참조하는 "지금 유효한" org/directive 값.
  // overrides.orgs/overrides.directives는 organizations.js의 applyOrgOverrides/applyDirectiveOverrides가
  // 만든, ORGS/DIRECTIVES와 완전히 같은 모양(shape)의 배열/객체라 그대로 대체해 쓸 수 있다.
  let activeOrgs = ORGS;
  let activeDirectives = DIRECTIVES;
  // simulateFn을 committedOverrides를 반영하는 판으로 다시 정의한다(boot()이 넘겨준 것은 seed만
  // 받는 "기본 전용" 클로저였다). evaluateInference()는 시드마다 이 함수를 다시 부르므로, 여기서
  // committedOverrides를 클로저로 읽게 해두면 cachedEval도 "지금 적용된 설정" 기준으로 계산된다.
  simulateFn = (seed) => simulate({ seed, landTest, facilities: facilitiesRaw, withCampaigns: true, overrides: committedOverrides });

  // ── 시간창(time window) 상태 (SPEC_M3 §6.1) ───────────────────────────
  // 기본값: 전체 구간(days)의 "가장 최근 100일". 실 스트리밍 소스는 처음부터 끝까지 다 아는
  // 고정 데이터셋이 아니라 최근 구간만 들여다보는 게 자연스럽다는 게 타임라인 바를 없앤 이유.
  const DEFAULT_WINDOW_WIDTH = 100;
  let windowStart = Math.max(0, days - DEFAULT_WINDOW_WIDTH);
  let windowEnd = days - 1;
  let visibleEvents = []; // 현재 시간창 안의 이벤트(=queryEvents({window}) 결과) 캐시

  // ── 재생 상태 ────────────────────────────────────────────────────────
  let playing = false; // 기본은 정지 — "가장 최근 100일"을 보여주는 정적 화면이 기본 상태다.
  let speed = 7;
  let reveal = false;
  const visibleOrgs = new Set(ORGS.map((o) => o.key)); // 전부 보이는 상태로 시작

  // ── i18n: 언어와 무관하게 매 프레임 chrome()이 다시 그리는 값(EV/RAD 숫자, DTG, 카드 dir
  // 배지 등)은 그 안에서 t()를 그대로 부르면 다음 rAF에 자동으로 갱신된다. 여기서는 chrome()이
  // 건드리지 않는 "정적" 라벨만 모아 한 번에 다시 적용한다. 시뮬레이션 상태·시간창·스코프·
  // 선택은 이 함수가 절대 건드리지 않는다 — 텍스트만 바꾼다(SPEC_M4 §1.5).
  function applyI18n() {
    document.getElementById("lbl-seed").textContent = t("app.seed");
    document.getElementById("lbl-cells").textContent = t("app.cells");
    document.getElementById("lbl-events").textContent = t("app.events");
    document.getElementById("lbl-span").textContent = t("app.span");
    sModeEl.textContent = playing ? t("app.running") : t("app.hold");

    document.querySelectorAll("[data-view-btn]").forEach((btn) => {
      const key = { sim: "app.navSim", org: "app.navOrg", anl: "app.navAnl", dat: "app.navDat" }[btn.dataset.viewBtn];
      if (key) btn.textContent = t(key);
    });

    rvLabelEl.textContent = t("app.reveal");
    document.getElementById("lbl-cur").textContent = t("app.readoutCur");
    document.getElementById("lbl-zoom").textContent = t("app.readoutZoom");
    document.getElementById("lbl-proj").textContent = t("app.readoutProj");
    zWorldEl.textContent = t("app.zoomWorld");
    // "AO"(Area of Operations)는 두 언어에서 동일해 건드리지 않는다.
    zOutEl.setAttribute("aria-label", t("app.zoomOutAria"));
    zInEl.setAttribute("aria-label", t("app.zoomInAria"));
    scopeBtnEl.textContent = t("app.setScope");

    document.getElementById("lbl-activity-feed").textContent = t("app.activityFeed");
    ppEl.textContent = playing ? t("app.pause") : t("app.play");
    document.getElementById("lbl-timewindow").textContent = t("app.timeWindow");
    document.getElementById("lbl-win-start").textContent = t("app.winStart");
    document.getElementById("lbl-win-end").textContent = t("app.winEnd");

    // ph-org/ph-dat 정적 placeholder는 M4 scaffold에서 제거했다 — #view-org/#view-dat 내용은
    // 이제 org-view.js/data-view.js가 각자 자기 i18n 키(org.comingSoon/dat.comingSoon)로 그린다.

    // 조직 카드(#cells)의 EV/RAD 라벨 — 값(data-ev/data-rad)은 chrome()이 매 프레임 채우지만
    // 라벨 자체는 카드를 만들 때 한 번만 쓰인 정적 텍스트라 여기서 다시 적용해야 한다.
    cellsEl.querySelectorAll(".cell").forEach((cellEl) => {
      const rows = cellEl.querySelectorAll(".rows i");
      if (rows[0]) rows[0].textContent = t("app.cellEv");
      if (rows[1]) rows[1].textContent = t("app.cellRad");
    });
    // reveal 꺼짐 상태의 중립 요약(#cells-neutral) 라벨 — reveal 켜짐 상태에선 이 엘리먼트 자체가
    // DOM에 없으므로 querySelector가 null을 돌려주고 아무 일도 하지 않는다.
    const neutralEvLbl = cellsEl.querySelector("[data-lbl-neutral-ev]");
    const neutralFacLbl = cellsEl.querySelector("[data-lbl-neutral-fac]");
    if (neutralEvLbl) neutralEvLbl.textContent = t("app.cellsNeutralEvents");
    if (neutralFacLbl) neutralFacLbl.textContent = t("app.cellsNeutralFacilities");

    // 언어 토글 자체의 활성 표시(리드 악센트) — 라벨(한국어/English)은 항상 고정이다(SPEC_M4 §1.6).
    langToggleEl.querySelectorAll(".lang-btn").forEach((b) => {
      b.classList.toggle("on", b.dataset.lang === getLang());
    });
  }

  // ── 스코프(scope) 선택 상태 (SPEC_M3 §6.3) ────────────────────────────
  // 기본 스코프: NORTHWIND 거점 부근(여러 시설이 몰려 있는 지대), 반경 160km. 사용자가 드래그로
  // 다시 지정하기 전에도 결과 패널이 빈 화면이 아니라 실제 후보를 보여주도록 하는 시작값이다.
  let scope = { lat: ORGS[0].base[0], lon: ORGS[0].base[1], radiusKm: 160 };
  let scopeDraft = null; // 드래그 중 실시간 미리보기
  let scopeMode = false; // "Set scope" 버튼으로 진입하는 드래그 대기 상태
  let selectedFacilityId = null;
  let inferenceFrame = {}; // map.setFrame에 매 프레임 합쳐 넣을 스코프/시설/강조 레이어 데이터

  // ── M4-T2 상태 (SPEC_M4 §2): "스코프를 바꾸는 것"과 "실제로 추론을 돌리는 것"을 분리한다.
  // mode는 결과 패널이 지금 뭘 보여줘야 하는지를 결정한다:
  //   idle      — 아직 Analyze를 누르지 않음(또는 스코프/시간창이 바뀌어 이전 결과가 무효화됨)
  //   analyzed  — Analyze(또는 스캔 결과 선택)로 실제 inferTargets 결과가 있음
  //   scanning  — 주변 스캔(scan) 진행 중
  //   scanned   — 주변 스캔 완료, 상위 10개 표시 중
  let mode = "idle";
  let lastAnalyze = null; // { ranked, eventCount, warnings, radiusKm, scopeCenter, win } | null
  let lastScan = null; // { hits, scannedPoints, hitPoints } | null
  let scanProgress = null; // { done, total } | null
  // scan.js의 격자점+시간창 단위 캐시. 같은 (격자점, 시간창) 조합이면 inferTargets를 다시 돌리지
  // 않는다(SPEC "cache per (viewport, window)") — 세션 동안 계속 누적해도 격자점당 20바이트
  // 남짓이라 메모리 부담이 없다.
  const scanCache = new Map();

  // 직전(§5.3 재작성판) evaluateInference 결과 — 결과 패널의 "오경보율 문턱에서의 탐지율" 참고값으로
  // 1회만 계산해 캐싱한다. evaluateInference는 5개 시드를 스스로 파생해 다시 simulate()를 돌리므로
  // (inference.js는 손대지 않고, simulateFn만 넘긴다) 약간의 시간이 걸릴 수 있어 부팅 이후 한 박자
  // 늦게(setTimeout) 계산하고, 끝나면 결과 패널을 다시 그린다.
  let cachedEval = null; // { operatingFalseAlarmRate, detection, detectionUnmatched, unmatchedShare }
  function runCachedEvaluation() {
    try {
      const evalResult = evaluateInference({ simulateFn, seed: SEED });
      const pec = evalResult.runs.PEC;
      cachedEval = {
        // §5.3 재작성판: 문턱 자체가 "통제 구간 오경보율 10%"가 되도록 잡히므로, 오경보율은
        // 측정치가 아니라 상수(FALSE_ALARM_TARGET_RATE=0.1)다 — 그 문턱에서의 탐지율이 실제 측정치.
        operatingFalseAlarmRate: 0.1,
        // 대표값은 반드시 밀도를 맞춘 쪽(§5.3 "Density-match the controls")이다. 맞추지 않은
        // 수치는 캠페인 창이 그냥 더 붐벼서 이긴 몫을 포함하므로 방법을 과대평가한다
        // (측정: 17.0% -> 14.5%). 과대평가 값을 대표로 걸면 이 프로젝트가 고치려는 바로 그
        // 실수 - 기준선 없는 성능 숫자 - 를 UI에서 되풀이하게 된다.
        detection: pec.detectionAt10FARMatched,
        detectionUnmatched: pec.detectionAt10FAR,
        unmatchedShare: pec.unmatchedCampaignShare,
      };
      renderResults(); // ranked 자체는 그대로다 — evaluation 참고값만 새로 붙여 다시 그린다.
    } catch (err) {
      console.error("evaluateInference 실패 — 결과 패널에 참고 지표를 표시하지 않는다.", err);
    }
  }
  setTimeout(runCachedEvaluation, 0);

  // ══════════════════════════════════════════════════════════════════════════════════
  // M4 Fix2 — 진짜 재실행(requestRerun). org-view.js §3.2/§3.3의 "적용(apply)" 버튼이 부르는
  // 실제 통로. 예전 viewDeps.requestRerun 스텁은 seed만 받아 simulate()를 한 번 더 돌리고
  // 결과를 버렸다(org-view는 자기 전용 파이프라인으로 따로 미리보기를 계산했다) — 그래서 지도·
  // 피드·시간창·ANL 뷰·결과 패널은 org-view에서 뭘 바꾸든 항상 기본 설정 그대로였다.
  //
  // 이 함수는 overrides({orgs, directives, noiseMultiplier} | null — organizations.js의
  // applyOrgOverrides/applyDirectiveOverrides가 만드는 것과 정확히 같은 모양, simulate()가
  // 그대로 먹는다)로 simulate()를 다시 돌리고, 그 결과를 앱 상태 전체에 갈아 끼운다
  // ("hot-swap") — map.js/window-control.js/analysis-view.js/results-panel.js 중 어느 것도
  // 새 데이터를 몰라서 낡은 화면을 계속 보여주는 일이 없게 한다.
  // ══════════════════════════════════════════════════════════════════════════════════
  let rerunning = false;
  const rerunBannerEl = document.getElementById("rerun-banner");
  function setRerunBanner(visible) {
    if (!rerunBannerEl) return;
    if (visible) rerunBannerEl.textContent = t("app.rerunBanner");
    rerunBannerEl.hidden = !visible;
  }

  /**
   * simulate()가 실제로 만든 새 run을 앱 상태 전체에 반영한다. 정답지 분리(§Constraints)
   * 재확인: 재실행은 "다시 답이 샐 수 있는 새 기회"이므로, 이전 Analyze/Scan 결과(랭킹)를
   * 전부 무효화해 낡은 순위가 새 run 위에서 "지금 것"인 척 남지 않게 한다.
   * @param {{events,periods,byDay,days,campaigns,facilities}} run - simulate()의 반환값
   * @param {object|null} overrides - 이번 run을 만든 오버라이드(null이면 기본)
   */
  function applyNewRun(run, overrides) {
    committedOverrides = overrides;
    activeOrgs = overrides && overrides.orgs ? overrides.orgs : ORGS;
    activeDirectives = overrides && overrides.directives ? overrides.directives : DIRECTIVES;

    events = run.events;
    periods = run.periods;
    days = run.days;
    campaigns = run.campaigns;
    facilities = run.facilities;

    // events/facilities가 통째로 새 참조로 바뀌었으므로, 그 위에 얹힌 색인/쿼리 seam도 다시 만든다.
    queryEvents = createEventQuery(events).queryEvents;
    facilitiesById = new Map(facilities.map((f) => [f.id, f]));
    eventsById = new Map(events.map((e) => [e.id, e]));

    // 이전 Analyze/Scan 결과 무효화 — "재실행 뒤 낡은 랭킹이 지금 것처럼 보이면 안 된다".
    mode = "idle";
    lastAnalyze = null;
    lastScan = null;
    scanProgress = null;
    scanCache.clear();
    selectedFacilityId = null;
    scopeDraft = null;
    cachedEval = null;

    // reveal 카드/중립 요약 — org 개수 자체는 안 바뀌지만, 새 periods/facilities 기준으로
    // 다시 그려야 EV/RAD/directive 배지가 새 run을 반영한다(Job1 규칙은 그대로 유지: reveal
    // 꺼짐이면 여전히 중립 요약 두 줄뿐).
    renderCellsShell();
    applyI18n();
    statCellsEl.hidden = !reveal;

    // 시간창은 리셋하지 않는다 — 사용자가 보고 있던 구간(day 범위)은 그대로 두고, 그 구간 안의
    // "내용"만 새 run 것으로 바꾼다. setWindow가 days 범위로 다시 clamp하고 visibleEvents/입력창을
    // 새로 채운 뒤 refreshScopePreview()까지 불러 지도·결과 패널을 갱신한다.
    setWindow(windowStart, windowEnd);

    // org-view/data-view가 들고 있는 deps.result도 새 run을 가리키게 한다(§seam 계약).
    viewDeps.result = { events, campaigns, facilities, periods, days, startDate: D0 };
    // ANL 뷰는 캐싱된 result를 새로 계산하도록 무효화한다(이미 한 번 진입했었다면 즉시 다시 그린다).
    anlView.setData({ events, periods });
    // DAT 뷰도 같은 이유로 갈아탄다 — 표가 옛 run을 계속 보여주면 낡은 숫자가 현재인 척하게 된다.
    datView.setData({ events, startDate: D0 });
    // notifyViewStateSubscribers()는 위 setWindow -> refreshScopePreview()가 이미 불렀다(중복 호출 없음).

    setTimeout(runCachedEvaluation, 0);
  }

  /**
   * 실제 재실행 진입점. overrides는 simulate()가 바로 먹는 모양이거나 null(기본으로 되돌리기).
   * ~3초 걸리는 동기 simulate() 호출 앞에 setTimeout(fn, 0)을 둬서, 무거운 계산이 시작되기 전에
   * "재실행 중" 배너가 실제로 한 프레임 그려지게 한다 — org-view.js §3.3 sweep이 6번의 전체
   * 사이클 사이에 쓰는 것과 같은 양보 패턴(완전한 응답성은 아니지만 최소한 "진행 중"이라는
   * 사실은 화면에 먼저 박힌다). requestAnimationFrame이 아니라 setTimeout을 쓰는 이유: rAF는
   * 브라우저 탭/프리뷰 창이 화면에 보이지 않는 동안 아예 멈춘다(스로틀이 아니라 정지) — 사용자가
   * 다른 탭을 보는 사이 "적용" 버튼을 누르면 그 순간 콜백이 영원히 안 오는 걸 실제로 겪었다.
   * setTimeout은 백그라운드 탭에서도(스로틀은 되어도) 결국 실행되므로 이 경로에는 그게 맞다.
   * @param {object|null} overrides
   * @returns {Promise<{events,periods,campaigns,facilities,days,timingMs}|null>} 적용된 새 run
   *   (org-view가 자기 미리보기 패널의 점수 계산에 그대로 재사용한다 — simulate()를 또 부르지 않는다).
   */
  function performRerun(overrides) {
    if (rerunning) return Promise.resolve(null);
    rerunning = true;
    setRerunBanner(true);
    return new Promise((resolve) => {
      setTimeout(() => {
        setTimeout(() => {
          let out = null;
          try {
            const t0 = performance.now();
            const run = simulate({ seed: SEED, landTest, facilities: facilitiesRaw, withCampaigns: true, overrides });
            const timingMs = performance.now() - t0;
            applyNewRun(run, overrides);
            out = { ...run, timingMs };
          } catch (err) {
            console.error("[requestRerun] 재실행 실패 — 앱 상태는 이전 run에 그대로 남는다.", err);
          } finally {
            rerunning = false;
            setRerunBanner(false);
            resolve(out);
          }
        }, 0);
      }, 0);
    });
  }

  const resultsPanel = createResultsPanel(resultsEl, {
    onSelectCandidate: (fid) => {
      selectedFacilityId = selectedFacilityId === fid ? null : fid;
      refreshScopePreview();
    },
    onAnalyze: runAnalyze,
    onScan: runScanAction,
    onSelectScanHit,
  });

  // ══════════════════════════════════════════════════════════════════════════════════
  // 정답지(scoring-only) 블록 — SPEC_M3 §3 ground truth separation, 절대 규칙.
  // 이 함수는 오직 결과 패널의 "ANSWER KEY" 배지(§6.4, reveal 토글 전용)를 그리기 위해서만
  // campaigns를 읽는다. 반환값은 renderResults() 안에서 resultsPanel.render()로만
  // 흘러들어가며, 그 위의 추론 경로(projectForInference -> scopeFacilities -> inferTargets)
  // 어디에도 절대 전달되지 않는다. 점수·순위·후보 필터링에 이 값이 섞이면 안 된다.
  //
  // 정의(현재 스코프+시간창에서 "진짜" 표적들): 이벤트 centroid가 스코프 원 안에 들고, 캠페인
  // 기간 [startDay,endDay]가 현재 시간창과 겹치는 모든 캠페인의 targetId. 여러 캠페인이 동시에
  // 활성일 수 있으므로 0개/1개/여러 개 다 나올 수 있다 — "정확히 하나"라고 가정하지 않는다.
  // ══════════════════════════════════════════════════════════════════════════════════
  function computeAnswerKeyFacilityIds(scopeActive, win) {
    const ids = new Set();
    for (const camp of campaigns) {
      const timeOverlaps = camp.startDay <= win.endDay && camp.endDay >= win.startDay;
      if (!timeOverlaps) continue;
      const campEvents = camp.eventIds.map((id) => eventsById.get(id)).filter(Boolean);
      if (!campEvents.length) continue;
      // centroid: 캠페인 이벤트 좌표의 산술 평균 (§5.3 control-window 구성이 쓰는 것과 같은 정의).
      const clat = campEvents.reduce((s, e) => s + e.lat, 0) / campEvents.length;
      const clon = campEvents.reduce((s, e) => s + e.lon, 0) / campEvents.length;
      const distKm = haversineKm(scopeActive.lat, scopeActive.lon, clat, clon);
      if (distKm <= scopeActive.radiusKm) ids.add(camp.targetId);
    }
    return ids;
  }

  // scopePreview: Analyze를 누르기 전에도 항상 최신으로 유지하는 "가벼운" 스코프 요약(§2 항목2
  // "a live count of events in scope"). inferTargets를 돌리지 않으므로 스코프/시간창을 매 프레임
  // 드래그로 바꿔도 비용이 크지 않다.
  let scopePreview = { eventCount: 0, candidateCount: 0, radiusKm: 0 };

  // ── M4 seam(org/data-view, tour)이 구독하는 "지금 시간창/스코프" 상태 ───────────────────
  // 이 앱은 window/scope를 여러 곳(드래그, 반경 입력, Analyze, 스캔 결과 선택, 재생 루프)에서
  // 바꾸는데, 그 모든 경로가 결국 refreshScopePreview()를 거친다 — 그래서 알림도 그 한 곳에서만
  // 보낸다(중복 배선 없이 "상태가 실제로 갱신됐다"는 한 지점).
  const viewStateSubscribers = new Set();
  function getViewState() {
    return { window: { startDay: windowStart, endDay: windowEnd }, scope: scopeDraft || scope };
  }
  function notifyViewStateSubscribers() {
    const state = getViewState();
    viewStateSubscribers.forEach((cb) => {
      try {
        cb(state);
      } catch (err) {
        console.error("[view deps] onStateChange 구독자에서 예외 발생", err);
      }
    });
  }

  /**
   * 스코프/시간창이 바뀔 때마다 부른다. 비용이 큰 inferTargets는 절대 여기서 돌리지 않는다(§2
   * 항목3 "runs when the user asks for it, not continuously") — 대신
   *   1) 지도의 후보 시설 마커·강조 이벤트(candidateFacilities/supportingEvents)를 갱신하고
   *      ("candidate facilities are shown by default" — 답이 아니라 답의 공간이므로 Analyze 전에도 보인다)
   *   2) 결과 패널의 "범위 안 사건 수" 미리보기를 갱신하고
   *   3) 스코프/시간창이 "마지막 Analyze 결과"와 달라졌으면 그 결과를 무효화한다(stale 방지).
   */
  function refreshScopePreview() {
    const active = scopeDraft || scope;
    const win = { startDay: windowStart, endDay: windowEnd };

    // 이전 Analyze 결과가 지금 스코프/시간창과 더 이상 일치하지 않으면 버린다 — 화면에 낡은
    // 순위가 "지금 스코프의 답"인 것처럼 남아 있으면 안 된다(SPEC_M4 §3.1의 stale 원칙과 같은 정신).
    if (mode === "analyzed" && lastAnalyze) {
      const c = lastAnalyze.scopeCenter;
      const w = lastAnalyze.win;
      const stale =
        c.lat !== active.lat || c.lon !== active.lon || c.radiusKm !== active.radiusKm ||
        w.startDay !== win.startDay || w.endDay !== win.endDay;
      if (stale) {
        mode = "idle";
        lastAnalyze = null;
        selectedFacilityId = null;
      }
    }

    // 원본(org 포함) 이벤트는 seam(queryEvents) 하나로만 얻는다 — 여기서 events 배열을 직접 filter하지 않는다.
    const rawScoped = queryEvents({ scope: active, window: win });
    const scopedFacilities = scopeFacilities(facilities, active);
    // 정답지 분리 경계: org 제거는 여기 한 곳에서만 한다. 강조 표시(supportingEvents)에도 이
    // projected 결과만 쓴다 — 지도 어디에도 org 필드가 닿지 않는다.
    const projected = projectForInference(rawScoped);
    const supportingEvents = selectedFacilityId
      ? inBandEventsFor(facilitiesById.get(selectedFacilityId), projected)
      : [];

    inferenceFrame = {
      scope,
      scopeDraft,
      // §2 항목1 "candidate facilities stay visible by default" — Analyze를 누르기 전에도 항상 보인다.
      candidateFacilities: scopedFacilities,
      selectedFacilityId,
      supportingEvents,
    };
    scopePreview = {
      eventCount: rawScoped.length,
      candidateCount: scopedFacilities.length,
      radiusKm: active.radiusKm,
    };
    renderResults();
    notifyViewStateSubscribers(); // org/data-view·tour가 구독 중이면 최신 window/scope를 알린다.
  }

  /** Analyze — 명시적 버튼(§2 항목3). 이 함수 안에서만 inferTargets(비용이 큰 실제 추론)를 돌린다. */
  function runAnalyze() {
    const active = scopeDraft || scope;
    const win = { startDay: windowStart, endDay: windowEnd };
    const rawScoped = queryEvents({ scope: active, window: win });
    const projected = projectForInference(rawScoped);
    const scopedFacilities = scopeFacilities(facilities, active);
    const result = inferTargets({ events: projected, facilities: scopedFacilities, features: FULL_FEATURES });
    lastAnalyze = {
      ranked: result.ranked,
      eventCount: result.eventCount,
      warnings: result.warnings,
      radiusKm: active.radiusKm,
      scopeCenter: active,
      win,
    };
    mode = "analyzed";
    selectedFacilityId = null;
    refreshScopePreview(); // candidateFacilities/맵을 다시 맞추고 결과 패널을 그린다.
  }

  /** Scan — 지금 화면(viewport)을 격자로 훑는다(§2 항목4). 비동기라 재생/입력을 막지 않는다. */
  async function runScanAction() {
    if (mode === "scanning") return; // 중복 실행 방지
    mode = "scanning";
    scanProgress = { done: 0, total: 0 };
    renderResults();

    const bounds = map.getViewportBounds();
    const { points } = computeScanGrid(bounds);
    const win = { startDay: windowStart, endDay: windowEnd };
    const { hits } = await runScan({
      points,
      window: win,
      queryEvents,
      facilities,
      cache: scanCache,
      onProgress: (done, total) => {
        scanProgress = { done, total };
        renderResults();
      },
    });
    lastScan = { hits };
    scanProgress = null;
    mode = "scanned";
    renderResults();
  }

  /** 스캔 결과 행 선택 — 스코프를 그 창으로 옮기고, 스캔 도중 이미 계산해 둔 순위를 그대로 보여준다
   * (다시 inferTargets를 돌리지 않는다 — "스캔은 닫힌 결과가 아니라 더 들여다볼 출발점"이라는
   * §2 항목4 요건). 시간창(window)은 스캔이 "지금 시간창" 고정으로 훑은 것이라 건드리지 않는다.
   */
  function onSelectScanHit(hit) {
    scope = { lat: hit.scope.lat, lon: hit.scope.lon, radiusKm: hit.scope.radiusKm };
    scopeDraft = null;
    selectedFacilityId = null;
    lastAnalyze = {
      ranked: hit.ranked,
      eventCount: hit.eventCount,
      warnings: hit.warnings,
      radiusKm: hit.scope.radiusKm,
      scopeCenter: hit.scope,
      win: { startDay: windowStart, endDay: windowEnd },
    };
    mode = "analyzed";
    refreshScopePreview();
  }

  /** 지금 상태(mode/scopePreview/lastAnalyze/lastScan/scanProgress)를 결과 패널에 그대로 반영한다. */
  function renderResults() {
    const active = scopeDraft || scope;
    const win = { startDay: windowStart, endDay: windowEnd };
    // reveal이 꺼져 있으면 answer-key 계산 자체를 하지 않고 null을 넘긴다 — results-panel.js는
    // revealTargetIds가 null이면 답 관련 마크업을 아예 만들지 않으므로, DOM에도 그 어떤 형태로도
    // 정답이 새지 않는다(prop으로도, class로도, 숨겨진 텍스트로도).
    const revealTargetIds =
      reveal && mode === "analyzed" && lastAnalyze ? computeAnswerKeyFacilityIds(active, win) : null;

    resultsPanel.render({
      mode,
      scopePreview,
      analyze: lastAnalyze
        ? { ...lastAnalyze, facilitiesById, selectedFacilityId, evaluation: cachedEval, revealTargetIds }
        : null,
      scan: { progress: scanProgress, hits: lastScan ? lastScan.hits : [], facilitiesById, selectedFacilityId },
    });
  }

  // ── 시간창이 바뀔 때 공통으로 해야 할 일 ───────────────────────────────
  function setWindow(newStart, newEnd) {
    const s = Math.max(0, Math.min(days - 1, Math.round(newStart)));
    const e = Math.max(s, Math.min(days - 1, Math.round(newEnd)));
    windowStart = s;
    windowEnd = e;
    visibleEvents = queryEvents({ window: { startDay: windowStart, endDay: windowEnd } });
    winStartEl.value = windowStart;
    winEndEl.value = windowEnd;
    refreshScopePreview(); // 스코프 안 이벤트 수는 시간창에도 좌우된다.
  }

  // ── 지도 hover 좌표 판독기 ────────────────────────────────────────────
  // deck.gl의 onHover(info)는 지도 밖이면 info.coordinate가 없다.
  function onHover(info) {
    if (!info || !info.coordinate) {
      rPosEl.textContent = "--.-- -  ---.-- -";
      return;
    }
    const [lo, la] = info.coordinate;
    rPosEl.textContent =
      Math.abs(la).toFixed(2) + " " + (la < 0 ? "S" : "N") + "  " +
      Math.abs(lo).toFixed(2) + " " + (lo < 0 ? "W" : "E");
  }

  const map = createMap(mapEl, {
    onHover,
    onFacilityClick: (fid) => {
      selectedFacilityId = selectedFacilityId === fid ? null : fid;
      refreshScopePreview();
    },
    landGeo,
    coastGeo,
  });

  // ── 스코프 선택: 클릭 후 바깥으로 드래그해 반경을 잡는다 (SPEC_M3 §6.3) ────────────
  // deck.gl의 팬/줌 컨트롤러가 같은 캔버스에서 드래그를 가로채므로, 캡처(capture) 단계에서
  // stopPropagation으로 먼저 가로채 deck.gl에 도달하기 전에 스코프 드래그로 처리한다.
  scopeBtnEl.onclick = () => {
    scopeMode = !scopeMode;
    scopeBtnEl.classList.toggle("on", scopeMode);
    mapEl.classList.toggle("scope-armed", scopeMode);
  };

  mapEl.addEventListener(
    "pointerdown",
    (e) => {
      if (!scopeMode) return;
      e.stopPropagation();
      e.preventDefault();
      const rect = mapEl.getBoundingClientRect();
      const x0 = e.clientX - rect.left;
      const y0 = e.clientY - rect.top;
      const [lon, lat] = map.unproject(x0, y0);
      scopeDraft = { lat, lon, radiusKm: 0 };
      refreshScopePreview();

      const move = (ev) => {
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const [lon2, lat2] = map.unproject(x, y);
        scopeDraft.radiusKm = haversineKm(lat, lon, lat2, lon2);
        scopeRadiusEl.value = Math.round(scopeDraft.radiusKm);
        refreshScopePreview();
      };
      const up = () => {
        removeEventListener("pointermove", move, true);
        removeEventListener("pointerup", up, true);
        if (scopeDraft && scopeDraft.radiusKm > 1) scope = scopeDraft;
        scopeDraft = null;
        scopeMode = false;
        scopeBtnEl.classList.remove("on");
        mapEl.classList.remove("scope-armed");
        refreshScopePreview();
      };
      addEventListener("pointermove", move, true);
      addEventListener("pointerup", up, true);
    },
    true // capture — deck.gl 컨트롤러보다 먼저 받는다
  );

  scopeRadiusEl.value = scope.radiusKm;
  scopeRadiusEl.onchange = () => {
    const v = Number(scopeRadiusEl.value);
    if (Number.isFinite(v) && v > 0) {
      scope = { ...scope, radiusKm: v };
      refreshScopePreview();
    }
  };

  // ── 시간창 컨트롤 (SPEC_M3 §6.1) ─────────────────────────────────────
  const windowControl = createWindowControl(wac, {
    onChange: ({ windowStart: s, windowEnd: e }) => setWindow(s, e),
  });
  winStartEl.onchange = () => setWindow(Number(winStartEl.value), windowEnd);
  winEndEl.onchange = () => setWindow(windowStart, Number(winEndEl.value));

  // ── 조직 카드 (#cells) — reveal에 따라 완전히 다른 두 마크업을 그린다 (SPEC_M4 §2 Job1) ──
  // reveal ON: 조직별 카드(이름·EV·RAD·directive 배지) — 프로토타입 §404-412 마크업 그대로.
  // reveal OFF: 조직 신원·개수·반경을 전혀 드러내지 않는 중립 요약 두 줄뿐. DOM에 org.key 문자열
  // 자체가 아예 만들어지지 않는다(class="off"류의 CSS 은폐가 아니라 엘리먼트를 통째로 안 만든다).
  // cellEls는 reveal이 켜져 있을 때만 실제 카드 엘리먼트를 담고, 꺼져 있으면 빈 배열이다 —
  // chrome()이 매 프레임 이 배열 길이로 "지금 뭘 채워야 하는지" 판단한다.
  let cellEls = [];

  function renderCellsShell() {
    cellsEl.innerHTML = "";
    if (reveal) {
      // 프로토타입 §404-412의 마크업을 그대로 포팅. data-ev/data-rad/data-dir을 이후 chrome()에서 갱신.
      cellEls = ORGS.map((org) => {
        const d = document.createElement("div");
        d.className = "cell";
        d.tabIndex = 0;
        d.style.setProperty("--c", ORG_COLORS[org.key]);
        d.innerHTML =
          '<div class="nm">' + org.key + '</div>' +
          '<div class="rows">' +
            '<div><i>EV</i> <span data-ev>000</span></div>' +
            '<div><i>RAD</i> <span data-rad>000</span> KM</div>' +
          '</div>' +
          '<div class="dir" data-dir hidden></div>';
        const toggle = () => {
          if (visibleOrgs.has(org.key)) visibleOrgs.delete(org.key);
          else visibleOrgs.add(org.key);
          d.classList.toggle("off", !visibleOrgs.has(org.key));
        };
        d.onclick = toggle;
        d.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        };
        cellsEl.appendChild(d);
        return d;
      });
    } else {
      // 중립 요약 — "분석관이 실제로 가진" 두 수치만. 값은 chrome()이 매 프레임 채운다.
      cellEls = [];
      const d = document.createElement("div");
      d.className = "cells-neutral";
      d.innerHTML =
        '<div class="cells-neutral-row"><i data-lbl-neutral-ev></i> <span data-neutral-ev>0000</span></div>' +
        '<div class="cells-neutral-row"><i data-lbl-neutral-fac></i> <span data-neutral-fac>00</span></div>';
      cellsEl.appendChild(d);
      d.querySelector("[data-lbl-neutral-ev]").textContent = t("app.cellsNeutralEvents");
      d.querySelector("[data-lbl-neutral-fac]").textContent = t("app.cellsNeutralFacilities");
    }
  }
  renderCellsShell();
  // 부팅 시 기본값은 reveal=false이므로, 조직 개수를 드러내는 상태바 "Cells 3"도 처음부터 숨긴다
  // (이후로는 rvEl.onclick이 토글마다 이 값을 맞춰준다).
  statCellsEl.hidden = !reveal;

  // ── DTG(date-time-group) 문자열. 프로토타입 dtgs()와 동일한 형식(임의의 "시각"을 day*7%24로 흉내). ─
  function dtgString(d) {
    const t = new Date(D0 + d * 86400000);
    return (
      pad(t.getUTCDate(), 2) + pad((d * 7) % 24, 2) + "00Z " +
      MON[t.getUTCMonth()] + " " + String(t.getUTCFullYear()).slice(2)
    );
  }

  // ── 크롬(chrome) 갱신: 상태바, 조직 카드, 활동 피드. 프로토타입 chrome()의 포팅. ──────────
  // M3-T3부터: "오늘까지 누적"이 아니라 "지금 시간창 안"을 기준으로 카드/피드를 채운다(§6.1/§6.2) —
  // 스트리밍 소스는 전체 누적치를 free로 주지 않는다는 게 타임라인을 없앤 전제다.
  function chrome() {
    const day = windowEnd; // "지금"은 시간창의 오른쪽 끝으로 정의한다(재생은 이 끝을 밀어낸다).
    dtgEl.textContent = dtgString(day);
    sEvEl.textContent = pad(visibleEvents.length, 4);

    // reveal ON: 조직별 카드(EV/RAD/directive)를 채운다. reveal OFF: cellEls는 비어 있고(위
    // renderCellsShell 참고) 대신 중립 요약 두 수치(시간창 내 전체 사건 수, 스코프 내 후보 시설
    // 수)만 채운다 — 어느 쪽도 org 이름/개수/반경을 드러내지 않는다(Job1).
    if (reveal) {
      const cnt = Object.fromEntries(ORGS.map((o) => [o.key, 0]));
      visibleEvents.forEach((e) => { cnt[e.org] = (cnt[e.org] || 0) + 1; });

      ORGS.forEach((org, i) => {
        const p = periods.find((q) => q.org === org.key && day >= q.startDay && day < q.endDay);
        const directiveKey = p ? p.directive : "CONSOLIDATE"; // 활성 기간이 없을 때의 폴백. map.js DEFAULT_DIRECTIVE와 동일 규칙.
        // M4 Fix2: 재실행(rerun)으로 org-view §12.1 신호 강도가 바뀌었을 수 있으므로, 반경/지침
        // 배율은 정적 import(ORGS/DIRECTIVES)가 아니라 activeOrgs/activeDirectives에서 읽는다.
        // activeOrgs는 applyOrgOverrides()가 만든, ORGS와 완전히 같은 순서·키의 배열이라 같은
        // index i로 대응하는 org를 그대로 집을 수 있다.
        const liveOrg = activeOrgs[i];
        const dirDef = activeDirectives[directiveKey];
        const el = cellEls[i];
        el.querySelector("[data-ev]").textContent = pad(cnt[org.key], 3);
        el.querySelector("[data-rad]").textContent = pad(Math.round(liveOrg.baseRadius * dirDef.radiusMult), 3);
        const dd = el.querySelector("[data-dir]");
        dd.hidden = !reveal;
        // directive 이름(p.directive, 예: EXPAND)은 데이터셋 값이라 언어와 무관하게 원문 그대로 둔다
        // (SPEC_M4 §1.2) — "{days}일 남음"/"{days}D LEFT" 부분만 t()로 번역한다.
        if (reveal && p) dd.textContent = p.directive + " · " + t("app.daysLeft", { days: pad(p.endDay - day, 3) });
      });
    } else {
      const neutralEv = cellsEl.querySelector("[data-neutral-ev]");
      const neutralFac = cellsEl.querySelector("[data-neutral-fac]");
      if (neutralEv) neutralEv.textContent = pad(visibleEvents.length, 4);
      if (neutralFac) neutralFac.textContent = pad(scopePreview.candidateCount, 2);
    }

    // 피드: 시간창 안 이벤트 중 최신 11개(day 내림차순)를 보여준다. 이벤트 수가 수천 개라도
    // 창 하나에 든 것만 다루므로 매 프레임 다시 만들어도 가볍다(누적 포인터가 더 이상 필요 없다).
    // reveal OFF: 조직 태그(e.org)는 좌표만큼이나 "이 사건을 누가 저질렀는가" — 바로 이 도구가
    // 분석관에게 추론하라고 요구하는 답이다. 그래서 색만 지우는 게 아니라 <em> 마커 안의 org
    // 텍스트 자체를 만들지 않는다(빈 문자열도 아니고 DOM 노드가 없음). 대신 지도의 "중립 사건색"
    // (RGB.evt/HEX.evt)과 같은 값으로 칠한 무표정 점 마커(•)만 남겨 지도-피드 시각 언어를 맞춘다.
    // reveal ON: 기존처럼 조직 약칭(4자)을 org 색으로 그대로 보여준다(Job1 이전 동작과 동일).
    const recent = visibleEvents.slice().sort((a, b) => b.day - a.day).slice(0, 11);
    feedEl.innerHTML = recent
      .map((e) => {
        const markerHtml = reveal
          ? '<em style="color:' + ORG_COLORS[e.org] + '">' + e.org.slice(0, 4) + "</em> "
          : '<em style="color:' + HEX.evt + '">•</em> ';
        // target을 5자로 자르면(예: "infrastructure" -> "INFRA") 단어 중간이 잘린 채 그대로
        // 끝나버려 무슨 말인지 알 수 없다(활동 피드 잘림 버그). .feed div는 이미 CSS에서
        // white-space:nowrap + overflow:hidden + text-overflow:ellipsis를 갖고 있으니(위 CSS
        // 참고) 여기서는 전체 단어를 그대로 넣고, 패널 폭보다 길 때만 CSS가 "…"으로 끝맺게
        // 맡긴다 — 줄바꿈은 한 사건 = 한 줄이라는 피드의 터미널식 레이아웃을 깨뜨리므로 쓰지 않는다.
        return (
          "<div>" + markerHtml +
          Math.abs(e.lat).toFixed(1) + (e.lat < 0 ? "S" : "N") + " " +
          e.lon.toFixed(1) + "E · " + e.method.toUpperCase() + " · " + e.target.toUpperCase() + "</div>"
        );
      })
      .join("");
  }

  // ── 재생 루프 ─────────────────────────────────────────────────────────
  // 프로토타입의 acc2 누산기(accumulator)와 동일: speed(1/7/30배속)를 프레임마다 조금씩 쌓다가
  // 1을 넘을 때 시간창을 하루씩 밀어낸다. M3-T3부터는 "day를 전진시켜 더 많이 드러내는" 게 아니라
  // "시간창 자체를 미래로 슬라이드"한다(§6.1) — 창 너비는 항상 그대로 유지된다.
  let acc2 = 0;
  function loop() {
    if (playing) {
      acc2 += speed / 2.2;
      let steps = 0;
      while (acc2 >= 1) {
        steps++;
        acc2--;
      }
      if (steps > 0) {
        const width = windowEnd - windowStart;
        let newEnd = windowEnd + steps;
        let newStart = windowStart + steps;
        if (newEnd > days - 1) {
          // 끝에 닿으면 처음으로 되감기(프로토타입 rewind(0)와 같은 정신).
          newStart = 0;
          newEnd = Math.min(days - 1, width);
        }
        setWindow(newStart, newEnd);
      }
    }

    const day = windowEnd;
    // M4 Fix2: activeOrgs/activeDirectives — 기본은 ORGS/DIRECTIVES와 참조가 같아(재실행 전) 지도의
    // 프레임 캐시(map.js derivedCache)가 그대로 재사용된다. 재실행 뒤에만 다른 참조로 바뀐다.
    map.setFrame({ day, events: visibleEvents, orgs: activeOrgs, directives: activeDirectives, periods, reveal, visibleOrgs, ...inferenceFrame });
    windowControl.draw({ windowStart, windowEnd, days });
    chrome();

    requestAnimationFrame(loop);
  }

  // ── 시간창 캔버스 리사이즈(DPR 대응) ───────────────────────────────────
  function resizeWindowCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = wac.getBoundingClientRect();
    wac.width = Math.max(200, r.width) * dpr;
    wac.height = Math.max(28, r.height) * dpr;
    wac.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeWindowCanvas();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeWindowCanvas, 100);
  });
  if (window.ResizeObserver) new ResizeObserver(() => resizeWindowCanvas()).observe(wac.parentElement);

  // ── 줌 프리셋 / 컨트롤 ────────────────────────────────────────────────
  // 프로토타입은 px/deg 카메라(cam.z)를 썼지만 deck.gl은 zoom level을 쓴다(BUILD_PLAN T4 노트,
  // index.html 하단 readout 라벨도 T5에서 ZOOM/WEB-MERCATOR로 바꿨다).
  function updateScaleReadout() {
    rSclEl.textContent = map.getViewState().zoom.toFixed(1);
  }
  document.getElementById("z-world").onclick = () => {
    map.setView({ zoom: 0.3, longitude: 0, latitude: 20 });
    updateScaleReadout();
  };
  document.getElementById("z-ao").onclick = () => {
    map.setView({ zoom: 3, longitude: 120, latitude: -5 });
    updateScaleReadout();
  };
  document.getElementById("z-in").onclick = () => {
    map.setView({ zoom: map.getViewState().zoom + 0.5 });
    updateScaleReadout();
  };
  document.getElementById("z-out").onclick = () => {
    map.setView({ zoom: map.getViewState().zoom - 0.5 });
    updateScaleReadout();
  };
  // deck.gl 컨트롤러가 마우스 휠/드래그로 직접 zoom을 바꿀 수도 있으므로 주기적으로도 맞춰준다.
  setInterval(updateScaleReadout, 500);

  rvEl.onclick = (e) => {
    reveal = !reveal;
    e.currentTarget.classList.toggle("on", reveal);
    // M4-T2(SPEC_M4 §2 항목1)부터 map.js도 reveal을 실제로 쓴다 — org 기본 마커/라벨/반경 링/
    // TIDEBREAK 궤적과 사건 점의 조직색은 reveal이 꺼지면 지도에서 통째로 빠진다(map.js 참고).
    // 카드(#cells)의 방향(dir) 배지도 여전히 reveal에 반응한다(dd.hidden = !reveal, chrome() 참고).
    // 결과 패널의 ANSWER KEY 배지는 reveal에 반응하지만(computeAnswerKeyFacilityIds, renderResults
    // 참고) 추론 자체(랭킹/점수)는 reveal과 무관하게 항상 그대로다 — 정답지 분리 경계, SPEC_M3 §3.
    // Job1: #cells는 reveal이 조직 카드 ↔ 중립 요약 중 어느 마크업을 그릴지까지 가른다 — DOM을
    // 통째로 다시 만들어야 하므로 매 프레임이 아니라 여기서(토글되는 순간) 딱 한 번 다시 짓는다.
    renderCellsShell();
    applyI18n(); // 새로 지은 카드/중립 요약의 정적 라벨(EV/RAD 또는 두 줄 요약 라벨)을 즉시 채운다.
    // 상태바의 "Cells 3"도 조직 개수라는 지휘 계층 정보라 reveal과 함께 감춘다.
    statCellsEl.hidden = !reveal;
    renderResults(); // reveal 토글 즉시 결과 패널의 답 배지를 갱신한다 — 지도는 다음 setFrame에서 갱신.
  };

  ppEl.onclick = (e) => {
    playing = !playing;
    e.currentTarget.textContent = playing ? t("app.pause") : t("app.play");
    e.currentTarget.classList.toggle("on", playing);
    sDotEl.classList.toggle("on", playing);
    sModeEl.textContent = playing ? t("app.running") : t("app.hold");
  };

  document.querySelectorAll("[data-sp]").forEach((b) => {
    b.onclick = () => {
      speed = +b.dataset.sp;
      document.querySelectorAll("[data-sp]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });

  // ── M4 seam(scaffold): org-view.js/data-view.js/tour.js에 공통으로 넘기는 deps ───────────
  // 계약은 세 모듈 상단 주석에 토씨 하나까지 동일하게 적혀 있다(org-view.js 참고) — 여기 모양을
  // 고치면 반드시 그 세 주석 블록도 같이 고칠 것.
  const viewDeps = {
    result: { events, campaigns, facilities, periods, days, startDate: D0 },
    seed: SEED,
    // queryEvents 자체를 값으로 넣지 않고 얇은 래퍼로 감싼다 — 재실행(rerun) 뒤 위 지역 변수
    // queryEvents가 새 함수로 재대입돼도, 이 래퍼는 매 호출마다 "지금" 값을 다시 읽으므로 항상
    // 최신 이벤트 배열을 본다(객체 리터럴이 그 순간의 값을 그대로 복사해두는 문제를 피한다).
    queryEvents: (args) => queryEvents(args),
    getState: getViewState,
    onStateChange: (cb) => {
      viewStateSubscribers.add(cb);
      return () => viewStateSubscribers.delete(cb);
    },
    // M4 Fix2 — 진짜 재실행. overrides는 simulate()가 바로 먹는 모양({orgs, directives,
    // noiseMultiplier}) 또는 null(기본으로 되돌리기)이다. performRerun()이 실제로 simulate()를
    // 다시 돌리고 지도·피드·시간창·ANL 뷰·결과 패널까지 앱 상태 전체를 새 run으로 갈아 끼운다
    // ("hot-swap") — 예전처럼 seed만 받아 결과를 버리는 스텁이 아니다. 반환하는 Promise는 적용된
    // run을 그대로 돌려주므로, org-view는 이 run을 자기 미리보기 점수 계산(scoreRun)에 재사용하고
    // simulate()를 또 부르지 않는다.
    requestRerun(overrides = null) {
      return performRerun(overrides);
    },
  };

  // ── 뷰 라우팅(SIM/ORG/ANL/DAT) ───────────────────────────────────────
  // .wrap[data-view]를 nav 버튼 클릭에 맞춰 바꾸면 style.css의 .wrap:not([data-view="sim"]) 규칙이
  // stage/side/시간창을 숨기고 해당 .viewpane(#view-anl/#view-org/#view-dat)만 보여준다.
  // 셋 다 처음 진입할 때 한 번만 render()를 호출한다(analysis-view.js는 runAblation() 결과를
  // 자체 캐싱하고, org/data-view는 아직 스텁이라 다시 그려도 비용이 없지만 같은 패턴을 맞춘다).
  const wrapEl = document.querySelector(".wrap");
  const anlView = createAnalysisView(document.getElementById("view-anl"), { events, periods });
  const orgView = createOrgView(document.getElementById("view-org"), viewDeps);
  const datView = createDataView(document.getElementById("view-dat"), viewDeps);
  // 투어는 특정 뷰에 속하지 않는 오버레이라 컨테이너 없이 deps만 받는다(tour.js 상단 주석 참고).
  // SPEC_M4 §5(첫 방문 4단계 안내)의 실제 구현·"restart tour" 어포던스는 별도 작업의 몫이라
  // 지금은 인스턴스만 만들어 두고 자동으로 start()하지 않는다.
  const tour = createTour(viewDeps);
  const viewRendered = { anl: false, org: false, dat: false };
  document.querySelectorAll("[data-view-btn]").forEach((btn) => {
    btn.onclick = () => {
      const view = btn.dataset.viewBtn;
      wrapEl.dataset.view = view;
      document.querySelectorAll("[data-view-btn]").forEach((b) => b.classList.toggle("sel", b === btn));
      if (view === "anl" && !viewRendered.anl) { viewRendered.anl = true; anlView.render(); }
      if (view === "org" && !viewRendered.org) { viewRendered.org = true; orgView.render(); }
      if (view === "dat" && !viewRendered.dat) { viewRendered.dat = true; datView.render(); }
    };
  });

  // ── 부트 시퀀스 ──────────────────────────────────────────────────────
  // "GROUND TRUTH CONSOLE"/"v0.9.1"은 제품명·버전이라 두 언어에서 동일해 t() 없이 그대로 둔다.
  // 나머지 라벨은 t()로 고른다 — 부트 오버레이는 2초 안에 사라지므로 언어 전환에 맞춰 다시
  // 그릴 필요가 없다(전환 시점엔 이미 화면에서 걷힌 뒤).
  const BOOT = [
    ["GROUND TRUTH CONSOLE", "v0.9.1"],
    [t("app.bootTerrain"), t("app.bootLoaded")],
    [t("app.bootSeed", { seed: SEED }), t("app.bootLocked")],
    [t("app.bootHierarchy", { n: ORGS.length }), t("app.bootReady")],
    [t("app.bootSpan", { days }), t("app.bootBuilt")],
    [t("app.bootInference", { n: facilities.length }), t("app.bootBuilt")],
    [t("app.bootCommand"), t("app.bootWithheld")],
  ];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 시간창 기본값(가장 최근 100일)을 실제로 반영 — setWindow가 visibleEvents/입력창/추론을 전부 채운다.
  setWindow(windowStart, windowEnd);

  // index.html의 정적 마크업은 "재생 중"을 기본값으로 박아뒀지만(과거 M1 동작), M3-T3부터는
  // playing=false가 기본이므로(위 상태 선언) 버튼/상태 표시를 실제 상태와 맞춰준다.
  ppEl.textContent = playing ? t("app.pause") : t("app.play");
  ppEl.classList.toggle("on", playing);
  sDotEl.classList.toggle("on", playing);
  sModeEl.textContent = playing ? t("app.running") : t("app.hold");

  // ── 언어 토글(KO/EN) 배선 (SPEC_M4 §1.6) ──────────────────────────────
  // 버튼 자체의 레이블("한국어"/"English")은 항상 고정이라 t()를 거치지 않는다 — 그래야 어느
  // 언어 상태에서도 둘 다 읽힌다(§1.6). setLang()은 상태를 그대로 두고 표시만 바꾸므로(§1.5)
  // 여기서도 renderResults나 refreshScopePreview/setWindow를 다시 부르지 않는다.
  langToggleEl.querySelectorAll(".lang-btn").forEach((b) => {
    b.onclick = () => setLang(b.dataset.lang);
  });
  // 모든 뷰가 구독하는 공통 규칙: 언어가 바뀌면 이 파일이 소유한 정적 라벨만 다시 적용한다.
  // results-panel.js/analysis-view.js는 각자 자기 onLangChange 구독으로 스스로 다시 그린다.
  onLangChange(applyI18n);
  applyI18n(); // 부팅 시 최초 1회 — 기본 언어(브라우저 설정 또는 저장된 선택)를 바로 반영한다.

  if (reduceMotion) {
    bootEl.classList.add("done");
  } else {
    BOOT.forEach((line, i) => {
      setTimeout(() => {
        const d = document.createElement("div");
        d.innerHTML =
          (i === 0 ? "<b>" + line[0] + "</b>" : line[0]) +
          ' <span class="ok">' + ".".repeat(Math.max(3, 34 - line[0].length)) + " " + line[1] + "</span>";
        bootEl.appendChild(d);
      }, i * 230);
    });
    setTimeout(() => bootEl.classList.add("done"), 2000);
  }

  updateScaleReadout();
  requestAnimationFrame(loop);
}

boot();
