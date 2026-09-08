// 안내 투어(tour) — SPEC_M4.md §5 (첫 방문 4단계 가이드 투어, localStorage "gtc.tour"로 1회만).
// SPEC_M4 §2(analyst-first 흐름)를 그대로 가르치는 게 목적이다: 점은 조직 무관 중립색이고
// (reveal 끄면 지휘 정보가 안 보임), 스코프를 골라 "이 사건들이 뭘 노리는가"를 스스로 추론하는
// 것이 이 앱의 본론이다. 1~3단계는 그 배경을 깔고, 4단계가 진짜 payload다.
//
// 하우스 스타일과 다른 점: org-view.js/data-view.js는 자기 컨테이너(#view-org/#view-dat)를 갖고
// 있어 createXxx(container, deps) 모양이지만, 투어는 특정 뷰에 속하지 않고 화면 전체(지도/시간창/
// reveal 토글/결과 패널 등 여러 anchor)에 걸쳐 표시되는 오버레이라 자기만의 컨테이너가 없다.
// 그래서 createTour(deps)는 container 인자 없이 자기 오버레이 엘리먼트를 직접 만들어
// document.body에 붙인다. { start(), restart(), dismiss() }를 반환한다.
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
// 투어는 화면 요소를 가리키기만 할 뿐 ground truth를 새로 읽지 않는다 — deps는 인자로 받지만
// 실제로 쓰는 건 없다(계약을 지키려고 받아둘 뿐). reveal 토글 자체를 anchor로 쓸 뿐(SPEC_M4 §5
// 3단계), reveal 상태를 미리 켜거나 읽지 않는다. 마찬가지로 재생을 시작하거나, 지도를 옮기거나,
// 분석을 대신 실행하지 않는다 — 가리키고 설명만 한다.

import { t, register, onLangChange } from "./i18n.js";

register({
  ko: {
    "tour.step1": "이 사건들은 눈에 보이지 않는 규칙을 따르는 세 조직이 만들어냈습니다.",
    "tour.step2": "5년치 기록을 재생해보세요. 그중 한 조직은 계속 이동하고 있습니다.",
    "tour.step3": "이 토글을 켜면 방금 본 장면 뒤에 있던 지휘부의 결정이 드러납니다.",
    "tour.step4": "지역을 하나 골라보세요 — 이 사건들은 어떤 시설을 노리고 준비된 걸까요?",
    "tour.next": "다음",
    "tour.prev": "이전",
    "tour.skip": "건너뛰기",
    "tour.done": "완료",
    "tour.progress": "{n} / {total}",
    "tour.restart": "투어 다시보기",
  },
  en: {
    "tour.step1": "These events came from three organisations following rules you can't see.",
    "tour.step2": "Watch five years play out. One of them is on the move.",
    "tour.step3": "This reveals the command decisions behind what you just watched.",
    "tour.step4": "Pick a region — which facility are these incidents preparing against?",
    "tour.next": "Next",
    "tour.prev": "Back",
    "tour.skip": "Skip",
    "tour.done": "Done",
    "tour.progress": "{n} / {total}",
    "tour.restart": "Replay tour",
  },
});

const STORAGE_KEY = "gtc.tour";

// 4단계 정의 — anchors는 CSS selector 목록(보통 1개, 4단계만 2개). 결과 패널(#results)과 지도(#map)는
// 다른 selector와 안 겹치지만, 시간창 패널은 조심할 게 있다: index.html에 class="tl"이 두 번 나온다
// (좌상단 코너 장식 .brk.tl, 그리고 진짜 시간창 패널). document.querySelector(".tl")만 쓰면 DOM
// 순서상 앞서 나오는 코너 장식이 먼저 걸린다 — 그래서 .wrap 바로 아래 자식만 골라내는
// ".wrap > .tl"로 좁혀서 진짜 시간창 패널을 가리킨다.
const STEPS = [
  { textKey: "tour.step1", anchors: ["#map"] },
  { textKey: "tour.step2", anchors: [".wrap > .tl"] },
  { textKey: "tour.step3", anchors: ["#rv"] },
  { textKey: "tour.step4", anchors: [".scopebar", "#results"] },
];

/** localStorage 접근은 이 두 함수로만 한다 — 일부 임베디드 환경에서 접근 자체가 예외를 던진다. */
function hasSeenTour() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function markSeenTour() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // 저장 실패는 조용히 무시한다 — 이번 방문에서만 안 뜨고, 다음에 다시 뜰 수 있다.
  }
}

/** el이 화면에 실제로 보이는지(연결돼 있고, 크기가 0이 아니고, display:none이 아닌지) 확인한다.
 * 뷰 전환(SIM/ORG/ANL/DAT)으로 anchor가 숨겨져 있을 때 "없는 것"과 똑같이 취급하기 위함이다. */
function isVisible(el) {
  if (!el || !el.isConnected) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** selector 목록 중 실제로 화면에 보이는 엘리먼트만 골라 반환한다. */
function resolveVisibleAnchors(selectors) {
  return selectors
    .map((sel) => document.querySelector(sel))
    .filter(isVisible);
}

/**
 * @param {object} deps - 위 계약 참고. 이 모듈은 값을 읽기만 하며 아무것도 바꾸지 않는다.
 */
export function createTour(deps) {
  void deps; // 계약상 받아두지만 tour.js는 아무 필드도 쓰지 않는다(anchor는 DOM에서 직접 찾는다).

  // ── DOM 뼈대(오버레이가 열려 있을 때만 존재) ──────────────────────────────────────────
  let root = null; // .tour-root — 하이라이트 박스들 + 카드를 담는 컨테이너
  let cardEl = null;
  let stepTextEl = null;
  let progressEl = null;
  let btnPrev = null;
  let btnNext = null;
  let btnSkip = null;

  let idx = 0; // 현재 단계 index (0-3)
  let open = false;
  let resizeObserver = null;

  // 항상 떠 있는 "투어 다시보기" 버튼(SPEC_M4 §5 restart affordance) — index.html을 못 건드리므로
  // 이 모듈이 직접 만들어 body에 붙인다.
  let restartBtn = null;

  /** 현재 idx에서 direction(±1) 방향으로 anchor가 하나라도 보이는 다음 단계를 찾는다.
   * 하나도 없으면 -1을 돌려준다(투어 전체를 조용히 접어야 한다는 뜻). */
  function findNextOpenStep(fromIdx, direction) {
    let i = fromIdx;
    for (let steps = 0; steps < STEPS.length; steps += 1) {
      i += direction;
      if (i < 0 || i >= STEPS.length) return -1;
      if (resolveVisibleAnchors(STEPS[i].anchors).length > 0) return i;
    }
    return -1;
  }

  function buildDom() {
    root = document.createElement("div");
    root.className = "tour-root";

    cardEl = document.createElement("div");
    cardEl.className = "tour-card";
    cardEl.setAttribute("role", "dialog"); // 대화상자 역할은 실제 콘텐츠(카드)에 붙인다 — 하이라이트 박스는 장식일 뿐이라 붙이지 않는다.
    cardEl.setAttribute("aria-live", "polite");

    progressEl = document.createElement("div");
    progressEl.className = "tour-progress";

    stepTextEl = document.createElement("div");
    stepTextEl.className = "tour-text";

    const actions = document.createElement("div");
    actions.className = "tour-actions";

    btnSkip = document.createElement("button");
    btnSkip.type = "button";
    btnSkip.className = "tour-btn tour-btn-ghost";
    btnSkip.onclick = () => finish();

    btnPrev = document.createElement("button");
    btnPrev.type = "button";
    btnPrev.className = "tour-btn tour-btn-ghost";
    btnPrev.onclick = () => goTo(findNextOpenStep(idx, -1) === -1 ? idx : findNextOpenStep(idx, -1));

    btnNext = document.createElement("button");
    btnNext.type = "button";
    btnNext.className = "tour-btn tour-btn-primary";
    btnNext.onclick = () => {
      const next = findNextOpenStep(idx, 1);
      if (next === -1) finish();
      else goTo(next);
    };

    actions.appendChild(btnSkip);
    actions.appendChild(btnPrev);
    actions.appendChild(btnNext);

    cardEl.appendChild(progressEl);
    cardEl.appendChild(stepTextEl);
    cardEl.appendChild(actions);
    root.appendChild(cardEl);
    document.body.appendChild(root);

    // 레이아웃이 바뀌면(사이드바 접힘, 폰트 로드, 콘텐츠 변화 등) 다시 위치를 잡는다.
    // window resize/scroll만으로는 못 잡는 변화라 body 전체를 관찰한다.
    resizeObserver = new ResizeObserver(() => {
      if (open) reposition();
    });
    resizeObserver.observe(document.body);

    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true); // capture: 내부 스크롤 컨테이너도 잡는다
    window.addEventListener("keydown", onKeyDown);
  }

  function onWindowChange() {
    if (open) reposition();
  }
  function onKeyDown(e) {
    if (open && e.key === "Escape") finish();
  }

  /** 하이라이트 박스 개수를 rects 개수에 맞춘다(재사용 + 부족분 생성/과분 제거). */
  function syncHighlightBoxes(count) {
    const existing = root.querySelectorAll(".tour-hl");
    for (let i = existing.length; i < count; i += 1) {
      const box = document.createElement("div");
      box.className = "tour-hl";
      root.insertBefore(box, cardEl); // 카드보다 먼저(DOM 순서상 아래) 두되 실제 표시는 z-index로 처리
    }
    for (let i = existing.length - 1; i >= count; i -= 1) {
      existing[i].remove();
    }
  }

  /** 현재 단계의 anchor rect들에 맞춰 하이라이트 박스와 카드 위치를 다시 계산한다.
   * "레이아웃을 스크립트 실행 시점에 한 번 재고 굳히지 않는다"는 이 프로젝트의 원칙대로,
   * 매번 show-time에 실측한다(고정된 배율/좌표를 저장해두지 않는다). */
  function reposition() {
    const step = STEPS[idx];
    const anchorEls = step.anchors
      .map((sel) => document.querySelector(sel))
      .filter(isVisible);

    if (anchorEls.length === 0) {
      // 지금 단계 anchor가 화면에서 사라졌다(예: 사용자가 뷰를 전환함) — 다음에 보이는 단계로 넘어간다.
      const next = findNextOpenStep(idx, 1);
      if (next === -1) {
        finish();
      } else {
        idx = next;
        reposition();
      }
      return;
    }

    const rects = anchorEls.map((el) => el.getBoundingClientRect());
    syncHighlightBoxes(rects.length);
    const boxes = root.querySelectorAll(".tour-hl");
    rects.forEach((r, i) => {
      const box = boxes[i];
      box.style.top = `${r.top - 6}px`;
      box.style.left = `${r.left - 6}px`;
      box.style.width = `${r.width + 12}px`;
      box.style.height = `${r.height + 12}px`;
    });

    // 카드는 첫 anchor 기준으로 아래쪽에 붙이되, 화면 아래로 넘치면 위쪽에 붙이고
    // 가로로도 뷰포트 밖으로 안 나가게 clamp한다.
    const primary = rects[0];
    const cardW = cardEl.offsetWidth || 280;
    const cardH = cardEl.offsetHeight || 120;
    const margin = 14;
    let top = primary.bottom + margin;
    if (top + cardH > window.innerHeight) top = Math.max(margin, primary.top - cardH - margin);
    let left = primary.left;
    left = Math.min(Math.max(margin, left), window.innerWidth - cardW - margin);
    cardEl.style.top = `${top}px`;
    cardEl.style.left = `${left}px`;
  }

  function renderStepContent() {
    const step = STEPS[idx];
    stepTextEl.textContent = t(step.textKey);
    progressEl.textContent = t("tour.progress", { n: idx + 1, total: STEPS.length });
    btnSkip.textContent = t("tour.skip");
    btnPrev.textContent = t("tour.prev");
    btnPrev.style.visibility = findNextOpenStep(idx, -1) === -1 ? "hidden" : "visible";
    btnNext.textContent = findNextOpenStep(idx, 1) === -1 ? t("tour.done") : t("tour.next");
  }

  function goTo(nextIdx) {
    idx = nextIdx;
    renderStepContent();
    reposition();
  }

  /** 오버레이를 만들어(처음 한 번만) 보여준다. 이미 떠 있으면 아무 일도 하지 않는다. */
  function start() {
    if (open) return;
    const firstOpen = findNextOpenStep(-1, 1);
    if (firstOpen === -1) return; // 4단계 anchor가 전부 안 보이면(다른 뷰가 떠 있는 등) 조용히 포기한다.
    if (!root) buildDom();
    idx = firstOpen;
    open = true;
    root.hidden = false;
    renderStepContent();
    reposition();
  }

  /** 투어를 닫고 "다시 안 뜨게" localStorage에 기록한다(스킵/완료 공통 — SPEC_M4 §5: 한 번 보면 끝). */
  function finish() {
    open = false;
    if (root) root.hidden = true;
    markSeenTour();
  }

  /** localStorage 기록과 무관하게 무조건 다시 시작한다 — restart 어포던스가 부른다. */
  function restart() {
    open = false;
    if (root) root.hidden = true;
    start();
  }

  /** 지금 열려 있으면 그냥 닫는다(기록은 남기지 않는다) — 외부에서 강제로 닫아야 할 때 대비. */
  function dismiss() {
    open = false;
    if (root) root.hidden = true;
  }

  function ensureRestartButton() {
    if (restartBtn) return;
    restartBtn = document.createElement("button");
    restartBtn.type = "button";
    restartBtn.className = "tour-restart";
    restartBtn.textContent = t("tour.restart");
    restartBtn.onclick = () => restart();
    document.body.appendChild(restartBtn);
    onLangChange(() => {
      restartBtn.textContent = t("tour.restart");
    });
  }

  /** 언어가 바뀌면 열려 있는 카드 문구도 즉시 갱신한다(SPEC_M4 §1.5: 언어는 표시일 뿐). */
  onLangChange(() => {
    if (open) renderStepContent();
  });

  ensureRestartButton();

  // ── 첫 방문 자동 시작 ────────────────────────────────────────────────────────────────
  // #map은 스크립트 실행 시점엔 크기가 거의 0인 경우가 있다(이 프로젝트가 이미 두 번 겪은 함정 —
  // ResizeObserver로 실제 크기가 잡히는 걸 기다리고, 그마저도 안 오면 타임아웃으로 그냥 시도한다.
  if (!hasSeenTour()) {
    // 부팅 시퀀스가 끝나 앵커가 실제로 화면에 잡힐 때까지 기다렸다가 시작한다.
    // #map 크기만 보고 시작하면 안 된다 — 크기는 이미 잡혔는데 부팅 오버레이가 아직 덮고
    // 있어서 findNextOpenStep()이 -1을 돌려주고, start()가 조용히 포기해 투어가 아예
    // 안 뜬다(실측으로 확인한 실제 증상). 그래서 "열렸는지"를 보고 재시도한다.
    let tries = 0;
    const tick = () => {
      if (open || hasSeenTour()) return; // 이미 떴거나 그 사이 본 걸로 기록됨
      start();
      if (open) return;                  // 앵커가 잡혀 실제로 열림
      if (++tries < 40) setTimeout(tick, 250); // 최대 10초까지 재시도 후 포기
    };
    setTimeout(tick, 300);
  }

  return { start, restart, dismiss };
}
