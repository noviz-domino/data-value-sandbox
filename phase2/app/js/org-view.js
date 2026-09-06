// 조직(ORG) 뷰 — SPEC_M4.md §3 (조직별 편집 폼 + 신호 강도 슬라이더 + sweep). 지금은 스캐폴드
// (BUILD_PLAN "M4 seam 분리" 작업)일 뿐이다 — 실제 폼/슬라이더/sweep 차트는 이 파일을 이어받는
// 에이전트가 채운다. 여기서는 "coming soon" 한 줄만 i18n으로 그리고, main.js가 넘기는 deps의
// 모양을 실제로 써서 무엇이 가능한지 보여준다(스코프/시간창 실시간 표시).
//
// 하우스 스타일(analysis-view.js/results-panel.js와 동일): createXxx(container, deps) -> { render() }.
// 컨테이너는 main.js가 이미 갖고 있는 #view-org 다.
//
// ── deps 계약 (main.js가 org-view/data-view/tour 세 모듈에 공통으로 넘기는 모양) ─────────────
// 세 에이전트가 서로 대화하지 않고 각자 이 파일만 보고 작업하므로, 이 계약을 세 파일 모두에
// 토씨 하나 안 틀리고 그대로 복사해 둔다 — 한 곳만 고치면 반드시 나머지 둘도 같이 고칠 것.
//
//   deps = {
//     // 가장 최근 simulate() 결과의 스냅샷. 읽기 전용으로 취급할 것 — 이 객체의 필드를 직접
//     // 변형하면 안 된다(특히 events/campaigns: ground-truth 분리 경계, SPEC_M3 §3 — org-view가
//     // campaigns를 "표시"하는 것은 괜찮지만, 이 값이 inference.js 쪽으로 흘러들어가면 안 된다.
//     // 그 흐름은 이미 main.js 한 곳(computeAnswerKeyFacilityIds 등)에서만 일어난다).
//     result: {
//       events: object[],       // { id, day, lat, lon, org, branch, method, target, success, casualties }
//       campaigns: object[],    // { id, org, targetId, startDay, endDay, eventIds }
//       facilities: object[],   // facilities.json의 facilities 배열 { id, kind, lat, lon }
//       periods: object[],      // { org, directive, startDay, endDay }
//       days: number,           // 시뮬레이션 총 일수 (1826)
//       startDate: number,      // Date.UTC(...) 원시값 — day 0의 실제 날짜
//     },
//     seed: number,              // 지금 시뮬레이션을 만든 시드
//     queryEvents: (args: { scope?: {lat,lon,radiusKm}, window?: {startDay,endDay} }) => object[],
//     // 지금 시간창/스코프를 읽기만 한다 — 이 뷰가 직접 windowStart/scope를 들고 있지 않는다.
//     getState: () => ({ window: { startDay: number, endDay: number }, scope: {lat,lon,radiusKm} | null }),
//     // 시간창/스코프가 바뀔 때마다(재생 루프 포함) 호출된다. 구독 해지 함수를 돌려준다.
//     onStateChange: (cb: (state: ReturnType<getState>) => void) => (() => void),
//     // 시뮬레이션을 다시 돌려야 할 때(예: org-view의 슬라이더 편집 후 "재실행 필요" 확정,
//     // 또는 sweep의 각 강도 단계) 부른다. 지금은 seed만 받아 그대로 재실행하는 얇은 통로다 —
//     // organizations.js의 §7 파라미터(base/branches/baseRadius/seasonal/targetPreference 등)를
//     // 실제로 오버라이드하는 기능은 simulate()에 아직 없다. 그 확장은 org-view를 구현하는
//     // 에이전트의 몫이다(SPEC_M4 §3.1/§3.2) — simulation.js/organizations.js를 고쳐야 한다면
//     // 여기 deps.requestRerun의 옵션 모양(현재 { seed }?)도 함께 넓혀도 된다.
//     requestRerun: (opts?: { seed?: number }) => void,
//   }

import { t, register, onLangChange } from "./i18n.js";

register({
  ko: { "org.comingSoon": "조직 뷰 — 편집 폼·신호 강도 슬라이더·sweep은 아직 준비 중입니다." },
  en: { "org.comingSoon": "Organisations view — the per-org form, signal-strength sliders and sweep are still being built." },
});

/**
 * @param {HTMLElement} container - #view-org
 * @param {object} deps - 위 계약 참고
 */
export function createOrgView(container, deps) {
  function render() {
    // 지금 시간창/스코프를 실제로 읽어 보여준다 — deps.getState()가 살아있음을 확인하는
    // 용도이자, 다음 에이전트가 폼을 채울 때 참고할 최소 예시.
    const { window: win } = deps.getState();
    container.innerHTML =
      '<div class="placeholder org-view-stub">' +
        "<div>" + t("org.comingSoon") + "</div>" +
        '<div class="org-view-stub-sub">seed ' + deps.seed +
          " · window " + win.startDay + "–" + win.endDay + "</div>" +
      "</div>";
  }

  onLangChange(render);
  // 시간창/스코프가 바뀔 때도 다시 그린다(스텁 서브텍스트뿐이지만, 구독이 실제로 동작함을 보여준다).
  deps.onStateChange(render);

  return { render };
}
