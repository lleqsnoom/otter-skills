---
name: o-review
description: Review a change before it merges — is it correct (edge cases, error paths, untrusted input, security), is it simple (small functions, SOLID, KISS, DRY), does it match its spec — with AST complexity counts for the code the change touched. Runs the comments, bloat, architecture and quality-floor passes inside every review and writes one fix plan for o-fix. Use when asked to review code, a diff, a branch, a module or the changes before a PR.
version: 2.6.1
author: Community
tags: [code-review, solid, kiss, dry, single-responsibility, cyclomatic-complexity, code-quality]
user-invocable: true
---

# O-Review — Code Review Against Engineering Principles

A review is eight passes over the same scope, and all eight write their findings into one plan file. Passes 4–7
are child skills run **inside** this review — they are not follow-ups to recommend afterwards. Correctness comes
second, right after the numbers: a wrong result outranks every finding about how the code is shaped.

`<skills>` below is the folder that holds every o-* skill, this one included.

## The Eight Passes

| # | Pass | Runs | Writes |
|---|------|------|--------|
| 1 | **Metrics** | `save-plan.mjs` — complexity, duplication, refactor patterns | the counts at the top of the plan |
| 2 | **Correctness** | this skill's correctness and security questions below | `[Correctness]` |
| 3 | **Principles** | this skill's rules and `references/principles.md` | `[PRINCIPLE]` sections |
| 4 | **Comments** | **o-comments**, run as a pass (report only) | `[Comments]` |
| 5 | **Bloat** | **o-unbloat**, run as a pass — its ladder and table (report only) | `[Bloat]` |
| 6 | **Architecture** | **o-arch**, run as a pass, plus **o-arch-lint**'s `arch-check.mjs` | `[Architecture]` |
| 7 | **Floor** | **o-floor**'s `floor-guard.mjs` on the diff | `[Floor]` |
| 8 | **Spec** | this skill's spec-resolution rules below | `[Spec]` |

A plan missing `[Correctness]`, `[Comments]`, `[Bloat]`, `[Architecture]`, `[Floor]` or `[Spec]` is **incomplete,
not clean**: every pass writes its heading on every review, including a re-run, and says plainly when it found
nothing. Every pass reports; applying the fixes is `o-fix`'s job.

## Light Review

A change of at most about 50 changed lines, with no new interface, schema or public contract — or a task sized XS
or S — gets a **light review**: Metrics, Correctness, Floor and Spec run in full, and the Principles, Comments,
Bloat and Architecture headings each say `skipped — light review (<n> changed lines)`. Say at the top of the plan
that it is a light review and why. Anything a light review notices that looks structural earns the full one.

## Two Ways It Runs

**As a pass inside another skill:** o-implement's VERIFY step reads `references/pass.md`; it owns the task-review
steps.

**On its own**, when the user asks for a review: every section below applies.

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory by passing the full path:

```bash
# Run from anywhere (use whichever script path is available):
node <skill>/scripts/analyze-complexity.mjs --all       # AST-based complexity, length, params per function
node <skill>/scripts/check-duplication.mjs --all         # duplicated blocks (>5 lines)
node <skill>/scripts/save-plan.mjs --slug <topic> [--reviews <task file>] [--base <ref> | --all | --files a,b]   # create plan file with all analysis results
```

`save-plan.mjs` measures the change by default: the source files changed since the merge-base with `main` (else
`master`), committed or not, so a review run before the commit measures the work in progress. `--base <ref>` picks
another ref, `--files` names the files, and `--all` measures every tracked file. The plan's `**Scope:**` line names
what was measured; an empty change reads `not measured`, never 0. `check-duplication.mjs` finds blocks repeated
inside one file, not copies across files.

`<skill>` is this skill's folder; its scripts find their own files from there, so run them from any directory.

## What To Do

When invoked, determine the user's scope (single file, directory, or full project), decide full or light review
from its size, and run the passes below into the one plan file. When the repo keeps a `GLOSSARY.md`, read it first
and write findings in its terms. Do not ask the user what to do, and do not stop
after the metrics.

1. **Metrics pass — create the plan with all analyses**: `node <skill>/scripts/save-plan.mjs --slug <topic>` — this runs complexity analysis (AST-based via tree-sitter), duplication check, AND refactor pattern detection in one step. It writes `E<nn>-review-plan.md` into the run folder and prints the full path. When the review is of one task (as o-implement's VERIFY step runs it), pass `--reviews <task file>`: the plan's property block then links the task it reviewed, so Obsidian shows the review hanging off it.
2. **Correctness pass** — read the changed code for whether it is *right*, before how it is shaped, and report
   under `[Correctness]`:
   - **Logic** — does each changed path compute what it claims, including the boundaries (empty input, zero,
     one, the maximum, off-by-one at both ends)?
   - **Error paths** — what happens when a call fails, a value is missing, or input is malformed; is anything
     swallowed, retried forever, or left half-written?
   - **State and concurrency** — shared mutable state, ordering assumptions, races between async steps,
     resources opened and never closed.
   - **Security** — untrusted input reaching a shell, a query, a path, a template or `eval`; secrets in code or
     logs; a permission or ownership check missing on a new path.
   - **Compatibility** — a changed signature, return shape, default or persisted format that existing callers
     or stored data still depend on.

   A finding that produces a wrong result, loses data or opens a security hole is CRITICAL; a likely-but-unproven
   one is MAJOR with the input that would show it. Name the test that would catch each finding.
3. **Principles pass** — write the complexity, SOLID, KISS, DRY and SRP findings into the plan as `[PRINCIPLE]` sections, using the format below.
4. **Comments pass (part of the review, using o-comments)** — apply the rules in o-comments' pass card (`<skills>/o-comments/references/pass.md`) to every reviewed file. Report comment issues under a `[Comments]` heading in the plan: comments that restate code, obvious comments, and paragraph-long explanations that should be a named function. Report only — `o-fix` makes the edits.
5. **Bloat pass (part of the review, using o-unbloat)** — apply the ladder and table in o-unbloat's pass card (`<skills>/o-unbloat/references/pass.md`) to every reviewed file, in the card's o-review mode. Report findings under a `[Bloat]` heading in the plan, each naming the ladder rung it fails and the unbloated version: speculative abstractions (one-implementation interfaces, single-use factories, pass-through wrappers) are MAJOR; dead code, unused options, and re-implemented stdlib are MINOR. A branch for a state the types or the internal callers rule out is reported here too, with the narrower representation named as the fix (o-unbloat's *Bloat, Unless…* row; the rule is *Make the Bad State Impossible* in o-implement's `SKILL.md`) — MAJOR when a caller must handle a failure the type could have excluded, MINOR when the check is only redundant, and never flagged where the input crosses a trust boundary. Never flag what o-unbloat's *Never Cut* list or a *Keep it if* exception protects. Report only: the cuts are o-fix's job.
6. **Architecture pass (part of the review, using o-arch and o-arch-lint)** — apply the rules in o-arch's pass card (`<skills>/o-arch/references/pass.md`) to every reviewed file, in the card's o-review mode: all five groups, report only. Then run `node <skills>/o-arch-lint/scripts/arch-check.mjs --root .`. Report findings under an `[Architecture]` heading: a bag name, a crossed boundary, a misplaced responsibility or a wrong-way import is MAJOR. Give the heading one row per unit the pass judged, naming the group, the verdict, the reason and a `file:line`, and copy the checker's `rated` and `unrated` lists in so a green run over an undeclared tree is not read as full coverage. Report only: the moves are o-fix's job.
7. **Floor pass (part of the review, using o-floor)** — run `node <skills>/o-floor/scripts/floor-guard.mjs --root .`. It compares the quality floor declared at the merge base with the one on disk and reports the moves that lower the bar — a weakened threshold, a dropped rule, a new or extended exception, a silenced checker, unfinished work, a test made easier, a deleted test, or an assertion removed from a test that still exists. Report each under a `[Floor]` heading with its `rule`, `file` and `line`, and copy the guard's `rated` and `unrated` lists in verbatim: a repo with no `.o-skills/config/floor.json` is reported as unrated rather than as clean. Exit 2 is **not** a clean result — say the guard could not run and why. Report only: the fixes are o-fix's job.
8. **Spec pass** — ask one question of the whole change: does the diff faithfully implement the originating spec,
   ticket, or task? Resolve the spec source in this order: (1) task or issue references in the commit messages;
   (2) a path the user passed to the review; (3) a plan or task artifact in the run folder (`E00-plan.md`, a task
   file under `E<nn>-tasks/`); (4) none of these — ask the user, and on "there isn't one" report `no spec
   available` under `[Spec]` and move on. Where a source resolves, check three things: every acceptance criterion
   it states is met, nothing is built that the spec does not ask for, and nothing the spec requires is silently
   deferred. A requirement the diff does not meet is MAJOR; an unrequested behavior change is MAJOR; a deferred
   item with no record in the plan is MAJOR. Report findings under `[Spec]` in the finding format below.
9. **Unmeasured analyses** — an analysis script that failed is not a zero; carry `save-plan.mjs`'s "Analysis incomplete" note into the plan rather than reporting a clean result.

The complexity script never installs anything on its own: when a grammar it needs is missing it prints the `npm install -g …` command and falls back to the regex engine for those files. Ask the user before running that command, or before rerunning with `--install-grammars`. Each script prints JSON, and the keys mislead on first read — `functions` is nested inside a file, and `duplicatedBlocks` is a **count**, not the list:

```
analyze-complexity.mjs   { files: [ { file, functionCount, functions: [ { name, line, length, complexity, paramCount, issues[] } ] } ],
                          summary: { totalFiles, totalFunctions, highComplexity, longFunctions, tooManyParams, language, thresholds } }
check-duplication.mjs    { totalFiles, duplicatedBlocks, duplicates: [ { file, lines, occurrences[], sample } ] }
analyze-patterns.mjs     { results, totalFiles, message }
```

`summary.language` says which engine ran: `tree-sitter (AST-based)` or `regex fallback`. Regex metrics have no parameter counts and approximate line numbers, so say which engine you reviewed with when it is not the AST one.

A count in the plan is a measurement, and an unmeasured count is not a zero. When an analysis script fails, `save-plan.mjs` writes `unknown — <script> failed, so this was not measured` and an "Analysis incomplete" note naming the reason. Carry that into the review: never report a failed analysis as a clean result.

For engineering principles definitions and violation patterns, see `references/principles.md`.
For language-specific review criteria, see `references/lang-typescript.md` (TypeScript),
`references/lang-python.md` (Python), `references/lang-go.md` (Go) and `references/lang-rust.md`
(Rust) — when the change is one of those languages, read its pack and apply it under
`[PRINCIPLE]`; for a language with no pack, say so rather than inventing criteria.

**After running the scripts:** The plan file path is printed by `save-plan.mjs`. Open that file with your file tools, then write your review content directly into it using the format below. **Do not use MCP resources to read/write plan files — they don't exist.**

## Related Skills

Each pass's rules live in its own skill's pass card; this skill never restates them.

| Skill | Pass | Heading | Fixed by |
|---|---|---|---|
| o-comments | 4 | `[Comments]` | o-fix, without changing behaviour |
| o-unbloat | 5 | `[Bloat]` | o-fix, by its *Keep it if* and *Never Cut* rules |
| o-arch + o-arch-lint | 6 | `[Architecture]` | o-fix |
| o-floor | 7 | `[Floor]` | o-fix |

- **o-fix** reads this plan and resolves every finding, from every pass.
- **o-differential** is the narrow second pass over a risky diff; **o-second-opinion** is a review from a fresh context.
- **o-debug** takes a runtime failure that needs a reproduction rather than reading.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "The diff is small — I'll read it and say LGTM." | A small diff gets a light review, not none: Correctness, Floor and Spec still run, and every heading is written. |
| "Those passes found nothing here, so I'll leave the heading out." | A pass that found nothing writes `none`. A missing heading is indistinguishable from a pass that never ran. |
| "This file is already huge, I'll just review the diff." | Then say so and ask for a split. Reviewing around a structural problem is how it gets buried; the size is itself a finding. |
| "Ten nits and one structural problem — I'll list them in order." | Lead with leverage: correctness and structure first. If there is one structural problem and ten nits, the structural problem *is* the review. |
| "I noticed dead code, but I won't ask about deleting it." | List it and ask. Silently deleting what you do not fully understand is the other failure, and leaving it unmentioned hides it from the next reader. |
| "The Scope line is close enough to what I was asked to review." | Then the counts describe other files. Rerun with `--files` or `--base`, and say whether the engine was the AST one or the regex fallback. |
| "The analysis script failed, so the count is zero." | An unmeasured count is not a zero. Carry the "Analysis incomplete" note into the plan and never report a failed analysis as a clean result. |

## Severity

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Wrong behaviour, data loss, or a security hole — shown, or shown how to trigger | Must fix before merge |
| MAJOR | A likely bug not yet shown, or a clear SOLID/KISS/DRY/responsibility violation | Should fix |
| MINOR | Style or minor optimization | Nice to have |

Structure is never CRITICAL on its own: a design problem is a MAJOR until it produces a wrong result. A function
that interleaves phases (fetch, validate, probe, decrypt) with inline reporting (`push` to a shared results array
inside each branch) is the commonest MAJOR — verify it with the two extract tests in `references/principles.md`
(one-sentence test, reporting test).

## The Standing Bar

The seven code passes judge the code; the Spec pass judges what they cannot see. The standing bar judges whether the
change is *finished*, and it is the same bar
for every change: see *Definition of Done* in `o-implement`'s `SKILL.md`. Read it before writing the verdict, and
say in the plan which rows you could check and which you could not. A review that reports only its own passes has
said nothing about the rows no pass covers — whether the change was seen to work at runtime, and whether the docs
describe it as it now is.

## Output Format

Produce a review and save it into the run folder. Use `save-plan.mjs` to create the directory and generate a numbered plan file:

```bash
node <skill>/scripts/save-plan.mjs --slug <topic>
```

A function counts as this review's only when the change wrote one of its lines; one the change walked past is a
single pre-existing count, never a finding, so a small change to an old file is not buried in its history. The
script lists the touched ones under **Over the bar** with `file:line` for the [PRINCIPLE] pass. A repo sets its own
bar in `.o-skills/config/review.json` (`maxComplexity`, `maxLength`, `maxParams`); the skill's 5, 20 and 3 are the
default.

The script prints the full path. It already carries every pass heading, each with a pending line. Open it with your file tools and replace each pending line using this format — all eight passes get their own section, and the pass headings below are written even when a pass found nothing or a light review skipped it:

```markdown
# Code Review — Fix Plan

**Date:** YYYY-MM-DD-hhmm
**Scope:** 3 files changed vs main@1a2b3c4 (2 committed, 0 staged, 1 unstaged, 0 untracked)
**Files analyzed:** N
**Functions with complexity > 5 in code this change touched:** N
**Functions longer than 20 lines in code this change touched:** N
**Pre-existing functions over the bar, untouched:** N — not findings of this review; `--all` lists them
**Duplicated blocks found:** N
**Review:** full | light — <why>

---

## [Correctness] — pass 2 of the review

Write `none` when the pass found nothing.

- [ ] **Severity:** CRITICAL / MAJOR
  - **File:** `path/to/file.js:42`
  - **Issue:** The wrong result, lost data or hole, and the input that shows it
  - **Suggestion:** The fix, and the test that would have caught it

---

## [PRINCIPLE] — pass 3: brief description

- [ ] **Severity:** CRITICAL / MAJOR / MINOR
  - **File:** `path/to/file.js:42`
  - **Issue:** What's wrong (one sentence)
  - **Suggestion:** How to fix it (concrete, actionable)

---

## [Comments] — pass 4 of the review

Write `none` when the pass found nothing. A missing heading is incomplete, not clean.

- [ ] **Severity:** MINOR
  - **File:** `path/to/file.js:88`
  - **Issue:** The comment restates the code / the block needs a paragraph to explain the *what*
  - **Suggestion:** Delete it / extract the block into a named function (applied by `o-fix`)

---

## [Bloat] — pass 5 of the review

- [ ] **Severity:** MAJOR / MINOR
  - **File:** `path/to/file.js:12`
  - **Rung:** the o-unbloat ladder rung or table row it fails
  - **Issue:** What does not need to exist
  - **Suggestion:** The unbloated version (applied by `o-fix`)

---

## [Architecture] — pass 6 of the review

| Unit | Group | Verdict | Why | Where |
|------|-------|---------|-----|-------|
| `src/utils/` | naming | MAJOR | bag name, no invariant | `src/utils/index.js:1` |

**o-arch-lint:** `rated: [...]`, `unrated: [...]` — copy both lists verbatim; a green run over an undeclared
tree is not full coverage.

---

## [Floor] — pass 7 of the review

Write `none` when the guard found nothing. A guard that could not run (exit 2) is not `none` — say so.

- [ ] **Severity:** MAJOR
  - **File:** `src/a.ts:42`
  - **Rule:** the guard's rule name, e.g. `silenced-checker`
  - **Issue:** The move that lowers the bar (applied by `o-fix`, unless it is routed through a tracked exception)

**o-floor:** `rated: [...]`, `unrated: [...]` — copy both lists verbatim; a green run over an undeclared floor is
a much weaker statement than a green run over a declared one.

---

## [Spec] — pass 8 of the review

Write `none` when the pass found nothing, and `no spec available` when no spec source resolved.

- [ ] **Severity:** MAJOR
  - **File:** `path/to/file.js:42`
  - **Issue:** The acceptance criterion this code does not meet / behavior built beyond the spec / a required item silently deferred
  - **Suggestion:** Meet the criterion, cut the extra behavior, or record the deferral (applied by `o-fix`)

---

## Summary

**Total issues:** N (**critical:** N, **major:** N, **minor:** N)
**Status:** 0/N resolved | Review issues manually or run `o-fix` to apply them.
```

Apply fixes manually based on review findings. Track progress by updating checkboxes `[ ]` → `[x]`.

A plan without a `[Correctness]`, `[Comments]`, `[Bloat]`, `[Architecture]`, `[Floor]` or `[Spec]` section is
**incomplete, not clean**: every pass writes its heading on every review, including a re-run and a light review,
and says plainly when it found nothing or was skipped. On a re-run, carry each earlier finding forward as
resolved or still open, and list pre-existing findings apart from the ones this branch introduced, so the counts
describe the change under review.

## After the Review — Where Findings Get Fixed

Do not recommend the passes as follow-up work: passes 4–7 already ran inside this review and their findings are
in the plan. This table routes the fixes, not the passes.

| Review finding | What to run next | Why |
|----------------|------------------|-----|
| Any issue that needs fixing (`[Correctness]`, complexity, SOLID, duplication, `[Comments]`, `[Bloat]`, `[Architecture]`, `[Floor]`) | `o-fix` | Reads your plan and edits source files to resolve every finding, including the comment, bloat, architecture and floor rows |
| Structural refactoring suggestions without applying changes | `o-refactor` | Analysis-only — produces before/after comparisons but doesn't edit code |
| Behavioral bugs or runtime errors that need investigation | `o-debug` | Hypothesis-driven debugging — reproduce, isolate root cause, then fix with o-fix |

For most review workflows: **use `o-fix`** to resolve every issue in your plan. Use `o-refactor` only when you
want suggestions without applying changes. A review that ends by recommending `o-unbloat`, `o-comments` or
`o-arch` as the next step has skipped those passes — go back and run them.
