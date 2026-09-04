// 시뮬레이션 엔진: 5년(1826일) 동안 매일 세 조직의 사건을 생성한다.
// 로직은 프로토타입(phase2/prototype/index.html)의 EV/PER 빌드 루프를 포팅한 것이며,
// 규칙 자체(확률, 배율, 반경)는 SPEC.md §6~§7이 기준이다.
// 모든 난수는 반드시 하나의 mulberry32 스트림(rng)을 통해서만 뽑는다 — Math.random()은 절대 쓰지 않는다.
// 이래야 같은 seed로 두 번 돌려도 이벤트가 완전히 동일하게(byte-identical) 나온다 (SPEC §6.1 determinism).

import { mulberry32 } from "./rng.js";
import { dest } from "./geo.js";
import { ORGS, DIRECTIVES, METHODS, TARGETS, RANGE } from "./organizations.js";

const DAYS = 1826; // 5년 (2026-01-01 ~ 2030-12-30 부근)
const START_DATE = "2026-01-01";

// 하루하루 실제 달(month)을 구하기 위한 기준 시각. UTC로 고정해 타임존에 따라 날짜가
// 흔들리지 않게 한다.
const D0 = Date.UTC(2026, 0, 1);

/** day 인덱스(0부터)로부터 UTC 월(1~12)을 구한다. */
function monthOf(day) {
  const d = new Date(D0 + day * 86400000);
  return d.getUTCMonth() + 1;
}

/**
 * 누적 가중치 방식의 가중 랜덤 선택.
 * @param {() => number} rng - [0,1) 난수 생성 함수
 * @param {string[]} values - 후보 값들
 * @param {number[]} weights - 각 후보의 가중치 (합이 1일 필요는 없음, 비율만 맞으면 됨)
 * @returns {string} 선택된 값
 */
function weightedPick(rng, values, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < values.length; i++) {
    r -= weights[i];
    if (r < 0) return values[i];
  }
  return values[values.length - 1]; // 부동소수점 오차로 못 빠져나온 경우의 안전장치
}

/** 평균 mean인 지수분포(exponential distribution)에서 표본 하나를 뽑는다. 역변환 표본추출법. */
function sampleExponential(rng, mean) {
  return -mean * Math.log(1 - rng());
}

/**
 * 5년치 시뮬레이션을 실행한다.
 * @param {{ seed: number, landTest: { isLand:(lon:number,lat:number)=>boolean, isCoastal:(lat:number,lon:number,km?:number)=>boolean } }} params
 * @returns {{ events: object[], periods: object[], byDay: number[][], days: number, startDate: string }}
 */
export function simulate({ seed, landTest }) {
  const rng = mulberry32(seed);
  const { isLand, isCoastal } = landTest;

  const events = [];
  const periods = []; // 완결된 지침(directive) 구간들 {org, directive, startDay, endDay}
  const byDay = Array.from({ length: DAYS }, () => ORGS.map(() => 0));

  // 조직별 커맨드 레이어 상태: 현재 지침, 지침 만료일, 현재 지침이 시작된 날짜
  const state = ORGS.map(() => ({ directive: null, expiry: 0, periodStart: 0 }));

  const directiveKeys = Object.keys(DIRECTIVES); // ["EXPAND","CONSOLIDATE","SUPPRESS"]
  const directiveWeights = directiveKeys.map((k) => DIRECTIVES[k].weight);

  let nextEventId = 1;

  for (let day = 0; day < DAYS; day++) {
    const month = monthOf(day);

    ORGS.forEach((org, orgIdx) => {
      const s = state[orgIdx];

      // 1. COMMAND LAYER — 지침 만료일이 지났으면 새 지침을 가중 랜덤으로 뽑는다.
      if (day >= s.expiry) {
        if (s.directive) {
          periods.push({ org: org.key, directive: s.directive, startDay: s.periodStart, endDay: day });
        }
        s.directive = weightedPick(rng, directiveKeys, directiveWeights);
        s.periodStart = day;
        // 다음 지침까지 60~180일 사이 랜덤. Math.floor(rng()*121)은 0~120 정수이므로 60을 더하면 60~180.
        s.expiry = day + 60 + Math.floor(rng() * 121);
      }
      const directive = DIRECTIVES[s.directive];

      // 2. BRANCH LAYER — 이동(drift)하는 조직은 오늘의 실제 중심 좌표를 구한다.
      const center = org.driftKmPerDay
        ? dest(org.base[0], org.base[1], 90, org.driftKmPerDay * day)
        : org.base;
      // 계절 억제: DRYSTONE만 12~2월에 tempo가 줄어든다.
      const seasonalFactor =
        org.seasonal && org.seasonal.months.includes(month) ? org.seasonal.multiplier : 1;

      // 3. UNIT LAYER — 조직이 보유한 각 파벌(branch)마다 오늘 사건이 발생하는지 판정한다.
      org.branches.forEach((branchDef) => {
        const branch = branchDef.type;
        // effectiveTempo = baseTempo * directiveMult * seasonalFactor, 파벌 수만큼 나눠 배분.
        // 마지막 *1.9는 프로토타입에서 그대로 가져온 튜닝 상수:
        // 5년 합계 이벤트 수가 SPEC §17이 요구하는 1500~2500(본 프로젝트 목표 1500~3000) 구간에
        // 들어오도록 40회 rejection sampling으로 인한 실패율(특히 naval/좁은 반경)을 보정한다.
        const tempo =
          (org.baseTempo * directive.tempoMult * seasonalFactor) / org.branches.length * 1.9;
        if (rng() >= tempo) return; // 오늘 이 파벌은 사건 없음

        const effectiveRadius = Math.min(RANGE[branch], org.baseRadius * directive.radiusMult);

        // placeEvent: 반경 안에서 좌표를 40번까지 시도해 파벌 조건(육지/연안)을 만족하는 점을 찾는다.
        for (let attempt = 0; attempt < 40; attempt++) {
          const bearing = rng() * 360;
          // sqrt(rng())로 거리를 뽑아야 면적 기준으로 균등해진다. 그냥 rng()*radius를 쓰면
          // 중심 근처에 점이 쏠리는 인공적인 밀도 구배가 생겨버린다 (SPEC §6.3).
          const distance = effectiveRadius * Math.sqrt(rng());
          const [la, lo] = dest(center[0], center[1], bearing, distance);

          const valid = branch === "naval" ? isCoastal(la, lo, 30) : isLand(lo, la);
          if (!valid) continue;

          // 위치가 확정됐으니 나머지 속성을 채운다.
          const methodDef = METHODS[branch];
          const method = weightedPick(rng, methodDef.values, methodDef.weights);

          let target;
          if (org.targetPreference && rng() < org.targetPreference.share) {
            target = org.targetPreference.type;
          } else {
            target = TARGETS[Math.floor(rng() * TARGETS.length)];
          }

          const success = rng() < 0.72; // 조직과 무관하게 균일 — 의도적으로 신호가 없는(noise) 컬럼
          const casualties = success ? Math.floor(sampleExponential(rng, 2.4)) : 0;

          events.push({
            id: nextEventId++,
            day,
            lat: la,
            lon: lo,
            org: org.key,
            branch,
            method,
            target,
            success,
            casualties,
          });
          byDay[day][orgIdx]++;
          break; // 이 파벌은 오늘 사건 하나만 발생
        }
      });
    });
  }

  // 시뮬레이션이 끝난 시점에도 아직 열려 있는 지침 구간을 마감한다.
  state.forEach((s, i) => {
    if (s.directive) {
      periods.push({ org: ORGS[i].key, directive: s.directive, startDay: s.periodStart, endDay: DAYS });
    }
  });

  return { events, periods, byDay, days: DAYS, startDate: START_DATE };
}
