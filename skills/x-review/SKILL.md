---
name: x-review
description: Review code against engineering principles — small functions, SOLID, KISS, DRY — and against the originating spec, with automated AST-based complexity analysis across 30+ languages including Python, C, C++, Java, JavaScript, TypeScript, Go, Rust, Ruby, PHP, Swift, Kotlin, and more. Runs the comments (x-comments), bloat (x-unbloat), architecture (x-arch + x-arch-lint) and quality-floor (x-floor) passes as part of every review. Also checks every change against the standing Definition of Done.
version: 2.3.0
author: Community
tags: [code-review, solid, kiss, dry, single-responsibility, cyclomatic-complexity, code-quality]
user-invocable: true
auto-trigger:
  on-file-pattern: "*.ts,*.tsx,*.js,*.jsx,*.py,*.go,*.java,*.rb,*.rs,*.hx,*.c,*.cpp,*.cs,*.swift,*.kt,*.lua,*.dart,*.scala,*.hs,*.ex,*.erl,*.clj,*.fs,*.zig,*.jl,*.pl,*.r,*.groovy,*.adb"
  not-when:
    - path-matches: "node_modules/**"
    - file-size-above: 5242880  # Skip files > 5MB
---

# X-Review — Code Review Against Engineering Principles

A review is seven passes over the same scope, and all seven write their findings into one plan file. Passes 3–6
are child skills run **inside** this review — they are not follow-ups to recommend afterwards.

## The Seven Passes

| # | Pass | Runs | Writes |
|---|------|------|--------|
| 1 | **Metrics** | `save-plan.mjs` — complexity, duplication, refactor patterns | the counts at the top of the plan |
| 2 | **Principles** | this skill's rules and `references/principles.md` | `[PRINCIPLE]` sections |
| 3 | **Comments** | **x-comments**, run as a pass (report only) | `[Comments]` |
| 4 | **Bloat** | **x-unbloat**, run as a pass — its ladder and table (report only) | `[Bloat]` |
| 5 | **Architecture** | **x-arch**, run as a pass, plus **x-arch-lint**'s `arch-check.mjs` | `[Architecture]` |
| 6 | **Floor** | **x-floor**'s `floor-guard.mjs` on the diff | `[Floor]` |
| 7 | **Spec** | this skill's spec-resolution rules below | `[Spec]` |

A plan missing `[Comments]`, `[Bloat]`, `[Architecture]`, `[Floor]` or `[Spec]` is **incomplete, not clean**: passes
3–7 run
on every review, including a re-run, and each says plainly when it found nothing. Every pass reports; applying
the fixes is `x-fix`'s job.

## Two Ways It Runs

**As a pass inside another skill:** x-implement's VERIFY step reads `references/pass.md`; it owns the task-review
steps.

**On its own**, when the user asks for a review: every section below applies.

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory by passing the full path:

```bash
# Run from anywhere (use whichever script path is available):
node <path-to>/scripts/analyze-complexity.mjs --all       # AST-based complexity, length, params per function
node <path-to>/scripts/check-duplication.mjs --all         # duplicated blocks (>5 lines)
node <path-to>/scripts/save-plan.mjs --slug <topic> [--reviews <task file>] [--base <ref> | --all | --files a,b]   # create plan file with all analysis results
```

`save-plan.mjs` measures the change by default: the source files changed since the merge-base with `main` (else
`master`), committed or not, so a review run before the commit measures the work in progress. `--base <ref>` picks
another ref, `--files` names the files, and `--all` measures every tracked file. The plan's `**Scope:**` line names
what was measured; an empty change reads `not measured`, never 0. `check-duplication.mjs` finds blocks repeated
inside one file, not copies across files.

**Auto-discovery**: Scripts resolve config and sibling scripts relative to the directory they sit in (ESM has no `__dirname`; it is derived from `import.meta.url`), so they work whether installed globally (`~/.agents/skills/x-review/scripts/`) or locally (`.agents/skills/<project>/x-review/scripts/`).

## What To Do

When invoked, determine the user's scope (single file, directory, or full project) and run all seven passes below
into the one plan file. Do not ask the user what to do, and do not stop after the metrics.

1. **Metrics pass — create the plan with all analyses**: `node <path-to>/scripts/save-plan.mjs --slug <topic>` — this runs complexity analysis (AST-based via tree-sitter), duplication check, AND refactor pattern detection in one step. It writes `E<nn>-review-plan.md` into the run folder and prints the full path. When the review is of one task (as x-implement's VERIFY step runs it), pass `--reviews <task file>`: the plan's property block then links the task it reviewed, so Obsidian shows the review hanging off it.
2. **Principles pass** — write the complexity, SOLID, KISS, DRY and SRP findings into the plan as `[PRINCIPLE]` sections, using the format below.
3. **Comments pass (part of the review, using x-comments)** — apply the rules in x-comments' pass card (`~/.agents/skills/x-comments/references/pass.md` for a global install, `.agents/skills/x-comments/references/pass.md` for a local one) to every reviewed file. Report comment issues under a `[Comments]` heading in the plan: comments that restate code, obvious comments, and paragraph-long explanations that should be a named function. Report only — `x-fix` makes the edits.
4. **Bloat pass (part of the review, using x-unbloat)** — apply the ladder and table in x-unbloat's pass card (`~/.agents/skills/x-unbloat/references/pass.md` for a global install, `.agents/skills/x-unbloat/references/pass.md` for a local one) to every reviewed file, in the card's x-review mode. Report findings under a `[Bloat]` heading in the plan, each naming the ladder rung it fails and the unbloated version: speculative abstractions (one-implementation interfaces, single-use factories, pass-through wrappers) are MAJOR; dead code, unused options, and re-implemented stdlib are MINOR. A branch for a state the types or the internal callers rule out is reported here too, with the narrower representation named as the fix (x-unbloat's *Bloat, Unless…* row; the rule is *Make the Bad State Impossible* in x-implement's `SKILL.md`) — MAJOR when a caller must handle a failure the type could have excluded, MINOR when the check is only redundant, and never flagged where the input crosses a trust boundary. Never flag what x-unbloat's *Never Cut* list or a *Keep it if* exception protects. Report only: the cuts are x-fix's job.
5. **Architecture pass (part of the review, using x-arch and x-arch-lint)** — apply the rules in x-arch's pass card (`~/.agents/skills/x-arch/references/pass.md` for a global install, `.agents/skills/x-arch/references/pass.md` for a local one) to every reviewed file, in the card's x-review mode: all five groups, report only. Then run `node ~/.agents/skills/x-arch-lint/scripts/arch-check.mjs --root .` (`.agents/skills/x-arch-lint/scripts/arch-check.mjs` for a local install). Report findings under an `[Architecture]` heading: a bag name, a crossed boundary, a misplaced responsibility or a wrong-way import is MAJOR. Give the heading one row per unit the pass judged, naming the group, the verdict, the reason and a `file:line`, and copy the checker's `rated` and `unrated` lists in so a green run over an undeclared tree is not read as full coverage. Report only: the moves are x-fix's job.
6. **Floor pass (part of the review, using x-floor)** — run `node ~/.agents/skills/x-floor/scripts/floor-guard.mjs --root .` (`.agents/skills/x-floor/scripts/floor-guard.mjs` for a local install). It compares the quality floor declared at the merge base with the one on disk and reports the moves that lower the bar — a weakened threshold, a dropped rule, a new or extended exception, a silenced checker, unfinished work, a test made easier, a deleted test, or an assertion removed from a test that still exists. Report each under a `[Floor]` heading with its `rule`, `file` and `line`, and copy the guard's `rated` and `unrated` lists in verbatim: a repo with no `.x-skills/config/floor.json` is reported as unrated rather than as clean. Exit 2 is **not** a clean result — say the guard could not run and why. Report only: the fixes are x-fix's job.
7. **Spec pass** — ask one question of the whole change: does the diff faithfully implement the originating spec,
   ticket, or task? Resolve the spec source in this order: (1) task or issue references in the commit messages;
   (2) a path the user passed to the review; (3) a plan or task artifact in the run folder (`E00-plan.md`, a task
   file under `E<nn>-tasks/`); (4) none of these — ask the user, and on "there isn't one" report `no spec
   available` under `[Spec]` and move on. Where a source resolves, check three things: every acceptance criterion
   it states is met, nothing is built that the spec does not ask for, and nothing the spec requires is silently
   deferred. A requirement the diff does not meet is MAJOR; an unrequested behavior change is MAJOR; a deferred
   item with no record in the plan is MAJOR. Report findings under `[Spec]` in the finding format below.
8. **Unmeasured analyses** — an analysis script that failed is not a zero; carry `save-plan.mjs`'s "Analysis incomplete" note into the plan rather than reporting a clean result.

The complexity script auto-installs tree-sitter if missing (global install). Each script prints JSON, and the keys mislead on first read — `functions` is nested inside a file, and `duplicatedBlocks` is a **count**, not the list:

```
analyze-complexity.mjs   { files: [ { file, functionCount, functions: [ { name, line, length, complexity, paramCount, issues[] } ] } ],
                          summary: { totalFiles, totalFunctions, highComplexity, longFunctions, tooManyParams, language, thresholds } }
check-duplication.mjs    { totalFiles, duplicatedBlocks, duplicates: [ { file, lines, occurrences[], sample } ] }
analyze-patterns.mjs     { results, totalFiles, message }
```

`summary.language` says which engine ran: `tree-sitter (AST-based)` or `regex fallback`. Regex metrics have no parameter counts and approximate line numbers, so say which engine you reviewed with when it is not the AST one.

A count in the plan is a measurement, and an unmeasured count is not a zero. When an analysis script fails, `save-plan.mjs` writes `unknown — <script> failed, so this was not measured` and an "Analysis incomplete" note naming the reason. Carry that into the review: never report a failed analysis as a clean result.

For engineering principles definitions and violation patterns, see `references/principles.md`.
For language-specific review criteria, see `references/lang-typescript.md` (TypeScript) and
`references/lang-python.md` (Python) — when the change is one of those languages, read its pack and
apply it under `[PRINCIPLE]`; for a language with no pack, say so rather than inventing criteria.

**After running the scripts:** The plan file path is printed by `save-plan.mjs`. Open that file with `view` or `edit`, then write your review content directly into it using the format below. **Do not use MCP resources to read/write plan files — they don't exist.**

## Related Skills

These are the passes this review runs, and where their findings go. Read each skill's pass card before running its
pass (the paths are in the steps above); this skill never restates their rules.

- **x-comments** — Run as pass 3 of every review (report only). Comment noise, obvious comments, and
  paragraph-long explanations that should be a named function are findings under `[Comments]`; `x-fix` applies
  them, and applying one never changes behavior.
- **x-unbloat** — Run as pass 4 of every review (report only, in the x-review mode of x-unbloat's pass card). It finds code that does not need to exist: speculative abstractions, pass-through wrappers, unused
  options, dead code, re-implemented stdlib. Findings go under `[Bloat]`; `x-fix` applies them per x-unbloat's
  *Keep it if* and *Never Cut* rules.
- **x-arch** with **x-arch-lint** — Run as pass 5 of every review (report only, in the x-review mode of x-arch's
  pass card: all five groups). x-arch judges where a unit lives, what it is called, what its one responsibility is and which
  way its dependencies point; x-arch-lint checks the same tree against `.x-skills/config/arch.json` and reports
  `file:line` violations. Findings go under `[Architecture]`; `x-fix` applies them.
- **x-floor** — Run as pass 6 of every review. `floor-guard.mjs` reports the moves that lower the declared quality
  floor, and the `rated`/`unrated` lists that say which half of the bar was actually checked. Findings go under
  `[Floor]`; `x-fix` applies them.
- **x-fix** — Reads this plan and edits source files to resolve every finding from every pass, including the
  comment, bloat and architecture rows.
- **x-refactor** — Analysis-only refactoring suggestions (extract method, rename variables, replace conditionals)
  on flagged files. It runs x-unbloat's ladder before suggesting anything, and applies nothing.
- **x-debug** — For runtime errors or behavioral issues that require hypothesis-driven investigation rather than static code analysis.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "The diff is small — I'll read it and say LGTM." | A verdict without the passes is a rubber stamp. The plan is the evidence; a missing `[Comments]`, `[Bloat]` or `[Architecture]` heading makes it incomplete, not clean. |
| "Those passes found nothing here, so I'll leave the heading out." | A pass that found nothing writes `none`. A missing heading is indistinguishable from a pass that never ran. |
| "This file is already huge, I'll just review the diff." | Then say so and ask for a split. Reviewing around a structural problem is how it gets buried; the size is itself a finding. |
| "Ten nits and one structural problem — I'll list them in order." | Lead with leverage: correctness and structure first. If there is one structural problem and ten nits, the structural problem *is* the review. |
| "I noticed dead code, but I won't ask about deleting it." | List it and ask. Silently deleting what you do not fully understand is the other failure, and leaving it unmentioned hides it from the next reader. |
| "The Scope line is close enough to what I was asked to review." | Then the counts describe other files. Rerun with `--files` or `--base`, and say whether the engine was the AST one or the regex fallback. |
| "The analysis script failed, so the count is zero." | An unmeasured count is not a zero. Carry the "Analysis incomplete" note into the plan and never report a failed analysis as a clean result. |

## Severity

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Violates SRP or introduces bug risk | Must fix before merge |
| MAJOR | Clear SOLID/KISS/DRY violation | Should fix |
| MINOR | Style or minor optimization | Nice to have |

**CRITICAL SRP note:** a function that interleaves phases (fetch, validate, probe, decrypt) with inline reporting (`push` to a shared results array inside each branch) is an orchestrator-with-interleaved-reporting violation — always CRITICAL. Verify with the two extract tests in `references/principles.md` (one-sentence test, reporting test).

## The Standing Bar

The six code passes judge the code; the Spec pass judges what they cannot see. The standing bar judges whether the
change is *finished*, and it is the same bar
for every change: see *Definition of Done* in `x-implement`'s `SKILL.md`. Read it before writing the verdict, and
say in the plan which rows you could check and which you could not. A review that reports only its own passes has
said nothing about the rows no pass covers — whether the change was seen to work at runtime, and whether the docs
describe it as it now is.

## Output Format

Produce a review and save it into the run folder. Use `save-plan.mjs` to create the directory and generate a numbered plan file:

```bash
node <path-to>/scripts/save-plan.mjs --slug <topic>
```

The script prints the full path. Open that file with `edit` or `write`, then insert your review content using this format — all seven passes get their own section, and the pass headings below are written even when a pass found nothing:

```markdown
# Code Review — Fix Plan

**Date:** YYYY-MM-DD-hhmm
**Scope:** 3 files changed vs main@1a2b3c4 (2 committed, 0 staged, 1 unstaged, 0 untracked)
**Files analyzed:** N
**Functions with complexity > 5:** N
**Functions longer than 20 lines:** N
**Duplicated blocks found:** N

---

## [PRINCIPLE] — Brief description

- [ ] **Severity:** CRITICAL / MAJOR / MINOR
  - **File:** `path/to/file.js:42`
  - **Issue:** What's wrong (one sentence)
  - **Suggestion:** How to fix it (concrete, actionable)

---

## [Comments] — pass 3 of the review

Write `none` when the pass found nothing. A missing heading is incomplete, not clean.

- [ ] **Severity:** MINOR
  - **File:** `path/to/file.js:88`
  - **Issue:** The comment restates the code / the block needs a paragraph to explain the *what*
  - **Suggestion:** Delete it / extract the block into a named function (applied by `x-fix`)

---

## [Bloat] — pass 4 of the review

- [ ] **Severity:** MAJOR / MINOR
  - **File:** `path/to/file.js:12`
  - **Rung:** the x-unbloat ladder rung or table row it fails
  - **Issue:** What does not need to exist
  - **Suggestion:** The unbloated version (applied by `x-fix`)

---

## [Architecture] — pass 5 of the review

| Unit | Group | Verdict | Why | Where |
|------|-------|---------|-----|-------|
| `src/utils/` | naming | MAJOR | bag name, no invariant | `src/utils/index.js:1` |

**x-arch-lint:** `rated: [...]`, `unrated: [...]` — copy both lists verbatim; a green run over an undeclared
tree is not full coverage.

---

## [Floor] — pass 6 of the review

Write `none` when the guard found nothing. A guard that could not run (exit 2) is not `none` — say so.

- [ ] **Severity:** MAJOR
  - **File:** `src/a.ts:42`
  - **Rule:** the guard's rule name, e.g. `silenced-checker`
  - **Issue:** The move that lowers the bar (applied by `x-fix`, unless it is routed through a tracked exception)

**x-floor:** `rated: [...]`, `unrated: [...]` — copy both lists verbatim; a green run over an undeclared floor is
a much weaker statement than a green run over a declared one.

---

## [Spec] — pass 7 of the review

Write `none` when the pass found nothing, and `no spec available` when no spec source resolved.

- [ ] **Severity:** MAJOR
  - **File:** `path/to/file.js:42`
  - **Issue:** The acceptance criterion this code does not meet / behavior built beyond the spec / a required item silently deferred
  - **Suggestion:** Meet the criterion, cut the extra behavior, or record the deferral (applied by `x-fix`)

---

## Summary

**Total issues:** N (**critical:** N, **major:** N, **minor:** N)
**Status:** 0/N resolved | Review issues manually or run `x-fix` to apply them.
```

Apply fixes manually based on review findings. Track progress by updating checkboxes `[ ]` → `[x]`.

A plan without a `[Comments]` section is **incomplete, not clean**: the comments pass is step 3 of every
review, including a re-run, and its findings belong under that heading (say so plainly when it found
nothing). `[Bloat]`, `[Architecture]`, `[Floor]` and `[Spec]` are the same: steps 4, 5, 6 and 7 run on every review,
so a plan missing any of those headings is incomplete rather than clean. On a re-run, carry each earlier finding forward as
resolved or still open, and list pre-existing findings apart from the ones this branch introduced, so the counts
describe the change under review.

## After the Review — Where Findings Get Fixed

Do not recommend the passes as follow-up work: passes 3–6 already ran inside this review and their findings are
in the plan. This table routes the fixes, not the passes.

| Review finding | What to run next | Why |
|----------------|------------------|-----|
| Any issue that needs fixing (complexity, SOLID, duplication, `[Comments]`, `[Bloat]`, `[Architecture]`, `[Floor]`) | `x-fix` | Reads your plan and edits source files to resolve every finding, including the comment, bloat, architecture and floor rows |
| Structural refactoring suggestions without applying changes | `x-refactor` | Analysis-only — produces before/after comparisons but doesn't edit code |
| Behavioral bugs or runtime errors that need investigation | `x-debug` | Hypothesis-driven debugging — reproduce, isolate root cause, then fix with x-fix |

For most review workflows: **use `x-fix`** to resolve every issue in your plan. Use `x-refactor` only when you
want suggestions without applying changes. A review that ends by recommending `x-unbloat`, `x-comments` or
`x-arch` as the next step has skipped those passes — go back and run them.
