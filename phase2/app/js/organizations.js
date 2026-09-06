// 조직(organisation)·지침(directive)·방법/표적 어휘 정의. SPEC §7을 그대로 데이터로 옮긴 것.
// 프로토타입의 ORGS/DIRS/DKEYS/RANGE/METH/TGT 배열·객체를 포팅했다 (규칙 자체는 바꾸지 않음).

/**
 * 세 조직의 정의. SPEC §7.1~7.3.
 * - key: events.csv의 org 컬럼에 그대로 들어가는 문자열 식별자
 * - base: [lat, lon] 시작 좌표
 * - branches: 이 조직이 보유한 파벌(ground/naval/air) 목록과 사건 비중(share)
 * - baseRadius: 기본 작전 반경(km)
 * - baseTempo: 하루당 사건 발생 확률의 기준값
 * - driftKmPerDay: 하루에 동쪽(bearing 90)으로 이동하는 거리(km). 0이면 이동 없음.
 * - seasonal: 12~2월에 tempo에 곱해지는 배수. null이면 계절성 없음.
 * - targetPreference: 표적 유형 선호. null이면 완전 균등(uniform).
 */
export const ORGS = [
  {
    key: "NORTHWIND",
    base: [-8.5, 119.0], // 소순다 열도(Lesser Sunda Islands, 롬복/숨바와 일대) 육지 —
    // 남반구, ne_110m_land 상 실제 폴리곤이 존재하는 섬. DRYSTONE에서 동쪽으로 약 44km —
    // RANGE.ground=80km 상한 때문에 baseRadius보다 이 거리가 실제 겹침을 좌우한다 (아래 참고).
    // 주의: 애초 설계안(북호주 Top End)은 이 위도대(±2°)에서 해안선이 동서로 약 5.5도 폭밖에
    // 안 되어(Gulf of Carpentaria로 대륙이 끊김) TIDEBREAK의 6도 이상 이동 요건(§17 기준5)을
    // 만족시킬 수 없었다 — ne_110m_land로 직접 확인 후 같은 위도대(-8.5, 원래 프로토타입 값과 동일)의
    // 더 넓은 섬 지대로 옮겼다. 메커니즘(정지·균등표적·계절성 없음)은 그대로다.
    branches: [{ type: "ground", share: 1 }],
    baseRadius: 500,
    baseTempo: 0.25,
    driftKmPerDay: 0,
    seasonal: null,
    targetPreference: null, // 모든 표적 유형에 균등
  },
  {
    key: "TIDEBREAK",
    base: [-8.5, 113.5], // 발리(Bali) 부근에서 출발해 동쪽으로 표류(drift) — 롬복/숨바와/플로레스로
    // 이어지는 섬 지대를 5년에 걸쳐 가로지른다. 위도 -8.5는 프로토타입 원안과 동일한 값으로,
    // dest()의 동쪽 이동 거리가 위도의 cos(lat)에 반비례해 경도로 환산되는 관계상 planted-signal
    // 자체 검증(§17)이 요구하는 8.2~8.4도 구간에 이미 잘 맞는다(=8.296도).
    branches: [
      { type: "ground", share: 0.6 },
      { type: "naval", share: 0.4 },
    ],
    baseRadius: 300,
    baseTempo: 0.3,
    driftKmPerDay: 0.5, // 하루 0.5km 동쪽 이동 (5년간 약 900km, 경도 약 8.3도) — SPEC §7.2
    seasonal: null,
    targetPreference: null,
  },
  {
    key: "DRYSTONE",
    base: [-8.5, 118.6], // NORTHWIND에서 서쪽으로 약 44km. RANGE.ground=80km 상한 때문에
    // ground 파벌끼리는 이 거리에서만 실제로 겹친다 — baseRadius(500km)는 air 파벌(상한 600km)에만
    // 그대로 적용되어 훨씬 넓게 퍼지며 NORTHWIND·TIDEBREAK 영역까지 뒤덮는다.
    branches: [
      { type: "ground", share: 0.45 },
      { type: "air", share: 0.55 },
    ],
    baseRadius: 500,
    baseTempo: 0.35,
    driftKmPerDay: 0,
    seasonal: { months: [12, 1, 2], multiplier: 0.3 }, // 남반구 여름철 활동 억제
    targetPreference: { type: "infrastructure", share: 0.7 }, // 나머지는 3종에 균등 분배
  },
];

/**
 * 지침(directive)별 배율과 선택 가중치. SPEC §7.5.
 * radiusMult: baseRadius에 곱해지는 배율
 * tempoMult: baseTempo에 곱해지는 배율
 * weight: 새 지침을 뽑을 때 쓰는 가중치 (가중 랜덤, 균등 아님)
 */
export const DIRECTIVES = {
  EXPAND: { radiusMult: 1.5, tempoMult: 1.2, weight: 0.35 },
  CONSOLIDATE: { radiusMult: 0.6, tempoMult: 1.0, weight: 0.45 },
  SUPPRESS: { radiusMult: 1.0, tempoMult: 0.3, weight: 0.2 },
};

/**
 * 파벌(branch)별 공격 방법과 그 확률 가중치. SPEC §7.4.
 * 각 배열은 [메서드 이름들], [그에 대응하는 가중치들] 쌍이다.
 */
export const METHODS = {
  ground: { values: ["explosive", "firearm", "melee"], weights: [0.55, 0.35, 0.1] },
  naval: { values: ["explosive", "firearm", "vessel_ram"], weights: [0.4, 0.45, 0.15] },
  air: { values: ["explosive", "incendiary"], weights: [0.7, 0.3] },
};

/** 표적 유형 어휘. SPEC §7.4. */
export const TARGETS = ["infrastructure", "government", "commercial", "transport"];

/** 파벌별 최대 작전 반경(km). effectiveRadius는 baseRadius*directiveMult와 이 값 중 작은 쪽. SPEC §6.3. */
export const RANGE = { ground: 80, naval: 250, air: 600 };

// ── M4-T3(SPEC_M4 §3): 신호 강도(§12.1) ↔ 실제 파라미터 변환, 그리고 조직/지침 오버라이드 ──
//
// simulate()의 기본 호출 경로(overrides 없음)는 이 섹션의 어떤 함수도 거치지 않는다 — org-view가
// 오버라이드를 만들 때만 쓰는 "순수 변환 함수" 모음이다. ORGS/DIRECTIVES 원본은 이 파일의 다른
// 어떤 코드도 변형하지 않는다(참조 그대로 analysis.js의 오라클이 계속 가져다 쓴다).

/** 선형 보간. a(t=0) -> b(t=1). */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * SPEC_M4 §3.2 표의 세 점(strength=0/1.0/2.0)을 정확히 지나가는 구간별 선형(piecewise-linear)
 * 보간. 표 자체가 0→1.0 구간과 1.0→2.0 구간의 기울기가 다르게 적혀 있어(예: DRYSTONE 계절성은
 * 1.0→0.30, 2.0→0.15로 뒤 구간이 앞 구간 기울기의 절반), 매끈한 단일 공식 하나로는 세 값을
 * 동시에 못 맞춘다. "표에 적힌 숫자와 정확히 일치"를 최우선으로 둔다.
 * @param {number} strength - 0~2.0
 * @param {number} at0 - strength=0일 때 값
 * @param {number} at1 - strength=1.0(기본)일 때 값
 * @param {number} at2 - strength=2.0일 때 값
 */
function piecewise(strength, at0, at1, at2) {
  if (strength <= 1) return lerp(at0, at1, strength);
  return lerp(at1, at2, strength - 1);
}

/** TIDEBREAK 표류 속도(km/day). §3.2: 0=정지, 1.0=0.5(기본), 2.0=1.0. 완전히 선형이라 구간이 필요 없다. */
export function driftRateForStrength(strength) {
  return 0.5 * strength;
}

/** DRYSTONE 계절 억제 배율. §3.2: 0=억제 없음(=1.0), 1.0=×0.30(기본), 2.0=×0.15. */
export function seasonalMultiplierForStrength(strength) {
  return piecewise(strength, 1, 0.3, 0.15);
}

/** DRYSTONE 표적 선호 비중(share). §3.2: 0=균등(share=0), 1.0=0.70(기본), 2.0=0.95. */
export function targetPreferenceShareForStrength(strength) {
  return piecewise(strength, 0, 0.7, 0.95);
}

// 지침 효과 크기(§3.2)는 radiusMult에만 건다 — 표가 예시로 든 것도 radius뿐이고(tempoMult는
// 표에 없다), SUPPRESS의 radiusMult는 원래 1.0(효과 없음)이라 강도를 아무리 올려도 그대로 1.0이다.
const DIRECTIVE_RADIUS_AT2 = { EXPAND: 2.0, CONSOLIDATE: 0.4, SUPPRESS: 1.0 };

/**
 * 지침 하나의 radiusMult를 강도(strength)에 맞게 다시 계산한다.
 * strength=0 -> 1.0(효과 없음), strength=1.0 -> baseMult(원래 값 그대로), strength=2.0 ->
 * DIRECTIVE_RADIUS_AT2[key](§3.2 표에 박힌 값. 모르는 키는 baseMult를 그대로 극값으로 취급).
 */
export function directiveRadiusMultForStrength(directiveKey, baseMult, strength) {
  const at2 = DIRECTIVE_RADIUS_AT2[directiveKey] != null ? DIRECTIVE_RADIUS_AT2[directiveKey] : baseMult;
  return piecewise(strength, 1, baseMult, at2);
}

/**
 * 잡음비(noise ratio, §3.2) 슬라이더 -> 배경(background) baseTempo 배율.
 * 표는 "전체 이벤트 중 배경 비중" s로 적혀 있다(0%/80%/95%). 배경:캠페인 비는 오즈비 s/(1-s)이고,
 * 캠페인 이벤트 수는 배경 tempo와 거의 무관하게 결정되므로(campaigns.js는 조직 위치·시설 근접성만
 * 보고 표적을 고른다 — 배경 물량과 무관), 이 오즈비를 strength=1.0 기준(s=0.80, 지금 커밋된 데이터셋의
 * 실제 비중)으로 정규화해 배율로 쓰면 strength=1.0에서 정확히 1배가 된다. 실제 도달 비중은
 * rejection sampling 특성상 근사치다(정확한 캘리브레이션이 아니라 "방향과 크기가 맞는" 조작 변수).
 * @param {number} strength
 * @returns {number} baseTempo에 곱할 배율. strength=0이면 0(배경 완전 제거).
 */
export function noiseTempoMultiplierForStrength(strength) {
  const share = piecewise(strength, 0, 0.8, 0.95);
  if (share <= 0) return 0;
  const odds = share / (1 - share);
  const baseOdds = 0.8 / 0.2; // strength=1.0 기준(=4) — 여기로 나눠야 1.0에서 배율이 1이 된다.
  return odds / baseOdds;
}

/**
 * ORGS를 깊은 복사한 "편집용 초안(draft)" 배열을 만든다. 폼(§3.1)이 이 배열을 자유롭게 뜯어고쳐도
 * 원본 ORGS(analysis.js 오라클이 참조로 그대로 쓰는 배열)는 절대 건드리지 않는다.
 * @returns {object[]}
 */
export function cloneDefaultOrgs() {
  return ORGS.map((o) => ({
    ...o,
    base: [...o.base],
    branches: o.branches.map((b) => ({ ...b })),
    seasonal: o.seasonal ? { ...o.seasonal, months: [...o.seasonal.months] } : null,
    targetPreference: o.targetPreference ? { ...o.targetPreference } : null,
  }));
}

/**
 * simulate()가 바로 소비할 수 있는 ORGS 모양의 배열을 만든다: baseOrgs(보통 ORGS) 위에
 * orgOverrides(키별 부분 필드 오버라이드)를 얹는다. orgOverrides가 없으면 baseOrgs 참조를
 * 그대로 돌려준다 — simulate()의 기본 호출 경로가 byte-identical을 유지하는 핵심 축이다.
 * @param {object[]} baseOrgs
 * @param {Record<string, object>|null} orgOverrides
 * @returns {object[]}
 */
export function applyOrgOverrides(baseOrgs, orgOverrides) {
  if (!orgOverrides) return baseOrgs;
  return baseOrgs.map((org) => {
    const o = orgOverrides[org.key];
    if (!o) return org;
    return {
      ...org,
      ...o,
      branches: o.branches || org.branches,
      seasonal: o.seasonal !== undefined ? o.seasonal : org.seasonal,
      targetPreference: o.targetPreference !== undefined ? o.targetPreference : org.targetPreference,
    };
  });
}

/**
 * DIRECTIVES 모양의 오브젝트를 만든다: baseDirectives(보통 DIRECTIVES) 위에 directiveOverrides
 * (키별 부분 필드 오버라이드)를 얹는다. 없으면 baseDirectives 참조를 그대로 돌려준다.
 * @param {object} baseDirectives
 * @param {Record<string, object>|null} directiveOverrides
 * @returns {object}
 */
export function applyDirectiveOverrides(baseDirectives, directiveOverrides) {
  if (!directiveOverrides) return baseDirectives;
  const out = {};
  for (const key in baseDirectives) {
    out[key] = directiveOverrides[key] ? { ...baseDirectives[key], ...directiveOverrides[key] } : baseDirectives[key];
  }
  return out;
}
