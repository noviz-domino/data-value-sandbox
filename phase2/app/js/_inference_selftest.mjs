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

// --- 평가: P/PE/PEC 사다리 ---
const evalResult = evaluateInference({ events, facilities, campaigns, days, seed: SEED });
const { runs, floor } = evalResult;

console.log("\n=== P/PE/PEC table ===");
console.log("set | top1    | top5    | falseAlarmRate | meanEventsInScope");
for (const key of ["P", "PE", "PEC"]) {
  const r = runs[key];
  console.log(
    `${key.padEnd(3)} | ${(r.top1 * 100).toFixed(1).padStart(6)}% | ${(r.top5 * 100).toFixed(1).padStart(6)}% | ${(r.falseAlarmRate * 100).toFixed(1).padStart(13)}% | ${r.meanEventsInScope.toFixed(1)}`
  );
}
console.log(`floor: top1=${(floor.top1 * 100).toFixed(2)}% top5=${(floor.top5 * 100).toFixed(2)}%`);

// --- 5. PEC.top1 >= 3x floor.top1 ---
check(
  "5. PEC.top1 >= 3x top1 floor",
  runs.PEC.top1 >= 3 * floor.top1,
  `PEC.top1=${(runs.PEC.top1 * 100).toFixed(1)}% floor.top1=${(floor.top1 * 100).toFixed(2)}% (3x=${(3 * floor.top1 * 100).toFixed(2)}%)`
);

// --- 6. 사다리: PEC > PE > P, PEC - P >= 10pp ---
check(
  "6a. ladder holds: PEC.top1 > PE.top1 > P.top1",
  runs.PEC.top1 > runs.PE.top1 && runs.PE.top1 > runs.P.top1,
  `P=${(runs.P.top1 * 100).toFixed(1)}% PE=${(runs.PE.top1 * 100).toFixed(1)}% PEC=${(runs.PEC.top1 * 100).toFixed(1)}%`
);
const ladderDeltaPP = (runs.PEC.top1 - runs.P.top1) * 100;
check(
  "6b. PEC.top1 - P.top1 >= 10pp",
  ladderDeltaPP >= 10,
  `delta=${ladderDeltaPP.toFixed(1)}pp`
);

// --- 7. PEC.falseAlarmRate <= 0.25 ---
check(
  "7. PEC.falseAlarmRate <= 0.25",
  runs.PEC.falseAlarmRate <= 0.25,
  `falseAlarmRate=${(runs.PEC.falseAlarmRate * 100).toFixed(1)}%`
);

// --- 8. 결정성: 같은 seed로 두 번 실행하면 동일한 순위가 나오는지 ---
const evalResult2 = evaluateInference({ events, facilities, campaigns, days, seed: SEED });
let deterministicOk = true;
for (const key of ["P", "PE", "PEC"]) {
  const a = runs[key];
  const b = evalResult2.runs[key];
  if (a.top1 !== b.top1 || a.top5 !== b.top5 || a.falseAlarmRate !== b.falseAlarmRate) {
    deterministicOk = false;
  }
}
check("8. determinism: two runs with same seed give identical results", deterministicOk, deterministicOk ? "identical" : "mismatch detected");

console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(allPass ? 0 : 1);
