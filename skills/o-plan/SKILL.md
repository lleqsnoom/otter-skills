---
name: o-plan
description: "Plan a feature before coding — turn an idea into a spec the user approves: research the project and the web first, ask short plain questions until the user is sure, weigh the approaches with their trade-offs, then write a layered spec (contract, invariant, test per layer) with guards and a memory file. Use when asked to plan, scope or spec a feature or a rework, or to turn a vague idea into a plan."
version: 3.0.0
author: Community
tags: [plan, spec, requirements, architecture, clarification, testable, layers, prototype]
user-invocable: true
budget: 1200
---

# O-Plan — Layered Spec

No code until the user approves the spec. Pipeline: `o-plan → o-decompose → o-implement`.

`<skill>` is this skill's folder. Every script answers `--help`.

## Mode

The spec carries one line that sets how heavy the rest of the pipeline runs: `mode: lean` or `mode: strict`.

- **lean** (default) — short spec, tasks cut one layer at a time, review per layer.
- **strict** — when a wrong guess is expensive or one-way: auth, money, personal data, a migration or a
  delete, a public contract other people build on. Every edge value is named, every layer carries a
  **Risk:**, and o-decompose and o-implement add their per-task gates.

The user's word overrides the pick at any point ("make it strict"); `amend` the line.

## Workflow

1. **Start.**
   `node <skill>/scripts/scenario.mjs start --slug <topic> [--input <analysis or research file>]` creates
   `.o-skills/runs/<stamp>-R<nn>-<topic>/` with `E00-plan.md`, `state.json` and `memory.md`, and prints the
   folder. A topic whose plan still has unchecked layers is somebody's work in progress: start a `--new-run`,
   never rewrite it, and when you cannot tell, ask with a `confirm` panel. If the repo keeps a vault
   (`.o-skills/tags/` exists), tag the run as `references/vault.md` says.
2. **Research before asking.** Read the code, tests, history and docs the goal touches, then the web and prior
   art (`references/research-first.md`). Cite `file:line` or a URL. A fact is never a question.
3. **Ask only decisions, in frontier rounds**: each round asks the questions whose prerequisites are settled. Use
   panels (`single`, `multi`, `open`, `confirm`), at most four per round. Each
   question is one idea in under 20 words and carries your recommended answer (`references/questions.md`).
   Stop when nothing is open or the user says "you decide". One or two rounds is normal.
4. **Weigh the approaches.** Offer two or three real ones, each with a one-line trade-off, and let the user pick
   with a `single` panel. If only one is real, say why no other is; an invented third option is filler. A small
   change (one module, nothing a later layer replaces) takes one approach and an L0-only roadmap.
5. **Write the spec** into `E00-plan.md` in the format below, under the heading the script wrote.
6. **Record the run in one call.** Write the events to a JSON-lines file in the order they happened, then run
   `node <skill>/scripts/scenario.mjs record --dir <dir> --events <file.jsonl>`:

   ```jsonl
   {"event": "research", "data": "<finding> (<file:line or URL>)"}
   {"to": "research"}
   {"to": "clarify"}
   {"event": "question", "data": "<question>"}
   {"event": "answer", "target": "Q1", "data": "<answer>"}
   {"event": "option", "data": "<approach>: <trade-off>"}
   {"to": "propose"}
   {"event": "decide", "data": "<the pick>"}
   {"to": "decide"}
   {"to": "spec"}
   {"to": "layers"}
   {"to": "gate"}
   ```

   A single real approach records its option with `"reason": "<why no other is real>"`. A refused move names
   its gate, for example `layers_complete: L2 is missing **Scope out:**`, and saves nothing. Fix the plan and
   run the same file again.
7. **Gate.** Present the goal, the pick, one line per layer, the mode, and what the spec rests on: the sources
   read, any input the user named that could not be opened, and the parts written from assumption. Then ask
   with a `confirm` panel. On yes:

   ```bash
   node <skill>/scripts/scenario.mjs record --dir <dir> --event approve --data yes --to handoff
   node <skill>/scripts/scenario.mjs verify --dir <dir>   # exit 0: ready for o-decompose
   ```

   If the user drops the work, record `--to abandon` with the reason and stop.

**Strict also** records each clarify round as it happens (one `--events` file per round), so `memory.md` keeps
the trail. Before each round it runs `node <skill>/scripts/check-questions.mjs --dir <dir>` over the round's
questions file.

## Spec format

Write declarations, not narrative. Each one sits at the start of its own line, where the gate looks for it,
and stays within three lines:

```
goal:       <the outcome, one sentence>
mode:       lean | strict
contract:   <the interface, API or data shape>                     required
invariant:  <what always holds, and the type, parse or constraint
             that makes the bad state impossible to build>          required
test:       <given / when / then acceptance>                        required
constraint: <non-functional requirement>                            when it applies
deferred:   <what is decided later>                                 when it applies
```

- **The invariant is a property of the design**, not a check that catches a violation. Name the narrowed type,
  the parsed value, the schema constraint or the hidden transition. See *Make the Bad State Impossible* in
  o-implement's `SKILL.md`. A spec with no invariant has an unanswered question, so it goes back to clarify.
- **Edge values.** Name the ones the contract must decide (empty, zero, `null`, out of range, a duplicate) and
  give each a result. An edge you cannot decide is a question. Strict names every one.
- **No question, no section.** A `## Working notes` list holds only facts the implementer needs that the code
  will not tell them, at most ten bullets.
- **Keep it short.** Aim for under 150 lines. A contract that reads like a design document is two plans: split
  it, or move the rest to `deferred`.

## Layers

Every spec has a `## Layers` roadmap, and every layer block carries all five fields:

```markdown
## Layers

### L0 — <prototype>
**Objective:** <the flow that completes end to end, in one sentence>
**Scope in:** <what it builds, and which parts are stubs and why>
**Scope out:** <what waits for a later layer>
**Prerequisite:** none
**Definition of Done:**
- [ ] <automated check>: `<command>`

### L1 — <real logic>
**Objective:** <what improves over L0>
**Scope in:** <the stubs replaced, the logic added>
**Scope out:** <what still waits>
**Prerequisite:** L0 complete and passing
**Definition of Done:**
- [ ] L0 tests still pass
- [ ] <new testable behavior>: `<command>`
```

1. **L0 is a working prototype.** It uses stubs and fixed data. If you cannot say what it does in one sentence,
   clarify first.
2. **Each layer runs and tests on its own, and removes one simplification**: a stub becomes real, error
   handling arrives, polish lands. "L1 header, L2 footer" is a component list, not layers.
3. **Two to four layers, one line per field.** The detail belongs in o-decompose.
4. **Typical cuts.**
   - API: routes with mocks → logic → validation and errors → auth.
   - UI: layout with placeholders → real components → interactivity → polish.
   - Pipeline: end to end with a mock step → real processing → error handling and retries → monitoring.
   - CLI: parsing with a stub action → the real action → output → edge cases.
5. **Strict layers** add `**Risk:**`: the unconfirmed fact, the outside contract, or the work that may not fit.

## Amend

To change an approved plan, edit the section, then run
`node <skill>/scripts/scenario.mjs amend --dir <dir> --data "<what changed and why>"`. That adds a dated line
under `## Changelog`. A changed layer that o-decompose already cut gets cut again. A changed contract or
invariant gets a new run.

## Limits

- **Not for a one-file fix** (use o-fix or a direct edit), and not for a question the repository already
  answers.
- **The gates check shape, not quality.** They prove the three declarations and the five layer fields exist.
  The user's approval is the quality check.

## Files

`scripts/save-spec.mjs` writes a spec skeleton. `references/examples/design-spec.md` is a worked spec.
