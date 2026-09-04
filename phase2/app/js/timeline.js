// Bottom timeline: per-org daily-activity histogram bands, playhead line,
// and (when `reveal` is on) directive bands with CONS/EXPA/SUPP labels.
// Extracted from phase2/prototype/index.html's tline() + scrub() functions.

// createTimeline(canvas, { onScrub }) -> { draw(state) }
//   canvas   : the <canvas id="tlc"> element. Its 2D context is expected to
//              already have any devicePixelRatio scaling applied by the
//              caller (main.js owns resize/DPR, this module only draws).
//   onScrub  : (dayIndex) => void, fired while the user clicks/drags on the
//              timeline to scrub playback to that day.
//
// draw(state) expects:
//   state.day        - current day index (playhead position)
//   state.byDay       - array[DAYS] of array[numOrgs] event counts per day
//   state.periods    - array of { o, d, a, b } directive periods
//                        (o=org index, d=directive key, a=start day, b=end day)
//   state.days        - total number of days (DAYS)
//   state.maxPerDay  - max event count in any single day/org cell (for scaling)
//   state.reveal      - boolean, whether to draw directive bands + labels
//   state.orgColors  - array of CSS color strings, one per org index
export function createTimeline(canvas, { onScrub } = {}) {
  const tx = canvas.getContext("2d");
  let lastDays = 1; // remembers the most recent `days` passed to draw(), used by scrub()

  function draw({ day, byDay, periods, days, maxPerDay, reveal, orgColors }) {
    lastDays = days;
    // canvas.width/height are in device pixels; the caller's DPR transform
    // on `tx` means we should work in CSS pixels here, same as the
    // prototype's `tlc.width/DPR`.
    const dpr = canvas.width / (canvas.clientWidth || canvas.width) || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    tx.clearRect(0, 0, w, h);
    tx.fillStyle = "#0C1319";
    tx.fillRect(0, 0, w, h);

    const numOrgs = orgColors.length;
    const gap = 3;
    const bh = Math.max(8, (h - gap * 2) / numOrgs);

    // Directive bands (drawn behind the histogram) — only when reveal is on.
    if (reveal) {
      periods.forEach(p => {
        const x = (p.a / days) * w;
        const x2 = (p.b / days) * w;
        const y = p.o * (bh + gap);
        const bw = x2 - x;
        tx.fillStyle =
          p.d === "EXPAND" ? "rgba(203,217,227,.30)" :
          p.d === "SUPPRESS" ? "rgba(203,217,227,.07)" :
          "rgba(203,217,227,.17)";
        tx.fillRect(x, y, bw, bh);
        tx.strokeStyle = "rgba(160,186,204,.85)";
        tx.lineWidth = 1;
        tx.beginPath();
        tx.moveTo(x + .5, y);
        tx.lineTo(x + .5, y + bh);
        tx.stroke();
        if (bw > 52) {
          tx.fillStyle = "rgba(230,240,247,.85)";
          tx.font = '600 8.5px "IBM Plex Sans Condensed",sans-serif';
          tx.textAlign = "left";
          if (tx.letterSpacing !== undefined) tx.letterSpacing = "1px";
          tx.fillText(p.d.slice(0, 4), x + 4, y + 9);
          if (tx.letterSpacing !== undefined) tx.letterSpacing = "0px";
        }
      });
    }

    // Per-org daily-activity histogram (2-day buckets, dimmed for future days).
    orgColors.forEach((col, i) => {
      const y = i * (bh + gap);
      tx.fillStyle = col;
      for (let d = 0; d < days; d += 2) {
        const c = (byDay[d][i] || 0) + (d + 1 < days ? byDay[d + 1][i] : 0);
        if (!c) continue;
        const bhh = Math.min(bh, (c / maxPerDay) * bh * .85 + 2);
        tx.globalAlpha = d <= day ? .85 : .18;
        tx.fillRect((d / days) * w, y + bh - bhh, Math.max(1, (w / days) * 2), bhh);
      }
      tx.globalAlpha = 1;
    });

    // Playhead.
    const ph = (day / days) * w;
    tx.strokeStyle = "#CBD9E3";
    tx.lineWidth = 1;
    tx.beginPath();
    tx.moveTo(ph, 0);
    tx.lineTo(ph, h);
    tx.stroke();
    tx.fillStyle = "#CBD9E3";
    tx.fillRect(ph - 3, 0, 6, 3);
  }

  // Scrub handling: click/drag on the canvas maps x-position to a day index.
  function scrub(e) {
    const r = canvas.getBoundingClientRect();
    const nd = Math.round(
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (lastDays - 1)
    );
    onScrub && onScrub(nd);
  }

  canvas.addEventListener("mousedown", e => {
    scrub(e);
    const move = ev => scrub(ev);
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  });

  return { draw };
}
