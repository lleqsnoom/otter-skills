---
name: o-implement
description: Implement decomposed tasks with TDD — red-green-refactor per task, verified with o-review + o-fix, committed task by task, independent tasks parallelized with o-parallel, gated on every task being done. Use when asked to implement a run's tasks.
version: 1.7.1
author: Community
tags: [tdd, implementation, test-driven, red-green-refactor, production-code, parallel, ui]
user-invocable: true
---

# O-Implement — Test-Driven Implementation
**No production code without a failing test first.** Wrote code before the test? Take it out, watch the new test fail for the right reason, then put it back. Exception — confirm with a `confirm` panel (yes/no) first: prototypes, generated code, throwaway scripts.

`<skill>` below is this skill's folder, and `<skills>` the folder that holds it and every other o-* skill. Every script answers `--help` with its commands and flags.

## Before the first task: read the ledger a decomposition left

A run decomposed by `o-decompose` carries `<run folder>/E<nn>-triage.md` and `triage-<nn>.json`, where every candidate was decided. Two verdicts handed their work to a **child run of their own** — `plan` and `analyze` — and each of those names the layer that waits on it. A layer implemented on top of a child run that never landed is how a run ends up rebuilding what another run was meant to deliver.

```bash
node <skills>/o-decompose/scripts/triage.mjs verify --dir <run folder>
```

The `receipts` array says, per child run, whether it delivered: a child that closed with `E<nn>-summary.md`, or whose own `E<nn>-tasks/` are all ticked, is delivered. This is a report, not a gate — `verify`'s exit code does not change because of it. Before starting a layer whose receipts are undelivered, stop and ask with a `confirm` panel (yes/no) whether to proceed anyway; the answer belongs in the run's notes. A run with no `E<nn>-triage.md` (decomposed before this step existed) implements exactly as it does below: no panel, no error.

## Artifact Location

```bash
node <skill>/scripts/save-plan.mjs --epic <slug>
```
It writes `E<nn>-implement.md`, the run's implementation log, beside the artifact the run was decomposed from (its plan, or a legacy `E<nn>-epic.md`), found by topic. The tasks are the files under `<run folder>/E<nn>-tasks/`.

## Comments

Code must document itself. Follow o-comments' pass card (`<skills>/o-comments/references/pass.md`) on every line you write, and strip comments that restate code in REFACTOR. Its rules are not repeated here.

## No Bloat

Write the least code that works. Follow o-unbloat's pass card (`<skills>/o-unbloat/references/pass.md`): its ladder before GREEN, and its ladder, table and Never Cut list in REFACTOR. Its rules are not repeated here, so read them there.

## Architecture

Before GREEN, read `o-arch`'s pass card (`<skills>/o-arch/references/pass.md`): it decides where the new unit goes and what it is called — no bag names (`utils`, `common`, `helpers`), imports from volatile to stable. In REFACTOR it judges the placement, responsibility, direction and inheritance you wrote; `references/dir-organization.md` has this repo's shape. With a `.o-skills/config/arch.json`, `o-arch-lint` proves the task crossed no declared boundary.

## Functional Style

Keep the core pure and the side effects at the edges.

- **Pure functions, immutable data.** Compute and return values; do not mutate inputs or shared state. `map`, `filter` and named intermediate values over loops that accumulate into mutable variables.
- **Side effects only where unavoidable** (I/O, database, network, randomness), clearly named, at the boundary.
- **Thin orchestrators.** Each phase (fetch, validate, probe, decrypt) is a named helper that returns data; the orchestrator only composes them and collects any report in one place, never a `push` into a shared results list from inside every branch.
- **One role per function, class and file** — persistence, validation or orchestration, not several.

## Make the Bad State Impossible

Do not handle a state that should never occur — change the design until it cannot occur. A null check, a
`default:` branch, a fallback or a `throw new Error("should not happen")` is an admission that the state is
reachable; a representation that excludes it is the proof that it is not. Every branch deleted this way is a
path nobody can take, a test nobody has to write, and a failure mode no caller has to handle.

Prefer, in order:

1. **Narrow the type**, so the state cannot be written down: a `boolean` that stood for two states becomes
   those two states; a nullable field becomes required data on the one type that really carries it; a status
   string becomes a union; one type becomes two, so no value can hold the field that would be wrong.
2. **Make the constructor the gate** — parse, do not validate. Take the untrusted value once, return the narrow
   type, and let everything downstream hold only the parsed form. The check runs at the edge and the core
   carries no branch.
3. **Hide the transition**, so no caller can put the object into the wrong state: return a value from a named
   operation rather than exposing a setter any caller may use in any order.
4. **Constrain it where the data lives**: a non-null or unique constraint in the schema, the allowed values in
   the column, an exhaustive `switch` the compiler refuses to leave unfinished.
5. **Only then handle it.** A state that survives all four is one the design cannot exclude, and the branch is
   then the honest answer — say in the code why it cannot be excluded.

A value that crosses a **trust boundary** — a request, a file, an environment variable, a third-party payload —
is always handled, and that is not a bad state: rejecting it is the boundary's job. Handle it once, at the
edge, and convert to the narrow type there, so no caller inside the boundary needs a check at all.

RED and GREEN: test the invariant — the constructor's rejection, the parsed value's shape, the exhaustive case
list — rather than a branch that catches a state the type allows only because it is too wide. REFACTOR: walk
every branch you wrote and ask of each whether its state can be made impossible; where it can, delete the
branch and the check with it.

## Parallelize Independent Tasks

Implement tasks in dependency order. When two or more tasks can run independently, dispatch them to background agents with o-parallel instead of doing them one by one.

1. Read every task file under `<run folder>/E<nn>-tasks/`.
2. A task is **independent** when no other pending task modifies the same files and no other task requires its output (check each file's `Preconditions` and `Files:`).
3. **Agree the seams first.** A background worker cannot ask the user anything, so before dispatch name the seams under test for every task in the batch, confirm them with the user in one panel, and write them into each task file.
4. Independent tasks run concurrently:
   ```bash
   node <skills>/o-parallel/scripts/parallel.mjs --tasks <run folder>/E<nn>-tasks --parallel 4
   ```
   o-parallel gives each task an isolated worktree and a full background agent, retries failures, and merges committed results back into your branch.
5. Tasks that depend on one another stay in the inline TDD loop below, in dependency order.
6. After an o-parallel batch merges, run the full test suite, then VERIFY (step 4) and the floor guard on the merged changes, then START/READY stamps and the status update in step 7 for each merged task.

## Frontend Work Uses O-UI

When a task's scope includes UI (HTML/CSS, templates, components, or styles in any framework), apply the o-ui skill to everything you produce:

1. Read the o-ui skill's `SKILL.md` before writing any UI code — `<skills>/o-ui/SKILL.md`.
2. Follow o-ui's method: state the screen's primary task, then build to its strict rules (element count limits, component selection, row actions, status display, pagination rules).
3. Exercise the screen with o-browser before VERIFY, and run o-ui's Pre-Flight Checklist after it. o-ui judges the design; the browser is what shows the screen actually renders and works, which is the *Verified* row of the standing bar. A screen that fails any checklist item is not done.

## Workflow

For each task file in `<run folder>/E<nn>-tasks/`:

**Scale to the task.** An XS or S task skips the doubt pass and takes o-review's light review; an XS task also
skips the `--start` and `--ready` stamps, and step 7's plain `status.mjs` call still records it done. M and L run
the whole loop. **No test runner** for the language? Stop before RED: propose setting one up as its own task, with a
`confirm` panel. A change no test can observe first (layout, config, infrastructure) is proven by the *Verified*
row instead, and the reply says so.

**Narrowest tests** — the test files this task wrote or changed, plus the existing ones that exercise the modules
the diff changed; you pick them. Steps 1–4 run only these. The full suite runs once per task, at COMMIT. If you
cannot name them, run the full suite and say why.

0. **START** — record that the task began: `node <skill>/scripts/status.mjs <run folder> --start <task file>`. It stamps
   `started` in the task's property block once; a second call keeps the first stamp.
1. **RED** — Write the minimal failing test for the task's acceptance criterion. It must fail for the *right reason*.
   **Seams are pre-agreed:** before the first test, name the seams under test and confirm them with the user —
   once per layer, for all its tasks, not once per task; tests observe behavior at public seams, never internals.
2. **GREEN** — Write the minimum implementation to pass that test. Nothing more. Walk the o-unbloat ladder before writing.
3. **REFACTOR** — Evaluate against SOLID/clean code, the comment rules, the o-unbloat pass (ladder, table, one cut at a time), the o-arch pass (placement, naming, responsibility, direction, inheritance), and the functional style above. Strip comments that restate code; extract explained blocks into named functions; push side effects to the edges and prefer pure, immutable functions. State what you assessed and what (if anything) improved — or why no changes were needed.
   - **One-sentence test:** every function you wrote must be describable in one sentence; if not, split it.
   - **Reporting test:** if deleting a phase's `push`/output call leaves the phase unusable, the phase was never a unit. Delegate each phase to a named helper that returns data and let the orchestrator collect the report in one place.
4. **VERIFY — doubt, then o-review + o-fix + test.** Run on every finished task before committing:
   - **Doubt** — on a non-trivial decision (branching logic, a module boundary, an invariant the compiler cannot check, an irreversible change), run the adversarial pass in `references/doubt.md` *before* the review. It is cheaper than review because it aims to disprove the decision while changing it is still cheap.
   - **Test** — run the narrowest tests. All must pass.
   - **o-review** — review the changed files by o-review's pass card (`<skills>/o-review/references/pass.md`). It writes a plan (`E<nn>-review-plan.md`) into the run folder, which `o-fix` reads.
   - **o-fix** — resolve every issue in the fix plan. Re-run the narrowest tests after each fix.
   - Repeat o-review + o-fix until the plan has no unresolved issues and the narrowest tests are green.
   - **Size check** — compare the files and modules the diff touched with the task's `size` (XS 1 file · S 2–3 · M 4–10
     in one module · L beyond, or a contract change; tests not counted). When they disagree, say so in the run's
     `memory.md` with both numbers: that record is how the scale gets tuned, so never edit `size` to match the diff.
5. **SYNC DOCS** — Update the spec (`<run folder>/E00-plan.md`) if it exists; otherwise update living docs (README, comments) directly.
6. **COMMIT** — **Run the full suite once**; a red suite blocks the commit. **Then the floor guard**: `node <skills>/o-floor/scripts/floor-guard.mjs --root .`. Exit 1 means this task lowered the bar — a new suppression, a skipped test, an unfinished stub, a loosened threshold, or an assertion taken out. Fix the code; never fix it by raising the threshold or widening the ignore list, which is the move the guard exists to catch. Exit 2 means it could not run, and that is not a pass — say so. Then run `node <skills>/o-commit/scripts/commit.mjs "<message>"` for every single commit. This is mandatory and non-negotiable. Never run `git commit` manually. If o-commit exits with an error, stop and ask for a corrected message with an `open` panel (free text only) — do not bypass it.
7. **UPDATE STATUS — the task, then the plan.** Two files, and neither write is optional. First mark where your own
   work ended: `node <skill>/scripts/status.mjs <run folder> --ready <task file>` stamps `ready` once — tests green,
   review clean, committed — before any check a person still owes. `ready − started` is the work, `finished − ready`
   the wait, and only the first says anything about a task's size.

   - **The task** — in the task's own file, change `- [ ]` to `- [x]` under `## Definition of Done` for the checks you ran and saw pass. That checklist carries the task's own criterion plus the standing-bar row `o-decompose` wrote in (see Definition of Done below), and both kinds are ticked the same way. A check you skipped, or one deliberately deferred to CI, stays `[ ]`: an unticked box is how the run says the task is not finished, and the layer it belongs to cannot close while it stands.
   - **The plan** — the layers artifact, `<run folder>/E<nn>-plan.md` (or a legacy `E<nn>-epic.md`) — cannot see the task files, so derive it:
     ```bash
     node <skill>/scripts/status.mjs <run folder>
     ```
     It ticks the `**Definition of Done:**` of every layer whose tasks are all done, and refreshes the plan's `**Status:**` line with the task and layer tally. It never unticks, and never asserts what a task list cannot prove. It also mirrors each task's boxes into its property block — `done`, `finished`, `reopened` — so Obsidian can tell open work from finished work. Those keys and `started` are written only by this script: never set them by hand. `--dry-run` prints what it would write.
   Do not start the next task without this.

All tasks `- [x]` and green → close the run:

8. **CLOSE THE RUN** — With every task `[x]`:
   - **The plan's own definition of done** — once you have verified what it asks for (the full suite green across every layer, the docs updated), tick it:
     ```bash
     node <skill>/scripts/status.mjs <run folder> --epic-done
     ```
     Those boxes are the plan's acceptance criteria rather than a count of tasks, so they are ticked on your word and not on arithmetic — and only when no task is still open, because a status the tasks contradict is worse than no status.
   - Write `<run folder>/E<nn>-summary.md`: the plan's `goal:`, one line per completed task, and the test results. It starts with its property block — `type: summary`, `title: "Summary · <run topic>"`, `run`, `plan` linking the plan it closes, and the plan's `topics`.
   - Run `o-roast` on the summary, then `o-humanize` on it; each appends its own `E<nn>` artifact beside it.
     Rewrite the summary from the humanized text. A run whose tasks are all XS or S skips both.
   - If the plan carries an `issue:` and the repo has an `origin` remote, offer to post the summary with a `confirm` panel (yes/no); on yes run `gh issue comment <n> -F <summary>`. Never invent an issue number, and never post without the panel.

## Definition of Done

Two things decide whether work is finished, and they are not the same thing.

- **The task's acceptance criteria** — the `## Definition of Done` checklist inside that task's own file. They
  answer *did we build the right thing?*, and they differ from task to task.
- **The standing bar below** — the same for every task and every layer, and it answers *is it ready?*

A task is done only when its own checklist is ticked **and** the standing bar is clear. Ticking a task's boxes
while the bar is not cleared leaves work that looks finished and is not; o-review checks the bar as well, on the
whole change.

| Bar | Clear when |
|-----|------------|
| **Correct** | Every acceptance criterion is met; new behavior has a test that fails without the change and passes with it; the full suite is green; edge cases and error paths are handled, not just the happy path. |
| **Verified** | The change was seen to work — a command run, a request answered, a screen exercised in a browser (`o-browser`) — not merely compiled or typechecked. |
| **Scoped** | The diff touches only what the task required. Anything noticed elsewhere is written down in the run notes, not fixed alongside. |
| **Clean** | The REFACTOR pass ran; no dead code, debug output or commented-out blocks; comments restate nothing; `[Comments]`, `[Bloat]` and `[Architecture]` findings are resolved. |
| **Documented** | The spec (`E00-plan.md`) or the living docs describe the change as it now is, in present tense, with no change history. |
| **Reviewed** | `o-review` and `o-fix` came back clean on the changed files, and `o-floor`'s guard exits 0 on the diff. |

Three rows get claimed far more often than they get checked, and each one is a stop sign:

- *"It's done, I just haven't run it yet."* Unverified work is not done. A check you did not run is not a pass.
- *"The tests pass"* — said while the runtime check, the docs, or the review step was skipped. Green tests are
  one row of the bar, not the bar.
- *"It's done apart from a bit of cleanup."* Deferred cleanup is the cleanup that never lands, and the next task
  builds on it.

## Common Rationalizations

Each of these is an excuse to skip a step, and each is wrong. Spotting one is the signal to run the step, not to argue with it.

| Excuse | Reality |
|--------|---------|
| "This change is too small to commit separately." | Small commits are free; one large commit hides which change broke the suite. |
| "I'll clean up the comments and the abstractions at the end." | Deferred cleanup is the cleanup that never happens. REFACTOR is a step in this workflow, not an intention. |
| "The task is nearly done — I'll skip o-review this once." | The one task you skip review on is the one that lands the defect every later layer builds on. |
| "Re-running the suite will just confirm it." | Re-run after code changed. Repeating it on unchanged code is reassurance, not verification, and it is not a second data point. |
| "This task has UI in it, but I can eyeball it." | o-ui's pre-flight checklist is the check. A screen that fails an item is not done, however it looks. |
| "The user's pattern here is fine, I'll match the file next to it." | Matching a neighbouring mistake is still a mistake. `[Architecture]` and `[Bloat]` findings name the move; make it. |

## Anti-Patterns
See `references/tdd-rules.md` for full list of anti-patterns. Comment noise (restating code, obvious comments, paragraphs that should be a function) is an anti-pattern too — see the Comments section. Scattered side effects and in-place mutation are anti-patterns as well — see the Functional Style section. A defensive branch for a state the types or the internal callers already rule out is an anti-pattern too — see Make the Bad State Impossible.