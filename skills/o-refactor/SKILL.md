---
name: o-refactor
description: "Answer \"what should I refactor here?\" — measure the module, then route each candidate to the skill that owns it: dead code and needless layers to o-unbloat, where code lives and what it is called to o-arch, noisy comments to o-comments, and a long function, a branch chain or a one-call helper to a before/after suggestion written here. Use when asked for refactoring suggestions or where to start cleaning up a module; it never edits code."
version: 2.0.2
author: Community
tags: [refactoring, code-quality, router, extract-method, clean-code]
user-invocable: true
---

# O-Refactor — Which Refactor, and Whose

"Refactor this" is four different jobs, and three of them already have a skill. This one measures, decides which
job each candidate is, and hands it to the skill that owns it. It never edits code.

`<skills>` below is the folder that holds every o-* skill. Every script answers `--help` with its commands and flags.

## Steps

1. **Measure** the target (a path, or the files the branch changed):

   ```bash
   node <skills>/o-review/scripts/analyze-complexity.mjs <file-or-dir>   # length, complexity, parameters per function
   node <skills>/o-review/scripts/analyze-patterns.mjs <file-or-dir>     # compound names, long if/else chains,
                                                                         # trivial single-call helpers
   ```

   Say which engine `analyze-complexity` used (`summary.language`); the regex fallback has approximate lines.
2. **Read before routing.** A metric points; it does not decide. Open each flagged function and confirm the
   smell is real — a long function that is one flat table of data is not an extraction.
3. **Route each candidate** by the table below, and write the result as one list: `file:line`, the candidate,
   the skill it goes to, and one sentence of why.

| The candidate is… | It goes to |
|---|---|
| Code that need not exist: dead code, a pass-through wrapper, an unused option, a one-implementation interface | **o-unbloat** — its ladder decides keep or cut |
| In the wrong place or badly named: a `utils` file, a feature split across folders, a wrong-way import, a role-shaped name, an inheritance chain | **o-arch** |
| A comment that restates the code, or a block that needs a paragraph to explain | **o-comments** |
| A long function doing two jobs, a 4+ branch chain on one value, a one-call helper that adds no name | **here** — a before/after suggestion |

4. **Write the in-function suggestions** (the last row) as: the pattern (extract, replace the chain with a table,
   inline), a before snippet, an after snippet, and what a reader no longer has to hold in their head. A
   suggestion that adds a function or file names the second caller or the idea that pays for it.
5. **Rank** the list by leverage, the most complexity removed for the least change first, and stop. Applying
   any of it is `o-fix`'s job from a plan the user approved, or the routed skill's when the user asks for it.

## Definition of Done

- Both scripts ran on the target, and the engine is named.
- Every candidate has a `file:line`, a route, and a reason a reviewer can check.
- No code was changed.
