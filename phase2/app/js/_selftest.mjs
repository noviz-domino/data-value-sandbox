// 자체 검증 스크립트. Node에서 `node phase2/app/js/_selftest.mjs`로 실행한다.
// ne_110m_land.geojson을 읽어 makeLandTest를 만들고 simulate()를 돌린 뒤,
// SPEC.md §17의 기준 4/5(planted signal 검증)와 이벤트 총량을 체크한다.
// 임시 산출용 스크립트이며 phase2/app/js/ 밖의 파일은 건드리지 않는다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeLandTest, dest } from "./geo.js";
import { simulate } from "./simulation.js";
import { ORGS } from "./organizations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "..", "data", "ne_110m_land.geojson");

const ne110 = JSON.parse(readFileSync(dataPath, "utf8"));
const landTest = makeLandTest(ne110);

const SEED = 20260903;
const result = simulate({ seed: SEED, landTest });
const { events, periods, byDay, days } = result;

let allPass = true;
function check(name, pass, detail) {
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
  if (!pass) allPass = false;
}

// --- 0. determinism: 같은 seed로 다시 돌려서 이벤트 개수/첫 이벤트/마지막 이벤트가 같은지 ---
const result2 = simulate({ seed: SEED, landTest });
const deterministic =
  result2.events.length === events.length &&
  JSON.stringify(result2.events[0]) === JSON.stringify(events[0]) &&
  JSON.stringify(result2.events[events.length - 1]) === JSON.stringify(events[events.length - 1]);
check("determinism (same seed -> identical events)", deterministic, `events=${events.length} vs ${result2.events.length}`);

// --- 1. total events 1500-3000 ---
check("total events in [1500, 3000]", events.length >= 1500 && events.length <= 3000, `total=${events.length}`);

// --- 2. TIDEBREAK base longitude drift (last day - first day) 8.2-8.4 deg ---
// currentBase(day) = dest(base, bearing=90, 0.5*day) 이므로 직접 계산해서 비교한다.
const tide = ORGS.find((o) => o.key === "TIDEBREAK");
const baseDay0 = dest(tide.base[0], tide.base[1], 90, tide.driftKmPerDay * 0);
const baseDayLast = dest(tide.base[0], tide.base[1], 90, tide.driftKmPerDay * (days - 1));
const lonDrift = baseDayLast[1] - baseDay0[1];
check(
  "TIDEBREAK base longitude drift in [8.2, 8.4] deg",
  lonDrift >= 8.2 && lonDrift <= 8.4,
  `drift=${lonDrift.toFixed(4)} deg (day0 lon=${baseDay0[1].toFixed(4)}, dayLast lon=${baseDayLast[1].toFixed(4)})`
);

// --- 3. TIDEBREAK mean-event-longitude drift (final year vs first year) >= 6 deg ---
const tideEvents = events.filter((e) => e.org === "TIDEBREAK");
const firstYear = tideEvents.filter((e) => e.day < 365);
const finalYear = tideEvents.filter((e) => e.day >= days - 365);
const mean = (arr, key) => arr.reduce((a, e) => a + e[key], 0) / arr.length;
const meanLonFirst = mean(firstYear, "lon");
const meanLonFinal = mean(finalYear, "lon");
const meanDrift = meanLonFinal - meanLonFirst;
check(
  "TIDEBREAK mean-event-longitude drift (final year - first year) >= 6 deg",
  meanDrift >= 6,
  `firstYear n=${firstYear.length} meanLon=${meanLonFirst.toFixed(3)}, finalYear n=${finalYear.length} meanLon=${meanLonFinal.toFixed(3)}, drift=${meanDrift.toFixed(3)}`
);

// --- 4. DRYSTONE Dec-Feb event count is 25-35% of avg other-month monthly count ---
const D0 = Date.UTC(2026, 0, 1);
function monthOf(day) {
  return new Date(D0 + day * 86400000).getUTCMonth() + 1;
}
const dryEvents = events.filter((e) => e.org === "DRYSTONE");
const winterMonths = new Set([12, 1, 2]);
let winterCount = 0;
const otherMonthCounts = {}; // month(1-11 excl winter) -> count, spread across however many distinct (year,month) occurrences
const otherMonthDayBuckets = {}; // "year-month" -> count, to get a proper monthly average
const winterDayBuckets = {};
dryEvents.forEach((e) => {
  const d = new Date(D0 + e.day * 86400000);
  const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
  const m = d.getUTCMonth() + 1;
  if (winterMonths.has(m)) {
    winterCount++;
    winterDayBuckets[key] = (winterDayBuckets[key] || 0) + 1;
  } else {
    otherMonthDayBuckets[key] = (otherMonthDayBuckets[key] || 0) + 1;
  }
});
const otherMonthKeys = Object.keys(otherMonthDayBuckets);
const winterMonthKeys = Object.keys(winterDayBuckets);
const avgOtherMonthly = otherMonthKeys.reduce((a, k) => a + otherMonthDayBuckets[k], 0) / otherMonthKeys.length;
const avgWinterMonthly = winterMonthKeys.reduce((a, k) => a + winterDayBuckets[k], 0) / winterMonthKeys.length;
const winterRatio = avgWinterMonthly / avgOtherMonthly;
check(
  "DRYSTONE Dec-Feb avg monthly count is 25-35% of other-months avg monthly count",
  winterRatio >= 0.25 && winterRatio <= 0.35,
  `avgWinterMonthly=${avgWinterMonthly.toFixed(2)}, avgOtherMonthly=${avgOtherMonthly.toFixed(2)}, ratio=${(winterRatio * 100).toFixed(1)}%`
);

// --- 5. zero naval events fall on non-land (must be land, and satisfy the coastal rule) ---
const navalEvents = events.filter((e) => e.branch === "naval");
const badNaval = navalEvents.filter((e) => !landTest.isCoastal(e.lat, e.lon, 30));
check(
  "zero naval events fail the coastal(30km) rule",
  badNaval.length === 0,
  `naval total=${navalEvents.length}, failing=${badNaval.length}`
);

// --- extra sanity: byDay shape ---
check(
  "byDay shape: number[day][orgIndex], days=1826, 3 orgs",
  byDay.length === days && byDay[0].length === ORGS.length,
  `byDay.length=${byDay.length}, byDay[0].length=${byDay[0].length}`
);

console.log("\nsummary: total events =", events.length, " periods =", periods.length);
console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(allPass ? 0 : 1);
