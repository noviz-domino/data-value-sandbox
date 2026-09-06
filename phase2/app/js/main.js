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
// ── 조직 팔레트 ────────────────────────────────────────────────────────────
// M3-T4부터는 palette.js가 유일한 색상 소스다(map.js/analysis-view.js와 공유). 카드/
// 타임라인/피드가 지도와 다른 색을 쓰는 어긋남을 palette.js 하나로 없앤다.
import { ORG_COLORS } from "./palette.js";
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
    "app.orgPlaceholder": "조직 뷰 — 준비 중",
    "app.datPlaceholder": "데이터 뷰 — 준비 중",
    "app.cellEv": "사건",
    "app.cellRad": "반경",
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
    "app.orgPlaceholder": "Organizations view — coming soon",
    "app.datPlaceholder": "Data view — coming soon",
    "app.cellEv": "EV",
    "app.cellRad": "RAD",
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

  runApp({ events, periods, byDay, days, maxPerDay, campaigns, facilities, simulateFn, landGeo: ne50land, coastGeo: ne50coast });
}

function runApp({ events, periods, byDay, days, maxPerDay, campaigns, facilities, simulateFn, landGeo, coastGeo }) {
  // ── DOM 참조 ─────────────────────────────────────────────────────────
  const mapEl = document.getElementById("map");
  const wac = document.getElementById("wac");
  const winStartEl = document.getElementById("win-start");
  const winEndEl = document.getElementById("win-end");
  const cellsEl = document.getElementById("cells");
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
  const { queryEvents } = createEventQuery(events);
  const facilitiesById = new Map(facilities.map((f) => [f.id, f]));
  // 답 배지(§answer-key 블록) 전용 색인 — campaign.eventIds로 좌표를 다시 찾아 centroid를 낼 때만 쓴다.
  const eventsById = new Map(events.map((e) => [e.id, e]));

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

    document.getElementById("ph-org").textContent = t("app.orgPlaceholder");
    document.getElementById("ph-dat").textContent = t("app.datPlaceholder");

    // 조직 카드(#cells)의 EV/RAD 라벨 — 값(data-ev/data-rad)은 chrome()이 매 프레임 채우지만
    // 라벨 자체는 카드를 만들 때 한 번만 쓰인 정적 텍스트라 여기서 다시 적용해야 한다.
    cellsEl.querySelectorAll(".cell").forEach((cellEl) => {
      const rows = cellEl.querySelectorAll(".rows i");
      if (rows[0]) rows[0].textContent = t("app.cellEv");
      if (rows[1]) rows[1].textContent = t("app.cellRad");
    });

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
      recomputeInference();
    } catch (err) {
      console.error("evaluateInference 실패 — 결과 패널에 참고 지표를 표시하지 않는다.", err);
    }
  }
  setTimeout(runCachedEvaluation, 0);

  const resultsPanel = createResultsPanel(resultsEl, {
    onSelect: (fid) => {
      selectedFacilityId = fid;
      recomputeInference();
    },
  });

  // ══════════════════════════════════════════════════════════════════════════════════
  // 정답지(scoring-only) 블록 — SPEC_M3 §3 ground truth separation, 절대 규칙.
  // 이 함수는 오직 결과 패널의 "ANSWER KEY" 배지(§6.4, reveal 토글 전용)를 그리기 위해서만
  // campaigns를 읽는다. 반환값은 recomputeInference() 맨 끝에서 resultsPanel.render()로만
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

  /** 스코프/시간창/선택이 바뀔 때마다 inferTargets를 다시 돌리고, 지도 레이어·결과 패널을 갱신한다. */
  function recomputeInference() {
    const active = scopeDraft || scope;
    const win = { startDay: windowStart, endDay: windowEnd };
    // 원본(org 포함) 이벤트는 seam(queryEvents) 하나로만 얻는다 — 여기서 events 배열을 직접 filter하지 않는다.
    const rawScoped = queryEvents({ scope: active, window: win });
    // 정답지 분리 경계: org 제거는 여기 한 곳에서만 한다. 추론 엔진에는 이 결과만 넘긴다.
    const projected = projectForInference(rawScoped);
    const scopedFacilities = scopeFacilities(facilities, active);
    const result = inferTargets({ events: projected, facilities: scopedFacilities, features: FULL_FEATURES });
    const supportingEvents = selectedFacilityId
      ? inBandEventsFor(facilitiesById.get(selectedFacilityId), projected)
      : [];

    inferenceFrame = {
      scope,
      scopeDraft,
      candidateFacilities: scopedFacilities,
      selectedFacilityId,
      supportingEvents,
    };

    // reveal이 꺼져 있으면 answer-key 계산 자체를 하지 않고 null을 넘긴다 — results-panel.js는
    // revealTargetIds가 null이면 답 관련 마크업을 아예 만들지 않으므로, DOM에도 그 어떤 형태로도
    // 정답이 새지 않는다(prop으로도, class로도, 숨겨진 텍스트로도).
    const revealTargetIds = reveal ? computeAnswerKeyFacilityIds(active, win) : null;

    resultsPanel.render({
      ranked: result.ranked,
      eventCount: result.eventCount,
      warnings: result.warnings,
      radiusKm: active.radiusKm,
      facilitiesById,
      selectedFacilityId,
      scopeCenter: active,
      evaluation: cachedEval,
      revealTargetIds,
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
    recomputeInference(); // 스코프 안 이벤트 수는 시간창에도 좌우된다.
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
      recomputeInference();
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
      recomputeInference();

      const move = (ev) => {
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const [lon2, lat2] = map.unproject(x, y);
        scopeDraft.radiusKm = haversineKm(lat, lon, lat2, lon2);
        scopeRadiusEl.value = Math.round(scopeDraft.radiusKm);
        recomputeInference();
      };
      const up = () => {
        removeEventListener("pointermove", move, true);
        removeEventListener("pointerup", up, true);
        if (scopeDraft && scopeDraft.radiusKm > 1) scope = scopeDraft;
        scopeDraft = null;
        scopeMode = false;
        scopeBtnEl.classList.remove("on");
        mapEl.classList.remove("scope-armed");
        recomputeInference();
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
      recomputeInference();
    }
  };

  // ── 시간창 컨트롤 (SPEC_M3 §6.1) ─────────────────────────────────────
  const windowControl = createWindowControl(wac, {
    onChange: ({ windowStart: s, windowEnd: e }) => setWindow(s, e),
  });
  winStartEl.onchange = () => setWindow(Number(winStartEl.value), windowEnd);
  winEndEl.onchange = () => setWindow(windowStart, Number(winEndEl.value));

  // ── 조직 카드 (#cells) ───────────────────────────────────────────────
  // 프로토타입 §404-412의 마크업을 그대로 포팅. data-ev/data-rad/data-dir을 이후 chrome()에서 갱신.
  const cellEls = ORGS.map((org) => {
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

    const cnt = Object.fromEntries(ORGS.map((o) => [o.key, 0]));
    visibleEvents.forEach((e) => { cnt[e.org] = (cnt[e.org] || 0) + 1; });

    ORGS.forEach((org, i) => {
      const p = periods.find((q) => q.org === org.key && day >= q.startDay && day < q.endDay);
      const directiveKey = p ? p.directive : "CONSOLIDATE"; // 활성 기간이 없을 때의 폴백. map.js DEFAULT_DIRECTIVE와 동일 규칙.
      const dirDef = DIRECTIVES[directiveKey];
      const el = cellEls[i];
      el.querySelector("[data-ev]").textContent = pad(cnt[org.key], 3);
      el.querySelector("[data-rad]").textContent = pad(Math.round(org.baseRadius * dirDef.radiusMult), 3);
      const dd = el.querySelector("[data-dir]");
      dd.hidden = !reveal;
      // directive 이름(p.directive, 예: EXPAND)은 데이터셋 값이라 언어와 무관하게 원문 그대로 둔다
      // (SPEC_M4 §1.2) — "{days}일 남음"/"{days}D LEFT" 부분만 t()로 번역한다.
      if (reveal && p) dd.textContent = p.directive + " · " + t("app.daysLeft", { days: pad(p.endDay - day, 3) });
    });

    // 피드: 시간창 안 이벤트 중 최신 11개(day 내림차순)를 보여준다. 이벤트 수가 수천 개라도
    // 창 하나에 든 것만 다루므로 매 프레임 다시 만들어도 가볍다(누적 포인터가 더 이상 필요 없다).
    const recent = visibleEvents.slice().sort((a, b) => b.day - a.day).slice(0, 11);
    feedEl.innerHTML = recent
      .map(
        (e) =>
          '<div><em style="color:' + ORG_COLORS[e.org] + '">' + e.org.slice(0, 4) + "</em> " +
          Math.abs(e.lat).toFixed(1) + (e.lat < 0 ? "S" : "N") + " " +
          e.lon.toFixed(1) + "E · " + e.method.toUpperCase() + " · " + e.target.slice(0, 5).toUpperCase() + "</div>"
      )
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
    map.setFrame({ day, events: visibleEvents, orgs: ORGS, periods, reveal, visibleOrgs, ...inferenceFrame });
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
    // map.setFrame에도 reveal을 넘기지만 map.js는 M1에서 이를 사용하지 않는다(모듈 주석 참고) —
    // 카드/타임라인만 reveal에 반응한다. 결과 패널의 ANSWER KEY 배지는 reveal에 반응하지만
    // (computeAnswerKeyFacilityIds, 위 recomputeInference 참고) 추론 자체(랭킹/점수)는
    // reveal과 무관하게 항상 그대로다 — 정답지 분리 경계, SPEC_M3 §3.
    recomputeInference(); // reveal 토글 즉시 결과 패널의 답 배지를 갱신한다.
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

  // ── 뷰 라우팅(SIM/ORG/ANL/DAT) ───────────────────────────────────────
  // .wrap[data-view]를 nav 버튼 클릭에 맞춰 바꾸면 style.css의 .wrap:not([data-view="sim"]) 규칙이
  // stage/side/시간창을 숨기고 해당 .viewpane(#view-anl/#view-org/#view-dat)만 보여준다.
  // ANL은 처음 진입할 때 한 번만 createAnalysisView().render()를 호출해 runAblation() 결과를 그린다
  // (analysis-view.js 안에서 result를 캐싱하므로 다시 눌러도 재계산하지 않는다).
  const wrapEl = document.querySelector(".wrap");
  const anlView = createAnalysisView(document.getElementById("view-anl"), { events, periods });
  let anlRendered = false;
  document.querySelectorAll("[data-view-btn]").forEach((btn) => {
    btn.onclick = () => {
      const view = btn.dataset.viewBtn;
      wrapEl.dataset.view = view;
      document.querySelectorAll("[data-view-btn]").forEach((b) => b.classList.toggle("sel", b === btn));
      if (view === "anl" && !anlRendered) {
        anlRendered = true;
        anlView.render();
      }
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
  // 여기서도 recomputeInference나 setWindow를 다시 부르지 않는다.
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
