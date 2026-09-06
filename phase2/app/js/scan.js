// 주변 스캔(scan) — 특정 스코프를 아직 고르지 않았을 때 "지금 화면 어디가 이 방법으로 가장
// 두드러지는가"에 답한다. SPEC_M4.md §2 항목4.
//
// 정답지 분리(ground truth separation): 이 파일은 inference.js가 노출하는 순수 함수
// (projectForInference/scopeFacilities/inferTargets/standoutZ)만 쓴다. campaigns나 event.org를
// 참조하는 코드는 한 줄도 없다 — main.js가 지키는 것과 같은 경계다(SPEC_M3 §3).
//
// 결정성(determinism): Math.random을 쓰지 않는다. 격자점은 뷰포트 경계에서 산술로만 뽑고,
// inferTargets 자체도 순수 함수라 같은 입력이면 항상 같은 순위가 나온다.

import { haversineKm } from "./geo.js";
import { projectForInference, scopeFacilities, inferTargets, standoutZ } from "./inference.js";

// SPEC_M4 §2 항목4의 숫자들 — 전부 결정(decision)이지 제안이 아니다.
export const SCAN_SPACING_KM = 80;
export const SCAN_CAP_POINTS = 60;
export const SCAN_SCOPE_RADIUS_KM = 160;
export const SCAN_MIN_EVENTS = 25;
export const SCAN_TOP_N = 10;

// 라이브 결과 패널의 Analyze와 마찬가지로 스캔도 "분석관이 가진 신호를 다 쓴다"는 원칙으로
// 항상 P+E+C 전체 특징 집합을 쓴다(main.js의 FULL_FEATURES와 같은 값 — 사다리 비교는
// evaluateInference의 몫이라 여기서 굳이 토글하지 않는다).
const FULL_FEATURES = { proximity: true, encirclement: true, convergence: true };

/**
 * 위경도 사각형(viewport)을 spacingKm 간격의 격자로 나눈다. 격자점이 capPoints를 넘으면
 * "잘라내지 않고 간격을 넓혀" 화면 전체를 계속 덮는다(SPEC §2 항목4: "widen the spacing to fit
 * the cap rather than truncating the area").
 * @param {{west:number, east:number, south:number, north:number}} bounds
 * @param {{spacingKm?:number, capPoints?:number}} [opts]
 * @returns {{points:{lat:number,lon:number}[], spacingKm:number}}
 */
export function computeScanGrid(bounds, { spacingKm = SCAN_SPACING_KM, capPoints = SCAN_CAP_POINTS } = {}) {
  const { west, east, south, north } = bounds;
  const latCenter = (south + north) / 2;
  // 세로 폭(남->북)은 경도와 무관하니 서쪽 경도 하나로 고정해 거리를 잰다.
  const heightKm = Math.max(1, haversineKm(south, west, north, west));
  // 가로 폭(서->동)은 위도마다 1도의 실거리가 다르므로 화면 중앙 위도에서 잰다.
  const widthKm = Math.max(1, haversineKm(latCenter, west, latCenter, east));

  function gridFor(sp) {
    const nx = Math.max(1, Math.floor(widthKm / sp) + 1);
    const ny = Math.max(1, Math.floor(heightKm / sp) + 1);
    return { nx, ny, total: nx * ny };
  }

  let spacing = spacingKm;
  let g = gridFor(spacing);
  let guard = 0; // 무한 루프 방지 — 40회면 폭 몇 광년짜리 화면이 아닌 이상 항상 수렴한다
  while (g.total > capPoints && guard < 40) {
    // 넓혀야 할 배율을 총 개수 비율의 제곱근으로 잡는다(면적 ∝ spacing^2). 1.05를 곱해 살짝
    // 여유를 둬 재계산 왕복 횟수를 줄인다.
    spacing *= Math.sqrt(g.total / capPoints) * 1.05;
    g = gridFor(spacing);
    guard++;
  }

  const points = [];
  for (let iy = 0; iy < g.ny && points.length < capPoints; iy++) {
    const fracY = g.ny > 1 ? iy / (g.ny - 1) : 0.5;
    const lat = south + fracY * (north - south);
    for (let ix = 0; ix < g.nx && points.length < capPoints; ix++) {
      const fracX = g.nx > 1 ? ix / (g.nx - 1) : 0.5;
      const lon = west + fracX * (east - west);
      points.push({ lat, lon });
    }
  }
  return { points, spacingKm: spacing };
}

/**
 * 격자점 하나를 평가한다. 160km 스코프 안 이벤트가 25개 미만이면(SPEC §2 항목4) 아예
 * inferTargets를 돌리지 않고 건너뛴다(null) — "돌려봤는데 약했다"가 아니라 "돌릴 근거가
 * 없었다"를 구분해야 나중에 빈/약한 상태를 정직하게 보여줄 수 있다.
 * @returns {null | { facilityId:string, z:number, prob:number, eventCount:number,
 *   candidateCount:number, scope:object, ranked:object[], warnings:string[] }}
 */
function evaluatePoint(point, window, queryEvents, facilities) {
  const scope = { lat: point.lat, lon: point.lon, radiusKm: SCAN_SCOPE_RADIUS_KM };
  const rawScoped = queryEvents({ scope, window });
  if (rawScoped.length < SCAN_MIN_EVENTS) return null;
  const scopedFacilities = scopeFacilities(facilities, scope);
  if (scopedFacilities.length === 0) return null;
  const projected = projectForInference(rawScoped);
  const result = inferTargets({ events: projected, facilities: scopedFacilities, features: FULL_FEATURES });
  const z = standoutZ(result.ranked.map((r) => r.score));
  const top = result.ranked[0];
  return {
    facilityId: top.facilityId,
    z,
    prob: top.prob,
    eventCount: rawScoped.length,
    candidateCount: scopedFacilities.length,
    scope,
    // 스캔 결과 행을 고르면 "더 가까이 들여다보는" 게 목적이므로(SPEC §2 항목4), 이 스코프의
    // 전체 순위·경고까지 같이 들고 있는다 — 골랐을 때 inferTargets를 다시 돌릴 필요가 없게.
    ranked: result.ranked,
    warnings: result.warnings,
  };
}

/**
 * 현재 뷰포트를 그리드로 스캔한다. cache가 있으면 (격자점, 시간창) 조합이 같을 때 재계산하지
 * 않는다 — 뷰포트를 조금 옮겼다가 되돌리거나, 같은 화면에서 스캔을 다시 눌러도 즉시 끝난다.
 * 여섯 번 이상의 inferTargets 호출은 눈에 띄게 느릴 수 있으므로(SPEC §2 항목4), 몇 점마다 한
 * 번씩 다음 tick으로 양보(yield)해 재생 루프/입력이 멈추지 않게 한다.
 * @param {{points:object[], window:{startDay:number,endDay:number}, queryEvents:Function,
 *   facilities:object[], cache:Map<string, object|null>, onProgress?:(done:number,total:number)=>void}} args
 * @returns {Promise<{hits:object[], scannedPoints:number, hitPoints:number}>}
 */
export async function runScan({ points, window, queryEvents, facilities, cache, onProgress }) {
  const winKey = window.startDay + "-" + window.endDay;
  const byFacility = new Map(); // facilityId -> 지금까지 본 것 중 z가 가장 높은 hit
  let hitPoints = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const cacheKey = p.lat.toFixed(3) + "," + p.lon.toFixed(3) + "@" + winKey;
    let hit = cache.get(cacheKey);
    if (hit === undefined) {
      hit = evaluatePoint(p, window, queryEvents, facilities);
      cache.set(cacheKey, hit);
    }
    if (hit) {
      hitPoints++;
      const prev = byFacility.get(hit.facilityId);
      // "각 시설은 자신의 최고(best) 창만 남긴다" — SPEC §2 항목4: 이웃한 격자점 여럿이 같은
      // 시설을 1등으로 뽑을 수 있으므로, 돋보임 점수 z가 가장 높은 창 하나만 남긴다.
      if (!prev || hit.z > prev.z) byFacility.set(hit.facilityId, { ...hit, point: p });
    }
    if (onProgress) onProgress(i + 1, points.length);
    if (i % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const hits = Array.from(byFacility.values())
    .sort((a, b) => b.z - a.z)
    .slice(0, SCAN_TOP_N);

  return { hits, scannedPoints: points.length, hitPoints };
}
