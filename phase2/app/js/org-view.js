// 조직(ORG) 뷰 — SPEC_M4.md §3 (조직별 편집 폼 + 신호 강도 슬라이더 + sweep) 실제 구현. (M4-T3)
//
// ── deps 계약 (main.js가 org-view/data-view/tour 세 모듈에 공통으로 넘기는 모양) ─────────────
// 세 에이전트가 서로 대화하지 않고 각자 이 파일만 보고 작업하므로, 이 계약을 세 파일 모두에
// 토씨 하나 안 틀리고 그대로 복사해 둔다 — 한 곳만 고치면 반드시 나머지 둘도 같이 고칠 것.
//
//   deps = {
//     result: { events, campaigns, facilities, periods, days, startDate },
//     seed: number,
//     queryEvents: (args) => object[],
//     getState: () => ({ window: {startDay,endDay}, scope: {lat,lon,radiusKm}|null }),
//     onStateChange: (cb) => (() => void),
//     requestRerun: (opts?: { seed?: number }) => void,
//   }
//
// ── 이 뷰가 실제로 시뮬레이션을 다시 돌리는 방법에 대한 메모 (스캐폴드 주석이 예고했던 확장) ──
// main.js의 viewDeps.requestRerun은 seed만 받는 얇은 스텁이라(§3.1/§3.2가 요구하는) organizations.js
// §7 파라미터 오버라이드를 전달할 통로가 없다 — main.js의 simulateFn 클로저 자체가 overrides를
// 받지 않기 때문이다. main.js는 다른 에이전트 소관이라 그 클로저를 넓힐 수 없다. 그래서 이 뷰는
// "미리보기/sweep 전용"으로 스스로 simulate()/runAblation()/evaluateInference()를 불러 완전히
// 독립적으로 재계산한다 — 지도/타임라인 등 앱의 나머지 부분은 여전히 기본 설정으로 남아있고,
// 이 뷰 안의 결과 패널·sweep 차트만 오버라이드를 반영한다. deps.requestRerun({seed})은 그래도
// "재실행 의도"를 신호로 보내는 용도로 한 번 불러준다(계약을 지키는 예의상의 호출 — main.js가
// 나중에 이 opts를 실제로 넓혀 쓰게 되면 자동으로 이어받는다).
//
// simulate()가 필요로 하는 landTest(§5 지리 엔진)는 deps에 없으므로, main.js와 동일한 파일
// (data/ne_110m_land.geojson)을 이 뷰가 직접 fetch해 만든다 — index.html 기준 상대경로라
// main.js의 fetch("data/...")와 같은 방식으로 해석된다. facilities는 deps.result.facilities
// (simulate()가 이미 만들어준 배열)를 그대로 재사용해 중복 fetch를 피한다.
//
// 정답지 분리(ground truth separation, SPEC_M3 §3): 이 파일이 부르는 것은 simulate()/runAblation()/
// evaluateInference() 세 "엔진"뿐이다. inference.js/analysis.js의 채점 로직을 재구현하지 않는다.

import { t, register, onLangChange } from "./i18n.js";
import {
  ORGS,
  DIRECTIVES,
  TARGETS,
  cloneDefaultOrgs,
  applyOrgOverrides,
  applyDirectiveOverrides,
  driftRateForStrength,
  seasonalMultiplierForStrength,
  targetPreferenceShareForStrength,
  directiveRadiusMultForStrength,
  noiseTempoMultiplierForStrength,
} from "./organizations.js";
import { simulate } from "./simulation.js";
import { runAblation } from "./analysis.js";
import { evaluateInference } from "./inference.js";
import { makeLandTest } from "./geo.js";
import { ORG_COLORS } from "./palette.js";

register({
  ko: {
    "org.title": "조직 구성",
    "org.subtitle": "§7 파라미터를 직접 편집한다. 편집하면 지금 화면(시뮬레이션·지도)이 이 설정을 아직 반영하지 못한 상태가 된다.",
    "org.staleBanner": "재실행 필요 — 이 카드의 값은 지금 표시된 결과를 만든 설정과 다르다.",
    "org.resetBtn": "기본값으로 되돌리기",
    "org.runBtn": "이 설정으로 미리보기 실행",
    "org.runBtnBusy": "실행 중…",
    "org.runNote": "지도·타임라인 등 앱의 나머지 화면은 그대로 기본 설정으로 남는다 — 이 패널 안의 숫자만 지금 설정을 반영한다.",
    "org.base": "거점 좌표(위도, 경도)",
    "org.radius": "기본 반경(km)",
    "org.tempo": "기본 템포(하루당 확률)",
    "org.branches": "파벌 비중(share)",
    "org.drift": "표류(drift)",
    "org.driftRate": "속도(km/day)",
    "org.driftBearing": "방위각(deg, 0=북 90=동)",
    "org.seasonal": "계절성",
    "org.seasonalEnable": "계절 억제 사용",
    "org.seasonalMultiplier": "여름철 배율",
    "org.seasonalMonths": "적용 달",
    "org.targetPref": "표적 선호",
    "org.targetPrefNone": "균등(선호 없음)",
    "org.targetPrefShare": "선호 비중(share)",
    "org.preview": "미리보기(거점 + 반경)",
    "org.signalsTitle": "신호 강도 (§12.1) — 가장 중요한 조작면",
    "org.signalsSubtitle": "0 = 신호 없음, 1.0 = 기본(커밋된 데이터셋과 동일), 2.0 = 두 배 강도.",
    "org.sig.tidebreakDrift": "TIDEBREAK 표류 속도",
    "org.sig.drystoneSeasonality": "DRYSTONE 계절성",
    "org.sig.drystoneTargetPref": "DRYSTONE 표적 선호",
    "org.sig.directiveEffect": "지침(directive) 효과 크기",
    "org.sig.noiseRatio": "잡음비(noise ratio)",
    "org.sweepBtn": "이 신호 sweep",
    "org.sweepBtnBusy": "sweep 중… ({done}/{total})",
    "org.sweepCached": "(캐시됨)",
    "org.sweepTiming": "sweep 소요 {ms}ms · 단일 시드",
    "org.sweepSingleSeedNote": "단일 시드 — M3 5시드 풀링 헤드라인 수치와 직접 비교하지 말 것.",
    "org.sweepLegendM2": "M2 회복 비율 (run C)",
    "org.sweepLegendM3": "M3 top-1 (PEC)",
    "org.sweepFloorCeiling": "점선: M2 기준선 0%/100%, M3 스코프별 기준선",
    "org.runResultTitle": "미리보기 결과",
    "org.runResultM2": "M2 (run C) — 정확도 {acc}% (기준선 {floor}% · 상한 {ceil}%) · 회복 비율 {rec}%",
    "org.runResultM3": "M3 (PEC, 단일 시드) — top-1 {top1}% (스코프별 기준선 {floor}%)",
    "org.runResultTiming": "계산 시간 {ms}ms · 사건 {n}건(배경 {bg} + 캠페인 {camp})",
    "org.runError": "실행 실패: {msg}",
    "org.unit.kmPerDay": "km/day",
    "org.unit.mult": "×{v}",
    "org.unit.pctInfra": "{v}% infrastructure",
    "org.unit.radiusMult": "radius ×{expand}/×{consolidate}",
    "org.unit.pctBackground": "배경 {v}%",
    "org.monthShort": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
  },
  en: {
    "org.title": "Organisation configuration",
    "org.subtitle": "Edit the §7 parameters directly. Editing means the currently displayed simulation and map no longer match this configuration.",
    "org.staleBanner": "Re-run required — this card's values differ from the configuration behind what's currently shown.",
    "org.resetBtn": "Reset to defaults",
    "org.runBtn": "Run preview with this configuration",
    "org.runBtnBusy": "Running…",
    "org.runNote": "The rest of the app (map, timeline) stays on the default configuration — only the numbers in this panel reflect what you've set here.",
    "org.base": "Base coordinates (lat, lon)",
    "org.radius": "Base radius (km)",
    "org.tempo": "Base tempo (probability per day)",
    "org.branches": "Branch shares",
    "org.drift": "Drift",
    "org.driftRate": "Rate (km/day)",
    "org.driftBearing": "Bearing (deg, 0=N 90=E)",
    "org.seasonal": "Seasonality",
    "org.seasonalEnable": "Use seasonal suppression",
    "org.seasonalMultiplier": "Summer multiplier",
    "org.seasonalMonths": "Active months",
    "org.targetPref": "Target preference",
    "org.targetPrefNone": "Uniform (no preference)",
    "org.targetPrefShare": "Preference share",
    "org.preview": "Preview (base + radius)",
    "org.signalsTitle": "Signal strength (§12.1) — the most important control surface",
    "org.signalsSubtitle": "0 = signal absent, 1.0 = default (matches the committed dataset), 2.0 = double strength.",
    "org.sig.tidebreakDrift": "TIDEBREAK drift rate",
    "org.sig.drystoneSeasonality": "DRYSTONE seasonality",
    "org.sig.drystoneTargetPref": "DRYSTONE target preference",
    "org.sig.directiveEffect": "Directive effect size",
    "org.sig.noiseRatio": "Noise ratio",
    "org.sweepBtn": "Sweep this signal",
    "org.sweepBtnBusy": "Sweeping… ({done}/{total})",
    "org.sweepCached": "(cached)",
    "org.sweepTiming": "sweep took {ms}ms · single seed",
    "org.sweepSingleSeedNote": "Single seed — do not read this as equivalent to M3's 5-seed pooled headline.",
    "org.sweepLegendM2": "M2 recovered fraction (run C)",
    "org.sweepLegendM3": "M3 top-1 (PEC)",
    "org.sweepFloorCeiling": "dashed: M2 floor/ceiling at 0%/100%, M3 scope-relative floor",
    "org.runResultTitle": "Preview result",
    "org.runResultM2": "M2 (run C) — accuracy {acc}% (floor {floor}% · ceiling {ceil}%) · recovered {rec}%",
    "org.runResultM3": "M3 (PEC, single seed) — top-1 {top1}% (scope-relative floor {floor}%)",
    "org.runResultTiming": "computed in {ms}ms · {n} events (background {bg} + campaign {camp})",
    "org.runError": "Run failed: {msg}",
    "org.unit.kmPerDay": "km/day",
    "org.unit.mult": "×{v}",
    "org.unit.pctInfra": "{v}% infrastructure",
    "org.unit.radiusMult": "radius ×{expand}/×{consolidate}",
    "org.unit.pctBackground": "{v}% background",
    "org.monthShort": ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
  },
});

const SWEEP_STRENGTHS = [0, 0.25, 0.5, 1.0, 1.5, 2.0];

const SIGNAL_DEFS = [
  { name: "tidebreakDrift", org: "TIDEBREAK" },
  { name: "drystoneSeasonality", org: "DRYSTONE" },
  { name: "drystoneTargetPref", org: "DRYSTONE" },
  { name: "directiveEffect", org: null },
  { name: "noiseRatio", org: null },
];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function clamp01(v) {
  return clamp(v, 0, 1);
}
function pct1(x) {
  return (x * 100).toFixed(1);
}

/** 표에 박힌 세 점(0/1.0/2.0)을 지나가는 구간별 선형의 역함수. 단조 증가/감소 모두 지원한다. */
function invertPiecewise(value, at0, at1, at2) {
  const seg1 = (at1 - at0) !== 0 ? (value - at0) / (at1 - at0) : 0;
  if (seg1 >= 0 && seg1 <= 1) return seg1;
  const seg2 = (at2 - at1) !== 0 ? 1 + (value - at1) / (at2 - at1) : 1;
  return clamp(seg2, 0, 2);
}

/**
 * @param {HTMLElement} container - #view-org
 * @param {object} deps - 상단 주석의 계약 참고
 */
export function createOrgView(container, deps) {
  // ── 편집 상태 ──────────────────────────────────────────────────────────────
  // drafts: ORGS를 깊은 복사한 편집용 배열. 폼과 신호 슬라이더 모두 이 같은 필드를 직접 고친다
  // (예: TIDEBREAK 드리프트 슬라이더는 drafts의 TIDEBREAK.driftKmPerDay 필드를 계산해서 쓴다 —
  // 별도의 "슬라이더 상태"를 안 두므로 폼 직접 입력과 슬라이더가 항상 같은 값을 본다).
  let drafts = cloneDefaultOrgs();
  // directiveEffect/noiseRatio는 특정 조직의 필드가 아니라 전역 신호라 여기 별도로 둔다.
  let signals = { directiveEffect: 1.0, noiseRatio: 1.0 };

  const DEFAULT_SNAPSHOT = snapshotOf(cloneDefaultOrgs(), { directiveEffect: 1.0, noiseRatio: 1.0 });
  // "마지막으로 실제 미리보기를 실행했을 때의 설정" — 이게 지금 draft와 다르면 스테일(banner)이다.
  // 처음엔 이 뷰가 아직 아무것도 안 돌렸어도 deps.result 자체가 기본 설정으로 만들어졌으므로
  // 기본값과 같다고 본다.
  let lastRunSnapshot = DEFAULT_SNAPSHOT;

  let landTestPromise = null;
  let running = false;
  let runResult = null; // { ablation, inference, timingMs, eventCount, backgroundCount, campaignCount }
  let runError = null;

  const sweepCache = new Map(); // configKey -> points[]
  let sweepState = null; // { signal, points, running, progress:{done,total}, timingMs, cached }

  function snapshotOf(d, s) {
    return JSON.stringify({ d, s });
  }
  function isDirty() {
    return snapshotOf(drafts, signals) !== lastRunSnapshot;
  }

  function orgByKey(key) {
    return drafts.find((o) => o.key === key);
  }

  async function ensureLandTest() {
    if (!landTestPromise) {
      landTestPromise = fetch("data/ne_110m_land.geojson")
        .then((r) => r.json())
        .then(makeLandTest);
    }
    return landTestPromise;
  }

  function facilitiesRaw() {
    return { facilities: deps.result.facilities };
  }

  /**
   * 지금 drafts/signals(+선택적으로 sweep 중인 한 신호의 임시 강도)로부터 simulate()가 바로
   * 먹을 수 있는 overrides({orgs, directives, noiseMultiplier})를 만든다.
   * @param {{name:string, strength:number}|null} signalOverride - sweep 중 "이 신호만 다른
   *   강도로 대체"할 때 쓴다. drafts/signals 자체는 건드리지 않는다(sweep이 끝난 뒤 원래
   *   편집 상태로 그대로 복귀해야 하므로).
   */
  function buildOverrides(signalOverride) {
    let localDrafts = drafts;
    let directiveEffect = signals.directiveEffect;
    let noiseRatio = signals.noiseRatio;

    function withTidebreak(fn) {
      localDrafts = drafts.map((o) => (o.key === "TIDEBREAK" ? fn(o) : o));
    }
    function withDrystone(fn) {
      localDrafts = drafts.map((o) => (o.key === "DRYSTONE" ? fn(o) : o));
    }

    if (signalOverride) {
      const s = signalOverride.strength;
      if (signalOverride.name === "tidebreakDrift") {
        withTidebreak((o) => ({ ...o, driftKmPerDay: driftRateForStrength(s) }));
      } else if (signalOverride.name === "drystoneSeasonality") {
        withDrystone((o) => ({
          ...o,
          seasonal: { months: (o.seasonal && o.seasonal.months) || [12, 1, 2], multiplier: seasonalMultiplierForStrength(s) },
        }));
      } else if (signalOverride.name === "drystoneTargetPref") {
        withDrystone((o) => ({
          ...o,
          targetPreference: { type: (o.targetPreference && o.targetPreference.type) || "infrastructure", share: targetPreferenceShareForStrength(s) },
        }));
      } else if (signalOverride.name === "directiveEffect") {
        directiveEffect = s;
      } else if (signalOverride.name === "noiseRatio") {
        noiseRatio = s;
      }
    }

    const byKey = Object.fromEntries(localDrafts.map((o) => [o.key, o]));
    const orgs = applyOrgOverrides(ORGS, byKey);

    const directiveOverrides = {};
    for (const key of Object.keys(DIRECTIVES)) {
      directiveOverrides[key] = { radiusMult: directiveRadiusMultForStrength(key, DIRECTIVES[key].radiusMult, directiveEffect) };
    }
    const directives = applyDirectiveOverrides(DIRECTIVES, directiveOverrides);
    const noiseMultiplier = noiseTempoMultiplierForStrength(noiseRatio);
    return { orgs, directives, noiseMultiplier };
  }

  // 잡음비(noise ratio) 슬라이더를 0에 가깝게 두면 배경(background) 이벤트가 통째로 사라질 수
  // 있다(strength=0 -> noiseMultiplier=0 -> 모든 조직의 baseTempo가 0). 그 경우 runAblation의
  // 80/20 분할·KNN이 빈 배열을 받아 죽는다 — 실제로 sweep 중 이 경계에서 재현했다. "잡음이
  // 전혀 없으면 org 분류 자체가 정의되지 않는다"는 것 자체가 의미 있는 발견이라, 조용히 숫자를
  // 지어내지 않고 별도 표시로 남긴다.
  const MIN_BACKGROUND_FOR_ABLATION = 15; // 조직 3개 × 80/20 분할이 뭔가 의미를 가지려면 필요한 최소치(방어적 하한)
  function degenerateAblationRun() {
    return { features: [], accuracy: 0, floor: 0, ceiling: 1, recovered: 0, confusion: null, tooFewEvents: true };
  }

  /** simulate() 결과 하나를 M2(runAblation, 배경만)·M3(evaluateInference, 단일 시드) 두 축으로 채점한다. */
  function scoreRun(run, seed) {
    const campaignEventIds = new Set(run.campaigns.flatMap((c) => c.eventIds));
    const backgroundEvents = run.events.filter((e) => !campaignEventIds.has(e.id));
    const ablation =
      backgroundEvents.length >= MIN_BACKGROUND_FOR_ABLATION
        ? runAblation({ events: backgroundEvents, periods: run.periods, seed })
        : { A: degenerateAblationRun(), B: degenerateAblationRun(), C: degenerateAblationRun() };
    // seeds:1 — simulateFn이 이미 계산된 run을 그대로 돌려주므로 simulate()를 다시 부르지 않는다
    // (§3.3 "단일 시드" 요건이자 sweep 6사이클 예산을 지키는 핵심 — 실제로 simulate가 두 번
    // 돌지 않는다).
    const inference = evaluateInference({ simulateFn: () => run, seed, seeds: 1 });
    return {
      ablation,
      inference,
      backgroundCount: backgroundEvents.length,
      campaignCount: run.events.length - backgroundEvents.length,
      eventCount: run.events.length,
    };
  }

  async function runNow() {
    if (running) return;
    running = true;
    runError = null;
    render();
    try {
      const [landTest] = await Promise.all([ensureLandTest()]);
      const overrides = buildOverrides(null);
      const t0 = performance.now();
      const run = simulate({ seed: deps.seed, landTest, facilities: facilitiesRaw(), withCampaigns: true, overrides });
      const scored = scoreRun(run, deps.seed);
      const t1 = performance.now();
      runResult = { ...scored, timingMs: t1 - t0 };
      lastRunSnapshot = snapshotOf(drafts, signals);
      // 계약상의 예의 호출 — 지금 main.js의 스텁은 overrides를 못 받지만, 재실행 의도는 신호로 남긴다.
      try {
        deps.requestRerun({ seed: deps.seed });
      } catch {
        /* 스텁이 던져도 미리보기 자체는 이미 끝났으니 무시한다 */
      }
    } catch (err) {
      runError = (err && err.message) || String(err);
      console.error("[org-view] 미리보기 실행 실패", err);
    } finally {
      running = false;
      render();
    }
  }

  function resetToDefaults() {
    drafts = cloneDefaultOrgs();
    signals = { directiveEffect: 1.0, noiseRatio: 1.0 };
    render();
  }

  // ── sweep ────────────────────────────────────────────────────────────────
  function configKeyExcluding(signalName) {
    const d = drafts.map((o) => ({
      ...o,
      driftKmPerDay: signalName === "tidebreakDrift" ? null : o.driftKmPerDay,
      seasonal: o.seasonal ? { ...o.seasonal, multiplier: signalName === "drystoneSeasonality" ? null : o.seasonal.multiplier } : null,
      targetPreference: o.targetPreference
        ? { ...o.targetPreference, share: signalName === "drystoneTargetPref" ? null : o.targetPreference.share }
        : null,
    }));
    const s = {
      directiveEffect: signalName === "directiveEffect" ? null : signals.directiveEffect,
      noiseRatio: signalName === "noiseRatio" ? null : signals.noiseRatio,
    };
    return deps.seed + "|" + signalName + "|" + JSON.stringify(d) + "|" + JSON.stringify(s);
  }

  async function runSweep(signalName) {
    if (sweepState && sweepState.running) return;
    const cacheKey = configKeyExcluding(signalName);
    const cached = sweepCache.get(cacheKey);
    if (cached) {
      sweepState = { signal: signalName, points: cached, running: false, progress: { done: 6, total: 6 }, cached: true };
      render();
      return;
    }

    sweepState = { signal: signalName, points: [], running: true, progress: { done: 0, total: SWEEP_STRENGTHS.length } };
    render();

    const landTest = await ensureLandTest();
    const points = [];
    const t0 = performance.now();
    for (const strength of SWEEP_STRENGTHS) {
      const overrides = buildOverrides({ name: signalName, strength });
      const run = simulate({ seed: deps.seed, landTest, facilities: facilitiesRaw(), withCampaigns: true, overrides });
      const scored = scoreRun(run, deps.seed);
      const c = scored.ablation.C;
      const m2Recovered = (c.accuracy - c.floor) / (c.ceiling - c.floor);
      const pec = scored.inference.runs.PEC;
      points.push({
        strength,
        m2Accuracy: c.accuracy,
        m2Floor: c.floor,
        m2Ceiling: c.ceiling,
        m2Recovered,
        m3Top1: pec.top1,
        m3FloorTop1: pec.floorTop1,
      });
      sweepState = { signal: signalName, points: points.slice(), running: true, progress: { done: points.length, total: SWEEP_STRENGTHS.length } };
      render();
      // 6번의 풀 사이클(simulate+ablation+evaluateInference) 사이에 이벤트 루프로 양보한다 —
      // UI가 이 동안 죽은 것처럼 보이지 않게(§3.3 "keep the UI responsive").
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const t1 = performance.now();
    sweepState = { signal: signalName, points, running: false, progress: { done: SWEEP_STRENGTHS.length, total: SWEEP_STRENGTHS.length }, timingMs: t1 - t0 };
    sweepCache.set(cacheKey, points);
    render();
  }

  // ── 필드 입력 처리 ─────────────────────────────────────────────────────────
  function applyFieldInput(el) {
    const parts = el.dataset.field.split(":");
    const key = parts[0];
    const org = orgByKey(key);
    if (!org) return;
    const path = parts.slice(1);
    const isNumeric = el.type === "number" || el.type === "range";
    const raw = isNumeric ? parseFloat(el.value) : el.value;
    if (isNumeric && !Number.isFinite(raw)) return; // 입력 중(예: "-"만 친 상태)은 무시

    if (path[0] === "base") {
      org.base[Number(path[1])] = raw;
    } else if (path[0] === "branchShare") {
      org.branches[Number(path[1])].share = clamp01(raw);
    } else if (path[0] === "seasonalMultiplier") {
      if (!org.seasonal) org.seasonal = { months: [12, 1, 2], multiplier: 1 };
      org.seasonal.multiplier = clamp01(raw);
    } else if (path[0] === "targetShare") {
      if (!org.targetPreference) org.targetPreference = { type: "infrastructure", share: 0 };
      org.targetPreference.share = clamp01(raw);
    } else if (path[0] === "targetType") {
      if (!org.targetPreference) org.targetPreference = { type: raw, share: 0 };
      else org.targetPreference.type = raw;
    } else {
      org[path[0]] = raw; // baseRadius / baseTempo / driftKmPerDay / driftBearing
    }
  }

  function toggleMonth(key, month) {
    const org = orgByKey(key);
    if (!org || !org.seasonal) return;
    const months = org.seasonal.months;
    const idx = months.indexOf(month);
    if (idx === -1) months.push(month);
    else months.splice(idx, 1);
    render();
  }

  function toggleSeasonalEnable(key, enabled) {
    const org = orgByKey(key);
    if (!org) return;
    org.seasonal = enabled ? { months: [12, 1, 2], multiplier: 1 } : null;
    render();
  }

  function toggleTargetPrefEnable(key, enabled) {
    const org = orgByKey(key);
    if (!org) return;
    org.targetPreference = enabled ? { type: "infrastructure", share: 0.5 } : null;
    render();
  }

  function applySliderInput(el) {
    const signalName = el.dataset.slider;
    const strength = clamp(parseFloat(el.value), 0, 2);
    if (!Number.isFinite(strength)) return;
    const def = SIGNAL_DEFS.find((d) => d.name === signalName);
    if (signalName === "tidebreakDrift") {
      orgByKey("TIDEBREAK").driftKmPerDay = driftRateForStrength(strength);
    } else if (signalName === "drystoneSeasonality") {
      const org = orgByKey("DRYSTONE");
      if (!org.seasonal) org.seasonal = { months: [12, 1, 2], multiplier: 1 };
      org.seasonal.multiplier = seasonalMultiplierForStrength(strength);
    } else if (signalName === "drystoneTargetPref") {
      const org = orgByKey("DRYSTONE");
      if (!org.targetPreference) org.targetPreference = { type: "infrastructure", share: 0 };
      org.targetPreference.share = targetPreferenceShareForStrength(strength);
    } else if (signalName === "directiveEffect") {
      signals.directiveEffect = strength;
    } else if (signalName === "noiseRatio") {
      signals.noiseRatio = strength;
    }
    void def;
  }

  // ── 강도값 역산(슬라이더 위치 표시용) ────────────────────────────────────────
  function currentStrength(signalName) {
    if (signalName === "tidebreakDrift") return clamp((orgByKey("TIDEBREAK").driftKmPerDay || 0) / 0.5, 0, 2);
    if (signalName === "drystoneSeasonality") {
      const org = orgByKey("DRYSTONE");
      const m = org.seasonal ? org.seasonal.multiplier : 1;
      return invertPiecewise(m, 1, 0.3, 0.15);
    }
    if (signalName === "drystoneTargetPref") {
      const org = orgByKey("DRYSTONE");
      const s = org.targetPreference ? org.targetPreference.share : 0;
      return invertPiecewise(s, 0, 0.7, 0.95);
    }
    if (signalName === "directiveEffect") return signals.directiveEffect;
    if (signalName === "noiseRatio") return signals.noiseRatio;
    return 1;
  }

  function signalReadout(signalName, strength) {
    if (signalName === "tidebreakDrift") return driftRateForStrength(strength).toFixed(2) + " " + t("org.unit.kmPerDay");
    if (signalName === "drystoneSeasonality") return t("org.unit.mult", { v: seasonalMultiplierForStrength(strength).toFixed(2) });
    if (signalName === "drystoneTargetPref") return t("org.unit.pctInfra", { v: (targetPreferenceShareForStrength(strength) * 100).toFixed(0) });
    if (signalName === "directiveEffect") {
      const expand = directiveRadiusMultForStrength("EXPAND", DIRECTIVES.EXPAND.radiusMult, strength);
      const consolidate = directiveRadiusMultForStrength("CONSOLIDATE", DIRECTIVES.CONSOLIDATE.radiusMult, strength);
      return t("org.unit.radiusMult", { expand: expand.toFixed(2), consolidate: consolidate.toFixed(2) });
    }
    if (signalName === "noiseRatio") {
      const share = strength <= 1 ? 0.8 * strength : 0.8 + 0.15 * (strength - 1);
      return t("org.unit.pctBackground", { v: (share * 100).toFixed(0) });
    }
    return "";
  }

  // ── 미리보기(§3.1): 실제 지도가 아니라 lat/lon을 그대로 등장방형(equirectangular)으로 편 뒤,
  // baseRadius(km)를 그 위도에서의 근사 도(degree) 크기로 바꿔 그리는 작은 SVG다. map.js를
  // 재사용하지 않는다(그건 다른 에이전트의 파일이다) — 여기는 "편집 효과가 보인다" 정도로 충분하다.
  function previewSvg(org) {
    const W = 220, H = 110;
    const lon = org.base[1], lat = org.base[0];
    const x = ((lon + 180) / 360) * W;
    const y = ((90 - lat) / 180) * H;
    // 위도 lat에서 1도 경도 ≈ 111*cos(lat) km, 1도 위도 ≈ 111km. 반경을 "평균" 도 단위로 근사.
    const kmPerDegLon = Math.max(1, 111 * Math.cos((lat * Math.PI) / 180));
    const rDeg = (org.baseRadius / 111 + org.baseRadius / kmPerDegLon) / 2;
    const rPx = (rDeg / 360) * W;
    const color = ORG_COLORS[org.key] || "#8CA0B3";
    return (
      '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none" stroke="var(--hair)" stroke-width="1"/>' +
        '<line x1="0" y1="' + H / 2 + '" x2="' + W + '" y2="' + H / 2 + '" stroke="var(--hair)" stroke-width="0.5"/>' +
        '<line x1="' + W / 2 + '" y1="0" x2="' + W / 2 + '" y2="' + H + '" stroke="var(--hair)" stroke-width="0.5"/>' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + rPx.toFixed(1) + '" fill="' + color + '" fill-opacity="0.12" stroke="' + color + '" stroke-width="1" stroke-dasharray="3,2"/>' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="' + color + '"/>' +
      "</svg>"
    );
  }

  function orgCardHtml(org) {
    const color = ORG_COLORS[org.key] || "#8CA0B3";
    const branchesHtml = org.branches
      .map(
        (b, i) =>
          '<label class="org-inline"><span>' + esc(b.type) + '</span>' +
            '<input type="number" step="0.05" min="0" max="1" value="' + b.share + '" data-field="' + org.key + ':branchShare:' + i + '"/></label>'
      )
      .join("");
    const monthLabels = t("org.monthShort");
    const monthsHtml = Array.from({ length: 12 }, (_, i) => i + 1)
      .map((m) => {
        const on = org.seasonal ? org.seasonal.months.includes(m) : false;
        return (
          '<label class="org-month' + (on ? " on" : "") + '">' +
            '<input type="checkbox" ' + (on ? "checked" : "") + (org.seasonal ? "" : " disabled") +
              ' data-month="' + org.key + ':' + m + '"/>' + esc(monthLabels[m - 1]) +
          "</label>"
        );
      })
      .join("");

    return (
      '<div class="org-card" style="--org-color:' + color + '">' +
        '<div class="org-card-head"><span class="org-dot" style="background:' + color + '"></span>' +
          '<span class="org-name">' + esc(org.key) + "</span></div>" +
        '<div class="org-card-body">' +
          '<div class="org-col">' +
            '<label class="org-field"><span>' + t("org.base") + '</span>' +
              '<div class="org-inline">' +
                '<input type="number" step="0.1" value="' + org.base[0].toFixed(2) + '" data-field="' + org.key + ':base:0"/>' +
                '<input type="number" step="0.1" value="' + org.base[1].toFixed(2) + '" data-field="' + org.key + ':base:1"/>' +
              "</div></label>" +
            '<label class="org-field"><span>' + t("org.radius") + '</span>' +
              '<input type="number" step="10" min="0" value="' + org.baseRadius + '" data-field="' + org.key + ':baseRadius"/></label>' +
            '<label class="org-field"><span>' + t("org.tempo") + '</span>' +
              '<input type="number" step="0.01" min="0" value="' + org.baseTempo + '" data-field="' + org.key + ':baseTempo"/></label>' +
            '<div class="org-field"><span>' + t("org.branches") + '</span><div class="org-inline-group">' + branchesHtml + "</div></div>" +
            '<div class="org-field"><span>' + t("org.drift") + '</span>' +
              '<div class="org-inline">' +
                '<label class="org-inline"><span>' + t("org.driftRate") + '</span>' +
                  '<input type="number" step="0.05" min="0" value="' + (org.driftKmPerDay || 0).toFixed(2) + '" data-field="' + org.key + ':driftKmPerDay"/></label>' +
                '<label class="org-inline"><span>' + t("org.driftBearing") + '</span>' +
                  '<input type="number" step="1" min="0" max="360" value="' + (org.driftBearing != null ? org.driftBearing : 90) + '" data-field="' + org.key + ':driftBearing"/></label>' +
              "</div></div>" +
          "</div>" +
          '<div class="org-col">' +
            '<div class="org-field"><span>' +
              '<label class="org-inline"><input type="checkbox" ' + (org.seasonal ? "checked" : "") + ' data-seasonal-enable="' + org.key + '"/>' + t("org.seasonalEnable") + "</label>" +
            "</span>" +
              '<label class="org-inline"><span>' + t("org.seasonalMultiplier") + '</span>' +
                '<input type="number" step="0.05" min="0" max="1" value="' + (org.seasonal ? org.seasonal.multiplier : 1) + '" ' +
                  (org.seasonal ? "" : "disabled") + ' data-field="' + org.key + ':seasonalMultiplier"/></label>' +
              '<div class="org-months">' + monthsHtml + "</div>" +
            "</div>" +
            '<div class="org-field"><span>' +
              '<label class="org-inline"><input type="checkbox" ' + (org.targetPreference ? "checked" : "") + ' data-targetpref-enable="' + org.key + '"/>' + t("org.targetPref") + "</label>" +
            "</span>" +
              (org.targetPreference
                ? '<div class="org-inline">' +
                    '<select data-field="' + org.key + ':targetType">' +
                      TARGETS.map((tt) => '<option value="' + tt + '"' + (tt === org.targetPreference.type ? " selected" : "") + ">" + tt + "</option>").join("") +
                    "</select>" +
                    '<input type="number" step="0.05" min="0" max="1" value="' + org.targetPreference.share + '" data-field="' + org.key + ':targetShare"/>' +
                  "</div>"
                : '<div class="org-inline-note">' + t("org.targetPrefNone") + "</div>") +
            "</div>" +
            '<div class="org-field"><span>' + t("org.preview") + '</span>' +
              '<div class="org-preview" id="org-preview-' + org.key + '">' + previewSvg(org) + "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function sliderRowHtml(def) {
    const strength = currentStrength(def.name);
    return (
      '<div class="org-sig-row">' +
        '<div class="org-sig-head"><span class="org-sig-name">' + t("org.sig." + def.name) + '</span>' +
          '<span class="org-sig-readout" id="readout-' + def.name + '">' + esc(signalReadout(def.name, strength)) + "</span></div>" +
        '<input type="range" min="0" max="2" step="0.05" value="' + strength + '" data-slider="' + def.name + '" id="slider-' + def.name + '"/>' +
        sweepRowHtml(def.name) +
      "</div>"
    );
  }

  function sweepRowHtml(signalName) {
    const active = sweepState && sweepState.signal === signalName;
    const busy = active && sweepState.running;
    const btnLabel = busy ? t("org.sweepBtnBusy", { done: sweepState.progress.done, total: sweepState.progress.total }) : t("org.sweepBtn");
    return (
      '<div class="org-sweep-row">' +
        '<button type="button" data-action="sweep" data-signal="' + signalName + '" ' + (busy ? "disabled" : "") + ">" + esc(btnLabel) + "</button>" +
        (active && !busy && sweepState.points.length ? renderSweepChart(sweepState) : "") +
      "</div>"
    );
  }

  function renderSweepChart(state) {
    const W = 460, H = 200, PAD = 34;
    const points = state.points;
    const x = (s) => PAD + (s / 2) * (W - PAD * 2);
    const y = (v) => H - PAD - clamp01(v) * (H - PAD * 2);
    const m2Path = points.map((p, i) => (i === 0 ? "M" : "L") + x(p.strength).toFixed(1) + " " + y(p.m2Recovered).toFixed(1)).join(" ");
    const m3Path = points.map((p, i) => (i === 0 ? "M" : "L") + x(p.strength).toFixed(1) + " " + y(p.m3Top1).toFixed(1)).join(" ");
    const m3FloorPath = points.map((p, i) => (i === 0 ? "M" : "L") + x(p.strength).toFixed(1) + " " + y(p.m3FloorTop1).toFixed(1)).join(" ");
    const dots = (path, color) =>
      points
        .map((p, i) => '<circle cx="' + x(p.strength).toFixed(1) + '" cy="' + y(path === "m2" ? p.m2Recovered : p.m3Top1).toFixed(1) + '" r="2.5" fill="' + color + '"/>')
        .join("");
    const nw = ORG_COLORS.TIDEBREAK; // m2 곡선(회복 비율)은 조직 색과 무관한 지표라 색은 임의로 배정 — accent 대신 팔레트에 이미 있는 두 색을 재사용
    const ds = ORG_COLORS.DRYSTONE;
    const ticks = SWEEP_STRENGTHS.map((s) => '<text x="' + x(s).toFixed(1) + '" y="' + (H - PAD + 14) + '" font-size="9" fill="var(--ink-mute)" text-anchor="middle">' + s + "</text>").join("");
    const timing = state.timingMs != null ? t("org.sweepTiming", { ms: Math.round(state.timingMs) }) : "";
    return (
      '<div class="org-sweep-chart">' +
        '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' +
          '<rect x="' + PAD + '" y="' + PAD + '" width="' + (W - PAD * 2) + '" height="' + (H - PAD * 2) + '" fill="none" stroke="var(--hair)"/>' +
          // M2 기준선(정의상 0=floor, 1=ceiling)
          '<line x1="' + PAD + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--ink-mute)" stroke-dasharray="2,3"/>' +
          '<line x1="' + PAD + '" y1="' + y(1).toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + y(1).toFixed(1) + '" stroke="var(--ink-mute)" stroke-dasharray="2,3"/>' +
          // M3 스코프별 기준선(포인트마다 다를 수 있어 실선 대신 점선 경로)
          '<path d="' + m3FloorPath + '" fill="none" stroke="' + ds + '" stroke-opacity="0.4" stroke-dasharray="2,3"/>' +
          '<path d="' + m2Path + '" fill="none" stroke="' + nw + '" stroke-width="1.6"/>' + dots("m2", nw) +
          '<path d="' + m3Path + '" fill="none" stroke="' + ds + '" stroke-width="1.6"/>' + dots("m3", ds) +
          ticks +
        "</svg>" +
        '<div class="org-sweep-legend">' +
          '<span><i style="background:' + nw + '"></i>' + t("org.sweepLegendM2") + "</span>" +
          '<span><i style="background:' + ds + '"></i>' + t("org.sweepLegendM3") + "</span>" +
        "</div>" +
        '<div class="org-sweep-note">' + t("org.sweepFloorCeiling") + "</div>" +
        '<div class="org-sweep-note org-sweep-singleseed">' + t("org.sweepSingleSeedNote") + (timing ? " · " + esc(timing) : "") + "</div>" +
      "</div>"
    );
  }

  function runResultHtml() {
    if (runError) return '<div class="org-run-error">' + t("org.runError", { msg: esc(runError) }) + "</div>";
    if (!runResult) return "";
    const c = runResult.ablation.C;
    const recovered = (c.accuracy - c.floor) / (c.ceiling - c.floor);
    const pec = runResult.inference.runs.PEC;
    return (
      '<div class="org-run-result">' +
        '<div class="org-run-title">' + t("org.runResultTitle") + "</div>" +
        '<div>' + t("org.runResultM2", { acc: pct1(c.accuracy), floor: pct1(c.floor), ceil: pct1(c.ceiling), rec: pct1(recovered) }) + "</div>" +
        '<div>' + t("org.runResultM3", { top1: pct1(pec.top1), floor: pct1(pec.floorTop1) }) + "</div>" +
        '<div class="org-run-timing">' + t("org.runResultTiming", { ms: Math.round(runResult.timingMs), n: runResult.eventCount, bg: runResult.backgroundCount, camp: runResult.campaignCount }) + "</div>" +
      "</div>"
    );
  }

  function render() {
    const dirty = isDirty();
    container.innerHTML =
      '<div class="org-view">' +
        '<div class="org-view-head">' +
          '<div><div class="org-view-title">' + t("org.title") + '</div><div class="org-view-subtitle">' + t("org.subtitle") + "</div></div>" +
          '<div class="org-view-actions">' +
            '<button type="button" data-action="reset">' + t("org.resetBtn") + "</button>" +
            '<button type="button" class="org-run-btn" data-action="run" ' + (running ? "disabled" : "") + ">" + (running ? t("org.runBtnBusy") : t("org.runBtn")) + "</button>" +
          "</div>" +
        "</div>" +
        (dirty ? '<div class="org-stale-banner">' + t("org.staleBanner") + "</div>" : "") +
        '<div class="org-run-note">' + t("org.runNote") + "</div>" +
        runResultHtml() +
        '<div class="org-cards">' + ORGS.map((o) => orgCardHtml(orgByKey(o.key))).join("") + "</div>" +
        '<div class="org-signals">' +
          '<div class="org-signals-head"><div class="org-view-title">' + t("org.signalsTitle") + '</div><div class="org-view-subtitle">' + t("org.signalsSubtitle") + "</div></div>" +
          SIGNAL_DEFS.map(sliderRowHtml).join("") +
        "</div>" +
      "</div>";
  }

  // ── 이벤트 위임 — 매 render()가 innerHTML을 통째로 새로 그리므로, 컨테이너 자체에 한 번만
  // 리스너를 건다(자식이 매번 재생성돼도 컨테이너 리스너는 그대로 살아있다). ─────────────────
  // 주의: 'input'(타이핑 중/슬라이더 드래그 중)에는 절대 render()를 다시 부르지 않는다 — 텍스트
  // 입력 중에 innerHTML을 통째로 바꾸면 포커스·커서 위치·드래그 중인 슬라이더가 다 끊긴다.
  // 그 대신 값만 draft에 반영하고, 미리보기·배지·슬라이더 옆 읽기값만 부분적으로 다시 그린다.
  // 구조가 바뀌는 이벤트(체크박스 토글/버튼 클릭/드롭다운 선택)는 'change'/'click'에서 render()를
  // 그대로 부른다 — 이때는 포커스를 지킬 대상이 없거나(체크박스/버튼) select가 이미 닫혔으므로 안전하다.
  container.addEventListener("input", (e) => {
    const el = e.target;
    if (el.matches("[data-field]")) {
      applyFieldInput(el);
      patchLive();
    } else if (el.matches("[data-slider]")) {
      applySliderInput(el);
      patchLive();
    }
  });

  container.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("[data-field]")) {
      applyFieldInput(el);
      render();
    } else if (el.matches("[data-month]")) {
      const [key, m] = el.dataset.month.split(":");
      toggleMonth(key, Number(m));
    } else if (el.matches("[data-seasonal-enable]")) {
      toggleSeasonalEnable(el.dataset.seasonalEnable, el.checked);
    } else if (el.matches("[data-targetpref-enable]")) {
      toggleTargetPrefEnable(el.dataset.targetprefEnable, el.checked);
    }
  });

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "reset") resetToDefaults();
    else if (action === "run") runNow();
    else if (action === "sweep") runSweep(btn.dataset.signal);
  });

  /** 'input' 이벤트(타이핑/드래그 도중) 전용 — 포커스가 있는 요소는 절대 건드리지 않고,
   * 미리보기 SVG·스테일 배지·슬라이더 읽기값만 부분적으로 갱신한다. */
  function patchLive() {
    const banner = container.querySelector(".org-stale-banner");
    const dirty = isDirty();
    if (dirty && !banner) {
      // 배지가 아직 없으면 어쩔 수 없이 한 번은 통째로 다시 그려야 한다(구조 변경) — 하지만
      // 그 순간 포커스가 텍스트 입력에 있었다면 그 한 번은 잃는다. 실사용에서는 첫 편집 직후
      // 딱 한 번만 발생하므로(그 뒤로는 banner가 이미 있어 아래 분기로 빠진다) 허용 가능한 절충이다.
      render();
      return;
    }
    if (banner) banner.hidden = !dirty;

    ORGS.forEach((o) => {
      const org = orgByKey(o.key);
      const previewEl = container.querySelector("#org-preview-" + o.key);
      if (previewEl) previewEl.innerHTML = previewSvg(org);
    });

    SIGNAL_DEFS.forEach((def) => {
      const strength = currentStrength(def.name);
      const readoutEl = container.querySelector("#readout-" + def.name);
      if (readoutEl) readoutEl.textContent = signalReadout(def.name, strength);
      const sliderEl = container.querySelector("#slider-" + def.name);
      if (sliderEl && document.activeElement !== sliderEl) sliderEl.value = String(strength);
    });
  }

  onLangChange(render);
  deps.onStateChange(() => {}); // 계약 유지용 구독 — 이 뷰는 시간창/스코프에 반응할 내용이 없다.

  return { render };
}
