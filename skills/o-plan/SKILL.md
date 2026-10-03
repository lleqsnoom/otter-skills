---
name: o-plan
description: "Plan a feature before coding — turn an idea into a spec the user approves: research the project and the web first, ask short plain questions until the user is sure, weigh the approaches with their trade-offs, then write a layered spec (contract, invariant, test per layer) with guards and a memory file. Use when asked to plan, scope or spec a feature or a rework, or to turn a vague idea into a plan."
version: 2.4.3
author: Community
tags: [plan, spec, requirements, architecture, clarification, testable, layers, prototype]
user-invocable: true
---

# O-Plan — Layered Spec-Driven Planning

Do not write any code until the spec is approved by the user. Pipeline order: `o-plan → o-decompose → o-implement`.

`<skill>` below is this skill's folder. Every script answers `--help` with its commands and flags.

## When to use

- "Plan this", "write a spec", "design X before coding".
- A vague goal you cannot yet name what to build for.
- You need the approaches and their trade-offs on the table before committing.

Not for work a single file can hold, and not for a question the repository already answers — see
`## Limits` before starting a run.

## Scenario

The run is a guarded graph. `state.json` is the single source of truth; `memory.md` records every
event; both sit at the root of the run folder, beside the numbered artifacts.

```mermaid
graph LR
  intake --> research
  research -->|research_recorded| clarify
  clarify --> clarify
  clarify -->|no_open_questions,options_weighed| propose
  propose -->|options_weighed| decide
  decide -->|decision_made| spec
  spec -->|spec_complete| layers
  layers -->|layers_complete| gate
  gate -->|gate_approved| handoff
  gate --> abandon
```

```bash
node <skill>/scripts/scenario.mjs start --slug <slug> [--goal <text>] [--input <the analysis or research file it came from>]
node <skill>/scripts/scenario.mjs record --dir <dir> --event research --data "<finding>"
node <skill>/scripts/scenario.mjs record --dir <dir> --event question --data "<the open question>"
node <skill>/scripts/scenario.mjs record --dir <dir> --event answer --data "<the answer>" --target Q1
node <skill>/scripts/scenario.mjs record --dir <dir> --event option --data "<approach>"
node <skill>/scripts/scenario.mjs record --dir <dir> --event decide --data "<the pick>"
node <skill>/scripts/scenario.mjs record --dir <dir> --event layer --data "L<n>: <the layer's objective>"
node <skill>/scripts/scenario.mjs record --dir <dir> --event approve --data "yes"
node <skill>/scripts/scenario.mjs record --dir <dir> --to <node>
node <skill>/scripts/scenario.mjs record --dir <dir> --events round.jsonl   # a whole round in one call
node <skill>/scripts/scenario.mjs amend  --dir <dir> --data "<what changed and why>"
node <skill>/scripts/scenario.mjs guard  --dir <dir> --gate <name>
node <skill>/scripts/scenario.mjs verify --dir <dir>   # exit 0 only at a stop, see below
```

The guard that refuses a transition reads an event, so recording the right kind is not optional — the
gate you did not feed is the gate that stops the run. These are the kinds the script accepts, and the
guard each one satisfies:

| Kind | Records | Satisfies |
|------|---------|-----------|
| `research` | one finding (or `--status not-run --reason "<why>"`) | `research_recorded` |
| `question` | one open question, answered later as `Q<n>` | `no_open_questions` |
| `answer --target Q<n>` | the answer to that question | `no_open_questions` |
| `option` | one approach with its trade-off (`--reason` when it is the only real one) | `options_weighed` |
| `decide` | the approach the user picked | `decision_made` |
| `layer --data "L<n>: <objective>"` | one layer of the roadmap, into `memory.md` | — the roadmap gate reads the plan text, not this |
| `approve` | the user's approval of the spec | `gate_approved` |

| Gate | Passes when |
|------|-------------|
| `research_recorded` | at least one research finding is recorded |
| `no_open_questions` | every question in `state.json` is answered |
| `options_weighed` | two or more distinct approaches are recorded, or one with the reason no alternative is real |
| `decision_made` | the user picked an approach |
| `spec_complete` | the spec declares `contract:`, `invariant:` and `test:` at the start of a line, and carries a `## Layers` heading |
| `layers_complete` | every `### L<n> — <name>` block carries `**Objective:**`, `**Scope in:**`, `**Scope out:**`, `**Prerequisite:**` and `**Definition of Done:**` — the five fields `o-decompose` reads. A roadmap with no layer block fails rather than passing on nothing |
| `gate_approved` | an `approve` event is recorded |

**Record a round at once.** A `--events` file holds one JSON object per line — `{"event": "question", "data": "…"}`,
`{"event": "answer", "target": "Q1", "data": "…"}`, `{"to": "propose"}` — applied in order and saved once, so a
clarify round is one call rather than one per question.

A mid-run `verify` exits 1 even when every guard passes: it answers only whether the run is finished, and
mid-run it is not. That is the normal state, not a failure. To ask about a single gate while the run is
still going, use `guard --gate <name>` — it exits 0 or 1 on that gate alone.

Completion: `verify` exits 0, or the run moved to `abandon`.

## Workflow

1. **Research first** — search the project, the web, and (for code) GitHub before asking anything. See `references/research-first.md`.
   **Completion:** at least one `research` event is recorded, or the step is recorded `--status not-run --reason "<why>"`.
2. **Clarify** — ask short plain questions as panels (`single` / `multi` / `open` / `confirm`) in frontier rounds until the open list is empty. See `references/questions.md`.
   **Completion:** every `question` event has an `answer`, and `guard --gate no_open_questions` exits 0. Run `scripts/check-questions.mjs --dir <dir>` before asking — it exits 1 on a question that is too long, two ideas, or missing its panel.
3. **Propose the approaches** — usually two or three, each with its trade-off; let the user pick. When only one
   approach is real, record it with `--reason` saying why — a third option invented for a count is filler.
   **A small change** — one module, nothing a later layer would replace — takes the short path: one option with
   `--reason "one-layer change"`, and a roadmap of L0 alone. `o-decompose` cuts it into a task or two.
   **Completion:** the `option` events, one `decide` event, and `guard --gate options_weighed` exits 0.
4. **Write the spec** — See Spec Format below. Always include a Layer Roadmap starting with L0 (prototype).
   **Completion:** `guard --gate spec_complete` exits 0.
5. **Flesh out every layer** — record each one as a `layer` event, and give each `### L<n>` block its five fields. This is the pass that turns a roadmap into something `o-decompose` can cut.
   **Completion:** `guard --gate layers_complete` exits 0 — it names the layer and the field when it refuses.
6. **Gate** — confirm with user before handing off to `o-decompose`.
   **Completion:** an `approve` event, then `record --to handoff`.
7. **Report with evidence** — the message that presents the spec says what it rests on: the sources read (`file:line` or URL), the inputs the user named that could not be read, the questions still open, and the parts written from assumption. A spec that looks complete but skipped a named input is the result a user has to send back.
   **Completion:** `verify --dir <dir>` exits 0.

## Spec Format

Use declarations, not narrative. Put each declaration at the start of its own line: the `spec_complete`
gate looks for `contract:`, `invariant:` and `test:` there, so the same words inside a sentence do not count.

```
goal:         <outcome in one sentence>
contract:     <interface or API shape>       required
invariant:    <what must always hold>        required
test:         <acceptance criterion with given/when/then>   required
constraint:   <non-functional requirement>
deferred:     <decided later>
```

**Required:** `contract`, `invariant`, `test`. The gate refuses to hand off without all three, so a spec
that genuinely has no invariant is a spec with an unanswered question, not a shorter spec — go back and
clarify. `goal`, `constraint` and `deferred` are written only when they apply.

Write an `invariant:` as a property of the design, not as a check that catches its violation: say which
representation makes the bad state impossible to build — a narrowed type, a parsed value, a schema constraint,
a hidden transition — rather than what the code does when it occurs. A bad state the design does not exclude is
a state `o-implement` has to handle; the rule is *Make the Bad State Impossible* in its `SKILL.md`.

Name the edge values the contract must decide — empty, zero, negative, `NaN` or `null`, out of range, a duplicate —
and give each one a result, or say which type rules it out. An edge the spec leaves unnamed is a question for the
clarify step, not a guess the implementer makes alone.

Decision tree for classification: input/output → contract, system property → invariant, acceptance criterion → test, performance/security → constraint, postponed → deferred. If none match → clarify first. **No question → no section.**

Append `## Working notes` for scratch/hypotheses; strip at ship. Optional appendices (only if non-empty): Failure modes, Out of scope, Architecture.

For worked example: see `references/examples/design-spec.md`.

### Layer Roadmap (Required)

Every spec **must** include a `## Layers` section. Define layers from prototype to polish; fill in details during decomposition.

```markdown
## Layers

### L0 — <name: skeleton / prototype / foundation>
**Objective:** <what the prototype demonstrates, in one sentence: which flow completes end to end>
**Scope in:** <what this layer builds — and which parts are stubs, mocks or fixed data, and why>
**Scope out:** <what waits for a later layer>
**Prerequisite:** none
**Risk:** <optional: what could make this layer cost more than it looks, and how that would show>
**Definition of Done:**
- [ ] <automated check>: `<command>`
- [ ] System starts without errors

### L1 — <name: real implementation / core logic>
**Objective:** <what improves over L0>
**Scope in:** <mocks replaced, logic added>
**Scope out:** <what still waits>
**Prerequisite:** Layer 0 complete and passing
**Definition of Done:**
- [ ] All L0 tests still pass (regression)
- [ ] <new testable behavior>
```

The five fields `layers_complete` checks — **Objective**, **Scope in**, **Scope out**, **Prerequisite**,
**Definition of Done** — are the ones `o-decompose` reads. **Risk** is for the person approving: it is not gated,
so write it where a layer hides an unconfirmed fact, a contract with someone else, or work that may not fit.

#### Layer Design Rules

1. **L0 is always a prototype** — the first layer is always a working skeleton with mocks/stubs. If you can't describe what L0 does in one sentence, clarify before writing the spec.
2. **Each layer is independently testable** — after completing a layer, you should be able to run tests and see something work. If a "layer" only makes sense when combined with 3 others, it's not a layer — split it.
3. **Each layer removes one simplification.** L0 has the simplest version of everything. Each later layer replaces a mock with real logic, adds error handling, or improves quality.
4. **Layers have prerequisites** — L(N+1) depends on LN being complete. State this explicitly.
5. **Don't over-plan layers** — define 3-5 layers at the spec level. Details within each layer emerge during decomposition and implementation. It's OK if L4 is just a one-liner like "polish and documentation."

#### How to Define Layers (Decision Guide)

| Situation | Layer breakdown |
|-----------|----------------|
| Web page / UI | L0: basic layout with placeholder content → L1: real components → L2: interactivity → L3: styling/polish |
| API / backend service | L0: routes + mock handlers → L1: real business logic → L2: validation + error handling → L3: auth + middleware |
| Data pipeline (SQS/Lambda) | L0: sender → queue → mock lambda → response → L1: real processing logic → L2: error handling + DLQ → L3: monitoring |
| CLI tool | L0: argument parsing + stub action → L1: real action logic → L2: output formatting → L3: edge cases |
| Library / utility | L0: function signatures + mock returns → L1: real implementation → L2: edge cases + types |

**Rule:** writing "L1: header, L2: footer, L3: navigation" is component decomposition, not layer decomposition. Each layer must be a complete, runnable increment. If you need components, each component must be independently testable (each page renders on its own).

## Artifact Location

```bash
node <skill>/scripts/scenario.mjs start --slug <topic> [--new-run | --run <nn>]
```

- Run folder: `.o-skills/runs/YYYY-MM-DD-hhmm-R<nn>-<topic>/` — one folder per run, holding `state.json`, `memory.md`, and every artifact of the run.
- Artifacts are numbered `E<nn>-<kind>.md` or `E<nn>-<kind>/` in execution order, so a plain name sort lists the run in the order it was built.
- **Tag the run at `start`** — only when the repo keeps a vault (`.o-skills/tags/` exists and
  `.o-skills/config/vault.json` does not say `"enabled": false`; skip this bullet otherwise) — with `--topics domain/<name>,area/<name>`. First list the tags the vault already has
  (`ls .o-skills/tags/domain .o-skills/tags/area`) and reuse one that fits; create a new tag only when none does — a
  near-duplicate (`auth` beside `authentication`) splits the index in two. A **domain** tag says what the work is
  about (`payments`, `teacher-panel`), at most three per run; an **area** tag names a part of the code by the module
  rule (a workspace package `apps/<x>`, `packages/<x>`, `skills/<x>`, else the top-level folder under `src/`). The
  plan carries them as `topics`, and any tag note that does not exist yet is created at
  `.o-skills/tags/<kind>/<name>.md`, embedding the shared `tag.base` that lists everything linked to it.
- Spec report (handoff): `<run folder>/E00-plan.md` — the path `o-decompose` reads. It starts with a property block (`type: plan`, `run`, and `input` when `start` was given `--input`), so Obsidian links the plan to the analysis or research it came from.
- The topic reuses its existing run. Use `--new-run` to start a second run of it, and `--run <nn>` to join a specific one; with two runs and neither flag the command fails rather than picking.
- **Never write over work in progress.** A run folder whose plan still has unchecked layers belongs to
  whoever is implementing it, and the only copy of that state is on disk. Replanning the same work is a
  `--new-run`, never a rewrite of the old folder; when you cannot tell whether the plan is still live, ask
  with a `confirm` panel before touching it.

**The report is a live file, and one block of it belongs to the graph.** Every `record` and `--to`
rewrites the run's `## Scenario` block from the graph, and only that block: the window opens at the
heading on its own line and closes at the end of its mermaid fence. A `## Scenario` *mentioned inside a
sentence* is not a match, and neither is any other section. Write the declarations and the layer roadmap
anywhere outside that block — above it or below it both work, and a spec body is never touched.

## Amend

Plans change once work starts. Change an approved plan in place — edit the section, then record why:

```bash
node <skill>/scripts/scenario.mjs amend --dir <dir> --data "L2 drops the DLQ: the queue retries natively"
```

The line lands at the top of the plan's `## Changelog`, dated. A change to a layer o-decompose already cut is
followed by re-running its triage for that layer; a change to the contract or an invariant is a new run instead.

## Abandon

If user decides not to proceed after clarification, stop. Record reason in working notes. No spec, no layer roadmap.

## Handoff Flow

Artifact must exist on disk with required declarations (contract, invariant, test) and a Layer Roadmap whose every block carries its five fields, before handing off to `o-decompose`. Prove it with `scenario.mjs guard --gate layers_complete` (exit 0).

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "The task is obvious — we can skip the spec." | Ten minutes of spec avoids the rework that starts the moment two people read one sentence differently. |
| "I'll work out the invariant while I build it." | An invariant that arrives after the contract is a redesign, not a detail. `spec_complete` refuses to hand off without one. |
| "There is only one approach; I'll skip the step." | Then record it with `--reason` saying why no other is real. Usually a second one exists once you look, and the trade-off is what the user is approving. |
| "The declarations are a formality — I'll write it as prose." | The gate reads `contract:`, `invariant:` and `test:` at the start of a line, so prose is a spec that cannot hand off. |
| "I'll ask everything at once to save turns." | Every question renders as a panel and carries your guess. A paragraph of batched questions is the shape `check-questions.mjs` exists to refuse. |
| "The layer has no definition of done yet — the checklist is boilerplate." | `layers_complete` refuses a layer without one, because a layer nobody can prove is a layer nobody can finish. |
| "The user named a source I could not open, but the spec is otherwise done." | Say it at the top of the next message and ask. A spec that looks complete while a named input went unread is the one the user sends back. |

## Limits

- **Not for a one-file fix.** A change under an hour with no interface to agree on belongs in `o-fix` or a direct edit. The graph exists to settle a contract before code, and there is nothing here to settle.
- **Not for a question reading can answer.** If the repository already holds the answer, the research step is the whole job: record the finding and route to `o-fix`.
- **What the graph does not check.** `spec_complete` proves the three declarations and the `## Layers` heading exist; `layers_complete` proves each layer block carries its five fields. Neither counts layers, neither proves L0 is a prototype, and neither can tell a testable acceptance criterion from a wish. A human reads those at the gate; `o-decompose` is where a layer that is not an increment surfaces.
- **No cross-run state.** Each run owns its folder and its `state.json`. Two runs of one topic never see each other's decisions — `--run <nn>` joins a run, it does not merge one.

## Files

- `scripts/scenario.mjs` — the run graph, guards, memory, and report writer.
- `scripts/run-folder.mjs` — run-folder resolution, slug and stamp helpers; the module `scenario.mjs` imports.
- `scripts/check-questions.mjs` — enforces the B2 panel rules (`references/questions.md`).
- `scripts/save-spec.mjs` — writes the richer spec skeleton (`contract`/`invariant`/`test` + layers).
- `references/questions.md` — how to ask as a panel, and when to stop asking.
- `references/research-first.md` — the research pass before the first question.
- `references/examples/design-spec.md` — a worked spec.
- `evals/triggers.json` — labelled should/should-not-trigger queries for description tuning.

Every script here is ESM (`.mjs`) on purpose: a project whose `package.json` says `"type": "module"`
treats a `.js` file as ESM too, so a CommonJS copy cannot be imported from `scenario.mjs` and its
`require` throws before the graph starts. Keep new helpers `.mjs`.
