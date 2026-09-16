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
// 색상 팔레트(M3-T4)는 이제 전부 palette.js 한 곳에서 관리한다. 이 모듈이 CSS
// :root(--void/--land 등)와 어긋나지 않도록, 값을 바꿀 땐 palette.js와 style.css를
// 같이 고칠 것 — palette.js 상단 주석에 그 이유가 적혀 있다.
import { RGB, ORG_RGB } from "./palette.js";

const DEFAULT_DIRECTIVE = "CONSOLIDATE"; // 활성 기간(period)이 없을 때(시뮬레이션 시작 직후 등)의 폴백. 프로토타입과 동일한 규칙.

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
// 후보 시설 마커용 "속이 빈 정사각형" 아이콘을 1회만 캔버스로 그려 data URL로 캐시해둔다.
// deck.gl의 IconLayer는 이미지 텍스처가 필요한데, 흰색으로 그려두면 getColor로 원하는 색으로
// 틴트(tint)할 수 있다 — SPEC_M3 §7 "이벤트는 점, 시설은 속 빈 정사각형" 요건.
let squareIconCache = null;
function squareIconUrl() {
  if (squareIconCache) return squareIconCache;
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3.5;
  ctx.strokeRect(5, 5, 22, 22);
  squareIconCache = c.toDataURL();
  return squareIconCache;
}

export function createMap(container, { onHover, onFacilityClick, landGeo, coastGeo } = {}) {
  const { Deck, MapView, GeoJsonLayer, ScatterplotLayer, PathLayer, TextLayer, IconLayer } = window.deck;

  // viewState를 직접 소유한다(controlled component 패턴). Deck에 항상 이 값을 넘기고,
  // 사용자가 드래그/휠로 바꾸면 onViewStateChange에서 갱신해 다시 넘긴다.
  // 기본 화면(AO). 예전엔 zoom 1.5라 화면의 80%가 사건이 하나도 없는 빈 바다/대륙이었다(첫 화면
  // 결함) — 사건은 전부 인도네시아 부근 한 곳에 몰려 있으므로, "AO" 버튼(z-ao, main.js)이 쓰는
  // 값(zoom 3, longitude 120, latitude -5)을 기본값으로도 그대로 쓴다. "세계" 버튼(z-world)은
  // 그대로 남아 있어 필요하면 언제든 zoom 0.3으로 돌아갈 수 있다.
  let viewState = { longitude: 120, latitude: -5, zoom: 3, pitch: 0, bearing: 0 };

  // 가장 최근 setFrame 인자를 기억해둔다 — layer 재계산 없이 뷰만 바꿀 때(setView) 쓸 일은
  // 없지만, destroy 전까지 마지막 프레임 정보를 들고 있으면 디버깅에 유용하다.
  let lastFrame = null;

  // ── 파생 배열 캐시 (일시정지 중 매 rAF 프레임 재계산을 막는다) ────────────────────────
  // main.js의 재생 루프는 playing=false일 때도 requestAnimationFrame마다 setFrame을 호출한다
  // (chrome()/windowControl.draw()가 계속 갱신돼야 해서). 그런데 지금까지는 그 매 프레임마다
  // visibleEvents/recentEvents/orgFrames를 filter/map으로 새로 만들었다 — 입력이 하나도 안
  // 바뀌었어도 새 배열 identity가 나오니 deck.gl이 매번 diff하고 해당 레이어를 재업로드한다.
  // 실제로 값이 바뀔 수 있는 입력(events 배열 identity, day, visibleOrgs 내용, orgs/periods
  // identity)이 그대로면 이전 계산 결과를 그대로 재사용한다.
  const derivedCache = {
    visibleEvents: { eventsRef: null, day: null, orgsKey: null, data: [] },
    recentEvents: { visibleEventsRef: null, day: null, data: [] },
    orgFrames: { orgsRef: null, periodsRef: null, day: null, orgsKey: null, directivesRef: null, data: [] },
  };
  // visibleOrgs는 main.js에서 매번 새 Set을 만들지 않고 같은 Set 인스턴스를 add/delete로 계속
  // 고쳐 쓰므로, 참조(reference)만 비교하면 내용이 바뀌어도 "안 바뀜"으로 오판한다. 정렬된
  // 키 문자열로 내용을 비교한다. visibleOrgs가 없으면(=전부 표시) 고정 문자열을 쓴다.
  function visibleOrgsKeyOf(visibleOrgs) {
    return visibleOrgs ? Array.from(visibleOrgs).sort().join(",") : "__all__";
  }

  const deckInstance = new Deck({
    parent: container, // container 안에 deck.gl이 자체 <canvas>를 만들어 붙인다
    views: new MapView({ id: "map", controller: true }), // controller:true — 팬/줌/스크롤을 deck.gl이 알아서 처리
    viewState,
    onViewStateChange: ({ viewState: vs }) => {
      viewState = vs;
      deckInstance.setProps({ viewState });
    },
    // 배경을 완전 투명하게 비워서 페이지의 --void(#0B1017)가 그대로 비치게 한다.
    parameters: { clearColor: [0, 0, 0, 0] },
    style: { backgroundColor: "transparent" },
    layers: [],
    onHover: (info) => {
      if (onHover) onHover(info);
    },
    // 후보 시설 마커(candidate-facilities 레이어, pickable:true)를 클릭하면 결과 패널에서 고르는 것과
    // 같은 선택 동작을 지도에서도 할 수 있게 한다(§6.4 "선택하면 지도에서 강조"의 역방향 진입점).
    onClick: (info) => {
      if (onFacilityClick && info && info.layer && info.layer.id === "candidate-facilities" && info.object) {
        onFacilityClick(info.object.id);
      }
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
    const {
      day, events, orgs, periods, visibleOrgs,
      // M4 Fix2: org-view §12.1 신호 강도로 재실행(rerun)됐을 때, 반경 링 계산도 그 오버라이드를
      // 반영해야 한다. 안 넘기면(SIM 기본 재생) 기존처럼 정적 import(DIRECTIVES)를 그대로 쓴다 —
      // 이 필드는 optional이라 이전 호출부(있다면)와 호환된다.
      directives, // organizations.js의 DIRECTIVES와 같은 모양 | undefined
      // ── M3-T3: 표적 추론(target inference) 스코프 선택 관련 필드. 모두 optional —
      // 넘기지 않으면(SIM 재생만 할 때) 이 레이어들은 그냥 생략된다.
      scope, // 확정된 스코프 {lat, lon, radiusKm} | null
      scopeDraft, // 드래그 중인 실시간 미리보기 {lat, lon, radiusKm} | null
      candidateFacilities, // 스코프 안 후보 시설 배열(facilities.json 원소) | undefined
      selectedFacilityId, // 결과 패널에서 선택된 시설 id | null
      supportingEvents, // 선택된 후보를 뒷받침하는 "in-band" 이벤트(좌표만, org 없음) | undefined
    } = frame;
    const effectiveDirectives = directives || DIRECTIVES;
    // M4-T2 (SPEC_M4 §2 항목1): reveal이 이 지도가 그리는 "정답지 레이어"를 실제로 가른다.
    // org 기본 위치 마커·콜사인 라벨·작전 반경 링·TIDEBREAK 궤적, 그리고 사건 점의 "조직별 색"은
    // 전부 지휘 계층(command layer) 정보다 — reveal이 꺼지면 지도 어디에도 나타나지 않는다.
    // 후보 시설 마커(candidate-facilities)와 스코프 원은 답이 아니라 "질문의 대상/도구"이므로
    // reveal과 무관하게 항상 그린다.
    const reveal = !!frame.reveal;

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
          getFillColor: RGB.land,
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
          getLineColor: RGB.landEdge,
          lineWidthMinPixels: 1,
          pickable: false,
        })
      );
    }

    // M3-T3부터 events는 이미 main.js의 query.js(queryEvents)가 시간창(window)으로 걸러서 넘긴다 —
    // 이 레이어는 그 안에서 "보이는 조직인가"만 한 번 더 거른다. e.day <= day는 방어적으로 남겨둔다
    // (day는 main.js가 windowEnd로 넘기므로 windowed events는 이미 이 조건을 만족한다).
    // 캐시: events 배열 identity(main.js가 시간창을 바꿀 때만 새로 만든다) + day + 보이는 조직
    // 집합이 전부 그대로면 filter를 다시 돌리지 않고 지난 결과를 재사용한다.
    const orgsKey = visibleOrgsKeyOf(visibleOrgs);
    const vc = derivedCache.visibleEvents;
    let visibleEvents;
    if (vc.eventsRef === events && vc.day === day && vc.orgsKey === orgsKey) {
      visibleEvents = vc.data;
    } else {
      visibleEvents = (events || []).filter((e) => e.day <= day && isVisible(e.org));
      vc.eventsRef = events;
      vc.day = day;
      vc.orgsKey = orgsKey;
      vc.data = visibleEvents;
    }

    // ── 2. 누적 이벤트 — 2px 남짓, 낮은 불투명도(0.35) ──────────────────────────
    // M4-T2: reveal이 꺼지면 org와 무관한 중립색(RGB.evt) 하나만 쓴다 — "누가 저질렀는가"는
    // 지휘 계층 정보라 기본 화면에 그리지 않는다. reveal이 켜졌을 때만 조직색으로 되돌린다.
    layers.push(
      new ScatterplotLayer({
        id: "events-accum",
        data: visibleEvents,
        getPosition: (d) => [d.lon, d.lat],
        radiusUnits: "pixels",
        getRadius: 1, // 반지름 1px ≈ 지름 2px
        getFillColor: (d) => [...(reveal ? colorOf(d.org) : RGB.evt), 90], // 90/255 ≈ 0.35
        pickable: true,
        updateTriggers: { getFillColor: reveal },
      })
    );

    // ── 3. 최근 이벤트(≤30일) — 가산 블렌딩 글로우. 최신일수록 크고 진하게 ─────────
    // M4-T2: 위 events-accum과 같은 이유로, reveal이 꺼지면 글로우도 중립색으로 그린다.
    // 캐시: visibleEvents identity(위에서 캐시 히트면 바로 이전 배열)와 day가 그대로면 재사용.
    const rc = derivedCache.recentEvents;
    let recentEvents;
    if (rc.visibleEventsRef === visibleEvents && rc.day === day) {
      recentEvents = rc.data;
    } else {
      recentEvents = visibleEvents.filter((e) => day - e.day >= 0 && day - e.day <= 30);
      rc.visibleEventsRef = visibleEvents;
      rc.day = day;
      rc.data = recentEvents;
    }
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
          return [...(reveal ? colorOf(d.org) : RGB.evt), Math.round(60 + f * 170)];
        },
        pickable: true,
        updateTriggers: { getFillColor: reveal },
        // 가산(additive) 블렌딩: SRC_ALPHA(770) / ONE(1). 여러 개의 글로우가 겹치면
        // 알파를 곱하는 대신 더해서, 사건이 밀집한 곳이 실제로 더 밝게 빛나 보인다.
        parameters: {
          blendFunc: [770, 1, 770, 1],
          depthTest: false,
        },
      })
    );

    // 이후 org 레이어들(마커/라벨/반경/궤적)에 공통으로 쓸 "오늘의 조직 상태"를 한 번만 계산한다.
    // 캐시: orgs/periods identity(둘 다 main.js에서 한 번 만들어져 그대로 유지된다) + day + 보이는
    // 조직 집합이 그대로면 재사용 — 일시정지 중에는 매 프레임 똑같은 배열을 그대로 돌려준다.
    const oc = derivedCache.orgFrames;
    let orgFrames;
    if (oc.orgsRef === orgs && oc.periodsRef === periods && oc.day === day && oc.orgsKey === orgsKey && oc.directivesRef === effectiveDirectives) {
      orgFrames = oc.data;
    } else {
      orgFrames = (orgs || [])
        .filter((org) => isVisible(org.key))
        .map((org) => {
          const [la, lo] = currentBase(org, day);
          const directiveKey = activeDirectiveFor(org, periods || [], day);
          const radiusKm = org.baseRadius * effectiveDirectives[directiveKey].radiusMult;
          return { org, lat: la, lon: lo, directiveKey, radiusKm };
        });
      oc.orgsRef = orgs;
      oc.periodsRef = periods;
      oc.day = day;
      oc.orgsKey = orgsKey;
      oc.directivesRef = effectiveDirectives;
      oc.data = orgFrames;
    }

    // ── 4~7. 조직 기본 위치 마커·콜사인 라벨·작전 반경 링·TIDEBREAK 궤적 ─────────────
    // M4-T2 (SPEC_M4 §2 항목1): 이 넷은 전부 "지휘 계층" 정보라 reveal이 켜졌을 때만 그린다.
    // reveal이 꺼져 있으면 이 레이어들은 아예 layers 배열에 들어가지 않는다 — deck.gl 레이어
    // props를 숨기는 게 아니라 통째로 생략하므로, "css로 안 보이게만 했다"류의 우회가 없다.
    if (reveal) {
      // ── 4. 조직 기본 위치 마커 (색 채움 원 + 얇은 테두리) ────────────────────
      layers.push(
        new ScatterplotLayer({
          id: "org-markers",
          data: orgFrames,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: "pixels",
          getRadius: 6,
          getFillColor: (d) => colorOf(d.org.key),
          stroked: true,
          getLineColor: RGB.void, // --void — 배경과 대비되는 얇은 테두리
          lineWidthMinPixels: 1,
          pickable: true,
        })
      );

      // ── 5. 콜사인 라벨 (org.key, 마커 오른쪽) ───────────────────────────────
      // 조직 3개의 기본 위치가 화면상 서로 몇 px 안으로 붙는 스코프/줌에서는(예: 기본 AO 뷰),
      // 라벨을 마커에서 16px 띄우는 것만으로는 다른 조직의 마커·반경 링과 겹쳐 뭉개진다(라벨
      // 겹침 결함). fontSettings:{sdf:true} + outlineWidth/outlineColor로 글자에 배경(--void)색
      // 아웃라인(halo)을 둘러, 무엇과 겹치든 글자 자체는 항상 또렷하게 남게 한다 — 새 배경
      // 박스를 그리는 대신 기존 미니멀한 라벨 그대로 두고 가독성만 확보한다.
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
          fontSettings: { sdf: true },
          outlineWidth: 2.5,
          outlineColor: [...RGB.void, 255],
          getPixelOffset: [20, 0],
          getTextAnchor: "start",
          getAlignmentBaseline: "center",
          pickable: false,
        })
      );

      // ── 6. 작전 반경 링 — 현재 지침의 배율이 적용된 반경, 테두리만 그림 ──────
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

      // ── 7. TIDEBREAK 궤적 — day 0 기준 위치에서 오늘 위치까지의 이동 경로 ────
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
    }

    // ── 8. 스코프 원(circle) — 확정본과 드래그 중 미리보기. 둘 다 조직색이 아니라 리드 악센트
    // (nw/cyan)만 쓴다: 이건 "어느 조직인가"가 아니라 "지금 어디를 조사 중인가"를 나타내는
    // 별개의 데이터 인코딩이라서다.
    const drawScope = scopeDraft || scope;
    if (drawScope && drawScope.radiusKm > 0) {
      layers.push(
        new ScatterplotLayer({
          id: "scope-circle",
          data: [drawScope],
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: "meters",
          getRadius: (d) => d.radiusKm * 1000,
          stroked: true,
          filled: !!scopeDraft, // 드래그 중에는 옅게 채워서 "지금 편집 중"임을 알려준다
          getFillColor: [...RGB.nw, 22],
          getLineColor: [...RGB.nw, scopeDraft ? 230 : 170],
          lineWidthUnits: "pixels",
          getLineWidth: scopeDraft ? 2 : 1.5,
          pickable: false,
        }),
        new ScatterplotLayer({
          id: "scope-center",
          data: [drawScope],
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: "pixels",
          getRadius: 3,
          getFillColor: [...RGB.nw, 255],
          pickable: false,
        })
      );
    }

    // ── 9. 후보 시설 마커 — 이벤트(점)와 구분되는 "속 빈 정사각형"(SPEC §7). 선택된 것만 강조.
    if (candidateFacilities && candidateFacilities.length) {
      layers.push(
        new IconLayer({
          id: "candidate-facilities",
          data: candidateFacilities,
          getPosition: (d) => [d.lon, d.lat],
          getIcon: () => ({ url: squareIconUrl(), width: 32, height: 32, anchorX: 16, anchorY: 16 }),
          sizeUnits: "pixels",
          getSize: (d) => (d.id === selectedFacilityId ? 22 : 14),
          getColor: (d) => (d.id === selectedFacilityId ? [...RGB.nw, 255] : [...RGB.hairLit, 220]),
          pickable: true,
        })
      );
    }

    // ── 10. 선택된 후보를 뒷받침하는 in-band 이벤트 강조 — org색이 아니라 중립 악센트 링만.
    // 정답지 분리: supportingEvents는 이미 projectForInference()를 거친 좌표 전용 이벤트라
    // org 필드 자체가 없다(이 레이어 코드도 org를 참조하지 않는다).
    if (supportingEvents && supportingEvents.length) {
      layers.push(
        new ScatterplotLayer({
          id: "supporting-events",
          data: supportingEvents,
          getPosition: (d) => [d.lon, d.lat],
          radiusUnits: "pixels",
          getRadius: 4.5,
          stroked: true,
          filled: false,
          getLineColor: [...RGB.nw, 235],
          lineWidthUnits: "pixels",
          getLineWidth: 1.6,
          pickable: false,
        })
      );
    }

    deckInstance.setProps({ layers });
  }

  /**
   * 화면 픽셀 좌표(container 기준)를 지도 좌표 [lon, lat]로 되돌린다. 스코프 드래그 선택(§6.3)이
   * "클릭한 화면 지점이 지리적으로 어디인가"를 알아야 해서 필요하다. deck.gl의 WebMercatorViewport를
   * 현재 viewState + 컨테이너 크기로 직접 만들어 unproject한다(피킹이 아니라 좌표 변환이라 별도 API).
   * @param {number} x - container 기준 px
   * @param {number} y - container 기준 px
   * @returns {[number, number]} [lon, lat]
   */
  function unproject(x, y) {
    const { WebMercatorViewport } = window.deck;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const vp = new WebMercatorViewport({ ...viewState, width, height });
    return vp.unproject([x, y]);
  }

  /**
   * 지금 화면(container)에 실제로 보이는 위경도 사각형을 반환한다. scan.js의 그리드 스캔이
   * "지금 화면"을 채울 격자를 만들 때 이 사각형이 필요하다(SPEC_M4 §2 항목4 "grid the current
   * viewport"). unproject를 두 모서리(좌상단/우하단)에 그대로 재사용한다 — 새 API가 아니다.
   * @returns {{west:number, east:number, south:number, north:number}}
   */
  function getViewportBounds() {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const [lon1, lat1] = unproject(0, 0); // 좌상단
    const [lon2, lat2] = unproject(width, height); // 우하단
    return {
      west: Math.min(lon1, lon2),
      east: Math.max(lon1, lon2),
      south: Math.min(lat1, lat2),
      north: Math.max(lat1, lat2),
    };
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

  return { setFrame, setView, getViewState, destroy, unproject, getViewportBounds };
}
