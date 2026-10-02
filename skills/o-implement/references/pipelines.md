# Named pipelines

Which skill chain runs for each task type. A row names only skills that exist in `skills/` at
the time of writing; the list is the process, not advice.

## Ship a feature

`o-plan` → `o-decompose` → `o-implement` → `o-verify` → `o-review` → `o-fix` → `o-release`

- `o-plan` sharpens the idea into an approved layered spec.
- `o-decompose` cuts the spec into triaged task files.
- `o-implement` builds each task test-first, review-clean per task.
- `o-verify` attacks the change after the fix: property tests and a mutation pass.
- `o-review` runs the principles, comments, bloat, architecture and floor passes.
- `o-fix` resolves every finding in the review plan.
- `o-release` shapes the PR body.

## Fix a bug

`o-triage` → `o-investigate` → `o-debug` → `o-reproduce` → `o-verify` → `o-fix`

- `o-triage` structures the intake; `o-investigate` hunts the root cause by hypothesis.
- `o-debug` reproduces, fixes the root cause and verifies; `o-reproduce` generates a minimal case.
- `o-verify` mutants the fix; `o-fix` clears the fix plan.

## Ship anything risky

`o-review` → `o-differential` → `o-second-opinion` → `o-fix`

- `o-review` judges the whole change; `o-differential` maps the diff's regression blast radius;
  `o-second-opinion` re-checks it from a fresh context. `o-fix` clears what any of them found.
