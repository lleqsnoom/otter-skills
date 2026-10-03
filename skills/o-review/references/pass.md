# o-review — pass card

Read this when o-implement's VERIFY step reviews one task. A review the user asks for reads `SKILL.md`.

## Per host

- **o-implement** (VERIFY, report only): review the files the task changed. Write every finding into one plan;
  `o-fix` applies them. An XS or S task gets a light review: steps 1, 2, 6 and 7 in full, and steps 3–5 each
  write `skipped — light review`.

## Steps

1. **Metrics.** `node <skills>/o-review/scripts/save-plan.mjs --slug <run topic> --reviews <task file>` creates
   `E<nn>-review-plan.md` with every heading and prints its path. Rerun with `--files` if the task's files differ
   from its `Scope:` line.
2. **Correctness** under `[Correctness]`: is each changed path right — boundaries, error paths, shared state,
   untrusted input reaching a shell, query or path, callers of a changed signature? Name the input that shows each
   finding and the test that would catch it.
3. **Principles** under `[PRINCIPLE]`: one sentence per function, complexity and length within bounds, one
   responsibility per function and class, no duplication. Start from the plan's **Over the bar** list; untouched
   functions are not findings.
4. **Comments** under `[Comments]` and **Bloat** under `[Bloat]`, in the o-review mode of each card
   (`<skills>/o-comments/references/pass.md`, `<skills>/o-unbloat/references/pass.md`). A check for a state the
   types rule out is Bloat, with the narrower type as the fix.
5. **Architecture** under `[Architecture]`, in the o-review mode of `<skills>/o-arch/references/pass.md`, plus
   `node <skills>/o-arch-lint/scripts/arch-check.mjs --root .`. Copy the checker's `rated` and `unrated`.
6. **Floor** under `[Floor]`: `node <skills>/o-floor/scripts/floor-guard.mjs --root .`. Copy `rated` and
   `unrated`. Exit 2 means it could not run, which is not clean.
7. **Spec** under `[Spec]`: does the diff implement the task, no more and no less? On no source, write
   `no spec available`.

`<skills>` is the folder that holds every o-* skill, this one included.

## Rules

- Every heading is written: `none` when a pass found nothing, `skipped — light review` when it did not run.
- A failed analysis is `unknown`, never zero.
- Lead with leverage: correctness first, then structure, then nits.
- On a re-run, carry each earlier finding forward as resolved or open.
- Report only. Never recommend o-comments, o-unbloat or o-arch as a next step; they already ran here.

**Severity:** CRITICAL — wrong behaviour, data loss or a security hole. MAJOR — a likely bug not yet shown, or a
clear SOLID, KISS, DRY or responsibility violation. MINOR — style or small optimisation.

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

Open `SKILL.md` when a case is unclear: `## The Eight Passes`, `## Light Review`, `## Severity`, and
`references/principles.md` for the extract tests.
