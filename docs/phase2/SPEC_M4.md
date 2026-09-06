# SPEC — M4: language toggle, organisations view, data view, guided run

Implementation spec for milestone 4. Read `SPEC.md` §12, §14 and §10.1 for the original intent, and `SPEC_M3.md` for the inference engine this builds on. Numbers here are **decisions**, not suggestions.

## 1. Language toggle (KO / EN)

### 1.1 Why this replaces the gloss approach

M3 shipped screen text in English with short Korean glosses in parentheses — `floor (무작위 기준선)`, `detection (탐지율)`. In use it reads badly: two languages on one line means neither is read, and the HUD's dense layout has no room for it. **That approach is superseded. Remove every inline parenthetical gloss.**

Instead the interface has two complete versions and a toggle.

### 1.2 What translates and what does not

| Translated | Left in English, always |
|---|---|
| Labels, headings, buttons, warnings, tooltips, tour copy, units where a word is used | **Dataset values**: organisation names (`NORTHWIND`), `branch` (`ground`/`naval`/`air`), `method` (`explosive`…), `target` (`infrastructure`…), facility ids and kinds (`PWR-021`, `power_plant`), directive names (`EXPAND`) |

Dataset values are the data itself — they appear in the exported CSV, in `ground_truth.json`, and in every screenshot used for comparison. Translating them would desynchronise the interface from the files it produces. Column *headers* translate; column *contents* do not.

### 1.3 Default and persistence

- Default: Korean when `navigator.language` starts with `ko`, otherwise English.
- An explicit choice persists in `localStorage` under `gtc.lang` and wins over the browser default.
- Wrap every `localStorage` access in `try/catch` — it throws outright in some embedded contexts.

### 1.4 Module — `phase2/app/js/i18n.js`

```js
export function register(dict)        // { ko: {key: string}, en: {key: string} } — merged into the table
export function t(key, vars)          // vars interpolate as {name}; missing key returns the key itself
export function getLang()             // 'ko' | 'en'
export function setLang(lang)         // persists and notifies subscribers
export function onLangChange(cb)      // returns an unsubscribe function
```

**Each module registers its own strings** — define them next to the code that uses them and call `register()` at import time. Do **not** create one shared dictionary file: several people edit these modules independently, and a single file is a guaranteed conflict. Namespace keys by module (`res.title`, `org.reset`, `dat.export`).

A missing key must render the key itself, never blank, and never throw. Log missing keys once each to the console in development.

### 1.5 Re-rendering

Every view subscribes via `onLangChange` and re-renders in place. Switching language must not reset simulation state, the time window, the scope circle, the selected candidate, or scroll position. Nothing recomputes: language is presentation only, and switching it must never re-run a simulation.

### 1.6 The control

A `KO / EN` segmented control in the top status bar, right-aligned near the existing `HOLD` indicator. Two short labels, the active one using the lead accent. Both labels always read as themselves (`한국어` / `English`) so it is usable in either state.

Korean rendering already has a font fallback in `css/style.css`; do not remove it.

## 2. Organisations view (`#view-org`) — SPEC.md §12

Currently a placeholder. Build the editable configuration surface.

### 2.1 Per-organisation form

One card per organisation over the §7 parameters: base coordinates, branches and their shares, base radius, base tempo, drift bearing and rate, seasonal months and multiplier, target preference.

- Editing marks the state **stale**: show a `Re-run required` banner and visibly dim the dependent views rather than leaving stale numbers on screen looking current. **A stale number presented as current is the failure this whole project is about.**
- A **Reset to defaults** control. The §7 defaults are what the committed dataset and every published number came from, so returning to them must always be one click.
- A small preview map showing base position and radius as the user edits, so the effect is visible before committing to a 1,826-day run.

### 2.2 Signal strength sliders — SPEC.md §12.1

The most important control surface in the application. Each planted signal gets a slider from `0` (absent) to `2.0` (double), defaulting to `1.0`:

| Signal | 0 | 1.0 | 2.0 |
|---|---|---|---|
| TIDEBREAK drift rate | stationary | 0.5 km/day | 1.0 km/day |
| DRYSTONE seasonality | none | ×0.30 | ×0.15 |
| DRYSTONE target preference | uniform | 70% infrastructure | 95% infrastructure |
| Directive effect size | none | radius ×1.5 / ×0.6 | ×2.0 / ×0.4 |
| **Noise ratio** (new in M4) | 0% background | **80% background** | 95% background |

The noise-ratio slider is the M3 addition and belongs here: it asks *at what noise level does target inference stop working?* — the question the 80/20 split was built to make askable.

### 2.3 Sweep

A **Sweep this signal** action re-runs simulation + analysis at strengths `0, 0.25, 0.5, 1.0, 1.5, 2.0` and plots the result against signal strength. Plot two curves on the same axes:

- **M2 recovered fraction** `(accuracy − floor) / (ceiling − floor)`, with floor and ceiling drawn as horizontal references
- **M3 top-1 target-inference rate**, with its scope-relative floor drawn as a reference

Six full cycles is expensive. **Use a single seed for the sweep** (the current seed), not the 5-seed pooling M3's headline uses — and label the chart with that, because a single-seed curve is noisier than the headline figures and the reader must not read them as equivalent. Run it as an explicit action with a progress indicator, and cache results per configuration.

This curve is the project's real output: **how strong must a pattern be before it becomes detectable, and below what strength does no amount of modelling help?**

## 3. Data view (`#view-dat`) — SPEC.md §14

Currently a placeholder.

- Table of all events, sortable on every column, filterable by organisation, branch, method, target and date range.
- Row count and an active-filter summary above the table.
- Rendering may be plain (row counts are ~3,000) but sorting and filtering must stay responsive; if a filter pass exceeds ~100 ms, memoise it.
- Two export buttons producing client-side downloads via `Blob` + object URL: **`events.csv`** and **`ground_truth.json`**.

**Do not offer a combined export.** Keeping the two files separate everywhere in the interface reinforces the separation the entire method depends on. Put a one-line note by the buttons saying which one is the answer key and that models must never read it.

CSV columns, in this order, matching the event schema: `id,day,date,lat,lon,org,branch,method,target,success,casualties`. `date` is the ISO date derived from `day` and the run's `startDate`. Quote nothing that does not need quoting; use `\n` line endings.

`ground_truth.json` contains `{ seed, days, startDate, organisations, directives, periods, campaigns, facilities }` — everything a scorer needs and a model must not see.

## 4. Guided first run — SPEC.md §10.1

Four steps, dismissible at any point, shown once and then never again (`localStorage` key `gtc.tour`). Anchored to real elements, with a highlight and a short line of copy. Translated like everything else.

| Step | Anchor | Says |
|---|---|---|
| 1 | The map | These events came from three organisations following rules you cannot see |
| 2 | Playback + time window | Watch five years. One of them is moving |
| 3 | Reveal toggle | This shows the command decisions behind what you just watched |
| 4 | Scope + results panel | Pick a region: which facility are these incidents preparing against? |

Add a small **restart tour** affordance somewhere unobtrusive, so a returning visitor (and the author, demonstrating it) can replay it without clearing storage.

## 5. Constraints that do not change

- Ground-truth separation (`SPEC_M3.md` §3) applies to everything here. The data view may *display* ground truth and export it as a separate file; nothing in the inference path may read it.
- Determinism: no `Math.random`, seeded RNG only.
- No new dependencies, no runtime network calls; deck.gl stays vendored.
- Colours only from `palette.js` / CSS custom properties. Code comments in Korean.
- Both self-tests must keep passing unchanged.
