---
name: o-sketch
description: Build a throwaway prototype to answer a design question — a clickable single-file HTML demo you can play with to test a state machine or a piece of logic, or several UI variants (layouts, flows) to compare side by side; throw it away and keep the verdict. Use when asked to prototype, demo, or mock something up, when the user wants to click through a flow before it is built, or when a question needs a runnable answer rather than more words about it.
version: 1.0.2
author: Community
tags: [prototype, sketch, design-question, ui-variants, throwaway]
user-invocable: true
---

# O-Sketch — A Throwaway Prototype Answers the Question

Some questions cannot be settled in conversation: whether a state model holds up, whether a screen reads.
Debating them spends hours and settles nothing; a throwaway prototype answers them in one. Build the smallest
thing that answers the question, throw it away, keep the verdict.

## Pick the branch first

The two branches produce different artifacts, and the wrong one wastes the whole sketch:

- **"Does this logic or state model feel right?"** — one shareable HTML file with free-play buttons plus tabbed
  guided walkthroughs that push the state machine through the cases that are hard to reason about on paper,
  and that a non-developer can drive.
- **"What should this look like?"** — several radically different UI variants on one route, switchable through
  a URL search parameter and a floating bar, so the user compares approaches, not pixel nudges.

When the question is ambiguous and the user is not reachable, default to the branch the surrounding code
suggests (backend module → logic; page or component → UI variants) and state the assumption at the top of the
sketch.

## Rules for both branches

1. **Throwaway from day one, visibly.** Build it beside the code it prototypes for, named so a casual reader
   sees prototype, not production, and obey the project's existing routing and layout conventions.
2. **Trivial to run.** One command (`pnpm <name>`, `python <path>`, `bun <path>`) or one double-click for the
   HTML file. No thinking required to start it.
3. **No persistence by default.** State lives in memory; if the question is about persistence, hit a scratch
   store with a "PROTOTYPE, wipe me" name.
4. **No polish, one sitting.** No tests, no error handling beyond what keeps it runnable, no abstractions. A
   sketch that needs a second session has become a project: stop and take what it already shows.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), render the full relevant
   state so the user sees what changed, not a black box.
6. **Capture the verdict.** Fold the validated decision into the real code, then commit the sketch to a
   throwaway branch — out of main — and leave a pointer to that branch plus the verdict on the task or issue.
   Main keeps only the decision: before calling the sketch done, `git diff main --stat` on the branch you are
   merging lists no sketch file.

## Relation to the other skills

- **o-analyze** — when a thesis question needs a runnable answer, sketch it and carry the verdict back into the
  analysis as evidence.
- **o-plan** — a sketch that settles a design question becomes an input to the spec, cited like any other
  finding; the sketch itself never becomes the plan.
- **o-ui** — the sketch is exempt from o-ui's bar while it stays a sketch; the real screen built from its
  verdict is not.
