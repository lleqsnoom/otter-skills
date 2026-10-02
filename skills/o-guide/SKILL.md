---
name: o-guide
description: Route the user to the right skill or flow for their situation — name where they sit on the map (an idea, a bug, an incoming issue, a foggy effort, cleaning up the codebase) and which skill starts it, so the process for any goal has a first command. Use when asked which skill fits, where to start, what the workflow or process is, or when the user is unsure which skill to run; user-invoked, so it never fires on its own.
version: 1.2.0
author: Community
tags: [router, workflow, skills, navigation, onboarding]
user-invocable: true
---

# X-Guide — Which Skill Fits

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

- **Incoming bug or request** → **o-triage** structures the intake; a hard bug continues through
  **o-investigate** (hypothesis-driven root cause) with **o-debug** (reproduce, fix, verify) and
  **o-reproduce** (a generated repro case).
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
- **o-refactor** — refactoring suggestions.
- **o-comments** — comment hygiene.
- **o-floor** — declare and enforce the quality floor.
- **o-search** — find which repository owns a behavior.
- **o-research** — compile sourced findings.
- **o-api-draft / o-api-swagger** — API design to OpenAPI.
- **o-ui / o-browser** — frontend work and its browser check.
- **o-essay / o-humanize / o-roast** — prose: write it, simplify it, score it.
- **o-walkthrough** — script the human-only steps.

**o-decompose** is on the main flow; **o-triage** is an on-ramp, never for tickets the flow itself produced.
