# Build specification — phase 2 simulator

This document is written to be built from directly. It assumes no knowledge of the repository beyond this file and [PLAN_phase2.md](PLAN_phase2.md), which explains *why* the project exists. This file covers *what to build*.

Where a number appears in this document, it is a decision, not a suggestion. Where something is marked **optional**, it is genuinely optional and the implementer should use judgement.

---

## 1. What is being built

A browser application that generates synthetic incident data on real Earth geography from a hierarchical agent simulation, then measures which subsets of that data are sufficient to recover the structure that was planted into it.

The user of this application is an analyst. They should be able to:

1. Run a simulation and watch five years of events appear on a world map
2. Inspect each organisation's behaviour and current state
3. Reveal the hidden command layer that produced the events, and see how much of it was inferable
4. Run a feature-ablation experiment and read the results against both a floor and a ceiling
5. Weaken or strengthen any planted signal and watch detectability rise and fall
6. Export the generated dataset and the answer key as files

The application must be **fully self-contained in the browser**. No backend, no API keys, no build server. It must run correctly when opened from a static host such as GitHub Pages, and it must also run when the HTML file is opened directly from disk.

### Why static, and why this matters

An earlier project in this portfolio requires a local Python server to run, which means it cannot be linked as a live demo and reviewers can only read its source. That is a dead end this project must not repeat. Everything specified here is achievable client-side. If a proposed feature would require a server, drop the feature rather than adding a server.

---

## 2. Technology

| Concern | Decision | Reason |
|---|---|---|
| Language | Vanilla JavaScript (ES2020+), no framework | No build step, no dependency rot, runs from `file://` |
| Map rendering | Custom Canvas 2D with equirectangular projection | Tile providers require network access; this must work offline |
| Charts | Custom Canvas 2D, or a single CDN library if preferred | Same reason; charts here are simple |
| Land/sea data | Embedded PNG land mask, sampled per pixel | See §5 |
| Randomness | Seeded PRNG (`mulberry32`), all draws routed through it | Reproducibility is a hard requirement |
| Persistence | `localStorage` for user settings only | Datasets are exported as files, not stored |

**No external network calls at runtime.** Any asset the application needs must be embedded or bundled alongside it.

Modules should be separate `.js` files loaded as ES modules where possible, falling back to plain script tags if `file://` module restrictions cause problems. If they do, concatenating into a single file is acceptable — working from disk matters more than file organisation.

---

## 3. File layout

```
sim/
├── index.html              entry point, layout skeleton
├── css/
│   └── style.css           design system + all component styles
├── js/
│   ├── main.js             app bootstrap, view routing, state store
│   ├── rng.js              seeded PRNG
│   ├── geo.js              projection, distance, land mask queries
│   ├── simulation.js       the three-layer agent engine
│   ├── organizations.js    organisation and directive definitions
│   ├── analysis.js         KNN, metrics, ablation runs, change detection
│   ├── render/
│   │   ├── map.js          map canvas: basemap, events, radii, animation
│   │   ├── timeline.js     scrubber and playback
│   │   └── charts.js       bar, line, confusion matrix renderers
│   └── export.js           CSV and JSON serialisation, file download
├── assets/
│   └── landmask.png        equirectangular land/sea mask, see §5
└── data/
    ├── events.csv          canonical generated dataset (committed)
    └── ground_truth.json   canonical answer key (committed)
```

The two files in `data/` are produced by the application's own export function using the default seed, then committed to the repository. They are the reference output. Anyone cloning the repository gets the exact dataset the analysis was run against without having to run anything.

---

## 4. Application state

A single state object owned by `main.js`. Views read from it; only reducers mutate it.

```js
{
  config: {
    seed: 20260903,
    startDate: "2026-01-01",
    endDate:   "2030-12-31",
    organizations: [ /* see §7 */ ],
    signalStrength: {          // see §12.1, 1.0 = as specified in §7
      drift: 1.0,
      seasonality: 1.0,
      targetPreference: 1.0,
      directiveEffect: 1.0
    }
  },
  simulation: {
    status: "idle" | "running" | "complete",
    events: [ /* Event objects, see §8.1 */ ],
    truth:  { /* GroundTruth object, see §8.2 */ }
  },
  playback: {
    currentDay: 0,          // index from startDate
    playing: false,
    speed: 1,               // days advanced per animation frame
    revealTruth: false,     // the hidden-layer toggle, see §11.3
    showDensity: false,     // see §11.1 layer 2
    visibleOrgs: Set<string>
  },
  analysis: {
    status: "idle" | "running" | "complete",
    runs:    { A: Result, B: Result, C: Result, D: ChangePointResult },
    ceiling: { A: number, B: number, C: number },   // oracle, see §9.4
    variance: null | { seeds: number[], mean: number, min: number, max: number },
    sweep:    null | { signal: string, points: [{ strength, recovered }] }
  },
  ui: {
    tourCompleted: boolean,  // persisted to localStorage
    tourStep: number | null
  },
  view: "simulation" | "organizations" | "analysis" | "data"
}
```

---

## 5. Geography engine (`geo.js`)

The simulation runs on real Earth coordinates, so the engine must answer three questions without any network access.

### 5.1 Land mask

Embed a greyscale equirectangular PNG covering the full globe. **2048 × 1024 pixels** is the specified resolution — one pixel is roughly 20 km at the equator, which is finer than any decision the simulation makes. White pixels are land, black are water.

The image is drawn once into an offscreen canvas at startup and read into a `Uint8Array` via `getImageData`. All subsequent queries hit that array.

```
pixelX = floor((lon + 180) / 360 * 2048)
pixelY = floor((90 - lat) / 180 * 1024)
isLand(lat, lon) = mask[pixelY * 2048 + pixelX] > 127
```

If loading the PNG from `file://` is blocked by canvas tainting rules, embed the image as a base64 data URI inside a JS file instead. This is the same technique used elsewhere in this portfolio for a single-file game, and it is the reliable option.

### 5.2 Coastal test

Naval operations require a point to be close to a coastline. Rather than computing true distance to coast, sample a ring:

```
isCoastal(lat, lon, km = 30):
  if not isLand(lat, lon): return false
  for bearing in [0, 45, 90, 135, 180, 225, 270, 315]:
    p = destinationPoint(lat, lon, bearing, km)
    if not isLand(p): return true
  return false
```

Eight samples is enough. This is an approximation and is allowed to be one, because the simulation only needs a consistent rule, not a cartographically correct one.

### 5.3 Distance and offset

Use the haversine formula for distance, and the standard destination-point formula for offsetting a coordinate by a bearing and distance. Both are short and should be implemented directly rather than pulled from a library.

Do **not** use Euclidean distance on raw latitude and longitude. Phase 1 did exactly that and the mistake is documented in [DEVLOG.md](DEVLOG.md); repeating it here would be embarrassing.

---

## 6. Simulation engine (`simulation.js`)

### 6.1 Determinism

Every random draw goes through the seeded PRNG. Running the simulation twice with the same seed must produce byte-identical `events.csv`. This is not a nice-to-have — the entire method depends on the dataset being reproducible.

`Math.random()` must not appear anywhere in the simulation or analysis code.

### 6.2 The loop

The simulation advances one day at a time from `startDate` to `endDate` (1,826 days for the specified five-year span). Each day, for each organisation:

```
1. COMMAND LAYER
   If today >= directiveExpiryDate:
     - pick a new directive (weighted random from EXPAND/CONSOLIDATE/SUPPRESS)
     - set expiry = today + randomInt(60, 180) days
     - append a DirectiveChange record to ground truth

2. BRANCH LAYER
   effectiveTempo  = baseTempo  * directive.tempoMultiplier
   effectiveRadius = baseRadius * directive.radiusMultiplier
   For each branch the organisation owns, compute its own effective
   radius by taking the smaller of the branch's maximum range and
   effectiveRadius.

3. UNIT LAYER
   For each branch:
     if rng() < effectiveTempo * branch.share * seasonalFactor(today):
       generate one Event via §6.3
```

Directive selection is weighted, not uniform: EXPAND 0.35, CONSOLIDATE 0.45, SUPPRESS 0.20. Purely uniform switching makes the change-point detection task artificially easy because the states are equally common.

### 6.3 Event placement

Placing an event is a rejection sampling loop:

```
placeEvent(org, branch, day):
  center = org.currentBase(day)      // may drift, see §7.2
  for attempt in 1..40:
    bearing  = rng() * 360
    distance = effectiveRadius * sqrt(rng())    // sqrt for uniform area
    p = destinationPoint(center, bearing, distance)
    if branch.validate(p): return p
  return null   // give up; no event today for this branch
```

`sqrt(rng())` matters. Sampling distance uniformly clusters events toward the centre, which would plant a radial density gradient nobody asked for and which the analysis would then "discover".

Branch validators:

| Branch | `validate(p)` | Max range |
|---|---|---|
| `ground` | `isLand(p)` | 80 km |
| `naval` | `isCoastal(p, 30)` | 250 km |
| `air` | `isLand(p)` | 600 km |

Giving up after 40 attempts is intentional and is itself realistic: an inland organisation with a naval branch would produce almost nothing, and the absence is meaningful data.

### 6.4 Event attributes

Once a location is chosen, fill in the rest:

- `method` — drawn from the branch's method distribution (§7.4)
- `target_type` — drawn from the organisation's target preference (§7.4)
- `success` — `rng() < 0.72`, uniform across organisations. Deliberately carries no signal, so the analysis has at least one column that is genuinely noise. A method that "finds" structure in this column is overfitting, and having a known-null feature present is how that gets caught.
- `casualties` — if `success`, `floor(exponential(mean = 2.4))`, else `0`

---

## 7. Organisations and directives (`organizations.js`)

Three organisations, all fictional. Base coordinates are real Earth positions chosen for terrain properties only.

### 7.1 NORTHWIND — the control

| Property | Value |
|---|---|
| Base | 46.0°N, 103.0°E (inland steppe, ~1,500 km from any coast) |
| Branches | ground |
| Base radius | 80 km |
| Base tempo | 0.25 events/day (~1 per 4 days) |
| Drift | none |
| Seasonality | none |
| Target preference | uniform across all types |

This organisation exists to be easy. Its entire signature is spatial and static. If a coordinates-only model cannot classify NORTHWIND with high accuracy, the fault is in the model or the pipeline, not in the data. Every other result is read relative to this one.

### 7.2 TIDEBREAK — temporal drift

| Property | Value |
|---|---|
| Base at day 0 | 8.5°S, 116.0°E (western end of an island chain) |
| Branches | ground (60% of events), naval (40%) |
| Base radius | 120 km |
| Base tempo | 0.30 events/day |
| Drift | due east, 15 km/month, ≈900 km over five years |
| Seasonality | none |
| Target preference | uniform |

```
currentBase(day) = destinationPoint(baseAtDay0, bearing = 90, distance = 0.5 * day)
```

0.5 km/day is 15 km per 30 days. The drift is linear and continuous, with no noise added to the centre itself — the scatter comes from event placement around it.

This is the organisation the whole phase turns on. A model given only coordinates sees TIDEBREAK smeared across 900 km of ocean and islands and cannot separate it from anything. Add the date and it collapses into a clean diagonal band in space-time. **The accuracy delta between run A and run B is the headline result of this project.**

### 7.3 DRYSTONE — seasonality and preference

| Property | Value |
|---|---|
| Base | 24.0°S, 133.0°E (arid continental interior) |
| Branches | ground (45%), air (55%) |
| Base radius | 300 km |
| Base tempo | 0.35 events/day |
| Drift | none |
| Seasonality | tempo × 0.30 during December, January, February |
| Target preference | infrastructure 70%, remainder split evenly |

Southern hemisphere, so December–February is peak summer heat, which makes the suppression physically motivated rather than arbitrary. The air branch's 600 km range means DRYSTONE's events spread far wider than NORTHWIND's despite a similar static setup, so **range alone separates them without any temporal information**.

### 7.4 Shared vocabularies

```
methods:
  ground → ["explosive", "firearm", "melee"]        weights [0.55, 0.35, 0.10]
  naval  → ["explosive", "firearm", "vessel_ram"]   weights [0.40, 0.45, 0.15]
  air    → ["explosive", "incendiary"]              weights [0.70, 0.30]

target_type: ["infrastructure", "government", "commercial", "transport"]
```

### 7.5 Directives

| Directive | Radius × | Tempo × | Selection weight |
|---|---:|---:|---:|
| `EXPAND` | 1.5 | 1.2 | 0.35 |
| `CONSOLIDATE` | 0.6 | 1.0 | 0.45 |
| `SUPPRESS` | 1.0 | 0.3 | 0.20 |

Each organisation runs its own independent command layer. They do not coordinate with each other, and no global event affects all three simultaneously.

---

## 8. Data contracts

### 8.1 `events.csv`

One row per event. This is the only thing a model is allowed to see.

| Column | Type | Notes |
|---|---|---|
| `event_id` | integer | sequential from 1 |
| `date` | `YYYY-MM-DD` | |
| `lat` | float, 6 dp | |
| `lon` | float, 6 dp | |
| `org` | string | `NORTHWIND` \| `TIDEBREAK` \| `DRYSTONE` |
| `branch` | string | `ground` \| `naval` \| `air` |
| `method` | string | see §7.4 |
| `target_type` | string | see §7.4 |
| `success` | boolean | `true` / `false` |
| `casualties` | integer | ≥ 0 |

Column names deliberately echo the GTD fields used in phase 1 so the earlier notebooks can be pointed at this file with minimal edits.

### 8.2 `ground_truth.json`

The answer key. **No code in `analysis.js` may read this file except the scoring functions.** It exists to be compared against, never to be learned from.

```jsonc
{
  "seed": 20260903,
  "generated_at": "2026-09-03T00:00:00Z",
  "config": { /* full config snapshot, so the run can be recreated */ },
  "planted_signals": [
    { "level": 1, "org": "NORTHWIND", "type": "static_base",
      "params": { "lat": 46.0, "lon": 103.0, "radius_km": 80 } },
    { "level": 2, "org": "TIDEBREAK", "type": "linear_drift",
      "params": { "bearing": 90, "km_per_day": 0.5 } },
    { "level": 3, "org": "DRYSTONE", "type": "seasonal_suppression",
      "params": { "months": [12, 1, 2], "multiplier": 0.30 } },
    { "level": 3, "org": "DRYSTONE", "type": "target_preference",
      "params": { "target_type": "infrastructure", "share": 0.70 } }
  ],
  "directive_periods": [
    { "org": "TIDEBREAK", "directive": "EXPAND",
      "start": "2026-01-01", "end": "2026-03-14" }
  ],
  "event_provenance": {
    "1": { "org": "TIDEBREAK", "branch": "naval",
           "directive": "EXPAND", "attempts": 3 }
  }
}
```

`event_provenance` keyed by `event_id` is what makes per-event error analysis possible later.

---

## 9. Analysis engine (`analysis.js`)

### 9.1 Classifier

Implement k-nearest neighbours directly. It is roughly thirty lines and adding a dependency for it is not worth it.

- Default `k = 5`
- Distance: **haversine on the geographic pair**, plus scaled contributions from any non-geographic features included in the run
- Non-geographic features are min-max normalised to `[0, 1]` before entering the distance, and the geographic distance is likewise normalised by dividing by 20,000 km. Without this, a difference of one day and a difference of one kilometre would be weighted arbitrarily against each other
- Train/test split 80/20, **stratified by organisation**, seeded

### 9.2 Metrics

For every classification run, report all of:

- Overall accuracy
- **Majority-class baseline** (the floor) — mandatory, adjacent to accuracy everywhere it appears
- **Oracle ceiling** (§9.4) — mandatory, same placement
- **Recovered fraction** — `(accuracy − floor) / (ceiling − floor)`, expressed as a percentage. This is the number that actually says how well the model did
- Per-class precision, recall, F1
- Confusion matrix

The floor-and-ceiling requirement is not stylistic. Phase 1 reported 68% for months without noticing that 59.5% of it was free and that the reachable maximum was nowhere near 100%. The interface must make that mistake structurally impossible, which means an accuracy figure never appears without both bounds in the same visual group.

### 9.3 Ablation runs

| Run | Features | Target | Expected outcome |
|---|---|---|---|
| A | `lat`, `lon` | `org` | NORTHWIND and DRYSTONE separate; TIDEBREAK poor |
| B | `lat`, `lon`, `day_index` | `org` | TIDEBREAK recall rises sharply |
| C | `lat`, `lon`, `day_index`, `target_type`, `month` | `org` | DRYSTONE gains; total approaches ceiling |
| D | per-organisation time series | directive change points | see §9.6 |

The deliverable is **the deltas between runs**, not the individual numbers. Present them as such: the interface should show B−A per class, not just A and B side by side, because the difference is the finding and the reader should not have to compute it.

### 9.4 The ceiling (oracle classifier)

This is the piece that only synthetic data makes possible, and it is the direct answer to phase 1's central failure.

Phase 1 reported 68% accuracy with no way to know whether that was good. The majority-class baseline gives the floor — what you get for free. But nobody knew the **ceiling**: the best score any model could achieve, given that the organisations' territories genuinely overlap and some events are irreducibly ambiguous. An event sitting midway between two bases could plausibly have come from either, and no model, however good, can resolve it.

Because the generative rules are known exactly, that ceiling can be computed.

Implement an **oracle classifier** that has access to the true generative model:

```
oracleClassify(event):
  for each org:
    p(org) = probability this org's rules would produce an event
             at this location, on this date, with this branch/target
             — computed from the org's current base on that date,
               its effective radius under the active directive,
               its branch shares, and its seasonal factor
  return argmax over orgs
```

Its accuracy over the same test split is the ceiling. Every reported figure then sits between two known bounds:

```
majority baseline  59.5%  ←  free
model accuracy     68.0%
oracle ceiling     74.2%  ←  best physically possible
```

Read that way, a model is not scoring 68 out of 100. It is capturing **8.5 of the 14.7 points that were actually available**, or 58% of the recoverable signal. That is a completely different and far more useful statement, and phase 1 could not make it.

**The interface must display all three bounds together wherever accuracy appears.** Floor, achieved, ceiling. Accuracy alone is close to meaningless and this project exists partly to demonstrate that.

The oracle reads from the true parameters, so it lives in the scoring path alongside `ground_truth.json` access and must never be reachable from the modelling path.

### 9.5 Seed variance

A result from a single seed can be luck. The ablation therefore runs across **5 seeds** (the default plus four derived from it), and reports mean and range rather than a single number.

Triggered by an explicit **"Check across seeds"** action rather than automatically, since it re-runs the full simulation five times. Show progress. If the main thread blocks visibly, move simulation into a Web Worker.

Report the headline delta as e.g. `TIDEBREAK recall +34.2pp (range 29.8–38.1 across 5 seeds)`. A finding that survives five seeds is structural. One that does not should not be in the README.

### 9.6 Change-point detection

For each organisation independently, build two daily series over a 30-day sliding window:

1. event count
2. mean haversine distance from the organisation's base on that day

Compute a z-score of the change between consecutive windows for each series, sum them, and flag days where the combined score exceeds a threshold (start at 2.5, expose it as a slider).

Score detected change points against `directive_periods`:

- **Hit** — a detected point within ±10 days of a true directive change
- **Miss** — a true change with no detection in that window
- **False alarm** — a detection with no true change nearby

Report precision and recall over change points. Note in the UI that SUPPRESS→CONSOLIDATE transitions are the hardest, since both leave the radius near baseline and only the tempo moves.

---

## 10. Interface structure

Left rail navigation, persistent across views, holding four destinations plus a global seed/run control. This mirrors the sidebar pattern used elsewhere in this portfolio.

| View | Purpose |
|---|---|
| **Simulation** | Map, timeline, playback. The default view and the centrepiece |
| **Organizations** | Per-organisation configuration and live state |
| **Analysis** | Ablation results and change-point scoring |
| **Data** | Sortable event table, export buttons |

### 10.1 Guided first run

Most people who open this will be seeing it for the first time with no context, and will decide within about thirty seconds whether it is worth their attention. A tool that requires reading a README before it makes sense has already lost them.

On first load, run a short guided sequence — four steps, dismissible at any point, never shown again once completed (`localStorage`).

| Step | Anchored to | Says roughly |
|---|---|---|
| 1 | The map | These events were produced by three organisations following rules you cannot see |
| 2 | Playback control | Watch five years. One of them is moving |
| 3 | Reveal toggle | This shows the command decisions behind what you just watched |
| 4 | Analysis nav item | And this measures how much of it a model could work out on its own |

Each step is a small anchored card with a highlighted target and a Next control. Step 2 should start playback automatically at 30× so the drift is visible while the card is still on screen — the movement is the thing that makes the project click, and it should happen before any reading is required.

Provide a **Replay tour** control in the left rail so it can be triggered deliberately.

### 10.2 Shareable runs

Encode `seed` and any modified configuration into the URL hash, and restore from it on load. Opening a shared link reproduces that exact run.

This exists so that a specific configuration can be cited — the README can link to the precise run its numbers came from, and a reader lands on the same data rather than a default. Keep the encoding compact: omit anything matching the defaults so an unmodified run yields just the seed.

---

## 11. Simulation view

The most important screen. Roughly 70% map, 30% side panel, with a full-width timeline pinned to the bottom.

### 11.1 Map

A Canvas 2D world map in equirectangular projection, drawn from the same land mask used by the geography engine — land in a muted slate fill, water in the background colour, a one-pixel coastline in a slightly lighter tone. No labels, no graticule by default; a faint 30° graticule is **optional**.

Pan by dragging, zoom by wheel, clamped to sensible bounds. Zoom is a scale factor applied at draw time; the projection stays equirectangular throughout.

Layers, back to front:

1. **Basemap** — land, water, coastline
2. **Density layer** — toggleable, off by default. Kernel density of events within a trailing 180-day window, rendered as a soft additive glow in each organisation's colour, 30 px kernel radius. This is what makes TIDEBREAK's drift legible: with dots alone the movement is a slow scatter, but as a density blob it reads unmistakably as a hotspot sliding east across the chain. Recompute at most every 10 simulated days, not every frame
3. **Accumulated events** — every event up to `currentDay`, drawn as 2 px dots in the organisation's colour at 45% opacity
4. **Recent events** — events within the last 30 simulated days at full opacity and 3 px
5. **Event pulse** — an event on exactly `currentDay` emits a ring expanding from 4 px to 28 px while fading to zero over 700 ms
6. **Organisation markers** — base position as a 10 px diamond outlined in the organisation's colour
7. **Operating radius** — a dashed circle at the current effective radius, redrawn as it changes
8. **Drift trail** — TIDEBREAK's base path, drawn as a fading polyline behind its current position
9. **Truth overlay** — only when reveal mode is on, see §11.3

The radius circle is doing real work. When a directive flips to EXPAND the circle visibly swells, and that is the hidden command layer becoming momentarily visible. Animate the change over 400 ms with ease-out rather than snapping, so the eye catches it.

### 11.2 Timeline

Full width, ~80 px tall, pinned to the bottom.

- A horizontal band per organisation showing daily event counts as a sparkline-style histogram in the organisation's colour
- A draggable playhead spanning all bands
- Transport controls: play/pause, step ±1 day, ±30 days, speed selector (1×, 7×, 30× days per frame)
- Current date displayed prominently, always visible during playback
- Hovering anywhere on the timeline shows a tooltip with that date's per-organisation counts

When reveal mode is on, directive periods are painted as translucent bands behind each organisation's histogram, colour-coded by directive. This is the single most informative visual in the application: the viewer sees the event rate rise and fall, and directly behind it, the command decision that caused it.

### 11.3 Reveal mode

A prominent toggle labelled something like **"Reveal command layer"**, off by default.

Off, the user sees exactly what an analyst gets: events, dates, coordinates, organisation labels. On, three things appear: directive bands on the timeline, the true directive on each organisation card, and detected-versus-actual change point markers if the analysis has been run.

This toggle is the thesis of the project rendered as an interaction. Off is the problem, on is the answer key. Treat it as a feature, not a debug switch, and give it real visual weight.

### 11.4 Side panel

One card per organisation, each showing: name in its colour, a per-organisation visibility toggle, total events so far, current effective radius and tempo, and — in reveal mode only — the active directive with days remaining.

---

## 12. Organizations view

An editable form per organisation over the parameters in §7: base coordinates, branches owned, base radius, base tempo, drift bearing and rate, seasonal months and multiplier, target preference.

Editing invalidates the current simulation and shows a "Re-run required" state rather than silently leaving stale results on screen.

Include a **Reset to defaults** control. The defaults in §7 are the configuration the committed dataset was generated from, and users must always be able to get back to them.

A small preview map on this view shows base position and radius as the user edits, so the effect of a change is visible before running 1,826 days of simulation.

### 12.1 Signal strength

A separate panel, and the most important control surface in the application.

Each planted signal gets a slider running from `0` (absent) to `2.0` (double strength), defaulting to `1.0`:

| Signal | At 0 | At 1.0 (default) | At 2.0 |
|---|---|---|---|
| TIDEBREAK drift rate | stationary | 0.5 km/day | 1.0 km/day |
| DRYSTONE seasonality | no suppression | ×0.30 in summer | ×0.15 in summer |
| DRYSTONE target preference | uniform | 70% infrastructure | 95% infrastructure |
| Directive effect size | directives do nothing | radius ×1.5 / ×0.6 | radius ×2.0 / ×0.4 |

Below the sliders, a **"Sweep this signal"** action: re-runs the simulation and the ablation at strength `0, 0.25, 0.5, 1.0, 1.5, 2.0` and plots recovered fraction against signal strength.

That curve is the real output of this project. It answers a question that matters well beyond this dataset: **how strong does a pattern have to be before it becomes detectable, and where is the point below which no amount of modelling helps?** The floor and ceiling from §9.4 both appear on the same axes, so the reader sees the recovery curve rise off the floor, and where it flattens against the ceiling.

A sweep is six full simulation-plus-analysis cycles. Run it as an explicit action with a progress indicator, and cache results per configuration so re-opening the view does not recompute.

This is what separates an instrument from a demonstration. A demonstration shows one result. This lets someone ask their own question and get an answer the author never computed.

---

## 13. Analysis view

Runs the four experiments and presents results. Show a progress indicator; on a dataset of this size everything should complete in well under a second, but the state should still be modelled.

Layout, top to bottom:

1. **Headline delta panel** — the B−A comparison per organisation as a diverging bar chart. TIDEBREAK's bar should dominate. A one-line plain-language caption sits under it stating what the chart means, generated from the actual numbers rather than hardcoded
2. **Bounded accuracy display** — for each run, a horizontal track marked with the floor (majority baseline) and the ceiling (oracle), with the achieved accuracy plotted between them and the recovered fraction stated as a percentage. This replaces any bare accuracy readout. A model at 68% between a floor of 59.5% and a ceiling of 74.2% should visibly read as "well past halfway", not as "68 out of 100"
3. **Run comparison table** — one row per run, columns for features used, floor, accuracy, ceiling, and recovered fraction. The recovered-fraction column is the one that matters and should be visually emphasised over raw accuracy
4. **Seed variance** — mean and range across the five seeds (§9.5) for the headline metric, shown as a range bar. Present only after the user runs the check; before that, an inviting empty state rather than a blank space
5. **Confusion matrices** — one per run, as a small heatmap grid with counts in cells
6. **Per-class metrics** — grouped bar chart of precision and recall by organisation and run
7. **Signal strength sweep** — the recovery curve from §12.1 if a sweep has been run, with floor and ceiling drawn as horizontal reference lines
8. **Change-point results** — a timeline strip per organisation showing true changes as ticks above the axis and detected changes below, with hits joined by a connecting line. Precision and recall stated numerically alongside. The detection threshold slider sits here and re-scores live

Every accuracy figure anywhere in this view carries its floor and ceiling immediately adjacent, in the same visual grouping. Never render an accuracy number alone.

---

## 14. Data view

A virtualised table of all events — the row count is small enough that plain rendering is acceptable, but sorting and filtering must be responsive.

- Sortable on every column
- Filter by organisation, branch, method, target type, and date range
- Row count and active filter summary displayed above the table
- Two export buttons: `events.csv` and `ground_truth.json`, both triggering a client-side download via `Blob` and an object URL

**Do not offer a combined export.** Keeping the two files separate at every point in the interface reinforces the separation the method depends on.

---

## 15. Visual design

The reference genre is the geospatial monitoring console: flight trackers, seismic monitors, operations dashboards. Dark, dense, quiet. Colour is used to carry meaning, never for decoration.

### 15.1 Palette

```css
--bg:            #0B0F14;   /* app background */
--bg-panel:      #141A21;   /* cards, rails, panels */
--bg-elevated:   #1B232C;   /* hover, active rows */
--border:        #212B36;
--text:          #E6EDF3;
--text-muted:    #8B98A5;
--accent:        #4DD0E1;   /* interactive affordances, focus rings */

--land:          #263038;   /* map landmass fill */
--land-edge:     #38454F;   /* coastline stroke */

--org-northwind: #4FC3F7;   /* blue   */
--org-tidebreak: #FFB74D;   /* amber  */
--org-drystone:  #BA68C8;   /* purple */

--dir-expand:      #4DD0E1;
--dir-consolidate: #90A4AE;
--dir-suppress:    #F06292;
```

The three organisation colours are blue, amber and purple rather than the more obvious red/green/blue, because red-green pairs are the most common form of colour vision deficiency and organisation identity is load-bearing throughout this interface. Directive colours are chosen on the same basis.

Colour alone must never be the only carrier of meaning. Organisations are also distinguished by marker shape on the map (circle, square, triangle), and directive bands carry a text label wherever there is room.

### 15.2 Type and space

- System font stack; no web fonts, since they would be a network dependency
- Numeric readouts in a monospace stack, tabular figures, so digits do not jitter during playback
- Scale: 12 / 13 / 15 / 20 / 28 px. Body text 13 px, panel headings 15 px, view titles 20 px
- Spacing on a 4 px grid, panel padding 16 px, card gaps 12 px
- Border radius 6 px on cards, 4 px on controls

### 15.3 Motion

Motion carries information here; it is not ornament.

| Element | Behaviour | Duration |
|---|---|---|
| Event pulse | ring expands 4→28 px, opacity 0.9→0 | 700 ms, ease-out |
| Radius change | circle interpolates to new radius | 400 ms, ease-out |
| View transition | cross-fade | 150 ms |
| Panel value updates | no animation | — |

Numeric readouts must never animate or count up. During playback they change every frame, and animating them makes them unreadable.

Honour `prefers-reduced-motion`. When set, drop the pulse and radius animations to instant state changes and leave everything else functional.

### 15.4 Responsive behaviour

Desktop-first; this is an analysis tool. Below 900 px the side panel collapses under the map and the left rail becomes a top bar. Below 600 px, show the map and timeline only, with a notice that analysis views need a wider screen. Do not attempt to make the confusion matrices work on a phone.

---

## 16. Performance

| Operation | Budget |
|---|---|
| Land mask load and decode | < 300 ms |
| Full 1,826-day simulation | < 2 s |
| Map redraw during playback | 60 fps at 30× speed |
| Density layer recompute | < 80 ms, at most every 10 simulated days |
| Full ablation, all four runs | < 1 s |
| Oracle ceiling computation | < 500 ms |
| Seed variance check, 5 seeds | < 12 s, with progress |
| Signal strength sweep, 6 points | < 15 s, with progress |

The last three are deliberate user actions, so seconds are acceptable where they would not be during playback. But they must not freeze the interface. If a single-threaded implementation blocks the main thread for more than about 200 ms at a stretch, move simulation and analysis into a Web Worker and post progress back. Design the module boundaries with that possibility in mind from the start: keep `simulation.js` and `analysis.js` free of any DOM access so they can be moved into a worker without restructuring.

The map must not redraw the basemap every frame. Render land to an offscreen canvas once, then per frame blit it and draw only the dynamic layers. Accumulated events should likewise be drawn to their own offscreen buffer that is appended to rather than fully redrawn — at 3,000 events a naive full redraw per frame will be visibly slow at high playback speeds.

---

## 17. Acceptance criteria

The build is complete when all of the following hold.

1. Opening `index.html` directly from disk produces a working application with no console errors
2. Running twice with seed `20260903` produces byte-identical `events.csv`
3. Every event in `events.csv` satisfies its branch's terrain constraint — no ground or air event in open ocean, no naval event further than 30 km from land
4. TIDEBREAK's drift is present and of the right size, checked two ways:
   - base longitude at the last day minus the first day is **8.2°–8.4°**
   - mean event longitude in the final simulated year minus the first year is **at least 6°**

   The two numbers differ and both are correct. The base travels 0.5 km/day × 1,826 days = 913 km, and at latitude −8.5° one degree of longitude is about 110 km, so the base itself moves ≈8.3°. But events are scattered around the base *throughout* each year, so the first year's events average a base position around 91 km along the track and the final year's around 822 km — a difference of ≈6.6°, not 8.3°. An implementation that produces 8.3° on the second measurement has almost certainly leaked the base position into the events instead of sampling around it.
5. DRYSTONE's December–February event count is between 25% and 35% of its March–November monthly average
6. Run B's TIDEBREAK recall exceeds run A's by at least 20 percentage points
7. The oracle ceiling is strictly above every model accuracy, and strictly below 100%. A ceiling of 100% means the oracle is cheating — most likely reading a field that identifies the organisation directly rather than computing a probability from geometry
8. Every accuracy figure in the interface shows its floor and ceiling in the same view without scrolling
9. Setting the TIDEBREAK drift slider to 0 collapses the run B − run A delta to near zero, confirming the delta is caused by the planted signal and not by the extra feature itself
10. Reveal mode changes what is on screen in the map, the timeline and the organisation cards simultaneously
11. The guided tour runs on a fresh profile, does not reappear after completion, and can be replayed on demand
12. A shared URL restores the exact run it was generated from
13. Both export buttons produce valid, separately downloadable files
14. Playback runs at 30× speed without dropping below 60 fps on a mid-range laptop

Criteria 4, 5 and 9 are checks that the planted signals actually got planted and that the measured effects come from them. If they fail, the analysis results are meaningless regardless of how good they look, so verify them before trusting anything else.

Criterion 4 was originally written as "at least 7°" and a working prototype failed it at 6.64°. The simulation was right and the threshold was wrong — nobody had done the arithmetic above. Worth remembering when writing any acceptance number: **derive it, or measure it against something known to work, but do not guess it.** A wrong threshold sends the implementer hunting for a bug that is not there, or worse, tuning the simulation until it matches a number that never made sense.

Criterion 9 deserves particular attention. Adding a feature to a KNN changes the distance metric and can shift accuracy on its own, with no signal involved. Turning the drift off and confirming the delta disappears is what separates "the date column revealed the movement" from "adding a third dimension happened to help".

---

## 18. Remaining optional ideas

Everything else that seemed worth building has been promoted into the specification above. What is left is genuinely discretionary.

- **Model comparison** — add naive Bayes or a decision tree alongside KNN. The argument for it is that a delta appearing in two unrelated model families is structural rather than an artefact of KNN's distance metric. The argument against is that this project asks which *data* is needed, not which *model* is best, and adding models invites the reader to compare the wrong axis. If it is built, present it as a robustness check, not as a leaderboard
- **Per-event error inspection** — click a misclassified point on the map and see its `event_provenance` entry alongside what the model predicted. Useful for debugging, and it makes the ambiguous-overlap region tangible
- **Export the analysis report** — a self-contained HTML summary of the current run's numbers and charts

---

## 19. Non-goals

- Any claim about real-world terrorism, conflict or geopolitics. The simulation reproduces only the rules written into it
- Modelling real organisations, real incidents or real places. Coordinates are terrain anchors and nothing more
- Server-side anything
- Authentication, multi-user state, or persistence beyond local settings
- Deep learning. Small models make the measurement legible, which is the entire point
