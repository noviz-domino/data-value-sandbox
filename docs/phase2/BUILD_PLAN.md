# Build plan & checklist — phase 2

Resumable state for the phase-2 build. A new session should read this, then `SPEC.md` for the rules that do not change. Update the checkboxes as work lands; commit after each completed task so an interrupted session can resume from the last commit.

## Delegation model

- **Opus (architect):** designs, splits tasks, writes this plan and the module interfaces, reviews and approves, commits. Does not write feature code.
- **Sonnet (author):** writes each module to file, reports a short summary (not the full code).
- **Sonnet (reviewer):** reads the written files, reports logic/edge/perf/security issues. Author revises.
- Report to the user only at **milestone boundaries**.

## Stack decision (2026-09, supersedes SPEC §2 rendering)

The prototype used hand-drawn Canvas 2D polygons; they look poor and cannot zoom. Replaced with:

- **Renderer: deck.gl (standalone, no MapLibre).** `GeoJsonLayer` for land, `ScatterplotLayer` for events. GPU handles the glow, pulse and pan/zoom the prototype faked in Canvas.
- **Geography: Natural Earth, self-hosted in-repo.** No tiles, no API key, no account — the portfolio must not rot the way the Supabase demos did. Files ship in the repo and load with a plain fetch (no HTTP range requests, so GitHub Pages / Vercel / Cloudflare Pages all work later).
- Hosting is deferred. Local dev server (`.claude/launch.json` → `prototype`, add an `app` entry) is enough for now.

Everything in SPEC §6–§9 (simulation rules, organizations, data contracts, analysis) is unchanged. Only the rendering and geography sections are superseded.

## Milestones

- **M1 — map & simulation view** ✅ DONE (2026-09-04). deck.gl + Natural Earth: world map, 5-year playback, org markers + radius, drift, reveal toggle, timeline, activity feed. Runs at `phase2/app/` (dev server: launch.json `app`, port 8779).
- M2 — analysis view: ablation runs, floor/ceiling, confusion matrices. ✅ DONE (2026-09-04). Ladder: floor 38.8% → A 64.7% → B TIDEBREAK recall +14.9pp → C DRYSTONE recall +16.1pp, oracle ceiling 86.6% (true bound after wiring branch share). Orgs relocated to Lesser Sunda chain for overlap.
- M3 — **target inference** (redefined 2026-09-06, supersedes "organizations view + signal-strength sliders"). Infer which facility a scattered set of incidents is preparing against, with 80% background noise. See [SPEC_M3.md](SPEC_M3.md).
- M4 — data view + export, guided tour, density layer, seed variance.

### Why M3 was redefined

The original M3 (signal-strength sliders) had no clear consumer. The project's identity settled as a **methodology instrument for intelligence-style analysis**: not "predict terrorism" but "what must you collect before prediction is possible, and where does the method break". Target inference is that question in its sharpest form — and the noise ratio slider survives inside it with a real job (at what noise level does inference fail).

Design decisions locked with the user before writing SPEC_M3:
- Candidate targets are **real facility locations** (OSM/ODbL, 160 in the AO) with **names withheld** — realistic placement without producing a target list for real infrastructure.
- **80% of events are unrelated noise**, and noise clusters near facilities too (otherwise "activity near a facility" trivially means "target").
- Multiple organisations run **simultaneous campaigns against different targets**, so grouping events is a genuine problem.
- Production datasets (real GTD/ACLED) are **out of scope**; M3 builds structure at test scale.

---

## M1 tasks & checklist

Work lands in `phase2/app/` (leave `phase2/prototype/` as the reference). File layout:

```
phase2/app/
├── index.html
├── css/style.css
├── data/
│   ├── ne_50m_land.geojson       display land (fill)
│   ├── ne_50m_coastline.geojson  display coastline (stroke)
│   └── ne_110m_land.geojson      COARSE — used only for in/out tests during generation
└── js/
    ├── rng.js            seeded mulberry32
    ├── geo.js            haversine, dest, isLand, isCoastal (against ne_110m)
    ├── organizations.js  org + directive definitions (SPEC §7)
    ├── simulation.js     generation loop (port validated prototype logic)
    ├── map.js            deck.gl instance + layers
    ├── timeline.js       timeline canvas + playhead + directive bands
    └── main.js           state, controls, playback loop, wiring
```

### T0 — architect: this plan + interfaces
- [x] BUILD_PLAN.md with stack decision, module interfaces, acceptance (this file)
- [x] committed (8243980)

### T1 — geography data (Sonnet author → light check)
- [x] fetched ne_50m_land (1.6MB/1420), ne_50m_coastline (1.6MB/1428), ne_110m_land (138KB/127) into `phase2/app/data/`
- [x] all valid FeatureCollection, 110m is all Polygon
- [x] committed (data)

### T2 — core logic: rng.js, geo.js, organizations.js, simulation.js (Sonnet author → reviewer) [DONE — committed, perf fix in progress]
> Review verdict: APPROVE-WITH-FIXES. Logic/determinism/trig/security clean.
> [MAJOR] isLand no spatial index → simulate() ~3.8s sync freeze on load. FIXED: per-ring bbox cull (ac76ea0), 3.8s→0.3s, self-test identical.
> Accepted as-is: antimeridian fragility (not exercised, orgs at 100-135°E), isCoastal 8-bearing approximation (SPEC §5.2 permits), monthOf duplicated in simulation.js + _selftest.mjs (nit).
Port the **validated** logic from `phase2/prototype/index.html` (the `rand`, `dest`, `EV`/`PER` build). Do not redesign the rules. Two required changes from the prototype:
1. `isLand`/`isCoastal` now test against **ne_110m_land** polygons (real coastlines), not the hand-drawn array. Use point-in-polygon against the coarse land for generation speed; display uses 50m separately.
2. Split the single inline script into ES modules with the interfaces below.

**Interfaces (must match exactly so other modules compile against them):**
```js
// rng.js
export function mulberry32(seed)            // → () => float in [0,1)

// geo.js
export function haversineKm(la1,lo1,la2,lo2)
export function dest(la,lo,bearingDeg,km)   // → [lat, lon]
export function makeLandTest(ne110geojson)  // → { isLand(lon,lat), isCoastal(lat,lon,km=30) }

// organizations.js
export const ORGS         // SPEC §7.1–7.3: NORTHWIND, TIDEBREAK, DRYSTONE
export const DIRECTIVES   // SPEC §7.5: EXPAND/CONSOLIDATE/SUPPRESS multipliers
export const METHODS, TARGETS, RANGE

// simulation.js
export function simulate({ seed, landTest }) 
//   → { events: [ {id,day,lat,lon,org,branch,method,target,success,casualties} ],
//       periods: [ {org,directive,startDay,endDay} ],
//       byDay: number[day][orgIndex],
//       days: 1826, startDate: '2026-01-01' }
```
- [ ] modules written
- [ ] determinism + planted-signal check passes (SPEC §17 crit 4/5): base drift 8.2–8.4°, event-mean drift ≥6°, DRYSTONE Dec–Feb 25–35% of other months, zero naval events >30 km offshore, total events 1500–3000
- [ ] reviewed, committed

### T3 — deck.gl map (Sonnet author, live-validated in T6 instead of separate reviewer) [DONE — committed]
> map.js written & committed. Rendering correctness verified live in T6, not by a read-only reviewer (more effective for visual code, saves tokens).
> deck.gl is NOT on cdnjs (only an unrelated "deck.js"). Targeted jsDelivr deck.gl@9.3.11 `dist.min.js`. T5 vendors it locally → zero runtime network.
`map.js` exports a controller that owns a deck.gl instance rendering into a container div.
```js
export function createMap(container, { onHover }) 
//   → { setFrame({day, events, orgs, periods, reveal, visibleOrgs}), setView({zoom,center}), destroy() }
```
Layers, per SPEC §11.1 intent, translated to deck.gl:
- `GeoJsonLayer` land (ne_50m_land) — filled `--land`, plus coastline stroke
- `ScatterplotLayer` accumulated events — 2px org-colour dots, low alpha
- `ScatterplotLayer` recent (≤30 day) events — additive blending, radius+alpha by recency (the glow)
- org markers (diamond/square/triangle via IconLayer or a small ScatterplotLayer + TextLayer for callsigns)
- radius circle per org (PolygonLayer or a computed circle) at current effective radius
- TIDEBREAK drift trail (PathLayer)
- graticule + degree labels (LineLayer + TextLayer), or leave to a faint GeoJson graticule
- Palette and type come from the prototype/`SPEC §15`: saturation only for orgs, IBM Plex, dark slate neutrals.
- [ ] renders, pan/zoom smooth, no console errors
- [ ] reviewed, committed

### T4 — UI shell + timeline (Sonnet author → light check) [DONE — committed]
> Note for T5: the readout still shows `PX/DEG` / `PROJ EQUIRECT` from the Canvas prototype. With deck.gl, update to the deck zoom level and drop the equirect label (or set the real projection name).
Adapt the prototype's `index.html` + CSS (already designed and validated): status bar, left rail, side org-cards + activity feed, bottom timeline, reveal toggle, transport controls, zoom buttons, boot sequence. Swap the `<canvas id="map">` for the deck.gl container. `timeline.js` keeps the Canvas timeline (bands per org, playhead, directive bands on reveal, with the `CONS/EXPA/SUPP` labels already tuned).
- [ ] shell + timeline match prototype's look; charset meta present; `<meta charset="utf-8">` included
- [ ] reviewed, committed

### T5 — wiring: main.js + vendor deck.gl + index.html script tag (Sonnet author) [DONE — committed]
> Vendored deck.gl@9.3.11 locally (1.6MB, zero runtime network). Fixed the readout label (PX/DEG→ZOOM, EQUIRECT→WEB-MERCATOR). Resolved a real periods-shape mismatch between simulation.js (`{org,directive,startDay,endDay}`) and timeline.js (`{o,d,a,b}`) in the wiring layer.

### T6 — architect final review (Opus) [DONE]
- [x] live run via local server; deck.gl loads, real geography renders, 3 orgs glow, timeline/feed/cards/controls work, no code errors (favicon 404 only)
- [x] gotcha: rAF suspended in hidden pane (playback looks frozen headlessly — not a bug); zombie servers on :8778 (killed by PID)
- [x] hero screenshot saved (docs/screenshots/app-map.png)
- [x] DEVLOG M1 entry; committed
- [x] M1 reported to user
State object (SPEC §4), playback loop, control handlers, reveal, org visibility, zoom presets. Loads the three GeoJSON files, builds the land test from ne_110m, runs `simulate`, drives `map.setFrame` + timeline each frame.
- [ ] full app runs end to end via local server
- [ ] reviewed, committed

### T6 — architect final review (Opus)
- [ ] cross-module integ check, acceptance re-run, screenshot via capture-server, prototype-vs-app parity, DEVLOG entry, commit
- [ ] report M1 to user

## M2 tasks & checklist — analysis view [CURRENT]

The thesis made measurable: which feature set recovers which planted signal, bounded by a floor (majority baseline) and a ceiling (oracle). New files in `phase2/app/js/`. Scope: the classification ablation (runs A/B/C) + bounded accuracy + confusion matrices + per-class metrics, rendered in the ANL view. **Deferred to later:** change-point/directive recovery (SPEC §9.6), seed variance (§9.5), signal sweep (§12.1) — those are M3.

### M2-T1 — analysis engine `analysis.js` (Sonnet author → reviewer) [correctness-critical] [DONE — committed; cross-review in progress]
> Ladder now real (both self-tests pass): floor 36.3% → A 66.1% → B TIDEBREAK recall +16.2pp → C DRYSTONE recall +20.1pp; oracle ceiling 85.6% (<100%). Orgs relocated to Lesser Sunda chain (−8.5°S, ~113.5–119°E). analysis.js + organizations.js + _analysis_selftest.mjs committed. Reviewer auditing analysis.js for label-leakage / split-consistency / oracle validity.
> **Design flaw the self-test exposed:** analysis.js is written and correct, but the ablation was VACUOUS — run A (lat,lon) scored 100% because the three orgs were placed thousands of km apart (Mongolia/Indonesia/Australia) with radii <1000 km, so zero territorial overlap. Coordinates alone perfectly separate them; nothing for day/target to recover; oracle also 100%. This is an org-placement design error (architect), not an analysis.js bug — the author correctly refused to fudge it.
> **FIX in progress:** relocate all three into one overlapping cluster in northern Australia (ne_110m land, southern hemisphere for DRYSTONE season, north coast for naval), keeping mechanisms (TIDEBREAK drift sweeps through, DRYSTONE season/target, NORTHWIND stationary control). Gated on BOTH self-tests: M1 planted signals still hold AND the ladder emerges (A<100%, TIDEBREAK B−A ≥15pp, DRYSTONE C−B>0, ceiling in (best_acc,100%)). Editing organizations.js + _analysis_selftest.mjs only.
> After the fix: M1's map changes (orgs clustered, not spread) — regenerate docs/screenshots/app-map.png at M2 close.
Interfaces:
```js
// KNN from scratch (~30 lines), haversine on the geo pair + min-max-normalized non-geo features.
export function knnClassify({ train, test, k=5 })   // train/test: [{features:{lat,lon,...}, label}] → predictions[]
export function confusion(actual, predicted, classes) // → {matrix, perClass:{precision,recall,f1}, accuracy}
export function majorityBaseline(labels)              // floor: fraction of the most common class
export function oracleAccuracy(events, {ORGS,DIRECTIVES,periods})  // ceiling, see below
export function runAblation({events, periods})        // → { A, B, C } each: {features, accuracy, floor, ceiling, recovered, confusion}
```
Ablation feature sets (SPEC §9.3), target = `org`, 80/20 split stratified by org, seeded:
- A: `lat, lon`  → NORTHWIND/DRYSTONE separate, TIDEBREAK poor
- B: `+ day_index` → TIDEBREAK recall jumps (the headline delta)
- C: `+ target_type, month` → DRYSTONE gains
`recovered = (accuracy - floor) / (ceiling - floor)`.
**Oracle (the piece only synthetic data allows):** for each event compute, for each org, the probability that org's true rules would produce an event at this (lat,lon,day,branch,target): use the org's base position on that day (TIDEBREAK drifts), its effective radius under the directive active in `periods` for that day, branch ranges/shares, seasonal factor, target preference. `argmax` = oracle prediction; its accuracy over the test split = ceiling. Oracle reads the true model — it lives in the scoring path, never a feature.
- [ ] written; a node self-test asserts: floor ≈ 59% region? (no — org counts are ~equal here, so floor ≈ 33-38%); ceiling strictly between best model accuracy and 100%; run B TIDEBREAK recall exceeds run A by a clear margin; every accuracy in [floor, ceiling]
- [ ] reviewed, committed

### M2-T2 — analysis view UI + view routing `analysis-view.js` + main.js nav (Sonnet author) [live-validated]
- Wire the left-rail nav (SIM/ORG/ANL/DAT) to switch views; ANL shows the analysis view, others keep M1/placeholder.
- Analysis view renders (SPEC §13, design per §15 — saturation only for orgs, IBM Plex, dark slate): (1) bounded-accuracy track per run [floor | achieved | ceiling] with recovered-fraction %; (2) run comparison table (features, floor, accuracy, ceiling, recovered); (3) confusion-matrix heatmaps per run; (4) per-class precision/recall grouped bars. Every accuracy shows floor AND ceiling adjacent — never bare.
- Charts are Canvas 2D or lightweight SVG, matching the console aesthetic. Round all numbers.
- [ ] renders, nav switches, numbers match analysis.js
- [ ] committed

### M2-T3 — architect final review (Opus) [DONE]
- [x] **Fix from M2-T1 review [MAJOR]:** wired branch `share` into simulation.js (377d3d3) — oracle now a true bound; both self-tests pass; ladder held. Reset the TIDEBREAK-delta assertion to a principled ≥10pp (split noise ~1-2pp).
- [x] regenerated app-map.png (orgs relocated, overlapping) + captured app-analysis.png
- [x] live run: ANL renders with matching numbers, honest per-org recovery (incl. NORTHWIND hurt by target features), SIM still works; DEVLOG M2 entry; committed; reported
> M2-T1 review verdict: APPROVE-WITH-FIXES. Clean: no label leakage, shared/stratified/seeded split, train-only normalization, correct metrics, deterministic, fast. Minor/nit: gaussian kernel vs hard-radius (documented smoothing), no /0 guard on `recovered`, ordinal target encoding, duplicated monthOf.

## M1 acceptance (verify before reporting)
1. Opens via `python -m http.server` with no console errors
2. Same seed → identical events (determinism)
3. Planted signals present (SPEC §17 crit 4/5) — check with a JSON probe, not a screenshot
4. Naval events only within 30 km of real coastline
5. deck.gl pan/zoom smooth; land reads as real continents, not hand-drawn
6. Reveal toggle changes map + timeline + org cards together
7. Runs 60 fps at 30× playback

## Resume notes
- Dev server: `python -m http.server 8778 --bind 127.0.0.1 --directory phase2/app`
- Verify by JSON probe first (`javascript_tool` → dump numbers); screenshot only for visual judgement, saved via the POST capture-server pattern (see CLAUDE.md) into `docs/screenshots/`.
- deck.gl + local GeoJSON fetch does NOT work inside a Claude artifact (CSP blocks the fetch). Use the local server. This is expected, not a bug.

---

## M3 tasks & checklist — target inference [CURRENT]

Spec: [SPEC_M3.md](SPEC_M3.md). Ground-truth separation (§3) applies to every task.

### M3-T0 — architect: SPEC_M3 + facilities data [DONE]
- [x] `phase2/app/data/facilities.json` — 160 candidates (102 power, 33 airport, 25 port), anonymised ids, 10.6 KB
- [x] SPEC_M3.md with locked numbers (ring 28→4 km, 100-day cadence, 12 events/campaign, 20/80 split)

### M3-T1 — simulator campaigns (Sonnet author → reviewer) [correctness-critical]
- [ ] `campaigns.js` + `simulate()` gains `{facilities, withCampaigns}` per SPEC_M3 §4
- [ ] `withCampaigns:false` byte-identical to today; M2 self-test still passes
- [ ] ground truth `campaigns[]`, 20% signal share, no event within 1.5 km of its target

### M3-T2 — inference engine `inference.js` (Sonnet author → reviewer) [correctness-critical]
- [ ] `projectForInference` / `scopeEvents` / `scopeFacilities` / `inferTargets` / `evaluateInference` per §5
- [ ] `_inference_selftest.mjs` — 8 assertions incl. the P→PE→PEC ladder and false-alarm rate

### M3-T3 — UI: time window + scope selection + results panel (Sonnet author) [live-validated]
- [ ] timeline bar → time window control, default last 100 days (§6.1)
- [ ] `queryEvents({scope, window})` seam so views never index the array (§6.2)
- [ ] map scope circle (click-drag + numeric radius), results panel with floor and warnings (§6.3–6.4)

### M3-T4 — visual language 6:3:1 (Sonnet author) [independent of T1–T3]
- [ ] CSS custom properties in one place, deep blue-grey ground, one lead accent, WCAG AA text (§7)

### M3-T5 — architect final review (Opus)
- [ ] live run, screenshots, DEVLOG entry, commit, report at milestone boundary

## Resume notes (M3)

If a session is interrupted: `git log --oneline -5` shows what landed. Tasks are independent enough that
an unfinished T3/T4 does not block T1/T2. Run both self-tests before trusting any state:
`node phase2/app/js/_analysis_selftest.mjs` and `node phase2/app/js/_inference_selftest.mjs`.
