---
name: x-decompose
description: Decompose an approved plan (or an older run's epic) into layer-based tasks, triaging every candidate first — each candidate is decided as a task in this run, a run of its own (x-plan), an analysis (x-analyze), or dropped; outputs <run folder>/E<nn>-triage.md and <run folder>/E<nn>-tasks/ for handoff to x-implement
version: 3.0.0
author: Community
tags: [decompose, tasks, layers, triage, verdict, child-run, definition-of-done, DOD, test-plan, atomic, estimation, self-contained, incremental]
user-invocable: true
---

# X-Decompose — Triaged, Layer-Based Task Decomposition

One task file per sub-step, organized by layer. Each task is a self-contained, testable increment that builds on the previous one. Before any file is written, every candidate is **triaged**: a candidate that hides its own contract gets a run of its own instead of a task in this one. Pipeline order: `x-plan → x-decompose → x-implement`.

## When to use

- An approved plan, or an older run that holds an `E<nn>-epic.md`, whose `## Layers` roadmap is ready to be cut into tasks.
- "Break this epic down", "what are the tasks here", "decompose this".
- A layer that reads as several subsystems at once, so the pass has to decide which step is a task and which is a run.

Not for these: "make me a platform game" is a `x-plan` job first — this skill needs layers to decompose, and it is the pass that turns that request into layers, not the skill that answers it. A single change under an hour belongs in `x-fix` or a direct edit. A candidate whose shape nobody can state yet is routed to `x-analyze` **by** the triage pass; triage does not become that analysis.

## Decomposition Rule

Tasks are not components. A task is one step within a layer, and each layer is a complete, runnable increment.

```
Layer 0 (Skeleton)     → Task 0.1: project setup + basic flow with mock
                         → Task 0.2: add test that verifies end-to-end flow
Layer 1 (Real Logic)   → Task 1.1: implement real processing function
                         → Task 1.2: wire real function into flow, verify regression
Layer 2 (Resilience)   → Task 2.1: add error handling + logging
Layer 3 (Polish)       → Task 3.1: add monitoring + documentation
```

**Key rule:** After any task completes, the system must be in a working state. You should never have "Task 1 done but nothing runs yet."

**Read the architecture before cutting.** `x-arch` (`~/.agents/skills/x-arch/SKILL.md` for a global install, `.agents/skills/x-arch/SKILL.md` for a local one) decides placement, naming, responsibility and dependency direction, and `.x-skills/config/arch.json` declares the boundaries the repo allows. A candidate that would cross a declared boundary does not fit the size cap at rule 7 below: triage it as a run of its own rather than writing it as one task's step.

## Triage Rule

A layer is a coherent increment and a task is one step inside it. Some "steps" are not steps at all: they are subsystems with their own contract, their own layers, and their own unknowns. Written as a task file they hand the implementer an interface nobody agreed on and blow the size cap. Triage is the pass that catches this before a single file exists.

```
candidate from a layer
  ├─ duplicate, or the layer's scope out already covers it ..... drop
  ├─ own contract / own layers / size XL ........................ plan    (its own x-plan run)
  ├─ shape unknown: what to build, or why it fails .............. analyze (its own x-analyze run)
  └─ one change, one check, size ≤ M, no new interface .......... task    (a file in E<nn>-tasks/)
```

**Triage is a reading pass with a verdict — not a second plan, and not implementation.** Per candidate: read the layer entry, search the repository where the candidate lands, walk the signals in `references/triage-rules.md` in order, and stop at the first one that fires. Record the verdict with its reason; `plan` and `analyze` also cite `file:line` or URL evidence, because those two verdicts cost the user a whole run and an uncited decision is a preference.

Two edges catch most mistakes: over the cap with no contract is several tasks (add the extra candidates), not a plan; and a `task` must be earned like any other verdict — if you cannot name the change and the check that proves it in one sentence, it is not a task yet.

## Workflow

1. **Read the layers** — the approved plan's `## Layers` roadmap, `<run folder>/E00-plan.md`, or `<run folder>/E<nn>-epic.md` in a run that holds one. Either artifact carries the same layers: extract each one's objective, scope in, scope out, and DOD. If the roadmap is missing a layer's fields, stop and return to `x-plan` — triage cannot patch an unfinished layer.
2. **Draft the candidates** — one id per step, `L<N>-T<M>`, registered as you go:

```bash
node <path-to-triage.mjs> start --dir <run folder> [--source <plan|epic artifact>]
node <path-to-triage.mjs> add   --dir <run folder> --task L0-T1 --title "one level, one sprite, arrow keys move it"
```

   `start` writes a ledger for the artifact it read and records that artifact as the ledger's `source`. Every later command follows the newest plan or epic in the run, so an ordinary run never needs the flag. A run that numbers two decompositions keeps one ledger each — pass `--source <artifact>` to reach the older one — and each ledger verifies against **its own** tasks rung, not the folder the other decomposition wrote.

3. **Triage every candidate** — the pass this skill exists for:

```bash
node <path-to-triage.mjs> list   --dir <run folder>
node <x-plan skill>/scripts/scenario.mjs    start --slug platform-physics
node <path-to-triage.mjs> decide --dir <run folder> --task L1-T1 --verdict plan \
  --why "own contract: gravity, collision resolution, tilemap format" \
  --evidence "src/game/loop.js:1 - no collision code exists" --child platform-physics
node <path-to-triage.mjs> decide --dir <run folder> --task L0-T1 --verdict task --why "one change, one check, 3h"
```

   1. **Analysis** — read the layer entry, search the repository where the candidate lands, walk the signals. Absence is evidence too: no collision code anywhere is a finding.
   2. **Panel** — one `single` panel per candidate whose proposal is not `task` (`plan` / `analyze` / `task` / `drop`, plus the host's free-text answer), at most three per round, never in prose. A candidate that passes every signal as `task` is recorded without a panel.
   3. **Start the child's run before a `plan` or `analyze` verdict** — the child run *is* what "needs its own plan" means, so open it first, with `x-plan`, or with `x-analyze` when nobody can state the shape yet:

```bash
node <x-analyze skill>/scripts/scenario.mjs start --slug leaderboard-backend
```

   `decide` refuses those two verdicts while the child run does not exist or holds no artifact yet, because the ledger is the record of where the work went and a hand-off to an empty folder is not one. The child owns its own spec, its own layers, and its own tasks: this run writes **no** task file for that candidate.
   4. **Decide** — one verdict per candidate, with its reason, before any task file is written. A candidate that was never registered cannot be decided, and a verdict can be revised by deciding again — which is also how the child run's folder gets into the report when the run was opened afterwards.
   5. **Bound the recursion** — one level. A candidate inside a child run that demands its own plan means the parent's layers were cut too coarsely: stop and say so at the gate instead of spawning a grandchild. If more than half the candidates come back `plan`, the layers were written as a component list — re-cut them, or tell the gate you are not going to and why. What the pass may not do is hand out the fleet silently.

4. **Create the tasks directory and write the files** — `node <path-to-save-tasks.mjs> --epic <slug>`, then one file per `task` verdict, named after its id. See Task Format below. Each layer becomes 1-3 task files. The folder is numbered one rung above the plan it was cut from (`E01-tasks/` when no triage was recorded, `E02-tasks/` after one), so the rung says which artifact the tasks came from rather than a fixed number saying it.
5. **Verify** — record the stop:

```bash
node <path-to-triage.mjs> verify --dir <run folder> [--source <artifact>]   # exit 0 iff triage is complete
```

   | Violation | Raised when |
   |-----------|--------------|
   | `undecided` / `no-reason` | a candidate has no verdict in `task`, `plan`, `analyze`, `drop`, or no reason for it |
   | `no-evidence` / `no-child` | a `plan` or `analyze` verdict cites no `file:line` or URL, or names no child slug |
   | `child-run-missing` | that child run has no folder, or the folder holds no artifact — the run was never started |
   | `task-file-missing` / `task-file-duplicate` / `orphan-task-file` / `verdict-not-task` | the files in this ledger's own `E<nn>-tasks/` and its `task` verdicts do not match one for one |
   | `bad-name` | a task file is not named `L<N>-T<M>-<slug>.md` |
   | `no-tasks-dir` / `no-report` | the tasks folder or the triage report is missing |
   | `no-size` / `bad-size` / `no-complexity` / `bad-complexity` | a task's property block has no `size` or `complexity`, or a value outside its scale (see *Size and complexity*) |
   | `unjustified-l` / `oversize` | a `size: L` with no `complexity_why`, or a `size: XL` — an XL is a plan, not a task |

   The size rows apply to ledgers that record `taskProperties: true`, which every `start` now writes; a ledger started before tasks carried a property block verifies as it always did.

   `verify` prints `{ dir, ledger, source, candidates, taskFiles, tasksDir, violations }` and exits 1 on any violation, 2 on a usage error.

6. **Gate** — confirm the triage report and the task list with the user before handing off to implementation.

## Artifacts

| Artifact | Holds |
|----------|-------|
| `<run folder>/E<nn>-triage.md` | the ledger for **one decomposition**: a row per candidate with its verdict, why, evidence, and the child runs it handed to |
| `<run folder>/triage-<nn>.json` | the same decisions as state, named for the rung of the report it pairs with, so `verify` reads them instead of prose |
| `<run folder>/E<nn>-tasks/` | the tasks written for that ledger's `task` verdicts, `L<N>-T<M>-<slug>.md` |

**This ledger is not `x-triage`'s brief.** Both write `E<nn>-triage.md` and both are read under **Triage**, but `x-triage` writes a bug intake brief for one bug, and this skill writes one verdict per candidate task for one decomposition. If you need to know which document you are holding, read its first line: `# Task triage - <slug>` is this one.

The triage report is a live file and the script owns two blocks of it: `## Verdicts` and `## Handoffs`. Every `add` and `decide` rewrites those and nothing else, so notes written anywhere else in the file survive.

## File Naming

```
<run folder>/E<nn>-tasks/
  L0-T1-one-level-one-sprite.md
  L0-T2-skeleton-test.md
  L1-T1-real-processing.md
```

`L<N>-T<M>` is the id the ledger decides on and `<slug>` is the candidate in a few words. `verify` reads the id from the file name, so a file that does not follow the pattern is a violation, not a style choice. Layer order sorts: `L0` before `L1`, and `T1` before `T2` inside a layer.

## Task Format

```markdown
---
type: task
title: "L<N>-T<M> · <the task name, as in its heading>"
run: "[[runs/<run folder>/index]]"
plan: "[[runs/<run folder>/E<nn>-plan]]"
depends_on:
  - "[[runs/<run folder>/E<nn>-tasks/L<N>-T<M>-<slug>]]"
topics:
  - "[[tags/domain/<a domain tag of the plan>]]"
  - "[[tags/area/<a module this task touches>]]"
size: <XS | S | M | L>
complexity: <clear | complicated | complex>
complexity_why: <one line a reviewer can check: the pattern it copies, the choice it has to make, or what only trying will tell>
created: <YYYY-MM-DDThh:mm>
---
# Task: <descriptive name — what this task accomplishes>
**Layer:** <N> — <layer name from the plan>
**Files:** src/<module>/<file>.js (new), tests/<module>.test.<ext> (mod)
## Goal
<1-2 sentences on what this task makes work that didn't work before>
## Context
<All config, formulas, data shapes, business rules, APIs. Inline everything — never point to another file.>
## Definition of Done
- [ ] <automated check>: `<command>`
- [ ] seen to work, not just compiled: <the command, the request, or the screen that shows it>
- [ ] the diff touches only this task's files
- [ ] REFACTOR ran: no dead code, debug output, or comment that restates code left behind
- [ ] the docs describe the change as it now is (`E00-plan.md`, or the living docs)
- [ ] `x-review` and `x-fix` came back clean on the changed files, and `x-floor`'s guard exits 0
## Test Plan
### Happy Path
- Given <condition> → expect <result>
### Error Paths
- Given <condition> → expect <error response>
## Preconditions
<Concrete codebase state required before starting. Describe the state, not task dependencies within the layer.>
```

**The block on top is for people and Obsidian, not for the implementer.** `title` is what Obsidian shows on the
graph node in place of the file name (through the Front Matter Title plugin), so it reads as the task, not its file. Links are quoted wikilinks from the
`.x-skills` root without `.md` (unquoted, YAML reads `[[x]]` as a nested list). `topics` copies the plan's `domain/` tags, then adds one `area/` tag per module the task's **Files:** touch — a
workspace package (`apps/<x>`, `packages/<x>`, `skills/<x>`), else the top-level folder under `src/`; tests are not
counted. Tag notes are not created here: x-plan creates a run's tags, and the backfill creates area tags for work
that has none yet. `depends_on` lists only the tasks that
produce a state one of this task's Preconditions describes — never a whole layer — and is `[]` when there are none.
`done`, `started`, `finished` and `reopened` are not in the template: x-implement's `status.mjs` writes them from the
Definition of Done boxes, and nobody sets them by hand. `**Layer:**` stays in the body because `status.mjs` reads it
there.

### Size and complexity

**Size is what the change touches**, checked against the diff afterwards. A *module* is a workspace package in a
monorepo, otherwise a top-level folder under `src/`; tests do not count.

| Size | Touches | Is it a task? |
|------|---------|---------------|
| XS | 1 file | yes |
| S | 2–3 files in one module | yes |
| M | 4–10 files in one module | yes — the typical task |
| L | more than 10 files, more than one module, or a contract change (API, schema, public type) | only with a one-line reason in `complexity_why`; otherwise split it |
| XL | several contracts, or an unsettled design | no — triage says `plan` |

**Complexity is how much is unknown**, by one question: *could you write the steps before starting?*

| Complexity | Answer | What it means for the work |
|------------|--------|----------------------------|
| clear | yes — the repo has a pattern to copy | the agent runs it; a light review is enough |
| complicated | yes, after a design call between options | the agent proposes, a person checks the decision |
| complex | no — only trying it will tell | spike or prototype first, a person in the loop |

The two are independent: an XS complex task (one flag with an unknown runtime effect) is riskier than an M clear
one (an endpoint copied from its sibling). Hours are not estimated: an agent's time does not predict the work.

**The first row is the task's own acceptance criterion; the five below it are the standing bar**, the same for
every task in every layer: see *Definition of Done* in `x-implement`'s `SKILL.md` for what each one means. A
task's own rows vary and answer *did we build this?*; the standing rows do not, and answer *is it ready?*. Write
them into every task file rather than assuming the implementer read the bar — an unticked box is how the run says
a task is unfinished, and a bar that lives only in a skill's prose can never be ticked.

### Task Design Rules

1. **Each task = one verifiable change** — After this task, something works that didn't before (or something that was broken now works). Not "created file X" but "file X works and is tested."
2. **A task is what triage said it was** — A `plan` candidate has no task file: it has a run. A `task` candidate has exactly one file, and its layer is finished only when its files are.
3. **Tasks within a layer are small steps** — A layer might be 1 task (simple change) or 3 tasks (complex change broken into steps). But the layer as a whole is the increment.
4. **First task of L0 = working prototype** — This is the most important task. It creates a project skeleton where data flows end-to-end with mocks, and a test proves it works. If this task isn't concrete enough, the plan needs more clarity.
5. **Regression is a DOD item for L1+** — Every task in L1+ must verify that previous layer tests still pass. This is non-negotiable.
6. **No cross-references between task files** — Each file is self-contained. If Task 1.2 needs context from Task 1.1, inline it. The implementer reads one file and has everything they need. A task that consumes what a child run delivers describes the resulting state (`the physics module is present and its tests pass`), never the run it came from. The property block's links are navigation for people and Obsidian, not context: the body never relies on them, and Preconditions still describe a state, never a task.
7. **Size ≤ M per task, or the cap the plan states** — an L needs a one-line reason in `complexity_why`, and an XL is not a task: triage says `plan`. The cap is a working convention, not a measurement: a change that touches more than one module or a contract is exactly where an unstated interface hides, which is what triage is looking for. A plan that carries `constraint: task size ≤ <size>` overrides it. Over the cap a candidate is several tasks, or a `plan` when the size comes from an unsettled contract; triage decides which, and `references/task-rules.md` holds the gates.

### How Many Tasks Per Layer?

| Layer complexity | Tasks | Example |
|-----------------|-------|---------|
| Simple (1 concept) | 1 task | "Add input validation" = one function + one test |
| Medium (2-3 concepts) | 2 tasks | "Real processing" = implement function + wire into flow |
| Complex (many concepts) | 3 tasks | "Error handling" = error types + retry logic + logging |
| Very complex | Split across layers | If a layer needs 4+ tasks, some belong in the next layer |

**Rule:** if a layer needs more than 3 tasks, move the extra tasks to the next layer.

### Layer-to-Task Examples

#### Web Page Project
```
Layer 0 — Skeleton (2 tasks):
  Task 0.1: Project setup + one page that renders a placeholder end-to-end (build, serve, test)
  Task 0.2: Add the test that proves the page renders through the real build

Layer 1 — Real content, one flow (2 tasks):
  Task 1.1: The home page renders real copy and nav links from the content source
  Task 1.2: A visitor can follow the first nav link to a page that renders its own content

Layer 2 — Interactivity (2 tasks):
  Task 2.1: The contact form submits through the real endpoint and shows the response
  Task 2.2: Add the test for the submit flow, including the invalid-input response

Layer 3 — Polish (1 task):
  Task 3.1: Styling, responsive design and accessibility across the flows above
```

**A component is a task only when it works alone.** "Layer 1: header component, Layer 1: main content area" is a horizontal slice: nothing is verifiable until the header, the content and the footer all exist. When a component has to be named, it must stand on its own — its own route, its own render test — or it belongs to a layer that delivers one flow end to end.

#### Data Pipeline (SQS + Lambda)
```
Layer 0 — Skeleton (2 tasks):
  Task 0.1: Create project + basic sender that pushes to mock queue
  Task 0.2: Add Lambda stub that returns fixed response + integration test

Layer 1 — Real Processing (2 tasks):
  Task 1.1: Implement image resize logic in Lambda
  Task 1.2: Wire real processor, verify end-to-end with test image

Layer 2 — Resilience (2 tasks):
  Task 2.1: Add error handling + dead letter queue for failed messages
  Task 2.2: Add retry logic with exponential backoff

Layer 3 — Observability (1 task):
  Task 3.1: Add CloudWatch metrics + structured logging
```

#### Platform Game (triaged, not component-sliced)
```
L0 — Walking skeleton:
  L0-T1  task    one level, one sprite, arrow keys move it, a test proves it renders and moves

L1 — Real movement:
  L1-T1  plan    gravity, collision resolution, tilemap format — child run "platform-physics"
  L1-T2  task    pause menu on top of the skeleton

L2 — Enemies and score:
  L2-T1  plan    enemy behaviour, spawn rules, pathing, damage — child run "enemy-ai"
  L2-T2  analyze leaderboard storage — child run "leaderboard-backend"
```

## Limits

- **What `verify` does not check.** It proves a verdict exists with a reason and a citation, that each child run exists, and that the files and the `task` verdicts agree. It cannot tell a `task` that is really a subsystem from a task. The panel and the user's gate do that; a run that decides every candidate `task` without reading anything verifies clean and is still wrong.
- **One level of children.** `verify` cannot see a grandchild, and a candidate inside a child run that needs its own plan is a signal the parent spec was too coarse — not a third level.
- **Not for an unread layer roadmap.** Triage reads the layer entry it decides. Deciding from the layer title alone is the guess this pass exists to prevent.
- **No cross-run state.** A child run owns its own folder and its own decisions. When a parent task needs what a child delivered, it states the resulting codebase state in its Preconditions.
- **One ledger rules one decomposition.** A run that numbers two decompositions carries a ledger and a tasks rung for each; every command follows the newest source until `--source <artifact>` says otherwise, and no ledger is ever verified against another decomposition's task files.

## Handoff Flow

`<run folder>/E<nn>-tasks/` holds one file per `task` verdict, named by id, and `verify` exits 0 for the ledger that rules it — the ledger rung sits just below the tasks rung it owns, so a second decomposition claims its own pair. Confirm the triage report beside it — the candidates that went to runs of their own — with the user before handing off to implementation. x-implement reads the task files and executes them in order: L0 first, then L1, and so on. Each child run is a run of its own, implemented on its own pass.

## Files

- `scripts/triage.mjs` — the per-decomposition ledger, the verdicts, the report writer, and `verify`.
- `scripts/save-tasks.mjs` — creates `<run folder>/E<nn>-tasks/`.
- `references/triage-rules.md` — the signals, the four verdicts, the bounds, and a worked example.
- `references/task-rules.md` — the size gates a task file must pass.
