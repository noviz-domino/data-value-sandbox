# SPEC — M3: Target inference

Implementation spec for milestone 3. Read `SPEC.md` first for the project's premise and conventions; this document only covers what M3 adds and changes. Every number here is a **decision**, not a suggestion — do not re-derive them.

## 1. What changes, and why

M2 asked *"which organisation produced this event?"*. That is attribution, and it needs a label the real world does not supply.

M3 asks the question an analyst actually asks: **"these scattered incidents — what are they preparing against?"**

The premise: an operation against a facility does not begin by attacking that facility. It begins with enabling actions *around* it — road incidents on the approaches, power interruptions in the district, communications faults. The facility itself is never touched in the observable data. The target must be **inferred from the shape of the surrounding activity**.

Two properties make this a real problem rather than a toy:

1. **Most events are unrelated.** 80% of the data is background activity with no campaign behind it. A method that cannot ignore noise is useless, and only a known-noise dataset lets us count false alarms.
2. **Noise also clusters near facilities**, because that is where people are. If noise were uniform, "activity near a facility" would trivially mean "target", and the exercise would prove nothing.

### 1.1 The three recoverable signals

Campaign events are placed so that exactly three signals exist, in increasing order of how much data they require. This mirrors the M2 ablation ladder deliberately.

| Signal | What it is | Feature needed |
|---|---|---|
| **Proximity** | events fall in a ring around the target | coordinates |
| **Encirclement** | bearings spread around the target rather than lying to one side | coordinates |
| **Convergence** | events move *closer* to the target as the campaign progresses | coordinates + **date** |

Convergence is the strongest signal and is invisible without dates. The expected result is a ladder: proximity alone is weak (noise also clusters), + encirclement helps, + convergence resolves it. If the built system does not show that ladder, something is wrong — report it rather than tuning numbers until it appears.

## 2. Candidate facilities

Already built: `phase2/app/data/facilities.json` (160 facilities, 10.6 KB). Do not regenerate it.

```json
{
  "note": "...", "source": "OpenStreetMap contributors, ODbL", "bbox": [-10, 112, -7, 125],
  "facilities": [ { "kind": "power_plant", "lat": -8.1234, "lon": 114.5678, "id": "PWR-001" } ]
}
```

- `kind` ∈ `power_plant` (102) | `port` (25) | `airport` (33)
- `id` is synthetic (`PWR-001`, `PRT-001`, `AIR-001`). **Real facility names are deliberately withheld and must never be added.** Locations are real so that placement is realistic; names are omitted so a screenshot cannot read as a target list for real infrastructure.

A random guess among 160 candidates is **0.63% (top-1)** and **3.1% (top-5)**. Those are the floors.

## 3. Ground truth separation — non-negotiable

Same rule as the rest of the project, restated because M3 makes it easy to violate:

- **The inference engine may not read `campaigns`, `noiseEventIds`, or an event's `org`/`campaignId`.** Only scoring functions may.
- The inference engine receives events through `projectForInference()` (§5.1), which **strips** `org` and any campaign markers. Attribution is not given — deciding which events belong together is part of the problem.
- If a feature list ever contains a value derived from ground truth, the whole result is void.

## 4. Simulator extension

### 4.1 Backwards compatibility — do not break M2

`simulate()` currently returns `{ events, periods, byDay, days, startDate }` with events shaped
`{ id, day, lat, lon, org, branch, method, target, success, casualties }`.

Extend the signature:

```js
simulate({ seed, landTest, facilities = null, withCampaigns = false })
```

- `withCampaigns === false` (default) → **behaviour identical to today, byte for byte.** M2's ablation and `_analysis_selftest.mjs` must keep passing unchanged. Verify this explicitly.
- `withCampaigns === true` → campaign events are **added** to the existing output, and the return value gains `campaigns` and `facilities`.

The existing org/branch/directive machinery becomes the **background (noise) generator**. Campaign events are layered on top. Nothing about the existing generator changes.

### 4.2 Campaign schedule

Per organisation, over the 1826-day span:

- A campaign starts every **100 days** (first at day 40, jittered ±15 days by the seeded RNG).
- Campaign duration: **60 days**.
- Preparatory events per campaign: **12** (jitter ±3).

That yields ~18 campaigns per org, ~54 total, ~648 campaign events against ~2602 background events — a **20% signal / 80% noise** split, as specified.

Campaigns from different organisations **overlap in time and may target facilities near each other**. This is required: simultaneous campaigns are what make the "which events belong together" step a genuine problem.

### 4.3 Target selection

The organisation picks one facility per campaign, uniformly at random among facilities within **150 km** of the org's base. If fewer than 3 candidates are in range, widen to 300 km. Record the choice in ground truth only.

### 4.4 Preparatory event placement — the core rule

For a campaign with target `T`, for the *k*-th of `n` events, let progress `p = k / (n - 1)` ∈ [0, 1]:

- **Day**: `startDay + round(p * 60)`, jittered ±3 days, clamped to the campaign window.
- **Bearing**: uniform 0–360°. Uniform bearing is what produces encirclement — do not bias it.
- **Distance from T**: linearly interpolate the ring radius from **28 km at p=0** down to **4 km at p=1**, then multiply by a jitter factor drawn uniformly from **[0.75, 1.25]**.

```
radius(p) = (28 + (4 - 28) * p) * uniform(0.75, 1.25)
```

Reject and redraw (max 40 attempts) if the point is not on land, exactly as the existing `placeEvent` loop does. If all attempts fail, skip that event.

**The target facility itself is never the site of an event.** Enforce a minimum distance of 1.5 km from `T`.

### 4.5 Preparatory event attributes

Campaign events must be **indistinguishable in schema** from background events — same fields, no marker. Only ground truth knows.

- `org` — the owning organisation (ground truth uses it; inference never sees it)
- `branch` — `"ground"`
- `method` — weighted pick: `explosive` 0.5, `firearm` 0.3, `incendiary` 0.2
- `target` — weighted by the facility kind, because enabling actions hit what surrounds the facility:

| Facility kind | `target` weights |
|---|---|
| `power_plant` | `infrastructure` 0.55, `transport` 0.25, `commercial` 0.20 |
| `port` | `transport` 0.50, `infrastructure` 0.30, `commercial` 0.20 |
| `airport` | `transport` 0.55, `infrastructure` 0.25, `government` 0.20 |

This is a genuine but weak signal: it narrows the *kind* of facility, never the individual one.

- `success` — `rng() < 0.72`, same as background (deliberately signal-free)
- `casualties` — same exponential draw as background

### 4.6 Ground truth output

```js
campaigns: [
  { id: 0, org: "TIDEBREAK", targetId: "PWR-042", startDay: 340, endDay: 400, eventIds: [1204, 1233, ...] }
]
```

Every event id in the run belongs either to exactly one campaign's `eventIds` or to none (background). Do not add a `noiseEventIds` array — "not in any campaign" is the definition, and a second list can drift out of sync.

## 5. Inference engine — `phase2/app/js/inference.js`

Pure functions, no DOM, no imports from view code. Deterministic.

### 5.1 Scoping

```js
projectForInference(events)
// -> events with `org` removed. Use this at the boundary; never pass raw events in.

scopeEvents(events, { lat, lon, radiusKm }, { startDay, endDay })
// -> events inside the circle AND the day window (both inclusive)

scopeFacilities(facilities, { lat, lon, radiusKm })
// -> facilities inside the circle
```

Use haversine for all distances. Never Euclidean on lat/lon.

### 5.2 Scoring

```js
inferTargets({ events, facilities, features })
// features: { proximity: true, encirclement: bool, convergence: bool }
// -> { ranked: [{ facilityId, score, prob }], eventCount, warnings: [] }
```

For each candidate facility `F`, over the scoped events:

**Proximity** (always on). For each event at distance `d` km from `F`:
```
w = exp(-((d - 14) ** 2) / (2 * 11 ** 2))     // ring kernel: peaks at 14 km, sigma 11
```
Sum over events. The kernel peaks at the middle of the campaign ring band (4–28 km) rather than at 0, because a real campaign leaves a hole at the target itself. This is what separates a campaign from an ordinary cluster of incidents sitting on top of a facility.

**Encirclement** (optional). Take the events with `w > 0.15` (the ones actually in the band). Compute the mean resultant length `R` of their bearings from `F` (circular statistics: `R = hypot(mean(cos θ), mean(sin θ))`, 0 = evenly spread, 1 = all one direction). Multiply the proximity sum by `(1.4 - R)`. Fewer than 4 in-band events → factor 1.0 (not enough to judge spread).

**Convergence** (optional). Over in-band events, compute the Pearson correlation `r` between event `day` and distance to `F`. Converging campaigns give strongly negative `r`. Multiply by `(1 + max(0, -r) * 1.8)`. Fewer than 5 in-band events → factor 1.0.

Convert scores to display probabilities with a softmax over `score / temperature`, where
`temperature = max(0.35 * stdev(scores), 0.05 * mean(scores), epsilon)` and the exponent is clamped to
±30 before exponentiating.

**Do not use `0.35 * mean(scores)`.** That was the first draft and it saturates: when one candidate
dominates, the exponent explodes and the top probability becomes exactly `1.0` in floating point.
Measured, **30% of pure-noise control windows reported ~100% confidence** that way. Scaling by spread
instead of mean, and clamping, keeps the probability a usable display value.

A softmax probability answers "how far ahead is first place?", **not** "how strong is the evidence?".
Three events huddled near one facility produce the same 99% as three hundred. It is therefore fine for
display and unfit as a detection statistic — see §5.3.

**Warnings** (surface these; they are part of the product):
- `eventCount < 25` → `"too few events in scope for a reliable estimate"`
- top-1 probability `< 0.15` → `"no candidate stands out"`

### 5.3 Evaluation — `evaluateInference(...)`

```js
evaluateInference({ simulateFn, seed, seeds = 5 })
// -> { runs: { P:{...}, PE:{...}, PEC:{...} }, campaignsEvaluated, meanCandidatesInScope }
```

Three feature sets, matching the ladder: `P` proximity only, `PE` + encirclement, `PEC` + convergence.

**Scope radius is 160 km.** This was 60 km in the first draft and it was wrong: at 60 km only **3.9 candidate facilities** fall inside the scope on average, so "pick the right one" was a 1-in-4 question wearing a 1-in-69 costume. At 160 km about **9.2** candidates compete and the campaign's own events are ~18% of what is in scope — close to the global 20/80 signal ratio, so the method has to actually reject noise.

**The floor is scope-relative.** A candidate set that varies per window cannot be scored against a global `1/69`. For each evaluation window compute `1 / (candidates in scope)`, and report the mean of those. At 160 km this is ≈ 10.9%, not 1.45%. **Reporting a global floor here would repeat exactly the phase-1 error this project exists to correct** — an accuracy number with no honest baseline beside it.

`top5` is reported but is **not a headline**: with ~9 candidates its floor is ~55%, so it carries little information. Always print a metric next to its own floor; a metric whose floor is near 100% must be visibly marked as vacuous rather than quietly dropped.

**Hit rate.** For each campaign, scope to 160 km centred on the *centroid of that campaign's events* (not on the target — the analyst does not know it), over the campaign's day window widened by ±10 days. Record whether the true `targetId` ranks 1st, and its rank.

**Detection vs false alarm — calibrate on a standout score, never on the probability.** A fixed
`probability > 0.35` cut is meaningless when the candidate count varies. Calibrating a percentile on
the softmax probability is *worse*: it was tried, and it degenerated to a 0% detection rate for every
feature set, because ~30% of noise windows saturate at probability 1.0 and drag the 90th percentile to
`0.99999999999999`, above every genuine campaign. The metric must be built on a statistic that cannot
saturate.

Use the **standout score**: for a window, over the candidates in scope,

```
z = (topScore - mean(scores)) / stdev(scores)      // 0 if stdev is 0 or fewer than 3 candidates
```

`z` asks how far the leader stands out from its own peer group. It is scale-free, bounded by
`sqrt(n-1)`, and does not saturate. Then:

1. Draw **40 seeded control windows** per seed, built by **the same construction as campaign windows**:
   pick a random 80-day span; pick a random background event (one in no campaign) inside it; take the
   **12 background events nearest that event** within the span and use their **centroid** as the scope
   centre; radius 160 km. Reject any window that overlaps a real campaign in both space (within 160 km of
   that campaign's centroid) and time.

   **Do not centre control windows on a facility.** That was the earlier draft and it made the comparison
   unfair: a facility sitting at the exact centre of its own scope, surrounded by the background clustering
   §1.1 deliberately puts near facilities, gets a standout score no off-centre true target can match. The
   measured consequence was a control-`z` distribution sitting *above* the campaign-`z` distribution for
   every feature set (control p50 1.89 vs campaign p50 1.37–1.76), which made the 10%-FAR bar unreachable
   by construction rather than by any weakness of the method. Positive and negative windows must be drawn
   by the same rule and differ only in whether a campaign is present.

   Report **mean events in scope for control and campaign windows side by side**. If they differ by more
   than ~20%, the two window types are still not comparable and the detection number is not trustworthy —
   say so rather than reporting it.
2. Pool the control windows' `z` values; the **90th percentile** is the operating threshold — the point
   at which false alarms are held to **10%**.
3. Report **detection rate at 10% false-alarm rate**: the share of true campaigns whose `z` clears that
   threshold *and* whose top-1 is the true target.

Report the threshold itself and the two `z` distributions (control vs campaign) as summary statistics,
so a degenerate calibration is visible immediately instead of hiding behind a single 0%.

This is the operating point an analyst actually cares about, and it is why the noise exists at all. A method that names a target in every quiet window is useless no matter how good its hit rate looks.

**Pool across seeds.** One seed yields 54 campaigns, so the standard error on a rate is ~6.8pp — too coarse to call a 7pp difference real. Run **5 seeds** (the given seed plus four derived from it), pool the campaigns and control windows, and report mean and range. Assertions are made on the pooled numbers.

### 5.4 Self-test — `phase2/app/js/_inference_selftest.mjs`

Node script, same style as `_analysis_selftest.mjs`. Must assert:

1. `withCampaigns: false` reproduces the M2 event count and the M2 ablation result.
2. Campaign share is 18–22% of all events.
3. Every campaign's `eventIds` are disjoint and all exist.
4. No campaign event lies within 1.5 km of its target.
5. `PEC.top1` is at least **2× the scope-relative floor**.
6. `PEC.top1 - P.top1 >= 8pp` on the pooled 5-seed result (pooled SE is ~3pp, so 8pp is a real difference rather than sampling noise).
7. `PEC` detection-rate-at-10%-FAR exceeds `P`'s, and the calibration is **non-degenerate**: the
   control-window `z` distribution must not be concentrated at its maximum (report its 50th/90th/99th
   percentiles). A 0% detection rate across all feature sets is a broken metric, not a result — say so.
8. Determinism: two runs with the same seed give identical rankings.

**Encirclement carries no pass/fail assertion.** Measurement so far shows it changes nothing (`PE.top1 == P.top1` exactly), and a null result is a finding to report, not a defect to tune away. Print its effect and let the numbers speak. If it stays flat, the honest conclusion is that bearing spread is not a usable signal in this geography — say so in the output.

Print the full table: feature set × top1 × scope floor × lift × top5 (with its floor) × detection@10%FAR × mean candidates in scope, with the across-seed range.

**If a threshold fails, report the real numbers — do not tune the generator or the constants to clear the bar.** A failing ladder is a finding.
## 6. Interface changes

### 6.1 Time window replaces the timeline bar

The per-day activity bar assumed a fixed, fully-known dataset. Real sources (ACLED updates weekly; a future version reads a database) do not work that way.

Replace it with a **time window control**:
- Two numeric day inputs (start / end) plus a draggable window on a slim day axis.
- **Default: the most recent 100 days** of the simulated span.
- Playback slides the *window*, it does not reveal a fixed timeline.

### 6.2 Data access must go through a query function

Do not let views index the events array directly. Introduce:

```js
queryEvents({ scope, window })   // -> events
```

Today it filters an in-memory array. Later it becomes a database call. Views must not care which. This is the whole reason the timeline bar is being removed — keep the seam clean.

### 6.3 Scope selection

- Click a point on the map, then drag outward to set a radius (live circle preview).
- A numeric radius input as the precise alternative. Default **60 km**.
- Show the scoped event count live, with the §5.2 warnings.

### 6.4 Results panel

Ranked candidates with probability bars, facility id and kind, distance from scope centre. Show the floor (0.63%) alongside, so a 40% result is legible as "64× better than guessing". Selecting a candidate highlights it on the map and draws the in-band events that support it.

Show the false-alarm rate from the last evaluation, and both warnings when they fire. **A confident-looking ranking with 12 events behind it must not look the same as one with 300.**

## 7. Visual language

Keep the existing dark tactical HUD, but fix the two things that make it tiring: near-black backgrounds and too many competing glows.

- **6 : 3 : 1** — 60% deep background, 30% panel/surface mid-tones, 10% accent.
- Background is **deep blue-grey, not pure black** (`#0B1017`-ish). Panels one step lighter.
- **One accent colour leads** (the existing cyan). Amber and red are reserved for warnings and alarms — if everything glows, nothing reads as urgent.
- Body text is **off-white, not pure white** (`#C9D4DF`-ish); pure white on near-black glares.
- Maintain **≥ 4.5:1** contrast for body text, ≥ 3:1 for large text and UI borders.
- Facility markers are a distinct shape from event dots (events are dots; facilities are hollow squares) so the two layers never read as one.

Define these as CSS custom properties in one place; do not scatter literal colours through the modules.

## 8. Out of scope for M3

- Real GTD/ACLED ingestion. M3 builds the **structure**; the production dataset is generated separately later. Keep volumes at test scale.
- Facility name resolution (deliberately never).
- Multi-seed variance for inference (M4).
