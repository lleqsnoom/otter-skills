---
name: o-guide
description: Route the user to the right skill or flow for their situation — name where they sit on the map (an idea, a bug, an incoming issue, a foggy effort, cleaning up the codebase) and which skill starts it, so the process for any goal has a first command. Use when asked which skill fits, where to start, what the workflow or process is, or when the user is unsure which skill to run; user-invoked, so it never fires on its own.
version: 1.3.0
author: Community
tags: [router, workflow, skills, navigation, onboarding]
user-invocable: true
disable-model-invocation: true
---

# O-Guide — Which Skill Fits

The set is too large to remember; nobody should have to. When asked which skill fits, place the situation on
the map and name the entry point. Do not run it for them unless asked — a router that starts the work it named
stops being a router.

## The main flow: idea → ship

The route most work travels:

1. **o-plan** sharpens an idea into an approved layered spec (its clarify phase interviews in frontier rounds).
2. **o-decompose** cuts the spec into triaged, layer-based task files.
3. **o-implement** builds the tasks test-first, in dependency order, review-clean per task.
4. **o-review + o-fix** close every task; **o-release** shapes the PR body.

Keep planning in one unbroken context window (plan → decompose); each implementation task starts fresh from
its task file, so its context is disposable.

## On-ramps

A starting situation that generates work, then merges onto the main flow:

- **Incoming bug or request** → **o-triage** structures the intake, then **o-debug** builds the reproduction
  and tests the first hypotheses; **o-investigate** takes over when that explains nothing.
- **Something broke without a report** → **o-debug** directly; **o-investigate** when the first glance explains
  nothing.
- **A question the plan cannot settle** → **o-sketch** (a throwaway prototype answers it) or **o-analyze**
  (evidence and a thesis, then a route).
- **Too big for one spec** → back to **o-plan** with the fog named; the layers say where it splits.
- **A design question the conversation cannot settle** → **o-interview** (the whole-session version of plan's
  clarify rounds).
- **The session must end before the work does** → **o-brief** (the handoff note the next session starts from).

## Upkeep, not feature work

- **o-autoreflection** — turn finished sessions into skill fixes and environment improvements.
- **o-arch / o-arch-lint** — placement, naming, boundaries; the lint proves the tree still matches the
  declaration.
- **o-domain** — the glossary and ADRs every other skill reads.
- **o-skill-lint** — validate this repo's own skills before shipping them.

## Mechanical one-offs

- **o-commit** — the commit message.
- **o-release** — the PR body.
- **o-fix** — resolve a fix plan.
- **o-rollback** — revert, with confirmation.
- **o-parallel** — run independent tasks in isolated worktrees.
- **o-migrate** — a framework or dependency migration.
- **o-test-gen** — scaffold tests from code.
- **o-verify** — attack a fixed change with property and mutation passes, gate on survivors.
- **o-second-opinion** — a fresh-context reviewer re-checks a change before it ships.
- **o-differential** — review just the diff, rating each hunk's regression risk to its callers.
- **o-unbloat** — cut code to what the task needs.
- **o-refactor** — "what should I refactor?": measures, then routes each candidate to o-unbloat, o-arch or o-comments.
- **o-comments** — comment hygiene.
- **o-floor** — declare and enforce the quality floor.
- **o-search** — find where a behavior lives, in this repository or another this machine reads.
- **o-research** — compile sourced findings toward cited coverage.
- **o-tune** — move a number toward a target, one measured change at a time.
- **o-ui / o-browser** — frontend work and its browser check.
- **o-essay / o-humanize / o-roast** — prose: write it, simplify it, score it.
- **o-walkthrough** — script the human-only steps.

**o-decompose** is on the main flow; **o-triage** is an on-ramp, never for tickets the flow itself produced.

## Which one, when two look alike

| Situation | Use | Not |
|-----------|-----|-----|
| A visible error, crash or wrong value | **o-debug** | o-investigate — until the first look explains nothing |
| A failure nobody can explain yet, flaky, or regressed | **o-investigate** | o-debug's first pass alone |
| A new report that needs its facts first | **o-triage** | o-debug — it starts from the brief |
| Review the code of a change | **o-review** | o-roast (prose), o-second-opinion (fresh eyes) |
| How risky is this diff to its callers | **o-differential** | a full o-review |
| A reviewer who never saw the session | **o-second-opinion** | re-running o-review yourself |
| Score a spec, article, plan or skill | **o-roast** | o-review (code only) |
| Write an article that defends a claim | **o-essay** | o-humanize alone |
| Make existing prose easier to read | **o-humanize** | o-essay |
| A question to answer or a decision to weigh | **o-analyze** | o-plan — until you know you will build |
| A feature to build | **o-plan** | o-analyze |
| Gather and cite sources on a topic | **o-research** | o-tune |
| Move a number one measured change at a time | **o-tune** | o-research |
