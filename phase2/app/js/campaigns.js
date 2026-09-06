// 캠페인(작전) 생성 로직. SPEC_M3.md §4.2~§4.5.
// 배경(noise) 이벤트는 simulation.js의 기존 지침(directive) 루프가 그대로 만든다.
// 이 파일은 그 위에 "특정 시설을 노리는 사전 정지(preparatory) 이벤트 다발"을 얹는 것만 담당한다.
// 배경 생성기와 마찬가지로 모든 난수는 인자로 받은 하나의 rng 스트림만 사용한다 — 이래야
// simulate()가 background 루프 뒤에 이 함수를 이어 호출해도 seed 하나로 전체가 재현된다.

import { haversineKm, dest } from "./geo.js";

// ── §4.2 캠페인 일정 상수 ─────────────────────────────────────────────
const CAMPAIGN_FIRST_START = 40; // 조직당 첫 캠페인 시작일(지터 전)
const CAMPAIGN_INTERVAL = 100; // 캠페인 간격(일)
const CAMPAIGN_START_JITTER = 15; // 시작일 지터 ±일
const CAMPAIGN_DURATION = 60; // 캠페인 길이(일)
const EVENTS_PER_CAMPAIGN = 12; // 캠페인당 사전 정지 이벤트 개수(지터 전)
const EVENTS_JITTER = 3; // 이벤트 개수 지터 ±개

// ── §4.3 표적 선정 상수 ──────────────────────────────────────────────
const TARGET_RADIUS_NEAR_KM = 150; // 1차: 조직 거점에서 이 반경 안의 시설 후보
const TARGET_RADIUS_WIDE_KM = 300; // 후보가 3곳 미만이면 이 반경까지 넓힌다
const TARGET_MIN_CANDIDATES = 3;

// ── §4.4 사전 정지 이벤트 배치 상수 ───────────────────────────────────
const DAY_JITTER = 3; // 이벤트별 날짜 지터 ±일
const RADIUS_AT_P0_KM = 28; // progress=0(캠페인 초입)일 때 표적으로부터의 고리 반경
const RADIUS_AT_P1_KM = 4; // progress=1(캠페인 막바지)일 때 반경 — 갈수록 표적에 가까워짐(convergence)
const RADIUS_JITTER_MIN = 0.75; // 반경에 곱하는 지터 배율 하한
const RADIUS_JITTER_RANGE = 0.5; // 지터 배율 폭 (0.75~1.25)
const MIN_DIST_FROM_TARGET_KM = 1.5; // 표적 시설 자체는 절대 사건 지점이 될 수 없다
const MAX_PLACEMENT_ATTEMPTS = 40; // 기존 placeEvent 루프와 동일한 rejection sampling 한도

// ── §4.5 사전 정지 이벤트 속성 상수 ───────────────────────────────────
const CAMPAIGN_METHOD = { values: ["explosive", "firearm", "incendiary"], weights: [0.5, 0.3, 0.2] };

// 시설 종류별 target(공격 대상 유형) 가중치. "정지 행위는 시설 자체가 아니라 그 주변을 때린다"는
// 전제를 반영 — 예를 들어 발전소 캠페인은 infrastructure/transport/commercial을 때리지 government는 없다.
const TARGET_WEIGHTS_BY_KIND = {
  power_plant: { values: ["infrastructure", "transport", "commercial"], weights: [0.55, 0.25, 0.2] },
  port: { values: ["transport", "infrastructure", "commercial"], weights: [0.5, 0.3, 0.2] },
  airport: { values: ["transport", "infrastructure", "government"], weights: [0.55, 0.25, 0.2] },
};

/**
 * 조직이 이 시각(day)에 실제로 위치하는 중심 좌표를 구한다. simulation.js의 배경 생성 루프가
 * 쓰는 것과 완전히 동일한 공식(드리프트하는 조직은 동쪽으로 driftKmPerDay*day만큼 이동)이며,
 * 캠페인 표적도 "조직이 그 시점에 실제로 작전을 벌이는 위치" 기준으로 골라야 하기 때문에
 * simulation.js에서 그대로 가져와(export) 재사용한다. (중복 구현하면 두 값이 갈라질 위험이 있다.)
 * @param {object} org - organizations.js의 ORGS 원소
 * @param {number} day - day 인덱스
 * @returns {[number, number]} [위도, 경도]
 */
export function orgCenterOnDay(org, day) {
  // driftBearing: M4-T3(§3.1) 조직 편집 폼이 표류 방위각을 오버라이드할 수 있게 하는 필드.
  // 없으면(기본 ORGS 전부) simulation.js와 동일하게 90(정동)으로 떨어진다.
  const bearing = org.driftBearing != null ? org.driftBearing : 90;
  return org.driftKmPerDay ? dest(org.base[0], org.base[1], bearing, org.driftKmPerDay * day) : org.base;
}

/**
 * 반경 km 안의 시설만 걸러낸다. haversine을 쓴다 — 위경도에 유클리드 거리를 쓰면 안 된다.
 * @param {object[]} facilities - facilities.json의 facilities 배열
 * @param {[number, number]} center - [위도, 경도]
 * @param {number} radiusKm
 * @returns {object[]} 반경 안의 시설들
 */
function facilitiesWithin(facilities, center, radiusKm) {
  return facilities.filter((f) => haversineKm(center[0], center[1], f.lat, f.lon) <= radiusKm);
}

/**
 * 조직 하나에 대해, 5년 전체 기간에 걸친 캠페인 일정(시작일 목록)을 만든다. SPEC §4.2.
 * 100일 간격, 첫 캠페인 40일차, ±15일 지터. 지터 후 시작일이 전체 기간을 넘으면 그 캠페인은 버린다
 * (SPEC이 요구하는 "~18개/조직"에 맞추기 위해 지터 전 기준일로 루프를 도는 것이 핵심 — 지터 후
 * 값으로 다음 반복 기준을 잡으면 지터가 누적되어 캠페인 수가 흔들린다).
 * @param {() => number} rng
 * @param {number} totalDays - 전체 시뮬레이션 일수(DAYS)
 * @returns {number[]} 지터가 적용된 시작일 목록 (오름차순은 아닐 수 있으나 기준일 자체는 오름차순)
 */
function scheduleStartDays(rng, totalDays) {
  const starts = [];
  for (let base = CAMPAIGN_FIRST_START; base < totalDays; base += CAMPAIGN_INTERVAL) {
    // Math.floor(rng() * 31) - 15 → -15..15 정수 (31가지 값), ±15일 지터.
    const jitter = Math.floor(rng() * (CAMPAIGN_START_JITTER * 2 + 1)) - CAMPAIGN_START_JITTER;
    const startDay = Math.max(0, Math.min(totalDays - 1, base + jitter));
    starts.push(startDay);
  }
  return starts;
}

/**
 * 캠페인 하나의 사전 정지 이벤트들을 생성해 밀어 넣는다.
 * @param {object} params
 * @param {() => number} params.rng
 * @param {(lon:number, lat:number)=>boolean} params.isLand
 * @param {object} params.org - ORGS 원소
 * @param {object} params.target - 이 캠페인이 노리는 시설 (facilities.json 원소)
 * @param {number} params.startDay
 * @param {number} params.endDay
 * @param {() => number} params.allocateId - 다음 이벤트 id를 발급하는 함수 (배경 생성기와 id 공간을 공유)
 * @param {object[]} params.events - 결과를 밀어 넣을 배열 (in-place push)
 * @param {number[][]} params.byDay - 배경 생성기와 동일한 [day][orgIdx] 카운트 배열 (in-place 증가)
 * @param {number} params.orgIdx - byDay 인덱싱용 조직 인덱스
 * @param {(rng:()=>number, mean:number)=>number} params.sampleExponential
 * @param {(rng:()=>number, values:string[], weights:number[])=>string} params.weightedPick
 * @returns {number[]} 실제로 생성된 이벤트들의 id 목록 (rejection sampling 실패로 일부는 빠질 수 있다)
 */
function placeCampaignEvents({
  rng,
  isLand,
  org,
  target,
  startDay,
  endDay,
  allocateId,
  events,
  byDay,
  orgIdx,
  sampleExponential,
  weightedPick,
}) {
  const eventIds = [];

  // 이벤트 개수도 지터 대상: 12 ±3 → 9~15개 (Math.floor(rng()*7)-3 → -3..3 정수).
  const n = EVENTS_PER_CAMPAIGN + (Math.floor(rng() * (EVENTS_JITTER * 2 + 1)) - EVENTS_JITTER);

  const targetWeights = TARGET_WEIGHTS_BY_KIND[target.kind];

  for (let k = 0; k < n; k++) {
    // progress: n=1이면 나눗셈이 0/0이 되므로 그 경우만 p=0으로 취급(사실상 발생하지 않음 — n은 항상 9 이상).
    const p = n > 1 ? k / (n - 1) : 0;

    // 날짜: 캠페인 시작일에서 progress 비율만큼 진행한 날 + ±3일 지터, 캠페인 구간으로 clamp.
    const dayJitter = Math.floor(rng() * (DAY_JITTER * 2 + 1)) - DAY_JITTER;
    const day = Math.max(startDay, Math.min(endDay, startDay + Math.round(p * CAMPAIGN_DURATION) + dayJitter));

    // 반경: p=0일 때 28km(캠페인 초입, 표적에서 멀리) → p=1일 때 4km(막바지, 표적에 근접) 선형 보간.
    // 이 "가까워짐"이 convergence 신호의 원천이다 (SPEC §1.1). 그 값에 [0.75,1.25] 지터를 곱한다.
    const baseRadius = RADIUS_AT_P0_KM + (RADIUS_AT_P1_KM - RADIUS_AT_P0_KM) * p;

    let placed = null;
    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
      // 방위는 매 시도 균등 0~360도 — 이게 encirclement 신호의 원천이다(치우치면 안 된다, SPEC §4.4).
      const bearing = rng() * 360;
      const jitterFactor = RADIUS_JITTER_MIN + rng() * RADIUS_JITTER_RANGE; // [0.75, 1.25)
      const radius = baseRadius * jitterFactor;
      if (radius < MIN_DIST_FROM_TARGET_KM) continue; // 이론상 최솟값이 4*0.75=3km라 항상 통과하지만 방어적으로 남겨둔다.

      const [la, lo] = dest(target.lat, target.lon, bearing, radius);
      if (!isLand(lo, la)) continue; // 배경 생성기의 placeEvent와 동일한 rejection 규칙.

      placed = { la, lo };
      break;
    }
    if (!placed) continue; // 40번 다 실패하면 이 이벤트는 그냥 건너뛴다 (SPEC §4.4, 배경 생성기와 동일 정책).

    const method = weightedPick(rng, CAMPAIGN_METHOD.values, CAMPAIGN_METHOD.weights);
    const attackTarget = weightedPick(rng, targetWeights.values, targetWeights.weights);
    const success = rng() < 0.72; // 배경 이벤트와 완전히 동일한 확률 — success에는 일부러 신호를 넣지 않는다.
    const casualties = success ? Math.floor(sampleExponential(rng, 2.4)) : 0;

    const id = allocateId();
    events.push({
      id,
      day,
      lat: placed.la,
      lon: placed.lo,
      org: org.key,
      branch: "ground",
      method,
      target: attackTarget,
      success,
      casualties,
    });
    byDay[day][orgIdx]++;
    eventIds.push(id);
  }

  return eventIds;
}

/**
 * 전체 조직에 대해 캠페인을 생성하고, 그 이벤트들을 events/byDay에 밀어 넣는다.
 * 배경(noise) 생성이 끝난 뒤에 이어서 호출해야 한다 — 그래야 withCampaigns:false일 때
 * rng 스트림이 배경 루프만 소비하고 끝나서 M2와 완전히 동일한 결과가 나온다.
 * @param {object} params
 * @param {() => number} params.rng
 * @param {(lon:number, lat:number)=>boolean} params.isLand
 * @param {object[]} params.orgs - organizations.js ORGS
 * @param {object[]} params.facilities - facilities.json의 facilities 배열
 * @param {number} params.totalDays - DAYS
 * @param {object[]} params.events - in-place push 대상
 * @param {number[][]} params.byDay - in-place 증가 대상
 * @param {() => number} params.allocateId
 * @param {(rng:()=>number, mean:number)=>number} params.sampleExponential
 * @param {(rng:()=>number, values:string[], weights:number[])=>string} params.weightedPick
 * @returns {object[]} campaigns 그라운드 트루스 배열 (SPEC §4.6)
 */
export function generateCampaigns({
  rng,
  isLand,
  orgs,
  facilities,
  totalDays,
  events,
  byDay,
  allocateId,
  sampleExponential,
  weightedPick,
}) {
  const campaigns = [];
  let campaignId = 0;

  orgs.forEach((org, orgIdx) => {
    const startDays = scheduleStartDays(rng, totalDays);

    for (const startDay of startDays) {
      const endDay = Math.min(totalDays - 1, startDay + CAMPAIGN_DURATION);

      // §4.3 표적 선정: 캠페인이 "시작하는 시점" 조직 위치 기준 150km 이내, 부족하면 300km로 확장.
      const center = orgCenterOnDay(org, startDay);
      let candidates = facilitiesWithin(facilities, center, TARGET_RADIUS_NEAR_KM);
      if (candidates.length < TARGET_MIN_CANDIDATES) {
        candidates = facilitiesWithin(facilities, center, TARGET_RADIUS_WIDE_KM);
      }
      if (candidates.length === 0) continue; // 이론상 발생하지 않음(160개 시설이 촘촘히 분포) — 방어적 처리.

      const target = candidates[Math.floor(rng() * candidates.length)];

      const eventIds = placeCampaignEvents({
        rng,
        isLand,
        org,
        target,
        startDay,
        endDay,
        allocateId,
        events,
        byDay,
        orgIdx,
        sampleExponential,
        weightedPick,
      });

      campaigns.push({
        id: campaignId++,
        org: org.key,
        targetId: target.id,
        startDay,
        endDay,
        eventIds,
      });
    }
  });

  return campaigns;
}
