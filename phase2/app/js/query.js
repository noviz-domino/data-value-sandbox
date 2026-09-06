// 데이터 접근 seam. SPEC_M3.md §6.2: 뷰(view)는 이벤트 배열을 절대 직접 인덱싱하지 않는다.
// 지금은 메모리 배열을 필터링할 뿐이지만, 나중에 실제 소스(주간 갱신되는 DB/API)로 바뀌어도
// 호출부(main.js/results-panel.js 등)는 이 함수 하나만 계속 부르면 되게 하려는 게 이 파일의 존재 이유다.
// 타임라인 바를 시간창(window) 컨트롤로 바꾼 것도 같은 이유(§6.1) — "전부 다 아는 고정 데이터셋"을
// 더 이상 가정하지 않는다.

import { scopeEvents } from "./inference.js";

/**
 * events 배열을 감싸 queryEvents(...) 하나만 노출하는 스토어를 만든다.
 * @param {object[]} events - simulate()가 반환한 원본 이벤트 배열(참조를 이 함수 밖으로 흘리지 않는다)
 * @returns {{ queryEvents: (args:{scope?:{lat:number,lon:number,radiusKm:number}, window?:{startDay:number,endDay:number}})=>object[] }}
 */
export function createEventQuery(events) {
  /**
   * scope(원형 범위)와 window(날짜 구간)로 이벤트를 걸러 반환한다. 오늘은 메모리 배열 filter이지만
   * 시그니처 자체가 "나중에 DB 쿼리가 되어도 그대로 쓸 수 있게" 만들어졌다.
   * @param {{scope?:object, window?:{startDay:number,endDay:number}}} args
   * @returns {object[]}
   */
  function queryEvents({ scope, window } = {}) {
    // window가 없으면 전체 구간(사실상 무제한)으로 취급 — 호출부가 매번 기본값을 채울 필요 없게.
    const win = window || { startDay: -Infinity, endDay: Infinity };
    if (scope) {
      // 원형 범위까지 있으면 inference.js의 scopeEvents를 그대로 재사용한다(거리 계산 로직 중복 금지).
      return scopeEvents(events, scope, win);
    }
    return events.filter((e) => e.day >= win.startDay && e.day <= win.endDay);
  }

  return { queryEvents };
}
