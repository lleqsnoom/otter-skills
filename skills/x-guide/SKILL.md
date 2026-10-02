---
name: x-guide
description: Route the user to the right skill or flow for their situation — name where they sit on the map (an idea, a bug, an incoming issue, a foggy effort, cleaning up the codebase) and which skill starts it, so the process for any goal has a first command. Use when asked which skill fits, where to start, what the workflow or process is, or when the user is unsure which skill to run; user-invoked, so it never fires on its own.
version: 1.0.0
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

1. **x-plan** sharpens an idea into an approved layered spec (its clarify phase interviews in frontier rounds).
2. **x-decompose** cuts the spec into triaged, layer-based task files.
3. **x-implement** builds the tasks test-first, in dependency order, review-clean per task.
4. **x-review + x-fix** close every task; **x-release** shapes the PR body.

Keep planning in one unbroken context window (plan → decompose); each implementation task starts fresh from
its task file, so its context is disposable.

## On-ramps

A starting situation that generates work, then merges onto the main flow:

- **Incoming bug or request** → **x-triage** structures the intake; a hard bug continues through
  **x-investigate** (hypothesis-driven root cause) with **x-debug** (reproduce, fix, verify) and
  **x-reproduce** (a generated repro case).
- **Something broke without a report** → **x-debug** directly; **x-investigate** when the first glance explains
  nothing.
- **A question the plan cannot settle** → **x-sketch** (a throwaway prototype answers it) or **x-analyze**
  (evidence and a thesis, then a route).
- **Too big for one spec** → back to **x-plan** with the fog named; the layers say where it splits.
- **A design question the conversation cannot settle** → **x-interview** (the whole-session version of plan's
  clarify rounds).
- **The session must end before the work does** → **x-brief** (the handoff note the next session starts from).

## Upkeep, not feature work

- **x-autoreflection** — turn finished sessions into skill fixes and environment improvements.
- **x-arch / x-arch-lint** — placement, naming, boundaries; the lint proves the tree still matches the
  declaration.
- **x-domain** — the glossary and ADRs every other skill reads.
- **x-skill-lint** — validate this repo's own skills before shipping them.

## Mechanical one-offs

- **x-commit** — the commit message.
- **x-release** — the PR body.
- **x-fix** — resolve a fix plan.
- **x-rollback** — revert, with confirmation.
- **x-parallel** — run independent tasks in isolated worktrees.
- **x-migrate** — a framework or dependency migration.
- **x-test-gen** — scaffold tests from code.
- **x-unbloat** — cut code to what the task needs.
- **x-refactor** — refactoring suggestions.
- **x-comments** — comment hygiene.
- **x-floor** — declare and enforce the quality floor.
- **x-search** — find which repository owns a behavior.
- **x-research** — compile sourced findings.
- **x-api-draft / x-api-swagger** — API design to OpenAPI.
- **x-ui / x-browser** — frontend work and its browser check.
- **x-essay / x-humanize / x-roast** — prose: write it, simplify it, score it.

**x-decompose** is on the main flow; **x-triage** is an on-ramp, never for tickets the flow itself produced.
