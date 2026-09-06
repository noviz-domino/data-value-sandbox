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

  // softmax(score / temperature). SPEC §5.2 재작성판: temperature를 평균이 아니라 "퍼짐(spread)"
  // 기준으로 잡는다. 첫 시도(0.35 * mean(scores))는 한 후보가 압도적일 때 지수가 폭발해
  // 확률이 부동소수점 1.0으로 포화됐다 — 순수 소음 통제 구간의 30%가 그렇게 "100% 확신"을 냈다.
  // temperature = max(0.35 * stdev(scores), 0.05 * mean(scores), epsilon)로 바꾸면, 점수가 다 비슷해도
  // (stdev=0에 가까워도) 0.05*mean이 최소한의 온도를 보장하고, epsilon은 scores가 전부 0일 때의
  // 최후 가드다.
  const scores = ranked.map((r) => r.score);
  const meanScore = mean(scores);
  const scoreStdev = stdev(scores);
  const EPSILON = 1e-9;
  const temperature = Math.max(0.35 * scoreStdev, 0.05 * meanScore, EPSILON);

  // exponent(=score/temperature)를 ±30으로 clamp한 뒤 exp — 극단값이 남아 있어도 exp가 Infinity로
  // 튀거나 softmax 안정화용 뺄셈이 무의미해지는 것을 막는다.
  const CLAMP = 30;
  const logits = scores.map((s) => Math.max(-CLAMP, Math.min(CLAMP, s / temperature)));
  const maxLogit = logits.length ? Math.max(...logits) : 0;
  // exp 오버플로 방지를 위해 최댓값을 뺀 뒤 exp — 표준적인 softmax 안정화 트릭.
  const exps = logits.map((l) => Math.exp(l - maxLogit));
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

// SPEC_M3.md §5.3 (재작성판): 스코프 반경을 160km로 올린다. 60km에서는 스코프 안 후보 시설이
// 평균 3.9개뿐이라 "69개 중 1개 맞히기"라는 간판을 걸고 실제로는 "4개 중 1개 맞히기"를 채점하는
// 셈이었다. 160km에서는 평균 9.2개가 경쟁하고, 스코프 안 이벤트의 약 18%가 실제 캠페인 몫이라
// 전역 20/80 신호비와 가까워져 소음을 실제로 걸러내야 하는 문제가 된다.
const SCOPE_RADIUS_KM = 160;
const HIT_RATE_DAY_PAD = 10;
const CONTROL_WINDOW_COUNT_PER_SEED = 40; // 시드 1개당 40개 -> 5시드 풀링 시 200개
const CONTROL_WINDOW_DAYS = 80;
const FALSE_ALARM_TARGET_RATE = 0.1; // "10% 오경보율에서의 탐지율" 문턱을 통제 구간 상위 10%(=90th pct)로 잡는다
const DEFAULT_SEEDS = 5;
// §5.3 재작성판 "밀도 매칭(density-matched controls)": 캠페인 창이 담은 이벤트 수 N에 대해
// 0.8N~1.2N 사이인 통제 창을 찾을 때까지 거부-샘플링(rejection sampling)한다. 캠페인 1개당
// 최대 이만큼 뽑아보고, 그래도 못 찾으면 그 캠페인은 "매칭 실패"로 남긴다(조용히 버리지 않는다).
const DENSITY_MATCH_MAX_DRAWS = 200;
const DENSITY_MATCH_LOW = 0.8;
const DENSITY_MATCH_HIGH = 1.2;
// unmatched 통제 구간 rng(0x51ed270b)와 겹치지 않는 별도 XOR 상수. 두 샘플링이 같은 rng
// 스트림을 나눠 쓰면 소비 순서가 서로 영향을 줘 회귀 검증(unmatched 수치 불변)이 깨진다.
const DENSITY_MATCH_RNG_XOR = 0x6d617463;

// 세 특징 집합. §5.3 P/PE/PEC 사다리.
const FEATURE_SETS = {
  P: { proximity: true, encirclement: false, convergence: false },
  PE: { proximity: true, encirclement: true, convergence: false },
  PEC: { proximity: true, encirclement: true, convergence: true },
};

/**
 * 배열의 산술 평균. 빈 배열이면 0 (호출부에서 항상 가드하지만 이중 안전장치).
 * @param {number[]} arr
 * @returns {number}
 */
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/**
 * 배열의 모집단 표준편차(population standard deviation). 원소가 0~1개면 퍼짐을 정의할 수 없으므로 0.
 * @param {number[]} arr
 * @returns {number}
 */
function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * 돋보임 점수(standout score) z. SPEC_M3.md §5.3 재작성판: 확률이 아니라 이 값으로 탐지를
 * 채점한다 — softmax 확률은 부동소수점 1.0으로 포화될 수 있지만 z는 그러지 않는다.
 * z = (1등 점수 - 평균) / stdev. 후보가 3개 미만이거나 stdev가 0이면(전부 동점 등) 0.
 * @param {number[]} scores - 한 스코프 안 모든 후보 시설의 score (facilityScore, 확률 아님)
 * @returns {number}
 */
export function standoutZ(scores) {
  if (scores.length < 3) return 0;
  const sd = stdev(scores);
  if (sd === 0) return 0;
  const topScore = Math.max(...scores);
  return (topScore - mean(scores)) / sd;
}

/**
 * 배열의 [최소, 최대] 범위. 시드 간 변동폭(across-seed range)을 보여주는 용도.
 * @param {number[]} arr
 * @returns {[number, number]}
 */
function range(arr) {
  return arr.length ? [Math.min(...arr), Math.max(...arr)] : [0, 0];
}

/**
 * 오름차순 정렬된 배열에서 p분위수를 구한다 (선형보간 없는 최근접 인덱스 방식으로 충분 —
 * 표본이 최소 수십 개는 되므로 근사 오차가 문턱값 해석에 영향을 주지 않는다).
 * 빈 배열이면 Infinity를 돌려준다 — "아무 문턱도 넘을 수 없다"는 뜻으로, 통제 구간이
 * 하나도 안 뽑혔을 때 탐지율이 조용히 0이 되게 하는 가드다.
 * @param {number[]} sortedAsc
 * @param {number} p - 0~1
 * @returns {number}
 */
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return Infinity;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

/**
 * 주어진 시드로부터 seeds개의 시드를 결정적으로 파생시킨다. 첫 번째는 원본 seed 그대로,
 * 나머지 (seeds-1)개는 그 seed로 돌린 mulberry32 스트림에서 뽑는다 — Math.random 없이,
 * "주어진 seed + 거기서 파생된 4개" 규칙(SPEC §5.3)을 만족한다.
 * @param {number} seed
 * @param {number} count
 * @returns {number[]}
 */
function deriveSeeds(seed, count) {
  const rng = mulberry32(seed);
  const seeds = [seed];
  for (let i = 1; i < count; i++) {
    seeds.push(Math.floor(rng() * 0x7fffffff));
  }
  return seeds;
}

/**
 * 통제 구간(control window) 후보 하나를 뽑는다. SPEC_M3.md §5.3 절차 1~3 + 실제 캠페인과의
 * 겹침 거부를 그대로 구현한다 — unmatched 40개 추첨과 밀도 매칭(density-matched) 추첨이
 * 똑같은 절차를 공유해야 "같은 규칙으로 뽑되 캠페인 유무만 다르다"는 §5.3 요구를 만족하므로,
 * 인라인 코드로 중복시키지 않고 함수 하나로 뽑아 둔다.
 *
 * rng 소비 순서(회귀 검증 대상 — 순서가 바뀌면 이전 unmatched 결과와 달라진다):
 *   1) span 시작일 뽑기(rng 1회)
 *   2) 그 span 안에 배경 이벤트가 하나도 없으면 즉시 null(2번째 rng 호출 없음)
 *   3) 씨앗 이벤트 고르기(rng 1회) -> 가장 가까운 12개의 centroid -> 실제 캠페인과의
 *      공간+시간 겹침 검사(rng 소비 없음)
 *
 * @param {() => number} rng - mulberry32 스트림 (Math.random 아님)
 * @param {object[]} backgroundEvents - 어느 캠페인에도 속하지 않은 이벤트(org 제거된 projected)
 * @param {number} days - 시뮬레이션 전체 일수
 * @param {object[]} campaigns - 정답지의 캠페인 목록(겹침 판정에만 씀)
 * @param {Map<number, object>} eventById - 원본(좌표 포함) 이벤트 조회용
 * @returns {{lat:number, lon:number, startDay:number, endDay:number}|null} 거부되면 null
 */
function drawControlWindowCandidate(rng, backgroundEvents, days, campaigns, eventById) {
  const maxStart = Math.max(0, days - CONTROL_WINDOW_DAYS);
  const startDay = Math.floor(rng() * (maxStart + 1));
  const endDay = startDay + CONTROL_WINDOW_DAYS;

  // 이 80일 구간 안에 있는 배경 이벤트만 후보로 삼는다. 하나도 없으면 이 시도는 실패.
  const inSpanBackground = backgroundEvents.filter((e) => e.day >= startDay && e.day <= endDay);
  if (inSpanBackground.length === 0) return null;

  // 구간 안 배경 이벤트 중 하나를 무작위 씨앗으로 뽑는다.
  const seedEvent = inSpanBackground[Math.floor(rng() * inSpanBackground.length)];

  // 씨앗에서 가까운 순으로 정렬해 최대 12개(부족하면 있는 만큼 전부)를 취하고, 그 centroid를
  // 스코프 중심으로 쓴다 — 캠페인 구간이 "캠페인 이벤트들의 centroid"를 쓰는 것과 같은 방식.
  const nearest = inSpanBackground
    .map((e) => ({ e, d: haversineKm(seedEvent.lat, seedEvent.lon, e.lat, e.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 12)
    .map(({ e }) => e);
  const { lat, lon } = centroidOf(nearest);

  // 실제 캠페인과 "공간(그 캠페인 centroid로부터 160km 이내) AND 시간 겹침"이면 거부한다.
  const overlapsReal = campaigns.some((camp) => {
    const campEvents = camp.eventIds.map((id) => eventById.get(id)).filter(Boolean);
    if (campEvents.length === 0) return false;
    const campCentroid = centroidOf(campEvents);
    const spatialOverlap = haversineKm(lat, lon, campCentroid.lat, campCentroid.lon) <= SCOPE_RADIUS_KM;
    if (!spatialOverlap) return false;
    return startDay <= camp.endDay && endDay >= camp.startDay;
  });
  if (overlapsReal) return null;

  return { lat, lon, startDay, endDay };
}

/**
 * 추론 엔진을 평가한다. §5.3 (재작성판).
 *
 * 정답지 분리: campaigns를 읽는 것은 이 함수(채점 함수)뿐이며, inferTargets에는 항상
 * projectForInference를 거친 events만 넘긴다.
 *
 * simulateFn을 받는 이유: 5개 시드를 풀링하려면 시드마다 "다른 캠페인 배치가 심어진 새
 * 시뮬레이션"이 필요하다 (컨트롤 윈도우 RNG만 바꿔서는 캠페인 자체가 바뀌지 않는다).
 * 이 파일은 simulation.js를 직접 import하지 않는다 — 순수 함수 원칙을 지키기 위해, "시드를
 * 넣으면 { events, facilities, campaigns, days }를 돌려주는" 책임은 호출부(selftest, 나중엔
 * 뷰)가 진다.
 *
 * @param {{simulateFn:(seed:number)=>{events:object[],facilities:object[],campaigns:object[],days:number}, seed:number, seeds?:number}} args
 * @returns {{runs:object, campaignsEvaluated:number, meanCandidatesInScope:number, meanCandidatesInScopeRange:[number,number], meanEventsInScopeCampaign:number, meanEventsInScopeControl:number, seedsUsed:number[]}}
 */
export function evaluateInference({ simulateFn, seed, seeds = DEFAULT_SEEDS }) {
  const seedList = deriveSeeds(seed, seeds);

  // key별로 "시드마다의" 캠페인 레코드/컨트롤 확률 배열을 따로 보관한다 (풀링과 시드 간
  // range를 둘 다 구하려면 시드 경계를 유지해야 한다).
  const perFeature = {};
  for (const key of Object.keys(FEATURE_SETS)) {
    perFeature[key] = {
      perSeedCampaignRecords: [],
      perSeedControlZs: [],
      // §5.3 재작성판 밀도 매칭: 캠페인마다 매칭된 통제 창의 z(짝), 그리고 매칭 실패 건수/전체 건수.
      perSeedMatchedPairs: [],
      perSeedUnmatchedCampaignCount: [],
      perSeedTotalCampaignCount: [],
    };
  }

  let totalCampaigns = 0;
  const candidatesPerSeed = []; // 스코프 구성 자체는 feature에 안 좌우되므로 한 번만 기록
  // §5.3 재작성판: 통제·캠페인 두 창 종류가 진짜 비교 가능한지 보려면 "스코프 안 이벤트 수"를
  // 나란히 봐야 한다 — 후보 시설 수(candidatesPerSeed)와는 다른 수치다.
  const campaignEventsInScopePerSeed = [];
  const controlEventsInScopePerSeed = [];

  for (const s of seedList) {
    const run = simulateFn(s);
    const { events, facilities, campaigns, days } = run;
    const projected = projectForInference(events); // 경계: org 제거는 여기서 한 번만.
    const eventById = new Map(events.map((e) => [e.id, e])); // 원본(org 포함)에서 좌표·day만 조회
    const facilityById = new Map(facilities.map((f) => [f.id, f]));
    // 통제 구간의 씨앗을 "어느 캠페인에도 속하지 않은" 이벤트 중에서만 뽑기 위한 배경 이벤트 집합.
    const campaignEventIdSet = new Set(campaigns.flatMap((c) => c.eventIds));
    const backgroundEvents = projected.filter((e) => !campaignEventIdSet.has(e.id));

    totalCampaigns += campaigns.length;
    let seedCandidatesSum = 0;
    let seedCandidatesCount = 0;
    let seedCampaignEventSum = 0;
    let seedCampaignEventCount = 0;
    let seedControlEventSum = 0;
    let seedControlEventCount = 0;

    for (const key of Object.keys(FEATURE_SETS)) {
      const features = FEATURE_SETS[key];

      // --- hit rate: 각 캠페인마다 그 캠페인 이벤트들의 centroid를 중심으로 160km 스코프를 잡는다.
      const campaignRecords = [];
      for (const camp of campaigns) {
        const campEvents = camp.eventIds.map((id) => eventById.get(id)).filter(Boolean);
        if (campEvents.length === 0) continue;
        const { lat, lon } = centroidOf(campEvents);
        const scope = { lat, lon, radiusKm: SCOPE_RADIUS_KM };
        const window = {
          startDay: camp.startDay - HIT_RATE_DAY_PAD,
          endDay: camp.endDay + HIT_RATE_DAY_PAD,
        };

        const scopedEvents = scopeEvents(projected, scope, window);
        const scopedFacilities = scopeFacilities(facilities, scope);
        const nCandidates = scopedFacilities.length;
        if (nCandidates === 0) continue; // 스코프 안에 후보가 하나도 없으면(있을 수 없지만 가드) 채점 불가

        const result = inferTargets({ events: scopedEvents, facilities: scopedFacilities, features });
        const rankIdx = result.ranked.findIndex((r) => r.facilityId === camp.targetId);
        // §5.3 재작성판: 탐지 채점은 확률(prob)이 아니라 돋보임 점수 z를 쓴다 — z는
        // score(softmax를 거치지 않은 원점수) 기준이라 포화되지 않는다.
        const zScore = standoutZ(result.ranked.map((r) => r.score));

        campaignRecords.push({
          top1Hit: rankIdx === 0,
          top5Hit: rankIdx !== -1 && rankIdx < 5,
          floorTop1: 1 / nCandidates, // §5.3: 스코프별 floor. 전역 1/69가 아니라 이 창의 후보 수 기준.
          floorTop5: Math.min(5, nCandidates) / nCandidates,
          nCandidates,
          zScore,
          nEventsInScope: scopedEvents.length, // §5.3 밀도 매칭의 N — 이 캠페인 창이 담은 이벤트 수
        });

        if (key === "P") {
          // 후보 수·이벤트 수는 feature와 무관하니 한 번만 집계 (P를 기준 삼음 — 어차피 키마다 동일).
          seedCandidatesSum += nCandidates;
          seedCandidatesCount++;
          seedCampaignEventSum += scopedEvents.length;
          seedCampaignEventCount++;
        }
      }
      perFeature[key].perSeedCampaignRecords.push(campaignRecords);

      // --- 통제 구간(control window): §5.3 재작성판. 캠페인 구간과 "완전히 같은 절차"로 뽑는다.
      // 구판은 시설을 스코프 중심에 직접 놓았는데, 그러면 그 시설은 자기 스코프의 정중앙에 있고
      // §1.1이 시설 근처에 일부러 깔아두는 배경 군집에 둘러싸여 — 어떤 오프센터 실제 표적도
      // 이길 수 없는 돋보임 점수를 받았다(통제 z p50 1.89 > 캠페인 z p50 1.37~1.76, 측정치).
      // 새 절차: (1) 80일 구간을 뽑고 (2) 그 구간 안에서 "어느 캠페인에도 속하지 않은" 배경
      // 이벤트 하나를 무작위 씨앗으로 뽑고 (3) 그 씨앗에 가장 가까운 배경 이벤트 12개(부족하면
      // 있는 만큼)의 centroid를 스코프 중심으로 쓴다. 시설이 아니라 이벤트 군집이 중심이 되므로
      // 양성(캠페인)·음성(통제) 창이 같은 규칙으로 뽑히고 "캠페인이 있느냐 없느냐"만 다르다.
      // simulate() 내부 RNG 스트림과 섞이지 않도록, 같은 seed 값이라도 XOR 상수로 독립된
      // mulberry32 스트림을 새로 연다 (Math.random은 쓰지 않는다).
      const rng = mulberry32(s ^ 0x51ed270b);
      const controlZs = [];
      let drawn = 0;
      let attempts = 0;
      const maxAttempts = CONTROL_WINDOW_COUNT_PER_SEED * 200; // 무한 루프 방지 상한
      while (drawn < CONTROL_WINDOW_COUNT_PER_SEED && attempts < maxAttempts) {
        attempts++;
        const candidate = drawControlWindowCandidate(rng, backgroundEvents, days, campaigns, eventById);
        if (!candidate) continue; // 배경 이벤트 없음 또는 실제 캠페인과 겹침 -> 다시 뽑는다

        drawn++;
        const { lat, lon, startDay, endDay } = candidate;
        const scope = { lat, lon, radiusKm: SCOPE_RADIUS_KM };
        const window = { startDay, endDay };
        const scopedEvents = scopeEvents(projected, scope, window);
        const scopedFacilities = scopeFacilities(facilities, scope);
        const result = inferTargets({ events: scopedEvents, facilities: scopedFacilities, features });
        controlZs.push(standoutZ(result.ranked.map((r) => r.score)));
        if (key === "P") {
          seedControlEventSum += scopedEvents.length;
          seedControlEventCount++;
        }
      }
      perFeature[key].perSeedControlZs.push(controlZs);

      // --- 밀도 매칭 통제(density-matched control): SPEC_M3.md §5.3 "Density-match the controls."
      // 캠페인 창이 담은 이벤트 수 N에 대해 0.8N~1.2N 사이인 통제 창을 찾을 때까지(최대 200회)
      // 위와 완전히 같은 절차로 거부-샘플링해 짝짓는다. unmatched 40개 추첨과는 다른 rng
      // 스트림을 쓴다 — 스트림을 공유하면 소비 순서가 얽혀 위 unmatched 결과가 이 기능 유무에
      // 따라 달라져 버리고, 그러면 "랭킹 수치는 그대로"라는 회귀 조건을 지킬 수 없다.
      // 창 구성(공간+시간, 안에 몇 개가 드는지)은 feature와 무관하므로, key마다 같은 시드로
      // 다시 여는 이 rng는 P/PE/PEC 세 키에서 정확히 같은 순서로 같은 후보를 뽑는다 — 그래서
      // 매칭된 통제 창 자체(따라서 매칭 실패율·매칭된 평균 이벤트 수)는 세 키에서 동일해지고,
      // 그 창에 대해 계산되는 z만 feature마다 달라진다.
      const matchRng = mulberry32(s ^ DENSITY_MATCH_RNG_XOR);
      const matchedPairs = []; // { top1Hit, zScore, controlZ, campaignEvents, controlEvents }
      let unmatchedCampaignCount = 0;
      for (const rec of campaignRecords) {
        const N = rec.nEventsInScope;
        const loBound = DENSITY_MATCH_LOW * N;
        const hiBound = DENSITY_MATCH_HIGH * N;
        let matchedZ = null;
        let matchedEventCount = null;
        for (let attempt = 0; attempt < DENSITY_MATCH_MAX_DRAWS && matchedZ === null; attempt++) {
          const candidate = drawControlWindowCandidate(matchRng, backgroundEvents, days, campaigns, eventById);
          if (!candidate) continue; // 이번 시도는 거부됨(배경 없음/실제 캠페인과 겹침) -> 다음 시도
          const { lat, lon, startDay, endDay } = candidate;
          const scope = { lat, lon, radiusKm: SCOPE_RADIUS_KM };
          const window = { startDay, endDay };
          const scopedEvents = scopeEvents(projected, scope, window);
          if (scopedEvents.length < loBound || scopedEvents.length > hiBound) continue; // 밀도가 안 맞음
          const scopedFacilities = scopeFacilities(facilities, scope);
          const result = inferTargets({ events: scopedEvents, facilities: scopedFacilities, features });
          matchedZ = standoutZ(result.ranked.map((r) => r.score));
          matchedEventCount = scopedEvents.length;
        }
        if (matchedZ !== null) {
          matchedPairs.push({
            top1Hit: rec.top1Hit,
            zScore: rec.zScore,
            controlZ: matchedZ,
            campaignEvents: N,
            controlEvents: matchedEventCount,
          });
        } else {
          unmatchedCampaignCount++; // 200번 뽑아도 밀도가 맞는 통제 창을 못 찾음 -> 매칭 실패
        }
      }
      perFeature[key].perSeedMatchedPairs.push(matchedPairs);
      perFeature[key].perSeedUnmatchedCampaignCount.push(unmatchedCampaignCount);
      perFeature[key].perSeedTotalCampaignCount.push(campaignRecords.length);
    }

    if (seedCandidatesCount > 0) candidatesPerSeed.push(seedCandidatesSum / seedCandidatesCount);
    if (seedCampaignEventCount > 0) campaignEventsInScopePerSeed.push(seedCampaignEventSum / seedCampaignEventCount);
    if (seedControlEventCount > 0) controlEventsInScopePerSeed.push(seedControlEventSum / seedControlEventCount);
  }

  const runs = {};
  for (const key of Object.keys(FEATURE_SETS)) {
    const bucket = perFeature[key];
    const pooledCampaigns = bucket.perSeedCampaignRecords.flat();
    const pooledControls = bucket.perSeedControlZs.flat();
    const n = pooledCampaigns.length || 1;

    const top1Rate = pooledCampaigns.filter((r) => r.top1Hit).length / n;
    const top5Rate = pooledCampaigns.filter((r) => r.top5Hit).length / n;
    const meanFloorTop1 = mean(pooledCampaigns.map((r) => r.floorTop1));
    const meanFloorTop5 = mean(pooledCampaigns.map((r) => r.floorTop5));
    const lift = meanFloorTop1 > 0 ? top1Rate / meanFloorTop1 : 0;

    // --- §5.3 재작성판 "no magic threshold": 풀링된(5시드 x 40개=200개) 통제 구간의 돋보임
    // 점수 z의 90th percentile을 오경보 10%의 운용 문턱으로 삼는다. z는 확률과 달리 포화되지
    // 않으므로(§5.2) 이 문턱이 "모든 캠페인보다 높게" 밀려 올라가는 일이 없다.
    const sortedControlZs = [...pooledControls].sort((a, b) => a - b);
    const sortedCampaignZs = pooledCampaigns.map((r) => r.zScore).sort((a, b) => a - b);
    const threshold = percentile(sortedControlZs, 1 - FALSE_ALARM_TARGET_RATE);
    const detectionAt10FAR =
      pooledCampaigns.filter((r) => r.top1Hit && r.zScore >= threshold).length / n;

    // --- 시드 간 range: 풀링 수치 옆에 "시드마다 재보면 어느 폭으로 흔들리는지"를 같이 보여준다.
    const perSeedTop1 = bucket.perSeedCampaignRecords.map((recs) =>
      recs.length ? recs.filter((r) => r.top1Hit).length / recs.length : 0
    );
    const perSeedTop5 = bucket.perSeedCampaignRecords.map((recs) =>
      recs.length ? recs.filter((r) => r.top5Hit).length / recs.length : 0
    );
    const perSeedDetection = bucket.perSeedCampaignRecords.map((recs) =>
      recs.length ? recs.filter((r) => r.top1Hit && r.zScore >= threshold).length / recs.length : 0
    );

    // --- §5.3 재작성판 밀도 매칭(density-matched): "캠페인 창은 평균 이벤트가 많아서 이겼을
    // 뿐"이라는 반박을 봉쇄하려면, 이벤트 수를 맞춘 짝으로만 탐지율을 다시 재야 한다. 매칭된
    // 통제 z들만 모아 그 90th percentile을 별도 문턱으로 잡고, 매칭된 캠페인만 그 문턱과 비교한다.
    const pooledMatchedPairs = bucket.perSeedMatchedPairs.flat();
    const pooledUnmatchedCount = bucket.perSeedUnmatchedCampaignCount.reduce((a, b) => a + b, 0);
    const pooledTotalCampaignCount = bucket.perSeedTotalCampaignCount.reduce((a, b) => a + b, 0);
    const unmatchedShare = pooledTotalCampaignCount > 0 ? pooledUnmatchedCount / pooledTotalCampaignCount : 0;

    const sortedMatchedControlZs = pooledMatchedPairs.map((p) => p.controlZ).sort((a, b) => a - b);
    const sortedMatchedCampaignZs = pooledMatchedPairs.map((p) => p.zScore).sort((a, b) => a - b);
    const matchedThreshold = percentile(sortedMatchedControlZs, 1 - FALSE_ALARM_TARGET_RATE);
    const nMatched = pooledMatchedPairs.length || 1;
    const detectionAt10FARMatched =
      pooledMatchedPairs.filter((p) => p.top1Hit && p.zScore >= matchedThreshold).length / nMatched;

    const perSeedDetectionMatched = bucket.perSeedMatchedPairs.map((pairs) =>
      pairs.length ? pairs.filter((p) => p.top1Hit && p.zScore >= matchedThreshold).length / pairs.length : 0
    );

    const meanCampaignEventsMatched = mean(pooledMatchedPairs.map((p) => p.campaignEvents));
    const meanControlEventsMatched = mean(pooledMatchedPairs.map((p) => p.controlEvents));

    runs[key] = {
      top1: top1Rate,
      top1Range: range(perSeedTop1),
      floorTop1: meanFloorTop1,
      lift,
      top5: top5Rate,
      top5Range: range(perSeedTop5),
      floorTop5: meanFloorTop5,
      detectionAt10FAR,
      detectionAt10FARRange: range(perSeedDetection),
      operatingThreshold: threshold,
      // §5.3 항목 7: 통제 구간 z 분포가 최댓값에 몰려 있지 않은지(=포화되지 않았는지) 한눈에
      // 보이도록 50/90/99th percentile을 통제·캠페인 양쪽 다 리포트한다.
      controlZP50: percentile(sortedControlZs, 0.5),
      controlZP90: percentile(sortedControlZs, 0.9),
      controlZP99: percentile(sortedControlZs, 0.99),
      campaignZP50: percentile(sortedCampaignZs, 0.5),
      campaignZP90: percentile(sortedCampaignZs, 0.9),
      campaignZP99: percentile(sortedCampaignZs, 0.99),
      campaignCount: pooledCampaigns.length,
      controlCount: pooledControls.length,

      // --- §5.3 밀도 매칭(density-matched) 결과. unmatched 수치(위)는 volume-confounded임을
      // 명시하고 그대로 두되, 이 값들이 "진짜" 채점 — 이벤트 수를 맞춘 뒤에도 탐지가 되는지.
      detectionAt10FARMatched,
      detectionAt10FARMatchedRange: range(perSeedDetectionMatched),
      matchedOperatingThreshold: matchedThreshold,
      matchedControlZP50: percentile(sortedMatchedControlZs, 0.5),
      matchedControlZP90: percentile(sortedMatchedControlZs, 0.9),
      matchedControlZP99: percentile(sortedMatchedControlZs, 0.99),
      matchedCampaignZP50: percentile(sortedMatchedCampaignZs, 0.5),
      matchedCampaignZP90: percentile(sortedMatchedCampaignZs, 0.9),
      matchedCampaignZP99: percentile(sortedMatchedCampaignZs, 0.99),
      matchedPairCount: pooledMatchedPairs.length,
      unmatchedCampaignShare: unmatchedShare, // 200번 뽑아도 밀도 맞는 통제 창을 못 찾은 캠페인의 비율
      meanEventsInScopeCampaignMatched: meanCampaignEventsMatched,
      meanEventsInScopeControlMatched: meanControlEventsMatched,
    };
  }

  return {
    runs,
    campaignsEvaluated: totalCampaigns,
    meanCandidatesInScope: mean(candidatesPerSeed),
    meanCandidatesInScopeRange: range(candidatesPerSeed),
    // §5.3 재작성판: 통제·캠페인 두 창 종류가 비교 가능한지 판정하는 데 쓰는 side-by-side 수치.
    meanEventsInScopeCampaign: mean(campaignEventsInScopePerSeed),
    meanEventsInScopeControl: mean(controlEventsInScopePerSeed),
    seedsUsed: seedList,
  };
}
