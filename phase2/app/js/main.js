// 최종 배선(wiring) 모듈 — M1의 모든 조각(rng/geo/organizations/simulation/map/timeline)을
// 하나의 실행되는 앱으로 연결한다. phase2/prototype/index.html의 검증된 재생 루프·크롬(chrome)
// 갱신·부트 시퀀스·활동 피드·조직 카드·컨트롤 로직을 그대로 포팅하되, Canvas 2D 직접 그리기
// 대신 map.js(deck.gl)·timeline.js(Canvas 타임라인만) 모듈을 호출하도록 다시 배선했다.
// BUILD_PLAN.md T5.

import { makeLandTest } from "./geo.js";
import { ORGS, DIRECTIVES } from "./organizations.js";
import { simulate } from "./simulation.js";
import { createMap } from "./map.js";
import { createTimeline } from "./timeline.js";
import { createAnalysisView } from "./analysis-view.js";
// ── 조직 팔레트 ────────────────────────────────────────────────────────────
// M3-T4부터는 palette.js가 유일한 색상 소스다(map.js/analysis-view.js와 공유). 카드/
// 타임라인/피드가 지도와 다른 색을 쓰는 어긋남을 palette.js 하나로 없앤다.
import { ORG_COLORS } from "./palette.js";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const D0 = Date.UTC(2026, 0, 1);

const SEED = 20260903;

/** "01" 처럼 두 자리로 왼쪽을 0으로 채운다. String(n).padStart(w,"0")의 짧은 래퍼. */
const pad = (n, w) => String(n).padStart(w, "0");

// ── 부트: 세 개의 GeoJSON을 fetch하고, 코스 land test를 만들고, simulate()를 실행한다 ────
async function boot() {
  // index.html 기준 상대 경로. phase2/app/data/에 T1에서 이미 커밋되어 있다.
  const [ne50land, ne50coast, ne110land] = await Promise.all([
    fetch("data/ne_50m_land.geojson").then((r) => r.json()),
    fetch("data/ne_50m_coastline.geojson").then((r) => r.json()),
    fetch("data/ne_110m_land.geojson").then((r) => r.json()),
  ]);

  // 이벤트 생성 시 안/밖 판정에 쓰는 코스(coarse) 육지 테스트. 화면 표시는 ne50land/ne50coast를
  // map.js에 그대로 넘겨 따로 쓴다(T1 주석대로 "생성용"과 "표시용"을 분리).
  const landTest = makeLandTest(ne110land);
  const { events, periods, byDay, days } = simulate({ seed: SEED, landTest });

  // byDay[day][orgIndex]의 전체 최댓값 — 타임라인 히스토그램 스케일링에 쓴다(timeline.js maxPerDay).
  let maxPerDay = 0;
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < ORGS.length; i++) {
      if (byDay[d][i] > maxPerDay) maxPerDay = byDay[d][i];
    }
  }

  runApp({ events, periods, byDay, days, maxPerDay, landGeo: ne50land, coastGeo: ne50coast });
}

function runApp({ events, periods, byDay, days, maxPerDay, landGeo, coastGeo }) {
  // ── DOM 참조 ─────────────────────────────────────────────────────────
  const mapEl = document.getElementById("map");
  const tlc = document.getElementById("tlc");
  const cellsEl = document.getElementById("cells");
  const feedEl = document.getElementById("feed");
  const bootEl = document.getElementById("boot");
  const rPosEl = document.getElementById("r-pos");
  const rSclEl = document.getElementById("r-scl");
  const dtgEl = document.getElementById("dtg");
  const sEvEl = document.getElementById("s-ev");
  const sDotEl = document.getElementById("s-dot");
  const sModeEl = document.getElementById("s-mode");
  const ppEl = document.getElementById("pp");
  const rvEl = document.getElementById("rv");

  // ── 재생 상태 ────────────────────────────────────────────────────────
  // 프로토타입의 전역 변수(day, playing, speed, reveal, vis[])를 그대로 옮긴다.
  let day = 0;
  let playing = true;
  let speed = 7;
  let reveal = false;
  const visibleOrgs = new Set(ORGS.map((o) => o.key)); // 전부 보이는 상태로 시작

  // events는 simulate()가 day 오름차순으로 채워 넣으므로(day 루프 → org 루프 → branch 루프),
  // 포인터(ai)를 한쪽 방향으로만 전진시키면서 "오늘까지 발생한 사건"을 누적 집계할 수 있다.
  // 프로토타입의 ai/cnt/lastFed 포인터와 동일한 아이디어.
  let ai = 0; // events[0..ai) 가 현재 day까지 이미 "발생"한 사건
  const cnt = Object.fromEntries(ORGS.map((o) => [o.key, 0])); // 조직별 누적 이벤트 수
  let lastFed = 0; // feed에 이미 그려 넣은 이벤트 개수(ai를 따라감)

  /** ai/cnt/lastFed/피드를 전부 0으로 되돌린다(뒤로 스크럽할 때만 필요). */
  function resetAccum() {
    ai = 0;
    lastFed = 0;
    ORGS.forEach((o) => (cnt[o.key] = 0));
    feedEl.innerHTML = "";
  }

  /**
   * 현재 day를 newDay로 옮긴다. newDay가 지금보다 과거면(스크럽으로 되감기) 누적 상태를
   * 전부 리셋한 뒤 처음부터 다시 훑는다 — events가 최대 수천 개라 매번 처음부터 훑어도 가볍다.
   * newDay가 미래거나 같으면 ai 포인터를 그 지점까지만 마저 전진시킨다(재생 루프의 정상 경로).
   */
  function setDay(newDay) {
    if (newDay < day) resetAccum();
    day = newDay;
    while (ai < events.length && events[ai].day <= day) {
      cnt[events[ai].org]++;
      ai++;
    }
  }

  // ── 지도 hover 좌표 판독기 ────────────────────────────────────────────
  // deck.gl의 onHover(info)는 지도 밖이면 info.coordinate가 없다.
  function onHover(info) {
    if (!info || !info.coordinate) {
      rPosEl.textContent = "--.-- -  ---.-- -";
      return;
    }
    const [lo, la] = info.coordinate;
    rPosEl.textContent =
      Math.abs(la).toFixed(2) + " " + (la < 0 ? "S" : "N") + "  " +
      Math.abs(lo).toFixed(2) + " " + (lo < 0 ? "W" : "E");
  }

  const map = createMap(mapEl, { onHover, landGeo, coastGeo });

  // ── 타임라인 스크럽 ──────────────────────────────────────────────────
  function onScrub(newDay) {
    setDay(newDay);
  }
  const timeline = createTimeline(tlc, { onScrub });

  // timeline.js는 periods를 {o(조직 인덱스), d(지침), a(시작일), b(종료일)} 모양으로 기대하는데
  // simulate()가 반환하는 periods는 {org(조직 key 문자열), directive, startDay, endDay} 모양이다.
  // 두 인터페이스가 다르므로(BUILD_PLAN 인터페이스는 map.js 쪽만 고정했고 timeline.js 쪽은
  // 자체 주석에 별도로 {o,d,a,b}를 못박아 뒀다) 여기서 한 번만 변환해 둔다.
  const orgIndexOf = Object.fromEntries(ORGS.map((o, i) => [o.key, i]));
  const tlPeriods = periods.map((p) => ({
    o: orgIndexOf[p.org],
    d: p.directive,
    a: p.startDay,
    b: p.endDay,
  }));
  const orgColors = ORGS.map((o) => ORG_COLORS[o.key]);

  // ── 조직 카드 (#cells) ───────────────────────────────────────────────
  // 프로토타입 §404-412의 마크업을 그대로 포팅. data-ev/data-rad/data-dir을 이후 chrome()에서 갱신.
  const cellEls = ORGS.map((org) => {
    const d = document.createElement("div");
    d.className = "cell";
    d.tabIndex = 0;
    d.style.setProperty("--c", ORG_COLORS[org.key]);
    d.innerHTML =
      '<div class="nm">' + org.key + '</div>' +
      '<div class="rows">' +
        '<div><i>EV</i> <span data-ev>000</span></div>' +
        '<div><i>RAD</i> <span data-rad>000</span> KM</div>' +
      '</div>' +
      '<div class="dir" data-dir hidden></div>';
    const toggle = () => {
      if (visibleOrgs.has(org.key)) visibleOrgs.delete(org.key);
      else visibleOrgs.add(org.key);
      d.classList.toggle("off", !visibleOrgs.has(org.key));
    };
    d.onclick = toggle;
    d.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
    cellsEl.appendChild(d);
    return d;
  });

  // ── DTG(date-time-group) 문자열. 프로토타입 dtgs()와 동일한 형식(임의의 "시각"을 day*7%24로 흉내). ─
  function dtgString(d) {
    const t = new Date(D0 + d * 86400000);
    return (
      pad(t.getUTCDate(), 2) + pad((d * 7) % 24, 2) + "00Z " +
      MON[t.getUTCMonth()] + " " + String(t.getUTCFullYear()).slice(2)
    );
  }

  // ── 크롬(chrome) 갱신: 상태바, 조직 카드, 활동 피드. 프로토타입 chrome()의 포팅. ──────────
  function chrome() {
    dtgEl.textContent = dtgString(day);
    sEvEl.textContent = pad(ai, 4);

    ORGS.forEach((org, i) => {
      const p = tlPeriods.find((q) => q.o === i && day >= q.a && day < q.b);
      const directiveKey = p ? p.d : "CONSOLIDATE"; // 활성 기간이 없을 때의 폴백. map.js DEFAULT_DIRECTIVE와 동일 규칙.
      const dirDef = DIRECTIVES[directiveKey];
      const el = cellEls[i];
      el.querySelector("[data-ev]").textContent = pad(cnt[org.key], 3);
      el.querySelector("[data-rad]").textContent = pad(Math.round(org.baseRadius * dirDef.radiusMult), 3);
      const dd = el.querySelector("[data-dir]");
      dd.hidden = !reveal;
      if (reveal && p) dd.textContent = p.d + " · " + pad(p.b - day, 3) + "D LEFT";
    });

    // 피드: ai가 전진한 만큼(lastFed..ai) 새 이벤트를 맨 위에 추가하고 11개를 넘으면 맨 아래를 지운다.
    while (lastFed < ai) {
      const e = events[lastFed];
      lastFed++;
      if (feedEl.children.length > 11) feedEl.lastChild.remove();
      const row = document.createElement("div");
      row.innerHTML =
        '<em style="color:' + ORG_COLORS[e.org] + '">' + e.org.slice(0, 4) + "</em> " +
        Math.abs(e.lat).toFixed(1) + (e.lat < 0 ? "S" : "N") + " " +
        e.lon.toFixed(1) + "E · " + e.method.toUpperCase() + " · " + e.target.slice(0, 5).toUpperCase();
      feedEl.prepend(row);
    }
  }

  // ── 재생 루프 ─────────────────────────────────────────────────────────
  // 프로토타입의 acc2 누산기(accumulator)와 동일: speed(1/7/30배속)를 프레임마다 조금씩 쌓다가
  // 1을 넘을 때 day를 1씩 전진시킨다. requestAnimationFrame 프레임레이트에 무관하게
  // "하루가 몇 프레임에 한 번 넘어가는지"가 speed에 비례하도록 만드는 장치.
  let acc2 = 0;
  function loop() {
    if (playing) {
      acc2 += speed / 2.2;
      let newDay = day;
      while (acc2 >= 1 && newDay < days - 1) {
        newDay++;
        acc2--;
      }
      if (newDay !== day) setDay(newDay);
      if (day >= days - 1) setDay(0); // 끝에 도달하면 처음부터 다시(프로토타입 rewind(0))
    }

    map.setFrame({ day, events, orgs: ORGS, periods, reveal, visibleOrgs });
    timeline.draw({ day, byDay, periods: tlPeriods, days, maxPerDay, reveal, orgColors });
    chrome();

    requestAnimationFrame(loop);
  }

  // ── 타임라인 캔버스 리사이즈(DPR 대응) ───────────────────────────────────
  // timeline.js의 draw()는 "tx가 이미 DPR 스케일 적용을 마쳤다"고 가정한다(모듈 상단 주석).
  // 이 스케일링과 canvas.width/height(디바이스 픽셀 단위) 설정은 main.js의 책임.
  function resizeTimeline() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = tlc.getBoundingClientRect();
    tlc.width = Math.max(200, r.width) * dpr;
    tlc.height = Math.max(40, r.height) * dpr;
    tlc.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeTimeline();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeTimeline, 100);
  });
  if (window.ResizeObserver) new ResizeObserver(() => resizeTimeline()).observe(tlc.parentElement);

  // ── 줌 프리셋 / 컨트롤 ────────────────────────────────────────────────
  // 프로토타입은 px/deg 카메라(cam.z)를 썼지만 deck.gl은 zoom level을 쓴다(BUILD_PLAN T4 노트,
  // index.html 하단 readout 라벨도 T5에서 ZOOM/WEB-MERCATOR로 바꿨다).
  function updateScaleReadout() {
    rSclEl.textContent = map.getViewState().zoom.toFixed(1);
  }
  document.getElementById("z-world").onclick = () => {
    map.setView({ zoom: 0.3, longitude: 0, latitude: 20 });
    updateScaleReadout();
  };
  document.getElementById("z-ao").onclick = () => {
    map.setView({ zoom: 3, longitude: 120, latitude: -5 });
    updateScaleReadout();
  };
  document.getElementById("z-in").onclick = () => {
    map.setView({ zoom: map.getViewState().zoom + 0.5 });
    updateScaleReadout();
  };
  document.getElementById("z-out").onclick = () => {
    map.setView({ zoom: map.getViewState().zoom - 0.5 });
    updateScaleReadout();
  };
  // deck.gl 컨트롤러가 마우스 휠/드래그로 직접 zoom을 바꿀 수도 있으므로 주기적으로도 맞춰준다.
  setInterval(updateScaleReadout, 500);

  rvEl.onclick = (e) => {
    reveal = !reveal;
    e.currentTarget.classList.toggle("on", reveal);
    // map.setFrame에도 reveal을 넘기지만 map.js는 M1에서 이를 사용하지 않는다(모듈 주석 참고) —
    // 카드/타임라인만 reveal에 반응한다.
  };

  ppEl.onclick = (e) => {
    playing = !playing;
    e.currentTarget.textContent = playing ? "PAUSE" : "PLAY";
    e.currentTarget.classList.toggle("on", playing);
    sDotEl.classList.toggle("on", playing);
    sModeEl.textContent = playing ? "RUNNING" : "HOLD";
  };

  document.querySelectorAll("[data-sp]").forEach((b) => {
    b.onclick = () => {
      speed = +b.dataset.sp;
      document.querySelectorAll("[data-sp]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });

  // ── 뷰 라우팅(SIM/ORG/ANL/DAT) ───────────────────────────────────────
  // .wrap[data-view]를 nav 버튼 클릭에 맞춰 바꾸면 style.css의 .wrap:not([data-view="sim"]) 규칙이
  // stage/side/timeline을 숨기고 해당 .viewpane(#view-anl/#view-org/#view-dat)만 보여준다.
  // ANL은 처음 진입할 때 한 번만 createAnalysisView().render()를 호출해 runAblation() 결과를 그린다
  // (analysis-view.js 안에서 result를 캐싱하므로 다시 눌러도 재계산하지 않는다).
  const wrapEl = document.querySelector(".wrap");
  const anlView = createAnalysisView(document.getElementById("view-anl"), { events, periods });
  let anlRendered = false;
  document.querySelectorAll("[data-view-btn]").forEach((btn) => {
    btn.onclick = () => {
      const view = btn.dataset.viewBtn;
      wrapEl.dataset.view = view;
      document.querySelectorAll("[data-view-btn]").forEach((b) => b.classList.toggle("sel", b === btn));
      if (view === "anl" && !anlRendered) {
        anlRendered = true;
        anlView.render();
      }
    };
  });

  // ── 부트 시퀀스 ──────────────────────────────────────────────────────
  const BOOT = [
    ["GROUND TRUTH CONSOLE", "v0.9.1"],
    ["TERRAIN MASK", "LOADED"],
    ["PRNG SEED " + SEED, "LOCKED"],
    ["AGENT HIERARCHY / 3 CELLS", "READY"],
    ["SIMULATION SPAN / " + days + " DAYS", "BUILT"],
    ["COMMAND LAYER", "WITHHELD"],
  ];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion) {
    // 부트 애니메이션을 건너뛰고, 프로토타입처럼 재생 중간 지점(day 940)에서 정지 상태로 시작한다.
    bootEl.classList.add("done");
    setDay(940);
    playing = false;
    ppEl.textContent = "PLAY";
    ppEl.classList.remove("on");
    sDotEl.classList.remove("on");
    sModeEl.textContent = "HOLD";
  } else {
    BOOT.forEach((line, i) => {
      setTimeout(() => {
        const d = document.createElement("div");
        d.innerHTML =
          (i === 0 ? "<b>" + line[0] + "</b>" : line[0]) +
          ' <span class="ok">' + ".".repeat(Math.max(3, 34 - line[0].length)) + " " + line[1] + "</span>";
        bootEl.appendChild(d);
      }, i * 230);
    });
    setTimeout(() => bootEl.classList.add("done"), 1900);
  }

  updateScaleReadout();
  requestAnimationFrame(loop);
}

boot();
