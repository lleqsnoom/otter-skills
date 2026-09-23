# Task Decomposition Rules Reference

## Core Rules

- **One candidate = one task = one file.** Never split one triaged candidate across multiple task files, and never give a `plan` or `analyze` candidate a file at all — that work belongs to its own run. See `triage-rules.md`.
- **Self-contained.** No file path references, no task IDs (T1, T2...), no "see other task," no "handled by T3." A developer reads one file and knows exactly to build.
- **No exact code.** No step-by-step implementation instructions. Describe *what* to verify, not *how* to write it.
- **Effort gate enforced.** Every task must be ≤4 hours of human work, the cap the skill states. A candidate over the cap is either several candidates or a `plan`; triage decides which, so a task file that arrives over the cap means the triage pass was skipped.
- **DOD mandatory.** Every task needs at least one automated check (test/lint/typecheck). When none is possible, state explicit manual steps + expected result.
- **Test plan required.** Happy path + all error paths listed. No exceptions.
- **Context section mandatory.** Inline all config, formulas, data shapes, business rules, and module API details. This section is what makes the file self-contained.
- **Each task leaves the repo green.** If a task can't leave it green on its own, the candidate is too large — triage it again.

## Size Gates (enforced before approval)

| Gate | Rule | Action if failed |
|------|------|-----------------|
| **Effort** | Task >4h estimated | Triage again: `plan` if it hides its own contract, otherwise split it into more candidates |
| **Components** | Task touches 3+ unrelated new components (not a cohesive unit) | Triage again: this is usually `plan`, because the components share an interface nobody has fixed |
| **Self-contained** | Task references another file, task ID, or "see X" | Inline the missing context into this file |
| **Synthetic data only** | Test plan relies solely on mock/synthetic data with no real-data acceptance criterion | Add a production-data verification step |

None of these gates sends work back to `x-epic`. Triage already offered that route; a candidate that fails
a gate here is triaged again, not bounced up the pipeline.

## What NOT to put in a task file

- References to other task files or task IDs (T1, T3, etc.)
- Epic or spec file path links — inline the relevant content instead
- A child run's slug or folder — describe the state that run delivers instead ("the physics module is present and its tests pass")
- "Depends on T2" or "handled by T1" — use Preconditions with concrete state descriptions
- Background or architecture rationale (epic's job — inline only task-relevant facts)
- Step-by-step implementation instructions
- CI commands or build pipeline details
