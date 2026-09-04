// 지리 계산 엔진: 두 지점 사이 거리(haversine), 특정 방위·거리만큼 이동한 좌표(dest),
// 그리고 실제 Natural Earth 폴리곤을 이용한 육지/연안 판정(makeLandTest).
// dest()의 구형 삼각법 공식은 프로토타입(phase2/prototype/index.html)의 `dest` 함수를 그대로 포팅했다.

const R = 6371; // 지구 평균 반지름(km). haversine·destination point 공식 모두 이 값을 기준으로 한다.
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * 두 좌표 사이의 대권거리(great-circle distance)를 km 단위로 구한다.
 * 위경도를 평면 좌표처럼 취급해 유클리드 거리로 계산하면 안 된다(SPEC §5.3의 경고 사항) —
 * 위도가 높아질수록 경도 1도가 나타내는 실제 거리가 줄어들기 때문에 반드시 haversine을 써야 한다.
 * @param {number} la1 위도1 (deg)
 * @param {number} lo1 경도1 (deg)
 * @param {number} la2 위도2 (deg)
 * @param {number} lo2 경도2 (deg)
 * @returns {number} km 단위 거리
 */
export function haversineKm(la1, lo1, la2, lo2) {
  const p1 = toRad(la1);
  const p2 = toRad(la2);
  const dp = toRad(la2 - la1); // delta phi (위도 차이)
  const dl = toRad(lo2 - lo1); // delta lambda (경도 차이)
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 출발 좌표에서 주어진 방위각(bearing)으로 distance km만큼 이동한 도착 좌표를 구한다.
 * 구면 삼각법의 "destination point" 공식. 프로토타입의 `dest(la,lo,brg,d)`와 동일한 로직.
 * @param {number} la 출발 위도 (deg)
 * @param {number} lo 출발 경도 (deg)
 * @param {number} bearingDeg 방위각, 0=북, 90=동 (deg)
 * @param {number} km 이동 거리 (km)
 * @returns {[number, number]} [도착 위도, 도착 경도]
 */
export function dest(la, lo, bearingDeg, km) {
  const dr = km / R; // 각거리(angular distance) = 이동거리 / 지구반지름 (라디안)
  const b = toRad(bearingDeg);
  const p1 = toRad(la);
  const l1 = toRad(lo);
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(b)
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(dr) * Math.cos(p1),
      Math.cos(dr) - Math.sin(p1) * Math.sin(p2)
    );
  // 경도를 -180..180 범위로 정규화 (날짜변경선을 넘어가도 안전하게)
  return [toDeg(p2), (((toDeg(l2) + 540) % 360) - 180)];
}

/**
 * ne_110m_land GeoJSON(FeatureCollection, geometry.type === "Polygon")으로부터
 * 육지/연안 판정 함수를 만든다. 프로토타입은 손으로 그린 좌표 배열(LAND)을 썼지만,
 * 여기서는 실제 Natural Earth 폴리곤을 대상으로 같은 point-in-polygon 로직을 적용한다.
 * @param {object} ne110geojson - ne_110m_land.geojson을 JSON.parse한 객체
 * @returns {{ isLand: (lon:number, lat:number)=>boolean, isCoastal: (lat:number, lon:number, km?:number)=>boolean }}
 */
export function makeLandTest(ne110geojson) {
  // 모든 폴리곤의 모든 ring(외곽선 + 구멍)을 하나의 평평한 배열로 모아둔다.
  // ring[0]은 외곽선(exterior), ring[1..]은 구멍(hole)인데, even-odd 규칙으로
  // 모든 ring을 동일하게 취급해 교차할 때마다 안/밖을 뒤집으면 구멍도 자동으로 처리된다.
  const rings = [];
  for (const feature of ne110geojson.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) rings.push(ring);
    } else if (geom.type === "MultiPolygon") {
      // ne_110m_land는 전부 Polygon이지만, 다른 Natural Earth 데이터셋을 넣어도
      // 깨지지 않도록 MultiPolygon도 방어적으로 지원한다.
      for (const poly of geom.coordinates) for (const ring of poly) rings.push(ring);
    }
  }

  /**
   * 점 (lon,lat)이 육지인지 판정한다. even-odd ray casting: 점에서 오른쪽으로 무한히
   * 뻗은 가상의 수평선이 폴리곤 변(edge)과 몇 번 교차하는지 세어, 홀수면 내부(육지).
   */
  function isLand(lon, lat) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        // 변(edge)이 현재 위도(lat)를 가로지르는지 확인하고, 가로지른다면
        // 그 지점의 경도가 lon보다 오른쪽에 있는지로 교차 여부를 판단한다.
        const intersects =
          yi > lat !== yj > lat &&
          lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
        if (intersects) inside = !inside; // 교차할 때마다 안/밖 뒤집기 (구멍도 이 규칙 하나로 처리됨)
      }
    }
    return inside;
  }

  /**
   * 점 (lat,lon)이 "연안"인지 판정한다. 육지이면서, km 거리 안에 바다가 있으면 연안.
   * 8방위(45도 간격)로 샘플을 찍어 하나라도 바다가 나오면 해안 근처로 본다 —
   * 진짜 해안선까지의 거리를 정밀 계산하지 않는 근사치이며, SPEC §5.2가 허용한 방식이다.
   */
  function isCoastal(lat, lon, km = 30) {
    if (!isLand(lon, lat)) return false;
    for (let b = 0; b < 360; b += 45) {
      const [pla, plo] = dest(lat, lon, b, km);
      if (!isLand(plo, pla)) return true;
    }
    return false;
  }

  return { isLand, isCoastal };
}
