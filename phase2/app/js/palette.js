// 색상 팔레트 단일 소스 (M3-T4). phase2/app/css/style.css의 :root 블록을 그대로 미러링한다.
//
// 왜 중복이 필요한가: CSS 커스텀 프로퍼티(--void 등)는 CSS/DOM 안에서만 쓸 수 있다.
// 이 앱의 map.js는 deck.gl 레이어에 [r,g,b] 정수 배열을 넘겨야 하고, window-control.js는
// <canvas> 2D 컨텍스트의 fillStyle/strokeStyle에 색을 지정해야 하는데, 둘 다 CSS 변수를
// "읽어서" 쓰는 게 아니라 JS 리터럴이 필요하다. 그래서 같은 값을 이 파일에도 한 번 더
// 적어둔다 — style.css의 :root를 고치면 반드시 이 파일도 같이 고쳐야 값이 어긋나지 않는다.
//
// SPEC_M3.md §7: 6:3:1(배경:패널:악센트) 비율, 순수 검정이 아닌 청회색 배경, 리드 악센트는
// cyan 하나. 조직 색(nw/tb/ds)은 "장식"이 아니라 어느 조직인지 구분하는 데이터 인코딩이라
// amber(tb)를 그대로 유지한다 — warn 전용 규칙은 UI 크롬의 장식적 glow에 적용되는 것이지,
// 조직 식별색에는 적용하지 않는다.

// ── HEX 값 (CSS :root와 1:1 대응) ───────────────────────────────────────────────────
export const HEX = {
  void: "#0B1017", // 배경(60%) — 순수 검정이 아닌 딥 블루그레이
  deck: "#121922", // 패널 1단계(상단바/레일/사이드/타임라인 배경, 30%)
  riser: "#1A232E", // 패널 2단계(선택된 nav, 버튼, anl-org-cell 등 한 단 더 뜬 면)
  hair: "#212D38", // 소프트 구분선(패널 경계) — 장식용, 3:1 기준 대상 아님
  hairLit: "#57708A", // 인터랙티브/강조 테두리(hover, 선택, 포커스) — 배경 대비 3:1 이상
  ink: "#C9D4DF", // 본문 텍스트(오프화이트)
  inkDim: "#8CA0B3", // 보조 텍스트(한 단 어둡게)
  inkMute: "#5E7180", // 저강조 라벨(가장 어두운 텍스트 단계)
  nw: "#57C7EA", // NORTHWIND — 리드 악센트(cyan)와 동일한 값을 공유
  tb: "#F2A03D", // TIDEBREAK — amber. 조직 식별색(경고색 아님)
  ds: "#C77DD8", // DRYSTONE — 보조 조직 식별색
  land: "#26323C", // 지도 육지 채움
  landEdge: "#3B4C58", // 지도 해안선
};

/** "#RRGGBB" 문자열을 deck.gl이 기대하는 [r,g,b] 정수 배열(0-255)로 바꾼다. */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── deck.gl 등 숫자 RGB 배열이 필요한 곳에서 쓰는 사전 계산 캐시 ───────────────────────
export const RGB = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToRgb(v)])
);

// ── 조직 키 -> 색상만 따로 뽑은 편의 매핑 (map.js/main.js/analysis-view.js 공통) ───────
export const ORG_COLORS = {
  NORTHWIND: HEX.nw,
  TIDEBREAK: HEX.tb,
  DRYSTONE: HEX.ds,
};

export const ORG_RGB = {
  NORTHWIND: RGB.nw,
  TIDEBREAK: RGB.tb,
  DRYSTONE: RGB.ds,
};

/** [r,g,b] 배열과 alpha(0~1)를 받아 <canvas> fillStyle/strokeStyle에 바로 쓸 수 있는
 * "rgba(r,g,b,a)" 문자열을 만든다. window-control.js가 팔레트 색에 투명도를 섞을 때 쓴다 —
 * 값 자체는 RGB에서 가져오므로 팔레트가 바뀌면 여기 결과도 자동으로 따라간다. */
export function rgba(rgb, alpha) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}
