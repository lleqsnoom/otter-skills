---
name: x-implement
description: Implement or fix with TDD — parallelize independent tasks with x-parallel, apply x-ui for frontend work, x-arch for placement and naming, and x-unbloat to every change, red-green-refactor per task, verify with x-review + x-fix, gate on plan completion
version: 1.5.0
author: Community
tags: [tdd, implementation, test-driven, red-green-refactor, production-code, parallel, ui]
user-invocable: true
---

# X-Implement — Test-Driven Implementation
**No production code without a failing test first.** Wrote code before the test? Delete it. Rewrite from the test. Exception — confirm with a `confirm` panel (yes/no) first: prototypes, generated code, throwaway scripts.

## Before the first task: read the ledger a decomposition left

A run decomposed by `x-decompose` carries `<run folder>/E<nn>-triage.md` and `triage-<nn>.json`, where every candidate was decided. Two verdicts handed their work to a **child run of their own** — `plan` and `analyze` — and each of those names the layer that waits on it. A layer implemented on top of a child run that never landed is how a run ends up rebuilding what another run was meant to deliver.

```bash
node <path to x-decompose>/scripts/triage.mjs verify --dir <run folder>
```

The `receipts` array says, per child run, whether it delivered: a child that closed with `E<nn>-summary.md`, or whose own `E<nn>-tasks/` are all ticked, is delivered. This is a report, not a gate — `verify`'s exit code does not change because of it. Before starting a layer whose receipts are undelivered, stop and ask with a `confirm` panel (yes/no) whether to proceed anyway; the answer belongs in the run's notes. A run with no `E<nn>-triage.md` (decomposed before this step existed) implements exactly as it does below: no panel, no error.

## Artifact Location

```bash
node <path-to-save-plan.mjs> --epic <slug>
```
The flag is named for the artifact the run was decomposed from — the run's plan, or a legacy `E<nn>-epic.md` — and resolves it either way. The script creates the staging directory. Read all `.md` files inside it — one file per user story.

## Directory Organization
Place a unit with the code that owns it, and name its directory for a domain concept (`orders/`, `billing/`) rather than a file shape (`models/`, `services/`, `controllers/`). A bag name (`utils`, `common`, `shared`, `helpers`, `tools`, `misc`, `other`) says nothing and is not allowed. One file per concern, imports flow from volatile to stable, never in a cycle. `x-arch`'s pass card (`~/.agents/skills/x-arch/references/pass.md` for a global install, `.agents/skills/x-arch/references/pass.md` for a local one) is the fuller statement; see `references/dir-organization.md` for the shape this repo uses.

## Comments

Code must document itself. Comments are a last resort, reserved for what the code cannot express. Follow x-comments rules on every line you write.

- **No trivial comments.** Never restate what the code says (`i++`, `return user`). If the line reads fine alone, it needs no comment.
- **Only the *why*, never the *what*.** A comment earns its place only when the code cannot express the reason: a non-obvious workaround, a CPU-architecture or third-party provider quirk, the source of a magic value, an invariant, or what breaks if changed.
- **Prefer a better name or a smaller function over a comment.** If a block needs a paragraph to explain what it does, extract it into a descriptively named function and delete the paragraph.
- **Strip noise in REFACTOR.** Every refactor pass must remove comments that restate code, not just improve structure.

## No Bloat

Write the least code that works. Follow x-unbloat (`~/.agents/skills/x-unbloat/SKILL.md` for a global install, `.agents/skills/x-unbloat/SKILL.md` for a local one): its ladder before GREEN, and its ladder, table and Never Cut list in REFACTOR. Its rules are not repeated here, so read them there.

## Architecture

Before GREEN, read `x-arch`'s pass card (`~/.agents/skills/x-arch/references/pass.md` for a global install, `.agents/skills/x-arch/references/pass.md` for a local one): it decides where the new unit goes and what it is called. In REFACTOR it judges the placement, the responsibility split, the dependency direction and the inheritance you wrote. Its rules are not repeated here. If the repo has a `.x-skills/config/arch.json`, `x-arch-lint` is the check that proves the task did not cross a declared boundary.

## Functional Style

Prefer a functional approach for readability. Side effects make code hard to reason about and test; isolate them at the edges.

- **Prefer pure functions.** Compute and return values instead of mutating inputs or external state. Given the same inputs, the same result — no hidden state.
- **Avoid side effects in the middle of logic.** Keep I/O, state mutation, and randomness at the boundaries; keep the core logic pure.
- **Prefer immutable data.** Return new values (`map`, `filter`, `reduce`) instead of mutating arrays or objects in place.
- **Prefer expressions over statements.** Chain transformations and use named intermediate values over loops that accumulate into mutable variables.
- **Pass data explicitly.** Return values rather than writing to shared/global state or relying on closures that hide dependencies.
- **Side effects are only acceptable where unavoidable** (I/O, DB, network) — and must be clearly named and isolated.
- **One responsibility per function; keep orchestrators thin.** Each phase (fetch, validate, probe, decrypt) is a named helper that returns data; the orchestrator only composes them. If a function both does a job and reports on it — a `push` closure appending to a shared `results` array inside every branch — the reporting is entangled with each responsibility; collect the report in exactly one place.
- **One responsibility per class and file too.** A class plays one role — persistence, validation, orchestration — not several. If a class's methods group by role rather than by shared state, split it; keep one file per concern (see Directory Organization).

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

Implement tasks in dependency order. When two or more tasks can run independently, dispatch them to background agents with x-parallel instead of doing them one by one.

1. Read every task file under `<run folder>/E<nn>-tasks/`.
2. A task is **independent** when no other pending task modifies the same files and no other task requires its output (check each file's `Preconditions` and `Files:`).
3. Independent tasks run concurrently:
   ```bash
   node <path-to-x-parallel>/scripts/parallel.mjs --tasks <run folder>/E<nn>-tasks --parallel 4
   ```
   x-parallel gives each task an isolated worktree and a full background agent, retries failures, and merges committed results back into your branch.
4. Tasks that depend on one another stay in the inline TDD loop below, in dependency order.
5. After an x-parallel batch merges, run the full test suite, then VERIFY (step 4) on the merged changes before the status update in step 7.

## Frontend Work Uses X-UI

When a task's scope includes UI (HTML/CSS, templates, components, or styles in any framework), apply the x-ui skill to everything you produce:

1. Read the x-ui skill's `SKILL.md` before writing any UI code — `~/.agents/skills/x-ui/SKILL.md` for a global install, `.agents/skills/x-ui/SKILL.md` for a local one.
2. Follow x-ui's method: state the screen's primary task, then build to its strict rules (element count limits, component selection, row actions, status display, pagination rules).
3. Exercise the screen with x-browser before VERIFY, and run x-ui's Pre-Flight Checklist after it. x-ui judges the design; the browser is what shows the screen actually renders and works, which is the *Verified* row of the standing bar. A screen that fails any checklist item is not done.

## Workflow

For each task file in `<run folder>/E<nn>-tasks/`:

0. **START** — record that the task began: `node <skill>/scripts/status.mjs <run folder> --start <task file>`. It stamps
   `started` in the task's property block once; a second call keeps the first stamp.
1. **RED** — Write the minimal failing test for the task's acceptance criterion. It must fail for the *right reason*.
2. **GREEN** — Write the minimum implementation to pass that test. Nothing more. Walk the x-unbloat ladder before writing.
3. **REFACTOR** — Evaluate against SOLID/clean code, the comment rules, the x-unbloat pass (steps 3, 5 and 7), the x-arch pass (placement, naming, responsibility, direction, inheritance), and the functional style above. Strip comments that restate code; extract explained blocks into named functions; push side effects to the edges and prefer pure, immutable functions. State what you assessed and what (if anything) improved — or why no changes were needed.
   - **One-sentence test:** every function you wrote must be describable in one sentence; if not, split it.
   - **Reporting test:** if deleting a phase's `push`/output call leaves the phase unusable, the phase was never a unit. Delegate each phase to a named helper that returns data and let the orchestrator collect the report in one place.
4. **VERIFY — doubt, then x-review + x-fix + test.** Run on every finished task before committing:
   - **Doubt** — on a non-trivial decision (branching logic, a module boundary, an invariant the compiler cannot check, an irreversible change), run the adversarial pass in `references/doubt.md` *before* the review. It is cheaper than review because it aims to disprove the decision while changing it is still cheap.
   - **Test** — run the task's tests and the full regression suite. All must pass.
   - **x-review** — run the review skill on the changed files. It writes a plan (`E<nn>-review-plan.md`) into the run folder, which `x-fix` reads.
   - **x-fix** — resolve every issue in the fix plan. Re-run tests after each fix.
   - Repeat x-review + x-fix until the plan has no unresolved issues and all tests are green.
   - **Size check** — compare the files and modules the diff touched with the task's `size` (XS 1 file · S 2–3 · M 4–10
     in one module · L beyond, or a contract change; tests not counted). When they disagree, say so in the run's
     `memory.md` with both numbers: that record is how the scale gets tuned, so never edit `size` to match the diff.
5. **SYNC DOCS** — Update the spec (`<run folder>/E00-plan.md`) if it exists; otherwise update living docs (README, comments) directly.
6. **COMMIT** — **Run the floor guard first**: `node ~/.agents/skills/x-floor/scripts/floor-guard.mjs --root .` (`.agents/skills/x-floor/scripts/floor-guard.mjs` for a local install). Exit 1 means this task lowered the bar — a new suppression, a skipped test, an unfinished stub, a loosened threshold, or an assertion taken out. Fix the code; never fix it by raising the threshold or widening the ignore list, which is the move the guard exists to catch. Exit 2 means it could not run, and that is not a pass — say so. Then run `node <path-to-commit.mjs> "<message>"` from the x-commit skill for every single commit. This is mandatory and non-negotiable. Never run `git commit` manually. If x-commit exits with an error, stop and ask for a corrected message with an `open` panel (free text only) — do not bypass it.
7. **UPDATE STATUS — the task, then the plan.** Two files, and neither write is optional. First mark where your own
   work ended: `node <skill>/scripts/status.mjs <run folder> --ready <task file>` stamps `ready` once — tests green,
   review clean, committed — before any check a person still owes. `ready − started` is the work, `finished − ready`
   the wait, and only the first says anything about a task's size.

   - **The task** — in the task's own file, change `- [ ]` to `- [x]` under `## Definition of Done` for the checks you ran and saw pass. That checklist carries the task's own criterion plus the five standing rows `x-decompose` wrote in (see Definition of Done above), and both kinds are ticked the same way. A check you skipped, or one deliberately deferred to CI, stays `[ ]`: an unticked box is how the run says the task is not finished, and the layer it belongs to cannot close while it stands.
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
   - Run `x-roast` on the summary, then `x-humanize` on it; each appends its own `E<nn>` artifact beside it.
   - Rewrite the summary from the humanized text.
   - If the plan carries an `issue:` and the repo has an `origin` remote, offer to post the summary with a `confirm` panel (yes/no); on yes run `gh issue comment <n> -F <summary>`. Never invent an issue number, and never post without the panel.

## Definition of Done

Two things decide whether work is finished, and they are not the same thing.

- **The task's acceptance criteria** — the `## Definition of Done` checklist inside that task's own file. They
  answer *did we build the right thing?*, and they differ from task to task.
- **The standing bar below** — the same for every task and every layer, and it answers *is it ready?*

A task is done only when its own checklist is ticked **and** the standing bar is clear. Ticking a task's boxes
while the bar is not cleared leaves work that looks finished and is not; x-review checks the bar as well, on the
whole change.

| Bar | Clear when |
|-----|------------|
| **Correct** | Every acceptance criterion is met; new behavior has a test that fails without the change and passes with it; the full suite is green; edge cases and error paths are handled, not just the happy path. |
| **Verified** | The change was seen to work — a command run, a request answered, a screen exercised in a browser (`x-browser`) — not merely compiled or typechecked. |
| **Scoped** | The diff touches only what the task required. Anything noticed elsewhere is written down in the run notes, not fixed alongside. |
| **Clean** | The REFACTOR pass ran; no dead code, debug output or commented-out blocks; comments restate nothing; `[Comments]`, `[Bloat]` and `[Architecture]` findings are resolved. |
| **Documented** | The spec (`E00-plan.md`) or the living docs describe the change as it now is, in present tense, with no change history. |
| **Reviewed** | `x-review` and `x-fix` came back clean on the changed files, and `x-floor`'s guard exits 0 on the diff. |

Three rows get claimed far more often than they get checked, and each one is a stop sign:

- *"It's done, I just haven't run it yet."* Unverified work is not done. A check you did not run is not a pass.
- *"The tests pass"* — said while the runtime check, the docs, or the review step was skipped. Green tests are
  one row of the bar, not the bar.
- *"It's done apart from a bit of cleanup."* Deferred cleanup is the cleanup that never lands, and the next task
  builds on it.

## Gate

Before committing: evaluate the implementation against SOLID principles, design patterns, clean code, the functional style above (pure functions, immutability, side effects at the edges), and the impossible-state rule (every branch a narrower type would delete). State what you assessed and what (if anything) you improved — or why no changes were needed.

## Common Rationalizations

Each of these is an excuse to skip a step, and each is wrong. Spotting one is the signal to run the step, not to argue with it.

| Excuse | Reality |
|--------|---------|
| "I'll write the test after — it's faster." | A test written after the code tests what you built, not what the task asked for. RED first is the only thing that proves the test can fail. |
| "This change is too small to commit separately." | Small commits are free; one large commit hides which change broke the suite. |
| "I'll clean up the comments and the abstractions at the end." | Deferred cleanup is the cleanup that never happens. REFACTOR is a step in this workflow, not an intention. |
| "The task is nearly done — I'll skip x-review this once." | The one task you skip review on is the one that lands the defect every later layer builds on. |
| "Re-running the suite will just confirm it." | Re-run after code changed. Repeating it on unchanged code is reassurance, not verification, and it is not a second data point. |
| "This task has UI in it, but I can eyeball it." | x-ui's pre-flight checklist is the check. A screen that fails an item is not done, however it looks. |
| "The user's pattern here is fine, I'll match the file next to it." | Matching a neighbouring mistake is still a mistake. `[Architecture]` and `[Bloat]` findings name the move; make it. |

## Anti-Patterns
See `references/tdd-rules.md` for full list of anti-patterns. Comment noise (restating code, obvious comments, paragraphs that should be a function) is an anti-pattern too — see the Comments section. Scattered side effects and in-place mutation are anti-patterns as well — see the Functional Style section. A defensive branch for a state the types or the internal callers already rule out is an anti-pattern too — see Make the Bad State Impossible.