# Project plan — phase 2: planted-signal simulator

Started September 2026. Solo work. Separate from the April course project, which is documented in [PLAN.md](PLAN.md).

## Why there is a phase 2

Phase 1 ended at a wall with two bricks in it.

The first was the data. GTD records attacks that happened and nothing else. With no negative examples there is no way to train "will something happen here", which was the whole point of the assignment. The second was measurement. The model scored 68% and I had no way to tell whether that was good, because nobody knows what the ceiling is on real terrorism data. It turned out that guessing the majority class gets 59.5%, so the real gain was 8.5 points, but even that comparison only tells me the model beat a coin — it does not tell me what the model *should* have been able to find.

Both problems come from the same place: **I did not know the answer, so I could not grade the work.**

Phase 2 removes that by generating the data myself. If I write the rules that produce the events, I know exactly what structure is in there, and I can ask a much sharper question than "is 68% good".

## The question this phase actually asks

**Which data do you need to collect before prediction becomes possible?**

That is the useful version of the original brief. A simulation that predicts a group's next move needs specific inputs, and the interesting engineering question is which ones actually carry the signal and which ones are decoration. Real data cannot answer that, because you can never separate "the feature was useless" from "the signal was not there to begin with".

Synthetic data can. I plant a known structure, hand the model different subsets of the columns, and watch which subsets recover it.

## Method: planted-signal recovery

The design principle is that **the planted signals must vary in difficulty**. If everything is trivially learnable the experiment says nothing, and the same is true if nothing is learnable. So the generator plants four kinds of structure, each requiring strictly more information to detect than the last.

| Level | Planted structure | Minimum columns needed to recover it |
|---|---|---|
| 1 | Each organisation operates near a fixed base | `lat`, `lon` |
| 2 | One organisation's centre of activity migrates over time | `lat`, `lon`, `date` |
| 3 | Seasonal suppression and target-type preference | `+ target_type`, `month` |
| 4 | Command directives that change unit behaviour in bursts | all of the above, per `org` |

Level 1 is deliberately the same shape as the phase 1 experiment — classify from coordinates alone. That gives a direct point of comparison between the two phases, on data where I know the answer.

Level 4 is the one that points at the original goal. If a commander switches from consolidation to expansion on a given date and I can detect that switch from the event log alone, that is the same operation as "work out what this group is about to do" — just with an answer key to check against.

## Architecture

Three layers. Only the bottom one is visible in the output.

| Layer | Decides | Recorded in |
|---|---|---|
| Command | The current directive, changed every 60–180 days | `ground_truth.json` (hidden) |
| Branch | How the directive translates into its own operating domain | `ground_truth.json` (hidden) |
| Unit | The actual location, method and target of a single event | `events.csv` (visible) |

An analyst looking at `events.csv` sees only the third layer, which is the realistic situation. You observe what happened. You do not get handed the intent behind it. Recovering the hidden layers from the visible one is the task.

### Branches as terrain constraints

The three branches are ground, naval and air. They are not decoration — each one restricts where events can occur, which is what makes coordinates carry real information rather than being arbitrary numbers.

| Branch | Constraint | Operating radius from base |
|---|---|---|
| Ground | Land only | 80 km |
| Naval | Within 30 km of a coastline | 250 km along coast |
| Air | No terrain constraint | 600 km |

An organisation without a naval branch simply cannot produce coastal events far from its base, and that absence is itself a learnable pattern.

## Organisations

Three, all invented. Three is the smallest number that makes classification a real multi-class problem, and the largest number whose rules I can hand-design and verify one by one.

Base coordinates are real Earth positions, chosen only for their terrain properties — distance to coastline, land type, sparseness. They carry no claim about those places and are not modelled on any real group or event.

### NORTHWIND — inland steppe, ground only

Base near 46.0°N 103.0°E, roughly 1,500 km from any coast.

Fixed base for the whole period, events scattered within its ground radius, steady tempo of about one event every four days. This organisation is the control. Its pattern is pure level-1 signal and a coordinate-only model should handle it well. If a model cannot classify NORTHWIND, something is wrong with the model rather than with the data.

### TIDEBREAK — island chain, ground and naval

Base starts near 8.5°S 116.0°E and migrates east along the chain at about 15 km per month, roughly 900 km over five years.

This is the level-2 signal. A model given only coordinates sees TIDEBREAK's events smeared across the entire chain and will confuse them with everything else in the region. Give the same model the date and the smear resolves into a line. The size of that improvement is the main number this phase produces.

### DRYSTONE — arid continental interior, ground and air

Base near 24.0°S 133.0°E.

Two planted rules. Activity drops by about 70% during December through February. And 70% of its events target infrastructure, against a roughly even split for the other two. The air branch gives it a 600 km reach, so its events spread much wider than NORTHWIND's despite a similar base setup — which means range alone distinguishes them without any temporal information.

## Command directives

Each organisation has its own command layer. Every 60–180 days it switches between three directives:

| Directive | Effect on that organisation |
|---|---|
| EXPAND | operating radius ×1.5, tempo ×1.2 |
| CONSOLIDATE | operating radius ×0.6, tempo ×1.0 |
| SUPPRESS | tempo ×0.3, radius unchanged |

These produce the level-4 signal. The observable consequence is that the spread and frequency of an organisation's events shift abruptly at dates the analyst does not know. Detecting those change points, and then labelling which directive each period was under, is the hardest task in the set and the closest thing here to the original goal.

## Output

Two files, and the separation between them is the part that must not be violated.

**`data/events.csv`** — what the model sees.

```
date, lat, lon, org, branch, method, target_type, success, casualties
```

Same shape as the GTD columns used in phase 1, so the phase 1 preprocessing and KNN code can be pointed at it with almost no changes.

**`data/ground_truth.json`** — the answer key.

Contains the directive active for each organisation on each date, the rule that generated each individual event, the planted parameters, and the random seed. **No modelling code reads this file.** It is opened only when scoring results. If it ever leaks into a feature set, every number this phase produces becomes meaningless, so it stays in a separate directory and is loaded by the evaluation script only.

Both files get committed. LLM output is not reproducible from code alone, so shipping the generator without the generated data would leave nobody — including me, later — able to reproduce the numbers.

## Scale

Five years of daily simulation, roughly 1,500–3,000 events.

Five years because the seasonal rule needs to repeat at least five times before it is a pattern rather than an accident, and because the migration needs enough distance to become visible. The event count is set so that per-organisation samples stay in the thousands, which is comfortable for the model sizes in use.

## How results get measured

For every classification task, **the majority-class baseline gets calculated and reported next to the accuracy**. This is the direct lesson from phase 1, where I reported a number for months without knowing that most of it was free.

The core experiment is a feature ablation:

| Run | Features given | What it should show |
|---|---|---|
| A | `lat`, `lon` | NORTHWIND recovered, TIDEBREAK confused |
| B | `+ date` | TIDEBREAK accuracy jumps; the delta is the finding |
| C | `+ target_type` | DRYSTONE separates on preference, not just position |
| D | per-org time series | Directive change points detected and compared against `ground_truth.json` |

The output of the phase is not a single accuracy figure. It is the table of deltas between those runs, because that table is the answer to "which data do you actually need".

Per-class precision and recall get reported throughout, not just overall accuracy. Phase 1's chemical-weapon class had 203 rows out of 130,681 and was almost certainly never predicted once, and accuracy hid that completely.

## Scope

In scope:

- The generator, its rules, and the two output files
- The four ablation runs above
- Re-running the phase 1 preprocessing and KNN against the synthetic events as a continuity check

Out of scope:

- Any claim about real-world terrorism. The generator produces the patterns I put into it and nothing more. Findings here are about method, not about the world
- Modelling real organisations, real events, or real places. All entities are fictional
- Deep learning. The point is to measure what the data supports, and a small model makes that easier to see, not harder

## Note on subject matter

All organisations, directives and events in this project are invented for the purpose of testing an analysis method. The simulator is a way to obtain data with a known answer key, which is the only reason the domain appears at all. Nothing here describes, predicts, or is derived from real groups or real incidents.
