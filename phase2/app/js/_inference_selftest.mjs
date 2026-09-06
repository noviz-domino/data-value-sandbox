// inference.js 자체 검증 스크립트. Node에서 `node phase2/app/js/_inference_selftest.mjs`로 실행한다.
// simulate({ withCampaigns: true })로 배경+캠페인 이벤트를 만들고 evaluateInference()를 돌려,
// SPEC_M3.md §5.4가 요구하는 8개 조건을 확인한다.
// 임시 산출용 스크립트이며 phase2/app/js/ 밖의 파일은 건드리지 않는다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeLandTest } from "./geo.js";
import { simulate } from "./simulation.js";
import { runAblation } from "./analysis.js";
import { evaluateInference } from "./inference.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const landDataPath = join(__dirname, "..", "data", "ne_110m_land.geojson");
const facilitiesPath = join(__dirname, "..", "data", "facilities.json");

const ne110 = JSON.parse(readFileSync(landDataPath, "utf8"));
const landTest = makeLandTest(ne110);
// simulate()는 facilities.json을 파싱한 "원본 객체"({facilities:[...]})를 그대로 기대한다
// (내부에서 facilities.facilities로 배열을 꺼낸다) — 여기서 미리 배열로 destructure하지 않는다.
const facilitiesRaw = JSON.parse(readFileSync(facilitiesPath, "utf8"));

const SEED = 20260903;

let allPass = true;
function check(name, pass, detail) {
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
  if (!pass) allPass = false;
}

// --- 1. withCampaigns:false는 M2와 동일해야 한다 (이벤트 수, ablation) ---
const baseline = simulate({ seed: SEED, landTest });
const withFlagFalse = simulate({ seed: SEED, landTest, withCampaigns: false });
check(
  "1. withCampaigns:false event count matches M2 baseline",
  withFlagFalse.events.length === baseline.events.length,
  `baseline=${baseline.events.length} flagFalse=${withFlagFalse.events.length}`
);
const baseAblation = runAblation({ events: baseline.events, periods: baseline.periods, seed: SEED });
const flagFalseAblation = runAblation({ events: withFlagFalse.events, periods: withFlagFalse.periods, seed: SEED });
check(
  "1b. withCampaigns:false ablation (run C accuracy) matches M2 baseline",
  Math.abs(baseAblation.C.accuracy - flagFalseAblation.C.accuracy) < 1e-9,
  `baseline C accuracy=${(baseAblation.C.accuracy * 100).toFixed(2)}% flagFalse=${(flagFalseAblation.C.accuracy * 100).toFixed(2)}%`
);

// --- withCampaigns:true 런 (이후 검증들의 공통 fixture) ---
// simulate()가 돌려주는 facilities는 facilityList(배열) 그 자체이므로, 이후 코드는 전부 이 값을 쓴다.
const { events, periods, days, campaigns, facilities } = simulate({
  seed: SEED,
  landTest,
  facilities: facilitiesRaw,
  withCampaigns: true,
});

// --- 2. 캠페인 비중이 전체 이벤트의 18~22%인지 ---
const campaignEventCount = campaigns.reduce((s, c) => s + c.eventIds.length, 0);
const campaignShare = campaignEventCount / events.length;
check(
  "2. campaign share is 18-22% of all events",
  campaignShare >= 0.18 && campaignShare <= 0.22,
  `share=${(campaignShare * 100).toFixed(1)}% (${campaignEventCount}/${events.length})`
);

// --- 3. 모든 캠페인의 eventIds가 서로 겹치지 않고 전부 실존하는지 ---
const eventIdSet = new Set(events.map((e) => e.id));
const seenIds = new Set();
let disjointOk = true;
let allExistOk = true;
for (const camp of campaigns) {
  for (const id of camp.eventIds) {
    if (!eventIdSet.has(id)) allExistOk = false;
    if (seenIds.has(id)) disjointOk = false;
    seenIds.add(id);
  }
}
check("3. campaign eventIds are disjoint across campaigns", disjointOk, `total campaign event refs=${campaignEventCount}, unique=${seenIds.size}`);
check("3b. every campaign eventId exists in events", allExistOk, `checked ${campaignEventCount} ids against ${events.length} events`);

// --- 4. 어떤 캠페인 이벤트도 표적으로부터 1.5km 이내에 있지 않은지 ---
import { haversineKm } from "./geo.js";
const facilityById = new Map(facilities.map((f) => [f.id, f]));
const eventById = new Map(events.map((e) => [e.id, e]));
let minDist = Infinity;
let violations = 0;
for (const camp of campaigns) {
  const target = facilityById.get(camp.targetId);
  if (!target) continue;
  for (const id of camp.eventIds) {
    const e = eventById.get(id);
    if (!e) continue;
    const d = haversineKm(target.lat, target.lon, e.lat, e.lon);
    if (d < minDist) minDist = d;
    if (d < 1.5) violations++;
  }
}
check("4. no campaign event within 1.5km of its target", violations === 0, `violations=${violations}, min observed distance=${minDist.toFixed(3)}km`);

// --- 평가: P/PE/PEC 사다리, 5시드 풀링 (§5.3 재작성판) ---
// evaluateInference는 이제 고정된 events/campaigns 한 벌이 아니라, "시드를 넣으면 새 시뮬레이션을
// 돌려주는 함수"를 받는다 — 5개 시드를 풀링하려면 시드마다 캠페인 배치 자체가 달라야 하기 때문이다
// (컨트롤 윈도우 RNG만 바꿔서는 캠페인 표본이 늘지 않는다). inference.js는 simulation.js를 직접
// import하지 않으므로, "시드 -> 시뮬레이션 결과" 책임은 여기(호출부)에서 진다.
const simulateFn = (s) => simulate({ seed: s, landTest, facilities: facilitiesRaw, withCampaigns: true });

const evalResult = evaluateInference({ simulateFn, seed: SEED, seeds: 5 });
const { runs } = evalResult;

const fmtPct = (x) => `${(x * 100).toFixed(1)}%`;
const fmtRange = (r) => `[${fmtPct(r[0])}–${fmtPct(r[1])}]`;
const fmtNumRange = (r) => `[${r[0].toFixed(1)}–${r[1].toFixed(1)}]`;

console.log("\n=== P/PE/PEC table (5시드 풀링, 괄호는 시드 간 range) ===");
console.log(
  "set | top1              | floor1 | lift | top5              | floor5 | det@10%FAR         | meanCandidates"
);
for (const key of ["P", "PE", "PEC"]) {
  const r = runs[key];
  console.log(
    `${key.padEnd(3)} | ${fmtPct(r.top1).padStart(6)} ${fmtRange(r.top1Range).padEnd(11)} | ` +
      `${fmtPct(r.floorTop1).padStart(6)} | ${r.lift.toFixed(2).padStart(4)}x | ` +
      `${fmtPct(r.top5).padStart(6)} ${fmtRange(r.top5Range).padEnd(11)} | ` +
      `${fmtPct(r.floorTop5).padStart(6)} | ${fmtPct(r.detectionAt10FAR).padStart(6)} ${fmtRange(r.detectionAt10FARRange).padEnd(11)} | ` +
      `${evalResult.meanCandidatesInScope.toFixed(1)} ${fmtNumRange(evalResult.meanCandidatesInScopeRange)}`
  );
}
console.log(
  `campaignsEvaluated(pooled, 5 seeds)=${evalResult.campaignsEvaluated} seedsUsed=${JSON.stringify(evalResult.seedsUsed)}`
);

// --- §5.3 요구: 통제·캠페인 두 z 분포를 50/90/99th percentile로 함께 보고한다.
// 이러면 문턱(=통제 z의 90th pct)이 어디 있는지, 분포가 최댓값에 몰려 포화됐는지가
// 숫자 하나(탐지율 0%) 뒤에 숨지 않고 바로 드러난다.
const fmtZ = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
console.log("\n=== z(standout score) 분포: 통제 구간 vs 캠페인 (풀링, 5시드) ===");
console.log("set | threshold(=controlZ p90) | control z [p50/p90/p99] | campaign z [p50/p90/p99]");
for (const key of ["P", "PE", "PEC"]) {
  const r = runs[key];
  console.log(
    `${key.padEnd(3)} | ${fmtZ(r.operatingThreshold).padStart(10)} | ` +
      `[${fmtZ(r.controlZP50)} / ${fmtZ(r.controlZP90)} / ${fmtZ(r.controlZP99)}] | ` +
      `[${fmtZ(r.campaignZP50)} / ${fmtZ(r.campaignZP90)} / ${fmtZ(r.campaignZP99)}]`
  );
}

// --- §5.3 재작성판: 통제 구간과 캠페인 구간이 "같은 규칙으로" 뽑혔는지, 스코프 안 이벤트 수를
// side-by-side로 비교해 확인한다. 20% 넘게 차이 나면 둘이 아직 비교 가능하지 않다는 뜻이라
// 탐지율 숫자를 신뢰할 수 없다 — 그 경우 여기서 명시적으로 경고한다(가짜로 통과시키지 않는다).
const meanEvCampaign = evalResult.meanEventsInScopeCampaign;
const meanEvControl = evalResult.meanEventsInScopeControl;
const evDiffPct = meanEvCampaign > 0 ? Math.abs(meanEvControl - meanEvCampaign) / meanEvCampaign : Infinity;
console.log("\n=== 스코프 안 이벤트 수: 캠페인 창 vs 통제 창 (side-by-side) ===");
console.log(
  `campaign windows: mean events in scope = ${meanEvCampaign.toFixed(2)}\n` +
    `control  windows: mean events in scope = ${meanEvControl.toFixed(2)}\n` +
    `diff = ${(evDiffPct * 100).toFixed(1)}%`
);
if (evDiffPct > 0.2) {
  console.log(
    `[WARN] 캠페인 창과 통제 창의 평균 이벤트 수가 20% 넘게 차이난다(volume-confounded) — 위 ` +
      `unmatched detection@10%FAR 수치는 "이벤트 수만 세도 이길 수 있는" 상태이므로 신뢰할 수 ` +
      `없다(§5.3). 아래 밀도 매칭(density-matched) 수치를 봐야 한다.`
  );
} else {
  console.log(`[INFO] 두 창의 평균 이벤트 수 차이가 20% 이내다 — 비교 가능한 것으로 본다.`);
}

// --- §5.3 재작성판 "Density-match the controls": 캠페인 창마다 이벤트 수 N이 맞는(0.8N~1.2N)
// 통제 창을 최대 200회 거부-샘플링으로 찾아 짝짓고, 그 짝 위에서만 detection@10%FAR을 다시 잰다.
// unmatched 수치(위)는 "이벤트 수만 세도 되는" 오염된 채점이었을 수 있다 — 이게 진짜 채점이다.
console.log("\n=== 밀도 매칭(density-matched) 통제: 짝지은 캠페인/통제 창의 이벤트 수 ===");
for (const key of ["P", "PE", "PEC"]) {
  const r = runs[key];
  console.log(
    `${key.padEnd(3)} | matched pairs=${r.matchedPairCount} | unmatched share=${fmtPct(r.unmatchedCampaignShare)} | ` +
      `campaign mean events(matched)=${r.meanEventsInScopeCampaignMatched.toFixed(2)} | ` +
      `control mean events(matched)=${r.meanEventsInScopeControlMatched.toFixed(2)}`
  );
}

console.log("\n=== 밀도 매칭 detection@10%FAR (unmatched와 나란히 비교) ===");
console.log("set | det@10%FAR (unmatched, volume-confounded) | det@10%FAR (matched)              | matched threshold");
for (const key of ["P", "PE", "PEC"]) {
  const r = runs[key];
  console.log(
    `${key.padEnd(3)} | ${fmtPct(r.detectionAt10FAR).padStart(6)} ${fmtRange(r.detectionAt10FARRange).padEnd(20)} | ` +
      `${fmtPct(r.detectionAt10FARMatched).padStart(6)} ${fmtRange(r.detectionAt10FARMatchedRange).padEnd(20)} | ` +
      `${fmtZ(r.matchedOperatingThreshold)}`
  );
}

console.log("\n=== 밀도 매칭 z 분포: 통제 vs 캠페인 (짝지은 것만, 풀링) ===");
console.log("set | threshold(=matched controlZ p90) | control z [p50/p90/p99] | campaign z [p50/p90/p99]");
for (const key of ["P", "PE", "PEC"]) {
  const r = runs[key];
  console.log(
    `${key.padEnd(3)} | ${fmtZ(r.matchedOperatingThreshold).padStart(10)} | ` +
      `[${fmtZ(r.matchedControlZP50)} / ${fmtZ(r.matchedControlZP90)} / ${fmtZ(r.matchedControlZP99)}] | ` +
      `[${fmtZ(r.matchedCampaignZP50)} / ${fmtZ(r.matchedCampaignZP90)} / ${fmtZ(r.matchedCampaignZP99)}]`
  );
}

// encirclement는 pass/fail 판정 대상이 아니다 (§5.4) — 효과를 그대로 출력만 한다.
const peEffectPP = (runs.PE.top1 - runs.P.top1) * 100;
if (Math.abs(peEffectPP) < 0.05) {
  console.log(
    `[INFO] encirclement 효과: PE.top1 == P.top1 (delta=${peEffectPP.toFixed(2)}pp) — 완전히 평평함. ` +
      `이 지리적 배치에서 방위각 퍼짐(bearing spread)은 쓸 만한 신호가 아니라는 뜻으로 판단, 튜닝하지 않고 그대로 보고한다.`
  );
} else {
  console.log(`[INFO] encirclement 효과: PE.top1 - P.top1 = ${peEffectPP.toFixed(2)}pp`);
}

// --- 5. PEC.top1 >= 2x scope-relative floor (재작성판: 3x -> 2x) ---
check(
  "5. PEC.top1 >= 2x scope-relative top1 floor",
  runs.PEC.top1 >= 2 * runs.PEC.floorTop1,
  `PEC.top1=${fmtPct(runs.PEC.top1)} floor=${fmtPct(runs.PEC.floorTop1)} (2x=${fmtPct(2 * runs.PEC.floorTop1)})`
);

// --- 6. PEC.top1 - P.top1 >= 8pp (풀링된 5시드 결과 기준. pooled SE~3pp이므로 8pp면 우연이 아니다) ---
const ladderDeltaPP = (runs.PEC.top1 - runs.P.top1) * 100;
check(
  "6. PEC.top1 - P.top1 >= 8pp (pooled)",
  ladderDeltaPP >= 8,
  `P=${fmtPct(runs.P.top1)} PEC=${fmtPct(runs.PEC.top1)} delta=${ladderDeltaPP.toFixed(1)}pp`
);

// --- 7. PEC의 10%FAR 탐지율이 P보다 높고, 문턱 계산 자체가 퇴화(degenerate)하지 않았는지 ---
// "퇴화하지 않았다"는 것은 통제 구간 z 분포가 자기 최댓값(p99)에 뭉쳐 있지 않다는 뜻이다.
// 확률 기반 문턱이 실패했던 방식(30%가 부동소수점 1.0에 포화 -> p50==p90==p99==1.0)이
// 그대로 재현되지 않는지 PEC 기준으로 확인한다.
const pecNonDegenerate =
  Number.isFinite(runs.PEC.controlZP90) && runs.PEC.controlZP99 - runs.PEC.controlZP50 > 1e-6;
check(
  "7a. PEC detection@10%FAR > P detection@10%FAR",
  runs.PEC.detectionAt10FAR > runs.P.detectionAt10FAR,
  `P=${fmtPct(runs.P.detectionAt10FAR)} PEC=${fmtPct(runs.PEC.detectionAt10FAR)}`
);
check(
  "7b. calibration is non-degenerate (control z not concentrated at its max)",
  pecNonDegenerate,
  `PEC control z p50=${fmtZ(runs.PEC.controlZP50)} p90=${fmtZ(runs.PEC.controlZP90)} p99=${fmtZ(runs.PEC.controlZP99)}`
);

// --- 8. 결정성: 같은 seed로 두 번 실행하면 동일한 순위(풀링 결과)가 나오는지 ---
const evalResult2 = evaluateInference({ simulateFn, seed: SEED, seeds: 5 });
let deterministicOk = true;
for (const key of ["P", "PE", "PEC"]) {
  const a = runs[key];
  const b = evalResult2.runs[key];
  if (a.top1 !== b.top1 || a.top5 !== b.top5 || a.detectionAt10FAR !== b.detectionAt10FAR) {
    deterministicOk = false;
  }
}
check("8. determinism: two runs with same seed give identical results", deterministicOk, deterministicOk ? "identical" : "mismatch detected");

console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(allPass ? 0 : 1);
