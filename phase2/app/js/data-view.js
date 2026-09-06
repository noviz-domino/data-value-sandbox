// 데이터(DAT) 뷰 — SPEC_M4.md §4 (정렬/필터 가능한 사건 표, events.csv/ground_truth.json 내보내기).
// 지금은 스캐폴드(BUILD_PLAN "M4 seam 분리" 작업)일 뿐이다 — 실제 표/필터/export 버튼은 이 파일을
// 이어받는 에이전트가 채운다. 여기서는 "coming soon" 한 줄만 i18n으로 그린다.
//
// 하우스 스타일(analysis-view.js/results-panel.js와 동일): createXxx(container, deps) -> { render() }.
// 컨테이너는 main.js가 이미 갖고 있는 #view-dat 다.
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
//       startDate: number,      // Date.UTC(...) 원시값 — day 0의 실제 날짜. CSV의 date 컬럼은
//                                // 여기서부터 day를 더해 ISO 날짜로 만든다(SPEC_M4 §4).
//     },
//     seed: number,
//     queryEvents: (args: { scope?: {lat,lon,radiusKm}, window?: {startDay,endDay} }) => object[],
//     getState: () => ({ window: { startDay: number, endDay: number }, scope: {lat,lon,radiusKm} | null }),
//     onStateChange: (cb: (state: ReturnType<getState>) => void) => (() => void),
//     requestRerun: (opts?: { seed?: number }) => void,
//   }
//
// 정답지 분리 주의(SPEC_M3 §3): 이 뷰는 result.campaigns를 "표시"하고 ground_truth.json으로
// "내보내는" 것까지는 허용되지만(SPEC_M4 §6 "the data view may display ground truth and export
// it as a separate file"), 그 값이 추론 경로(inference.js/scan.js)로 흘러들어가게 만들면 안 된다.
// 이 파일은 그 경로를 아예 import하지 않는다.

import { t, register, onLangChange } from "./i18n.js";

register({
  ko: { "dat.comingSoon": "데이터 뷰 — 사건 표·필터·CSV/정답지 내보내기는 아직 준비 중입니다." },
  en: { "dat.comingSoon": "Data view — the event table, filters and CSV/ground-truth export are still being built." },
});

/**
 * @param {HTMLElement} container - #view-dat
 * @param {object} deps - 위 계약 참고
 */
export function createDataView(container, deps) {
  function render() {
    // result.events가 실제로 들어와 있음을 보여주는 최소 확인용 숫자 — 다음 에이전트가 표를
    // 채울 때 deps.result.events가 바로 그 소스임을 확인하는 용도.
    container.innerHTML =
      '<div class="placeholder data-view-stub">' +
        "<div>" + t("dat.comingSoon") + "</div>" +
        '<div class="data-view-stub-sub">' + deps.result.events.length + " events · " +
          deps.result.days + " days</div>" +
      "</div>";
  }

  onLangChange(render);

  return { render };
}
