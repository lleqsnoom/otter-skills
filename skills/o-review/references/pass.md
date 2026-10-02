# o-review — pass card

Read this when o-implement's VERIFY step reviews one task. A review the user asks for reads `SKILL.md`.

## Per host

- **o-implement** (VERIFY, report only): review the files the task changed. Write every finding into one plan;
  `o-fix` applies them.

## Steps

1. **Metrics.** `node <skills>/o-review/scripts/save-plan.mjs --slug <run topic> --reviews <task file>` creates
   `E<nn>-review-plan.md` in the run folder and prints its path. Its `Scope:` line names the files measured;
   rerun with `--files` if the task's differ.
2. **Principles** under `[PRINCIPLE]`: functions describable in one sentence, complexity and length within
   bounds, one responsibility per function and class, no duplication. A function that interleaves phases with
   inline reporting (a `push` into a shared results list in each branch) is CRITICAL.
3. **Comments** under `[Comments]`, in the o-review mode of o-comments' card
   (`<skills>/o-comments/references/pass.md`).
4. **Bloat** under `[Bloat]`, in the o-review mode of o-unbloat's card (`<skills>/o-unbloat/references/pass.md`).
   A check for a state the types rule out is reported here, with the narrower type as the fix.
5. **Architecture** under `[Architecture]`, in the o-review mode of o-arch's card
   (`<skills>/o-arch/references/pass.md`), plus `node <skills>/o-arch-lint/scripts/arch-check.mjs --root .`.
   One row per judged unit (group, verdict, reason, `file:line`); copy the checker's `rated` and `unrated`.
6. **Floor** under `[Floor]`: `node <skills>/o-floor/scripts/floor-guard.mjs --root .`. Copy `rated` and
   `unrated`. Exit 2 means it could not run, which is not clean.
7. **Spec** under `[Spec]`: does the diff implement the originating spec or task? Resolve and judge per
   `SKILL.md`'s Spec pass; on no source, write `no spec available`.

`<skills>` is the folder that holds every o-* skill, this one included.

## Rules

- Every pass heading is written, with `none` when it found nothing. A missing heading reads as a pass that never
  ran, so the plan is incomplete.
- A failed analysis is `unknown`, never zero.
- Lead with leverage: correctness and structure before nits.
- On a re-run, carry each earlier finding forward as resolved or open, and keep findings this task did not
  introduce apart from the ones it did.
- Report only. Never recommend o-comments, o-unbloat or o-arch as a next step; they already ran here.

**Severity:** CRITICAL — SRP violation or bug risk, fix before merge. MAJOR — clear SOLID, KISS or DRY
violation, should fix. MINOR — style or small optimisation.

**Finding format:**

```markdown
- [ ] **Severity:** CRITICAL / MAJOR / MINOR
  - **File:** `path/to/file.js:42`
  - **Issue:** what is wrong, in one sentence
  - **Suggestion:** the concrete fix
```

End with `## Summary`: `**Total issues:** N (critical N, major N, minor N)` and `**Status:** 0/N resolved`. Say
which rows of o-implement's standing bar you could check and which you could not.

## Full rules

Open `SKILL.md` when a case is unclear: `## The Seven Passes`, `## Severity`, `## Output Format`, and
`references/principles.md` for the extract tests.
