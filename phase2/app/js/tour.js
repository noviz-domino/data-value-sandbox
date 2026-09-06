// 안내 투어(tour) — SPEC_M4.md §5 (첫 방문 4단계 가이드 투어, localStorage "gtc.tour"로 1회만).
// 지금은 스캐폴드(BUILD_PLAN "M4 seam 분리" 작업)일 뿐이다 — 실제 4단계 anchor·하이라이트·
// "restart tour" 어포던스는 이 파일을 이어받는 에이전트가 채운다. 여기서는 "coming soon" 오버레이
// 하나만 i18n으로 그린다.
//
// 하우스 스타일과 다른 점: org-view.js/data-view.js는 자기 컨테이너(#view-org/#view-dat)를 갖고
// 있어 createXxx(container, deps) 모양이지만, 투어는 특정 뷰에 속하지 않고 화면 전체(지도/시간창/
// reveal 토글/결과 패널 등 여러 anchor)에 걸쳐 표시되는 오버레이라 자기만의 컨테이너가 없다.
// 그래서 createTour(deps)는 container 인자 없이 자기 오버레이 엘리먼트를 직접 만들어
// document.body에 붙인다. { start(), restart() }를 반환한다 — SPEC_M4 §5의 "restart tour"
// 어포던스가 이 restart()를 부르면 된다(그 버튼 자체를 만드는 것도 다음 에이전트의 몫).
//
// ── deps 계약 (org-view.js 상단 주석과 토씨 하나까지 동일하게 유지할 것 — 세 에이전트가 서로
//    대화하지 않으므로, 여기서 다르게 적으면 그 자체가 버그의 씨앗이다) ──────────────────────
//
//   deps = {
//     result: {
//       events: object[],       // { id, day, lat, lon, org, branch, method, target, success, casualties }
//       campaigns: object[],    // { id, org, targetId, startDay, endDay, eventIds }
//       facilities: object[],   // facilities.json의 facilities 배열 { id, kind, lat, lon }
//       periods: object[],      // { org, directive, startDay, endDay }
//       days: number,           // 시뮬레이션 총 일수 (1826)
//       startDate: number,      // Date.UTC(...) 원시값 — day 0의 실제 날짜
//     },
//     seed: number,
//     queryEvents: (args: { scope?: {lat,lon,radiusKm}, window?: {startDay,endDay} }) => object[],
//     getState: () => ({ window: { startDay: number, endDay: number }, scope: {lat,lon,radiusKm} | null }),
//     onStateChange: (cb: (state: ReturnType<getState>) => void) => (() => void),
//     requestRerun: (opts?: { seed?: number }) => void,
//   }
//
// 투어는 화면 요소를 가리키기만 할 뿐 ground truth를 새로 읽지 않는다 — reveal 토글 자체를
// anchor로 쓸 뿐(SPEC_M4 §5 3단계), reveal 상태를 미리 켜거나 읽지 않는다.

import { t, register, onLangChange } from "./i18n.js";

register({
  ko: { "tour.comingSoon": "안내 투어 — 아직 준비 중입니다." },
  en: { "tour.comingSoon": "Guided tour — still being built." },
});

/**
 * @param {object} deps - 위 계약 참고
 */
export function createTour(deps) {
  let overlayEl = null;

  function render() {
    if (!overlayEl) return;
    overlayEl.textContent = t("tour.comingSoon");
  }

  /** 오버레이를 만들어 body에 붙이고 보여준다. 이미 떠 있으면 아무 일도 하지 않는다. */
  function start() {
    if (overlayEl) return;
    overlayEl = document.createElement("div");
    overlayEl.className = "tour-stub";
    overlayEl.setAttribute("role", "status");
    overlayEl.onclick = dismiss; // 스텁이라 클릭하면 그냥 닫는다 — 실제 4단계 진행은 다음 구현 몫.
    document.body.appendChild(overlayEl);
    render();
  }

  function dismiss() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }

  /** localStorage "gtc.tour" 여부와 무관하게 무조건 다시 시작한다 — SPEC_M4 §5의
   * "restart tour" 어포던스가 부를 자리(그 버튼 자체는 아직 없다). */
  function restart() {
    dismiss();
    start();
  }

  onLangChange(render);

  return { start, restart, dismiss };
}
