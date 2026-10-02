# Named pipelines

Which skill chain runs for each task type. A row names only skills that exist in `skills/` at
the time of writing; the list is the process, not advice.

## Ship a feature

`x-plan` → `x-decompose` → `x-implement` → `x-verify` → `x-review` → `x-fix` → `x-release`

- `x-plan` sharpens the idea into an approved layered spec.
- `x-decompose` cuts the spec into triaged task files.
- `x-implement` builds each task test-first, review-clean per task.
- `x-verify` attacks the change after the fix: property tests and a mutation pass.
- `x-review` runs the principles, comments, bloat, architecture and floor passes.
- `x-fix` resolves every finding in the review plan.
- `x-release` shapes the PR body.

## Fix a bug

`x-triage` → `x-investigate` → `x-debug` → `x-reproduce` → `x-verify` → `x-fix`

- `x-triage` structures the intake; `x-investigate` hunts the root cause by hypothesis.
- `x-debug` reproduces, fixes the root cause and verifies; `x-reproduce` generates a minimal case.
- `x-verify` mutants the fix; `x-fix` clears the fix plan.

## Ship anything risky

`x-review` → `x-differential` → `x-second-opinion` → `x-fix`

- `x-review` judges the whole change; `x-differential` maps the diff's regression blast radius;
  `x-second-opinion` re-checks it from a fresh context. `x-fix` clears what any of them found.
