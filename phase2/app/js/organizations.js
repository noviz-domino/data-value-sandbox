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
    base: [46.0, 103.0], // 몽골 초원 지대, 내륙 — 어느 해안에서도 약 1,500km 떨어져 있음
    branches: [{ type: "ground", share: 1 }],
    baseRadius: 80,
    baseTempo: 0.25,
    driftKmPerDay: 0,
    seasonal: null,
    targetPreference: null, // 모든 표적 유형에 균등
  },
  {
    key: "TIDEBREAK",
    base: [-8.5, 116.0], // 섬 지대 서쪽 끝
    branches: [
      { type: "ground", share: 0.6 },
      { type: "naval", share: 0.4 },
    ],
    baseRadius: 120,
    baseTempo: 0.3,
    driftKmPerDay: 0.5, // 월 15km 동쪽 이동 (5년간 약 900km) — SPEC §7.2
    seasonal: null,
    targetPreference: null,
  },
  {
    key: "DRYSTONE",
    base: [-24.0, 133.0], // 건조한 대륙 내부
    branches: [
      { type: "ground", share: 0.45 },
      { type: "air", share: 0.55 },
    ],
    baseRadius: 300,
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
