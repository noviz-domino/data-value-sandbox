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

- **M1 — map & simulation view** ← current. deck.gl + Natural Earth replacement for the prototype: world map, 5-year playback, org markers + radius, drift, reveal toggle, timeline, activity feed. No analysis views.
- M2 — analysis view: ablation runs, floor/ceiling, confusion matrices.
- M3 — organizations view + signal-strength sliders + sweep.
- M4 — data view + export, guided tour, density layer, seed variance.

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
- [ ] committed

### T1 — geography data (Sonnet author → reviewer)
- [ ] fetch `ne_50m_land`, `ne_50m_coastline`, `ne_110m_land` as GeoJSON from `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/` into `phase2/app/data/`
- [ ] confirm each file < 20 MB (they are; 50m land is a few MB); report exact sizes
- [ ] sanity-check: valid GeoJSON, FeatureCollection, non-empty
- [ ] reviewed, committed

### T2 — core logic: rng.js, geo.js, organizations.js, simulation.js (Sonnet author → reviewer)
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

### T3 — deck.gl map (Sonnet author → reviewer)
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

### T4 — UI shell + timeline (Sonnet author → reviewer)
Adapt the prototype's `index.html` + CSS (already designed and validated): status bar, left rail, side org-cards + activity feed, bottom timeline, reveal toggle, transport controls, zoom buttons, boot sequence. Swap the `<canvas id="map">` for the deck.gl container. `timeline.js` keeps the Canvas timeline (bands per org, playhead, directive bands on reveal, with the `CONS/EXPA/SUPP` labels already tuned).
- [ ] shell + timeline match prototype's look; charset meta present; `<meta charset="utf-8">` included
- [ ] reviewed, committed

### T5 — wiring: main.js (Sonnet author → reviewer)
State object (SPEC §4), playback loop, control handlers, reveal, org visibility, zoom presets. Loads the three GeoJSON files, builds the land test from ne_110m, runs `simulate`, drives `map.setFrame` + timeline each frame.
- [ ] full app runs end to end via local server
- [ ] reviewed, committed

### T6 — architect final review (Opus)
- [ ] cross-module integ check, acceptance re-run, screenshot via capture-server, prototype-vs-app parity, DEVLOG entry, commit
- [ ] report M1 to user

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
