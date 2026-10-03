---
name: o-differential
description: Rate the regression risk of a diff hunk by hunk — what each hunk replaced, which callers it puts at stake, and whether a break would be silent, guarded or loud — mapping the blast radius so a review covers exactly what moved. Use when a change is risky or touches a shared function, when asked which changes could fail silently or break callers, or for a narrow second pass after o-review.
version: 1.1.1
author: Community
tags: [review, diff, regression, risk, callers, verification]
user-invocable: true
---

# O-Differential — Review the Change, Not the Module

A wide review reads the module; the change is the module's delta, and the delta is what ships.
This pass reads only the delta, hunk by hunk, and asks of each what it replaced and who now
depends on the new shape. The output is a regression-risk table, not a verdict: a wide review
and a second opinion decide, this pass maps the blast radius.

## What the pass reads

1. **The diff** — each hunk, on its own, in the order it applies.
2. **What it replaced** — the prior behavior, read from git history (the pre-change file) and
   the spec or task the change implements.
3. **Who calls it** — every caller of a changed region, found by searching the tree for the
   symbol or shape the hunk touched.

The pairing is per hunk: one hunk, the behavior it replaced, the callers it puts at stake.
A hunk whose replaced behavior cannot be named is the first finding, before any risk is rated.

## The risk table

For every hunk, one row:

| Hunk | Replaced | Callers at stake | Risk | Why |
|------|----------|------------------|------|-----|

**Risk** is one of `silent`, `guarded`, `breaking`:

- **silent** — a change whose failure no test or caller would notice (an error swallowed, a
  default shifted). This is the risk that matters most, because it ships green.
- **guarded** — a failure a test or a caller check would catch. Note which one.
- **breaking** — the caller contract changed: a signature, a return shape, a thrown error.

A row without a caller is a gap: a changed region nobody calls is dead code, and that is its
own finding — unless it is an entry point or an export. A CLI command, a route or event handler, a test, and
an exported function of a library have their callers outside the code you can search; write which one it is
in the Callers column instead of reporting it dead.

## Procedure

1. Collect the diff, the pre-change source, and the spec. Start the table from the script:

   ```bash
   node <skill>/scripts/hunks.mjs --base main --table     # or --base HEAD for uncommitted work; JSON without --table
   ```

   It lists every hunk with the range it replaced, the symbol it sits in, and that symbol's callers — in its own
   file, and in the files that import its module when it is exported (by `export`/`pub`, a public Python name or a
   capitalised Go name). Added code is split one row per declaration, and untracked files are included as new code.
   The Risk and Why columns are yours.
2. For each hunk, name what it replaced (read the old range), then check the listed callers and add any the
   script cannot see — a call built at run time, a caller in another repository — with `file:line`.
3. Rate each hunk's risk by the three-way table and write the reason in one line.
4. Record the table in the run folder as `E<nn>-differential.md` and route: `silent` rows and
   unmapped hunks become findings for `o-fix`; a table with only `guarded` rows unblocks ship.

## Rules

- **The diff is the unit.** Never summarize a hunk away, and never merge two hunks into one row
  because they are "close enough" — a merged row hides which half carries the risk.
- **A caller is `file:line` or it is not listed.** "other callers" is not a finding.
- **Risk follows the replaced behavior, not the author.** A hunk is rated by what its failure
  would do to a caller, never by who wrote it or how it reads.
- **Silent is the top severity.** A breaking change at least fails loudly; a silent one is the
  regression nobody knows to hunt for.

## Output format

```markdown
# Differential review — <run topic>

## Table
| Hunk | Replaced | Callers at stake | Risk | Why |
|------|----------|------------------|------|-----|
| <file:line range> | <prior behavior> | <caller file:line, ...> | <silent|guarded|breaking> | <reason> |

## Unmapped hunks
- <hunk> — <why its replaced behavior could not be named>
```

`<skill>` is this skill's folder. Every script answers `--help` with its commands and flags.

## Files

- `scripts/hunks.mjs` — the hunk list, the enclosing symbols and their callers, as JSON or as the table skeleton.

- `evals/expectations.json` — the risk discipline as checkable claims.
- `evals/triggers.json` — labelled queries for trigger testing.