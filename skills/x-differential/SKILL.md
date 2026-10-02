---
name: x-differential
description: Review a change the narrow way — read the diff hunk by hunk, pair each with the behavior it replaced, and rate regression risk for every caller the change puts at stake, so a review focuses on what actually moved instead of re-reading the whole module. Use when a change is risky to reason about end to end, when it touches a shared function, or when a wide x-review needs a narrow second pass over the diff.
version: 1.0.0
author: Community
tags: [review, diff, regression, risk, callers, verification]
user-invocable: true
---

# X-Differential — Review the Change, Not the Module

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
own finding.

## Procedure

1. Collect the diff, the pre-change source, and the spec.
2. For each hunk, name what it replaced, then search the tree for every caller of the changed
   region and list them with `file:line`.
3. Rate each hunk's risk by the three-way table and write the reason in one line.
4. Record the table in the run folder as `E<nn>-differential.md` and route: `silent` rows and
   unmapped hunks become findings for `x-fix`; a table with only `guarded` rows unblocks ship.

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

## Files

- `evals/expectations.json` — the risk discipline as checkable claims.
- `evals/triggers.json` — labelled queries for trigger testing.