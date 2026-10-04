---
name: o-decompose
description: Decompose an approved plan (or an older run's epic) into layer-based task files — the next layer by default, every layer in strict mode — triaging any candidate that is not plainly a task as a task in this run, a run of its own (o-plan), an analysis (o-analyze), or dropped; outputs <run folder>/E<nn>-tasks/ for o-implement, and E<nn>-triage.md when triage ran. Use when asked to break or split a spec into tasks or tickets, turn a plan's layers into task files, or cut a roadmap into small tasks.
version: 4.0.0
author: Community
tags: [decompose, tasks, layers, triage, verdict, child-run, definition-of-done, DOD, test-plan, atomic, estimation, self-contained, incremental]
user-invocable: true
budget: 1200
---

# O-Decompose — Layer Tasks

Cut an approved plan's layers into task files that o-implement builds one at a time. Pipeline:
`o-plan → o-decompose → o-implement`.

`<skill>` is this skill's folder, and `<skills>` is the folder that holds every o-* skill. Every script answers
`--help`.

## Mode

Read `mode:` from the plan. Without one, the mode is lean. The user's word overrides it.

- **lean** — cut **only the next open layer**, the first one with no task files yet. o-implement comes back here
  when that layer closes, so the next layer is cut against the code as it is by then, not as it was guessed.
  Triage runs only for a candidate that is not plainly a task.
- **strict** — cut every layer up front, triage every candidate into a verified ledger, and put the plan's facts
  into each task file: `references/strict.md`.

## Workflow

1. **Read the plan.** Open `<run folder>/E00-plan.md` (or a legacy `E<nn>-epic.md`). Take the goal, the contract
   and the invariant, plus the layer you are cutting: its Objective, Scope in, Scope out and Definition of Done.
   A layer missing a field goes back to o-plan.
2. **Read where the layer lands**: the code, tests and modules it touches. o-arch's pass card
   (`<skills>/o-arch/references/pass.md`) decides where code goes and what it is called. When
   `.o-skills/config/arch.json` exists, it sets the boundaries a task may not cross.
3. **Draft the candidates.** Give each one an id `L<N>-T<M>` and make it one verifiable change. Check each
   against the triage signals:

   | Signal | Verdict |
   |--------|---------|
   | Another candidate, or the layer's Scope out, already covers it | `drop` |
   | It sets its own contract, has its own layers, or is XL | `plan`: a child run with o-plan |
   | Nobody can say yet what to build, or why it fails | `analyze`: a child run with o-analyze |
   | One change, one check, size ≤ M, no new interface | `task` |

   A candidate that is plainly a task needs nothing more. Any other verdict goes through triage:
   - ask the user with a `single` panel
   - start the child run first
   - record the verdict with `file:line` evidence, as `references/triage-rules.md` and `scripts/triage.mjs`
     describe

   Work handed to a child run gets no task file here. `verify` matches every task file to a verdict, so once a
   run has a ledger, every candidate goes into it as well, including the ones cut before it existed.
4. **Write the files.** `node <skill>/scripts/save-tasks.mjs --epic <slug>` prints the run's tasks folder; every
   layer uses the same one. Write one file per task, named `L<N>-T<M>-<slug>.md`, in the format below.
5. **Hand off.** List the tasks, one line each: id, title, size, blockers. In lean, the plan's approval already
   covers its layers, so do not stop to ask again; the user can still object. In strict, ask with a `confirm`
   panel.

## Rules

1. **Every task leaves the system working.** Never "T1 is done but nothing runs yet."
2. **Tracer bullets, with blockers.** Cut vertical slices, not component lists. Each task is a narrow but
   complete path through what it touches, and can be checked on its own. `depends_on` names exactly the
   tasks that block it (the ones whose output it needs) and is `[]` when there are none, so an unblocked task
   can start at once or run in parallel.
3. **The first L0 task is an end-to-end test of the flow, followed by the skeleton with stubs that passes it.**
   In a system that already runs, L0 is a seam instead: see `references/examples.md`.
4. **L1 and later keep the earlier layers' tests green**, as a Definition of Done row.
5. **One to three tasks per layer.** A fourth task belongs in the next layer.
6. **Wide refactors go expand–contract.** One mechanical change with a wide blast radius (retyping a shared
   symbol, renaming a column) cannot land as one green slice. Instead:
   - **expand**: add the new form beside the old, as one task
   - **migrate**: move the call sites in batches, each batch blocked by the expand
   - **contract**: delete the old form last, blocked by every batch
7. **Do not copy the plan.** A task says what the plan and the code do not: the decision, the edge cases, the
   trap. Name the plan section or the file instead of pasting it. Before a task goes to o-parallel,
   o-implement adds what its worker needs to the file, because a worker sees only its task file.

## Size and complexity

**Size** counts what the change touches, not counting tests. A module is a workspace package, otherwise a
top-level folder under `src/`.

| Size | Touches |
|------|---------|
| XS | 1 file |
| S | 2–3 files in one module |
| M | 4–10 files in one module |
| L | more than 10 files, more than one module, or a contract change; a task only with a reason in `complexity_why` |
| XL | several contracts or an unsettled design; not a task, triage says `plan` |

A plan's `constraint: task size ≤ <size>` overrides the M cap.

**Complexity** asks: could you write the steps before starting?

- **clear**: yes, the repo has a pattern to copy.
- **complicated**: yes, after a design call between options.
- **complex**: no, only trying will tell. Spike first, with a person in the loop.

Do not estimate hours.

## Task format

Keep a task under about 40 lines.

```markdown
---
type: task
title: "L<N>-T<M> · <what works after this task>"
size: <XS | S | M | L>
complexity: <clear | complicated | complex>
complexity_why: <one line a reviewer can check>
depends_on: []
---
# Task: <what works after this task>
**Layer:** <N> — <the layer's name in the plan>
**Files:** <path> (new), <path> (mod)

## Goal
<one or two sentences: what works now that did not before>

## Context
- <only what the plan and the code do not already say>

## Definition of Done
- [ ] <automated check>: `<command>`
- [ ] seen to work, not just compiled: <the command, request or screen>
- [ ] standing bar clear — o-implement's Definition of Done

## Test Plan
- Given <condition> → <result>   (the happy path, then each error path)
```

Scripts read `**Layer:**` and `**Files:**`, so keep their spelling. `depends_on` lists the blocking task files by
name (`- L0-T1-<slug>`). o-implement's `status.mjs` writes `done`, `started` and `finished`; nobody sets them by
hand. A repo that keeps a vault adds links: see `references/vault.md`.

## Limits

- **Not for work without layers.** That goes to o-plan first. A change under an hour belongs in o-fix or a
  direct edit.
- **A subsystem can pass for a task.** The signals and the user catch it; no script does.
- **One level of child runs.** If a child needs its own plan, the parent's layers were cut too coarsely. Say so;
  do not spawn a grandchild.
