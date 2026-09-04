// deck.gl 지도 모듈 — GTD 시뮬레이터 M1의 지도 렌더링을 전담한다.
// phase2/prototype/index.html의 Canvas 2D 지도(손으로 그린 폴리곤, 애니메이션 루프 직접 구현)를
// 대체한다. 시각적 의도(레이어 순서, 글로우, 펄스, 궤적, 팔레트)는 프로토타입을 그대로 따르되,
// 실제 렌더링은 deck.gl의 GPU 레이어로 옮긴다 (BUILD_PLAN.md T3, SPEC.md §11.1/§15).
//
// ── 배포 전 필수 사전조건 (T5 wiring 작업이 index.html에 추가해야 함) ──────────────────
// index.html의 <head> 또는 main.js 스크립트 태그 "이전"에 UMD 번들을 로드해야 한다.
// deck.gl은 cdnjs.cloudflare.com에는 배포되어 있지 않다 (2026-09 기준 확인됨 — cdnjs에는
// "deck.js"라는 동명이인 프레젠테이션 프레임워크만 있고 deck.gl 자체는 없다).
// 대신 jsDelivr(npm 미러)를 사용한다. 이 파일은 아래 정확한 버전을 기준으로 작성되었다:
//
//   <script src="https://cdn.jsdelivr.net/npm/deck.gl@9.3.11/dist.min.js"></script>
//
// 이 스크립트가 main.js보다 먼저 로드되어 있어야 `window.deck`이 존재한다.
// window.deck에서 이 모듈이 실제로 참조하는 것: Deck, MapView, GeoJsonLayer,
// ScatterplotLayer, PathLayer, TextLayer. 버전을 바꾸려면 이 파일의 로직이 여전히
// 맞는지(특히 Deck 생성자의 parent/viewState 옵션) 확인할 것.
// ──────────────────────────────────────────────────────────────────────────

import { dest } from "./geo.js";
import { DIRECTIVES } from "./organizations.js";

// SPEC §15.1의 조직 팔레트는 이후 프로토타입에서 실측 검증된 값(§57C7EA 등)으로
// 갱신되었다 — 이 프로젝트가 "지금 재현해야 할 검증된 시각 의도"로 지정한
// phase2/prototype/index.html 라인 227-229와 정확히 일치시킨다.
const ORG_COLORS = {
  NORTHWIND: "#57C7EA",
  TIDEBREAK: "#F2A03D",
  DRYSTONE: "#C77DD8",
};

// 지도 크롬(chrome) 색상. SPEC §15.1 --land/--land-edge 값을 그대로 사용.
const LAND_FILL = "#263038";
const LAND_EDGE = "#38454F";

const DEFAULT_DIRECTIVE = "CONSOLIDATE"; // 활성 기간(period)이 없을 때(시뮬레이션 시작 직후 등)의 폴백. 프로토타입과 동일한 규칙.

/** "#RRGGBB" 문자열을 deck.gl이 기대하는 [r,g,b] 정수 배열(0-255)로 바꾼다. */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 매 setFrame마다 새로 만들지 않도록 조직별 RGB를 한 번만 계산해 캐시한다.
const ORG_RGB = Object.fromEntries(
  Object.entries(ORG_COLORS).map(([k, v]) => [k, hexToRgb(v)])
);

/**
 * 조직 하나의 오늘(day) 시점 실효 반경(km)과 활성 지침을 구한다.
 * SPEC §6.2: effectiveRadius = baseRadius * directive.radiusMult (조직 단위 반경 — 파벌별
 * 최대 사거리로 한 번 더 클램프되는 것은 이벤트 배치 시점의 로직이라 지도의 반경 링에는
 * 적용하지 않는다. 프로토타입 §356도 동일하게 clamp 없이 그렸다).
 * @param {object} org - organizations.js의 ORGS 항목과 같은 모양 (key, base, baseRadius, driftKmPerDay 등)
 * @param {object[]} periods - simulate()가 반환한 {org,directive,startDay,endDay}[]
 * @param {number} day - 현재 재생 일자
 */
function activeDirectiveFor(org, periods, day) {
  const p = periods.find(
    (q) => q.org === org.key && day >= q.startDay && day < q.endDay
  );
  return p ? p.directive : DEFAULT_DIRECTIVE;
}

/** 조직의 오늘(day) 시점 실제 중심 좌표. TIDEBREAK처럼 drift가 있으면 매일 동쪽으로 이동한다 (SPEC §7.2). */
function currentBase(org, day) {
  if (!org.driftKmPerDay) return org.base;
  return dest(org.base[0], org.base[1], 90, org.driftKmPerDay * day);
}

/**
 * deck.gl 지도 컨트롤러를 만든다.
 * @param {HTMLElement} container - deck.gl이 canvas를 붙일 빈 div
 * @param {{ onHover?: (info:object)=>void, landGeo: object, coastGeo: object }} opts
 *   landGeo/coastGeo — 호출자가 미리 fetch+parse한 ne_50m GeoJSON FeatureCollection.
 *   이 모듈은 네트워크 요청을 하지 않는다.
 * @returns {{ setFrame: Function, setView: Function, getViewState: Function, destroy: Function }}
 */
export function createMap(container, { onHover, landGeo, coastGeo } = {}) {
  const { Deck, MapView, GeoJsonLayer, ScatterplotLayer, PathLayer, TextLayer } = window.deck;

  // viewState를 직접 소유한다(controlled component 패턴). Deck에 항상 이 값을 넘기고,
  // 사용자가 드래그/휠로 바꾸면 onViewStateChange에서 갱신해 다시 넘긴다.
  // 아시아-태평양 조직들이 한눈에 보이도록 longitude 120, latitude -5, zoom 1.5로 시작한다.
  let viewState = { longitude: 120, latitude: -5, zoom: 1.5, pitch: 0, bearing: 0 };

  // 가장 최근 setFrame 인자를 기억해둔다 — layer 재계산 없이 뷰만 바꿀 때(setView) 쓸 일은
  // 없지만, destroy 전까지 마지막 프레임 정보를 들고 있으면 디버깅에 유용하다.
  let lastFrame = null;

  const deckInstance = new Deck({
    parent: container, // container 안에 deck.gl이 자체 <canvas>를 만들어 붙인다
    views: new MapView({ id: "map", controller: true }), // controller:true — 팬/줌/스크롤을 deck.gl이 알아서 처리
    viewState,
    onViewStateChange: ({ viewState: vs }) => {
      viewState = vs;
      deckInstance.setProps({ viewState });
    },
    // 배경을 완전 투명하게 비워서 페이지의 --void(#070B0F)가 그대로 비치게 한다.
    parameters: { clearColor: [0, 0, 0, 0] },
    style: { backgroundColor: "transparent" },
    layers: [],
    onHover: (info) => {
      if (onHover) onHover(info);
    },
    getCursor: () => "crosshair",
  });

  /**
   * 매 프레임 호출된다. events/periods/orgs를 받아 SPEC §11.1 순서(뒤→앞)로 레이어를 다시 만들고
   * deck 인스턴스에 통째로 교체한다. deck.gl은 레이어 배열을 diff해서 안 바뀐 레이어는 재사용하므로
   * 매번 새 배열을 만들어도 GPU 자원을 다시 만들지 않는다.
   */
  function setFrame(frame) {
    lastFrame = frame;
    const { day, events, orgs, periods, visibleOrgs } = frame;
    // reveal은 M1에서 지도 레이어에 영향을 주지 않는다 — 진짜 답 공개 시각화는 타임라인/카드가 맡는다.
    // 시그니처만 유지해두고(향후 마일스톤 대비), 여기서는 아무 동작도 하지 않는다.

    const isVisible = (orgKey) => !visibleOrgs || visibleOrgs.has(orgKey);
    const colorOf = (orgKey) => ORG_RGB[orgKey] || [200, 200, 200];

    const layers = [];

    // ── 1. 육지 채움 + 해안선 스트로크 ──────────────────────────────────────
    if (landGeo) {
      layers.push(
        new GeoJsonLayer({
          id: "land",
          data: landGeo,
          filled: true,
          stroked: false,
          getFillColor: hexToRgb(LAND_FILL),
          pickable: false,
        })
      );
    }
    if (coastGeo) {
      layers.push(
        new GeoJsonLayer({
          id: "coast",
          data: coastGeo,
          filled: false, // 해안선은 채우지 않는다 — 육지 채움은 위의 land 레이어가 이미 담당
          stroked: true,
          getLineColor: hexToRgb(LAND_EDGE),
          lineWidthMinPixels: 1,
          pickable: false,
        })
      );
    }

    // 이후 이벤트/조직 레이어에서 반복 필터링하지 않도록 보이는 조직의 이벤트만 한 번 걸러둔다.
    const visibleEvents = (events || []).filter((e) => e.day <= day && isVisible(e.org));

    // ── 2. 누적 이벤트 — 2px 남짓, 조직색, 낮은 불투명도(0.35) ──────────────────
    layers.push(
      new ScatterplotLayer({
        id: "events-accum",
        data: visibleEvents,
        getPosition: (d) => [d.lon, d.lat],
        radiusUnits: "pixels",
        getRadius: 1, // 반지름 1px ≈ 지름 2px
        getFillColor: (d) => [...colorOf(d.org), 90], // 90/255 ≈ 0.35
        pickable: true,
      })
    );

    // ── 3. 최근 이벤트(≤30일) — 가산 블렌딩 글로우. 최신일수록 크고 진하게 ─────────
    const recentEvents = visibleEvents.filter((e) => day - e.day >= 0 && day - e.day <= 30);
    layers.push(
      new ScatterplotLayer({
        id: "events-glow",
        data: recentEvents,
        getPosition: (d) => [d.lon, d.lat],
        radiusUnits: "pixels",
        getRadius: (d) => {
          const f = 1 - (day - d.day) / 30; // 1(오늘) → 0(30일 전)
          return 1.6 + f * 2.4;
        },
        getFillColor: (d) => {
          const f = 1 - (day - d.day) / 30;
          return [...colorOf(d.org), Math.round(60 + f * 170)];
        },
        pickable: true,
        // 가산(additive) 블렌딩: SRC_ALPHA(770) / ONE(1). 여러 개의 글로우가 겹치면
        // 알파를 곱하는 대신 더해서, 사건이 밀집한 곳이 실제로 더 밝게 빛나 보인다.
        parameters: {
          blendFunc: [770, 1, 770, 1],
          depthTest: false,
        },
      })
    );

    // 이후 org 레이어들(마커/라벨/반경/궤적)에 공통으로 쓸 "오늘의 조직 상태"를 한 번만 계산한다.
    const orgFrames = (orgs || [])
      .filter((org) => isVisible(org.key))
      .map((org) => {
        const [la, lo] = currentBase(org, day);
        const directiveKey = activeDirectiveFor(org, periods || [], day);
        const radiusKm = org.baseRadius * DIRECTIVES[directiveKey].radiusMult;
        return { org, lat: la, lon: lo, directiveKey, radiusKm };
      });

    // ── 4. 조직 기본 위치 마커 (색 채움 원 + 얇은 테두리) ──────────────────────
    layers.push(
      new ScatterplotLayer({
        id: "org-markers",
        data: orgFrames,
        getPosition: (d) => [d.lon, d.lat],
        radiusUnits: "pixels",
        getRadius: 6,
        getFillColor: (d) => colorOf(d.org.key),
        stroked: true,
        getLineColor: [7, 11, 15], // --void — 배경과 대비되는 얇은 테두리
        lineWidthMinPixels: 1,
        pickable: true,
      })
    );

    // ── 5. 콜사인 라벨 (org.key, 마커 오른쪽) ─────────────────────────────────
    layers.push(
      new TextLayer({
        id: "org-labels",
        data: orgFrames,
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.org.key,
        getColor: (d) => colorOf(d.org.key),
        getSize: 11,
        fontFamily: '"IBM Plex Sans Condensed", system-ui, sans-serif',
        fontWeight: 600,
        getPixelOffset: [16, 0],
        getTextAnchor: "start",
        getAlignmentBaseline: "center",
        pickable: false,
      })
    );

    // ── 6. 작전 반경 링 — 현재 지침의 배율이 적용된 반경, 테두리만 그림 ──────────
    // 점선 처리는 nice-to-have였으나, deck.gl UMD 번들에 PathStyleExtension이 항상
    // 포함되는지 버전마다 보장할 수 없어 신뢰성을 위해 실선(옅은 알파)으로 근사했다.
    layers.push(
      new ScatterplotLayer({
        id: "org-radius",
        data: orgFrames,
        getPosition: (d) => [d.lon, d.lat],
        stroked: true,
        filled: false,
        radiusUnits: "meters",
        getRadius: (d) => d.radiusKm * 1000,
        getLineColor: (d) => [...colorOf(d.org.key), 80], // ≈0.32 알파, 프로토타입과 동일 수준
        lineWidthUnits: "pixels",
        getLineWidth: 1,
        pickable: false,
      })
    );

    // ── 7. TIDEBREAK 궤적 — day 0 기준 위치에서 오늘 위치까지의 이동 경로 ─────────
    const tidebreak = orgFrames.find((d) => d.org.key === "TIDEBREAK" && d.org.driftKmPerDay);
    if (tidebreak) {
      layers.push(
        new PathLayer({
          id: "tidebreak-trail",
          data: [
            {
              path: [
                [tidebreak.org.base[1], tidebreak.org.base[0]], // [lon, lat] — day 0
                [tidebreak.lon, tidebreak.lat], // 오늘
              ],
            },
          ],
          getPath: (d) => d.path,
          getColor: [...colorOf("TIDEBREAK"), 140],
          widthUnits: "pixels",
          getWidth: 1.5,
          pickable: false,
        })
      );
    }

    deckInstance.setProps({ layers });
  }

  /** 카메라를 부분적으로 갱신한다 (예: 줌 프리셋 버튼). 전달하지 않은 필드는 현재 값을 유지. */
  function setView({ zoom, longitude, latitude } = {}) {
    viewState = {
      ...viewState,
      ...(zoom !== undefined ? { zoom } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      ...(latitude !== undefined ? { latitude } : {}),
    };
    deckInstance.setProps({ viewState });
  }

  /** 현재 카메라 상태를 반환한다. 좌표 판독기(readout) 등 화면 표시용이므로 소수점을 정리해서 내보낸다. */
  function getViewState() {
    return {
      longitude: Math.round(viewState.longitude * 1000) / 1000,
      latitude: Math.round(viewState.latitude * 1000) / 1000,
      zoom: Math.round(viewState.zoom * 100) / 100,
    };
  }

  function destroy() {
    deckInstance.finalize();
    lastFrame = null;
  }

  return { setFrame, setView, getViewState, destroy };
}
