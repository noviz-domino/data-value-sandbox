# Project plan — GTD terrorism analysis

Course project, Beijing Institute of Technology, big data class. Solo work, April 2026.

A note on this document: I wrote it up after the project was already finished, working from the notebooks and my own memory. The original plan lived in my head and in class notes, not in a file. So treat this as a reconstruction of what I set out to do, not as a document I wrote before starting. I have tried not to rewrite history in my favour — the section on scope creep at the bottom is the honest part.

## The assignment, and what I wanted to build

The brief was to build a **prediction simulation from terrorism big data**. Not a report, not a dashboard of past counts — something that takes what has already happened and says something about what has not happened yet.

The version I had in my head looked like this. Combine several sources: police records, military movement data, and activity histories for individual terrorist organisations. With those joined together and enough infrastructure behind it, you could ask questions like *where is this particular group likely to strike next, and by what method?* Push it further and the same shape of model stops being only about terrorism — the movements and tendencies of a state's military are the same kind of problem, just with different actors and better-funded data.

That is the target I was aiming at. I want to be clear that this repository does not contain it.

What I could actually get my hands on inside a course project was one dataset: GTD. So the question became a smaller one, sitting underneath the big one.

**Is the character of an attack predictable from where it happened at all?**

This matters because it is the assumption the whole simulation rests on. If location carries no usable signal about the nature of an event, then joining five more data sources and renting a bigger machine will not save it. Better to test the premise on one dataset first than to discover it after building the pipeline.

## Dataset

Global Terrorism Database (GTD), 1970–2015. The version I was given had already been cut down from the original 100+ columns to 23.

The columns available were: `year, nkilled, nkilledter, nwounded, nwoundedter, lat, lon, region, country, weapontype, attacktype, targettype, gname, state, city, extended, multiple, success, suicide, nter, claimed, property, propertyextend, countrycode`.

I picked 11 of them to load:

```
year, country, region, state, lat, lon, attacktype, nter, weapontype, nkilled, countrycode
```

Everything else was either free text (`gname`), redundant with a column I already had, or not relevant to a location-based question.

## Approach

Two notebooks, split by responsibility:

**`data_preprocessing.ipynb`** — load, inspect, filter, save a clean CSV.
**`knn.ipynb`** — read that CSV, train and evaluate a model.

Splitting them meant I could re-run modelling experiments without re-doing the slow load and filtering every time. The intermediate file (`arms_DF_ver2.csv`) is the handoff between the two.

For the model I chose **k-nearest neighbours**. Two reasons:

1. The question is geographic, and KNN is geographic in the most literal way. Its whole idea is "look at what happened nearby". If attacks of the same kind cluster in space, KNN should pick that up without me doing anything clever.
2. It is easy to explain in a presentation. I had to present this to a class, and I could draw KNN on a whiteboard.

The features were latitude and longitude only. That was deliberate. If I had thrown in `country` and `region`, the model would score better, but it would be scoring on labels that already encode location. I wanted to see what raw coordinates alone could do.

## Target variable

Here is where the scope narrowed, and I want to be clear about it.

The obvious target for a prediction simulation is risk: *how likely is an attack here?* That is not a column in this dataset, and it cannot be made into one without work I could not do in the time available. Every row in GTD is an attack that happened. There are no negative examples — no records of a place and date where nothing occurred. A model trained on attacks alone has never seen a non-attack, so it has nothing to contrast against and cannot answer "will something happen here".

Getting around that means generating negatives yourself: sampling locations and time windows with no recorded event, and then defending the sampling choices, because they decide the answer. That is a project on its own.

So I picked a target that *was* already in the data and still depended on location: **weapon type**.

Restated, the question I actually built for is: *if an attack happened at these coordinates, which of the four weapon categories was most likely used?*

It is a much smaller question than the assignment. But it is the right small question, because it isolates the premise. If coordinates can predict the weapon, then location carries real information about the character of an event, and the larger simulation has something to stand on. If they cannot, the larger simulation was never going to work regardless of how much data got bolted on.

## Scope

In scope:

- Column selection and basic EDA on the full dataset
- Filtering to attacks with a clearly identified weapon type
- Aggregate counts by year, attack type, weapon type
- A KNN classifier on coordinates, with train/test evaluation
- A scatter plot showing weapon type by geography

Out of scope, and not attempted:

- Joining any second data source. The police / military / group-history combination described at the top stayed a sketch
- Per-organisation modelling. `gname` (the group name) is in the dataset and I never touched it, which in hindsight was the closest thing to the real goal that was actually within reach
- Predicting whether an attack occurs at all (see above — the data does not support it without a lot more work)
- Time-series or trend forecasting
- Hyperparameter search, cross-validation, alternative models

## Success criteria

I set the bar at: the model trains, evaluates on held-out data, and I can explain what the number means.

In hindsight that bar was too low, and it is the main thing I would change. "It runs and produces a number" does not tell you whether the number is any good. I should have written down a baseline to beat before training anything. I did not, and I only worked out afterwards that the majority class alone gets 59.5%, so the model's real contribution is 8.5 points rather than 68. That comparison is in the dev log and the README.

For the premise the project was testing, the honest verdict is *partly*. Location does carry signal about the character of an attack — the scatter plot makes that visible and the model confirms it. But two coordinates buy 8.5 points, which is thin. Read generously, that is an argument for the multi-source design I sketched at the start rather than against it: if geography alone gets you this far, the group's own history and the timing are probably where the rest of the signal is.
