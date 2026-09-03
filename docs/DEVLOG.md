# Dev log

Working notes for the GTD project. I did not keep a diary while building it, so this is written up afterwards by reading back through my own notebooks. It is ordered by what I did rather than by date. Where I found something wrong with my own work while writing this, I left it in.

---

## Cutting the dataset down

The file I started with had 23 columns and 152,252 rows. I listed the ones I thought I needed in a markdown cell at the top of `data_preprocessing.ipynb`:

> year, county, region, state, city, lat, lon, attaktype, nter, weapontype, nkilled, countycode

That list has 12 names in it (and three typos). The `usecols` in the actual code has 11. `city` is in the list but never made it into the code.

I do not remember dropping it on purpose. My guess is that I decided `state` was granular enough and just edited the code without going back to fix the note above it. Small thing, but it is the first sign of a habit I kept repeating in this project: the comments and the code drifted apart, and I never reread the comments.

## First look at the data

`describe()` and a correlation heatmap, mostly to see if anything was obviously broken. Two things came out of it.

**`nter` has a mean of 5.48 and a standard deviation of 177.** That is a red flag — the standard deviation is 32 times the mean. The median is 0. So most rows record zero attackers, which really means "unknown", and a small number of rows carry enormous values. If I had used `nter` as a feature I would have needed to deal with that. I did not use it, so it did not matter, but I only realised why it did not matter much later.

**1993 is missing.** When I ran `year.size()` the counts go 1992, then straight to 1994. I remember stopping on this and assuming I had broken the filter. I had not — the 1993 records were lost before GTD was compiled, and the gap is in the source data. Worth knowing before you write "attacks dropped sharply in the early 90s" in a report.

## Filtering to four weapon types

I kept only rows where `weapontype` was one of Explosives/Bombs/Dynamite, Firearms, Melee, or Chemical. Everything else (unknown, sabotage, vehicle, and so on) was dropped, because a category called "Unknown" is not something a classifier can usefully learn.

That left **130,681 rows**.

The markdown cell right below the filter says *"there were 130628 terrors using weapons"*. That number is wrong — it is 130,681. I must have typed it from an earlier run and not updated it after changing the filter. Nobody caught it because nobody was reading it, which is the problem with writing counts by hand into prose.

Saved the result as `arms_DF_ver2.csv` and moved to the second notebook.

## Building the labels, and why that code makes me nervous

This is the part I would rewrite first.

To turn weapon type into numbers, I sorted the dataframe by `weapontype` and then built the label list by counting:

```python
df = df.sort_values(["weapontype"], ascending=[True])
...
point_target = [0]*203 + [1]*77755 + [2]*49801 + [3]*2922
```

It works. Sorted alphabetically the categories come out Chemical, Explosives, Firearms, Melee, and those four counts are exactly right, so every row does get the correct label.

But it works by coincidence of arrangement, not by connection. There is nothing linking row *n* to label *n* except that I sorted first and counted correctly. If the filter changed, or a row was added, or the sort was removed, the labels would slide out of alignment against the rows and **nothing would raise an error**. The model would just train on scrambled targets and score badly, and I would be looking for the bug in the wrong place.

The right way is one line:

```python
point_target = df["weapontype"].map({
    "Chemical": 0, "Explosives/Bombs/Dynamite": 1, "Firearms": 2, "Melee": 3
})
```

That reads the label off each row directly. I did not know to write it that way at the time. Leaving the original in the notebook because it is what I actually did.

## Training

80/20 split with `random_state=20`, which gave 104,544 training rows and 26,137 test rows. `KNeighborsClassifier()` with defaults, so k=5.

```
train accuracy   0.7325
test accuracy    0.6803
```

The gap between train and test is about 5 points, which for KNN is normal — with k=5 a training point is partly voting for itself.

I was pleased with 68% at the time. That was the wrong reaction.

## Working out that 68% is not what I thought

The weapon types are nowhere near evenly distributed:

| weapon type | rows | share |
|---|---:|---:|
| Explosives/Bombs/Dynamite | 77,755 | 59.50% |
| Firearms | 49,801 | 38.11% |
| Melee | 2,922 | 2.24% |
| Chemical | 203 | 0.16% |

A model that ignores the input completely and always answers "explosives" scores **59.5%**. Mine scores 68.0%. So the coordinates are worth about **8.5 percentage points**, not 68.

That is still a real result. Location genuinely carries information about weapon choice, and you can see it in the scatter plot — the categories sit in visibly different parts of the map. But "68% accurate" on its own oversells it badly, and I would have reported exactly that number in my presentation without the comparison, because I never calculated the baseline.

The other thing this table makes obvious: with 203 chemical rows out of 130,681, a k=5 neighbourhood almost anywhere on Earth will be majority explosives or firearms. The model almost certainly never predicts Chemical at all, and accuracy is completely blind to that. A confusion matrix would have shown it in one glance. I did not produce one.

## Prediction demo

Fed in a single point at latitude 15.675051, longitude 120.331618 — Luzon, Philippines — and got class 2, Firearms. Then plotted all four categories in different colours with the test point marked on top.

The plot is the most useful output in the whole project, more than the accuracy number. You can see the clustering directly instead of taking a metric's word for it.

One flaw in it: I plotted latitude on x and longitude on y. Conventional maps are the other way round, so the shape of the world is rotated and it takes a moment to recognise. Cosmetic, but it made explaining the plot harder than it needed to be.

## Something I only noticed writing this up

KNN measures straight-line distance between feature values. Latitude runs −90 to 90, longitude runs −180 to 180. Longitude therefore spans twice the range and pulls harder on the distance calculation than latitude does, purely because of the units. I never scaled the features.

On top of that, plain Euclidean distance on lat/lon is not real distance on a sphere — a degree of longitude is about 111 km at the equator and nearly nothing near the poles. For this dataset it mostly does not matter, since attacks cluster in the mid-latitudes, but it is wrong in principle and I did not think about it once.

## Where it stopped, and why

The project ends at the scatter plot. No tuning, no cross-validation, no second model to compare against, and nothing built toward the simulation the assignment actually asked for.

Partly that was the course — a practice assignment with a deadline, where the requirement was an end-to-end pipeline that runs, which this is. Partly it was that I did not know what to do next. I had a number, the number looked fine, so it felt finished. Learning to distrust a good-looking number is the thing I actually took from this project, and I only really learned it while writing this log months afterwards.

The bigger miss is `gname`. The dataset labels which organisation carried out each attack, and the goal was predicting what a specific group does next. I loaded eleven columns and that was not one of them. Grouping by `gname` and looking at how one organisation's attacks move across space and time would have been the closest I could realistically get to the actual assignment, using data I already had open in front of me. I did not think of it, and that is not a resource problem — it is a framing problem. I optimised for "get a model working" instead of "answer the question".

If I picked it back up, in order:

1. Confusion matrix and per-class precision/recall. Confirm what I suspect about Chemical.
2. Replace the positional labels with a `.map()`.
3. Scale the coordinates, or switch to a haversine metric — scikit-learn's `BallTree` supports it.
4. Try a few values of k with cross-validation instead of accepting the default.
5. Reload with `gname` and `year`, pick the handful of groups with enough events to model, and see whether one group's attack locations are predictable from its own history. That is the first step that points at the original goal rather than away from it.
