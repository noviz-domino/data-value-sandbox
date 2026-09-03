# Project plan — GTD terrorism analysis

Course project, Beijing Institute of Technology, big data class. Solo work, April 2026.

A note on this document: I wrote it up after the project was already finished, working from the notebooks and my own memory. The original plan lived in my head and in class notes, not in a file. So treat this as a reconstruction of what I set out to do, not as a document I wrote before starting. I have tried not to rewrite history in my favour — the section on scope creep at the bottom is the honest part.

## What I wanted to answer

The starting question was broad: **given a location, what can the historical data tell me about terrorism there?**

I was interested in whether the patterns are strong enough that geography alone carries information. Not "which country has more attacks" — that is just a count — but whether the *character* of an attack is predictable from where it happened.

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

"Terrorism risk for a location" is not directly a column in this dataset. There is no risk score to predict. To build a real risk model I would have needed to construct negative examples — places and times where nothing happened — and the dataset only contains events. Every row is an attack. A model trained on attacks only cannot tell you where an attack will happen, because it has never seen a non-attack.

I did not have the time or the background to do that properly inside a course project. So I picked a target that *was* in the data and was still location-related: **weapon type**.

Restated, the question I actually built for is: *if an attack happened at these coordinates, which of the four weapon categories was most likely used?*

That is a much smaller question than the one I started with. It is still a real one.

## Scope

In scope:

- Column selection and basic EDA on the full dataset
- Filtering to attacks with a clearly identified weapon type
- Aggregate counts by year, attack type, weapon type
- A KNN classifier on coordinates, with train/test evaluation
- A scatter plot showing weapon type by geography

Out of scope, and not attempted:

- Predicting whether an attack occurs at all (see above — the data does not support it without a lot more work)
- Time-series or trend forecasting
- Hyperparameter search, cross-validation, alternative models
- Any use of the text columns

## Success criteria

I set the bar at: the model trains, evaluates on held-out data, and I can explain what the number means.

In hindsight that bar was too low, and it is the main thing I would change. "It runs and produces a number" does not tell you whether the number is any good. I should have written down a baseline to beat before training anything. I did not, and I only worked out afterwards that the majority class alone gets 59.5%. That comparison is in the dev log and the README.
