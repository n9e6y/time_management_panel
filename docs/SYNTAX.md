# How to name your calendar events

Time Analyzer reads meaning out of event titles. One line is all it needs:

```
CATEGORY: task #tag +project [score]
```

```
SLEEP: night
LEARN: calculus ch.4 #deep +exam-prep [4]
ME: chill - youtube [3]
CLASS: lab report #deep
```

Everything after the category is optional. If you only ever write `CATEGORY: what I did`, the whole dashboard works.

## The parts

| Part | Required | What it means |
|---|---|---|
| `CATEGORY` | yes | The text before the **first** colon, matched against your categories in Settings. Case does not matter (`learn:` = `LEARN:`), and the space after the colon is optional. |
| task | yes | Whatever is left once the tokens below are removed. Your own words, kept as you typed them. |
| `#tag` | no | What kind of block it was: `#deep`, `#shallow`, `#unplanned`. Several are fine. |
| `+project` | no | A temporary effort that cuts across categories: `+exam-prep`, `+hack-week`. Shown in Overview's projects table. |
| `[score]` | no | How it went, `[1]` to `[5]`. A missing score is left out of averages, never counted as zero. |
| comment | no | The event's **description** field, not the title. Shown in the blocks drawer. |

Tokens may appear anywhere after the colon, in any order. `C#` and `C++` are not tags or projects: a `#` or `+`
only starts a token at the beginning of the text or after a space.

## Two things worth knowing

**A bare category counts.** A title that is exactly one of your categories — `Sleep`, `sleep`, `SLEEP [4]` — counts
as that category with no task. So a sleep log written as plain `Sleep` is read correctly.

**A spaced hyphen splits the time evenly.** `ME: chill - youtube` from 09:00 to 11:00 counts as `chill` 09:00–10:00
and `youtube` 10:00–11:00, back to back in the order you wrote them. The split is a guess, so those hours are shown
with `≈` and a goal is never marked missed or over when the guess alone decides it. A hyphen without spaces on both
sides (`chill -youtube`) does not split; change the separator in `config.yaml` if you use another one.

## What the app tells you about a title

The **Data quality** page lists every title it could not read cleanly, so you can fix it in Google Calendar:

| Problem | What it means | What the app does |
|---|---|---|
| no category | no colon, and the title is not a bare category name | counts the time under UNCATEGORIZED |
| tokens before the category | `[4] #deep LEARN: x` | reads it anyway, lists it as a warning |
| unknown category | a category not in your Settings | keeps it as written and flags it |
| old category | a category you have mapped to another one | maps it as your config says |
| invalid score | `[0]`, `[6]`, `[3.5]` | drops the score, keeps the time |
| more than one score | `[3] [4]` | drops the score |
| empty task | nothing left but tokens | keeps the time, no task text |
| unknown tag | a tag not in your known tags | keeps it and flags it |

Nothing is ever thrown away for a naming mistake: the time still counts. Only all-day events are left out, because
they are reminders, not time.

## What is not counted

* All-day events (they have no hours).
* Cancelled instances of a repeating event.
* Days after your export: they are drawn as "not in this file", never as unlogged time.

Overlapping blocks are counted in both categories and reported on Data quality, so an hour never silently
disappears or doubles without you knowing.
