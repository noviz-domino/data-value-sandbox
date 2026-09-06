// 시간창(time window) 컨트롤 — timeline.js의 일별 활동 막대를 대체한다 (SPEC_M3.md §6.1).
// 옛 타임라인은 "처음부터 끝까지 전부 아는 고정 데이터셋"을 전제로 day 0부터 누적 공개했지만,
// 실제 소스(ACLED 주간 갱신, 나중의 DB)는 그렇게 동작하지 않는다. 그래서 "지금 보고 있는 구간"을
// 나타내는 [windowStart, windowEnd] 창을 만들고, 재생은 이 창을 통째로 미래로 밀어내는 방식으로 바꾼다.
//
// 이 모듈은 슬림한 day 축 위에 창을 그리고 드래그로 조작하는 부분만 담당한다. 숫자 입력창(#win-start/
// #win-end)은 main.js가 별도 DOM으로 바인딩한다 — 이 파일은 캔버스 하나만 안다.

import { HEX, rgba, RGB } from "./palette.js";

const EDGE_PX = 7; // 창 좌/우 경계 근처 몇 px 안쪽을 "리사이즈 핸들"로 인식할지

// createWindowControl(canvas, { onChange }) -> { draw(state) }
//   canvas   : <canvas id="wac">. DPR 스케일링은 main.js가 timeline.js와 동일한 방식으로 미리 적용해둔다.
//   onChange : ({windowStart, windowEnd}) => void, 드래그 중 실시간으로(마우스를 뗄 때까지 기다리지 않고) 호출된다.
//
// draw(state)가 기대하는 값:
//   state.windowStart / state.windowEnd - 현재 창의 시작/끝 day (포함)
//   state.days                          - 전체 일수(축의 오른쪽 끝)
export function createWindowControl(canvas, { onChange } = {}) {
  const tx = canvas.getContext("2d");
  let lastDays = 1;

  function cssSize() {
    const dpr = canvas.width / (canvas.clientWidth || canvas.width) || 1;
    return { w: canvas.width / dpr, h: canvas.height / dpr };
  }

  function dayToX(day, days, w) {
    return (day / Math.max(1, days - 1)) * w;
  }
  function xToDay(x, days, w) {
    return Math.round((x / w) * (days - 1));
  }

  function draw({ windowStart, windowEnd, days }) {
    lastDays = days;
    // mousedown 핸들러가 "지금 창이 어디 있는지"를 알아야 hitZone을 판정할 수 있는데, 그 핸들러는
    // draw()의 클로저 밖(이벤트 리스너)에서 실행되므로 최신 값을 캔버스 자체에 적어둔다.
    canvas.dataset.windowStart = windowStart;
    canvas.dataset.windowEnd = windowEnd;
    const { w, h } = cssSize();
    tx.clearRect(0, 0, w, h);
    tx.fillStyle = HEX.deck;
    tx.fillRect(0, 0, w, h);

    // 축 기준선 (수평 중앙선).
    const axisY = h / 2;
    tx.strokeStyle = HEX.hair;
    tx.lineWidth = 1;
    tx.beginPath();
    tx.moveTo(0, axisY);
    tx.lineTo(w, axisY);
    tx.stroke();

    // 선택된 창(band) — 배경 대비 밝은 사각형.
    const x0 = dayToX(windowStart, days, w);
    const x1 = dayToX(windowEnd, days, w);
    tx.fillStyle = rgba(RGB.nw, 0.22); // 리드 악센트(cyan)를 낮은 알파로 — SPEC §7 "10% 악센트"
    tx.fillRect(x0, 4, Math.max(2, x1 - x0), h - 8);
    tx.strokeStyle = HEX.hairLit;
    tx.lineWidth = 1;
    tx.strokeRect(x0 + 0.5, 4, Math.max(1, x1 - x0), h - 8);

    // 좌/우 리사이즈 핸들 — 눈에 보이는 손잡이 바.
    tx.fillStyle = HEX.ink;
    tx.fillRect(x0 - 1.5, 2, 3, h - 4);
    tx.fillRect(x1 - 1.5, 2, 3, h - 4);

    // day 라벨: 0 / windowStart / windowEnd / days-1.
    tx.fillStyle = HEX.inkDim;
    tx.font = '10px "IBM Plex Mono",monospace';
    tx.textBaseline = "top";
    tx.textAlign = "left";
    tx.fillText("D0", 2, h - 12);
    tx.textAlign = "right";
    tx.fillText("D" + (days - 1), w - 2, h - 12);
    tx.textAlign = "center";
    tx.fillStyle = HEX.ink;
    tx.fillText("D" + windowStart, Math.max(16, x0), 2);
    tx.fillText("D" + windowEnd, Math.min(w - 16, x1), 2);
  }

  // 마우스가 창의 어느 구역 위에 있는지 판정한다: 좌/우 핸들, 내부(이동), 바깥(새 위치로 점프).
  function hitZone(x, windowStart, windowEnd, days, w) {
    const x0 = dayToX(windowStart, days, w);
    const x1 = dayToX(windowEnd, days, w);
    if (Math.abs(x - x0) <= EDGE_PX) return "left";
    if (Math.abs(x - x1) <= EDGE_PX) return "right";
    if (x > x0 && x < x1) return "move";
    return "jump";
  }

  let dragState = null; // { mode, startX, origStart, origEnd, width }

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    // draw()가 마지막으로 그린 windowStart/End를 알아야 hitZone을 판정할 수 있으므로,
    // main.js가 매 프레임 draw()를 부를 때 캔버스에 data-* 속성으로 최신 값을 함께 남겨둔다.
    const windowStart = Number(canvas.dataset.windowStart || 0);
    const windowEnd = Number(canvas.dataset.windowEnd || lastDays - 1);
    const zone = hitZone(x, windowStart, windowEnd, lastDays, w);
    const width = windowEnd - windowStart;

    if (zone === "jump") {
      // 창 바깥을 클릭하면 그 지점이 창의 중앙이 되도록 통째로 이동(너비는 유지).
      const day = xToDay(x, lastDays, w);
      let ns = day - Math.round(width / 2);
      let ne = ns + width;
      if (ns < 0) { ne -= ns; ns = 0; }
      if (ne > lastDays - 1) { ns -= ne - (lastDays - 1); ne = lastDays - 1; }
      ns = Math.max(0, ns);
      onChange && onChange({ windowStart: ns, windowEnd: ne });
    }

    dragState = { mode: zone === "jump" ? "move" : zone, startX: x, origStart: windowStart, origEnd: windowEnd, width };

    const move = (ev) => {
      const x2 = ev.clientX - rect.left;
      const dxDay = xToDay(x2, lastDays, w) - xToDay(dragState.startX, lastDays, w);
      let ns = dragState.origStart;
      let ne = dragState.origEnd;
      if (dragState.mode === "left") {
        ns = Math.min(dragState.origEnd - 1, Math.max(0, dragState.origStart + dxDay));
      } else if (dragState.mode === "right") {
        ne = Math.max(dragState.origStart + 1, Math.min(lastDays - 1, dragState.origEnd + dxDay));
      } else {
        ns = dragState.origStart + dxDay;
        ne = dragState.origEnd + dxDay;
        if (ns < 0) { ne -= ns; ns = 0; }
        if (ne > lastDays - 1) { ns -= ne - (lastDays - 1); ne = lastDays - 1; }
      }
      onChange && onChange({ windowStart: Math.round(ns), windowEnd: Math.round(ne) });
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      dragState = null;
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  });

  return { draw };
}
