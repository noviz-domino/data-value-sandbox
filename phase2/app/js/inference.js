// 표적 추론(target inference) 엔진: 배경 소음 속에 흩어진 "사전 정지작업" 이벤트들만으로
// 어느 시설이 표적이었는지 역으로 추정한다. SPEC_M3.md §5를 그대로 구현한다.
//
// 결정성(determinism): 이 파일 자체는 난수를 쓰지 않는다(순수 함수). evaluateInference만
// 통제 구간(control window)을 뽑기 위해 mulberry32 시드 스트림을 쓴다. Math.random()은 없다.
//
// 정답지 분리(ground truth separation, SPEC §3): inferTargets/scopeEvents/scopeFacilities/
// projectForInference는 org·campaignId·campaign 유래 값을 절대 읽지 않는다. events가 이런 필드를
// 들고 있어도(스키마가 배경 이벤트와 동일하므로 들고 있을 수 있다) 이 함수들은 그 필드를 참조하는
// 코드를 한 줄도 갖지 않는다. campaigns를 읽는 것은 evaluateInference(채점 함수) 하나뿐이다.

import { haversineKm } from "./geo.js";
import { mulberry32 } from "./rng.js";

/**
 * 이벤트 배열에서 org(조직 귀속 정답)를 제거한다. 추론 엔진에 이벤트를 넘기기 전, 경계에서
 * 반드시 이 함수를 거치게 한다 — "어느 사건들이 한 묶음인지" 자체가 풀어야 할 문제이지,
 * 미리 주어지는 라벨이 아니다.
 * @param {object[]} events
 * @returns {object[]} org가 제거된 새 이벤트 배열 (원본은 변경하지 않는다)
 */
export function projectForInference(events) {
  return events.map(({ org, ...rest }) => rest); // org만 구조분해로 떼어내고 나머지 필드는 그대로 복사
}

/**
 * 원(circle) 안 + 날짜 구간 안(둘 다 경계 포함)에 드는 이벤트만 남긴다.
 * @param {object[]} events - { lat, lon, day, ... }
 * @param {{lat:number, lon:number, radiusKm:number}} scope
 * @param {{startDay:number, endDay:number}} window
 * @returns {object[]}
 */
export function scopeEvents(events, scope, window) {
  const { lat, lon, radiusKm } = scope;
  const { startDay, endDay } = window;
  return events.filter((e) => {
    if (e.day < startDay || e.day > endDay) return false; // 날짜 구간 밖
    const d = haversineKm(lat, lon, e.lat, e.lon);
    return d <= radiusKm; // 원 밖이면 제외
  });
}

/**
 * 원(circle) 안에 드는 후보 시설만 남긴다.
 * @param {object[]} facilities - { lat, lon, ... }
 * @param {{lat:number, lon:number, radiusKm:number}} scope
 * @returns {object[]}
 */
export function scopeFacilities(facilities, scope) {
  const { lat, lon, radiusKm } = scope;
  return facilities.filter((f) => haversineKm(lat, lon, f.lat, f.lon) <= radiusKm);
}

// 고리형(ring) 커널의 중심(km)과 표준편차(sigma). SPEC §5.2: 28~4km 링 대역의 한가운데인 14km에서
// 정점을 찍고, 시설 바로 위(거리 0)에 쌓인 평범한 군집은 오히려 낮은 점수를 받는다.
const RING_PEAK_KM = 14;
const RING_SIGMA_KM = 11;
// encirclement 판정에 넣을 "대역 안" 이벤트의 최소 가중치 기준.
const IN_BAND_WEIGHT = 0.15;

/**
 * 거리 d(km)에 대한 고리형 커널 가중치. 14km에서 정점, sigma=11km인 가우시안.
 * @param {number} d
 * @returns {number}
 */
function ringWeight(d) {
  const z = d - RING_PEAK_KM;
  return Math.exp(-(z * z) / (2 * RING_SIGMA_KM * RING_SIGMA_KM));
}

/**
 * 원형 통계(circular statistics)의 평균 결과 길이(mean resultant length) R을 구한다.
 * 방위각(bearing, deg)들이 한 방향으로 쏠려 있으면 1에 가깝고, 사방으로 고르게 퍼져 있으면 0에 가깝다.
 * @param {number[]} bearingsDeg
 * @returns {number} R (0~1)
 */
function circularR(bearingsDeg) {
  if (bearingsDeg.length === 0) return 0; // 빈 입력 가드
  let sumCos = 0;
  let sumSin = 0;
  for (const b of bearingsDeg) {
    const rad = (b * Math.PI) / 180;
    sumCos += Math.cos(rad);
    sumSin += Math.sin(rad);
  }
  const n = bearingsDeg.length;
  return Math.hypot(sumCos / n, sumSin / n);
}

/**
 * 두 지점 (la1,lo1) -> (la2,lo2)로 향하는 초기 방위각(bearing, deg, 0=북 90=동)을 구한다.
 * haversineKm은 거리만 주므로, 방위각은 별도의 구면 삼각법 공식으로 계산한다.
 * @returns {number} 0~360 범위의 방위각
 */
function bearingDeg(la1, lo1, la2, lo2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const p1 = toRad(la1);
  const p2 = toRad(la2);
  const dl = toRad(lo2 - lo1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360; // 0~360으로 정규화
}

/**
 * Pearson 상관계수 r(x, y). 표본이 2개 미만이거나 한쪽 분산이 0이면(zero-variance) 정의되지
 * 않으므로 0을 반환하는 가드를 둔다.
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {number}
 */
function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return 0; // 분산 0 가드: 상관계수가 정의되지 않음
  return cov / Math.sqrt(varX * varY);
}

/**
 * 스코프 안 이벤트·후보 시설로부터 표적을 추론한다. §5.2.
 * 정답지 분리: 이 함수는 event.org / campaignId를 절대 참조하지 않는다 — events는 반드시
 * projectForInference()를 거친 뒤 넘겨야 한다(강제하지는 않지만 호출 규약이다).
 *
 * @param {{events:object[], facilities:object[], features:{proximity?:boolean, encirclement?:boolean, convergence?:boolean}}} args
 * @returns {{ranked:{facilityId:string, score:number, prob:number}[], eventCount:number, warnings:string[]}}
 */
export function inferTargets({ events, facilities, features }) {
  const useEncirclement = !!features.encirclement;
  const useConvergence = !!features.convergence;

  const ranked = facilities.map((f) => {
    // 이 시설 F 기준으로 이벤트마다 거리·가중치·방위각을 미리 구해둔다.
    const withDist = events.map((e) => ({
      e,
      d: haversineKm(f.lat, f.lon, e.lat, e.lon),
    }));
    const withWeight = withDist.map(({ e, d }) => ({ e, d, w: ringWeight(d) }));

    // 근접(proximity) 점수: 고리형 가중치의 합. 항상 켜져 있다.
    let score = withWeight.reduce((sum, { w }) => sum + w, 0);

    // 대역 안(in-band) 이벤트: w > 0.15인 것들만 encirclement·convergence 판정에 쓴다.
    const inBand = withWeight.filter(({ w }) => w > IN_BAND_WEIGHT);

    // 포위(encirclement): 대역 안 이벤트의 방위각 분산으로 점수를 보정한다.
    if (useEncirclement) {
      if (inBand.length >= 4) {
        const bearings = inBand.map(({ e }) => bearingDeg(f.lat, f.lon, e.lat, e.lon));
        const R = circularR(bearings);
        score *= 1.4 - R; // 고르게 퍼질수록(R->0) 배율이 커짐
      }
      // inBand.length < 4면 배율 1.0 (판단할 근거 부족) — 아무것도 곱하지 않는다.
    }

    // 수렴(convergence): 대역 안 이벤트의 day와 거리 사이 상관계수로 점수를 보정한다.
    if (useConvergence) {
      if (inBand.length >= 5) {
        const days = inBand.map(({ e }) => e.day);
        const dists = inBand.map(({ d }) => d);
        const r = pearsonR(days, dists);
        score *= 1 + Math.max(0, -r) * 1.8; // 거리가 시간에 따라 줄어들수록(r<<0) 배율이 커짐
      }
      // inBand.length < 5면 배율 1.0.
    }

    return { facilityId: f.id, score };
  });

  // softmax(score / temperature). temperature = 0.35 * mean(score). 평균이 0이면(모든 score가 0,
  // 예: 이벤트가 하나도 없는 경우) 나눗셈 가드로 온도를 1로 대체한다.
  const meanScore = ranked.length ? ranked.reduce((s, r) => s + r.score, 0) / ranked.length : 0;
  const temperature = meanScore !== 0 ? 0.35 * meanScore : 1;

  const maxLogit = ranked.length
    ? Math.max(...ranked.map((r) => r.score / temperature))
    : 0;
  // exp 오버플로 방지를 위해 최댓값을 뺀 뒤 exp — 표준적인 softmax 안정화 트릭.
  const exps = ranked.map((r) => Math.exp(r.score / temperature - maxLogit));
  const sumExp = exps.reduce((a, b) => a + b, 0) || 1; // 전부 0인 극단적 경우 가드

  const withProb = ranked
    .map((r, i) => ({ facilityId: r.facilityId, score: r.score, prob: exps[i] / sumExp }))
    .sort((a, b) => b.prob - a.prob);

  const warnings = [];
  if (events.length < 25) warnings.push("too few events in scope for a reliable estimate");
  if (withProb.length === 0 || withProb[0].prob < 0.15) warnings.push("no candidate stands out");

  return { ranked: withProb, eventCount: events.length, warnings };
}

/**
 * 캠페인 이벤트들의 중심(centroid)을 단순 평균으로 구한다. (하버사인 기준 정확한 구면 중심은
 * 아니지만, 60km 반경 스코프를 잡기 위한 근사치로는 충분하다 — 캠페인 반경 자체가 28km 이내다.)
 * @param {object[]} events
 * @returns {{lat:number, lon:number}}
 */
function centroidOf(events) {
  const n = events.length;
  const lat = events.reduce((s, e) => s + e.lat, 0) / n;
  const lon = events.reduce((s, e) => s + e.lon, 0) / n;
  return { lat, lon };
}

const HIT_RATE_RADIUS_KM = 60;
const HIT_RATE_DAY_PAD = 10;
const CONTROL_WINDOW_COUNT = 40;
const CONTROL_WINDOW_RADIUS_KM = 60;
const CONTROL_WINDOW_DAYS = 80;
const FALSE_ALARM_PROB_THRESHOLD = 0.35;

// 세 특징 집합. §5.3 P/PE/PEC 사다리.
const FEATURE_SETS = {
  P: { proximity: true, encirclement: false, convergence: false },
  PE: { proximity: true, encirclement: true, convergence: false },
  PEC: { proximity: true, encirclement: true, convergence: true },
};

/**
 * 추론 엔진을 평가한다. §5.3. P/PE/PEC 사다리의 hit rate·false alarm rate·floor를 계산한다.
 * 정답지 분리: campaigns를 읽는 것은 이 함수(채점 함수)뿐이며, inferTargets에는 항상
 * projectForInference를 거친 events만 넘긴다.
 *
 * @param {{events:object[], facilities:object[], campaigns:object[], days:number, seed:number}} args
 * @returns {{runs:object, floor:{top1:number, top5:number}}}
 */
export function evaluateInference({ events, facilities, campaigns, days, seed }) {
  const rng = mulberry32(seed);
  const projected = projectForInference(events); // 경계: org 제거는 여기서 한 번만.
  const eventById = new Map(events.map((e) => [e.id, e])); // 원본(org 포함)에서 좌표·day만 조회할 때 사용
  const facilityById = new Map(facilities.map((f) => [f.id, f]));

  const floor = { top1: 1 / facilities.length, top5: Math.min(5, facilities.length) / facilities.length };

  const runs = {};
  for (const key of Object.keys(FEATURE_SETS)) {
    const features = FEATURE_SETS[key];

    // --- hit rate: 각 캠페인마다 그 캠페인 이벤트들의 centroid를 중심으로 스코프를 잡는다.
    let top1Hits = 0;
    let top5Hits = 0;
    let eventsInScopeSum = 0;
    for (const camp of campaigns) {
      const campEvents = camp.eventIds.map((id) => eventById.get(id)).filter(Boolean);
      if (campEvents.length === 0) continue;
      const { lat, lon } = centroidOf(campEvents);
      const scope = { lat, lon, radiusKm: HIT_RATE_RADIUS_KM };
      const window = {
        startDay: camp.startDay - HIT_RATE_DAY_PAD,
        endDay: camp.endDay + HIT_RATE_DAY_PAD,
      };

      const scopedEvents = scopeEvents(projected, scope, window);
      const scopedFacilities = scopeFacilities(facilities, scope);
      const result = inferTargets({ events: scopedEvents, facilities: scopedFacilities, features });

      eventsInScopeSum += result.eventCount;
      const rankIdx = result.ranked.findIndex((r) => r.facilityId === camp.targetId);
      if (rankIdx === 0) top1Hits++;
      if (rankIdx !== -1 && rankIdx < 5) top5Hits++;
    }
    const campaignCount = campaigns.length || 1;

    // --- false alarm: 실제 캠페인과 시공간이 겹치지 않는 통제 구간 40개를 뽑는다.
    let falseAlarms = 0;
    let controlsDrawn = 0;
    let attempts = 0;
    const maxAttempts = CONTROL_WINDOW_COUNT * 200; // 무한 루프 방지 상한
    while (controlsDrawn < CONTROL_WINDOW_COUNT && attempts < maxAttempts) {
      attempts++;
      const f = facilities[Math.floor(rng() * facilities.length)];
      const maxStart = Math.max(0, days - CONTROL_WINDOW_DAYS);
      const startDay = Math.floor(rng() * (maxStart + 1));
      const endDay = startDay + CONTROL_WINDOW_DAYS;

      // 실제 캠페인과 "공간 60km 이내 AND 시간 겹침"이면 거부하고 다시 뽑는다.
      const overlapsReal = campaigns.some((camp) => {
        const target = facilityById.get(camp.targetId);
        if (!target) return false;
        const spatialOverlap = haversineKm(f.lat, f.lon, target.lat, target.lon) <= CONTROL_WINDOW_RADIUS_KM;
        if (!spatialOverlap) return false;
        const timeOverlap = startDay <= camp.endDay && endDay >= camp.startDay;
        return timeOverlap;
      });
      if (overlapsReal) continue;

      controlsDrawn++;
      const scope = { lat: f.lat, lon: f.lon, radiusKm: CONTROL_WINDOW_RADIUS_KM };
      const window = { startDay, endDay };
      const scopedEvents = scopeEvents(projected, scope, window);
      const scopedFacilities = scopeFacilities(facilities, scope);
      const result = inferTargets({ events: scopedEvents, facilities: scopedFacilities, features });
      if (result.ranked.length && result.ranked[0].prob > FALSE_ALARM_PROB_THRESHOLD) {
        falseAlarms++;
      }
    }

    runs[key] = {
      top1: top1Hits / campaignCount,
      top5: top5Hits / campaignCount,
      falseAlarmRate: controlsDrawn ? falseAlarms / controlsDrawn : 0,
      meanEventsInScope: campaigns.length ? eventsInScopeSum / campaigns.length : 0,
    };
  }

  return { runs, floor };
}
