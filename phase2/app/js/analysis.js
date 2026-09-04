// 분석 엔진: KNN 분류기(from scratch), 지표(confusion/precision/recall/f1), 다수결 베이스라인(floor),
// 오라클 상한(ceiling), 그리고 세 가지 특징집합(A/B/C)에 대한 ablation 실험.
// SPEC.md §9, docs/phase2/BUILD_PLAN.md M2-T1을 그대로 구현한다.
//
// 결정성(determinism): train/test 분할에 쓰는 유일한 무작위성은 mulberry32 시드 스트림을 통해서만
// 뽑는다. Math.random()은 이 파일 어디에도 등장하지 않는다 (SPEC §6.1과 동일한 원칙을 analysis에도 적용).
//
// 오라클은 "참" 생성 모델(ORGS/DIRECTIVES/periods)을 직접 읽는 채점(scoring) 경로에만 존재하며,
// knnClassify의 feature로는 절대 들어가지 않는다 (SPEC §9.4 "오라클은 절대 modelling 경로에서
// 접근 가능해서는 안 된다"를 지키기 위해 이 파일 안에서도 두 경로를 함수 단위로 분리해뒀다).

import { mulberry32 } from "./rng.js";
import { haversineKm, dest } from "./geo.js";
import { ORGS, DIRECTIVES, TARGETS, RANGE } from "./organizations.js";

// 시뮬레이션 시작일(2026-01-01) 기준 UTC 타임스탬프. day 인덱스 -> 실제 월(1~12) 변환에 쓴다.
// simulation.js의 monthOf와 동일한 로직을 여기서도 그대로 둔다 (모듈 경계를 넘기지 않기 위한
// 의도적 중복 — BUILD_PLAN T2 리뷰에서 이미 승인된 패턴).
const D0 = Date.UTC(2026, 0, 1);
function monthOf(day) {
  return new Date(D0 + day * 86400000).getUTCMonth() + 1;
}

/**
 * KNN 분류기. 지리(lat,lon) 쌍은 haversine으로, 그 외 non-geo 특징은 train 기준 min-max
 * 정규화([0,1])로 스케일을 맞춘 뒤, 정규화된 haversine(÷20000km)과 함께 유클리드 거리로 합산한다
 * (SPEC §9.1). k개의 최근접 이웃 중 다수결로 라벨을 정한다.
 *
 * @param {{train:{features:object,label:string}[], test:{features:object,label?:string}[], k?:number}} args
 * @returns {string[]} test와 같은 길이의 예측 라벨 배열
 */
export function knnClassify({ train, test, k = 5 }) {
  // lat/lon을 제외한 나머지 키들이 "non-geo 특징"이다. train의 첫 행 기준으로 키 목록을 고정한다.
  const featureKeys = Object.keys(train[0].features)
    .filter((f) => f !== "lat" && f !== "lon")
    .sort();

  // non-geo 특징마다 train 기준 min/max를 구해둔다. 정규화 기준을 test로부터 새지 않게(leakage 방지)
  // train에서만 구하고, test 값이 그 범위를 벗어나면 [0,1]로 clamp한다.
  const stats = {};
  for (const key of featureKeys) {
    let min = Infinity;
    let max = -Infinity;
    for (const row of train) {
      const v = row.features[key];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    stats[key] = { min, range: max - min || 1 }; // range===0(값이 하나뿐)이면 나눗셈 방지로 1 사용
  }

  // 한 행(row)의 non-geo 특징들을 정규화된 숫자 벡터로 미리 변환해둔다 — 거리 계산 시 중복 계산 방지.
  function normVec(row) {
    return featureKeys.map((key) => {
      const { min, range } = stats[key];
      const n = (row.features[key] - min) / range;
      return n < 0 ? 0 : n > 1 ? 1 : n; // clamp
    });
  }

  const trainRows = train.map((row) => ({
    label: row.label,
    lat: row.features.lat,
    lon: row.features.lon,
    vec: normVec(row),
  }));

  return test.map((row) => {
    const lat = row.features.lat;
    const lon = row.features.lon;
    const vec = normVec(row);

    // train 전체와의 거리를 구한다. 정렬에는 제곱거리만 있으면 충분해 sqrt는 생략한다(단조 함수).
    const distances = trainRows.map((tr) => {
      const geoNorm = haversineKm(lat, lon, tr.lat, tr.lon) / 20000; // SPEC §9.1: ÷20000km 정규화
      let sumSq = geoNorm * geoNorm;
      for (let i = 0; i < vec.length; i++) {
        const d = vec[i] - tr.vec[i];
        sumSq += d * d;
      }
      return { label: tr.label, d2: sumSq };
    });
    distances.sort((a, b) => a.d2 - b.d2);

    // 최근접 k개의 다수결 투표.
    const votes = {};
    for (let i = 0; i < k && i < distances.length; i++) {
      const lbl = distances[i].label;
      votes[lbl] = (votes[lbl] || 0) + 1;
    }
    let best = null;
    let bestCount = -1;
    for (const label in votes) {
      if (votes[label] > bestCount) {
        bestCount = votes[label];
        best = label;
      }
    }
    return best;
  });
}

/**
 * 혼동행렬(confusion matrix)과 클래스별 precision/recall/f1, 전체 accuracy를 계산한다.
 * @param {string[]} actual
 * @param {string[]} predicted
 * @param {string[]} classes - 행/열 순서를 고정하는 클래스 목록
 * @returns {{matrix:number[][], perClass:object, accuracy:number}}
 */
export function confusion(actual, predicted, classes) {
  const idx = Object.fromEntries(classes.map((c, i) => [c, i]));
  const matrix = classes.map(() => classes.map(() => 0)); // matrix[실제][예측]
  let correct = 0;
  for (let i = 0; i < actual.length; i++) {
    matrix[idx[actual[i]]][idx[predicted[i]]]++;
    if (actual[i] === predicted[i]) correct++;
  }
  const perClass = {};
  classes.forEach((c, ci) => {
    const tp = matrix[ci][ci];
    let fn = 0;
    let fp = 0;
    for (let j = 0; j < classes.length; j++) {
      if (j === ci) continue;
      fn += matrix[ci][j]; // 실제=c인데 다른 클래스로 예측
      fp += matrix[j][ci]; // 실제는 다른 클래스인데 c로 예측
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass[c] = { precision, recall, f1 };
  });
  return { matrix, perClass, accuracy: actual.length ? correct / actual.length : 0 };
}

/**
 * 다수결 베이스라인(floor): 가장 흔한 라벨 하나로만 찍었을 때의 정확도.
 * @param {string[]} labels
 * @returns {number}
 */
export function majorityBaseline(labels) {
  if (labels.length === 0) return 0;
  const counts = {};
  for (const l of labels) counts[l] = (counts[l] || 0) + 1;
  const max = Math.max(...Object.values(counts));
  return max / labels.length;
}

/**
 * 오라클 상한(ceiling). 각 test 이벤트에 대해, "그 조직의 참 생성 규칙이 이 (위치,날짜,파벌,표적)의
 * 이벤트를 만들어냈을 가능도(likelihood)"를 조직마다 계산해 argmax로 예측한다.
 *
 * likelihood(org | event) = spatial × branchShare × seasonalFactor × targetPref × intensity
 *   - spatial:   그날 org의 실제 중심(TIDEBREAK는 dest()로 drift 반영)과 이벤트 사이 haversine 거리를
 *                그날의 effective radius(=min(RANGE[branch], baseRadius×directive.radiusMult))로 스케일한
 *                가우시안(σ=effRadius/1.4)으로 점수화한다. 실제 배치는 반경 안 균등(면적 기준)이지만,
 *                오라클은 "부드러운" 낙차를 써서 영역이 겹치는 경계의 이벤트가 여러 조직에 비슷한 점수를
 *                받도록 한다 — 그래야 그 이벤트들이 "진짜로 모호"해서 ceiling이 100%에 못 미치게 된다.
 *   - branchShare: 그 조직이 해당 branch를 아예 보유하지 않으면 0 (예: NORTHWIND는 naval 불가능).
 *   - seasonalFactor: DRYSTONE의 12~2월 억제(×0.3)를 그대로 반영.
 *   - targetPref: 조직에 targetPreference가 있으면 P(target=선호타입)=share+(1-share)/4,
 *                 그 외 타입은 (1-share)/4. 없으면 모든 타입 1/4 (§6.4 생성 규칙을 뒤집은 것).
 *   - intensity: baseTempo × directive.tempoMult. 그날 지침 아래서 그 조직이 애초에 사건을 얼마나
 *                자주 일으키는 "성향"이었는지를 사전 확률(prior)처럼 반영한다.
 * 이 함수는 오직 events/ORGS/DIRECTIVES/periods(참 모델)만 읽는다. knnClassify의 feature 경로와는
 * 절대 섞이지 않는다.
 *
 * @param {object[]} events - simulate()가 만든 전체 이벤트 배열
 * @param {number[]} testIdx - events 안에서 test 세트로 뽑힌 인덱스들
 * @param {{ORGS:object[], DIRECTIVES:object, periods:object[]}} truth
 * @returns {number} test 세트에 대한 오라클 정확도
 */
export function oracleAccuracy(events, testIdx, { ORGS: orgs, DIRECTIVES: directives, periods }) {
  // org별로 periods를 모아 startDay 순으로 정렬해둔다 — day가 주어지면 그 구간을 선형 탐색으로 찾는다
  // (org당 기간 수가 수십 개 수준이라 이진탐색 없이도 충분히 빠르다).
  const periodsByOrg = {};
  for (const p of periods) {
    if (!periodsByOrg[p.org]) periodsByOrg[p.org] = [];
    periodsByOrg[p.org].push(p);
  }
  for (const key in periodsByOrg) periodsByOrg[key].sort((a, b) => a.startDay - b.startDay);

  function directiveKeyFor(orgKey, day) {
    const list = periodsByOrg[orgKey] || [];
    for (const p of list) {
      if (day >= p.startDay && day < p.endDay) return p.directive;
    }
    // periods가 [0,DAYS)를 완전히 덮으므로 정상적으로는 도달하지 않는다. 방어적 fallback.
    return list.length ? list[list.length - 1].directive : "CONSOLIDATE";
  }

  let correct = 0;
  for (const i of testIdx) {
    const e = events[i];
    const month = monthOf(e.day);

    let bestOrg = null;
    let bestScore = -Infinity;
    for (const org of orgs) {
      const branchDef = org.branches.find((b) => b.type === e.branch);
      const branchShare = branchDef ? branchDef.share : 0;
      if (branchShare === 0) continue; // 이 조직은 애초에 이 branch를 보유하지 않음 → 확률 0

      const directiveKey = directiveKeyFor(org.key, e.day);
      const directive = directives[directiveKey];

      const center = org.driftKmPerDay
        ? dest(org.base[0], org.base[1], 90, org.driftKmPerDay * e.day)
        : org.base;
      const effRadius = Math.min(RANGE[e.branch], org.baseRadius * directive.radiusMult);
      const d = haversineKm(center[0], center[1], e.lat, e.lon);
      const sigma = effRadius / 1.4;
      const spatial = Math.exp(-(d * d) / (2 * sigma * sigma));

      const seasonalFactor =
        org.seasonal && org.seasonal.months.includes(month) ? org.seasonal.multiplier : 1;

      let targetPref;
      if (org.targetPreference) {
        const share = org.targetPreference.share;
        targetPref = e.target === org.targetPreference.type ? share + (1 - share) / 4 : (1 - share) / 4;
      } else {
        targetPref = 1 / 4;
      }

      const intensity = org.baseTempo * directive.tempoMult;

      const score = spatial * branchShare * seasonalFactor * targetPref * intensity;
      if (score > bestScore) {
        bestScore = score;
        bestOrg = org.key;
      }
    }
    if (bestOrg === e.org) correct++;
  }
  return testIdx.length ? correct / testIdx.length : 0;
}

/**
 * events를 org 기준으로 stratified 80/20 분할한다. 시드 고정 Fisher-Yates 셔플이라 같은 seed면
 * 항상 같은 분할이 나오고, A/B/C 세 런이 전부 이 분할을 공유한다(feature set만 바뀌게 하기 위함).
 * @param {object[]} events
 * @param {number} seed
 * @returns {{trainIdx:number[], testIdx:number[]}}
 */
function stratifiedSplit(events, seed) {
  const rng = mulberry32(seed);
  const byOrg = {};
  events.forEach((e, i) => {
    if (!byOrg[e.org]) byOrg[e.org] = [];
    byOrg[e.org].push(i);
  });

  const trainIdx = [];
  const testIdx = [];
  for (const org in byOrg) {
    const idxs = byOrg[org].slice();
    // seeded Fisher-Yates shuffle
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    const cut = Math.round(idxs.length * 0.8);
    trainIdx.push(...idxs.slice(0, cut));
    testIdx.push(...idxs.slice(cut));
  }
  return { trainIdx, testIdx };
}

// target_type 어휘를 [0,1] 구간의 "정규화된 categorical 인덱스"로 인코딩한다: TARGETS 배열에서의
// 순서(index)를 (length-1)로 나눈다. one-hot(4차원 확장)도 가능했지만, KNN 거리 계산이 이미 lat/lon +
// non-geo 특징들을 정규화된 유클리드로 합산하는 구조라 인덱스 정규화가 구현을 단순하게 유지한다.
// 주의: 이 인코딩은 TARGETS 순서에 임의의 "거리" 개념을 부여한다(예: infrastructure와 government가
// government와 commercial보다 가깝다고 취급됨) — 진짜 categorical 변수라 순서에 의미는 없지만,
// run C의 목적(SPEC §9.3: "DRYSTONE gains")에는 index 정규화로도 충분한 신호가 전달된다.
function encodeTarget(target) {
  return TARGETS.indexOf(target) / (TARGETS.length - 1);
}

// 특징집합 이름(featureSet) 배열을 받아 knnClassify가 기대하는 {features,label}[] 행을 만든다.
function buildFeatureRows(events, idxs, featureSet) {
  return idxs.map((i) => {
    const e = events[i];
    const features = { lat: e.lat, lon: e.lon };
    if (featureSet.includes("day")) features.day = e.day;
    if (featureSet.includes("target")) features.target = encodeTarget(e.target);
    if (featureSet.includes("month")) features.month = monthOf(e.day);
    return { features, label: e.org };
  });
}

/**
 * 세 가지 특징집합(A/B/C)으로 ablation을 실행한다. SPEC §9.3.
 *   A: lat, lon
 *   B: lat, lon, day
 *   C: lat, lon, day, target_type, month
 * target = org. 세 런 모두 같은 (시드 고정) train/test 분할을 공유해서 "분할 차이"가 아니라
 * "특징집합 차이"만 비교되게 한다. ceiling도 같은 test 분할에서 한 번만 계산해 공유한다
 * (오라클은 KNN feature를 전혀 쓰지 않으므로 feature set과 무관하게 동일).
 *
 * @param {{events:object[], periods:object[], seed?:number}} args
 * @returns {{A:object, B:object, C:object}} 각각 {features, accuracy, floor, ceiling, recovered, confusion}
 */
export function runAblation({ events, periods, seed = 20260903 }) {
  const { trainIdx, testIdx } = stratifiedSplit(events, seed);
  const classes = ORGS.map((o) => o.key);

  const featureSets = {
    A: ["lat", "lon"],
    B: ["lat", "lon", "day"],
    C: ["lat", "lon", "day", "target", "month"],
  };

  // 오라클은 feature set에 의존하지 않으므로 한 번만 계산해서 세 런이 공유한다.
  const ceiling = oracleAccuracy(events, testIdx, { ORGS, DIRECTIVES, periods });

  const result = {};
  for (const key of Object.keys(featureSets)) {
    const features = featureSets[key];
    const train = buildFeatureRows(events, trainIdx, features);
    const test = buildFeatureRows(events, testIdx, features);
    const predicted = knnClassify({ train, test, k: 5 });
    const actual = test.map((row) => row.label);

    const conf = confusion(actual, predicted, classes);
    const floor = majorityBaseline(actual);
    const accuracy = conf.accuracy;
    const recovered = (accuracy - floor) / (ceiling - floor);

    result[key] = { features, accuracy, floor, ceiling, recovered, confusion: conf };
  }
  return result;
}
