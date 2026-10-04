---
name: o-implement
description: Implement decomposed tasks with TDD — red-green-refactor per task, verified with o-review + o-fix, committed task by task, independent tasks parallelized with o-parallel, gated on every task being done. Use when asked to implement a run's tasks.
version: 2.0.0
author: Community
tags: [tdd, implementation, test-driven, red-green-refactor, production-code, parallel, ui]
user-invocable: true
budget: 1200
---

# O-Implement — Test-Driven Implementation

**No production code without a failing test first.** If you wrote code before its test, take the code out, watch
the new test fail for the right reason, then put the code back. Prototypes, generated code and throwaway scripts
are the only exceptions, and each needs a `confirm` panel first.

`<skill>` is this skill's folder, and `<skills>` is the folder that holds every o-* skill. Every script answers
`--help`.

## Mode

Read `mode:` from the plan. Without one, the mode is lean. The user's word overrides it. Both modes run the same
loop; strict adds gates to it.

| | lean (default) | strict |
|---|---|---|
| Test seams | named in the task, then go | confirmed with the user once per layer |
| Review per task | only for size L, or code at a trust boundary (auth, money, parsing input, a migration) | every task, with the doubt pass (`references/doubt.md`) first on a non-trivial decision |
| Review per layer | yes, at layer close | no; every task was already reviewed |
| Docs | updated at layer close | updated per task |
| Run close | short summary | the summary, then o-roast and o-humanize on it |

## Before the first task

- Read the plan's contract and invariant, and the task files in `<run folder>/E<nn>-tasks/`. If the next open
  layer has no task files, run o-decompose for it.
- With a triage ledger (`E<nn>-triage.md`), run `node <skills>/o-decompose/scripts/triage.mjs verify --dir <run folder>`;
  a layer waiting on an undelivered child run (see `receipts`) starts only after a `confirm` panel.
- No test runner for the language? Stop and propose one as its own task, with a `confirm` panel.

## The loop, per task

Take tasks in `depends_on` order.

**Narrowest tests**: the test files this task wrote or changed, plus the existing ones that exercise the modules
the diff changed. Steps 1–4 run only these. The full suite runs once, at COMMIT. If you cannot name them, run the
full suite and say why.

1. **RED** — Write the smallest failing test for the task's acceptance check, at a public seam (never an
   internal). It must fail for the right reason.
2. **GREEN** — Write the least code that passes. Walk o-unbloat's ladder first
   (`<skills>/o-unbloat/references/pass.md`), and place the code by o-arch's pass card
   (`<skills>/o-arch/references/pass.md`).
3. **REFACTOR** — Make one pass over what you wrote, then write one line saying what changed, or why nothing did:
   - comments follow o-comments' card (`<skills>/o-comments/references/pass.md`), and none restate the code
   - o-unbloat's table and its Never Cut list; o-arch's placement, naming and dependency direction
   - every function can be described in one sentence; the core is pure, side effects sit at the edges, and
     inputs are never mutated
   - for every branch, ask whether its state could be made impossible instead (see below)
4. **VERIFY** — The narrowest tests must be green. Review only where the mode table says so: o-review by its
   pass card (`<skills>/o-review/references/pass.md`), then o-fix, repeated until the plan has no open issue and
   the narrowest tests are green.
5. **COMMIT** — Run the full suite once; red blocks the commit. Then
   `node <skills>/o-floor/scripts/floor-guard.mjs --root .`: on exit 1 fix the code, never the threshold; exit 2
   is not a pass, say so. Then `node <skills>/o-commit/scripts/commit.mjs "<message>"`, never `git commit`; if it
   refuses the message, ask for a new one with an `open` panel.
6. **STATUS** — Tick the `## Definition of Done` boxes you saw pass; a skipped or deferred check stays `[ ]`. An
   unreviewed lean task leaves its standing-bar box to the layer review. Then
   `node <skill>/scripts/status.mjs <run folder>` marks finished tasks `done`, ticks finished layers and refreshes
   the plan's Status line. Only status.mjs writes `done`, `started` and `finished`.

**Strict also** runs `status.mjs <run folder> --start <task file>` before RED and `--ready <task file>` after
COMMIT, and notes in `memory.md` any task whose diff size differs from its `size`.

## Layer close

When every task in the layer is committed:

1. **Review the layer (lean).** Run o-review by its pass card over the layer's change
   (`--base <the commit before the layer's first task>`), then o-fix. Commit the fixes through commit.mjs.
2. **Tick** each task's standing-bar box, update the plan or the living docs so they describe the layer as it is
   now, and run `status.mjs` again.
3. **Next layer.** If the plan still has a layer with no task files, run o-decompose for it and continue.

## Close the run

When every layer is done:

- Check the plan's own Definition of Done, then run `status.mjs <run folder> --epic-done`.
- Write `<run folder>/E<nn>-summary.md` in under 20 lines: a property block (`type: summary`,
  `title: "Summary · <topic>"`), the plan's `goal:`, one line per task, and the test result.
- If the plan has an `issue:` and the repo an `origin` remote, ask with a `confirm` panel, then run
  `gh issue comment <n> -F <summary>`.

## Parallel tasks

Tasks in one layer with disjoint `**Files:**` and no blocker between them can run at once:

1. A worker sees only its task file and cannot ask, in either mode: confirm the batch's seams in one panel, then
   write the seams and the plan facts each task needs into its file.
2. `node <skills>/o-parallel/scripts/parallel.mjs --tasks <run folder>/E<nn>-tasks --parallel 4` (done tasks are
   skipped).
3. After an o-parallel batch merges, run the full test suite, then VERIFY and the floor guard on the merged
   changes, then STATUS for each merged task.

## UI tasks

Build UI to `<skills>/o-ui/SKILL.md`. Before VERIFY, exercise the screen with o-browser and run o-ui's Pre-Flight
Checklist; a failed item means not done.

## Make the Bad State Impossible

Do not handle a state that should never occur; change the design so it cannot. In order: **narrow the type** (a
union, not a status string), **parse at the edge** into that type, **hide the transition** behind a named
operation, **constrain it where the data lives** (schema, exhaustive `switch`). Only then handle it, and say in
the code why it cannot be excluded. Input crossing a trust boundary is always checked, once, at the edge. Test the
invariant (the rejection, the parsed shape), not a branch for a state a too-wide type allows.

## Definition of Done

A task is done when its own checklist is ticked **and** this standing bar is clear. o-review checks the bar too.

| Bar | Clear when |
|-----|------------|
| **Correct** | Acceptance met; new behavior has a test that fails without it; full suite green; edge and error paths handled. |
| **Verified** | Seen working (a command, a request, a screen), not just compiled. |
| **Scoped** | The diff touches only the task; anything else goes in the run notes. |
| **Clean** | REFACTOR ran; no dead code, debug output or comments that restate code. |
| **Documented** | The plan or living docs describe the change as it is now (lean: by layer close). |
| **Reviewed** | The review this mode requires came back clean; the floor guard exits 0. |

Unrun is not done, and green tests are one row, not the bar. `references/tdd-rules.md` lists the anti-patterns.
